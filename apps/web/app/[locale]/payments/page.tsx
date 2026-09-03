import Link from 'next/link';
import type { IncomingPayment, OpenItem, UnmatchedPayment } from '@creditmesh/core';
import { expectedCash, matchPayments, summarisePaymentMonitoring } from '@creditmesh/core';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatMoney, formatPercent } from '../../../lib/format';
import { Card, Empty, PageHeader, StatTile, Table } from '../../../components/ui';

/**
 * Module 13 — Payment & Receipt Monitoring.
 *
 * The gate of the Collect group: everything downstream needs to know whether
 * the money arrived. P8 bounds it — this reads the status of money that has
 * already moved, and receives nothing.
 *
 * The screen leads with what is *not* settled, because that is the work. A
 * receipt that matched cleanly needs nobody's attention; an unidentified one
 * has an SLA running against it and an ambiguous one is a question somebody
 * has to answer before the cash lands on the wrong invoice.
 */
export default async function PaymentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;
  const asOf = new Date().toISOString().slice(0, 10);
  const policy = session.profile.paymentPolicy;

  const [{ data: paymentRows }, { data: itemRows }, { data: partyRows }] = await Promise.all([
    supabase
      .from('v_payment_status')
      .select(
        'payment_id, party_id, legal_entity_code, receipt_ref, payment_date, amount, currency, channel, payer_name, source_document_no, status, applied_amount, unapplied_amount, application_count, lowest_confidence',
      )
      .order('payment_date', { ascending: false }),
    supabase
      .from('ar_item')
      .select('id, party_id, legal_entity_code, document_no, due_date, amount_base, base_currency')
      .is('cleared_date', null),
    supabase.from('party').select('id, legal_name'),
  ]);

  const rows = (paymentRows ?? []) as {
    payment_id: string;
    party_id: string | null;
    legal_entity_code: string;
    receipt_ref: string;
    payment_date: string;
    amount: number;
    currency: string;
    channel: string;
    payer_name: string | null;
    source_document_no: string | null;
    status: string;
    applied_amount: number;
    unapplied_amount: number;
    application_count: number;
    lowest_confidence: number | null;
  }[];

  const nameByParty = new Map(((partyRows ?? []) as { id: string; legal_name: string }[]).map((p) => [p.id, p.legal_name]));

  const openItems: OpenItem[] = (itemRows ?? []).map((i) => ({
    arItemId: i.id as string,
    partyId: i.party_id as string,
    legalEntityCode: i.legal_entity_code as string,
    documentNo: i.document_no as string,
    dueDate: i.due_date as string,
    amount: Number(i.amount_base),
    currency: i.base_currency as string,
  }));

  if (rows.length === 0 && openItems.length === 0) {
    return (
      <>
        <PageHeader title={t.payments.title} subtitle={t.payments.subtitle} />
        <Empty title={t.payments.noData} hint={t.payments.noDataHint} />
      </>
    );
  }

  const payments: IncomingPayment[] = rows.map((p) => ({
    paymentId: p.payment_id,
    partyId: p.party_id,
    legalEntityCode: p.legal_entity_code,
    receiptRef: p.receipt_ref,
    paymentDate: p.payment_date,
    amount: Number(p.amount),
    currency: p.currency,
    channel: p.channel,
    sourceDocumentNo: p.source_document_no,
    payerName: p.payer_name,
    reference: null,
  }));

  // Re-run against today's open items so the screen explains the receipts that
  // are still unapplied. The stored applications are the record; this is the
  // diagnosis, and it is recomputed rather than cached for the same reason the
  // order cockpit recomputes: a cached explanation goes stale and is believed.
  const unapplied = payments.filter((p) => {
    const row = rows.find((r) => r.payment_id === p.paymentId)!;
    return row.unapplied_amount > 0;
  });
  const { unmatched } = matchPayments(unapplied, openItems, policy);
  const summary = summarisePaymentMonitoring(
    payments,
    rows
      .filter((r) => r.applied_amount > 0)
      .map((r) => ({
        paymentId: r.payment_id,
        arItemId: '',
        appliedAmount: Number(r.applied_amount),
        matchRule: 'source' as const,
        confidence: r.lowest_confidence ?? 1,
      })),
    unmatched,
    policy,
    asOf,
  );

  const cash = expectedCash(openItems, [], asOf);

  const reasonLabel = (reason: UnmatchedPayment['reason']) =>
    t.paymentReasons[reason as keyof typeof t.paymentReasons] ?? reason;
  const cashLabel = (label: string) => t.cashBuckets[label as keyof typeof t.cashBuckets] ?? label;

  return (
    <>
      <PageHeader title={t.payments.title} subtitle={t.payments.subtitle} />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.payments.scopeNote}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t.payments.received}
          value={formatMoney(summary.receiptTotal, currency, locale, { compact: true })}
          hint={`${summary.receiptCount} ${t.payments.receipts}`}
        />
        <StatTile
          label={t.payments.applied}
          value={formatMoney(summary.matchedTotal, currency, locale, { compact: true })}
          hint={
            summary.receiptTotal > 0
              ? formatPercent((summary.matchedTotal / summary.receiptTotal) * 100, locale, 0)
              : undefined
          }
        />
        <StatTile
          label={t.payments.unidentified}
          value={formatMoney(summary.unidentifiedTotal, currency, locale, { compact: true })}
          hint={`${summary.unidentifiedCount} ${t.payments.receipts}`}
          tone={summary.unidentifiedCount > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label={t.payments.slaBreaches}
          value={String(summary.slaBreaches)}
          hint={`${t.payments.slaHint} ${policy.unidentifiedReceiptSlaDays}${t.payments.daysShort}`}
          tone={summary.slaBreaches > 0 ? 'bad' : 'good'}
        />
      </div>

      {unmatched.length > 0 ? (
        <div className="mt-4">
          <Card title={`${t.payments.needsAttention} (${unmatched.length})`} footer={t.payments.ambiguityNote}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.payments.receipt}</th>
                  <th className="py-2 pr-3 font-medium">{t.payments.from}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.payments.amount}</th>
                  <th className="py-2 pr-3 font-medium">{t.payments.reason}</th>
                  <th className="py-2 font-medium">{t.payments.candidates}</th>
                </tr>
              }
            >
              {unmatched.map((u) => (
                <tr key={u.payment.paymentId} className="border-b border-[var(--color-line)] align-top last:border-0">
                  <td className="py-2 pr-3">
                    <div className="tabular font-medium">{u.payment.receiptRef}</div>
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {formatDate(u.payment.paymentDate, locale)} · {u.payment.legalEntityCode} ·{' '}
                      {t.paymentChannels[u.payment.channel as keyof typeof t.paymentChannels] ?? u.payment.channel}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {u.payment.partyId ? (
                      <Link href={`/${locale}/parties/${u.payment.partyId}`} className="text-[var(--color-brand)]">
                        {nameByParty.get(u.payment.partyId) ?? u.payment.partyId}
                      </Link>
                    ) : (
                      <span className="italic text-[var(--color-muted)]">
                        {u.payment.payerName ?? t.payments.unknownPayer}
                      </span>
                    )}
                  </td>
                  <td className="tabular py-2 pr-3 text-right">
                    {formatMoney(u.payment.amount, u.payment.currency, locale, { compact: true })}
                  </td>
                  <td className="py-2 pr-3">
                    <div
                      className={`inline-block rounded px-1.5 py-0.5 text-[11px] ${
                        u.reason === 'no_party' || u.reason === 'ambiguous'
                          ? 'bg-[#fffaeb] text-[#b54708]'
                          : 'bg-[var(--color-canvas)] text-[var(--color-muted)]'
                      }`}
                    >
                      {reasonLabel(u.reason)}
                    </div>
                    <div className="mt-0.5 max-w-72 text-[11px] text-[var(--color-muted)]">{u.note}</div>
                  </td>
                  <td className="py-2 text-[11px]">
                    {u.candidates.length === 0 ? (
                      <span className="text-[var(--color-muted)]">—</span>
                    ) : (
                      <div className="space-y-0.5">
                        {u.candidates.slice(0, 3).map((c) => (
                          <div key={c.arItemId} className="tabular">
                            {c.documentNo} · {formatMoney(c.amount, currency, locale, { compact: true })} ·{' '}
                            {formatDate(c.dueDate, locale)}
                          </div>
                        ))}
                        {u.candidates.length > 3 ? (
                          <div className="text-[var(--color-muted)]">+{u.candidates.length - 3}</div>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card title={t.payments.expectedCash} footer={t.payments.expectedCashNote}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.payments.window}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.payments.items}</th>
                <th className="py-2 text-right font-medium">{t.payments.amount}</th>
              </tr>
            }
          >
            {cash.buckets.map((b) => (
              <tr key={b.label} className="border-b border-[var(--color-line)] last:border-0">
                <td className={`py-2 pr-3 text-xs ${b.label === 'overdue' ? 'font-semibold text-[#b42318]' : ''}`}>
                  {cashLabel(b.label)}
                </td>
                <td className="tabular py-2 pr-3 text-right text-xs">{b.itemCount}</td>
                <td
                  className={`tabular py-2 text-right ${b.label === 'overdue' ? 'font-semibold text-[#b42318]' : ''}`}
                >
                  {formatMoney(b.amount, currency, locale, { compact: true })}
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title={t.payments.byChannel}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.payments.channel}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.payments.receipts}</th>
                <th className="py-2 text-right font-medium">{t.payments.amount}</th>
              </tr>
            }
          >
            {summary.byChannel.map((c) => (
              <tr key={c.channel} className="border-b border-[var(--color-line)] last:border-0">
                <td className="py-2 pr-3 text-xs">
                  {t.paymentChannels[c.channel as keyof typeof t.paymentChannels] ?? c.channel}
                </td>
                <td className="tabular py-2 pr-3 text-right text-xs">{c.count}</td>
                <td className="tabular py-2 text-right">{formatMoney(c.total, currency, locale, { compact: true })}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
