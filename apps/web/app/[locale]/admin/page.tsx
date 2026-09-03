import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { requireSession } from '../../../lib/session';
import { createClient } from '../../../lib/supabase/server';
import { formatDate } from '../../../lib/format';
import { PageHeader } from '../../../components/ui';
import ProfileEditor, { type ProfileVersion } from './profile-editor';

/**
 * The Tenant Profile screen.
 *
 * §9 makes this the release gate rather than a nicety: "a new organisation can
 * configure this release from a Tenant Profile and adapters without a code
 * change — if code still has to change, the release is not ready." Every
 * setting the engines read is editable here, in both languages, versioned.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const supabase = await createClient();

  const { data: versions } = await supabase
    .from('tenant_profile')
    .select('id, version, effective_from, is_current, created_at')
    .order('version', { ascending: false })
    .limit(50);

  return (
    <>
      <PageHeader
        title={t.admin.title}
        subtitle={`${t.admin.profileVersion} ${session.profileVersion ?? '—'} · ${t.admin.effectiveFrom} ${formatDate(
          session.profile.effectiveFrom,
          locale,
        )}`}
      />
      <ProfileEditor
        locale={locale}
        initialProfile={session.profile}
        versions={(versions ?? []) as ProfileVersion[]}
        canEdit={session.roleCode === 'admin'}
      />
    </>
  );
}
