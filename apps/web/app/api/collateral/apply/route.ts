import { NextResponse } from 'next/server';
import {
  allocationChangesFor,
  approvalChainFor,
  canApply,
  evaluateChain,
  type AllocationRequest,
  type ApprovalRecord,
} from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { loadCollateralBalance } from '../../../../lib/collateral-balances';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Executes an approved allocation request.
 *
 * Deliberately a separate act from approving it. Days pass between the two, and
 * in those days an entity draws on its allocation, an instrument expires, a
 * balance moves. So this re-validates against the numbers as they are right now
 * and refuses with the reasons when they no longer hold, rather than writing a
 * decision that was true last week into a ledger that is supposed to be the
 * system of record.
 *
 * A refusal here is not a failure of the workflow — it is the workflow.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const { requestId } = (await request.json().catch(() => ({}))) as { requestId?: string };
  if (!requestId) return NextResponse.json({ error: 'requestId is required' }, { status: 400 });

  const admin = createAdminClient();
  const policy = session.profile.collateralPolicy;
  const asOf = new Date().toISOString().slice(0, 10);

  const { data: row, error } = await admin
    .from('allocation_request')
    .select('id, tenant_id, collateral_id, from_entity_code, to_entity_code, amount, reason, status, requested_by, requested_at')
    .eq('id', requestId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row || row.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'request not found' }, { status: 404 });
  }

  const balance = await loadCollateralBalance(admin, session.tenantId, row.collateral_id, asOf, {
    allowOverAllocation: policy.allowOverAllocation,
  });
  if (!balance) return NextResponse.json({ error: 'instrument not found' }, { status: 404 });

  const chain = approvalChainFor(
    { fromEntityCode: row.from_entity_code, toEntityCode: row.to_entity_code },
    policy,
  );
  const { data: records } = await admin
    .from('allocation_approval')
    .select('approver, approver_kind, decision, decided_by, decided_at, note')
    .eq('request_id', requestId);

  const state = evaluateChain(
    chain,
    ((records ?? []) as { approver: string; approver_kind: string; decision: string; decided_by: string; decided_at: string; note: string | null }[]).map(
      (r): ApprovalRecord => ({
        approver: r.approver,
        kind: r.approver_kind as 'role' | 'entity',
        decision: r.decision as 'approved' | 'rejected',
        decidedBy: r.decided_by,
        decidedAt: r.decided_at,
        note: r.note ?? null,
      }),
    ),
  );

  const allocationRequest: AllocationRequest = {
    requestId: row.id,
    collateralId: row.collateral_id,
    fromEntityCode: row.from_entity_code,
    toEntityCode: row.to_entity_code,
    amount: Number(row.amount),
    reason: row.reason,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    status: row.status,
  };

  const check = canApply(allocationRequest, state, balance, policy, asOf);
  if (!check.ok) {
    const status = check.error.code === 'stale' ? 409 : 422;
    return NextResponse.json(
      {
        error: check.error.detail,
        code: check.error.code,
        refusals: 'refusals' in check.error ? check.error.refusals : undefined,
      },
      { status },
    );
  }

  /* Write both sides, then the request, then the evidence ------------- */
  const changes = allocationChangesFor(allocationRequest, balance);

  for (const change of changes) {
    const existing = balance.allocations.find((a) => a.legalEntityCode === change.legalEntityCode);
    const { error: writeError } = await admin.from('collateral_allocation').upsert(
      {
        tenant_id: session.tenantId,
        collateral_id: row.collateral_id,
        legal_entity_code: change.legalEntityCode,
        allocated: change.allocatedAfter,
        utilized: change.utilized,
        valid_from: existing?.validFrom ?? asOf,
        valid_to: existing?.validTo ?? null,
      },
      { onConflict: 'tenant_id,collateral_id,legal_entity_code,valid_from' },
    );
    if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 });
  }

  const now = new Date().toISOString();
  await admin
    .from('allocation_request')
    .update({ status: 'applied', applied_by: session.userId, applied_at: now })
    .eq('id', requestId);

  // The instrument's own event log, so the register's history and the workflow
  // do not have to be read side by side to reconstruct what happened.
  await admin.from('collateral_event').insert({
    tenant_id: session.tenantId,
    collateral_id: row.collateral_id,
    kind: 'reallocated',
    actor: session.userId,
    detail: {
      requestId,
      from: row.from_entity_code,
      to: row.to_entity_code,
      amount: Number(row.amount),
      reason: row.reason,
      approvals: state.records.map((r) => ({ approver: r.approver, decidedAt: r.decidedAt })),
      changes,
    },
  });

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'allocation.applied',
    object_type: 'allocation_request',
    object_id: requestId,
    snapshot: { reference: balance.collateral.reference, changes, chain: state.chain },
  });

  return NextResponse.json({ ok: true, changes });
}
