import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { FinancialStatement } from '@creditmesh/core';
import { analyseFinancials, computeRatios } from '@creditmesh/core';
import { isLocale } from '../../../../lib/i18n/config';
import { getDictionary } from '../../../../lib/i18n/dictionaries';
import { requireSession } from '../../../../lib/session';
import { createClient } from '../../../../lib/supabase/server';
import { formatDate, formatMoney, formatNumber, formatPercent } from '../../../../lib/format';
import { Card, FlagChip, GradeBadge, PageHeader, Table } from '../../../../components/ui';

export default async function PartyPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale: raw, id } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;

  const [{ data: party }, { data: statements }, { data: exposure }, { data: identifiers }, { data: risk }, { data: behavior }] =
    await Promise.all([
      supabase.from('party').select('id, legal_name, tax_id, roles, status').eq('id', id).maybeSingle(),
      supabase
        .from('financial_statement')
        .select('*')
        .eq('party_id', id)
        .order('fiscal_year', { ascending: false }),
      supabase
        .from('v_exposure_current')
        .select('legal_entity_code, as_of, ar_open, ar_overdue, total_exposure, credit_limit, utilization_pct')
        .eq('party_id', id),
      supabase.from('party_identifier').select('kind, system_id, legal_entity_code, value').eq('party_id', id),
      supabase
        .from('v_risk_current')
        .select('score, grade, components, flags, as_of')
        .eq('party_id', id)
        .maybeSingle(),
      supabase
        .from('payment_behavior')
        .select('weighted_avg_dpd, max_dpd, on_time_pct, invoice_count, period_end')
        .eq('party_id', id)
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (!party) notFound();

  // Ratios are recomputed here from the stored statements rather than read from
  // a cached column: P6 means the page must be able to show the arithmetic, and
  // the engine is the only definition of it.
  const fsRows = (statements ?? []) as unknown as Record<string, number | string | null>[];
  const canonical: FinancialStatement[] = fsRows.map((r) => ({
    id: String(r.id),
    tenantId: session.tenantId,
    partyId: id,
    fiscalYear: Number(r.fiscal_year),
    periodEnd: String(r.period_end ?? ''),
    currency: String(r.currency ?? currency),
    revenue: r.revenue === null ? null : Number(r.revenue),
    grossProfit: r.gross_profit === null ? null : Number(r.gross_profit),
    netProfit: r.net_profit === null ? null : Number(r.net_profit),
    totalAssets: r.total_assets === null ? null : Number(r.total_assets),
    totalLiabilities: r.total_liabilities === null ? null : Number(r.total_liabilities),
    equity: r.equity === null ? null : Number(r.equity),
    currentAssets: r.current_assets === null ? null : Number(r.current_assets),
    currentLiabilities: r.current_liabilities === null ? null : Number(r.current_liabilities),
    cash: r.cash === null ? null : Number(r.cash),
    inventory: r.inventory === null ? null : Number(r.inventory),
    receivables: r.receivables === null ? null : Number(r.receivables),
    providerId: String(r.provider_id ?? 'manual_upload'),
    retrievedAt: String(r.retrieved_at ?? new Date().toISOString()),
  }));

  const asOf = new Date().toISOString().slice(0, 10);
  const analysis = analyseFinancials(id, canonical, { asOf });
  const ratios = canonical.map((fs, i) => computeRatios(fs, canonical[i + 1]));
  const gradeColor = session.profile.creditPolicy.riskGrades.find((g) => g.code === risk?.grade)?.color ?? null;
  const components = (risk?.components ?? []) as { code: string; label: string; rawValue: number | null; weight: number; contribution: number }[];

  return (
    <>
      <Link href={`/${locale}/portfolio`} className="text-xs text-[var(--color-muted)]">
        ← {t.portfolio.title}
      </Link>
      <PageHeader
        title={party.legal_name}
        subtitle={`${t.portfolio.taxId}: ${party.tax_id ?? '—'}`}
        actions={
          <span className="flex items-center gap-2">
            <GradeBadge grade={risk?.grade ?? null} color={gradeColor} />
            <span className="tabular text-lg font-semibold">{formatNumber(risk?.score ?? null, locale, 1)}</span>
          </span>
        }
      />

      {analysis.flags.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1">
          {analysis.flags.map((f) => (
            <FlagChip key={f.code} code={f.code} label={locale === 'th' ? f.labelTh : f.labelEn} />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.party.scoreBreakdown} footer={`${t.common.asOf} ${formatDate(risk?.as_of ?? null, locale)}`}>
          {components.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">{t.common.noData}</p>
          ) : (
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.party.component}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.party.rawValue}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.party.weight}</th>
                  <th className="py-2 text-right font-medium">{t.party.contribution}</th>
                </tr>
              }
            >
              {components.map((c) => (
                <tr key={c.code} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="py-2 pr-3">{c.label}</td>
                  <td className="tabular py-2 pr-3 text-right">{formatNumber(c.rawValue, locale, 2)}</td>
                  <td className="tabular py-2 pr-3 text-right">{formatPercent(c.weight * 100, locale, 0)}</td>
                  <td className="tabular py-2 text-right font-medium">{formatNumber(c.contribution, locale, 1)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title={t.party.exposureByEntity}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.common.entity}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.portfolio.exposure}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.portfolio.overdue}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.portfolio.limit}</th>
                <th className="py-2 text-right font-medium">{t.portfolio.utilization}</th>
              </tr>
            }
          >
            {(exposure ?? []).map((e) => (
              <tr key={e.legal_entity_code} className="border-b border-[var(--color-line)] last:border-0">
                <td className="py-2 pr-3">{e.legal_entity_code}</td>
                <td className="tabular py-2 pr-3 text-right">{formatMoney(Number(e.total_exposure), currency, locale)}</td>
                <td className="tabular py-2 pr-3 text-right">{formatMoney(Number(e.ar_overdue), currency, locale)}</td>
                <td className="tabular py-2 pr-3 text-right">{formatMoney(e.credit_limit === null ? null : Number(e.credit_limit), currency, locale)}</td>
                <td className="tabular py-2 text-right">{formatPercent(e.utilization_pct === null ? null : Number(e.utilization_pct), locale, 0)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title={t.party.financials}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.party.fiscalYear}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.party.revenue}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.party.netProfit}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.party.equity}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.party.currentRatio}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.party.debtToEquity}</th>
                <th className="py-2 text-right font-medium">{t.party.netMargin}</th>
              </tr>
            }
          >
            {canonical.map((fs, i) => (
              <tr key={fs.fiscalYear} className="border-b border-[var(--color-line)] last:border-0">
                <td className="tabular py-2 pr-3">{fs.fiscalYear}</td>
                <td className="tabular py-2 pr-3 text-right">{formatMoney(fs.revenue, fs.currency, locale, { compact: true })}</td>
                <td className={`tabular py-2 pr-3 text-right ${(fs.netProfit ?? 0) < 0 ? 'text-[#b42318]' : ''}`}>
                  {formatMoney(fs.netProfit, fs.currency, locale, { compact: true })}
                </td>
                <td className={`tabular py-2 pr-3 text-right ${(fs.equity ?? 0) < 0 ? 'text-[#b42318]' : ''}`}>
                  {formatMoney(fs.equity, fs.currency, locale, { compact: true })}
                </td>
                <td className="tabular py-2 pr-3 text-right">{formatNumber(ratios[i]?.currentRatio ?? null, locale, 2)}</td>
                <td className="tabular py-2 pr-3 text-right">{formatNumber(ratios[i]?.debtToEquity ?? null, locale, 2)}</td>
                <td className="tabular py-2 text-right">{formatPercent(ratios[i]?.netMarginPct ?? null, locale, 1)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <div className="space-y-4">
          <Card title={t.party.paymentBehavior}>
            {behavior ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-[var(--color-muted)]">{t.party.avgDpd}</dt>
                  <dd className="tabular text-lg font-semibold">{formatNumber(Number(behavior.weighted_avg_dpd), locale, 1)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-muted)]">{t.party.onTime}</dt>
                  <dd className="tabular text-lg font-semibold">{formatPercent(Number(behavior.on_time_pct), locale, 0)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">{t.common.noData}</p>
            )}
          </Card>

          <Card title={t.party.identifiers}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">kind</th>
                  <th className="py-2 pr-3 font-medium">system</th>
                  <th className="py-2 pr-3 font-medium">{t.common.entity}</th>
                  <th className="py-2 font-medium">value</th>
                </tr>
              }
            >
              {(identifiers ?? []).map((idf, i) => (
                <tr key={i} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="py-2 pr-3">{idf.kind}</td>
                  <td className="py-2 pr-3">{idf.system_id || '—'}</td>
                  <td className="py-2 pr-3">{idf.legal_entity_code || '—'}</td>
                  <td className="tabular py-2">{idf.value}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
