import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { MemoSection } from '@creditmesh/core';
import { isLocale } from '../../../../lib/i18n/config';
import { getDictionary } from '../../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../../lib/session';
import { createClient } from '../../../../lib/supabase/server';
import { formatDate, formatPercent } from '../../../../lib/format';
import { Card, PageHeader } from '../../../../components/ui';
import AnalystSections from './analyst-sections';

/**
 * One credit memo.
 *
 * The assembled half and the analyst's half are rendered as visibly different
 * things. The top is what the platform found, each figure with the source it
 * came from; the bottom is blank until a person writes in it, and the memo
 * cannot be marked reviewed while it is.
 *
 * The gaps are printed rather than omitted. A memo silently missing its
 * financial section reads like a company with unremarkable financials; one
 * that says "no statements filed" reads like what it is.
 */
export default async function MemoDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale: raw, id } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();

  const { data: memo } = await supabase
    .from('credit_memo')
    .select('id, party_id, as_of, sections, analyst_sections, gaps, completeness_pct, status, created_at, reviewed_at, party:party_id(legal_name)')
    .eq('id', id)
    .maybeSingle();

  if (!memo) notFound();

  const row = memo as unknown as {
    id: string;
    party_id: string;
    as_of: string;
    sections: MemoSection[];
    analyst_sections: { code: string; prompt: string; content: string }[];
    gaps: string[];
    completeness_pct: number;
    status: string;
    created_at: string;
    reviewed_at: string | null;
    party: { legal_name: string } | null;
  };

  const sectionLabel = (code: string) => t.memoSections[code as keyof typeof t.memoSections] ?? code;
  const factLabel = (code: string) => t.memoFacts[code as keyof typeof t.memoFacts] ?? code;
  const promptLabel = (code: string) => t.memoPrompts[code as keyof typeof t.memoPrompts] ?? code;

  return (
    <>
      <PageHeader
        title={`${t.memo.title}: ${row.party?.legal_name ?? row.party_id}`}
        subtitle={`${t.memo.asOf} ${formatDate(row.as_of, locale)} · ${t.memo.completeness} ${formatPercent(Number(row.completeness_pct), locale, 0)}`}
        actions={
          <Link href={`/${locale}/memo`} className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm">
            {t.common.back}
          </Link>
        }
      />

      {row.gaps.length > 0 ? (
        <p className="mb-4 rounded border border-[#fedf89] bg-[#fffaeb] px-3 py-2 text-xs text-[#b54708]">
          {t.memo.gapsWarning} {row.gaps.map((g) => t.memoGaps[g as keyof typeof t.memoGaps] ?? g).join(', ')}
        </p>
      ) : null}

      <div className="space-y-3">
        {row.sections.map((section) => (
          <Card key={section.code} title={sectionLabel(section.code)}>
            {section.facts.length === 0 ? null : (
              <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {section.facts.map((f) => (
                  <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line)] py-1 last:border-0">
                    <dt className="text-xs text-[var(--color-muted)]">{factLabel(f.label)}</dt>
                    <dd className="text-right text-xs">
                      {f.value === null ? (
                        <span className="italic text-[var(--color-muted)]">{f.absent}</span>
                      ) : (
                        <span className="tabular font-medium">
                          {typeof f.value === 'number' ? f.value.toLocaleString(locale === 'th' ? 'th-TH' : 'en-US') : f.value}
                        </span>
                      )}
                      {/* Every figure carries where it came from (P6). */}
                      <div className="text-[10px] text-[var(--color-muted)]">{f.source}</div>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {section.observations.length > 0 ? (
              <ul className="mt-2 space-y-1 border-t border-[var(--color-line)] pt-2 text-xs">
                {section.observations.map((o) => (
                  <li key={o} className="text-[#b54708]">
                    · {o}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ))}
      </div>

      <div className="mt-5">
        <h2 className="mb-2 text-sm font-semibold">{t.memo.analystHalf}</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">{t.memo.analystNote}</p>
        <AnalystSections
          memoId={row.id}
          initial={row.analyst_sections.map((s) => ({ ...s, prompt: promptLabel(s.code) }))}
          readOnly={!canWrite(session) || row.status !== 'draft'}
          labels={{
            save: t.memo.save,
            saveAndReview: t.memo.saveAndReview,
            saving: t.memo.saving,
            saved: t.memo.saved,
            stillEmpty: t.memo.stillEmpty,
            reviewedOn: row.reviewed_at ? `${t.memo.reviewedOn} ${formatDate(row.reviewed_at, locale)}` : '',
          }}
        />
      </div>
    </>
  );
}
