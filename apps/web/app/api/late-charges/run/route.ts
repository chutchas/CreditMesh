import { NextResponse } from 'next/server';
import { runLateCharges, type ChargeableItem } from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Computes a late-charge run and stores every input behind every number.
 *
 * The run records the profile version and a snapshot of the policy it used.
 * §7 makes the acceptance test "recompute three months and reconcile against
 * what was billed", and that test is impossible unless each run remembers the
 * rules it ran under. A run that only stores amounts is unreconcilable the
 * moment somebody edits a rate.
 *
 * `asOf` is a parameter so a past period can be recomputed. The rate used is
 * the rate in force on the day the lateness began, never today's.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const { asOf } = (await request.json().catch(() => ({}))) as { asOf?: string };
  const runDate = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : new Date().toISOString().slice(0, 10);

  const admin = createAdminClient();
  const policy = session.profile.lateChargePolicy;

  const [{ data: items, error }, { data: risk }] = await Promise.all([
    admin
      .from('ar_item')
      .select('id, party_id, legal_entity_code, document_no, document_date, due_date, cleared_date, amount_base, base_currency, party:party_id(legal_name)')
      .eq('tenant_id', session.tenantId)
      .lte('due_date', runDate),
    admin.from('v_risk_current').select('party_id, grade').eq('tenant_id', session.tenantId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const gradeByParty = new Map((risk ?? []).map((r) => [r.party_id as string, r.grade as string | null]));

  const chargeable: ChargeableItem[] = ((items ?? []) as unknown as Record<string, unknown>[]).map((i) => ({
    arItemId: String(i.id),
    partyId: String(i.party_id),
    partyName: (i.party as { legal_name?: string } | null)?.legal_name ?? String(i.party_id),
    legalEntityCode: String(i.legal_entity_code),
    documentNo: String(i.document_no),
    documentDate: String(i.document_date),
    dueDate: String(i.due_date),
    clearedDate: i.cleared_date === null ? null : String(i.cleared_date),
    amount: Number(i.amount_base),
    currency: String(i.base_currency),
    segment: null,
    gradeCode: gradeByParty.get(String(i.party_id)) ?? null,
  }));

  const result = runLateCharges(chargeable, policy, runDate);

  const { data: run, error: runError } = await admin
    .from('late_charge_run')
    .insert({
      tenant_id: session.tenantId,
      as_of: runDate,
      profile_version: session.profileVersion ?? null,
      policy_snapshot: result.policySnapshot,
      item_count: result.lines.length,
      total_amount: result.total,
      status: 'draft',
      created_by: session.userId,
    })
    .select('id')
    .single();
  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 });

  if (result.lines.length > 0) {
    const payload = result.lines.map((l) => ({
      tenant_id: session.tenantId,
      run_id: run.id,
      party_id: l.item.partyId,
      legal_entity_code: l.item.legalEntityCode,
      ar_item_id: l.item.arItemId,
      document_no: l.item.documentNo,
      principal: l.principal,
      annual_rate_pct: l.annualRatePct,
      rate_effective_from: l.rateEffectiveFrom,
      day_count: l.dayCount,
      charge_from: l.chargeFrom,
      charge_to: l.chargeTo,
      late_days: l.lateDays,
      grace_days: l.gracePeriodDays,
      raw_amount: l.rawAmount,
      charge_amount: l.chargeAmount,
      currency: l.currency,
      status: 'proposed',
    }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error: itemError } = await admin.from('late_charge_item').insert(payload.slice(i, i + 500));
      if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 });
    }
  }

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'late_charge.run',
    object_type: 'late_charge_run',
    object_id: run.id,
    snapshot: {
      asOf: runDate,
      itemCount: result.lines.length,
      total: result.total,
      skipped: result.skipped.length,
      policySnapshot: result.policySnapshot,
    },
  });

  return NextResponse.json({
    ok: true,
    runId: run.id,
    itemCount: result.lines.length,
    total: result.total,
    skipped: result.skipped.length,
  });
}
