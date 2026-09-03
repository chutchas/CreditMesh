import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Closes a payment exception.
 *
 * The exception is never deleted and the credit signal it raised is never
 * withdrawn by closing it. A returned cheque that was later made good is still
 * a fact about how that counterparty paid in March, and the score that used it
 * has to stay explainable (P6). Closing says the operational work is done, not
 * that the event did not happen.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const { exceptionId, status, note } = (await request.json().catch(() => ({}))) as {
    exceptionId?: string;
    status?: string;
    note?: string;
  };

  if (!exceptionId || (status !== 'resolved' && status !== 'written_off')) {
    return NextResponse.json({ error: 'exceptionId and a valid status are required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: exception, error } = await admin
    .from('payment_exception')
    .select('id, tenant_id, type, amount, reference, party_id, occurred_at')
    .eq('id', exceptionId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!exception || exception.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'exception not found' }, { status: 404 });
  }

  const { error: updateError } = await admin
    .from('payment_exception')
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: session.userId,
      resolution_note: note?.trim() || null,
    })
    .eq('id', exceptionId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: `exception.${status}`,
    object_type: 'payment_exception',
    object_id: exceptionId,
    snapshot: {
      type: exception.type,
      amount: exception.amount,
      reference: exception.reference,
      occurredAt: exception.occurred_at,
      partyId: exception.party_id,
      note: note?.trim() ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
