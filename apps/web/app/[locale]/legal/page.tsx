import Link from 'next/link';
import type { StoredLegalEvent } from '@creditmesh/core';
import { screeningDue, summariseLegalScreening } from '@creditmesh/core';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate } from '../../../lib/format';
import { Card, Empty, PageHeader, StatTile, Table } from '../../../components/ui';
import ReviewPanel, { type Candidate } from './review-panel';

/**
 * Module 16 — Legal & Insolvency Screening.
 *
 * Presented as "results to check", never as conclusions. The review queue is
 * the top half of the screen and the confirmed register the bottom, in that
 * order, because the failure mode here is a wrong name treated as fact.
 *
 * Natural persons are shown with a masked identifier only, and the page says so
 * — §4.15 requires a separate storage and masking policy for people, and a
 * screen that quietly showed the whole number would make the policy a fiction.
 */
export default async function LegalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const asOf = new Date().toISOString().slice(0, 10);
  const policy = session.profile.legalScreening;

  const [{ data: events }, { data: portfolio }, { data: runs }] = await Promise.all([
    supabase
      .from('legal_event')
      .select(
        'id, party_id, subject_type, subject_name, subject_id_masked, event_type, severity, case_no, source, court, event_date, published_date, detail, match_basis, match_note, candidates, review_status, reviewed_at, review_note',
      )
      .order('retrieved_at', { ascending: false }),
    supabase.from('v_party_portfolio').select('party_id, legal_name, grade'),
    supabase.from('legal_screening_run').select('party_id, screened_at'),
  ]);

  const rows = (events ?? []) as {
    id: string;
    party_id: string | null;
    subject_type: string;
    subject_name: string;
    subject_id_masked: string | null;
    event_type: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    case_no: string;
    source: string;
    court: string | null;
    event_date: string | null;
    published_date: string | null;
    detail: string | null;
    match_basis: string;
    match_note: string | null;
    candidates: Candidate[];
    review_status: 'pending' | 'confirmed' | 'rejected';
    reviewed_at: string | null;
    review_note: string | null;
  }[];

  const parties = (portfolio ?? []) as { party_id: string; legal_name: string; grade: string | null }[];
  const nameByParty = new Map(parties.map((p) => [p.party_id, p.legal_name]));

  const lastScreened = new Map<string, string>();
  for (const r of (runs ?? []) as { party_id: string; screened_at: string }[]) {
    const current = lastScreened.get(r.party_id);
    if (!current || r.screened_at > current) lastScreened.set(r.party_id, r.screened_at);
  }

  const due = screeningDue(
    parties.map((p) => ({
      partyId: p.party_id,
      legalName: p.legal_name,
      grade: p.grade,
      lastScreenedAt: lastScreened.get(p.party_id)?.slice(0, 10) ?? null,
    })),
    policy,
    asOf,
  );

  const summary = summariseLegalScreening(
    rows.map(
      (r): StoredLegalEvent => ({
        partyId: r.party_id,
        eventType: r.event_type,
        severity: r.severity,
        reviewStatus: r.review_status,
        matchBasis: r.match_basis as StoredLegalEvent['matchBasis'],
      }),
    ),
  );

  const pending = rows.filter((r) => r.review_status === 'pending');
  const confirmed = rows.filter((r) => r.review_status === 'confirmed');
  const writable = canWrite(session);

  const typeLabel = (code: string) => t.legalTypes[code as keyof typeof t.legalTypes] ?? code;
  const severityTone = (s: string) =>
    s === 'critical'
      ? 'bg-[#fef3f2] text-[#b42318]'
      : s === 'high'
        ? 'bg-[#fff4ed] text-[#b93815]'
        : s === 'medium'
          ? 'bg-[#fffaeb] text-[#b54708]'
          : 'bg-[var(--color-canvas)] text-[var(--color-muted)]';

  if (rows.length === 0 && due.length === 0) {
    return (
      <>
        <PageHeader title={t.legal.title} subtitle={t.legal.subtitle} />
        <Empty title={t.legal.noData} hint={t.legal.noDataHint} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.legal.title} subtitle={t.legal.subtitle} />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.legal.matchRuleNote}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t.legal.pendingReview}
          value={String(summary.pendingReview)}
          tone={summary.pendingReview > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label={t.legal.criticalParties}
          value={String(summary.criticalParties)}
          tone={summary.criticalParties > 0 ? 'bad' : 'good'}
        />
        <StatTile label={t.legal.confirmedEvents} value={String(summary.confirmedEvents)} />
        <StatTile
          label={t.legal.screeningDue}
          value={String(due.length)}
          hint={due.length > 0 ? `${t.legal.oldest} ${due[0]!.overdueDays}${t.legal.daysShort}` : undefined}
          tone={due.length > 0 ? 'warn' : 'good'}
        />
      </div>

      {/* Review queue first. These are questions, not findings. */}
      {pending.length > 0 ? (
        <div className="mt-4">
          <Card title={`${t.legal.reviewQueue} (${pending.length})`}>
            <div className="space-y-3">
              {pending.map((r) => (
                <div key={r.id} className="rounded border border-[var(--color-line)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${severityTone(r.severity)}`}>
                          {typeLabel(r.event_type)}
                        </span>
                        <span className="text-sm font-medium">{r.subject_name}</span>
                        {r.subject_type === 'person' ? (
                          <span className="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]">
                            {t.legal.naturalPerson}
                            {r.subject_id_masked ? ` ····${r.subject_id_masked}` : ''}
                          </span>
                        ) : null}
                      </div>
                      <div className="tabular mt-1 text-[11px] text-[var(--color-muted)]">
                        {t.legal.caseNo} {r.case_no} · {r.source}
                        {r.court ? ` · ${r.court}` : ''} · {formatDate(r.event_date, locale)}
                      </div>
                      {r.detail ? <div className="mt-1 text-xs">{r.detail}</div> : null}
                      <div className="mt-1 text-[11px] italic text-[#b54708]">{r.match_note}</div>
                      {r.party_id ? (
                        <div className="mt-1 text-[11px]">
                          {t.legal.linkedTo}{' '}
                          <Link href={`/${locale}/parties/${r.party_id}`} className="text-[var(--color-brand)]">
                            {nameByParty.get(r.party_id) ?? r.party_id}
                          </Link>
                        </div>
                      ) : null}
                    </div>
                    <div className="w-full max-w-64">
                      {writable ? (
                        <ReviewPanel
                          eventId={r.id}
                          linkedPartyId={r.party_id}
                          candidates={r.candidates ?? []}
                          labels={{
                            confirm: t.legal.confirm,
                            reject: t.legal.reject,
                            saving: t.legal.saving,
                            choose: t.legal.chooseParty,
                            chooseRequired: t.legal.choosePartyRequired,
                            note: t.legal.reviewNote,
                            noCandidates: t.legal.noCandidates,
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {confirmed.length > 0 ? (
        <div className="mt-4">
          <Card title={t.legal.confirmedRegister}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.legal.party}</th>
                  <th className="py-2 pr-3 font-medium">{t.legal.eventType}</th>
                  <th className="py-2 pr-3 font-medium">{t.legal.caseNo}</th>
                  <th className="py-2 pr-3 font-medium">{t.legal.eventDate}</th>
                  <th className="py-2 pr-3 font-medium">{t.legal.matchBasis}</th>
                  <th className="py-2 font-medium">{t.legal.source}</th>
                </tr>
              }
            >
              {confirmed.map((r) => (
                <tr key={r.id} className="border-b border-[var(--color-line)] align-top last:border-0">
                  <td className="py-2 pr-3">
                    {r.party_id ? (
                      <Link href={`/${locale}/parties/${r.party_id}`} className="text-[var(--color-brand)]">
                        {nameByParty.get(r.party_id) ?? r.subject_name}
                      </Link>
                    ) : (
                      r.subject_name
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${severityTone(r.severity)}`}>
                      {typeLabel(r.event_type)}
                    </span>
                  </td>
                  <td className="tabular py-2 pr-3 text-xs">{r.case_no}</td>
                  <td className="py-2 pr-3 text-xs">{formatDate(r.event_date, locale)}</td>
                  <td className="py-2 pr-3 text-xs">
                    {t.legalBasis[r.match_basis as keyof typeof t.legalBasis] ?? r.match_basis}
                  </td>
                  <td className="py-2 text-xs text-[var(--color-muted)]">{r.source}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      ) : null}

      {due.length > 0 ? (
        <div className="mt-4">
          <Card title={t.legal.screeningDueTitle} footer={t.legal.screeningDueNote}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.legal.party}</th>
                  <th className="py-2 pr-3 font-medium">{t.legal.grade}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.legal.everyDays}</th>
                  <th className="py-2 pr-3 font-medium">{t.legal.lastScreened}</th>
                  <th className="py-2 text-right font-medium">{t.legal.overdueBy}</th>
                </tr>
              }
            >
              {due.slice(0, 20).map((d) => (
                <tr key={d.partyId} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/${locale}/parties/${d.partyId}`} className="text-[var(--color-brand)]">
                      {d.legalName}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-xs">{d.grade ?? '—'}</td>
                  <td className="tabular py-2 pr-3 text-right text-xs">{d.dueEveryDays}</td>
                  <td className="py-2 pr-3 text-xs">
                    {d.lastScreenedAt ? formatDate(d.lastScreenedAt, locale) : t.legal.neverScreened}
                  </td>
                  <td className="tabular py-2 text-right text-xs">
                    {d.overdueDays}
                    {t.legal.daysShort}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      ) : null}

      <p className="mt-3 text-xs text-[var(--color-muted)]">{t.legal.personDataNote}</p>
    </>
  );
}
