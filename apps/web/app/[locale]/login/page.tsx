import { redirect } from 'next/navigation';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { isLocale } from '../../../lib/i18n/config';
import { getSession } from '../../../lib/session';
import LoginForm from './login-form';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const safeLocale = isLocale(locale) ? locale : 'th';
  const session = await getSession();
  if (session) redirect(`/${safeLocale}`);
  const t = getDictionary(safeLocale);

  return (
    <div className="mx-auto max-w-sm py-16">
      <h1 className="text-lg font-semibold">{t.common.appName}</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--color-muted)]">{t.common.tagline}</p>
      <LoginForm
        locale={safeLocale}
        labels={{ email: t.common.email, password: t.common.password, submit: t.common.signIn }}
      />
    </div>
  );
}
