import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS, so it is confined to server-side handlers
 * that ingest data or write state, and every one of those checks the caller's
 * permissions itself and writes audit_log in the same operation.
 *
 * Never import this from a client component. `server-only` above turns that
 * mistake into a build error rather than a leaked key.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set — ingestion and writes are disabled until it is configured',
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
