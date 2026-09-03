import { NextResponse } from 'next/server';
import { buildCreditMemo, type MemoInputs } from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Assembles a credit memo draft for one counterparty.
 *
 * Everything it writes is a fact with a stated source. It does not write the
 * assessment, does not propose a limit and does not recommend anything — those
 * sections are created empty for the analyst, and the memo cannot be marked
 * reviewed until they are filled in.
 *
 * The numbers are stored on the memo rather than re-derived when it is opened.
 * A committee reads a memo weeks later and needs what was known when it was
 * written, not what has changed since.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const { partyId } = (await request.json().catch(() => ({}))) as { partyId?: string };
  if (!partyId) return NextResponse.json({ error: 'partyId is required' }, { status: 400 });

  const admin = createAdminClient();
  const asOf = new Date().toISOString().slice(0, 10);
  const tenantId = session.tenantId;

  const { data: party, error } = await admin
    .from('party')
    .select('id, tenant_id, legal_name, tax_id')
    .eq('id', partyId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!party || party.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'counterparty not found' }, { status: 404 });
  }

  const [
    { data: registry },
    { data: portfolio },
    { data: behavior },
    { data: statements },
    { data: index },
    { data: legal },
    { data: signals },
    { data: membership },
    { data: allocations },
    { data: instruments },
  ] = await Promise.all([
    admin
      .from('party_registry_profile')
      .select('legal_status, registered_capital, registration_date')
      .eq('party_id', partyId)
      .maybeSingle(),
    admin
      .from('v_party_portfolio')
      .select('total_exposure, total_ar_open, total_ar_overdue, total_credit_limit')
      .eq('party_id', partyId)
      .maybeSingle(),
    admin
      .from('payment_behavior')
      .select('weighted_avg_dpd, on_time_pct, invoice_count, max_dpd')
      .eq('party_id', partyId)
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('financial_statement').select('*').eq('party_id', partyId).order('fiscal_year', { ascending: false }).limit(1),
    admin
      .from('v_risk_index_current')
      .select('score, grade, incomplete, components_scored, components_enabled')
      .eq('party_id', partyId)
      .maybeSingle(),
    admin
      .from('legal_event')
      .select('event_type, case_no, event_date, severity')
      .eq('party_id', partyId)
      .eq('review_status', 'confirmed'),
    admin.from('credit_signal').select('code, reason, severity').eq('party_id', partyId),
    admin.from('party_group_member').select('group_id, group:group_id(name, status, member_count)').eq('party_id', partyId),
    admin.from('collateral_allocation').select('allocated, collateral:collateral_id(party_id, direction, status, amount, expiry_date)').eq('tenant_id', tenantId),
    admin.from('collateral').select('amount, expiry_date, direction, status').eq('party_id', partyId),
  ]);

  /* Group, confirmed only. An unconfirmed proposal has no place in a memo
     somebody will sign. */
  let group: MemoInputs['group'] = null;
  const confirmed = ((membership ?? []) as unknown as {
    group_id: string;
    group: { name: string; status: string; member_count: number } | null;
  }[]).find((m) => m.group?.status === 'confirmed');
  if (confirmed?.group) {
    const { data: exposureRow } = await admin
      .from('v_group_exposure')
      .select('total_exposure, max_single_limit')
      .eq('group_id', confirmed.group_id)
      .maybeSingle();
    group = {
      name: confirmed.group.name,
      memberCount: confirmed.group.member_count,
      totalExposure: Number(exposureRow?.total_exposure ?? 0),
      maxSingleLimit: exposureRow?.max_single_limit === null || exposureRow?.max_single_limit === undefined
        ? null
        : Number(exposureRow.max_single_limit),
    };
  }

  const inboundHeld = ((instruments ?? []) as { amount: number; direction: string; status: string; expiry_date: string | null }[])
    .filter((c) => c.direction === 'inbound' && c.status === 'active');
  const allocatedHere = ((allocations ?? []) as unknown as {
    allocated: number;
    collateral: { party_id: string; direction: string; status: string } | null;
  }[])
    .filter((a) => a.collateral?.party_id === partyId && a.collateral.direction === 'inbound' && a.collateral.status === 'active')
    .reduce((s, a) => s + Number(a.allocated), 0);

  const statement = (statements ?? [])[0] as Record<string, number | string | null> | undefined;
  const currentAssets = statement?.current_assets === null || statement?.current_assets === undefined ? null : Number(statement.current_assets);
  const currentLiabilities =
    statement?.current_liabilities === null || statement?.current_liabilities === undefined ? null : Number(statement.current_liabilities);
  const equity = statement?.equity === null || statement?.equity === undefined ? null : Number(statement.equity);
  const liabilities =
    statement?.total_liabilities === null || statement?.total_liabilities === undefined ? null : Number(statement.total_liabilities);

  const exposureTotal = Number(portfolio?.total_exposure ?? 0);

  const inputs: MemoInputs = {
    partyId,
    partyName: party.legal_name,
    taxId: party.tax_id,
    currency: session.profile.identity.baseCurrency,
    asOf,
    registry: registry
      ? {
          legalStatus: registry.legal_status,
          registeredCapital: registry.registered_capital === null ? null : Number(registry.registered_capital),
          registrationDate: registry.registration_date,
        }
      : null,
    group,
    exposure: {
      total: exposureTotal,
      arOpen: Number(portfolio?.total_ar_open ?? 0),
      arOverdue: Number(portfolio?.total_ar_overdue ?? 0),
      creditLimit:
        portfolio?.total_credit_limit === null || portfolio?.total_credit_limit === undefined
          ? null
          : Number(portfolio.total_credit_limit),
      maxDpd: behavior?.max_dpd === null || behavior?.max_dpd === undefined ? null : Number(behavior.max_dpd),
    },
    paymentBehavior: behavior
      ? {
          avgDaysLate: behavior.weighted_avg_dpd === null ? null : Number(behavior.weighted_avg_dpd),
          onTimePct: behavior.on_time_pct === null ? null : Number(behavior.on_time_pct),
          sampleSize: Number(behavior.invoice_count ?? 0),
        }
      : null,
    collateral:
      inboundHeld.length > 0
        ? {
            heldValue: inboundHeld.reduce((s, c) => s + Number(c.amount), 0),
            allocated: allocatedHere,
            uncovered: Math.max(0, exposureTotal - allocatedHere),
            nearestExpiry:
              inboundHeld
                .map((c) => c.expiry_date)
                .filter((d): d is string => Boolean(d))
                .sort()[0] ?? null,
          }
        : null,
    financials: statement
      ? {
          fiscalYear: Number(statement.fiscal_year),
          revenue: statement.revenue === null ? null : Number(statement.revenue),
          netProfit: statement.net_profit === null ? null : Number(statement.net_profit),
          equity,
          currentRatio:
            currentAssets === null || currentLiabilities === null || currentLiabilities === 0
              ? null
              : Math.round((currentAssets / currentLiabilities) * 100) / 100,
          debtToEquity:
            liabilities === null || equity === null || equity === 0
              ? null
              : Math.round((liabilities / equity) * 100) / 100,
        }
      : null,
    riskIndex: index
      ? {
          score: index.score === null ? null : Number(index.score),
          grade: index.grade,
          incomplete: index.incomplete,
          componentsScored: index.components_scored,
          componentsEnabled: index.components_enabled,
        }
      : null,
    legalEvents: ((legal ?? []) as { event_type: string; case_no: string; event_date: string | null; severity: string }[]).map(
      (e) => ({ eventType: e.event_type, caseNo: e.case_no, eventDate: e.event_date, severity: e.severity }),
    ),
    signals: ((signals ?? []) as { code: string; reason: string; severity: string }[]).map((s) => ({
      code: s.code,
      reason: s.reason,
      severity: s.severity,
    })),
  };

  const memo = buildCreditMemo(inputs);

  const { data: saved, error: saveError } = await admin
    .from('credit_memo')
    .insert({
      tenant_id: tenantId,
      party_id: partyId,
      as_of: asOf,
      sections: memo.sections,
      analyst_sections: memo.analystSections,
      gaps: memo.gaps,
      completeness_pct: memo.completenessPct,
      status: 'draft',
      created_by: session.userId,
      profile_version: session.profileVersion ?? null,
    })
    .select('id')
    .single();
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    memoId: saved.id,
    completenessPct: memo.completenessPct,
    gaps: memo.gaps.length,
  });
}
