import { NextResponse } from 'next/server';
import { approvalChainFor, evaluateChain, type ApprovalRecord } from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * One approver's decision on an allocation request.
 *
 * The caller may only decide as an approver they actually are: an entity step
 * needs access to that entity, a role step needs that role. Central credit
 * cannot approve on behalf of the BU giving up its cover — that check is the
 * whole reason this workflow is worth having rather than a spreadsheet with a
 * sign-off column.
 *
 * A rejection ends the request outright. There is no majority on a question
 * about whose guarantee this is.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const { requestId, approver, decision, note } = (await request.json().catch(() => ({}))) as {
    requestId?: string;
    approver?: string;
    decision?: 'approved' | 'rejected';
    note?: string;
  };

  if (!requestId || !approver || (decision !== 'approved' && decision !== 'rejected')) {
    return NextResponse.json({ error: 'requestId, approver and decision are required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: req, error } = await admin
    .from('allocation_request')
    .select('id, tenant_id, collateral_id, from_entity_code, to_entity_code, amount, status')
    .eq('id', requestId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!req || req.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'request not found' }, { status: 404 });
  }
  if (req.status !== 'pending') {
    return NextResponse.json({ error: `this request is already ${req.status}` }, { status: 409 });
  }

  const chain = approvalChainFor(
    { fromEntityCode: req.from_entity_code, toEntityCode: req.to_entity_code },
    session.profile.collateralPolicy,
  );
  const step = chain.find((s) => s.approver === approver);
  if (!step) {
    return NextResponse.json({ error: `${approver} is not on this request's approval chain` }, { status: 400 });
  }

  /* May this user act as this approver? ------------------------------- */
  const entityScope = session.entityScope;
  const actsForEntity =
    step.kind === 'entity' && (entityScope.length === 0 || entityScope.includes(step.approver));
  const actsForRole = step.kind === 'role' && (session.roleCode === step.approver || session.roleCode === 'admin');
  if (!actsForEntity && !actsForRole) {
    return NextResponse.json(
      {
        error:
          step.kind === 'entity'
            ? `only someone with access to ${step.approver} can decide on its behalf — it is the entity giving up cover`
            : `this step is for the ${step.approver} role`,
      },
      { status: 403 },
    );
  }

  const { error: insertError } = await admin.from('allocation_approval').insert({
    tenant_id: session.tenantId,
    request_id: requestId,
    approver: step.approver,
    approver_kind: step.kind,
    decision,
    note: note?.trim() || null,
    decided_by: session.userId,
  });
  if (insertError) {
    // The unique key is (request, approver): a second decision from the same
    // approver is a conflict, not an overwrite.
    return NextResponse.json(
      { error: insertError.code === '23505' ? `${approver} has already decided on this request` : insertError.message },
      { status: insertError.code === '23505' ? 409 : 500 },
    );
  }

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

  if (state.status !== 'pending') {
    // Approved here means "cleared to apply", not "applied". The apply step
    // re-validates against the balances at that moment.
    await admin
      .from('allocation_request')
      .update({ status: state.status === 'approved' ? 'approved' : 'rejected' })
      .eq('id', requestId);
  }

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: `allocation.${decision}`,
    object_type: 'allocation_request',
    object_id: requestId,
    snapshot: {
      approver: step.approver,
      kind: step.kind,
      note: note?.trim() ?? null,
      chainStatus: state.status,
      outstanding: state.outstanding.map((s) => s.approver),
    },
  });

  return NextResponse.json({
    ok: true,
    chainStatus: state.status,
    outstanding: state.outstanding.map((s) => s.approver),
  });
}
