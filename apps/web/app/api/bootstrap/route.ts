import { NextResponse } from 'next/server';
import { createStarterProfile, validateTenantProfile } from '@creditmesh/core';
import { createAdminClient } from '../../../lib/supabase/admin';
import { createClient } from '../../../lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Creates the first workspace for a signed-in user who has none.
 *
 * This is onboarding step 1 of §10, done in one call: a tenant, a starter
 * profile at version 1, one placeholder legal entity, and the caller as admin.
 * Everything it writes is ordinary configuration the admin then edits — nothing
 * here is special-cased for any organisation.
 *
 * Refuses if the caller already belongs to a tenant, so it cannot be used to
 * mint workspaces or escalate an existing user to admin.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from('app_user')
    .select('tenant_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'this account already belongs to a workspace' }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const displayName = String(body.displayName ?? user.email ?? 'CreditMesh').slice(0, 80);
  const slug = `t-${user.id.slice(0, 8)}`;

  const { data: tenant, error: tenantError } = await admin
    .from('tenant')
    .insert({ slug, display_name: displayName })
    .select('id')
    .single();
  if (tenantError || !tenant) {
    return NextResponse.json({ error: tenantError?.message ?? 'could not create tenant' }, { status: 500 });
  }

  const profile = createStarterProfile(tenant.id, displayName);
  const validation = validateTenantProfile(profile);
  if (!validation.ok) {
    // Should be impossible — the starter profile has a test asserting it —
    // but shipping an invalid profile would produce wrong numbers silently.
    return NextResponse.json({ error: 'starter profile failed validation', issues: validation.issues }, { status: 500 });
  }

  await admin.from('legal_entity').insert(
    profile.legalEntities.map((e) => ({
      tenant_id: tenant.id,
      code: e.code,
      display_name: e.displayName,
      currency: e.currency,
    })),
  );

  const { data: profileRow } = await admin
    .from('tenant_profile')
    .insert({
      tenant_id: tenant.id,
      version: 1,
      profile,
      effective_from: profile.effectiveFrom,
      is_current: true,
      created_by: user.id,
    })
    .select('id')
    .single();

  await admin.from('app_user').insert({
    user_id: user.id,
    tenant_id: tenant.id,
    role_code: 'admin',
    entity_scope: [],
    display_name: user.email,
  });

  await admin.from('audit_log').insert({
    tenant_id: tenant.id,
    actor: user.id,
    actor_label: user.email,
    action: 'tenant.bootstrap',
    object_type: 'tenant',
    object_id: tenant.id,
    snapshot: { displayName, profileId: profileRow?.id, requestUrl: new URL(request.url).pathname },
  });

  return NextResponse.json({ tenantId: tenant.id, displayName });
}
