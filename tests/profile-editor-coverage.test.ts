import { describe, expect, it } from 'vitest';
import { createStarterProfile } from '@creditmesh/core';
import { SECTION_IDS, SECTION_KEYS, sectionForPath, sectionRef, sectionTitle, makeSay } from '../apps/web/app/[locale]/admin/shared';

/**
 * Every section of the Tenant Profile must be editable from the editor.
 *
 * This exists because five of them were not. Sections 4.12–4.16 shipped as
 * schema and as engine inputs before they shipped as a screen, so seven modules
 * were reading configuration that could only be changed by editing source and
 * deploying. P1 makes the profile the thing that turns onboarding into a data
 * task, and §9 makes that the release gate — a setting only a developer can
 * move does not meet it, and nothing in the type system notices.
 *
 * So the check is mechanical: the schema's own top-level keys are the list, and
 * the editor has to cover all of them.
 */
const NOT_A_SECTION = new Set(['schemaVersion']);

describe('profile editor coverage', () => {
  const profile = createStarterProfile('t', 'Demo');
  const covered = new Set(SECTION_IDS.flatMap((id) => SECTION_KEYS[id] as string[]));

  it('has a tab owning every top-level key of the profile', () => {
    const keys = Object.keys(profile).filter((k) => !NOT_A_SECTION.has(k));
    const missing = keys.filter((k) => !covered.has(k));
    expect(missing, `no editor tab owns: ${missing.join(', ')}`).toEqual([]);
  });

  it('never claims a key the profile does not have', () => {
    const keys = new Set(Object.keys(profile));
    const stale = [...covered].filter((k) => !keys.has(k));
    expect(stale, `tabs claim keys that no longer exist: ${stale.join(', ')}`).toEqual([]);
  });

  it('gives every section a title in both languages and a spec reference', () => {
    const th = makeSay('th');
    const en = makeSay('en');
    for (const id of SECTION_IDS) {
      expect(sectionTitle(id, th).length, id).toBeGreaterThan(0);
      expect(sectionTitle(id, en).length, id).toBeGreaterThan(0);
      // The reference is what lets someone read the screen next to the spec.
      expect(sectionRef(id), id).toMatch(/^§4\.\d+$/);
      // Thai and English must actually differ, or a label was left untranslated.
      expect(sectionTitle(id, th), id).not.toBe(sectionTitle(id, en));
    }
  });

  it('routes a validation issue on any section to its own tab', () => {
    // Without this an admin gets "the profile has errors" and no idea which of
    // sixteen tabs to open.
    for (const id of SECTION_IDS) {
      for (const key of SECTION_KEYS[id]) {
        expect(sectionForPath(`${key}.something`), `${id} / ${key}`).toBe(id);
      }
    }
  });

  it('numbers the sections in spec order without gaps or repeats', () => {
    const numbers = SECTION_IDS.map((id) => Number(sectionRef(id).replace('§4.', '')));
    expect(numbers).toEqual([...Array(numbers.length)].map((_, i) => i + 1));
  });
});
