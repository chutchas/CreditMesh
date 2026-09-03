import Link from 'next/link';
import type { FinancialStatement, SupplierDependency } from '@creditmesh/core';
import { analyseFinancials, assessSupplier, rankSuppliers, summariseSupplierWatch } from '@creditmesh/core';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatMoney, formatNumber, formatPercent } from '../../../lib/format';
import { Card, Empty, FlagChip, GradeBadge, PageHeader, StatTile, Table } from '../../../components/ui';

/**
 * Module 9 — Supplier Financial Watch.
 *
 * Every number here is computed at read time from the same engines the
 * receivables side uses. Nothing about the analysis changed to serve suppliers;
 * only the register feeding it did, which is what P3 bought when it refused to
 * create a second counterparty table.
 */
export default async function SuppliersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;
  const asOf = new Date().toISOString().slice(0, 10);

  const { data: dependencies } = await supabase
    .from('v_supplier_dependency')
    .select(
      'party_id, legal_name, tax_id, entity_count, open_commitment, annual_spend, category_share, is_single_source, switching_lead_time_days, category',
    );

  const rowsRaw = (dependencies ?? []) as {
    party_id: string;
    legal_name: string;
    tax_id: string | null;
    entity_count: number;
    open_commitment: number | null;
    annual_spend: number | null;
    category_share: number | null;
    is_single_source: boolean;
    switching_lead_time_days: number | null;
    category: string | null;
  }[];

  if (rowsRaw.length === 0) {
    return (
      <>
        <PageHeader title={t.suppliers.title} subtitle={t.suppliers.subtitle} />
        <Empty title={t.suppliers.noData} hint={t.suppliers.noDataHint} />
      </>
    );
  }

  const partyIds = rowsRaw.map((r) => r.party_id);

  const [{ data: risk }, { data: statements }] = await Promise.all([
    supabase.from('v_risk_current').select('party_id, score, grade').in('party_id', partyIds),
    supabase.from('financial_statement').select('*').in('party_id', partyIds),
  ]);

  const riskByParty = new Map((risk ?? []).map((r) => [r.party_id, r]));

  const statementsByParty = new Map<string, FinancialStatement[]>();
  for (const r of (statements ?? []) as Record<string, string | number | null>[]) {
    const statement: FinancialStatement = {
      id: String(r.id),
      tenantId: session.tenantId,
      partyId: String(r.party_id),
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
    };
    const bucket = statementsByParty.get(statement.partyId);
    if (bucket) bucket.push(statement);
    else statementsByParty.set(statement.partyId, [statement]);
  }

  const assessed = rowsRaw.map((row) => {
    const dependency: SupplierDependency = {
      partyId: row.party_id,
      openCommitment: Number(row.open_commitment ?? 0),
      annualSpend: Number(row.annual_spend ?? 0),
      categoryShare: row.category_share === null ? null : Number(row.category_share),
      isSingleSource: row.is_single_source,
      switchingLeadTimeDays: row.switching_lead_time_days,
      category: row.category,
    };
    const analysis = analyseFinancials(row.party_id, statementsByParty.get(row.party_id) ?? [], { asOf });
    const scored = riskByParty.get(row.party_id);
    return assessSupplier(
      row.party_id,
      row.legal_name,
      dependency,
      analysis,
      scored?.score == null ? null : Number(scored.score),
      scored?.grade ?? null,
      { asOf },
    );
  });

  const ranked = rankSuppliers(assessed);
  const summary = summariseSupplierWatch(ranked, currency);
  const gradeColor = (code: string | null) =>
    code ? session.profile.creditPolicy.riskGrades.find((g) => g.code === code)?.color ?? null : null;
  const flagLabel = (code: string) => t.flags[code as keyof typeof t.flags] ?? code;

  return (
    <>
      <PageHeader title={t.suppliers.title} subtitle={t.suppliers.subtitle} />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.suppliers.twoDimensions}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t.suppliers.tracked} value={String(summary.suppliersTracked)} />
        <StatTile label={t.suppliers.singleSourced} value={String(summary.singleSourced)} />
        <StatTile
          label={t.suppliers.atRisk}
          value={String(summary.singleSourcedAndFlagged)}
          tone={summary.singleSourcedAndFlagged > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label={t.suppliers.disruptionExposure}
          value={formatMoney(summary.totalDisruptionExposure, currency, locale, { compact: true })}
        />
      </div>

      <div className="mt-4">
        <Card>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.suppliers.supplier}</th>
                <th className="py-2 pr-3 font-medium">{t.suppliers.fragility}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.suppliers.openCommitment}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.suppliers.annualSpend}</th>
                <th className="py-2 pr-3 text-center font-medium">{t.suppliers.singleSource}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.suppliers.coverageGap}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.suppliers.leadTime}</th>
                <th className="py-2 text-right font-medium">{t.suppliers.disruptionExposure}</th>
              </tr>
            }
          >
            {ranked.map((row) => (
              <tr key={row.partyId} className="border-b border-[var(--color-line)] align-top last:border-0">
                <td className="py-2 pr-3">
                  <Link href={`/${locale}/parties/${row.partyId}`} className="font-medium text-[var(--color-brand)]">
                    {row.legalName}
                  </Link>
                  {row.dependency.category ? (
                    <div className="text-[11px] text-[var(--color-muted)]">{row.dependency.category}</div>
                  ) : null}
                  {row.flags.length > 0 ? (
                    <div className="mt-1 flex max-w-56 flex-wrap gap-1">
                      {row.flags.map((f) => (
                        <FlagChip key={f.code} code={f.code} label={flagLabel(f.code)} />
                      ))}
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  {row.fragilityScore === null ? (
                    <span className="text-xs text-[var(--color-muted)]">{t.suppliers.notScored}</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <GradeBadge grade={row.grade} color={gradeColor(row.grade)} />
                      <span className="tabular text-xs">{formatNumber(row.fragilityScore, locale, 1)}</span>
                    </span>
                  )}
                </td>
                <td className="tabular py-2 pr-3 text-right">
                  {formatMoney(row.dependency.openCommitment, currency, locale, { compact: true })}
                </td>
                <td className="tabular py-2 pr-3 text-right">
                  {formatMoney(row.dependency.annualSpend, currency, locale, { compact: true })}
                </td>
                <td className="py-2 pr-3 text-center">
                  {row.dependency.isSingleSource ? (
                    <span className="rounded bg-[#b42318] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      {t.suppliers.yes}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--color-muted)]">{t.suppliers.no}</span>
                  )}
                </td>
                <td className="tabular py-2 pr-3 text-right">{formatPercent(row.coverageGap * 100, locale, 0)}</td>
                <td className="tabular py-2 pr-3 text-right">
                  {row.dependency.switchingLeadTimeDays === null ? (
                    <span className="text-[var(--color-muted)]">
                      60 <span className="text-[10px]">({t.suppliers.assumedLeadTime})</span>
                    </span>
                  ) : (
                    row.dependency.switchingLeadTimeDays
                  )}
                </td>
                <td className="py-2 text-right">
                  <div className="tabular font-semibold">
                    {formatMoney(row.disruptionExposure, currency, locale, { compact: true })}
                  </div>
                  {/* The interruption half is shown separately: it is an
                      estimate built on a lead time, and a reader should be able
                      to see how much of the headline rests on it. */}
                  <div className="tabular text-[11px] text-[var(--color-muted)]">
                    + {formatMoney(row.interruptionValue, currency, locale, { compact: true })}{' '}
                    {t.suppliers.interruption}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <p className="mt-3 text-xs text-[var(--color-muted)]">{t.suppliers.priorityNote}</p>
    </>
  );
}
