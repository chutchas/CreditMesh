import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isLocale, LOCALES, type Locale } from '../../lib/i18n/config';
import { getDictionary } from '../../lib/i18n/dictionaries';
import { getSession } from '../../lib/session';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);
  const session = await getSession();

  const nav: { href: string; label: string }[] = [
    { href: `/${locale}`, label: t.nav.dashboard },
    { href: `/${locale}/portfolio`, label: t.nav.portfolio },
    { href: `/${locale}/groups`, label: t.nav.groups },
    { href: `/${locale}/suppliers`, label: t.nav.suppliers },
    { href: `/${locale}/collateral`, label: t.nav.collateral },
    { href: `/${locale}/simulator`, label: t.nav.simulator },
    { href: `/${locale}/import`, label: t.nav.import },
    { href: `/${locale}/admin`, label: t.nav.admin },
  ];

  const other: Locale = locale === 'th' ? 'en' : 'th';

  return (
    <html lang={locale === 'th' ? 'th-TH' : 'en-US'}>
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen">
          <aside className="hidden w-56 shrink-0 border-r border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-5 md:block">
            <Link href={`/${locale}`} className="block px-2">
              <div className="text-base font-semibold tracking-tight text-[var(--color-brand)]">
                {t.common.appName}
              </div>
              <div className="mt-0.5 text-[11px] leading-4 text-[var(--color-muted)]">{t.common.tagline}</div>
            </Link>
            <nav className="mt-6 space-y-0.5">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded px-2 py-1.5 text-sm text-[var(--color-ink)] hover:bg-[var(--color-canvas)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-2.5">
              <div className="truncate text-sm font-medium">{session?.tenantName ?? t.common.appName}</div>
              <div className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
                <Link href={`/${other}`} className="rounded border border-[var(--color-line)] px-2 py-1 uppercase">
                  {other}
                </Link>
                {session ? (
                  <>
                    <span className="hidden sm:inline">{session.email}</span>
                    <form action={`/${locale}/logout`} method="post">
                      <button type="submit" className="rounded border border-[var(--color-line)] px-2 py-1">
                        {t.common.signOut}
                      </button>
                    </form>
                  </>
                ) : (
                  <Link href={`/${locale}/login`} className="rounded border border-[var(--color-line)] px-2 py-1">
                    {t.common.signIn}
                  </Link>
                )}
              </div>
            </header>
            <main className="min-w-0 flex-1 px-5 py-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
