import { NextResponse } from 'next/server';
import { resolveGroups, type CompanyShareholding, type GroupResolutionParty, type PersonLink } from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Runs group resolution and stores the result as proposals.
 *
 * Everything this writes is in status 'proposed'. §7 Module 2 is explicit that
 * a group nobody has confirmed must not be acted on, and specifically that it
 * must never be used to block an order — so a re-run replaces the proposals and
 * leaves confirmed groups alone. Confirming is a person's decision and it
 * survives every subsequent run.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });

  const admin = createAdminClient();
  const tenantId = session.tenantId;
  const runId = crypto.randomUUID();

  const [{ data: partyRows, error: partyError }, { data: registryRows }, { data: personRows }, { data: relationshipRows }] =
    await Promise.all([
      admin.from('party').select('id, legal_name, tax_id').eq('tenant_id', tenantId).neq('status', 'merged'),
      admin.from('party_registry_profile').select('party_id, registered_address').eq('tenant_id', tenantId),
      admin
        .from('person_party_role')
        .select('person_id, party_id, role, share_pct, person:person_id(full_name)')
        .eq('tenant_id', tenantId),
      admin
        .from('party_relationship')
        .select('from_party_id, to_party_id, kind, evidence')
        .eq('tenant_id', tenantId)
        .eq('kind', 'shareholder_of'),
    ]);

  if (partyError) return NextResponse.json({ error: partyError.message }, { status: 500 });

  const addressByParty = new Map((registryRows ?? []).map((r) => [r.party_id, r.registered_address as string | null]));

  const parties: GroupResolutionParty[] = (partyRows ?? []).map((p) => ({
    partyId: p.id,
    legalName: p.legal_name,
    taxId: p.tax_id,
    registeredAddress: addressByParty.get(p.id) ?? null,
  }));

  const personLinks: PersonLink[] = (personRows ?? []).map((r) => {
    const person = r.person as unknown as { full_name?: string } | null;
    return {
      personKey: r.person_id,
      personName: person?.full_name ?? r.person_id,
      partyId: r.party_id,
      role: r.role as 'director' | 'shareholder',
      sharePct: r.share_pct === null ? null : Number(r.share_pct),
    };
  });

  const shareholdings: CompanyShareholding[] = (relationshipRows ?? []).map((r) => {
    const evidence = (r.evidence ?? []) as { detail?: { sharePct?: number | null } }[];
    return {
      holderPartyId: r.from_party_id,
      ownedPartyId: r.to_party_id,
      sharePct: evidence[0]?.detail?.sharePct ?? null,
    };
  });

  const result = resolveGroups(parties, personLinks, shareholdings, session.profile);

  // Confirmed groups are the organisation's own decisions and are never
  // overwritten by a machine run. Only proposals are replaced.
  const { data: confirmed } = await admin
    .from('party_group')
    .select('id, party_group_member(party_id)')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed');

  const confirmedKeys = new Set(
    (confirmed ?? []).map((g) =>
      ((g.party_group_member ?? []) as { party_id: string }[])
        .map((m) => m.party_id)
        .sort()
        .join('|'),
    ),
  );

  await admin.from('party_group').delete().eq('tenant_id', tenantId).eq('status', 'proposed');

  let proposed = 0;
  let alreadyConfirmed = 0;

  for (const group of result.groups) {
    if (confirmedKeys.has(group.key)) {
      alreadyConfirmed += 1;
      continue;
    }

    const { data: created, error } = await admin
      .from('party_group')
      .insert({
        tenant_id: tenantId,
        name: group.suggestedName,
        confidence: group.confidence,
        evidence: group.evidence,
        status: 'proposed',
        run_id: runId,
        member_count: group.memberPartyIds.length,
      })
      .select('id')
      .single();
    if (error || !created) continue;

    await admin.from('party_group_member').insert(
      group.memberPartyIds.map((partyId) => ({ tenant_id: tenantId, group_id: created.id, party_id: partyId })),
    );

    await admin.from('party_group_edge').insert(
      group.edges.map((edge) => ({
        tenant_id: tenantId,
        group_id: created.id,
        left_party_id: edge.leftPartyId,
        right_party_id: edge.rightPartyId,
        confidence: edge.confidence,
        signals: edge.signals,
      })),
    );

    proposed += 1;
  }

  // The exclusion list gets built from what the data actually contains, rather
  // than expecting someone to curate it correctly before the first run.
  for (const suggestion of result.suggestedExclusions) {
    await admin.from('group_exclusion_suggestion').upsert(
      {
        tenant_id: tenantId,
        kind: suggestion.kind,
        value: suggestion.value,
        party_count: suggestion.partyCount,
      },
      { onConflict: 'tenant_id,kind,value', ignoreDuplicates: false },
    );
  }

  await admin.from('audit_log').insert({
    tenant_id: tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'groups.run',
    object_type: 'tenant',
    object_id: tenantId,
    snapshot: { runId, proposed, alreadyConfirmed, ...result.stats, profileVersion: session.profileVersion },
  });

  return NextResponse.json({ runId, proposed, alreadyConfirmed, ...result.stats });
}
