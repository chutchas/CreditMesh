import { NextResponse } from 'next/server';
import { approvalChainFor, validateAllocationRequest } from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { loadCollateralBalance } from '../../../../lib/collateral-balances';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Raises a request to move collateral value.
 *
 * Validation runs here, not only in the browser, and the refusals come back in
 * full rather than one at a time — a request that fails on three counts should
 * be rewritten once.
 *
 * The balances the requester was looking at are stored on the request. An
 * approver reading it a week later needs to see what was true when the ask was
 * made, not only what is true now; without that the approval conversation is
 * about two different sets of numbers.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    collateralId?: string;
    fromEntityCode?: string | null;
    toEntityCode?: string;
    amount?: number;
    reason?: string;
  };

  if (!body.collateralId || !body.toEntityCode || !body.amount) {
    return NextResponse.json({ error: 'collateralId, toEntityCode and amount are required' }, { status: 400 });
  }
  // A reallocation with no stated reason is unreviewable: the approver's whole
  // job is to weigh the reason against what the other entity gives up.
  if (!body.reason || body.reason.trim().length < 3) {
    return NextResponse.json({ error: 'a reason is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const policy = session.profile.collateralPolicy;
  const asOf = new Date().toISOString().slice(0, 10);

  const balance = await loadCollateralBalance(admin, session.tenantId, body.collateralId, asOf, {
    allowOverAllocation: policy.allowOverAllocation,
  });
  if (!balance) return NextResponse.json({ error: 'instrument not found' }, { status: 404 });

  const draft = {
    collateralId: body.collateralId,
    fromEntityCode: body.fromEntityCode ?? null,
    toEntityCode: body.toEntityCode,
    amount: Number(body.amount),
  };

  const validation = validateAllocationRequest(draft, balance, policy, asOf);
  if (!validation.ok) {
    return NextResponse.json({ error: 'this move is not allowed', refusals: validation.refusals }, { status: 422 });
  }

  const chain = approvalChainFor(draft, policy);

  const { data: saved, error } = await admin
    .from('allocation_request')
    .insert({
      tenant_id: session.tenantId,
      collateral_id: draft.collateralId,
      from_entity_code: draft.fromEntityCode,
      to_entity_code: draft.toEntityCode,
      amount: draft.amount,
      currency: balance.collateral.currency,
      reason: body.reason.trim(),
      status: 'pending',
      requested_snapshot: {
        faceValue: balance.collateral.amount,
        allocatedTotal: balance.allocatedTotal,
        unallocated: balance.unallocated,
        allocations: balance.allocations,
        effect: validation.effect,
        chain,
      },
      requested_by: session.userId,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'allocation.requested',
    object_type: 'allocation_request',
    object_id: saved.id,
    snapshot: { ...draft, reason: body.reason.trim(), reference: balance.collateral.reference, chain },
  });

  return NextResponse.json({ ok: true, requestId: saved.id, chain, effect: validation.effect });
}
