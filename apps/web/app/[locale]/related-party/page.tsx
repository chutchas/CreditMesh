import Link from 'next/link';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatPercent } from '../../../lib/format';
import { Card, Empty, PageHeader, StatTile, Table } from '../../../components/ui';
import RunFindingsButton from './run-findings-button';

/**
 * Module 8 — Related Party & Conflict Detection.
 *
 * The most carefully bounded screen in the product, because it names
 * individuals. Three rules, all visible here:
 *
 * Audit only. The page refuses to render for any other role rather than
 * relying on nobody linking to it, and the RLS policy refuses the rows too.
 *
 * Items to check, not conclusions. Every row is a link with its evidence and a
 * strength, and the strongest available disposition is "checked, no issue" —
 * because most of these will be innocent and a queue that cannot record that
 * fills with the same items every run.
 *
 * No employee data. Cross-checking suppliers against a staff list needs HR and
 * a data protection review first; the code path does not exist.
 */
export default async function RelatedPartyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);

  if (session.roleCode !== 'auditor' && session.roleCode !== 'admin') {
    return (
      <>
        <PageHeader title={t.relatedParty.title} subtitle={t.relatedParty.subtitle} />
        <Empty title={t.relatedParty.restricted} hint={t.relatedParty.restrictedHint} />
      </>
    );
  }

  const supabase = await createClient();
  const { data: findings } = await supabase
    .from('related_party_finding')
    .select('id, code, party_ids, party_names, person_names, link_strength, summary, observed_at, disposition, review_note')
    .order('link_strength', { ascending: false });

  const rows = (findings ?? []) as {
    id: string;
    code: string;
    party_ids: string[];
    party_names: string[];
    person_names: string[];
    link_strength: number;
    summary: string;
    observed_at: string;
    disposition: string;
    review_note: string | null;
  }[];

  const runButton = canWrite(session) ? (
    <RunFindingsButton
      labels={{
        run: t.relatedParty.run,
        running: t.relatedParty.running,
        findings: t.relatedParty.findingsLabel,
        suppliers: t.relatedParty.suppliersLabel,
      }}
    />
  ) : undefined;

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title={t.relatedParty.title} subtitle={t.relatedParty.subtitle} actions={runButton} />
        <Empty title={t.relatedParty.noData} hint={t.relatedParty.noDataHint} />
      </>
    );
  }

  const open = rows.filter((r) => r.disposition === 'open');
  const codeLabel = (code: string) => t.conflictCodes[code as keyof typeof t.conflictCodes] ?? code;

  return (
    <>
      <PageHeader title={t.relatedParty.title} subtitle={t.relatedParty.subtitle} actions={runButton} />

      <p className="mb-4 rounded border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-xs text-[#b54708]">
        {t.relatedParty.notAConclusion}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile label={t.relatedParty.openFindings} value={String(open.length)} tone={open.length > 0 ? 'warn' : 'good'} />
        <StatTile label={t.relatedParty.totalFindings} value={String(rows.length)} />
        <StatTile
          label={t.relatedParty.suppliersInvolved}
          value={String(new Set(rows.flatMap((r) => r.party_ids)).size)}
        />
      </div>

      <div className="mt-4">
        <Card title={t.relatedParty.toCheck} footer={t.relatedParty.noEmployeeDataNote}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.relatedParty.linkType}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.relatedParty.strength}</th>
                <th className="py-2 pr-3 font-medium">{t.relatedParty.counterparties}</th>
                <th className="py-2 pr-3 font-medium">{t.relatedParty.persons}</th>
                <th className="py-2 pr-3 font-medium">{t.relatedParty.whatToCheck}</th>
                <th className="py-2 font-medium">{t.relatedParty.disposition}</th>
              </tr>
            }
          >
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--color-line)] align-top last:border-0">
                <td className="py-2 pr-3 text-xs">{codeLabel(r.code)}</td>
                <td className="tabular py-2 pr-3 text-right text-xs">
                  {formatPercent(Number(r.link_strength) * 100, locale, 0)}
                </td>
                <td className="py-2 pr-3 text-xs">
                  {r.party_ids.map((id, i) => (
                    <div key={id}>
                      <Link href={`/${locale}/parties/${id}`} className="text-[var(--color-brand)]">
                        {r.party_names[i] ?? id}
                      </Link>
                    </div>
                  ))}
                </td>
                <td className="py-2 pr-3 text-xs">{r.person_names.join(', ') || '—'}</td>
                <td className="max-w-72 py-2 pr-3 text-[11px] text-[var(--color-muted)]">{r.summary}</td>
                <td className="py-2 text-[11px]">
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      r.disposition === 'open'
                        ? 'bg-[#fffaeb] text-[#b54708]'
                        : r.disposition === 'checked_no_issue'
                          ? 'bg-[#ecfdf3] text-[#067647]'
                          : 'bg-[#fef3f2] text-[#b42318]'
                    }`}
                  >
                    {t.dispositions[r.disposition as keyof typeof t.dispositions] ?? r.disposition}
                  </span>
                  <div className="mt-0.5 text-[var(--color-muted)]">{formatDate(r.observed_at, locale)}</div>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
