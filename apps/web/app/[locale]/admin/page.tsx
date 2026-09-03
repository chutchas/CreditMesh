import { validateTenantProfile } from '@creditmesh/core';
import { isLocale } from '../../../lib/i18n/config';
import { getDictionary } from '../../../lib/i18n/dictionaries';
import { requireSession } from '../../../lib/session';
import { formatDate } from '../../../lib/format';
import { Card, GradeBadge, PageHeader, Table } from '../../../components/ui';

/**
 * Read-only view of the active profile plus its validation result.
 *
 * The editing UI is R2 work. Showing the profile now still earns its place:
 * onboarding step 4 (§10) is the one that overruns, and it overruns because
 * nobody can see what the system currently believes the organisation's
 * structure and policy are.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'th';
  const t = getDictionary(locale);
  const session = await requireSession(locale);
  const profile = session.profile;
  const validation = validateTenantProfile(profile);

  return (
    <>
      <PageHeader
        title={t.admin.title}
        subtitle={`${t.admin.profileVersion} ${session.profileVersion ?? '—'} · ${t.admin.effectiveFrom} ${formatDate(profile.effectiveFrom, locale)}`}
      />

      <div
        className={`mb-4 rounded border p-3 text-sm ${
          validation.ok ? 'border-[#abdfb8] bg-[#f0fdf4] text-[#1a7f37]' : 'border-[#f5c2c0] bg-[#fef3f2] text-[#b42318]'
        }`}
      >
        {validation.ok ? (
          t.admin.valid
        ) : (
          <>
            <p className="font-medium">{t.admin.invalid}</p>
            <ul className="mt-1 list-inside list-disc text-xs">
              {validation.issues.map((issue, i) => (
                <li key={i}>
                  <code>{issue.path}</code> — {issue.message}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t.admin.entities}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">code</th>
                <th className="py-2 pr-3 font-medium">name</th>
                <th className="py-2 pr-3 font-medium">{t.common.currency}</th>
                <th className="py-2 font-medium">parent</th>
              </tr>
            }
          >
            {profile.legalEntities.map((e) => (
              <tr key={e.code} className="border-b border-[var(--color-line)] last:border-0">
                <td className="py-2 pr-3 font-medium">{e.code}</td>
                <td className="py-2 pr-3">{e.displayName}</td>
                <td className="py-2 pr-3">{e.currency}</td>
                <td className="py-2 text-[var(--color-muted)]">{e.parentGroup ?? '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title={t.admin.grades}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">{t.portfolio.grade}</th>
                <th className="py-2 pr-3 font-medium">label</th>
                <th className="py-2 text-right font-medium">{t.portfolio.score}</th>
              </tr>
            }
          >
            {profile.creditPolicy.riskGrades.map((g) => (
              <tr key={g.code} className="border-b border-[var(--color-line)] last:border-0">
                <td className="py-2 pr-3">
                  <GradeBadge grade={g.code} color={g.color} />
                </td>
                <td className="py-2 pr-3">{g.label}</td>
                <td className="tabular py-2 text-right">
                  {g.minScore} – {g.maxScore}
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title={t.admin.roles}>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">code</th>
                <th className="py-2 pr-3 font-medium">label</th>
                <th className="py-2 font-medium">{t.common.entity}</th>
              </tr>
            }
          >
            {profile.workflow.roles.map((r) => (
              <tr key={r.code} className="border-b border-[var(--color-line)] last:border-0">
                <td className="py-2 pr-3 font-medium">{r.code}</td>
                <td className="py-2 pr-3">{r.label}</td>
                <td className="py-2 text-[var(--color-muted)]">
                  {r.entityScope.length === 0 ? t.common.all : r.entityScope.join(', ')}
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Aging & DPD">
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            dpdDefinition: <code>{profile.creditPolicy.dpdDefinition}</code>
          </p>
          <Table
            head={
              <tr>
                <th className="py-2 pr-3 font-medium">code</th>
                <th className="py-2 pr-3 font-medium">label</th>
                <th className="py-2 text-right font-medium">days</th>
              </tr>
            }
          >
            {profile.creditPolicy.agingBuckets.map((b) => (
              <tr key={b.code} className="border-b border-[var(--color-line)] last:border-0">
                <td className="py-2 pr-3">{b.code}</td>
                <td className="py-2 pr-3">{b.label}</td>
                <td className="tabular py-2 text-right">
                  {b.fromDays < -9999 ? '≤' : b.fromDays} {b.toDays === null ? '+' : `– ${b.toDays}`}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
