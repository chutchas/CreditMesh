import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { localeRedirectTarget } from './lib/i18n/config';

/**
 * Two jobs: keep the Supabase session cookie refreshed, and make sure every page
 * URL carries a locale segment. Both languages are first-class (NFR §11), so
 * neither is the "real" path with the other bolted on.
 *
 * API routes are exempt from the locale rule and still get the session refresh —
 * see localeRedirectTarget.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const target = localeRedirectTarget(pathname, request.headers.get('accept-language') ?? '');
  if (target) {
    const url = request.nextUrl.clone();
    url.pathname = target;
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]),
          );
        },
      },
    },
  );

  // Refreshes the token if it is close to expiry; the result is discarded here
  // because the pages fetch the user themselves under RLS.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|ico|csv)$).*)'],
};
