import { NextResponse } from 'next/server';
import { canWaive } from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Waives a proposed late charge.
 *
 * Authority is checked against §4.13 `waiver_authority`, and an unconfigured
 * policy denies rather than allows: an organisation that has not decided who
 * may waive has not authorised anyone. The alternative — treating silence as
 * permission — makes the waiver report, which is the number this module is
 * bought for, meaningless in its first month.
 *
 * A reason is required. The report answers "how much did we give away, to
 * whom, approved by whom, and why"; the last part is the one nobody can
 * reconstruct afterwards.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const { itemId, reason } = (await request.json().catch(() => ({}))) as {
    itemId?: string;
    reason?: string;
  };
  if (!itemId) return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
  if (!reason || reason.trim().length < 3) {
    return NextResponse.json({ error: 'a reason is required to waive a charge' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: item, error } = await admin
    .from('late_charge_item')
    .select('id, tenant_id, charge_amount, document_no, party_id, status')
    .eq('id', itemId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!item || item.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'charge not found' }, { status: 404 });
  }
  if (item.status !== 'proposed') {
    return NextResponse.json({ error: `this charge is already ${item.status}` }, { status: 409 });
  }

  const authority = canWaive(session.profile.lateChargePolicy, session.roleCode, Number(item.charge_amount));
  if (!authority.allowed) {
    return NextResponse.json({ error: authority.reason }, { status: 403 });
  }

  const { error: updateError } = await admin
    .from('late_charge_item')
    .update({
      status: 'waived',
      waiver_reason: reason.trim(),
      waived_by: session.userId,
      waived_at: new Date().toISOString(),
    })
    .eq('id', itemId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'late_charge.waived',
    object_type: 'late_charge_item',
    object_id: itemId,
    snapshot: {
      documentNo: item.document_no,
      amount: item.charge_amount,
      partyId: item.party_id,
      reason: reason.trim(),
      authority: authority.reason,
      role: session.roleCode,
    },
  });

  return NextResponse.json({ ok: true });
}
