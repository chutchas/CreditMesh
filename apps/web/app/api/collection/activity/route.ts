import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';

const ACTIVITY_TYPES = new Set(['call', 'email', 'letter', 'visit', 'note', 'stage_change', 'reorder']);

/**
 * Records what a collector did, and the two things that come out of a call:
 * a promise to pay, or a dispute.
 *
 * `reorder` is logged like any other activity. §7's advice on getting this
 * module adopted is to let collectors move the queue and keep what they moved;
 * that record is worth more than the ordering we shipped with, because it is
 * the only evidence of what the weights should have been.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    caseId?: string;
    type?: string;
    outcome?: string;
    note?: string;
    contactPerson?: string;
    promise?: { amount: number; promisedDate: string };
    dispute?: { reasonCode: string; amount: number; note?: string };
    manualRank?: number | null;
    stage?: string;
  };

  if (!body.caseId || !body.type || !ACTIVITY_TYPES.has(body.type)) {
    return NextResponse.json({ error: 'caseId and a valid type are required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: kase, error } = await admin
    .from('collection_case')
    .select('id, tenant_id, party_id, legal_entity_code, stage')
    .eq('id', body.caseId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!kase || kase.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'case not found' }, { status: 404 });
  }

  const now = new Date().toISOString();

  const { error: activityError } = await admin.from('collection_activity').insert({
    tenant_id: session.tenantId,
    case_id: body.caseId,
    type: body.type,
    outcome: body.outcome ?? null,
    note: body.note ?? null,
    contact_person: body.contactPerson ?? null,
    occurred_at: now,
    created_by: session.userId,
  });
  if (activityError) return NextResponse.json({ error: activityError.message }, { status: 500 });

  const casePatch: Record<string, unknown> = {};
  // A note is not contact. Only an actual attempt to reach the customer moves
  // "last contacted", or the gone-quiet count stops meaning anything.
  if (['call', 'email', 'letter', 'visit'].includes(body.type)) casePatch.last_contact_at = now;
  if (body.stage) casePatch.stage = body.stage;
  if (body.manualRank !== undefined) casePatch.manual_rank = body.manualRank;
  if (Object.keys(casePatch).length > 0) {
    await admin.from('collection_case').update(casePatch).eq('id', body.caseId);
  }

  if (body.promise) {
    const { error: promiseError } = await admin.from('promise_to_pay').insert({
      tenant_id: session.tenantId,
      case_id: body.caseId,
      party_id: kase.party_id,
      amount: body.promise.amount,
      currency: 'THB',
      promised_date: body.promise.promisedDate,
      status: 'open',
      note: body.note ?? null,
      created_by: session.userId,
    });
    if (promiseError) return NextResponse.json({ error: promiseError.message }, { status: 500 });
  }

  if (body.dispute) {
    const { error: disputeError } = await admin.from('collection_dispute').insert({
      tenant_id: session.tenantId,
      case_id: body.caseId,
      reason_code: body.dispute.reasonCode,
      amount: body.dispute.amount,
      status: 'open',
      owner_user_id: session.userId,
      note: body.dispute.note ?? body.note ?? null,
    });
    if (disputeError) return NextResponse.json({ error: disputeError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
