import Link from 'next/link';
import type { CollectionCaseInput } from '@creditmesh/core';
import { buildCollectionQueue, promiseKeptRate, summariseCollection } from '@creditmesh/core';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatMoney, formatPercent } from '../../../lib/format';
import { Card, Empty, PageHeader, StatTile, Table } from '../../../components/ui';
import ActivityPanel from './activity-panel';
import RunCollectionButton from './run-collection-button';

/**
 * Module 12 — Collection Management Workbench, first phase.
 *
 * Queue and contact log only. No forced stages, no SLA countdown, no automatic
 * escalation. §7's warning is that this is the first module that changes how
 * someone's day works, and that a queue which disagrees with the collector in
 * week one sends them back to Excel permanently. So the ordering is a
 * suggestion they can override, and the override is recorded.
 *
 * Kept distinct from Module 5 throughout: the watchlist says who is risky, this
 * says who to call today.
 */
export default async function CollectionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;
  const asOf = new Date().toISOString().slice(0, 10);
  const policy = session.profile.collectionPolicy;

  const [{ data: cases }, { data: promises }] = await Promise.all([
    supabase
      .from('v_collection_case_context')
      .select(
        'case_id, party_id, legal_name, legal_entity_code, owner_user_id, stage, status, manual_rank, last_contact_at, next_action_at, open_amount, overdue_amount, max_dpd, score, grade, has_accepted_dispute, broken_promise_count',
      ),
    supabase.from('promise_to_pay').select('case_id, amount, promised_date, status'),
  ]);

  const rows = (cases ?? []) as {
    case_id: string;
    party_id: string;
    legal_name: string;
    legal_entity_code: string;
    owner_user_id: string | null;
    stage: string | null;
    status: string;
    manual_rank: number | null;
    last_contact_at: string | null;
    next_action_at: string | null;
    open_amount: number;
    overdue_amount: number;
    max_dpd: number;
    score: number | null;
    grade: string | null;
    has_accepted_dispute: boolean;
    broken_promise_count: number;
  }[];

  const promiseRows = (promises ?? []) as {
    case_id: string;
    amount: number;
    promised_date: string;
    status: 'open' | 'kept' | 'broken' | 'cancelled';
  }[];

  if (rows.length === 0) {
    return (
      <>
        <PageHeader
          title={t.collection.title}
          subtitle={t.collection.subtitle}
          actions={
            canWrite(session) ? (
              <RunCollectionButton
                labels={{ run: t.collection.run, running: t.collection.running, opened: t.collection.opened, closed: t.collection.closed }}
              />
            ) : undefined
          }
        />
        <Empty title={t.collection.noData} hint={t.collection.noDataHint} />
      </>
    );
  }

  const openPromiseByCase = new Map<string, { amount: number; promisedDate: string }>();
  for (const p of promiseRows) {
    if (p.status !== 'open') continue;
    const current = openPromiseByCase.get(p.case_id);
    if (!current || p.promised_date < current.promisedDate) {
      openPromiseByCase.set(p.case_id, { amount: Number(p.amount), promisedDate: p.promised_date });
    }
  }

  // Worst grade ranks highest, so a low grade lifts a case up the queue.
  const grades = [...session.profile.creditPolicy.riskGrades].sort((a, b) => b.minScore - a.minScore);
  const gradeRank = new Map(grades.map((g, i) => [g.code, i]));

  const inputs: CollectionCaseInput[] = rows.map((r) => ({
    caseId: r.case_id,
    partyId: r.party_id,
    partyName: r.legal_name,
    legalEntityCode: r.legal_entity_code,
    ownerUserId: r.owner_user_id,
    ownerLabel: null,
    stage: r.stage as CollectionCaseInput['stage'],
    status: r.status as CollectionCaseInput['status'],
    openAmount: Number(r.open_amount),
    overdueAmount: Number(r.overdue_amount),
    currency,
    maxDpd: Number(r.max_dpd),
    grade: r.grade,
    score: r.score === null ? null : Number(r.score),
    lastContactAt: r.last_contact_at,
    manualRank: r.manual_rank,
    hasAcceptedDispute: r.has_accepted_dispute,
    openPromise: openPromiseByCase.get(r.case_id) ?? null,
    brokenPromiseCount: Number(r.broken_promise_count),
  }));

  const queue = buildCollectionQueue(inputs, policy, asOf, gradeRank);
  const summary = summariseCollection(queue, policy);
  const kept = promiseKeptRate(
    promiseRows.map((p) => ({ amount: Number(p.amount), promisedDate: p.promised_date, status: p.status })),
  );
  const writable = canWrite(session);

  const stageLabel = (code: string | null) =>
    code ? (t.collectionStages[code as keyof typeof t.collectionStages] ?? code) : '—';

  return (
    <>
      <PageHeader
        title={t.collection.title}
        subtitle={t.collection.subtitle}
        actions={
          writable ? (
            <RunCollectionButton
              labels={{ run: t.collection.run, running: t.collection.running, opened: t.collection.opened, closed: t.collection.closed }}
            />
          ) : undefined
        }
      />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.collection.phaseNote}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label={t.collection.toChase} value={String(summary.chaseable)} />
        <StatTile
          label={t.collection.overdueTotal}
          value={formatMoney(summary.totalOverdue, currency, locale, { compact: true })}
        />
        <StatTile
          label={t.collection.promisesDue}
          value={String(summary.promisesDueToday)}
          tone={summary.promisesDueToday > 0 ? 'warn' : undefined}
        />
        <StatTile
          label={t.collection.promisesBroken}
          value={String(summary.promisesBroken)}
          hint={kept.ratePct === null ? t.collection.noPromiseHistory : `${t.collection.keptRate} ${formatPercent(kept.ratePct, locale, 0)}`}
          tone={summary.promisesBroken > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label={t.collection.onHold}
          value={String(summary.onHold)}
          hint={summary.neverContacted > 0 ? `${summary.neverContacted} ${t.collection.neverContacted}` : undefined}
        />
      </div>

      <div className="mt-4">
        <Card title={t.collection.todaysQueue} footer={t.collection.queueNote}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.collection.party}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.collection.overdue}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.collection.dpd}</th>
                <th className="py-2 pr-3 font-medium">{t.collection.suggestedStage}</th>
                <th className="py-2 pr-3 font-medium">{t.collection.why}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.collection.priority}</th>
                <th className="py-2 font-medium">{t.collection.log}</th>
              </tr>
            }
          >
            {queue.map((q) => (
              <tr
                key={q.case.caseId}
                className={`border-b border-[var(--color-line)] align-top last:border-0 ${q.onHold ? 'opacity-60' : ''}`}
              >
                <td className="py-2 pr-3">
                  <Link href={`/${locale}/parties/${q.case.partyId}`} className="font-medium text-[var(--color-brand)]">
                    {q.case.partyName}
                  </Link>
                  <div className="text-[11px] text-[var(--color-muted)]">
                    {q.case.legalEntityCode}
                    {q.case.grade ? ` · ${q.case.grade}` : ''}
                    {q.daysSinceContact === null
                      ? ` · ${t.collection.neverContacted}`
                      : ` · ${t.collection.contacted} ${q.daysSinceContact}${t.collection.daysShort}`}
                  </div>
                  {q.onHold ? (
                    <div className="mt-1 inline-block rounded bg-[#eef4ff] px-1.5 py-0.5 text-[11px] text-[#175cd3]">
                      {t.collection.held}: {q.holdReason}
                    </div>
                  ) : null}
                </td>
                <td className="tabular py-2 pr-3 text-right font-medium">
                  {formatMoney(q.case.overdueAmount, currency, locale, { compact: true })}
                  <div className="text-[11px] font-normal text-[var(--color-muted)]">
                    {formatMoney(q.case.openAmount, currency, locale, { compact: true })} {t.collection.open}
                  </div>
                </td>
                <td className="tabular py-2 pr-3 text-right">{q.case.maxDpd}</td>
                <td className="py-2 pr-3 text-xs">
                  <div>{stageLabel(q.suggestedStage)}</div>
                  {q.case.stage && q.case.stage !== q.suggestedStage ? (
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {t.collection.currentStage} {stageLabel(q.case.stage)}
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  <ul className="max-w-64 space-y-0.5 text-[11px] text-[var(--color-muted)]">
                    {q.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  {q.promiseState === 'broken' ? (
                    <span className="mt-1 inline-block rounded bg-[#fef3f2] px-1.5 py-0.5 text-[11px] text-[#b42318]">
                      {t.collection.promiseBroken}
                    </span>
                  ) : null}
                  {q.promiseState === 'due_today' ? (
                    <span className="mt-1 inline-block rounded bg-[#fffaeb] px-1.5 py-0.5 text-[11px] text-[#b54708]">
                      {t.collection.promiseDueToday}
                    </span>
                  ) : null}
                </td>
                <td className="tabular py-2 pr-3 text-right">
                  {q.priority.toFixed(0)}
                  {q.case.manualRank !== null ? (
                    <div className="text-[11px] font-normal text-[#175cd3]">{t.collection.manualOrder}</div>
                  ) : null}
                </td>
                <td className="py-2">
                  {writable && !q.onHold ? (
                    <ActivityPanel
                      caseId={q.case.caseId}
                      disputeReasons={policy.disputeReasons}
                      labels={{
                        logContact: t.collection.logContact,
                        outcome: t.collection.outcome,
                        note: t.collection.note,
                        promiseAmount: t.collection.promiseAmount,
                        promiseDate: t.collection.promiseDate,
                        addPromise: t.collection.addPromise,
                        addDispute: t.collection.addDispute,
                        disputeReason: t.collection.disputeReason,
                        save: t.collection.save,
                        saving: t.collection.saving,
                        moveUp: t.collection.moveUp,
                        types: {
                          call: t.collectionActivity.call,
                          email: t.collectionActivity.email,
                          letter: t.collectionActivity.letter,
                          visit: t.collectionActivity.visit,
                          note: t.collectionActivity.note,
                        },
                      }}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <p className="mt-3 text-xs text-[var(--color-muted)]">
        {t.collection.vsWatchlist}
        {rows.some((r) => r.next_action_at) ? null : null}
        {' '}
        {t.common.asOf} {formatDate(asOf, locale)}
      </p>
    </>
  );
}
