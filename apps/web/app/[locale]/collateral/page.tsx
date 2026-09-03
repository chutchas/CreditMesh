import Link from 'next/link';
import type { AllocationRecord, CollateralRecord, ExposurePoint } from '@creditmesh/core';
import { buildExpiryAlerts, computeBalances, computeCoverage, summariseCollateral } from '@creditmesh/core';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatMoney, formatPercent } from '../../../lib/format';
import { Card, Empty, PageHeader, StatTile, Table } from '../../../components/ui';

/**
 * Module 3, first phase — the register, read only.
 *
 * §7 is unusually prescriptive about how this one is introduced, and for a
 * reason that is not technical: the hard part is agreeing who has first claim
 * on a guarantee, and a system that arrives with an answer gets rejected before
 * anyone looks at the numbers. So this screen shows what is already true and
 * changes nothing. The workflow comes after every entity agrees on the figures.
 */
export default async function CollateralPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;
  const asOf = new Date().toISOString().slice(0, 10);

  const [{ data: instruments }, { data: allocations }, { data: exposures }, { data: parties }] = await Promise.all([
    supabase
      .from('collateral')
      .select('id, party_id, type, direction, reference, issuer, amount, currency, effective_date, expiry_date, claim_deadline, status, party:party_id(legal_name)'),
    supabase
      .from('collateral_allocation')
      .select('collateral_id, legal_entity_code, allocated, utilized, valid_from, valid_to'),
    supabase.from('v_exposure_current').select('party_id, legal_entity_code, total_exposure'),
    supabase.from('party').select('id, legal_name'),
  ]);

  const rows = (instruments ?? []) as unknown as {
    id: string;
    party_id: string;
    type: string;
    direction: string;
    reference: string;
    issuer: string | null;
    amount: number;
    currency: string;
    effective_date: string;
    expiry_date: string | null;
    claim_deadline: string | null;
    status: string;
    party: { legal_name: string } | null;
  }[];

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title={t.collateral.title} subtitle={t.collateral.subtitle} />
        <Empty title={t.collateral.noData} hint={t.collateral.noDataHint} />
      </>
    );
  }

  const collaterals: CollateralRecord[] = rows.map((r) => ({
    id: r.id,
    partyId: r.party_id,
    partyName: r.party?.legal_name ?? r.party_id,
    type: r.type as CollateralRecord['type'],
    direction: r.direction as CollateralRecord['direction'],
    reference: r.reference,
    issuer: r.issuer,
    amount: Number(r.amount),
    currency: r.currency,
    effectiveDate: r.effective_date,
    expiryDate: r.expiry_date,
    claimDeadline: r.claim_deadline,
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
    exposure: Number(e.total_exposure),
  }));

  const partyNames = new Map((parties ?? []).map((p) => [p.id as string, p.legal_name as string]));

  const balances = computeBalances(collaterals, allocationRecords, {
    asOf,
    allowOverAllocation: session.profile.collateralPolicy.allowOverAllocation,
  });
  const alerts = buildExpiryAlerts(balances, session.profile, asOf);
  const coverage = computeCoverage(exposurePoints, balances, partyNames);
  const summary = summariseCollateral(balances, coverage, currency, asOf);

  const warningLabel = (code: string): string => {
    switch (code) {
      case 'over_allocated':
        return t.collateral.overAllocated;
      case 'claim_window_closed':
        return t.collateral.claimWindowClosed;
      case 'expired_but_active':
        return t.collateral.expiredButActive;
      case 'idle_allocation':
        return t.collateral.idleAllocation;
      case 'unallocated':
        return t.collateral.unallocatedWarn;
      default:
        return code;
    }
  };

  const warningTone = (severity: string): string =>
    severity === 'critical'
      ? 'bg-[#b42318] text-white'
      : severity === 'high'
        ? 'bg-[#fef0c7] text-[#b54708]'
        : 'bg-[#eaecf0] text-[#475467]';

  return (
    <>
      <PageHeader title={t.collateral.title} subtitle={t.collateral.subtitle} />

      <p className="mb-4 rounded border border-[var(--color-line)] bg-white px-3 py-2 text-xs text-[var(--color-muted)]">
        {t.collateral.readOnlyNote}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t.collateral.held}
          value={formatMoney(summary.totalValue, currency, locale, { compact: true })}
          hint={`${summary.instrumentCount} ${t.collateral.instruments}`}
        />
        <StatTile
          label={t.collateral.utilization}
          value={formatPercent(summary.utilizationPct, locale, 0)}
          hint={`${t.collateral.allocation} ${formatPercent(summary.allocationPct, locale, 0)}`}
        />
        <StatTile
          label={t.collateral.idle}
          value={formatMoney(summary.idleTotal, currency, locale, { compact: true })}
          tone={summary.idleTotal > 0 ? 'warn' : 'neutral'}
        />
        <StatTile
          label={t.collateral.uncoveredExposure}
          value={formatMoney(summary.uncoveredExposure, currency, locale, { compact: true })}
          tone={summary.uncoveredExposure > 0 ? 'bad' : 'good'}
          hint={`${t.collateral.coveredExposure} ${formatMoney(summary.coveredExposure, currency, locale, { compact: true })}`}
        />
      </div>

      <div className="mt-4 grid gap-4">
        <Card title={t.collateral.register} footer={t.collateral.outboundExcluded}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.collateral.reference}</th>
                <th className="py-2 pr-3 font-medium">{t.collateral.party}</th>
                <th className="py-2 pr-3 font-medium">{t.collateral.type}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.collateral.faceValue}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.collateral.allocated}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.collateral.utilized}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.collateral.unallocated}</th>
                <th className="py-2 pr-3 font-medium">{t.collateral.expiry}</th>
                <th className="py-2 font-medium">{t.collateral.warnings}</th>
              </tr>
            }
          >
            {balances.map((balance) => (
              <tr key={balance.collateral.id} className="border-b border-[var(--color-line)] align-top last:border-0">
                <td className="tabular py-2 pr-3 font-medium">
                  {balance.collateral.reference}
                  <div className="text-[11px] font-normal text-[var(--color-muted)]">
                    {balance.collateral.issuer ?? '—'}
                    {balance.collateral.direction === 'outbound' ? ' · outbound' : ''}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <Link href={`/${locale}/parties/${balance.collateral.partyId}`} className="text-[var(--color-brand)]">
                    {balance.collateral.partyName}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-xs">{balance.collateral.type}</td>
                <td className="tabular py-2 pr-3 text-right">
                  {formatMoney(balance.collateral.amount, balance.collateral.currency, locale, { compact: true })}
                </td>
                <td className={`tabular py-2 pr-3 text-right ${balance.isOverAllocated ? 'font-semibold text-[#b42318]' : ''}`}>
                  {formatMoney(balance.allocatedTotal, balance.collateral.currency, locale, { compact: true })}
                  <div className="text-[11px] font-normal text-[var(--color-muted)]">
                    {formatPercent(balance.allocatedPct, locale, 0)}
                  </div>
                </td>
                <td className="tabular py-2 pr-3 text-right">
                  {formatMoney(balance.utilizedTotal, balance.collateral.currency, locale, { compact: true })}
                </td>
                <td className="tabular py-2 pr-3 text-right">
                  {balance.unallocated < 0 ? (
                    <>
                      {formatMoney(0, balance.collateral.currency, locale, { compact: true })}
                      <div className="text-[11px] font-normal text-[#b42318]">
                        {t.collateral.overBy}{' '}
                        {formatMoney(
                          -balance.unallocated,
                          balance.collateral.currency,
                          locale,
                          { compact: true },
                        )}
                      </div>
                    </>
                  ) : (
                    formatMoney(balance.unallocated, balance.collateral.currency, locale, { compact: true })
                  )}
                </td>
                <td className="py-2 pr-3 text-xs">
                  {formatDate(balance.collateral.expiryDate, locale)}
                  {balance.collateral.claimDeadline ? (
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {t.collateral.claimDeadline} {formatDate(balance.collateral.claimDeadline, locale)}
                    </div>
                  ) : null}
                </td>
                <td className="py-2">
                  <div className="flex max-w-56 flex-wrap gap-1">
                    {balance.warnings.map((w) => (
                      <span key={w.code} className={`rounded px-1.5 py-0.5 text-[11px] ${warningTone(w.severity)}`}>
                        {warningLabel(w.code)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t.collateral.expiring}>
            {alerts.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{t.collateral.noAlerts}</p>
            ) : (
              <Table
                head={
                  <tr>
                    <th className="py-2 pr-3 font-medium">{t.collateral.reference}</th>
                    <th className="py-2 pr-3 font-medium">{t.collateral.party}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t.collateral.faceValue}</th>
                    <th className="py-2 text-right font-medium">{t.collateral.daysLeft}</th>
                  </tr>
                }
              >
                {alerts.map((alert) => (
                  <tr key={alert.collateralId} className="border-b border-[var(--color-line)] last:border-0">
                    <td className="tabular py-2 pr-3">{alert.reference}</td>
                    <td className="py-2 pr-3">{alert.partyName}</td>
                    <td className="tabular py-2 pr-3 text-right">
                      {formatMoney(alert.amount, alert.currency, locale, { compact: true })}
                    </td>
                    <td
                      className={`tabular py-2 text-right ${alert.daysRemaining <= 30 ? 'font-semibold text-[#b42318]' : 'text-[#b54708]'}`}
                    >
                      {alert.daysRemaining < 0 ? t.collateral.overdueExpiry : alert.daysRemaining}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title={t.collateral.coverage} footer={t.collateral.coverageNote}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.collateral.party}</th>
                  <th className="py-2 pr-3 font-medium">{t.collateral.entity}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.collateral.exposure}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.collateral.allocated}</th>
                  <th className="py-2 text-right font-medium">{t.collateral.uncoveredExposure}</th>
                </tr>
              }
            >
              {coverage.map((row) => (
                <tr key={`${row.partyId}|${row.legalEntityCode}`} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/${locale}/parties/${row.partyId}`} className="text-[var(--color-brand)]">
                      {row.partyName}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-xs">{row.legalEntityCode}</td>
                  <td className="tabular py-2 pr-3 text-right">
                    {formatMoney(row.exposure, currency, locale, { compact: true })}
                  </td>
                  <td className="tabular py-2 pr-3 text-right">
                    {formatMoney(row.collateralAllocated, currency, locale, { compact: true })}
                  </td>
                  <td className={`tabular py-2 text-right ${row.uncovered > 0 ? 'font-semibold text-[#b42318]' : ''}`}>
                    {formatMoney(row.uncovered, currency, locale, { compact: true })}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
