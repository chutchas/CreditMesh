import { describe, expect, it } from 'vitest';
import { hasLocalePrefix, localeRedirectTarget } from '../apps/web/lib/i18n/config';

/**
 * Regression cover for a bug that reached the browser: the middleware rewrote
 * every path without a locale segment, API routes included, so `POST
 * /api/bootstrap` was redirected to `/th/api/bootstrap` and came back as a bare
 * 404. Nothing in the type system or the build catches that — only this does.
 */
describe('localeRedirectTarget', () => {
  const th = 'th-TH,th;q=0.9';
  const en = 'en-US,en;q=0.9';

  it('never redirects an API route', () => {
    for (const path of ['/api', '/api/bootstrap', '/api/import', '/api/analysis/run', '/api/export/portfolio']) {
      expect(localeRedirectTarget(path, th)).toBeNull();
      expect(localeRedirectTarget(path, en)).toBeNull();
    }
  });

  it('leaves a path that already carries a locale alone', () => {
    expect(localeRedirectTarget('/th', th)).toBeNull();
    expect(localeRedirectTarget('/en/portfolio', th)).toBeNull();
    expect(localeRedirectTarget('/th/parties/abc', en)).toBeNull();
  });

  it('adds the locale to a bare page path', () => {
    expect(localeRedirectTarget('/', th)).toBe('/th');
    expect(localeRedirectTarget('/portfolio', th)).toBe('/th/portfolio');
    expect(localeRedirectTarget('/portfolio', en)).toBe('/en/portfolio');
  });

  it('falls back to the default locale when the header asks for neither', () => {
    expect(localeRedirectTarget('/', 'ja-JP,ja;q=0.9')).toBe('/th');
    expect(localeRedirectTarget('/', '')).toBe('/th');
  });

  it('does not mistake a path that merely starts with the locale letters', () => {
    // `/theme` begins with "th" but is not the Thai locale.
    expect(hasLocalePrefix('/theme')).toBe(false);
    expect(localeRedirectTarget('/theme', th)).toBe('/th/theme');
    expect(hasLocalePrefix('/entity')).toBe(false);
  });
});
