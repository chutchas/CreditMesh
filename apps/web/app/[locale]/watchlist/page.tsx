import Link from 'next/link';
import { weeklyDigest, type ChangeCode, type DetectedChange } from '@creditmesh/core';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatMoney } from '../../../lib/format';
import { Card, Empty, PageHeader, StatTile, Table } from '../../../components/ui';
import RunWatchlistButton from './run-watchlist-button';

/**
 * Module 5 — Watchlist & Signal.
 *
 * Two lists, deliberately unequal in weight. The top one is what somebody has
 * to act on today; everything else is a digest line. §7 is blunt that alert
 * volume, not accuracy, is what gets this module switched off in week two, so
 * the screen is built to make the restraint visible: it shows how many real
 * changes were detected and how few of them were raised.
 *
 * A signal about one company shows the whole group's exposure beside it,
 * because §1's opening complaint is a signal that never crossed a BU boundary.
 */
export default async function WatchlistPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;
  const writable = canWrite(session);

  const [{ data: changes }, { data: entries }, { data: exposures }] = await Promise.all([
    supabase
      .from('watchlist_change')
      .select('id, party_id, code, severity, actionable, before_value, after_value, detail, observed_at, acknowledged_at, party:party_id(legal_name)')
      .order('observed_at', { ascending: false })
      .limit(300),
    supabase
      .from('watchlist_entry')
      .select('id, party_id, reason, severity, source, added_at, note, party:party_id(legal_name)')
      .is('removed_at', null)
      .order('added_at', { ascending: false }),
    supabase.from('v_party_portfolio').select('party_id, total_exposure, total_ar_overdue, grade'),
  ]);

  const changeRows = (changes ?? []) as unknown as {
    id: string;
    party_id: string;
    code: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    actionable: boolean;
    before_value: string | null;
    after_value: string | null;
    detail: string;
    observed_at: string;
    acknowledged_at: string | null;
    party: { legal_name: string } | null;
  }[];

  const entryRows = (entries ?? []) as unknown as {
    id: string;
    party_id: string;
    reason: string;
    severity: string;
    source: string;
    added_at: string;
    note: string | null;
    party: { legal_name: string } | null;
  }[];

  const exposureByParty = new Map(
    ((exposures ?? []) as { party_id: string; total_exposure: number | null; total_ar_overdue: number | null; grade: string | null }[]).map(
      (e) => [e.party_id, e],
    ),
  );

  const runButton = writable ? (
    <RunWatchlistButton
      labels={{ run: t.watchlist.run, running: t.watchlist.running, raised: t.watchlist.raisedLabel, digest: t.watchlist.digestLabel, deferred: t.watchlist.deferredLabel }}
    />
  ) : undefined;

  if (changeRows.length === 0 && entryRows.length === 0) {
    return (
      <>
        <PageHeader title={t.watchlist.title} subtitle={t.watchlist.subtitle} actions={runButton} />
        <Empty title={t.watchlist.noData} hint={t.watchlist.noDataHint} />
      </>
    );
  }

  const raised = changeRows.filter((c) => c.actionable && !c.acknowledged_at);
  const digestSource: DetectedChange[] = changeRows
    .filter((c) => !c.actionable)
    .map((c) => ({
      partyId: c.party_id,
      partyName: c.party?.legal_name ?? c.party_id,
      code: c.code as ChangeCode,
      actionable: false,
      severity: c.severity,
      before: c.before_value,
      after: c.after_value,
      detail: c.detail,
      observedAt: c.observed_at,
    }));
  const digest = weeklyDigest(digestSource);

  const codeLabel = (code: string) => t.changeCodes[code as keyof typeof t.changeCodes] ?? code;
  const severityTone = (s: string) =>
    s === 'critical'
      ? 'bg-[#fef3f2] text-[#b42318]'
      : s === 'high'
        ? 'bg-[#fff4ed] text-[#b93815]'
        : s === 'medium'
          ? 'bg-[#fffaeb] text-[#b54708]'
          : 'bg-[var(--color-canvas)] text-[var(--color-muted)]';

  return (
    <>
      <PageHeader title={t.watchlist.title} subtitle={t.watchlist.subtitle} actions={runButton} />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.watchlist.restraintNote}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t.watchlist.onList} value={String(entryRows.length)} />
        <StatTile
          label={t.watchlist.needsAction}
          value={String(raised.length)}
          tone={raised.length > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label={t.watchlist.detected}
          value={String(changeRows.length)}
          hint={`${digestSource.length} ${t.watchlist.inDigest}`}
        />
        <StatTile
          label={t.watchlist.exposureOnList}
          value={formatMoney(
            entryRows.reduce((s, e) => s + Number(exposureByParty.get(e.party_id)?.total_exposure ?? 0), 0),
            currency,
            locale,
            { compact: true },
          )}
        />
      </div>

      {raised.length > 0 ? (
        <div className="mt-4">
          <Card title={`${t.watchlist.actNow} (${raised.length})`}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.watchlist.party}</th>
                  <th className="py-2 pr-3 font-medium">{t.watchlist.change}</th>
                  <th className="py-2 pr-3 font-medium">{t.watchlist.detail}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.watchlist.exposure}</th>
                  <th className="py-2 font-medium">{t.watchlist.observed}</th>
                </tr>
              }
            >
              {raised.map((c) => {
                const exposure = exposureByParty.get(c.party_id);
                return (
                  <tr key={c.id} className="border-b border-[var(--color-line)] align-top last:border-0">
                    <td className="py-2 pr-3">
                      <Link href={`/${locale}/parties/${c.party_id}`} className="font-medium text-[var(--color-brand)]">
                        {c.party?.legal_name ?? c.party_id}
                      </Link>
                      {exposure?.grade ? (
                        <div className="text-[11px] text-[var(--color-muted)]">{exposure.grade}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${severityTone(c.severity)}`}>
                        {codeLabel(c.code)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {c.detail}
                      {c.before_value || c.after_value ? (
                        <div className="tabular text-[11px] text-[var(--color-muted)]">
                          {c.before_value ?? '—'} → {c.after_value ?? '—'}
                        </div>
                      ) : null}
                    </td>
                    <td className="tabular py-2 pr-3 text-right">
                      {formatMoney(Number(exposure?.total_exposure ?? 0), currency, locale, { compact: true })}
                      {Number(exposure?.total_ar_overdue ?? 0) > 0 ? (
                        <div className="text-[11px] font-normal text-[#b42318]">
                          {formatMoney(Number(exposure?.total_ar_overdue ?? 0), currency, locale, { compact: true })}{' '}
                          {t.watchlist.overdue}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 text-xs">{formatDate(c.observed_at, locale)}</td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card title={t.watchlist.currentList}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.watchlist.party}</th>
                <th className="py-2 pr-3 font-medium">{t.watchlist.reason}</th>
                <th className="py-2 font-medium">{t.watchlist.added}</th>
              </tr>
            }
          >
            {entryRows.map((e) => (
              <tr key={e.id} className="border-b border-[var(--color-line)] align-top last:border-0">
                <td className="py-2 pr-3">
                  <Link href={`/${locale}/parties/${e.party_id}`} className="text-[var(--color-brand)]">
                    {e.party?.legal_name ?? e.party_id}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-xs">
                  {e.reason}
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {e.source === 'signal' ? t.watchlist.bySignal : t.watchlist.byPerson}
                  </div>
                </td>
                <td className="py-2 text-xs">{formatDate(e.added_at, locale)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title={t.watchlist.digestTitle} footer={t.watchlist.digestNote}>
          {digest.length === 0 ? (
            <p className="py-2 text-xs text-[var(--color-muted)]">{t.watchlist.digestEmpty}</p>
          ) : (
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.watchlist.change}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.watchlist.count}</th>
                  <th className="py-2 font-medium">{t.watchlist.party}</th>
                </tr>
              }
            >
              {digest.map((d) => (
                <tr key={d.code} className="border-b border-[var(--color-line)] align-top last:border-0">
                  <td className="py-2 pr-3 text-xs">{codeLabel(d.code)}</td>
                  <td className="tabular py-2 pr-3 text-right text-xs">{d.count}</td>
                  <td className="py-2 text-[11px] text-[var(--color-muted)]">{d.parties.join(', ')}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <p className="mt-3 text-xs text-[var(--color-muted)]">{t.watchlist.vsCollection}</p>
    </>
  );
}
