import Link from 'next/link';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate, formatMoney, formatNumber, formatPercent } from '../../../lib/format';
import { Card, Empty, PageHeader, StatTile, Table } from '../../../components/ui';
import RunProvisionForm from './run-provision-form';

/**
 * Module 10 — ECL / Provision Assistant.
 *
 * The unrated balance is a headline tile, not a footnote. Where the history is
 * too thin to derive a loss rate the bucket is left unprovisioned, and a zero
 * provision on an unrated bucket looks exactly like a genuine zero unless the
 * screen says otherwise. This figure is the first thing an auditor asks about.
 *
 * The loss matrix is shown next to the totals with the observation base behind
 * each rate, so a rate derived from one small cohort can be seen for what it is.
 *
 * Nothing here is booked. The platform proposes; the person who signs the
 * accounts decides (P5).
 */
export default async function ProvisionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;

  const { data: runs } = await supabase
    .from('provision_run')
    .select('id, as_of, loss_matrix, options, gross_exposure, proposed_provision, unrated_exposure, status, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  const runRows = (runs ?? []) as {
    id: string;
    as_of: string;
    loss_matrix: { bucketCode: string; ratePct: number | null; observationBase: number; cohortCount: number; note: string | null }[];
    options: { forwardLookingPct?: number; specificProvisionPct?: number; deductCollateral?: boolean };
    gross_exposure: number;
    proposed_provision: number;
    unrated_exposure: number;
    status: string;
    created_at: string;
  }[];

  const form = canWrite(session) ? (
    <RunProvisionForm
      labels={{
        run: t.provision.run,
        running: t.provision.running,
        forwardLooking: t.provision.forwardLooking,
        asOf: t.provision.asOf,
        provision: t.provision.proposed,
      }}
    />
  ) : undefined;

  const latest = runRows[0];
  if (!latest) {
    return (
      <>
        <PageHeader title={t.provision.title} subtitle={t.provision.subtitle} actions={form} />
        <Empty title={t.provision.noRuns} hint={t.provision.noRunsHint} />
      </>
    );
  }

  const { data: items } = await supabase
    .from('provision_item')
    .select('id, party_id, legal_entity_code, gross_exposure, secured_amount, exposure_at_default, base_provision, forward_looking_pct, specific_provision, proposed_provision, unrated_exposure, bucket_detail, notes, party:party_id(legal_name)')
    .eq('run_id', latest.id)
    .order('proposed_provision', { ascending: false });

  const lines = (items ?? []) as unknown as {
    id: string;
    party_id: string;
    legal_entity_code: string;
    gross_exposure: number;
    secured_amount: number;
    exposure_at_default: number;
    base_provision: number;
    forward_looking_pct: number;
    specific_provision: number | null;
    proposed_provision: number;
    unrated_exposure: number;
    bucket_detail: { bucketCode: string; amount: number; ratePct: number | null; provision: number; unrated: boolean }[];
    notes: string[];
    party: { legal_name: string } | null;
  }[];

  const bucketLabel = (code: string) =>
    session.profile.creditPolicy.agingBuckets.find((b) => b.code === code)?.label ?? code;

  const coverage =
    Number(latest.gross_exposure) === 0
      ? null
      : (Number(latest.proposed_provision) / Number(latest.gross_exposure)) * 100;

  return (
    <>
      <PageHeader title={t.provision.title} subtitle={t.provision.subtitle} actions={form} />

      <p className="mb-4 text-xs text-[var(--color-muted)]">{t.provision.scopeNote}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t.provision.grossExposure}
          value={formatMoney(Number(latest.gross_exposure), currency, locale, { compact: true })}
          hint={`${t.provision.asOfLabel} ${formatDate(latest.as_of, locale)}`}
        />
        <StatTile
          label={t.provision.proposed}
          value={formatMoney(Number(latest.proposed_provision), currency, locale, { compact: true })}
          hint={coverage === null ? undefined : formatPercent(coverage, locale, 1)}
        />
        {/* Deliberately a headline. A zero provision on an unrated bucket looks
            identical to a genuine zero in a total. */}
        <StatTile
          label={t.provision.unrated}
          value={formatMoney(Number(latest.unrated_exposure), currency, locale, { compact: true })}
          hint={t.provision.unratedHint}
          tone={Number(latest.unrated_exposure) > 0 ? 'bad' : 'good'}
        />
        <StatTile
          label={t.provision.overlay}
          value={formatPercent(Number(latest.options?.forwardLookingPct ?? 0), locale, 1)}
          hint={t.provision.overlayHint}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Card title={t.provision.lossMatrix} footer={t.provision.matrixNote}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.provision.bucket}</th>
                <th className="py-2 pr-3 text-right font-medium">{t.provision.rate}</th>
                <th className="py-2 text-right font-medium">{t.provision.observedOn}</th>
              </tr>
            }
          >
            {latest.loss_matrix.map((r) => (
              <tr key={r.bucketCode} className="border-b border-[var(--color-line)] align-top last:border-0">
                <td className="py-2 pr-3 text-xs">{bucketLabel(r.bucketCode)}</td>
                <td className="tabular py-2 pr-3 text-right text-xs">
                  {r.ratePct === null ? (
                    <span className="text-[#b42318]">{t.provision.noRate}</span>
                  ) : (
                    formatPercent(r.ratePct, locale, 2)
                  )}
                  {r.note ? <div className="text-[10px] font-normal text-[var(--color-muted)]">{r.note}</div> : null}
                </td>
                <td className="tabular py-2 text-right text-xs">
                  {formatMoney(r.observationBase, currency, locale, { compact: true })}
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <div className="lg:col-span-2">
          <Card title={t.provision.byCounterparty}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.provision.party}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.provision.gross}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.provision.secured}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.provision.ead}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.provision.proposedShort}</th>
                  <th className="py-2 font-medium">{t.provision.notes}</th>
                </tr>
              }
            >
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-[var(--color-line)] align-top last:border-0">
                  <td className="py-2 pr-3">
                    <Link href={`/${locale}/parties/${l.party_id}`} className="text-[var(--color-brand)]">
                      {l.party?.legal_name ?? l.party_id}
                    </Link>
                    <div className="text-[11px] text-[var(--color-muted)]">{l.legal_entity_code}</div>
                  </td>
                  <td className="tabular py-2 pr-3 text-right text-xs">
                    {formatMoney(Number(l.gross_exposure), currency, locale, { compact: true })}
                  </td>
                  <td className="tabular py-2 pr-3 text-right text-xs">
                    {formatMoney(Number(l.secured_amount), currency, locale, { compact: true })}
                  </td>
                  <td className="tabular py-2 pr-3 text-right text-xs">
                    {formatMoney(Number(l.exposure_at_default), currency, locale, { compact: true })}
                  </td>
                  <td className="tabular py-2 pr-3 text-right font-medium">
                    {formatMoney(Number(l.proposed_provision), currency, locale, { compact: true })}
                    {l.specific_provision !== null ? (
                      <div className="text-[11px] font-normal text-[#b42318]">{t.provision.specific}</div>
                    ) : null}
                  </td>
                  <td className="py-2 text-[11px]">
                    <div className="tabular text-[var(--color-muted)]">
                      {l.bucket_detail
                        .filter((b) => b.amount > 0)
                        .map(
                          (b) =>
                            `${bucketLabel(b.bucketCode)} ${formatNumber(b.amount, locale, 0)}${b.unrated ? ' ⚠' : ` @${b.ratePct}%`}`,
                        )
                        .join(' · ')}
                    </div>
                    {l.notes.map((n) => (
                      <div key={n} className="text-[#b54708]">
                        {n}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>

      {runRows.length > 1 ? (
        <div className="mt-4">
          <Card title={t.provision.runHistory}>
            <Table
              head={
                <tr>
                  <th className="py-2 pr-3 font-medium">{t.provision.asOfLabel}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.provision.gross}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t.provision.proposedShort}</th>
                  <th className="py-2 text-right font-medium">{t.provision.unrated}</th>
                </tr>
              }
            >
              {runRows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--color-line)] last:border-0">
                  <td className="py-2 pr-3 text-xs">{formatDate(r.as_of, locale)}</td>
                  <td className="tabular py-2 pr-3 text-right text-xs">
                    {formatMoney(Number(r.gross_exposure), currency, locale, { compact: true })}
                  </td>
                  <td className="tabular py-2 pr-3 text-right text-xs">
                    {formatMoney(Number(r.proposed_provision), currency, locale, { compact: true })}
                  </td>
                  <td className="tabular py-2 text-right text-xs">
                    {formatMoney(Number(r.unrated_exposure), currency, locale, { compact: true })}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      ) : null}
    </>
  );
}
