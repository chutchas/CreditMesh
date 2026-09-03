import Link from 'next/link';
import type { PaymentException } from '@creditmesh/core';
import { assessExceptionSignals, chequeReturnHistory, summariseExceptions } from '@creditmesh/core';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatMoney } from '../../../lib/format';
import { Card, Empty, PageHeader, StatTile, Table } from '../../../components/ui';
import ExceptionActions from './exception-actions';

/**
 * Module 15 — Payment Exception & Returned Cheque Monitor.
 *
 * The screen that demonstrates P7. Its most important column is not the amount
 * or the status: it is **where the signal goes next**. A returned cheque is the
 * freshest evidence an organisation has about a counterparty's ability to pay,
 * and today it dies in a reconciliation report the credit approver never opens.
 *
 * Nothing on this page blocks an order. Two bounced cheques flag the next order
 * for a human; they never stop a shipment on their own, for the same reason
 * group resolution never auto-applies.
 */
export default async function ExceptionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;
  const asOf = new Date().toISOString().slice(0, 10);
  const policy = session.profile.paymentPolicy;

  const { data: rows } = await supabase
    .from('payment_exception')
    .select(
      'id, party_id, legal_entity_code, type, amount, currency, occurred_at, reason_code, reason_text, reference, source, status, resolved_at, party:party_id(legal_name)',
    )
    .order('occurred_at', { ascending: false });

  const raw2 = (rows ?? []) as unknown as {
    id: string;
    party_id: string | null;
    legal_entity_code: string;
    type: string;
    amount: number;
    currency: string;
    occurred_at: string;
    reason_code: string | null;
    reason_text: string | null;
    reference: string | null;
    source: string;
    status: string;
    resolved_at: string | null;
    party: { legal_name: string } | null;
  }[];

  if (raw2.length === 0) {
    return (
      <>
        <PageHeader title={t.exceptions.title} subtitle={t.exceptions.subtitle} />
        <Empty title={t.exceptions.noData} hint={t.exceptions.noDataHint} />
      </>
    );
  }

  const exceptions: PaymentException[] = raw2.map((r) => ({
    exceptionId: r.id,
    partyId: r.party_id,
    partyName: r.party?.legal_name ?? null,
    legalEntityCode: r.legal_entity_code,
    type: r.type as PaymentException['type'],
    amount: Number(r.amount),
    currency: r.currency,
    occurredAt: r.occurred_at,
    reasonCode: r.reason_code,
    reasonText: r.reason_text,
    reference: r.reference,
    status: r.status as PaymentException['status'],
    resolvedAt: r.resolved_at,
    source: r.source,
  }));

  const signals = assessExceptionSignals(exceptions, policy, asOf);
  const summary = summariseExceptions(exceptions, signals, policy, asOf);
  const history = chequeReturnHistory(exceptions);
  const open = exceptions.filter((e) => e.status === 'open');
  const writable = canWrite(session);

  const typeLabel = (code: string) => t.exceptionTypes[code as keyof typeof t.exceptionTypes] ?? code;
  const targetLabel = (code: string) => t.signalTargets[code as keyof typeof t.signalTargets] ?? code;
  const severityTone = (s: string) =>
    s === 'critical' ? 'bg-[#fef3f2] text-[#b42318]' : s === 'high' ? 'bg-[#fff4ed] text-[#b93815]' : 'bg-[#fffaeb] text-[#b54708]';

  return (
    <>
      <PageHeader title={t.exceptions.title} subtitle={t.exceptions.subtitle} />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.exceptions.signalNote}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t.exceptions.open}
          value={String(summary.openCount)}
          hint={formatMoney(summary.openTotal, currency, locale, { compact: true })}
          tone={summary.openCount > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label={t.exceptions.slaBreaches}
          value={String(summary.slaBreaches)}
          hint={`${t.exceptions.oldest} ${summary.oldestOpenDays}${t.exceptions.daysShort}`}
          tone={summary.slaBreaches > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label={t.exceptions.unidentifiedMoney}
          value={formatMoney(summary.unidentifiedTotal, currency, locale, { compact: true })}
          tone={summary.unidentifiedTotal > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label={t.exceptions.partiesSignalled}
          value={String(summary.partiesSignalled)}
          tone={summary.partiesSignalled > 0 ? 'bad' : 'good'}
        />
      </div>

      {/* Signals first. The queue below is the work; this is the consequence,
          and putting it second is how a module ends at a report. */}
      {signals.length > 0 ? (
        <div className="mt-4">
          <Card title={t.exceptions.signalsRaised} footer={t.exceptions.noAutoBlockNote}>
            <div className="space-y-2">
              {signals.map((s) => (
                <div
                  key={`${s.partyId}-${s.code}`}
                  className="flex flex-wrap items-start justify-between gap-3 rounded border border-[var(--color-line)] p-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${severityTone(s.severity)}`}>
                        {t.signalCodes[s.code as keyof typeof t.signalCodes] ?? s.code}
                      </span>
                      <Link href={`/${locale}/parties/${s.partyId}`} className="text-sm font-medium text-[var(--color-brand)]">
                        {s.partyName ?? s.partyId}
                      </Link>
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-muted)]">{s.reason}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-[var(--color-muted)]">{t.exceptions.goesTo}</span>
                    {s.targets.map((target) => (
                      <span
                        key={target}
                        className="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink)]"
                      >
                        {targetLabel(target)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      <div className="mt-4">
        <Card title={`${t.exceptions.queue} (${open.length})`}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.exceptions.type}</th>
                <th className="py-2 pr-3 font-medium">{t.exceptions.party}</th>
                <th className="py-2 pr-3 font-medium">{t.exceptions.reference}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.exceptions.amount}</th>
                <th className="py-2 pr-3 font-medium">{t.exceptions.occurred}</th>
                <th className="py-2 pr-3 font-medium">{t.exceptions.source}</th>
                <th className="py-2 font-medium">{t.exceptions.action}</th>
              </tr>
            }
          >
            {open.map((e) => (
              <tr key={e.exceptionId} className="border-b border-[var(--color-line)] align-top last:border-0">
                <td className="py-2 pr-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      policy.creditSignalTypes.includes(e.type)
                        ? 'bg-[#fef3f2] text-[#b42318]'
                        : 'bg-[var(--color-canvas)] text-[var(--color-muted)]'
                    }`}
                  >
                    {typeLabel(e.type)}
                  </span>
                </td>
                <td className="py-2 pr-3 text-xs">
                  {e.partyId ? (
                    <Link href={`/${locale}/parties/${e.partyId}`} className="text-[var(--color-brand)]">
                      {e.partyName}
                    </Link>
                  ) : (
                    <span className="italic text-[var(--color-muted)]">{t.exceptions.noParty}</span>
                  )}
                  <div className="text-[11px] text-[var(--color-muted)]">{e.legalEntityCode}</div>
                </td>
                <td className="tabular py-2 pr-3 text-xs">
                  {e.reference}
                  {e.reasonText ? (
                    <div className="max-w-56 text-[11px] text-[var(--color-muted)]">{e.reasonText}</div>
                  ) : null}
                </td>
                <td className="tabular py-2 pr-3 text-right">
                  {formatMoney(e.amount, e.currency, locale, { compact: true })}
                </td>
                <td className="py-2 pr-3 text-xs">{formatDate(e.occurredAt, locale)}</td>
                <td className="py-2 pr-3 text-[11px] text-[var(--color-muted)]">
                  {t.exceptionSources[e.source as keyof typeof t.exceptionSources] ?? e.source}
                </td>
                <td className="py-2">
                  {writable ? (
                    <ExceptionActions
                      exceptionId={e.exceptionId}
                      labels={{
                        resolve: t.exceptions.resolve,
                        writeOff: t.exceptions.writeOff,
                        note: t.exceptions.note,
                        saving: t.exceptions.saving,
                      }}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      {history.length > 0 ? (
        <div className="mt-4">
          <Card title={t.exceptions.chequeHistory} footer={t.exceptions.chequeHistoryNote}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.exceptions.party}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.exceptions.returns}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.exceptions.amount}</th>
                  <th className="py-2 font-medium">{t.exceptions.latest}</th>
                </tr>
              }
            >
              {history.map((h) => (
                <tr key={h.partyId} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/${locale}/parties/${h.partyId}`} className="text-[var(--color-brand)]">
                      {h.partyName ?? h.partyId}
                    </Link>
                  </td>
                  <td
                    className={`tabular py-2 pr-3 text-right ${
                      h.count >= policy.chequeReturnCountForWatchlist ? 'font-semibold text-[#b42318]' : ''
                    }`}
                  >
                    {h.count}
                  </td>
                  <td className="tabular py-2 pr-3 text-right">
                    {formatMoney(h.total, currency, locale, { compact: true })}
                  </td>
                  <td className="py-2 text-xs">{formatDate(h.latest, locale)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      ) : null}
    </>
  );
}
