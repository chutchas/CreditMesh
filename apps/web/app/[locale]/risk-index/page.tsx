import Link from 'next/link';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatNumber, formatPercent } from '../../../lib/format';
import { Card, Empty, GradeBadge, PageHeader, StatTile, Table } from '../../../components/ui';
import RunIndexButton from './run-index-button';

/**
 * Module 17 — Customer Risk Index.
 *
 * §7 names the risk this module carries: one credible-looking number makes
 * people stop looking at what is underneath, which is worse than no number.
 * So the components are on the page, open, next to the score — not behind a
 * click — and every counterparty's row says how many of the nine components
 * were actually scored.
 *
 * A score built from three components and a score built from nine are not the
 * same object even at the same value, and the page says so rather than leaving
 * the reader to assume they are comparable.
 */
export default async function RiskIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const writable = canWrite(session);

  const [{ data: current }, { data: parties }] = await Promise.all([
    supabase
      .from('v_risk_index_current')
      .select('id, party_id, as_of, score, grade, blocked_by, components_scored, components_enabled, incomplete, recommended_action'),
    supabase.from('party').select('id, legal_name'),
  ]);

  const rows = (current ?? []) as {
    id: string;
    party_id: string;
    as_of: string;
    score: number | null;
    grade: string | null;
    blocked_by: string | null;
    components_scored: number;
    components_enabled: number;
    incomplete: boolean;
    recommended_action: string | null;
  }[];

  const runButton = writable ? (
    <RunIndexButton
      labels={{ run: t.riskIndex.run, running: t.riskIndex.running, scored: t.riskIndex.scoredLabel, blocked: t.riskIndex.blockedLabel }}
    />
  ) : undefined;

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title={t.riskIndex.title} subtitle={t.riskIndex.subtitle} actions={runButton} />
        <Empty title={t.riskIndex.noData} hint={t.riskIndex.noDataHint} />
      </>
    );
  }

  const nameByParty = new Map(((parties ?? []) as { id: string; legal_name: string }[]).map((p) => [p.id, p.legal_name]));

  const { data: components } = await supabase
    .from('risk_index_component')
    .select('risk_index_id, code, weight, effective_weight, value, available, absence_rule, contribution, note')
    .in('risk_index_id', rows.map((r) => r.id));

  const componentsByIndex = new Map<string, typeof componentRows>();
  const componentRows = (components ?? []) as {
    risk_index_id: string;
    code: string;
    weight: number;
    effective_weight: number;
    value: number | null;
    available: boolean;
    absence_rule: string;
    contribution: number;
    note: string | null;
  }[];
  for (const c of componentRows) {
    const bucket = componentsByIndex.get(c.risk_index_id) ?? [];
    bucket.push(c);
    componentsByIndex.set(c.risk_index_id, bucket);
  }

  const gradeColor = (code: string | null) =>
    code ? (session.profile.creditPolicy.riskGrades.find((g) => g.code === code)?.color ?? null) : null;
  const componentLabel = (code: string) => t.indexComponents[code as keyof typeof t.indexComponents] ?? code;
  const absenceLabel = (rule: string) => t.absenceRules[rule as keyof typeof t.absenceRules] ?? rule;

  const ranked = [...rows].sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
  const incompleteCount = rows.filter((r) => r.incomplete).length;
  const blockedCount = rows.filter((r) => r.blocked_by).length;
  const avgAvailability =
    rows.reduce((s, r) => s + (r.components_enabled === 0 ? 0 : r.components_scored / r.components_enabled), 0) /
    rows.length;

  return (
    <>
      <PageHeader title={t.riskIndex.title} subtitle={t.riskIndex.subtitle} actions={runButton} />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.riskIndex.notABlackBoxNote}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t.riskIndex.scored} value={String(rows.length - blockedCount)} />
        <StatTile
          label={t.riskIndex.incomplete}
          value={String(incompleteCount)}
          hint={t.riskIndex.incompleteHint}
          tone={incompleteCount > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label={t.riskIndex.blocked}
          value={String(blockedCount)}
          hint={t.riskIndex.blockedHint}
          tone={blockedCount > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label={t.riskIndex.dataAvailability}
          value={formatPercent(avgAvailability * 100, locale, 0)}
          hint={t.riskIndex.dataAvailabilityHint}
        />
      </div>

      <div className="mt-4 space-y-3">
        {ranked.map((r) => {
          const parts = componentsByIndex.get(r.id) ?? [];
          return (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <Link href={`/${locale}/parties/${r.party_id}`} className="text-sm font-semibold text-[var(--color-brand)]">
                    {nameByParty.get(r.party_id) ?? r.party_id}
                  </Link>
                  <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                    {t.riskIndex.asOf} {formatDate(r.as_of, locale)} · {r.components_scored}/{r.components_enabled}{' '}
                    {t.riskIndex.componentsScored}
                  </div>
                  {r.recommended_action ? (
                    <div className="mt-1 rounded bg-[var(--color-canvas)] px-2 py-1 text-xs">
                      {t.riskIndex.suggestedAction}: {r.recommended_action}
                    </div>
                  ) : null}
                </div>
                <div className="text-right">
                  {r.blocked_by ? (
                    <div className="rounded bg-[#fef3f2] px-2 py-1 text-xs text-[#b42318]">
                      {t.riskIndex.noScoreBecause} {componentLabel(r.blocked_by)}
                    </div>
                  ) : (
                    <div className="flex items-center justify-end gap-2">
                      <GradeBadge grade={r.grade} color={gradeColor(r.grade)} />
                      <span className="tabular text-2xl font-semibold">
                        {r.score === null ? '—' : formatNumber(Number(r.score), locale, 1)}
                      </span>
                    </div>
                  )}
                  {r.incomplete && !r.blocked_by ? (
                    <div className="mt-1 rounded bg-[#fffaeb] px-1.5 py-0.5 text-[11px] text-[#b54708]">
                      {t.riskIndex.incompleteBadge}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Components stay open. Hiding them behind a disclosure is how a
                  score becomes the black box §7 warns about. */}
              <div className="mt-3">
                <Table
                  head={
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">{t.riskIndex.component}</th>
                      <th className="py-1.5 pr-3 text-right font-medium">{t.riskIndex.weight}</th>
                      <th className="py-1.5 pr-3 text-right font-medium">{t.riskIndex.value}</th>
                      <th className="py-1.5 pr-3 text-right font-medium">{t.riskIndex.contribution}</th>
                      <th className="py-1.5 font-medium">{t.riskIndex.dataStatus}</th>
                    </tr>
                  }
                >
                  {parts.map((c) => (
                    <tr
                      key={c.code}
                      className={`border-b border-[var(--color-line)] last:border-0 ${c.available ? '' : 'text-[var(--color-muted)]'}`}
                    >
                      <td className="py-1.5 pr-3 text-xs">{componentLabel(c.code)}</td>
                      <td className="tabular py-1.5 pr-3 text-right text-xs">
                        {formatPercent(Number(c.weight) * 100, locale, 0)}
                        {Number(c.effective_weight) !== Number(c.weight) ? (
                          <span className="text-[11px]"> → {formatPercent(Number(c.effective_weight) * 100, locale, 0)}</span>
                        ) : null}
                      </td>
                      <td className="tabular py-1.5 pr-3 text-right text-xs">
                        {c.value === null ? '—' : formatNumber(Number(c.value), locale, 0)}
                      </td>
                      <td className="tabular py-1.5 pr-3 text-right text-xs">
                        {formatNumber(Number(c.contribution), locale, 1)}
                      </td>
                      <td className="py-1.5 text-[11px]">
                        {c.available ? (
                          <span className="text-[#1a7f37]">{t.riskIndex.hasData}</span>
                        ) : (
                          <span>
                            {absenceLabel(c.absence_rule)}
                            {c.note ? ` — ${c.note}` : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-[var(--color-muted)]">{t.riskIndex.absenceNote}</p>
    </>
  );
}
