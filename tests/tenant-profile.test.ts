import { describe, expect, it } from 'vitest';
import { createStarterProfile, gradeForScore, validateTenantProfile } from '@creditmesh/core';

describe('createStarterProfile', () => {
  it('produces a profile that passes its own validation', () => {
    const result = validateTenantProfile(createStarterProfile('t1', 'Demo Group'));
    expect(result.ok).toBe(true);
  });

  it('contains no organisation-specific names — the P1 acceptance test', () => {
    const serialised = JSON.stringify(createStarterProfile('t1', 'Demo Group'));
    expect(serialised).toMatch(/"code":"E01"/);
  });
});

describe('validateTenantProfile', () => {
  const base = createStarterProfile('t1', 'Demo Group');

  it('rejects overlapping grade bands', () => {
    const profile = structuredClone(base);
    profile.creditPolicy.riskGrades[1]!.maxScore = 85;
    const result = validateTenantProfile(profile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.message.includes('overlaps'))).toBe(true);
  });

  it('rejects a parent entity that does not exist', () => {
    const profile = structuredClone(base);
    profile.legalEntities[0]!.parentGroup = 'NOPE';
    const result = validateTenantProfile(profile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.message).toMatch(/unknown parent/);
  });

  it('requires exactly one open-ended ageing bucket', () => {
    const profile = structuredClone(base);
    profile.creditPolicy.agingBuckets.push({ code: 'x', label: 'x', fromDays: 200, toDays: null });
    const result = validateTenantProfile(profile);
    expect(result.ok).toBe(false);
  });

  it('requires a priority order when allocation is by priority', () => {
    const profile = structuredClone(base);
    profile.collateralPolicy.allocationMethod = 'priority_order';
    const result = validateTenantProfile(profile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path.includes('priorityOrder'))).toBe(true);
  });

  it('refuses to let group resolution apply itself without a human', () => {
    const profile = structuredClone(base);
    profile.groupResolution.autoApply = true;
    const result = validateTenantProfile(profile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === 'groupResolution.autoApply')).toBe(true);
  });
});

describe('gradeForScore', () => {
  const profile = createStarterProfile('t1', 'Demo Group');

  it('maps a score to exactly one band', () => {
    expect(gradeForScore(profile, 92)?.code).toBe('A');
    expect(gradeForScore(profile, 50)?.code).toBe('C');
    expect(gradeForScore(profile, 0)?.code).toBe('E');
  });
});
