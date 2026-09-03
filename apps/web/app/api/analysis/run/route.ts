import { NextResponse } from 'next/server';
import type { ArItem, FinancialStatement } from '@creditmesh/core';
import { analyseFinancials, buildAging, scoreParty, summarisePaymentBehavior } from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Recomputes the derived layer: exposure snapshots, payment behaviour and risk
 * assessments. Everything it writes is reproducible from what was imported plus
 * the profile version recorded alongside it, which is what makes an old score
 * still explainable after the weights change.
 *
 * Run on demand in R1. It becomes a scheduled job once adapters run themselves.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const admin = createAdminClient();
  const profile = session.profile;
  const baseCurrency = profile.identity.baseCurrency;
  const asOf = new Date().toISOString().slice(0, 10);
  const tenantId = session.tenantId;

  const { data: arRows, error: arError } = await admin
    .from('ar_item')
    .select('id, party_id, legal_entity_code, document_no, document_date, due_date, cleared_date, amount, currency, amount_base, source_ref')
    .eq('tenant_id', tenantId);
  if (arError) return NextResponse.json({ error: arError.message }, { status: 500 });

  const items: ArItem[] = (arRows ?? []).map((r) => ({
    id: r.id,
    tenantId,
    partyId: r.party_id,
    legalEntityCode: r.legal_entity_code,
    documentNo: r.document_no,
    documentDate: r.document_date,
    dueDate: r.due_date,
    clearedDate: r.cleared_date,
    amount: { amount: Number(r.amount), currency: r.currency },
    amountBase: { amount: Number(r.amount_base), currency: baseCurrency },
    isOpen: r.cleared_date === null,
    sourceRef: r.source_ref,
  }));

  // ---- exposure per party per entity -------------------------------------
  const { data: limitRows } = await admin
    .from('credit_limit')
    .select('party_id, legal_entity_code, limit_amount, valid_from')
    .eq('tenant_id', tenantId)
    .order('valid_from', { ascending: false });

  const limitByKey = new Map<string, number>();
  for (const l of limitRows ?? []) {
    const key = `${l.party_id}|${l.legal_entity_code}`;
    if (!limitByKey.has(key)) limitByKey.set(key, Number(l.limit_amount));
  }

  const grouped = new Map<string, ArItem[]>();
  for (const item of items) {
    const key = `${item.partyId}|${item.legalEntityCode}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }

  const snapshots = [...grouped.entries()].map(([key, group]) => {
    const [partyId, legalEntityCode] = key.split('|') as [string, string];
    // Ageing comes from the engine so the tenant's own DPD definition and
    // bucket boundaries decide the numbers, not a constant in this file.
    const aging = buildAging(group, profile, asOf);
    const limit = limitByKey.get(key) ?? null;
    // R1 has no order or delivery feed yet, so exposure is receivables only.
    // The columns exist and stay zero rather than being omitted, so the shape
    // does not change when those adapters arrive.
    const totalExposure = aging.total;
    return {
      tenant_id: tenantId,
      party_id: partyId,
      legal_entity_code: legalEntityCode,
      as_of: asOf,
      ar_open: aging.total,
      ar_overdue: aging.overdueTotal,
      open_orders: 0,
      undelivered_value: 0,
      total_exposure: totalExposure,
      credit_limit: limit,
      utilization_pct: limit && limit > 0 ? Math.round((totalExposure / limit) * 10000) / 100 : null,
      base_currency: baseCurrency,
    };
  });

  for (let i = 0; i < snapshots.length; i += 500) {
    await admin
      .from('exposure_snapshot')
      .upsert(snapshots.slice(i, i + 500), { onConflict: 'tenant_id,party_id,legal_entity_code,as_of' });
  }

  // ---- payment behaviour, trailing 12 months ------------------------------
  const periodStart = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const byParty = new Map<string, ArItem[]>();
  for (const item of items) {
    const bucket = byParty.get(item.partyId);
    if (bucket) bucket.push(item);
    else byParty.set(item.partyId, [item]);
  }

  const behaviours = [...byParty.entries()]
    .map(([partyId, group]) =>
      summarisePaymentBehavior(tenantId, partyId, group, periodStart, asOf, profile.creditPolicy.dpdDefinition),
    )
    .filter((b) => b.invoiceCount > 0)
    .map((b) => ({
      tenant_id: b.tenantId,
      party_id: b.partyId,
      period_start: b.periodStart,
      period_end: b.periodEnd,
      invoice_count: b.invoiceCount,
      weighted_avg_dpd: Math.round(b.weightedAvgDpd * 100) / 100,
      max_dpd: b.maxDpd,
      on_time_pct: Math.round(b.onTimePct * 100) / 100,
    }));

  for (let i = 0; i < behaviours.length; i += 500) {
    await admin
      .from('payment_behavior')
      .upsert(behaviours.slice(i, i + 500), { onConflict: 'tenant_id,party_id,period_start,period_end' });
  }
  const behaviourByParty = new Map(behaviours.map((b) => [b.party_id, b]));

  // ---- risk assessment ----------------------------------------------------
  const { data: parties } = await admin
    .from('party')
    .select('id')
    .eq('tenant_id', tenantId)
    .neq('status', 'merged');

  const { data: fsRows } = await admin.from('financial_statement').select('*').eq('tenant_id', tenantId);
  const fsByParty = new Map<string, FinancialStatement[]>();
  for (const r of fsRows ?? []) {
    const statement: FinancialStatement = {
      id: r.id,
      tenantId,
      partyId: r.party_id,
      fiscalYear: Number(r.fiscal_year),
      periodEnd: r.period_end ?? '',
      currency: r.currency,
      revenue: r.revenue === null ? null : Number(r.revenue),
      grossProfit: r.gross_profit === null ? null : Number(r.gross_profit),
      netProfit: r.net_profit === null ? null : Number(r.net_profit),
      totalAssets: r.total_assets === null ? null : Number(r.total_assets),
      totalLiabilities: r.total_liabilities === null ? null : Number(r.total_liabilities),
      equity: r.equity === null ? null : Number(r.equity),
      currentAssets: r.current_assets === null ? null : Number(r.current_assets),
      currentLiabilities: r.current_liabilities === null ? null : Number(r.current_liabilities),
      cash: r.cash === null ? null : Number(r.cash),
      inventory: r.inventory === null ? null : Number(r.inventory),
      receivables: r.receivables === null ? null : Number(r.receivables),
      providerId: r.provider_id,
      retrievedAt: r.retrieved_at,
    };
    const bucket = fsByParty.get(r.party_id);
    if (bucket) bucket.push(statement);
    else fsByParty.set(r.party_id, [statement]);
  }

  const assessments = (parties ?? []).map((p) => {
    const analysis = analyseFinancials(p.id, fsByParty.get(p.id) ?? [], { asOf });
    const raw = behaviourByParty.get(p.id);
    const score = scoreParty(profile, {
      analysis,
      asOf,
      paymentBehavior: raw
        ? {
            tenantId,
            partyId: p.id,
            periodStart: raw.period_start,
            periodEnd: raw.period_end,
            invoiceCount: raw.invoice_count,
            weightedAvgDpd: raw.weighted_avg_dpd,
            maxDpd: raw.max_dpd,
            onTimePct: raw.on_time_pct,
          }
        : null,
    });
    return {
      tenant_id: tenantId,
      party_id: p.id,
      as_of: asOf,
      score: score.score,
      grade: score.gradeCode ?? 'ungraded',
      components: score.components,
      evidence: score.evidence,
      flags: analysis.flags.map((f) => ({
        code: f.code,
        severity: f.severity,
        labelTh: f.labelTh,
        labelEn: f.labelEn,
      })),
      profile_version: session.profileVersion,
    };
  });

  for (let i = 0; i < assessments.length; i += 500) {
    await admin
      .from('risk_assessment')
      .upsert(assessments.slice(i, i + 500), { onConflict: 'tenant_id,party_id,as_of' });
  }

  await admin.from('audit_log').insert({
    tenant_id: tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'analysis.run',
    object_type: 'tenant',
    object_id: tenantId,
    snapshot: {
      asOf,
      profileVersion: session.profileVersion,
      exposureRows: snapshots.length,
      behaviourRows: behaviours.length,
      assessments: assessments.length,
    },
  });

  return NextResponse.json({
    asOf,
    exposureRows: snapshots.length,
    behaviourRows: behaviours.length,
    assessments: assessments.length,
  });
}
