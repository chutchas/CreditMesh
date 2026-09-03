import { NextResponse } from 'next/server';
import {
  assessExceptionSignals,
  normaliseCollateralCoverage,
  normaliseCollectionOutcome,
  normaliseGroupExposure,
  normaliseLegal,
  normalisePaymentException,
  promiseKeptRate,
  scoreRiskIndex,
  type ComponentInput,
  type PaymentException,
} from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Recomputes the risk index for every counterparty.
 *
 * Each component is fed from its own module, or fed nothing at all. Nothing
 * here invents a value to fill a gap: a component with no data arrives as null
 * and the tenant's `absenceRule` decides what that means — dropped, treated as
 * the worst case, or blocking the score entirely.
 *
 * The R1 bug this guards against: a counterparty with no cleared payments
 * scored well because the payment component was dropped and its weight
 * redistributed onto an old balance sheet, while its entire balance sat past
 * due. Redistribution is now a per-component decision the tenant makes, never
 * a default.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const admin = createAdminClient();
  const asOf = new Date().toISOString().slice(0, 10);
  const policy = session.profile.riskIndex;
  const tenantId = session.tenantId;

  const [
    { data: parties },
    { data: legacy },
    { data: legal },
    { data: exceptions },
    { data: coverage },
    { data: groupExposure },
    { data: memberships },
    { data: promises },
    { data: cases },
  ] = await Promise.all([
    admin.from('party').select('id, legal_name').eq('tenant_id', tenantId).neq('status', 'merged'),
    // The R1 assessment carries the financial, payment-behaviour and
    // delinquency components already; the index reuses them rather than
    // recomputing them differently and producing a second opinion.
    admin.from('v_risk_current').select('party_id, score, components, as_of').eq('tenant_id', tenantId),
    admin
      .from('legal_event')
      .select('party_id, severity')
      .eq('tenant_id', tenantId)
      .eq('review_status', 'confirmed'),
    admin
      .from('payment_exception')
      .select('id, party_id, legal_entity_code, type, amount, currency, occurred_at, status, source')
      .eq('tenant_id', tenantId),
    admin.from('v_exposure_current').select('party_id, total_exposure').eq('tenant_id', tenantId),
    admin.from('v_group_exposure').select('group_id, total_exposure, max_single_limit').eq('tenant_id', tenantId),
    admin.from('party_group_member').select('party_id, group_id, group:group_id(status)').eq('tenant_id', tenantId),
    admin.from('promise_to_pay').select('party_id, amount, promised_date, status').eq('tenant_id', tenantId),
    admin.from('collection_case').select('id, party_id').eq('tenant_id', tenantId),
  ]);

  const partyRows = (parties ?? []) as { id: string; legal_name: string }[];
  if (partyRows.length === 0) return NextResponse.json({ ok: true, scored: 0 });

  /* Existing R1 components, keyed by party ---------------------------- */
  const legacyByParty = new Map<string, Record<string, number>>();
  for (const r of (legacy ?? []) as { party_id: string; components: unknown }[]) {
    const map: Record<string, number> = {};
    for (const c of (r.components as { code?: string; normalized?: number }[] | null) ?? []) {
      if (c.code && typeof c.normalized === 'number') map[c.code] = c.normalized;
    }
    legacyByParty.set(r.party_id, map);
  }

  /* Legal ------------------------------------------------------------- */
  const legalByParty = new Map<string, { severity: string }[]>();
  for (const e of (legal ?? []) as { party_id: string | null; severity: string }[]) {
    if (!e.party_id) continue;
    const bucket = legalByParty.get(e.party_id) ?? [];
    bucket.push({ severity: e.severity });
    legalByParty.set(e.party_id, bucket);
  }

  /* Payment exceptions → signals -------------------------------------- */
  const exceptionRecords: PaymentException[] = ((exceptions ?? []) as Record<string, unknown>[]).map((e) => ({
    exceptionId: String(e.id),
    partyId: e.party_id === null ? null : String(e.party_id),
    partyName: null,
    legalEntityCode: String(e.legal_entity_code),
    type: e.type as PaymentException['type'],
    amount: Number(e.amount),
    currency: String(e.currency),
    occurredAt: String(e.occurred_at),
    reasonCode: null,
    reasonText: null,
    reference: null,
    status: e.status as PaymentException['status'],
    resolvedAt: null,
    source: String(e.source),
  }));
  const signals = assessExceptionSignals(exceptionRecords, session.profile.paymentPolicy, asOf);
  const signalsByParty = new Map<string, { code: string; severity: string }[]>();
  for (const s of signals) {
    const bucket = signalsByParty.get(s.partyId) ?? [];
    bucket.push({ code: s.code, severity: s.severity });
    signalsByParty.set(s.partyId, bucket);
  }

  /* Collateral coverage ----------------------------------------------- */
  const exposureByParty = new Map<string, number>();
  for (const e of (coverage ?? []) as { party_id: string; total_exposure: number | null }[]) {
    exposureByParty.set(e.party_id, (exposureByParty.get(e.party_id) ?? 0) + Number(e.total_exposure ?? 0));
  }
  const { data: allocations } = await admin
    .from('collateral_allocation')
    .select('allocated, collateral:collateral_id(party_id, direction, status)')
    .eq('tenant_id', tenantId);
  const securedByParty = new Map<string, number>();
  for (const a of (allocations ?? []) as unknown as {
    allocated: number;
    collateral: { party_id: string; direction: string; status: string } | null;
  }[]) {
    const c = a.collateral;
    if (!c || c.direction !== 'inbound' || c.status !== 'active') continue;
    securedByParty.set(c.party_id, (securedByParty.get(c.party_id) ?? 0) + Number(a.allocated));
  }

  /* Group exposure ----------------------------------------------------- */
  const groupById = new Map(
    ((groupExposure ?? []) as { group_id: string; total_exposure: number | null; max_single_limit: number | null }[]).map(
      (g) => [g.group_id, g],
    ),
  );
  const groupByParty = new Map<string, { total_exposure: number | null; max_single_limit: number | null }>();
  for (const m of (memberships ?? []) as unknown as {
    party_id: string;
    group_id: string;
    group: { status?: string } | null;
  }[]) {
    // Only confirmed groups. An unconfirmed proposal must never move a score.
    if (m.group?.status !== 'confirmed') continue;
    const g = groupById.get(m.group_id);
    if (g) groupByParty.set(m.party_id, g);
  }

  /* Collection outcome -------------------------------------------------- */
  const promisesByParty = new Map<string, { amount: number; promisedDate: string; status: 'open' | 'kept' | 'broken' | 'cancelled' }[]>();
  for (const p of (promises ?? []) as { party_id: string; amount: number; promised_date: string; status: string }[]) {
    const bucket = promisesByParty.get(p.party_id) ?? [];
    bucket.push({ amount: Number(p.amount), promisedDate: p.promised_date, status: p.status as 'open' });
    promisesByParty.set(p.party_id, bucket);
  }
  const hasCase = new Set(((cases ?? []) as { party_id: string }[]).map((c) => c.party_id));

  /* Score ------------------------------------------------------------- */
  let scored = 0;
  let blocked = 0;

  for (const party of partyRows) {
    const legacyComponents = legacyByParty.get(party.id) ?? {};
    const exposure = exposureByParty.get(party.id) ?? 0;
    const secured = securedByParty.get(party.id) ?? 0;
    const group = groupByParty.get(party.id);
    const partyPromises = promisesByParty.get(party.id) ?? [];
    const keptRate = hasCase.has(party.id) ? promiseKeptRate(partyPromises).ratePct : null;

    const inputs: ComponentInput[] = [
      {
        code: 'financial',
        value: legacyComponents.profitability === undefined ? null : legacyComponents.profitability,
        evidence: [],
        note: legacyComponents.profitability === undefined ? 'no financial statements on file' : null,
      },
      {
        code: 'payment_behavior',
        value: legacyComponents.payment_behavior ?? null,
        evidence: [],
        note: legacyComponents.payment_behavior === undefined ? 'no cleared invoices on record' : null,
      },
      {
        code: 'delinquency',
        value: legacyComponents.delinquency ?? null,
        evidence: [],
        note: null,
      },
      {
        code: 'collateral_coverage',
        value: normaliseCollateralCoverage(exposure > 0 ? (secured / exposure) * 100 : null),
        evidence: [],
        note: exposure > 0 ? null : 'no exposure to cover',
      },
      {
        code: 'payment_exception',
        value: normalisePaymentException(signalsByParty.get(party.id) ?? []),
        evidence: [],
        note: null,
      },
      {
        code: 'collection_outcome',
        value: normaliseCollectionOutcome(keptRate),
        evidence: [],
        note: keptRate === null ? 'no settled promises to pay' : null,
      },
      {
        code: 'group_exposure',
        value: normaliseGroupExposure(
          group?.total_exposure === undefined || group.total_exposure === null ? null : Number(group.total_exposure),
          group?.max_single_limit === undefined || group.max_single_limit === null ? null : Number(group.max_single_limit),
        ),
        evidence: [],
        note: group ? null : 'not in a confirmed group',
      },
      {
        code: 'legal',
        value: legalByParty.has(party.id) ? normaliseLegal(legalByParty.get(party.id)!) : null,
        evidence: [],
        note: legalByParty.has(party.id) ? null : 'no confirmed legal events',
      },
      { code: 'company_change', value: null, evidence: [], note: 'registry change tracking not yet enabled' },
    ];

    const result = scoreRiskIndex(party.id, inputs, policy, session.profile.creditPolicy.riskGrades, asOf);
    if (result.blockedBy) blocked += 1;
    else scored += 1;

    const { data: index, error } = await admin
      .from('risk_index')
      .upsert(
        {
          tenant_id: tenantId,
          party_id: party.id,
          as_of: asOf,
          score: result.score,
          grade: result.grade,
          blocked_by: result.blockedBy,
          components_scored: result.availability.scored,
          components_enabled: result.availability.enabled,
          incomplete: result.incomplete,
          recommended_action: result.recommendedAction,
          profile_version: session.profileVersion ?? null,
          computed_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,party_id,as_of' },
      )
      .select('id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const componentPayload = result.components.map((c) => ({
      tenant_id: tenantId,
      risk_index_id: index.id,
      code: c.code,
      weight: c.weight,
      effective_weight: c.effectiveWeight,
      value: c.value,
      available: c.available,
      absence_rule: c.absenceRule,
      contribution: c.contribution,
      note: c.note,
      evidence: c.evidence,
    }));
    const { error: componentError } = await admin
      .from('risk_index_component')
      .upsert(componentPayload, { onConflict: 'tenant_id,risk_index_id,code' });
    if (componentError) return NextResponse.json({ error: componentError.message }, { status: 500 });
  }

  await admin.from('audit_log').insert({
    tenant_id: tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'risk_index.run',
    object_type: 'risk_index',
    object_id: asOf,
    snapshot: { scored, blocked, profileVersion: session.profileVersion ?? null },
  });

  return NextResponse.json({ ok: true, scored, blocked });
}
