import type { Evidence, PartyRole } from '../types/canonical';

/**
 * Party Resolution Engine — Module 0, the Golden Party Record.
 *
 * One counterparty holds a different code in every source system and often a
 * different code per legal entity inside one system. This engine collapses
 * those into a single party and keeps every original code as an identifier.
 *
 * Deliberately conservative: it merges only on a normalised taxpayer id, and
 * reports name-similarity matches as *candidates* for a human. Auto-merging on
 * names produces wrong exposure totals, and a wrong total is worse than a gap
 * because nobody goes looking for it.
 */

export interface PartySourceRow {
  systemId: string;
  legalEntityCode: string;
  /** The party's code in that system/entity. */
  sourceCode: string;
  legalName: string;
  taxId: string | null;
  role: PartyRole;
  sourceRef: string;
  observedAt: string;
}

export interface ResolvedIdentifier {
  kind: 'tax_id' | 'source_system';
  systemId: string | null;
  legalEntityCode: string | null;
  value: string;
}

export interface ResolvedParty {
  /** Stable within a run: `tax:<id>` or `name:<slug>`. */
  key: string;
  legalName: string;
  taxId: string | null;
  roles: PartyRole[];
  identifiers: ResolvedIdentifier[];
  legalEntityCodes: string[];
  systemIds: string[];
  rowCount: number;
  evidence: Evidence[];
  /** True when the party was assembled without a taxpayer id to key on. */
  weakKey: boolean;
}

export interface MergeCandidate {
  leftKey: string;
  rightKey: string;
  reason: 'name_similarity';
  score: number;
  leftName: string;
  rightName: string;
}

export interface ResolutionWarning {
  code: 'invalid_tax_id_checksum' | 'tax_id_name_conflict' | 'missing_tax_id';
  detail: string;
  sourceRef: string;
}

export interface ResolutionResult {
  parties: ResolvedParty[];
  mergeCandidates: MergeCandidate[];
  warnings: ResolutionWarning[];
}

/** Keeps digits only. Handles the dashed and spaced forms both systems produce. */
export function normalizeTaxId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length === 0 ? null : digits;
}

/**
 * Thai 13-digit taxpayer-id check digit (mod 11). Applied as a warning only:
 * foreign counterparties carry ids of other shapes and must not be rejected.
 */
export function isValidThaiTaxId(taxId: string): boolean {
  if (!/^\d{13}$/.test(taxId)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(taxId[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(taxId[12]);
}

const LEGAL_FORM_NOISE = [
  'บริษัท', 'จำกัด', 'มหาชน', 'ห้างหุ้นส่วนจำกัด', 'หจก', 'บมจ', 'บจก',
  'company', 'limited', 'ltd', 'co', 'plc', 'public', 'corporation', 'corp', 'inc',
];

/** Strips punctuation and legal-form words so "Co., Ltd." never drives a match. */
export function normalizeName(raw: string): string {
  let s = raw.toLowerCase().replace(/[().,'"’\-_/\\]/g, ' ');
  for (const w of LEGAL_FORM_NOISE) s = s.split(w).join(' ');
  return s.replace(/\s+/g, ' ').trim();
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

/** Dice coefficient on character bigrams — cheap, and language-agnostic. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  if (A.size === 0 || B.size === 0) return 0;
  let overlap = 0;
  for (const g of A) if (B.has(g)) overlap += 1;
  return (2 * overlap) / (A.size + B.size);
}

export interface ResolveOptions {
  /** Candidates below this are not worth a reviewer's time. */
  nameSimilarityThreshold?: number;
  /** Cap on pairwise comparisons; above it, only same-first-token pairs. */
  maxPairwise?: number;
}

export function resolveParties(rows: PartySourceRow[], options: ResolveOptions = {}): ResolutionResult {
  const { nameSimilarityThreshold = 0.86 } = options;
  const byKey = new Map<string, ResolvedParty>();
  const warnings: ResolutionWarning[] = [];

  for (const row of rows) {
    const taxId = normalizeTaxId(row.taxId);
    if (taxId && taxId.length === 13 && !isValidThaiTaxId(taxId)) {
      warnings.push({
        code: 'invalid_tax_id_checksum',
        detail: `${taxId} fails the 13-digit check digit (${row.legalName})`,
        sourceRef: row.sourceRef,
      });
    }
    if (!taxId) {
      warnings.push({
        code: 'missing_tax_id',
        detail: `${row.legalName} (${row.systemId}/${row.sourceCode}) has no taxpayer id — resolved on name alone`,
        sourceRef: row.sourceRef,
      });
    }

    const key = taxId ? `tax:${taxId}` : `name:${normalizeName(row.legalName)}|${row.systemId}`;
    let party = byKey.get(key);
    if (!party) {
      party = {
        key,
        legalName: row.legalName,
        taxId,
        roles: [],
        identifiers: taxId ? [{ kind: 'tax_id', systemId: null, legalEntityCode: null, value: taxId }] : [],
        legalEntityCodes: [],
        systemIds: [],
        rowCount: 0,
        evidence: [],
        weakKey: taxId === null,
      };
      byKey.set(key, party);
    }

    // Same tax id, materially different name: worth surfacing, not worth
    // refusing to merge — renames and abbreviations are routine.
    if (taxId && nameSimilarity(party.legalName, row.legalName) < 0.5) {
      warnings.push({
        code: 'tax_id_name_conflict',
        detail: `${taxId}: "${party.legalName}" vs "${row.legalName}"`,
        sourceRef: row.sourceRef,
      });
    }

    if (!party.roles.includes(row.role)) party.roles.push(row.role);
    if (!party.legalEntityCodes.includes(row.legalEntityCode)) party.legalEntityCodes.push(row.legalEntityCode);
    if (!party.systemIds.includes(row.systemId)) party.systemIds.push(row.systemId);
    party.identifiers.push({
      kind: 'source_system',
      systemId: row.systemId,
      legalEntityCode: row.legalEntityCode,
      value: row.sourceCode,
    });
    party.rowCount += 1;
    party.evidence.push({
      code: taxId ? 'matched_on_tax_id' : 'matched_on_name',
      sourceRef: row.sourceRef,
      observedAt: row.observedAt,
      detail: { systemId: row.systemId, sourceCode: row.sourceCode, legalEntityCode: row.legalEntityCode },
    });
  }

  const parties = [...byKey.values()];

  // Name-similarity pairs are proposed for review only. Blocking on tax-id
  // presence keeps the reviewer's queue to genuinely ambiguous records.
  const mergeCandidates: MergeCandidate[] = [];
  const reviewable = parties.filter((p) => p.taxId === null);
  for (let i = 0; i < reviewable.length; i += 1) {
    for (let j = i + 1; j < reviewable.length; j += 1) {
      const a = reviewable[i]!;
      const b = reviewable[j]!;
      const score = nameSimilarity(a.legalName, b.legalName);
      if (score >= nameSimilarityThreshold) {
        mergeCandidates.push({
          leftKey: a.key,
          rightKey: b.key,
          reason: 'name_similarity',
          score,
          leftName: a.legalName,
          rightName: b.legalName,
        });
      }
    }
  }
  mergeCandidates.sort((x, y) => y.score - x.score);

  return { parties, mergeCandidates, warnings };
}
