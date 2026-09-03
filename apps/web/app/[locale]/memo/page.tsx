import Link from 'next/link';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatPercent } from '../../../lib/format';
import { Card, Empty, PageHeader, Table } from '../../../components/ui';
import GenerateMemoForm from './generate-memo-form';

/**
 * Module 4 — Credit Memo Writer, index.
 *
 * The completeness figure is on every row on purpose. §7 positions this module
 * as drafting 80% with the analyst supplying the rest, and a draft assembled
 * from 40% of the facts is a different object from one assembled from 95% —
 * the analyst needs to know which one they are picking up before they read it.
 */
export default async function MemoPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const writable = canWrite(session);

  const [{ data: memos }, { data: parties }] = await Promise.all([
    supabase
      .from('credit_memo')
      .select('id, party_id, as_of, status, completeness_pct, gaps, created_at, reviewed_at, party:party_id(legal_name)')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('v_party_portfolio').select('party_id, legal_name, grade').order('legal_name'),
  ]);

  const rows = (memos ?? []) as unknown as {
    id: string;
    party_id: string;
    as_of: string;
    status: string;
    completeness_pct: number;
    gaps: string[];
    created_at: string;
    reviewed_at: string | null;
    party: { legal_name: string } | null;
  }[];

  const partyOptions = ((parties ?? []) as { party_id: string; legal_name: string }[]).map((p) => ({
    id: p.party_id,
    name: p.legal_name,
  }));

  const form = writable ? (
    <GenerateMemoForm
      parties={partyOptions}
      labels={{
        choose: t.memo.chooseParty,
        generate: t.memo.generate,
        generating: t.memo.generating,
        chooseRequired: t.memo.chooseRequired,
      }}
    />
  ) : undefined;

  return (
    <>
      <PageHeader title={t.memo.title} subtitle={t.memo.subtitle} actions={form} />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.memo.positioningNote}</p>

      {rows.length === 0 ? (
        <Empty title={t.memo.noData} hint={t.memo.noDataHint} />
      ) : (
        <Card>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.memo.party}</th>
                <th className="py-2 pr-3 font-medium">{t.memo.asOf}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.memo.completeness}</th>
                <th className="py-2 pr-3 font-medium">{t.memo.gaps}</th>
                <th className="py-2 font-medium">{t.memo.status}</th>
              </tr>
            }
          >
            {rows.map((m) => (
              <tr key={m.id} className="border-b border-[var(--color-line)] align-top last:border-0">
                <td className="py-2 pr-3">
                  <Link href={`/${locale}/memo/${m.id}`} className="font-medium text-[var(--color-brand)]">
                    {m.party?.legal_name ?? m.party_id}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-xs">{formatDate(m.as_of, locale)}</td>
                <td
                  className={`tabular py-2 pr-3 text-right ${Number(m.completeness_pct) < 60 ? 'text-[#b54708]' : ''}`}
                >
                  {formatPercent(Number(m.completeness_pct), locale, 0)}
                </td>
                <td className="py-2 pr-3 text-[11px] text-[var(--color-muted)]">
                  {(m.gaps ?? []).length === 0 ? '—' : (m.gaps ?? []).join(', ')}
                </td>
                <td className="py-2 text-xs">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      m.status === 'draft' ? 'bg-[#fffaeb] text-[#b54708]' : 'bg-[#ecfdf3] text-[#067647]'
                    }`}
                  >
                    {t.memoStatus[m.status as keyof typeof t.memoStatus] ?? m.status}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
