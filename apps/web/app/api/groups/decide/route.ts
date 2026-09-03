import { NextResponse } from 'next/server';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * A person confirms or rejects a proposed group.
 *
 * This endpoint is the whole reason group resolution is safe to ship. The
 * engine proposes; nothing downstream may treat a group as real until someone
 * accountable has looked at the evidence and said so, and the audit record
 * keeps the numbers they were looking at when they decided.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const { groupId, decision, name } = (await request.json().catch(() => ({}))) as {
    groupId?: string;
    decision?: 'confirmed' | 'rejected';
    name?: string;
  };

  if (!groupId || (decision !== 'confirmed' && decision !== 'rejected')) {
    return NextResponse.json({ error: 'groupId and decision are required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: group, error } = await admin
    .from('party_group')
    .select('id, tenant_id, name, confidence, status, member_count, evidence')
    .eq('id', groupId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!group || group.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'group not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const patch =
    decision === 'confirmed'
      ? { status: 'confirmed', confirmed_by: session.userId, confirmed_at: now, name: name?.trim() || group.name }
      : { status: 'rejected', rejected_by: session.userId, rejected_at: now };

  const { error: updateError } = await admin.from('party_group').update(patch).eq('id', groupId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const { data: members } = await admin
    .from('party_group_member')
    .select('party_id, party:party_id(legal_name, tax_id)')
    .eq('group_id', groupId);

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: `groups.${decision}`,
    object_type: 'party_group',
    object_id: groupId,
    snapshot: {
      name: patch.status === 'confirmed' ? (name?.trim() || group.name) : group.name,
      confidence: group.confidence,
      memberCount: group.member_count,
      members: (members ?? []).map((m) => {
        const party = m.party as unknown as { legal_name?: string; tax_id?: string | null } | null;
        return { partyId: m.party_id, legalName: party?.legal_name, taxId: party?.tax_id };
      }),
      evidence: group.evidence,
    },
  });

  return NextResponse.json({ status: decision });
}
