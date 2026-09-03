import { NextResponse } from 'next/server';
import { validateTenantProfile } from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { getSession } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Makes an existing profile version current again.
 *
 * Rolling back is a first-class action rather than a database chore, because
 * the alternative — retyping last week's settings from memory under pressure —
 * is how a bad configuration becomes two bad configurations. The old version is
 * re-validated first: rules can tighten between versions, and a profile that
 * was acceptable then may not be now.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (session.roleCode !== 'admin') {
    return NextResponse.json({ error: 'only an admin can change the tenant profile' }, { status: 403 });
  }

  const { profileId } = (await request.json().catch(() => ({}))) as { profileId?: string };
  if (!profileId) return NextResponse.json({ error: 'profileId is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from('tenant_profile')
    .select('id, version, profile, tenant_id')
    .eq('id', profileId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row || row.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'version not found' }, { status: 404 });
  }

  const validation = validateTenantProfile(row.profile);
  if (!validation.ok) {
    return NextResponse.json(
      { error: `version ${row.version} no longer passes validation`, issues: validation.issues },
      { status: 422 },
    );
  }

  const { error: activateError } = await admin.rpc('set_current_profile', { p_profile_id: row.id });
  if (activateError) return NextResponse.json({ error: activateError.message }, { status: 500 });

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'profile.rollback',
    object_type: 'tenant_profile',
    object_id: row.id,
    snapshot: { version: row.version, profile: row.profile },
  });

  return NextResponse.json({ version: row.version });
}
