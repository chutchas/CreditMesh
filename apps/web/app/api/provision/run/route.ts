import { NextResponse } from 'next/server';
import {
  buildAging,
  buildLossMatrix,
  computeProvision,
  summariseProvision,
  type AgingCohort,
  type ArItem,
  type ProvisionInput,
} from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Proposes a provision, and stores the rates that produced it.
 *
 * Two things this refuses to do.
 *
 * It will not invent a loss rate. Where the history is too thin the bucket
 * comes back unrated and its balance is reported as unprovisioned rather than
 * provisioned at zero — those look identical in a total, and only one of them
 * gets an accountant's attention.
 *
 * It will not book anything. This is a proposal; the entry is made by the
 * person who signs the accounts (P5).
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    asOf?: string;
    forwardLookingPct?: number;
    specificProvisionPct?: number;
    deductCollateral?: boolean;
  };
  const asOf = body.asOf && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf) ? body.asOf : new Date().toISOString().slice(0, 10);

  // The macro overlay is a stated input, never inferred. An assistant that
  // derives a forward-looking factor from the data it holds is quietly
  // producing an economic forecast.
  const options = {
    forwardLookingPct: Number(body.forwardLookingPct ?? 0),
    specificProvisionPct: Number(body.specificProvisionPct ?? 100),
    deductCollateral: body.deductCollateral !== false,
  };

  const admin = createAdminClient();
  const tenantId = session.tenantId;
  const buckets = session.profile.creditPolicy.agingBuckets;

  const [{ data: items, error }, { data: parties }, { data: allocations }, { data: legal }] = await Promise.all([
    admin
      .from('ar_item')
      .select('id, party_id, legal_entity_code, document_no, document_date, due_date, cleared_date, amount_base, base_currency')
      .eq('tenant_id', tenantId),
    admin.from('party').select('id, legal_name').eq('tenant_id', tenantId),
    admin
      .from('collateral_allocation')
      .select('allocated, legal_entity_code, collateral:collateral_id(party_id, direction, status)')
      .eq('tenant_id', tenantId),
    admin
      .from('legal_event')
      .select('party_id, severity')
      .eq('tenant_id', tenantId)
      .eq('review_status', 'confirmed')
      .eq('severity', 'critical'),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const nameByParty = new Map(((parties ?? []) as { id: string; legal_name: string }[]).map((p) => [p.id, p.legal_name]));
  const criticalParties = new Set(((legal ?? []) as { party_id: string | null }[]).map((l) => l.party_id).filter(Boolean) as string[]);

  const securedByKey = new Map<string, number>();
  for (const a of (allocations ?? []) as unknown as {
    allocated: number;
    legal_entity_code: string;
    collateral: { party_id: string; direction: string; status: string } | null;
  }[]) {
    if (a.collateral?.direction !== 'inbound' || a.collateral.status !== 'active') continue;
    const key = `${a.collateral.party_id}|${a.legal_entity_code}`;
    securedByKey.set(key, (securedByKey.get(key) ?? 0) + Number(a.allocated));
  }

  const rows = (items ?? []) as Record<string, string | number | null>[];

  /* Loss matrix, derived from what actually happened to cleared items ---- */
  const cohorts: AgingCohort[] = [];
  const cleared = rows.filter((r) => r.cleared_date !== null);
  for (const bucket of buckets) {
    // How much sat in this bucket historically, and how much of it never came
    // back. With no write-off flag in the canonical model, an item cleared more
    // than a year after its due date stands in for a loss — and that
    // approximation is stated rather than hidden.
    const inBucket = cleared.filter((r) => {
      const dpd = Math.round((Date.parse(String(r.cleared_date)) - Date.parse(String(r.due_date))) / 86_400_000);
      return dpd >= bucket.fromDays && (bucket.toDays === null || dpd <= bucket.toDays);
    });
    if (inBucket.length === 0) continue;
    const opening = inBucket.reduce((s, r) => s + Number(r.amount_base), 0);
    const lost = inBucket
      .filter((r) => Math.round((Date.parse(String(r.cleared_date)) - Date.parse(String(r.due_date))) / 86_400_000) > 365)
      .reduce((s, r) => s + Number(r.amount_base), 0);
    cohorts.push({
      bucketCode: bucket.code,
      openingBalance: opening,
      writtenOff: lost,
      observedFrom: String(inBucket[0]!.document_date),
      observedTo: asOf,
    });
  }

  const matrix = buildLossMatrix(cohorts, { minObservationBase: 1_000_000, minCohorts: 1 });

  /* Provision per party × entity ---------------------------------------- */
  const openByKey = new Map<string, ArItem[]>();
  for (const r of rows) {
    if (r.cleared_date !== null) continue;
    const key = `${r.party_id}|${r.legal_entity_code}`;
    const bucket = openByKey.get(key) ?? [];
    const money = { amount: Number(r.amount_base), currency: String(r.base_currency) };
    bucket.push({
      id: String(r.id),
      tenantId,
      partyId: String(r.party_id),
      legalEntityCode: String(r.legal_entity_code),
      documentNo: String(r.document_no),
      documentDate: String(r.document_date),
      dueDate: String(r.due_date),
      clearedDate: null,
      amount: money,
      amountBase: money,
      isOpen: true,
      sourceRef: String(r.id),
    });
    openByKey.set(key, bucket);
  }

  const lines = [];
  for (const [key, group] of openByKey) {
    const [partyId, legalEntityCode] = key.split('|') as [string, string];
    const aging = buildAging(group, session.profile, asOf);
    const input: ProvisionInput = {
      partyId,
      partyName: nameByParty.get(partyId) ?? partyId,
      legalEntityCode,
      buckets: aging.rows.map((b) => ({ bucketCode: b.bucketCode, amount: b.amount })),
      currency: session.profile.identity.baseCurrency,
      securedAmount: securedByKey.get(key) ?? 0,
      grade: null,
      hasCriticalLegalEvent: criticalParties.has(partyId),
    };
    lines.push(computeProvision(input, matrix, options));
  }

  const summary = summariseProvision(lines, matrix);

  const { data: run, error: runError } = await admin
    .from('provision_run')
    .insert({
      tenant_id: tenantId,
      as_of: asOf,
      loss_matrix: matrix,
      options,
      gross_exposure: summary.grossExposure,
      proposed_provision: summary.proposedProvision,
      unrated_exposure: summary.unratedExposure,
      status: 'draft',
      profile_version: session.profileVersion ?? null,
      created_by: session.userId,
    })
    .select('id')
    .single();
  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 });

  if (lines.length > 0) {
    const payload = lines.map((l) => ({
      tenant_id: tenantId,
      run_id: run.id,
      party_id: l.partyId,
      legal_entity_code: l.legalEntityCode,
      currency: l.currency,
      gross_exposure: l.grossExposure,
      secured_amount: l.securedAmount,
      exposure_at_default: l.exposureAtDefault,
      base_provision: l.baseProvision,
      forward_looking_pct: l.forwardLookingPct,
      specific_provision: l.specificProvision,
      proposed_provision: l.proposedProvision,
      unrated_exposure: l.unratedExposure,
      bucket_detail: l.bucketDetail,
      notes: l.notes,
    }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error: itemError } = await admin.from('provision_item').insert(payload.slice(i, i + 500));
      if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
    }
  }

  await admin.from('audit_log').insert({
    tenant_id: tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'provision.run',
    object_type: 'provision_run',
    object_id: run.id,
    snapshot: { asOf, summary, matrix, options },
  });

  return NextResponse.json({ ok: true, runId: run.id, ...summary });
}
