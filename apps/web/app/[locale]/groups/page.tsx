import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { canWrite, requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatMoney } from '../../../lib/format';
import { Card, Empty, PageHeader } from '../../../components/ui';
import GroupList, { type GroupRow } from './group-list';
import RunGroupsButton from './run-groups-button';

interface ExposureRow {
  group_id: string;
  group_name: string;
  confidence: number;
  status: string;
  member_count: number;
  entity_count: number;
  total_exposure: number | null;
  total_overdue: number | null;
  total_credit_limit: number | null;
  max_single_limit: number | null;
}

/**
 * Module 2 — Hidden Group Exposure.
 *
 * The one screen in R2 that shows something an ERP cannot: several
 * counterparties, resolved to one owner, and what that owner owes across every
 * legal entity at once. It is also the screen with the most ways to be wrong,
 * which is why every group arrives as a proposal carrying its evidence.
 */
export default async function GroupsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();
  const currency = session.profile.identity.baseCurrency;

  const [{ data: exposure }, { data: groups }, { data: exclusions }] = await Promise.all([
    supabase
      .from('v_group_exposure')
      .select('group_id, group_name, confidence, status, member_count, entity_count, total_exposure, total_overdue, total_credit_limit, max_single_limit')
      .in('status', ['proposed', 'confirmed'])
      .order('total_exposure', { ascending: false, nullsFirst: false }),
    supabase
      .from('party_group')
      .select(
        'id, name, confidence, status, member_count, party_group_member(party_id, party:party_id(legal_name, tax_id)), party_group_edge(left_party_id, right_party_id, confidence, signals)',
      )
      .in('status', ['proposed', 'confirmed'])
      .order('confidence', { ascending: false }),
    supabase
      .from('group_exclusion_suggestion')
      .select('id, kind, value, party_count, status')
      .eq('status', 'suggested')
      .order('party_count', { ascending: false })
      .limit(25),
  ]);

  const exposureById = new Map(((exposure ?? []) as ExposureRow[]).map((r) => [r.group_id, r]));

  const rows: GroupRow[] = ((groups ?? []) as unknown as {
    id: string;
    name: string;
    confidence: number;
    status: string;
    member_count: number;
    party_group_member: { party_id: string; party: { legal_name: string; tax_id: string | null } | null }[];
    party_group_edge: {
      left_party_id: string;
      right_party_id: string;
      confidence: number;
      signals: { kind: string; weight: number; detail: string }[];
    }[];
  }[]).map((g) => {
    const summary = exposureById.get(g.id);
    return {
      id: g.id,
      name: g.name,
      status: g.status as GroupRow['status'],
      confidence: Number(g.confidence),
      members: (g.party_group_member ?? []).map((m) => ({
        partyId: m.party_id,
        legalName: m.party?.legal_name ?? m.party_id,
        taxId: m.party?.tax_id ?? null,
      })),
      edges: (g.party_group_edge ?? []).map((e) => ({
        leftPartyId: e.left_party_id,
        rightPartyId: e.right_party_id,
        confidence: Number(e.confidence),
        signals: e.signals ?? [],
      })),
      totalExposure: summary ? Number(summary.total_exposure ?? 0) : 0,
      totalOverdue: summary ? Number(summary.total_overdue ?? 0) : 0,
      totalCreditLimit: summary?.total_credit_limit == null ? null : Number(summary.total_credit_limit),
      maxSingleLimit: summary?.max_single_limit == null ? null : Number(summary.max_single_limit),
      entityCount: summary?.entity_count ?? 0,
    };
  });

  const canDecide = canWrite(session);

  return (
    <>
      <PageHeader
        title={t.groups.title}
        subtitle={t.groups.subtitle}
        actions={
          canDecide ? (
            <RunGroupsButton
              labels={{
                run: t.groups.run,
                running: t.groups.running,
                groupsProposed: t.groups.groupsProposed,
                edgesFound: t.groups.edgesFound,
                hubsIgnored: t.groups.hubsIgnored,
              }}
            />
          ) : null
        }
      />

      <p className="mb-4 rounded border border-[#fbe3a4] bg-[#fffaeb] px-3 py-2 text-xs text-[#b54708]">
        {t.groups.neverAutomatic}
      </p>

      {rows.length === 0 ? (
        <Empty title={t.groups.noProposals} hint={t.groups.noProposalsHint} />
      ) : (
        <GroupList
          rows={rows}
          locale={locale}
          currency={currency}
          canDecide={canDecide}
          labels={t.groups}
          flagLabels={{ evidence: t.common.evidence }}
        />
      )}

      {(exclusions ?? []).length > 0 ? (
        <div className="mt-6">
          <Card title={t.groups.exclusions}>
            <p className="mb-3 text-xs text-[var(--color-muted)]">{t.groups.exclusionsHint}</p>
            <ul className="space-y-1.5 text-sm">
              {(exclusions ?? []).map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--color-muted)]">
                    {e.kind === 'person' ? t.groups.personHub : t.groups.addressHub}
                  </span>
                  <span className="font-medium">{e.value}</span>
                  <span className="text-xs text-[var(--color-muted)]">
                    · {t.groups.appearsIn} <span className="tabular">{e.party_count}</span> · {t.groups.ignoredAlready}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-[var(--color-muted)]">
        {t.groups.weakestLink} · {t.common.total}{' '}
        <span className="tabular">
          {formatMoney(
            rows.filter((r) => r.status === 'confirmed').reduce((sum, r) => sum + r.totalExposure, 0),
            currency,
            locale,
            { compact: true },
          )}
        </span>{' '}
        ({t.groups.confirmed})
      </p>
    </>
  );
}
