import Link from 'next/link';
import { waiverReport, type WaiverRecord } from '@creditmesh/core';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatMoney, formatNumber, formatPercent } from '../../../lib/format';
import { Card, Empty, PageHeader, StatTile, Table } from '../../../components/ui';
import RunChargesButton from './run-charges-button';
import WaiveButton from './waive-button';

/**
 * Module 14 — Late Payment Charge Manager.
 *
 * Every input is on screen next to every number — principal, rate, the date
 * that rate took effect, day count, late days. Late-charge arguments are never
 * about the total; they are about the inputs, and a screen that shows only the
 * answer loses the argument by default.
 *
 * The second table is the one this module is bought for. §7 is right that the
 * valuable report is not what was charged but what was **waived**: how much,
 * to whom, approved by whom. Almost no organisation can produce it today, and
 * it is usually the number that gets the project funded.
 *
 * The platform calculates and proposes. The debit note is issued by the ERP
 * (P5, P8).
 */
export default async function LateChargesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;
  const writable = canWrite(session);

  const { data: runs } = await supabase
    .from('late_charge_run')
    .select('id, as_of, item_count, total_amount, status, created_at, policy_snapshot, profile_version')
    .order('created_at', { ascending: false })
    .limit(10);

  const runRows = (runs ?? []) as {
    id: string;
    as_of: string;
    item_count: number;
    total_amount: number;
    status: string;
    created_at: string;
    policy_snapshot: Record<string, unknown>;
    profile_version: number | null;
  }[];

  const latest = runRows[0];

  const { data: items } = latest
    ? await supabase
        .from('late_charge_item')
        .select(
          'id, party_id, legal_entity_code, document_no, principal, annual_rate_pct, rate_effective_from, day_count, charge_from, charge_to, late_days, grace_days, charge_amount, currency, status, waiver_reason, waived_at, party:party_id(legal_name)',
        )
        .eq('run_id', latest.id)
        .order('charge_amount', { ascending: false })
    : { data: null };

  const { data: allWaived } = await supabase
    .from('late_charge_item')
    .select('party_id, charge_amount, waiver_reason, waived_at, party:party_id(legal_name)')
    .eq('status', 'waived');

  const runButton = writable ? (
    <RunChargesButton
      labels={{ run: t.lateCharges.run, running: t.lateCharges.running, items: t.lateCharges.items, skipped: t.lateCharges.skipped }}
    />
  ) : undefined;

  if (!latest) {
    return (
      <>
        <PageHeader title={t.lateCharges.title} subtitle={t.lateCharges.subtitle} actions={runButton} />
        <Empty title={t.lateCharges.noRuns} hint={t.lateCharges.noRunsHint} />
      </>
    );
  }

  const lines = (items ?? []) as unknown as {
    id: string;
    party_id: string;
    legal_entity_code: string;
    document_no: string;
    principal: number;
    annual_rate_pct: number;
    rate_effective_from: string;
    day_count: number;
    charge_from: string;
    charge_to: string;
    late_days: number;
    grace_days: number;
    charge_amount: number;
    currency: string;
    status: string;
    waiver_reason: string | null;
    waived_at: string | null;
    party: { legal_name: string } | null;
  }[];

  const waivers: WaiverRecord[] = ((allWaived ?? []) as unknown as {
    party_id: string;
    charge_amount: number;
    waiver_reason: string | null;
    waived_at: string | null;
    party: { legal_name: string } | null;
  }[]).map((w) => ({
    partyId: w.party_id,
    partyName: w.party?.legal_name ?? w.party_id,
    amount: Number(w.charge_amount),
    approvedByLabel: null,
    reason: w.waiver_reason,
    waivedAt: (w.waived_at ?? '').slice(0, 10),
  }));

  const chargedTotal = lines
    .filter((l) => l.status !== 'waived')
    .reduce((s, l) => s + Number(l.charge_amount), 0);
  const report = waiverReport(waivers, chargedTotal);

  return (
    <>
      <PageHeader title={t.lateCharges.title} subtitle={t.lateCharges.subtitle} actions={runButton} />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.lateCharges.scopeNote}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t.lateCharges.proposed}
          value={formatMoney(chargedTotal, currency, locale, { compact: true })}
          hint={`${lines.filter((l) => l.status !== 'waived').length} ${t.lateCharges.items}`}
        />
        <StatTile
          label={t.lateCharges.waivedTotal}
          value={formatMoney(report.waivedTotal, currency, locale, { compact: true })}
          hint={report.waivedSharePct === null ? undefined : `${formatPercent(report.waivedSharePct, locale, 0)} ${t.lateCharges.ofTotal}`}
          tone={report.waivedTotal > 0 ? 'warn' : undefined}
        />
        <StatTile label={t.lateCharges.asOf} value={formatDate(latest.as_of, locale)} hint={t.lateCharges.runStatus[latest.status as keyof typeof t.lateCharges.runStatus] ?? latest.status} />
        <StatTile
          label={t.lateCharges.policyVersion}
          value={latest.profile_version === null ? '—' : `v${latest.profile_version}`}
          hint={t.lateCharges.policyVersionHint}
        />
      </div>

      <div className="mt-4">
        <Card title={t.lateCharges.proposedCharges} footer={t.lateCharges.inputsNote}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.lateCharges.party}</th>
                <th className="py-2 pr-3 font-medium">{t.lateCharges.document}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.lateCharges.principal}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.lateCharges.rate}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.lateCharges.lateDays}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.lateCharges.charge}</th>
                <th className="py-2 font-medium">{t.lateCharges.action}</th>
              </tr>
            }
          >
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-[var(--color-line)] align-top last:border-0">
                <td className="py-2 pr-3">
                  <Link href={`/${locale}/parties/${l.party_id}`} className="text-[var(--color-brand)]">
                    {l.party?.legal_name ?? l.party_id}
                  </Link>
                  <div className="text-[11px] text-[var(--color-muted)]">{l.legal_entity_code}</div>
                </td>
                <td className="tabular py-2 pr-3 text-xs">{l.document_no}</td>
                <td className="tabular py-2 pr-3 text-right">
                  {formatMoney(Number(l.principal), l.currency, locale, { compact: true })}
                </td>
                <td className="tabular py-2 pr-3 text-right text-xs">
                  {formatNumber(Number(l.annual_rate_pct), locale, 2)}%
                  {/* The rate's own effective date, on screen. This is what
                      makes a recomputation of last quarter defensible. */}
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {t.lateCharges.since} {formatDate(l.rate_effective_from, locale)} · /{l.day_count}
                  </div>
                </td>
                <td className="tabular py-2 pr-3 text-right text-xs">
                  {l.late_days}
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {formatDate(l.charge_from, locale)} → {formatDate(l.charge_to, locale)}
                  </div>
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {t.lateCharges.afterGrace} {l.grace_days}
                    {t.lateCharges.daysShort}
                  </div>
                </td>
                <td
                  className={`tabular py-2 pr-3 text-right font-semibold ${l.status === 'waived' ? 'text-[var(--color-muted)] line-through' : ''}`}
                >
                  {formatMoney(Number(l.charge_amount), l.currency, locale, { compact: true })}
                </td>
                <td className="py-2">
                  {l.status === 'waived' ? (
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {t.lateCharges.waived} · {l.waiver_reason}
                    </div>
                  ) : writable ? (
                    <WaiveButton
                      itemId={l.id}
                      labels={{
                        waive: t.lateCharges.waive,
                        reason: t.lateCharges.waiverReason,
                        reasonRequired: t.lateCharges.waiverReasonRequired,
                        saving: t.lateCharges.saving,
                      }}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      {report.byParty.length > 0 ? (
        <div className="mt-4">
          <Card title={t.lateCharges.waiverReport} footer={t.lateCharges.waiverReportNote}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.lateCharges.party}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.lateCharges.waivers}</th>
                  <th className="py-2 text-right font-medium">{t.lateCharges.waivedAmount}</th>
                </tr>
              }
            >
              {report.byParty.map((p) => (
                <tr key={p.partyId} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/${locale}/parties/${p.partyId}`} className="text-[var(--color-brand)]">
                      {p.partyName}
                    </Link>
                  </td>
                  <td className="tabular py-2 pr-3 text-right text-xs">{p.count}</td>
                  <td className="tabular py-2 text-right">{formatMoney(p.amount, currency, locale, { compact: true })}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      ) : null}

      {runRows.length > 1 ? (
        <div className="mt-4">
          <Card title={t.lateCharges.runHistory}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.lateCharges.asOf}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.lateCharges.items}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.lateCharges.charge}</th>
                  <th className="py-2 font-medium">{t.lateCharges.policyUsed}</th>
                </tr>
              }
            >
              {runRows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="py-2 pr-3 text-xs">{formatDate(r.as_of, locale)}</td>
                  <td className="tabular py-2 pr-3 text-right text-xs">{r.item_count}</td>
                  <td className="tabular py-2 pr-3 text-right">
                    {formatMoney(Number(r.total_amount), currency, locale, { compact: true })}
                  </td>
                  <td className="py-2 text-[11px] text-[var(--color-muted)]">
                    {r.profile_version === null ? '—' : `v${r.profile_version}`} ·{' '}
                    {String(r.policy_snapshot?.dayCountConvention ?? '')}/
                    {String(r.policy_snapshot?.gracePeriodDays ?? '')}
                    {t.lateCharges.daysShort}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      ) : null}
    </>
  );
}
