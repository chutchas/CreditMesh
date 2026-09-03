import { redirect } from 'next/navigation';
import { isLocale } from '../../../lib/i18n/config';
import { getSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import SetupForm from './setup-form';

/**
 * Where a signed-in account with no workspace lands. Onboarding §10 step 1.
 */
export default async function SetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const session = await getSession();
  if (session) redirect(`/${locale}`);

  return (
    <div className="mx-auto max-w-md py-16">
      <h1 className="text-lg font-semibold">CreditMesh</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--color-muted)]">
        {locale === 'th'
          ? 'บัญชีนี้ยังไม่ผูกกับองค์กรใด สร้าง workspace เพื่อเริ่มตั้งค่า Tenant Profile'
          : 'This account is not linked to an organisation yet. Create a workspace to start configuring the tenant profile.'}
      </p>
      <SetupForm locale={locale} defaultName={user.email ?? 'CreditMesh'} />
    </div>
  );
}
