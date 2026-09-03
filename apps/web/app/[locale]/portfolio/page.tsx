import Link from 'next/link';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatMoney, formatNumber, formatPercent } from '../../../lib/format';
import { Card, Empty, FlagChip, GradeBadge, PageHeader, Table } from '../../../components/ui';
import RunAnalysisButton from './run-analysis-button';

interface Row {
  party_id: string;
  legal_name: string;
  tax_id: string | null;
  entity_count: number;
  total_exposure: number | null;
  total_ar_overdue: number | null;
  total_credit_limit: number | null;
  utilization_pct: number | null;
  exposure_as_of: string | null;
  score: number | null;
  grade: string | null;
  flags: { code: string; severity: string }[] | null;
  latest_fiscal_year: number | null;
}

export default async function PortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ grade?: string }>;
}) {
  const { locale: raw } = await params;
  const { grade: gradeFilter } = await searchParams;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;

  let query = supabase
    .from('v_party_portfolio')
    .select(
      'party_id, legal_name, tax_id, entity_count, total_exposure, total_ar_overdue, total_credit_limit, utilization_pct, exposure_as_of, score, grade, flags, latest_fiscal_year',
    )
    // Largest exposure first: the report is read from the top and the reader
    // stops when they run out of time, so the biggest risk must be on screen.
    .order('total_exposure', { ascending: false, nullsFirst: false })
    .limit(500);

  if (gradeFilter) query = query.eq('grade', gradeFilter);

  const { data, error } = await query;
  const rows = (data ?? []) as Row[];

  const gradeColor = (code: string | null) =>
    code ? session.profile.creditPolicy.riskGrades.find((g) => g.code === code)?.color ?? null : null;

  const flagLabel = (code: string) => t.flags[code as keyof typeof t.flags] ?? code;

  return (
    <>
      <PageHeader
        title={t.portfolio.title}
        subtitle={t.portfolio.subtitle}
        actions={
          <>
            <RunAnalysisButton label={t.portfolio.runAnalysis} />
            <a
              href={`/api/export/portfolio?locale=${locale}${gradeFilter ? `&grade=${gradeFilter}` : ''}`}
              className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm"
            >
              {t.common.export}
            </a>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--color-muted)]">{t.portfolio.filterGrade}:</span>
        <Link
          href={`/${locale}/portfolio`}
          className={`rounded border px-2 py-1 ${!gradeFilter ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-[var(--color-line)]'}`}
        >
          {t.common.all}
        </Link>
        {session.profile.creditPolicy.riskGrades.map((g) => (
          <Link
            key={g.code}
            href={`/${locale}/portfolio?grade=${g.code}`}
            className={`rounded border px-2 py-1 ${gradeFilter === g.code ? 'border-[var(--color-brand)] text-[var(--color-brand)]' : 'border-[var(--color-line)]'}`}
          >
            {g.code} · {g.label}
          </Link>
        ))}
      </div>

      {error ? (
        <Empty title={error.message} />
      ) : rows.length === 0 ? (
        <Empty title={t.common.noData} hint={t.dashboard.emptyStateCta} />
      ) : (
        <Card>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.portfolio.legalName}</th>
                <th className="py-2 pr-3 font-medium">{t.portfolio.grade}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.portfolio.score}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.portfolio.exposure}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.portfolio.overdue}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.portfolio.limit}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.portfolio.utilization}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.portfolio.entities}</th>
                <th className="py-2 pr-3 font-medium">{t.portfolio.flags}</th>
                <th className="py-2 text-right font-medium">{t.portfolio.latestFy}</th>
              </tr>
            }
          >
            {rows.map((r) => (
              <tr key={r.party_id} className="border-b border-[var(--color-line)] align-top last:border-0">
                <td className="py-2 pr-3">
                  <Link href={`/${locale}/parties/${r.party_id}`} className="font-medium text-[var(--color-brand)]">
                    {r.legal_name}
                  </Link>
                  <div className="tabular text-[11px] text-[var(--color-muted)]">{r.tax_id ?? '—'}</div>
                </td>
                <td className="py-2 pr-3">
                  <GradeBadge grade={r.grade} color={gradeColor(r.grade)} />
                </td>
                <td className="tabular py-2 pr-3 text-right">{formatNumber(r.score, locale, 1)}</td>
                <td className="tabular py-2 pr-3 text-right">{formatMoney(r.total_exposure, currency, locale, { compact: true })}</td>
                <td className="tabular py-2 pr-3 text-right">
                  {Number(r.total_ar_overdue ?? 0) > 0 ? (
                    <span className="text-[#b54708]">{formatMoney(r.total_ar_overdue, currency, locale, { compact: true })}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="tabular py-2 pr-3 text-right">{formatMoney(r.total_credit_limit, currency, locale, { compact: true })}</td>
                <td className="tabular py-2 pr-3 text-right">{formatPercent(r.utilization_pct, locale, 0)}</td>
                <td className="tabular py-2 pr-3 text-right">{r.entity_count}</td>
                <td className="py-2 pr-3">
                  <div className="flex max-w-56 flex-wrap gap-1">
                    {(r.flags ?? []).map((f) => (
                      <FlagChip key={f.code} code={f.code} label={flagLabel(f.code)} />
                    ))}
                  </div>
                </td>
                <td className="tabular py-2 text-right">{r.latest_fiscal_year ?? '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <p className="mt-3 text-xs text-[var(--color-muted)]">
        {t.common.asOf} {formatDate(rows[0]?.exposure_as_of ?? null, locale)}
      </p>
    </>
  );
}
