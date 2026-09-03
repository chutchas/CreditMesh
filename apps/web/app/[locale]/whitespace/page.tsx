import Link from 'next/link';
import type { CustomerFootprint } from '@creditmesh/core';
import { findWhiteSpace, summariseWhiteSpace } from '@creditmesh/core';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatMoney } from '../../../lib/format';
import { Card, Empty, PageHeader, StatTile, Table } from '../../../components/ui';

/**
 * Module 6 — White space.
 *
 * The half of the module that needs nothing outside the platform: who buys
 * from one of the group's entities and not from the others. No single ERP can
 * answer it, and this one already holds the data.
 *
 * Customers with something against them are listed with the reason rather than
 * filtered out. Hiding them leaves sales wondering why an obvious name is
 * missing, and credit's reason for holding back is exactly what sales needs to
 * know before they call.
 *
 * §7's non-technical warning is on the page too: a list nobody in sales has
 * agreed to own is a list nobody calls.
 */
export default async function WhiteSpacePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;

  const entityCodes = session.profile.legalEntities.filter((e) => e.isActive).map((e) => e.code);

  const [{ data: exposures }, { data: portfolio }] = await Promise.all([
    supabase.from('v_exposure_current').select('party_id, legal_entity_code, total_exposure, ar_open'),
    supabase.from('v_party_portfolio').select('party_id, legal_name, grade, total_ar_overdue, roles'),
  ]);

  const portfolioRows = (portfolio ?? []) as {
    party_id: string;
    legal_name: string;
    grade: string | null;
    total_ar_overdue: number | null;
    roles: string[];
  }[];

  const byParty = new Map<string, { legalEntityCode: string; revenue: number; sinceDate: null }[]>();
  for (const e of (exposures ?? []) as { party_id: string; legal_entity_code: string; ar_open: number | null }[]) {
    const bucket = byParty.get(e.party_id) ?? [];
    bucket.push({ legalEntityCode: e.legal_entity_code, revenue: Number(e.ar_open ?? 0), sinceDate: null });
    byParty.set(e.party_id, bucket);
  }

  const footprints: CustomerFootprint[] = portfolioRows
    .filter((p) => (p.roles ?? []).includes('customer'))
    .map((p) => ({
      partyId: p.party_id,
      partyName: p.legal_name,
      entities: byParty.get(p.party_id) ?? [],
      grade: p.grade,
      overdueAnywhere: Number(p.total_ar_overdue ?? 0),
    }));

  const grades = [...session.profile.creditPolicy.riskGrades].sort((a, b) => a.minScore - b.minScore);
  const items = findWhiteSpace(footprints, entityCodes, {
    minRevenueToRank: 0,
    worstGradeCode: grades[0]?.code ?? null,
  });
  const summary = summariseWhiteSpace(items);

  if (entityCodes.length < 2) {
    return (
      <>
        <PageHeader title={t.whitespace.title} subtitle={t.whitespace.subtitle} />
        <Empty title={t.whitespace.oneEntity} hint={t.whitespace.oneEntityHint} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.whitespace.title} subtitle={t.whitespace.subtitle} />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.whitespace.ownerNote}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label={t.whitespace.opportunities} value={String(summary.counterparties)} />
        <StatTile label={t.whitespace.clean} value={String(summary.clean)} tone="good" />
        <StatTile
          label={t.whitespace.withCautions}
          value={String(summary.withCautions)}
          tone={summary.withCautions > 0 ? 'warn' : undefined}
        />
        <StatTile
          label={t.whitespace.revenueToday}
          value={formatMoney(summary.totalCurrentRevenue, currency, locale, { compact: true })}
        />
      </div>

      {items.length === 0 ? (
        <div className="mt-4">
          <Empty title={t.whitespace.noData} hint={t.whitespace.noDataHint} />
        </div>
      ) : (
        <div className="mt-4">
          <Card title={t.whitespace.crossSell} footer={t.whitespace.scoreNote}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.whitespace.party}</th>
                  <th className="py-2 pr-3 font-medium">{t.whitespace.buysFrom}</th>
                  <th className="py-2 pr-3 font-medium">{t.whitespace.notYetIn}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.whitespace.revenueToday}</th>
                  <th className="py-2 font-medium">{t.whitespace.creditView}</th>
                </tr>
              }
            >
              {items.map((item) => (
                <tr key={item.partyId} className="border-b border-[var(--color-line)] align-top last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/${locale}/parties/${item.partyId}`} className="font-medium text-[var(--color-brand)]">
                      {item.partyName}
                    </Link>
                    {item.grade ? <div className="text-[11px] text-[var(--color-muted)]">{item.grade}</div> : null}
                  </td>
                  <td className="py-2 pr-3 text-xs">{item.presentIn.join(', ')}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {item.absentFrom.map((code) => (
                        <span key={code} className="rounded bg-[#eef4ff] px-1.5 py-0.5 text-[11px] text-[#175cd3]">
                          {code}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="tabular py-2 pr-3 text-right">
                    {formatMoney(item.currentRevenue, currency, locale, { compact: true })}
                  </td>
                  <td className="py-2 text-[11px]">
                    {item.cautions.length === 0 ? (
                      <span className="text-[#1a7f37]">{t.whitespace.noObjection}</span>
                    ) : (
                      <ul className="space-y-0.5 text-[#b54708]">
                        {item.cautions.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}

      <div className="mt-4">
        <Card title={t.whitespace.byEntity}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.whitespace.entity}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.whitespace.notYetBuying}</th>
                <th className="py-2 text-right font-medium">{t.whitespace.spendElsewhere}</th>
              </tr>
            }
          >
            {summary.byEntity.map((e) => (
              <tr key={e.legalEntityCode} className="border-b border-[var(--color-line)] last:border-0">
                <td className="py-2 pr-3 text-xs">
                  {session.profile.legalEntities.find((x) => x.code === e.legalEntityCode)?.displayName ??
                    e.legalEntityCode}
                </td>
                <td className="tabular py-2 pr-3 text-right text-xs">{e.absentCount}</td>
                <td className="tabular py-2 text-right">
                  {formatMoney(e.revenueElsewhere, currency, locale, { compact: true })}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <p className="mt-3 text-xs text-[var(--color-muted)]">{t.whitespace.prospectNote}</p>
    </>
  );
}
