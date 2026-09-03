import 'server-only';

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { ImportedRow } from '@creditmesh/adapters';
import { normalizeTaxId, resolveParties, type PartySourceRow } from '@creditmesh/core';

/**
 * Applies validated adapter output to the canonical tables.
 *
 * This is the only place that turns adapter rows into party rows, and it runs
 * on the service role because ingestion writes across entities that no single
 * user is scoped to. Everything it does is idempotent on the natural keys, so a
 * re-upload of the same file is a no-op rather than a duplicate — §5.2 requires
 * it, and in practice people re-upload constantly while fixing a mapping.
 *
 * Every write is checked. An earlier version discarded the result of the
 * identifier upsert; it had been failing on a mismatched ON CONFLICT clause
 * since the first release, and the screen cheerfully reported success while
 * nothing was written. A silent write failure in an ingestion path is the worst
 * possible failure mode for this product: the numbers are simply wrong, and
 * nobody goes looking for a total that looks plausible.
 */

export interface ApplyContext {
  admin: SupabaseClient;
  tenantId: string;
  systemId: string;
  actorId: string;
  dataAsOf: string | null;
}

export interface ApplyResult {
  inserted: number;
  updated: number;
  skipped: number;
  notes: string[];
  /** True when any write failed. The caller marks the batch failed, not applied. */
  failed: boolean;
}

/** Collects write failures instead of letting them disappear. */
class WriteLog {
  readonly notes: string[] = [];
  failed = false;

  check(label: string, error: PostgrestError | null): boolean {
    if (!error) return true;
    this.failed = true;
    this.notes.push(`${label} failed: ${error.message}${error.hint ? ` (${error.hint})` : ''}`);
    return false;
  }

  note(message: string): void {
    this.notes.push(message);
  }
}

interface PartyIndex {
  /** `systemId|legalEntityCode|sourceCode` → party id. */
  bySourceCode: Map<string, string>;
  /** Normalised tax id → party id. */
  byTaxId: Map<string, string>;
}

/**
 * Seeded from `party.tax_id` first and `party_identifier` second.
 *
 * The party table is the more reliable of the two: it holds the tax id in a
 * column with its own unique index, so a re-import still resolves to the same
 * party even when the identifier rows are missing or incomplete. Relying on
 * identifiers alone is what would turn a repaired import into duplicate parties.
 */
async function loadPartyIndex(ctx: ApplyContext, log: WriteLog): Promise<PartyIndex> {
  const bySourceCode = new Map<string, string>();
  const byTaxId = new Map<string, string>();

  const { data: parties, error: partyError } = await ctx.admin
    .from('party')
    .select('id, tax_id')
    .eq('tenant_id', ctx.tenantId)
    .neq('status', 'merged');
  log.check('reading party register', partyError);

  for (const p of parties ?? []) {
    const taxId = normalizeTaxId(p.tax_id);
    if (taxId) byTaxId.set(taxId, p.id);
  }

  const { data: identifiers, error: identifierError } = await ctx.admin
    .from('party_identifier')
    .select('party_id, kind, system_id, legal_entity_code, value')
    .eq('tenant_id', ctx.tenantId);
  log.check('reading party identifiers', identifierError);

  for (const row of identifiers ?? []) {
    if (row.kind === 'source_system') {
      bySourceCode.set(`${row.system_id}|${row.legal_entity_code}|${row.value}`, row.party_id);
    } else if (row.kind === 'tax_id') {
      byTaxId.set(row.value, row.party_id);
    }
  }

  return { bySourceCode, byTaxId };
}

export async function applyPartyRows(ctx: ApplyContext, rows: ImportedRow[]): Promise<ApplyResult> {
  const log = new WriteLog();
  const observedAt = new Date().toISOString();

  const sourceRows: PartySourceRow[] = rows.map((r) => ({
    systemId: ctx.systemId,
    legalEntityCode: String(r.legalEntityCode),
    sourceCode: String(r.sourceCode),
    legalName: String(r.legalName),
    taxId: r.taxId === null ? null : String(r.taxId),
    role: (r.role as PartySourceRow['role']) ?? 'customer',
    sourceRef: `import:${ctx.systemId}:${r.__rowNumber}`,
    observedAt,
  }));

  const resolution = resolveParties(sourceRows);
  for (const w of resolution.warnings.slice(0, 20)) log.note(`${w.code}: ${w.detail}`);
  if (resolution.warnings.length > 20) log.note(`…and ${resolution.warnings.length - 20} more warnings`);

  // Entities referenced by the file must exist before rows can point at them.
  const entityCodes = [...new Set(sourceRows.map((r) => r.legalEntityCode))];
  const { data: knownEntities, error: entityError } = await ctx.admin
    .from('legal_entity')
    .select('code')
    .eq('tenant_id', ctx.tenantId);
  log.check('reading legal entities', entityError);

  const known = new Set((knownEntities ?? []).map((e) => e.code));
  const missing = entityCodes.filter((c) => !known.has(c));
  if (missing.length > 0) {
    // Created rather than rejected: on a first upload the register itself is
    // what tells us which entities exist, and stopping here would strand the
    // user with a file they cannot import and no way to fix it.
    const { error } = await ctx.admin.from('legal_entity').insert(
      missing.map((code) => ({ tenant_id: ctx.tenantId, code, display_name: code, currency: 'THB' })),
    );
    if (log.check('creating legal entity placeholders', error)) {
      log.note(`created ${missing.length} legal entity placeholder(s): ${missing.join(', ')}`);
    }
  }

  const index = await loadPartyIndex(ctx, log);
  const partyIdByKey = new Map<string, string>();
  let inserted = 0;
  let updated = 0;

  for (const party of resolution.parties) {
    const taxId = party.taxId;
    let partyId = taxId ? index.byTaxId.get(taxId) : undefined;

    if (!partyId) {
      // Fall back to a source code already on file, so a party first seen
      // without a tax id is not duplicated when one arrives later.
      for (const ident of party.identifiers) {
        if (ident.kind !== 'source_system') continue;
        const hit = index.bySourceCode.get(`${ident.systemId}|${ident.legalEntityCode}|${ident.value}`);
        if (hit) {
          partyId = hit;
          break;
        }
      }
    }

    if (partyId) {
      const { error } = await ctx.admin
        .from('party')
        .update({ legal_name: party.legalName, tax_id: taxId, roles: party.roles })
        .eq('id', partyId);
      if (!log.check(`updating party "${party.legalName}"`, error)) continue;
      updated += 1;
    } else {
      const { data: created, error } = await ctx.admin
        .from('party')
        .insert({
          tenant_id: ctx.tenantId,
          legal_name: party.legalName,
          tax_id: taxId,
          roles: party.roles,
        })
        .select('id')
        .single();
      if (!log.check(`creating party "${party.legalName}"`, error) || !created) continue;
      partyId = created.id as string;
      inserted += 1;
    }

    // Both branches above either set partyId or skipped the row; this states
    // that for the compiler and guards against a future branch that does not.
    if (!partyId) continue;
    if (taxId) index.byTaxId.set(taxId, partyId);
    partyIdByKey.set(party.key, partyId);

    // Empty string rather than NULL for the unscoped fields: the uniqueness key
    // is a plain column list (migration 0009) and NULLs never compare equal.
    const identifierRows = party.identifiers.map((ident) => ({
      tenant_id: ctx.tenantId,
      party_id: partyId,
      kind: ident.kind,
      system_id: ident.systemId ?? '',
      legal_entity_code: ident.legalEntityCode ?? '',
      value: ident.value,
    }));

    if (identifierRows.length > 0) {
      const { error } = await ctx.admin.from('party_identifier').upsert(identifierRows, {
        onConflict: 'tenant_id,kind,system_id,legal_entity_code,value',
        ignoreDuplicates: true,
      });
      // Without identifiers, receivables and limits cannot be matched to this
      // party at all, so this failure is fatal to the import, not cosmetic.
      if (log.check(`writing identifiers for "${party.legalName}"`, error)) {
        for (const ident of party.identifiers) {
          if (ident.kind === 'source_system') {
            index.bySourceCode.set(`${ident.systemId}|${ident.legalEntityCode}|${ident.value}`, partyId);
          }
        }
      }
    }
  }

  // Ambiguous name matches become a review queue, never an automatic merge.
  for (const candidate of resolution.mergeCandidates.slice(0, 100)) {
    const left = partyIdByKey.get(candidate.leftKey);
    const right = partyIdByKey.get(candidate.rightKey);
    if (!left || !right || left === right) continue;
    const { error } = await ctx.admin.from('party_merge_candidate').insert({
      tenant_id: ctx.tenantId,
      left_party_id: left,
      right_party_id: right,
      reason: candidate.reason,
      score: candidate.score,
    });
    log.check('queueing a merge candidate', error);
  }

  return { inserted, updated, skipped: 0, notes: log.notes, failed: log.failed };
}

export async function applyArItemRows(ctx: ApplyContext, rows: ImportedRow[], baseCurrency: string): Promise<ApplyResult> {
  const log = new WriteLog();
  const index = await loadPartyIndex(ctx, log);
  const payload: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const r of rows) {
    const key = `${ctx.systemId}|${String(r.legalEntityCode)}|${String(r.partySourceCode)}`;
    const partyId = index.bySourceCode.get(key);
    if (!partyId) {
      skipped += 1;
      continue;
    }
    payload.push({
      tenant_id: ctx.tenantId,
      party_id: partyId,
      legal_entity_code: String(r.legalEntityCode),
      system_id: ctx.systemId,
      document_no: String(r.documentNo),
      document_date: r.documentDate,
      due_date: r.dueDate,
      cleared_date: r.clearedDate,
      amount: r.amount,
      currency: String(r.currency ?? baseCurrency),
      amount_base: r.amountBase ?? r.amount,
      base_currency: baseCurrency,
      source_ref: `import:${ctx.systemId}:${r.__rowNumber}`,
    });
  }

  if (skipped > 0) {
    log.note(
      `${skipped} row(s) reference a counterparty code not in the register — import the counterparty register first`,
    );
  }

  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await ctx.admin
      .from('ar_item')
      .upsert(payload.slice(i, i + 500), { onConflict: 'tenant_id,system_id,legal_entity_code,document_no' });
    log.check('writing receivables', error);
  }

  return { inserted: log.failed ? 0 : payload.length, updated: 0, skipped, notes: log.notes, failed: log.failed };
}

export async function applyCreditLimitRows(ctx: ApplyContext, rows: ImportedRow[], baseCurrency: string): Promise<ApplyResult> {
  const log = new WriteLog();
  const index = await loadPartyIndex(ctx, log);
  const payload: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const r of rows) {
    const partyId = index.bySourceCode.get(`${ctx.systemId}|${String(r.legalEntityCode)}|${String(r.partySourceCode)}`);
    if (!partyId) {
      skipped += 1;
      continue;
    }
    payload.push({
      tenant_id: ctx.tenantId,
      party_id: partyId,
      legal_entity_code: String(r.legalEntityCode),
      limit_amount: r.limitAmount,
      currency: String(r.currency ?? baseCurrency),
      valid_from: r.validFrom ?? new Date().toISOString().slice(0, 10),
      valid_to: r.validTo,
      origin: 'source_system',
      source_ref: `import:${ctx.systemId}:${r.__rowNumber}`,
    });
  }

  if (payload.length > 0) {
    const { error } = await ctx.admin.from('credit_limit').insert(payload);
    log.check('writing credit limits', error);
  }
  if (skipped > 0) log.note(`${skipped} row(s) reference an unknown counterparty code`);

  return { inserted: log.failed ? 0 : payload.length, updated: 0, skipped, notes: log.notes, failed: log.failed };
}

export async function applyFinancialStatementRows(ctx: ApplyContext, rows: ImportedRow[], baseCurrency: string): Promise<ApplyResult> {
  const log = new WriteLog();
  const index = await loadPartyIndex(ctx, log);
  const payload: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const r of rows) {
    const taxId = normalizeTaxId(r.taxId === null ? null : String(r.taxId));
    const partyId = taxId ? index.byTaxId.get(taxId) : undefined;
    if (!partyId) {
      skipped += 1;
      continue;
    }
    payload.push({
      tenant_id: ctx.tenantId,
      party_id: partyId,
      fiscal_year: r.fiscalYear,
      period_end: r.periodEnd,
      currency: String(r.currency ?? baseCurrency),
      revenue: r.revenue,
      gross_profit: r.grossProfit,
      net_profit: r.netProfit,
      total_assets: r.totalAssets,
      total_liabilities: r.totalLiabilities,
      equity: r.equity,
      current_assets: r.currentAssets,
      current_liabilities: r.currentLiabilities,
      cash: r.cash,
      inventory: r.inventory,
      receivables: r.receivables,
      provider_id: 'manual_upload',
      source_ref: `import:${ctx.systemId}:${r.__rowNumber}`,
    });
  }

  if (skipped > 0) {
    log.note(`${skipped} statement(s) have a tax id not matching any counterparty on file`);
  }

  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await ctx.admin
      .from('financial_statement')
      .upsert(payload.slice(i, i + 500), { onConflict: 'tenant_id,party_id,fiscal_year' });
    log.check('writing financial statements', error);
  }

  return { inserted: log.failed ? 0 : payload.length, updated: 0, skipped, notes: log.notes, failed: log.failed };
}
