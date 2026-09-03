export const LOCALES = ['th', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'th';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function hasLocalePrefix(pathname: string): boolean {
  return LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
}

/**
 * Pages carry a locale segment; API routes do not, and must never be rewritten
 * to acquire one.
 *
 * Getting this wrong is not a cosmetic bug: a POST redirected to a path that
 * does not exist comes back as a plain 404, so the caller sees "Not Found" with
 * no hint that a redirect happened at all. Keeping the rule in one tested
 * function rather than inline in the middleware is the point of this file.
 */
export function localeRedirectTarget(pathname: string, acceptLanguage: string): string | null {
  if (pathname.startsWith('/api/') || pathname === '/api') return null;
  if (hasLocalePrefix(pathname)) return null;

  const header = acceptLanguage.toLowerCase();
  const preferred = LOCALES.find((l) => header.includes(l)) ?? DEFAULT_LOCALE;
  return `/${preferred}${pathname === '/' ? '' : pathname}`;
}
