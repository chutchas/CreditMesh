import Link from 'next/link';
import { isLocale } from '../../lib/i18n/config';
import { getDictionary } from '../../lib/i18n/dictionaries';
import { requireSession } from '../../lib/session';
import { createClient } from '../../lib/supabase/server';
import { formatDate, formatMoney, formatRelative } from '../../lib/format';
import { Card, Empty, GradeBadge, PageHeader, StatTile, Table } from '../../components/ui';

interface PortfolioRow {
  party_id: string;
  legal_name: string;
  total_exposure: number | null;
  total_ar_overdue: number | null;
  grade: string | null;
  flags: { code: string; severity: string }[] | null;
  exposure_as_of: string | null;
}

interface FreshnessRow {
  dataset_id: string;
  system_id: string;
  last_success_at: string | null;
  data_as_of: string | null;
  stale_after_hours: number;
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;

  const [{ data: portfolio }, { data: freshness }] = await Promise.all([
    supabase
      .from('v_party_portfolio')
      .select('party_id, legal_name, total_exposure, total_ar_overdue, grade, flags, exposure_as_of'),
    supabase.from('dataset_freshness').select('dataset_id, system_id, last_success_at, data_as_of, stale_after_hours'),
  ]);

  const rows = (portfolio ?? []) as PortfolioRow[];

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title={t.dashboard.title} subtitle={t.dashboard.subtitle} />
        <Empty title={t.dashboard.emptyState} hint={t.dashboard.emptyStateCta} />
        <div className="mt-4">
          <Link href={`/${locale}/import`} className="text-sm text-[var(--color-brand)] underline">
            {t.nav.import} →
          </Link>
        </div>
      </>
    );
  }

  const totalExposure = rows.reduce((sum, r) => sum + Number(r.total_exposure ?? 0), 0);
  const totalOverdue = rows.reduce((sum, r) => sum + Number(r.total_ar_overdue ?? 0), 0);
  const criticalCount = rows.filter((r) => (r.flags ?? []).some((f) => f.severity === 'critical')).length;

  const byGrade = new Map<string, { count: number; exposure: number }>();
  for (const r of rows) {
    const key = r.grade ?? '—';
    const entry = byGrade.get(key) ?? { count: 0, exposure: 0 };
    entry.count += 1;
    entry.exposure += Number(r.total_exposure ?? 0);
    byGrade.set(key, entry);
  }
  const gradeOrder = session.profile.creditPolicy.riskGrades.map((g) => g.code);
  const gradeRows = [...byGrade.entries()].sort(
    (a, b) => (gradeOrder.indexOf(a[0]) + 99) % 100 - ((gradeOrder.indexOf(b[0]) + 99) % 100),
  );
  const gradeColor = (code: string) =>
    session.profile.creditPolicy.riskGrades.find((g) => g.code === code)?.color ?? null;

  const now = Date.now();
  const freshnessRows = (freshness ?? []) as FreshnessRow[];

  return (
    <>
      <PageHeader title={t.dashboard.title} subtitle={t.dashboard.subtitle} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t.dashboard.partiesTracked} value={rows.length.toLocaleString()} />
        <StatTile label={t.dashboard.totalExposure} value={formatMoney(totalExposure, currency, locale, { compact: true })} />
        <StatTile
          label={t.dashboard.overdue}
          value={formatMoney(totalOverdue, currency, locale, { compact: true })}
          tone={totalOverdue > 0 ? 'warn' : 'neutral'}
        />
        <StatTile
          label={t.dashboard.criticalFlags}
          value={criticalCount.toLocaleString()}
          tone={criticalCount > 0 ? 'bad' : 'good'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={t.dashboard.byGrade}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.portfolio.grade}</th>
                <th className="py-2 pr-3 font-medium">{t.common.party}</th>
                <th className="py-2 text-right font-medium">{t.portfolio.exposure}</th>
              </tr>
            }
          >
            {gradeRows.map(([grade, agg]) => (
              <tr key={grade} className="border-b border-[var(--color-line)] last:border-0">
                <td className="py-2 pr-3">
                  {grade === '—' ? (
                    <span className="text-xs text-[var(--color-muted)]">{t.portfolio.ungraded}</span>
                  ) : (
                    <GradeBadge grade={grade} color={gradeColor(grade)} />
                  )}
                </td>
                <td className="tabular py-2 pr-3">{agg.count.toLocaleString()}</td>
                <td className="tabular py-2 text-right">{formatMoney(agg.exposure, currency, locale, { compact: true })}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title={t.dashboard.dataFreshness}>
          {freshnessRows.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">{t.common.never}</p>
          ) : (
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.importer.dataset}</th>
                  <th className="py-2 pr-3 font-medium">{t.importer.dataAsOf}</th>
                  <th className="py-2 font-medium">{t.common.asOf}</th>
                </tr>
              }
            >
              {freshnessRows.map((f) => {
                const stale =
                  !f.last_success_at || now - Date.parse(f.last_success_at) > f.stale_after_hours * 3_600_000;
                return (
                  <tr key={`${f.system_id}:${f.dataset_id}`} className="border-b border-[var(--color-line)] last:border-0">
                    <td className="py-2 pr-3">{f.dataset_id}</td>
                    <td className="py-2 pr-3">{formatDate(f.data_as_of, locale)}</td>
                    <td className={`py-2 ${stale ? 'text-[#b54708]' : 'text-[var(--color-muted)]'}`}>
                      {formatRelative(f.last_success_at, locale)}
                      {stale ? ` · ${t.common.staleWarning}` : ''}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
