import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Request-scoped client carrying the signed-in user's JWT, so every query runs
 * under the RLS policies in migration 0007. This is what the pages read
 * through: the database, not the application, decides what a user may see.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        // Typed explicitly: the cookie store's own option type is Next's, not
        // Supabase's, so contextual inference does not reach these callbacks.
        setAll: (cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]),
            );
          } catch {
            // Server Components cannot set cookies; middleware refreshes the
            // session instead, so this is expected rather than an error.
          }
        },
      },
    },
  );
}
