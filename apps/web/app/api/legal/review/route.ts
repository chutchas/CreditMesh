import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * A person confirms or rejects a legal search result.
 *
 * Confirming may also attach the result to a counterparty the engine refused to
 * attach it to on a name. That is the whole point of the review step: a human
 * with the case document in front of them can make a link the engine must not
 * make on its own, and the record keeps who did it.
 *
 * A rejection is never a delete. The result stays, marked rejected, so the same
 * false positive is not re-raised by the next upload and so the decision itself
 * is auditable.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const { eventId, decision, partyId, note } = (await request.json().catch(() => ({}))) as {
    eventId?: string;
    decision?: 'confirmed' | 'rejected';
    partyId?: string | null;
    note?: string;
  };

  if (!eventId || (decision !== 'confirmed' && decision !== 'rejected')) {
    return NextResponse.json({ error: 'eventId and decision are required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: event, error } = await admin
    .from('legal_event')
    .select('id, tenant_id, party_id, subject_name, event_type, severity, case_no, source, match_basis')
    .eq('id', eventId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!event || event.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'event not found' }, { status: 404 });
  }

  // Confirming with no counterparty attached and none supplied would create a
  // "confirmed" event about nobody, which every downstream screen would then
  // have to special-case. Refuse it here instead.
  const resolvedPartyId = partyId ?? event.party_id;
  if (decision === 'confirmed' && !resolvedPartyId) {
    return NextResponse.json(
      { error: 'confirming a result requires the counterparty it belongs to' },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {
    review_status: decision,
    reviewed_by: session.userId,
    reviewed_at: new Date().toISOString(),
    review_note: note?.trim() || null,
  };
  if (decision === 'confirmed' && partyId && partyId !== event.party_id) {
    patch.party_id = partyId;
    // The basis is rewritten to say a human made this link, not an identifier.
    // A later reader must be able to tell the two apart.
    patch.match_basis = 'name_only';
    patch.match_note = `linked by ${session.email} during review`;
  }

  const { error: updateError } = await admin.from('legal_event').update(patch).eq('id', eventId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: `legal.${decision}`,
    object_type: 'legal_event',
    object_id: eventId,
    snapshot: {
      subjectName: event.subject_name,
      eventType: event.event_type,
      severity: event.severity,
      caseNo: event.case_no,
      source: event.source,
      matchBasisBefore: event.match_basis,
      partyIdBefore: event.party_id,
      partyIdAfter: resolvedPartyId,
      note: note?.trim() ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
