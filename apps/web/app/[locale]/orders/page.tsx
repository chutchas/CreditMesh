import Link from 'next/link';
import type {
  AllocationRecord,
  BlockContext,
  BlockedOrder,
  CollateralRecord,
  ExposurePoint,
} from '@creditmesh/core';
import {
  computeBalances,
  computeCoverage,
  diagnoseOrderBlock,
  rankOrderBlocks,
  summariseOrderBlocks,
} from '@creditmesh/core';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatMoney, formatNumber, formatPercent } from '../../../lib/format';
import { Card, Empty, PageHeader, StatTile } from '../../../components/ui';
import DecisionPanel from './decision-panel';

/**
 * Module 11 — Order Block Cockpit.
 *
 * The screen credit officers open every morning, and the one most likely to
 * decide whether they open the product at all. It answers three questions per
 * held order — why, what would clear it, what becomes true if it goes — and
 * records the decision. It releases nothing: the ERP holds the order and the
 * ERP releases it (P5).
 *
 * Where our data does not account for a block, the card says so instead of
 * offering the nearest plausible reason. That admission is the feature; a
 * cockpit that guesses sends someone to fix the wrong thing.
 */
export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;
  const now = new Date().toISOString();
  const asOfDate = now.slice(0, 10);

  const { data: blocks } = await supabase
    .from('v_order_block_open')
    .select(
      'block_id, party_id, legal_name, legal_entity_code, order_ref, order_date, order_amount, currency, block_code, block_reason, blocked_at, ar_overdue, total_exposure, credit_limit, score, grade, last_outcome, last_decided_at',
    );

  const blockRows = (blocks ?? []) as {
    block_id: string;
    party_id: string;
    legal_name: string;
    legal_entity_code: string;
    order_ref: string;
    order_date: string | null;
    order_amount: number;
    currency: string;
    block_code: string | null;
    block_reason: string | null;
    blocked_at: string;
    ar_overdue: number | null;
    total_exposure: number | null;
    credit_limit: number | null;
    score: number | null;
    grade: string | null;
    last_outcome: string | null;
    last_decided_at: string | null;
  }[];

  if (blockRows.length === 0) {
    return (
      <>
        <PageHeader title={t.orders.title} subtitle={t.orders.subtitle} />
        <Empty title={t.orders.noData} hint={t.orders.noDataHint} />
      </>
    );
  }

  const partyIds = [...new Set(blockRows.map((b) => b.party_id))];

  const [{ data: instruments }, { data: allocations }, { data: exposures }, { data: limits }, { data: groups }] =
    await Promise.all([
      supabase
        .from('collateral')
        .select(
          'id, party_id, type, direction, reference, issuer, amount, currency, effective_date, expiry_date, claim_deadline, status',
        )
        .in('party_id', partyIds),
      supabase.from('collateral_allocation').select('collateral_id, legal_entity_code, allocated, utilized, valid_from, valid_to'),
      supabase.from('v_exposure_current').select('party_id, legal_entity_code, total_exposure'),
      supabase.from('credit_limit').select('party_id, legal_entity_code, valid_to').in('party_id', partyIds),
      supabase.from('v_group_exposure').select('group_id, total_exposure, max_single_limit'),
    ]);

  /* Collateral, reused from Module 3 rather than recomputed differently here.
     Two screens that disagree about how much a guarantee covers is the failure
     mode this whole ledger exists to prevent. */
  const collaterals: CollateralRecord[] = ((instruments ?? []) as Record<string, string | number | null>[]).map((r) => ({
    id: String(r.id),
    partyId: String(r.party_id),
    partyName: '',
    type: r.type as CollateralRecord['type'],
    direction: r.direction as CollateralRecord['direction'],
    reference: String(r.reference),
    issuer: r.issuer === null ? null : String(r.issuer),
    amount: Number(r.amount),
    currency: String(r.currency),
    effectiveDate: String(r.effective_date),
    expiryDate: r.expiry_date === null ? null : String(r.expiry_date),
    claimDeadline: r.claim_deadline === null ? null : String(r.claim_deadline),
    status: r.status as CollateralRecord['status'],
  }));

  const allocationRecords: AllocationRecord[] = (allocations ?? []).map((a) => ({
    collateralId: a.collateral_id,
    legalEntityCode: a.legal_entity_code,
    allocated: Number(a.allocated),
    utilized: Number(a.utilized),
    validFrom: a.valid_from,
    validTo: a.valid_to,
  }));

  const exposurePoints: ExposurePoint[] = (exposures ?? []).map((e) => ({
    partyId: e.party_id,
    legalEntityCode: e.legal_entity_code,
    exposure: Number(e.total_exposure ?? 0),
  }));

  const balances = computeBalances(collaterals, allocationRecords, { asOf: asOfDate });
  const coverage = computeCoverage(exposurePoints, balances, new Map());
  const coverageByKey = new Map(coverage.map((c) => [`${c.partyId}|${c.legalEntityCode}`, c]));

  // Unallocated inbound value on effective instruments: what could still be
  // pointed at this order without asking the counterparty for anything new.
  const availableByParty = new Map<string, number>();
  const expiredByParty = new Map<string, number>();
  for (const balance of balances) {
    if (balance.collateral.direction !== 'inbound') continue;
    const partyId = balance.collateral.partyId;
    if (balance.isEffective) {
      availableByParty.set(partyId, (availableByParty.get(partyId) ?? 0) + Math.max(0, balance.unallocated));
    } else if (balance.collateral.status === 'active') {
      expiredByParty.set(partyId, (expiredByParty.get(partyId) ?? 0) + balance.collateral.amount);
    }
  }

  const limitValidTo = new Map(
    (limits ?? []).map((l) => [`${l.party_id}|${l.legal_entity_code}`, l.valid_to as string | null]),
  );

  // Group context is only attached where the party is in a confirmed group.
  const { data: memberships } = await supabase
    .from('party_group_member')
    .select('party_id, group_id, group:group_id(status)')
    .in('party_id', partyIds);
  const groupById = new Map((groups ?? []).map((g) => [g.group_id as string, g]));
  const groupByParty = new Map<string, { total_exposure: number | null; max_single_limit: number | null }>();
  for (const m of (memberships ?? []) as unknown as {
    party_id: string;
    group_id: string;
    group: { status?: string } | null;
  }[]) {
    if (m.group?.status !== 'confirmed') continue;
    const g = groupById.get(m.group_id);
    if (g) groupByParty.set(m.party_id, g as { total_exposure: number | null; max_single_limit: number | null });
  }

  const grades = [...session.profile.creditPolicy.riskGrades].sort((a, b) => a.minScore - b.minScore);
  const policy = { worstGradeCode: grades[0]?.code ?? null, ageAlertDays: 7 };

  const diagnoses = blockRows.map((b) => {
    const order: BlockedOrder = {
      blockId: b.block_id,
      orderRef: b.order_ref,
      partyId: b.party_id,
      partyName: b.legal_name,
      legalEntityCode: b.legal_entity_code,
      orderAmount: Number(b.order_amount),
      currency: b.currency,
      orderDate: b.order_date,
      blockedAt: b.blocked_at,
      blockCode: b.block_code,
      blockReason: b.block_reason,
    };
    const key = `${b.party_id}|${b.legal_entity_code}`;
    const group = groupByParty.get(b.party_id);
    const ctx: BlockContext = {
      exposure: Number(b.total_exposure ?? 0),
      creditLimit: b.credit_limit === null ? null : Number(b.credit_limit),
      limitValidTo: limitValidTo.get(key) ?? null,
      arOverdue: Number(b.ar_overdue ?? 0),
      maxOpenDpd: null,
      collateralAvailable: availableByParty.get(b.party_id) ?? 0,
      collateralExpired: expiredByParty.get(b.party_id) ?? 0,
      uncoveredExposure: coverageByKey.get(key)?.uncovered ?? 0,
      grade: b.grade,
      score: b.score === null ? null : Number(b.score),
      groupExposure: group?.total_exposure === undefined ? null : Number(group.total_exposure ?? 0),
      groupMaxSingleLimit:
        group?.max_single_limit === undefined || group.max_single_limit === null
          ? null
          : Number(group.max_single_limit),
    };
    return diagnoseOrderBlock(order, ctx, policy, now);
  });

  const ranked = rankOrderBlocks(diagnoses);
  const summary = summariseOrderBlocks(diagnoses, policy);
  const writable = canWrite(session);

  const causeLabel = (code: string) => t.orderCauses[code as keyof typeof t.orderCauses] ?? code;
  const remedyLabel = (code: string) => t.orderRemedies[code as keyof typeof t.orderRemedies] ?? code;
  const outcomeLabels = {
    recommend_release: t.orders.outcomeRecommendRelease,
    hold: t.orders.outcomeHold,
    partial: t.orders.outcomePartial,
    escalate: t.orders.outcomeEscalate,
    reject: t.orders.outcomeReject,
  };

  const severityTone = (severity: string) =>
    severity === 'critical'
      ? 'bg-[#fef3f2] text-[#b42318]'
      : severity === 'warning'
        ? 'bg-[#fffaeb] text-[#b54708]'
        : 'bg-[var(--color-canvas)] text-[var(--color-muted)]';

  return (
    <>
      <PageHeader title={t.orders.title} subtitle={t.orders.subtitle} />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.orders.readOnlyNote}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label={t.orders.blockedCount} value={String(summary.blockedCount)} />
        <StatTile
          label={t.orders.blockedValue}
          value={formatMoney(summary.blockedValue, currency, locale, { compact: true })}
        />
        <StatTile
          label={t.orders.clearableByCollection}
          value={formatMoney(summary.clearableByCollection, currency, locale, { compact: true })}
          tone={summary.clearableByCollection > 0 ? 'warn' : undefined}
        />
        <StatTile
          label={t.orders.aged}
          value={`${summary.agedCount} / ${summary.oldestDaysBlocked}${t.orders.daysShort}`}
          tone={summary.agedCount > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label={t.orders.unexplained}
          value={String(summary.unexplainedCount)}
          tone={summary.unexplainedCount > 0 ? 'warn' : 'good'}
        />
      </div>

      {summary.unexplainedCount > 0 ? (
        <p className="mt-3 rounded border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-xs text-[#b54708]">
          {t.orders.unexplainedNote}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        {ranked.map((d) => (
          <Card key={d.order.blockId}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="tabular font-semibold">{d.order.orderRef}</span>
                  <span className="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--color-muted)]">
                    {d.order.legalEntityCode}
                  </span>
                  {d.daysBlocked >= policy.ageAlertDays ? (
                    <span className="rounded bg-[#fef3f2] px-1.5 py-0.5 text-[11px] font-semibold text-[#b42318]">
                      {d.daysBlocked}
                      {t.orders.daysShort}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--color-muted)]">
                      {d.daysBlocked}
                      {t.orders.daysShort}
                    </span>
                  )}
                </div>
                <Link
                  href={`/${locale}/parties/${d.order.partyId}`}
                  className="text-sm font-medium text-[var(--color-brand)]"
                >
                  {d.order.partyName}
                </Link>
                <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                  {formatDate(d.order.orderDate, locale)} · {t.orders.blockedOn} {formatDate(d.order.blockedAt, locale)}
                  {d.order.blockCode ? ` · ${d.order.blockCode}` : ''}
                </div>
                {d.order.blockReason ? (
                  <div className="mt-0.5 text-[11px] italic text-[var(--color-muted)]">
                    {t.orders.sourceSays} “{d.order.blockReason}”
                  </div>
                ) : null}
              </div>
              <div className="text-right">
                <div className="tabular text-lg font-semibold">
                  {formatMoney(d.order.orderAmount, d.order.currency, locale, { compact: true })}
                </div>
                <div className="text-[11px] text-[var(--color-muted)]">{t.orders.orderValue}</div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              {/* Why */}
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  {t.orders.why}
                </div>
                <div className="space-y-1.5">
                  {d.causes.map((c) => (
                    <div key={c.code} className={`rounded px-2 py-1.5 text-xs ${severityTone(c.severity)}`}>
                      <div className="font-medium">{causeLabel(c.code)}</div>
                      <div className="tabular mt-0.5 text-[11px] opacity-80">
                        {Object.entries(c.detail)
                          .filter(([, v]) => v !== null && v !== '')
                          .map(([k, v]) =>
                            typeof v === 'number'
                              ? `${t.orderDetail[k as keyof typeof t.orderDetail] ?? k}: ${
                                  k.endsWith('Dpd') || k.endsWith('Pct') || k === 'score'
                                    ? formatNumber(v, locale, 0)
                                    : formatMoney(v, currency, locale, { compact: true })
                                }`
                              : `${t.orderDetail[k as keyof typeof t.orderDetail] ?? k}: ${v}`,
                          )
                          .join(' · ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* What would clear it */}
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  {t.orders.remedies}
                </div>
                <div className="space-y-1.5">
                  {d.remedies.map((r) => (
                    <div
                      key={r.code}
                      className="flex items-baseline justify-between gap-2 rounded border border-[var(--color-line)] px-2 py-1.5 text-xs"
                    >
                      <span>{remedyLabel(r.code)}</span>
                      {r.amount === null ? null : (
                        <span className="tabular font-medium">
                          {formatMoney(r.amount, currency, locale, { compact: true })}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* What becomes true */}
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  {t.orders.impact}
                </div>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--color-muted)]">{t.orders.exposureAfter}</dt>
                    <dd className="tabular">
                      {formatMoney(d.impact.exposureBefore, currency, locale, { compact: true })} →{' '}
                      <span className="font-medium">
                        {formatMoney(d.impact.exposureAfter, currency, locale, { compact: true })}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--color-muted)]">{t.orders.headroomAfter}</dt>
                    <dd
                      className={`tabular ${d.impact.headroomAfter !== null && d.impact.headroomAfter < 0 ? 'font-semibold text-[#b42318]' : ''}`}
                    >
                      {d.impact.headroomAfter === null
                        ? t.orders.noLimit
                        : formatMoney(d.impact.headroomAfter, currency, locale, { compact: true })}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--color-muted)]">{t.orders.utilizationAfter}</dt>
                    <dd className="tabular">
                      {d.impact.utilizationAfterPct === null
                        ? '—'
                        : formatPercent(d.impact.utilizationAfterPct, locale, 0)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--color-muted)]">{t.orders.uncoveredAfter}</dt>
                    <dd className="tabular">
                      {formatMoney(d.impact.uncoveredAfter, currency, locale, { compact: true })}
                    </dd>
                  </div>
                  {d.impact.groupExposureAfter === null ? null : (
                    <div className="flex justify-between gap-2">
                      <dt className="text-[var(--color-muted)]">{t.orders.groupExposureAfter}</dt>
                      <dd className="tabular">
                        {formatMoney(d.impact.groupExposureAfter, currency, locale, { compact: true })}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] pt-2.5">
              <div className="text-[11px] text-[var(--color-muted)]">
                {blockRows.find((b) => b.block_id === d.order.blockId)?.last_outcome
                  ? `${t.orders.lastDecision}: ${
                      outcomeLabels[
                        blockRows.find((b) => b.block_id === d.order.blockId)!
                          .last_outcome as keyof typeof outcomeLabels
                      ] ?? ''
                    } · ${formatDate(
                      blockRows.find((b) => b.block_id === d.order.blockId)!.last_decided_at,
                      locale,
                    )}`
                  : t.orders.noDecisionYet}
              </div>
              {writable ? (
                <DecisionPanel
                  blockId={d.order.blockId}
                  evidence={{ causes: d.causes, remedies: d.remedies, impact: d.impact, daysBlocked: d.daysBlocked }}
                  labels={{
                    decide: t.orders.decide,
                    reason: t.orders.reason,
                    reasonPlaceholder: t.orders.reasonPlaceholder,
                    saving: t.orders.saving,
                    saved: t.orders.saved,
                    reasonRequired: t.orders.reasonRequired,
                    outcomes: outcomeLabels,
                  }}
                />
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-3 text-xs text-[var(--color-muted)]">{t.orders.priorityNote}</p>
    </>
  );
}
