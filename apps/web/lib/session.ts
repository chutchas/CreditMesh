import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { TenantProfile } from '@creditmesh/core';
import { createStarterProfile, validateTenantProfile } from '@creditmesh/core';
import { createClient } from './supabase/server';
import type { Locale } from './i18n/config';

export interface SessionContext {
  userId: string;
  email: string | null;
  tenantId: string;
  tenantName: string;
  roleCode: string;
  /** Empty means every entity — central credit, admin, auditor. */
  entityScope: string[];
  profile: TenantProfile;
  profileVersion: number | null;
}

/**
 * Loaded once per request. Every page needs the profile — currency, grades,
 * ageing buckets, vocabulary — and re-fetching it per component would turn one
 * screen into a dozen round trips.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: appUser } = await supabase
    .from('app_user')
    .select('tenant_id, role_code, entity_scope, tenant:tenant_id(display_name)')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!appUser) return null;

  const { data: profileRow } = await supabase
    .from('tenant_profile')
    .select('version, profile')
    .eq('tenant_id', appUser.tenant_id)
    .eq('is_current', true)
    .maybeSingle();

  const tenantName =
    (appUser.tenant as unknown as { display_name?: string } | null)?.display_name ?? 'CreditMesh';

  // A tenant with no stored profile still renders, on the starter defaults.
  // Failing the whole app because configuration is incomplete would make the
  // product unusable exactly when an admin is trying to configure it.
  let profile: TenantProfile;
  let profileVersion: number | null = null;
  if (profileRow?.profile) {
    const result = validateTenantProfile(profileRow.profile);
    profile = result.ok ? result.profile : createStarterProfile(appUser.tenant_id, tenantName);
    profileVersion = result.ok ? profileRow.version : null;
  } else {
    profile = createStarterProfile(appUser.tenant_id, tenantName);
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    tenantId: appUser.tenant_id,
    tenantName,
    roleCode: appUser.role_code,
    entityScope: appUser.entity_scope ?? [],
    profile,
    profileVersion,
  };
});

/**
 * A signed-in account with no workspace is a distinct state from being signed
 * out, and sending it back to the login screen produces a loop the user cannot
 * escape. It goes to setup instead.
 */
export async function requireSession(locale: Locale): Promise<SessionContext> {
  const session = await getSession();
  if (session) return session;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? `/${locale}/setup` : `/${locale}/login`);
}

const WRITE_ROLES = new Set(['admin', 'central_credit']);

export function canWrite(session: SessionContext): boolean {
  return WRITE_ROLES.has(session.roleCode);
}
