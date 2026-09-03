import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Records what a person decided about a held order.
 *
 * It does not release anything. The ERP holds the order and the ERP releases
 * it; all this endpoint does is put a reason and a named person against the
 * decision, together with the diagnosis as it stood at that moment — which is
 * the part that is impossible to reconstruct afterwards and the part every
 * post-mortem asks for.
 *
 * `recommend_release` is deliberately not called `release`. An audit trail that
 * says "released" for an action the platform never performed is a lie that
 * sounds like a feature.
 */
const OUTCOMES = new Set(['recommend_release', 'hold', 'partial', 'escalate', 'reject']);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const { blockId, outcome, reason, evidence } = (await request.json().catch(() => ({}))) as {
    blockId?: string;
    outcome?: string;
    reason?: string;
    evidence?: unknown;
  };

  if (!blockId || !outcome || !OUTCOMES.has(outcome)) {
    return NextResponse.json({ error: 'blockId and a valid outcome are required' }, { status: 400 });
  }
  // A decision without a reason is not a decision, it is a click. Every one of
  // these ends up in front of somebody asking why the order went out.
  if (!reason || reason.trim().length < 3) {
    return NextResponse.json({ error: 'a reason is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: block, error } = await admin
    .from('sales_order_block')
    .select('id, tenant_id, order_ref, order_amount, party_id')
    .eq('id', blockId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!block || block.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'order not found' }, { status: 404 });
  }

  const { error: insertError } = await admin.from('order_block_decision').insert({
    tenant_id: session.tenantId,
    block_id: blockId,
    outcome,
    reason: reason.trim(),
    evidence: evidence ?? {},
    decided_by: session.userId,
  });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: `order_block.${outcome}`,
    object_type: 'sales_order_block',
    object_id: blockId,
    snapshot: {
      orderRef: block.order_ref,
      orderAmount: block.order_amount,
      outcome,
      reason: reason.trim(),
      evidence: evidence ?? {},
    },
  });

  return NextResponse.json({ ok: true });
}
