'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { validateTenantProfile, type TenantProfile } from '@creditmesh/core';
import type { Locale } from '../../../lib/i18n/config';
import {
  makeSay,
  SECTION_IDS,
  sectionForPath,
  sectionRef,
  sectionTitle,
  type SectionId,
} from './shared';
import { EnrichmentSection, EntitiesSection, IdentitySection, SourcesSection } from './sections-config';
import { CollateralPolicySection, CreditPolicySection, GroupResolutionSection } from './sections-policy';
import { BrandingSection, GovernanceSection, NotificationSection, WorkflowSection } from './sections-ops';

export interface ProfileVersion {
  id: string;
  version: number;
  effective_from: string;
  is_current: boolean;
  created_at: string;
}

/** Which top-level keys of the profile a section owns, for the changed marker. */
const SECTION_KEYS: Record<SectionId, (keyof TenantProfile)[]> = {
  identity: ['identity', 'effectiveFrom'],
  entities: ['legalEntities'],
  sources: ['sourceSystems', 'fieldMappings'],
  enrichment: ['enrichmentProviders'],
  credit: ['creditPolicy'],
  collateral: ['collateralPolicy'],
  groups: ['groupResolution'],
  workflow: ['workflow'],
  notification: ['notification'],
  branding: ['branding'],
  governance: ['governance'],
};

export default function ProfileEditor({
  locale,
  initialProfile,
  versions,
  canEdit,
}: {
  locale: Locale;
  initialProfile: TenantProfile;
  versions: ProfileVersion[];
  canEdit: boolean;
}) {
  const say = makeSay(locale);
  const router = useRouter();

  const [draft, setDraft] = useState<TenantProfile>(initialProfile);
  const [active, setActive] = useState<SectionId>('identity');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const update = (patch: Partial<TenantProfile>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setSaved(null);
  };

  // Validation runs on every keystroke against the same function the server
  // uses, so a rule can never be enforced in one place and not the other.
  const validation = useMemo(() => validateTenantProfile(draft), [draft]);
  const issues = validation.ok ? [] : validation.issues;

  const issuesBySection = useMemo(() => {
    const map = new Map<SectionId, number>();
    for (const issue of issues) {
      const section = sectionForPath(issue.path);
      if (section) map.set(section, (map.get(section) ?? 0) + 1);
    }
    return map;
  }, [issues]);

  const changedSections = useMemo(() => {
    const changed = new Set<SectionId>();
    for (const id of SECTION_IDS) {
      for (const key of SECTION_KEYS[id]) {
        if (JSON.stringify(draft[key]) !== JSON.stringify(initialProfile[key])) {
          changed.add(id);
          break;
        }
      }
    }
    return changed;
  }, [draft, initialProfile]);

  const dirty = changedSections.size > 0;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: draft }),
    });
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    setBusy(false);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `POST /api/profile → ${res.status} ${res.statusText}`);
      return;
    }
    setSaved(say(`บันทึกเป็นเวอร์ชัน ${body.version} แล้ว`, `Saved as version ${body.version}`));
    router.refresh();
  }

  async function rollback(profileId: string, version: number) {
    if (!confirm(say(`ย้อนกลับไปใช้เวอร์ชัน ${version}?`, `Roll back to version ${version}?`))) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/profile/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId }),
    });
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    setBusy(false);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `POST /api/profile/activate → ${res.status}`);
      return;
    }
    router.refresh();
  }

  const sectionProps = { profile: draft, update, say, disabled: !canEdit || busy };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,15rem)_1fr]">
      <nav className="space-y-0.5">
        {SECTION_IDS.map((id) => {
          const errorCount = issuesBySection.get(id) ?? 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActive(id)}
              className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-sm ${
                active === id ? 'bg-[var(--color-brand)] text-white' : 'hover:bg-[var(--color-canvas)]'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate">{sectionTitle(id, say)}</span>
                <span className={`text-[10px] ${active === id ? 'text-white/60' : 'text-[var(--color-muted)]'}`}>
                  {sectionRef(id)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {changedSections.has(id) ? (
                  <span
                    title={say('มีการแก้ไข', 'Changed')}
                    className={`h-1.5 w-1.5 rounded-full ${active === id ? 'bg-white' : 'bg-[var(--color-brand)]'}`}
                  />
                ) : null}
                {errorCount > 0 ? (
                  <span className="rounded bg-[#b42318] px-1.5 text-[10px] font-semibold text-white">{errorCount}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-line)] bg-white px-4 py-3">
          <div className="text-sm">
            {!canEdit ? (
              <span className="text-[var(--color-muted)]">
                {say('ต้องเป็นผู้ดูแลระบบจึงจะแก้ไขได้', 'Only an admin can change this')}
              </span>
            ) : dirty ? (
              <span>
                {say('แก้ไขแล้ว', 'Changed')} {changedSections.size} {say('ส่วน', 'section(s)')}
                {issues.length > 0 ? (
                  <span className="ml-2 text-[#b42318]">
                    · {issues.length} {say('ข้อผิดพลาด', 'issue(s)')}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="text-[var(--color-muted)]">{say('ยังไม่มีการแก้ไข', 'No changes')}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!dirty || busy}
              onClick={() => {
                setDraft(initialProfile);
                setSaved(null);
                setError(null);
              }}
              className="rounded border border-[var(--color-line)] px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {say('ยกเลิกการแก้ไข', 'Discard')}
            </button>
            <button
              type="button"
              // Saving an invalid profile is blocked here and refused again by
              // the server: a profile that cannot be validated must never
              // become the one the engines read.
              disabled={!canEdit || !dirty || busy || issues.length > 0}
              onClick={save}
              className="rounded bg-[var(--color-brand)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {busy ? '…' : say('บันทึกเป็นเวอร์ชันใหม่', 'Save as new version')}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded border border-[#f5c2c0] bg-[#fef3f2] p-3 text-sm text-[#b42318]">{error}</div>
        ) : null}
        {saved ? (
          <div className="mb-4 rounded border border-[#abdfb8] bg-[#f0fdf4] p-3 text-sm text-[#1a7f37]">{saved}</div>
        ) : null}

        {issuesBySection.get(active) ? (
          <div className="mb-4 rounded border border-[#f5c2c0] bg-[#fef3f2] p-3 text-xs text-[#b42318]">
            <ul className="list-inside list-disc space-y-0.5">
              {issues
                .filter((i) => sectionForPath(i.path) === active)
                .map((issue, index) => (
                  <li key={index}>
                    <code>{issue.path}</code> — {issue.message}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}

        <section className="rounded-lg border border-[var(--color-line)] bg-white p-4">
          <h2 className="mb-4 border-b border-[var(--color-line)] pb-2 text-sm font-semibold">
            {sectionTitle(active, say)}{' '}
            <span className="font-normal text-[var(--color-muted)]">{sectionRef(active)}</span>
          </h2>

          {active === 'identity' ? <IdentitySection {...sectionProps} /> : null}
          {active === 'entities' ? <EntitiesSection {...sectionProps} /> : null}
          {active === 'sources' ? <SourcesSection {...sectionProps} /> : null}
          {active === 'enrichment' ? <EnrichmentSection {...sectionProps} /> : null}
          {active === 'credit' ? <CreditPolicySection {...sectionProps} /> : null}
          {active === 'collateral' ? <CollateralPolicySection {...sectionProps} /> : null}
          {active === 'groups' ? <GroupResolutionSection {...sectionProps} /> : null}
          {active === 'workflow' ? <WorkflowSection {...sectionProps} /> : null}
          {active === 'notification' ? <NotificationSection {...sectionProps} /> : null}
          {active === 'branding' ? <BrandingSection {...sectionProps} /> : null}
          {active === 'governance' ? <GovernanceSection {...sectionProps} /> : null}
        </section>

        <section className="mt-5 rounded-lg border border-[var(--color-line)] bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold">{say('ประวัติเวอร์ชัน', 'Version history')}</h2>
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            {say(
              'เวอร์ชันเก่าไม่ถูกลบ และคะแนนความเสี่ยงบันทึกไว้ว่าคำนวณด้วย profile เวอร์ชันไหน — คะแนนของไตรมาสก่อนจึงยังอธิบายได้แม้น้ำหนักจะเปลี่ยนไปแล้ว',
              'Old versions are never deleted, and every risk assessment records the version that produced it, so last quarter’s score is still explainable after the weights change.',
            )}
          </p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-[var(--color-muted)]">
              <tr>
                <th className="py-1.5 pr-3 font-medium">{say('เวอร์ชัน', 'Version')}</th>
                <th className="py-1.5 pr-3 font-medium">{say('มีผลตั้งแต่', 'Effective from')}</th>
                <th className="py-1.5 pr-3 font-medium">{say('บันทึกเมื่อ', 'Saved')}</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-[var(--color-line)]">
                  <td className="tabular py-1.5 pr-3">
                    v{v.version}
                    {v.is_current ? (
                      <span className="ml-2 rounded bg-[#1a7f37] px-1.5 py-0.5 text-[10px] text-white">
                        {say('ใช้อยู่', 'current')}
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular py-1.5 pr-3">{v.effective_from}</td>
                  <td className="py-1.5 pr-3 text-[var(--color-muted)]">
                    {new Date(v.created_at).toLocaleString(locale === 'th' ? 'th-TH' : 'en-US')}
                  </td>
                  <td className="py-1.5 text-right">
                    {!v.is_current && canEdit ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => rollback(v.id, v.version)}
                        className="text-xs text-[var(--color-brand)] disabled:opacity-50"
                      >
                        {say('ย้อนกลับมาใช้', 'Roll back to this')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
