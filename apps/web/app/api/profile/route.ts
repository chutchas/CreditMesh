import { NextResponse } from 'next/server';
import { validateTenantProfile } from '@creditmesh/core';
import { createAdminClient } from '../../../lib/supabase/admin';
import { getSession } from '../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Saves a new version of the Tenant Profile.
 *
 * P1 says the profile is what makes an organisation's setup a data task rather
 * than a development task, and §9 makes it the release gate: if a customer
 * still needs a code change, the release is not ready. This endpoint is what
 * closes that gap — but only if it keeps two promises.
 *
 * First, a profile is never edited in place. Every save is a new version, the
 * old one stays readable, and risk_assessment records the version that produced
 * it, so a score computed last quarter can still be explained when the weights
 * have since changed (P6).
 *
 * Second, nothing invalid is ever made current. Validation runs here as well as
 * in the browser, because the browser is not where correctness is decided.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (session.roleCode !== 'admin') {
    return NextResponse.json({ error: 'only an admin can change the tenant profile' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected a profile object' }, { status: 400 });
  }

  const candidate = (body as { profile?: unknown }).profile ?? body;
  const validation = validateTenantProfile(candidate);
  if (!validation.ok) {
    return NextResponse.json(
      { error: 'the profile has validation errors', issues: validation.issues },
      { status: 422 },
    );
  }
  const profile = validation.profile;

  // The tenant id in the profile is informational; the session decides which
  // tenant is being written, so a crafted body cannot reach another tenant.
  if (profile.identity.tenantId !== session.tenantId) {
    profile.identity.tenantId = session.tenantId;
  }

  const admin = createAdminClient();

  const { data: latest, error: latestError } = await admin
    .from('tenant_profile')
    .select('version')
    .eq('tenant_id', session.tenantId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return NextResponse.json({ error: latestError.message }, { status: 500 });

  const nextVersion = (latest?.version ?? 0) + 1;

  const { data: inserted, error: insertError } = await admin
    .from('tenant_profile')
    .insert({
      tenant_id: session.tenantId,
      version: nextVersion,
      profile,
      effective_from: profile.effectiveFrom,
      is_current: false,
      created_by: session.userId,
    })
    .select('id, version')
    .single();
  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? 'could not save the profile' }, { status: 500 });
  }

  const { error: activateError } = await admin.rpc('set_current_profile', { p_profile_id: inserted.id });
  if (activateError) {
    return NextResponse.json({ error: activateError.message }, { status: 500 });
  }

  const entitySync = await syncLegalEntities(admin, session.tenantId, profile.legalEntities);

  await admin.from('tenant').update({
    display_name: profile.identity.displayName,
    base_currency: profile.identity.baseCurrency,
    locale: profile.identity.locale,
    timezone: profile.identity.timezone,
  }).eq('id', session.tenantId);

  await admin.from('audit_log').insert({
    tenant_id: session.tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'profile.publish',
    object_type: 'tenant_profile',
    object_id: inserted.id,
    // The whole profile, not a diff: an approver has to be able to see exactly
    // what the configuration was at the moment it took effect.
    snapshot: { version: inserted.version, profile, entitySync },
  });

  return NextResponse.json({ version: inserted.version, profileId: inserted.id, entitySync });
}

/**
 * Mirrors the profile's legal entities into the table that carries the foreign
 * keys.
 *
 * Entities are never deleted, only deactivated. Receivables, limits and
 * collateral allocations all point here, and an entity that has ever carried a
 * balance has to remain resolvable for the history to stay readable.
 */
async function syncLegalEntities(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  entities: { code: string; displayName: string; currency: string; parentGroup: string | null; isActive: boolean }[],
): Promise<{ upserted: number; deactivated: string[]; errors: string[] }> {
  const errors: string[] = [];

  const { data: existing } = await admin.from('legal_entity').select('code').eq('tenant_id', tenantId);
  const existingCodes = new Set((existing ?? []).map((e) => e.code));
  const profileCodes = new Set(entities.map((e) => e.code));

  // Parents must exist before children: the table has a self-referencing key.
  const ordered = [...entities].sort((a, b) => {
    if (a.parentGroup === null && b.parentGroup !== null) return -1;
    if (a.parentGroup !== null && b.parentGroup === null) return 1;
    return 0;
  });

  for (const entity of ordered) {
    const row = {
      tenant_id: tenantId,
      code: entity.code,
      display_name: entity.displayName,
      currency: entity.currency,
      parent_code: entity.parentGroup,
      is_active: entity.isActive,
    };
    const { error } = existingCodes.has(entity.code)
      ? await admin.from('legal_entity').update(row).eq('tenant_id', tenantId).eq('code', entity.code)
      : await admin.from('legal_entity').insert(row);
    if (error) errors.push(`${entity.code}: ${error.message}`);
  }

  const deactivated = [...existingCodes].filter((code) => !profileCodes.has(code));
  if (deactivated.length > 0) {
    const { error } = await admin
      .from('legal_entity')
      .update({ is_active: false })
      .eq('tenant_id', tenantId)
      .in('code', deactivated);
    if (error) errors.push(`deactivating ${deactivated.join(', ')}: ${error.message}`);
  }

  return { upserted: entities.length, deactivated, errors };
}
