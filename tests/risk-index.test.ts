import { describe, expect, it } from 'vitest';
import {
  createStarterProfile,
  explainMove,
  normaliseGroupExposure,
  normaliseLegal,
  normalisePaymentException,
  scoreRiskIndex,
  type ComponentInput,
  type RiskIndexPolicy,
} from '@creditmesh/core';

const profile = createStarterProfile('t', 'Demo');
const grades = profile.creditPolicy.riskGrades;
const ASOF = '2026-09-03';

function policyWith(components: RiskIndexPolicy['components']): RiskIndexPolicy {
  return { ...profile.riskIndex, components, minComponentsForConfidence: 3 };
}

function input(code: string, value: number | null): ComponentInput {
  return { code, value, evidence: [], note: null };
}

describe('scoreRiskIndex', () => {
  it('renormalises weights when a no_information component is absent', () => {
    const policy = policyWith([
      { code: 'a', weight: 0.5, absenceRule: 'no_information', enabled: true },
      { code: 'b', weight: 0.5, absenceRule: 'no_information', enabled: true },
    ]);
    const result = scoreRiskIndex('p1', [input('a', 80), input('b', null)], policy, grades, ASOF);
    expect(result.score).toBe(80);
    expect(result.components.find((c) => c.code === 'b')!.effectiveWeight).toBe(0);
    expect(result.components.find((c) => c.code === 'a')!.effectiveWeight).toBe(1);
  });

  it('scores a treat_as_worst component at zero rather than dropping it', () => {
    // The R1 bug, encoded as a test. A counterparty with no cleared payments
    // and its whole balance past due must not score well because the missing
    // component's weight moved onto an old balance sheet.
    const policy = policyWith([
      { code: 'financial', weight: 0.5, absenceRule: 'no_information', enabled: true },
      { code: 'payment_behavior', weight: 0.5, absenceRule: 'treat_as_worst', enabled: true },
    ]);
    const result = scoreRiskIndex(
      'p1',
      [input('financial', 90), input('payment_behavior', null)],
      policy,
      grades,
      ASOF,
    );
    expect(result.score).toBe(45);
    const component = result.components.find((c) => c.code === 'payment_behavior')!;
    expect(component.available).toBe(false);
    expect(component.value).toBe(0);
    expect(component.effectiveWeight).toBe(0.5);
  });

  it('refuses to produce a score when a block_score component is missing', () => {
    const policy = policyWith([
      { code: 'financial', weight: 0.5, absenceRule: 'no_information', enabled: true },
      { code: 'legal', weight: 0.5, absenceRule: 'block_score', enabled: true },
    ]);
    const result = scoreRiskIndex('p1', [input('financial', 90), input('legal', null)], policy, grades, ASOF);
    expect(result.score).toBeNull();
    expect(result.grade).toBeNull();
    expect(result.blockedBy).toBe('legal');
  });

  it('reports availability separately from the value', () => {
    // A 62 from three components and a 62 from nine are not the same object,
    // and the result has to let a reader tell them apart.
    const policy = policyWith([
      { code: 'a', weight: 0.25, absenceRule: 'no_information', enabled: true },
      { code: 'b', weight: 0.25, absenceRule: 'no_information', enabled: true },
      { code: 'c', weight: 0.25, absenceRule: 'no_information', enabled: true },
      { code: 'd', weight: 0.25, absenceRule: 'no_information', enabled: true },
    ]);
    const result = scoreRiskIndex(
      'p1',
      [input('a', 60), input('b', 60), input('c', null), input('d', null)],
      policy,
      grades,
      ASOF,
    );
    expect(result.score).toBe(60);
    expect(result.availability).toEqual({ scored: 2, enabled: 4, pct: 50 });
    expect(result.incomplete).toBe(true);
  });

  it('ignores components the tenant has switched off', () => {
    const policy = policyWith([
      { code: 'a', weight: 0.5, absenceRule: 'no_information', enabled: true },
      { code: 'off', weight: 0.5, absenceRule: 'treat_as_worst', enabled: false },
    ]);
    const result = scoreRiskIndex('p1', [input('a', 80)], policy, grades, ASOF);
    // A disabled component must not drag the score to 40 through its own
    // absence rule — switching a component off is not the same as it missing.
    expect(result.score).toBe(80);
    expect(result.components).toHaveLength(1);
  });

  it('carries the action for the resulting grade from the profile', () => {
    const policy = policyWith([{ code: 'a', weight: 1, absenceRule: 'no_information', enabled: true }]);
    const result = scoreRiskIndex('p1', [input('a', 10)], policy, grades, ASOF);
    expect(result.grade).toBe('E');
    expect(result.recommendedAction).toContain('หยุดปล่อยเครดิตใหม่');
  });

  it('every contribution adds up to the score', () => {
    const policy = policyWith([
      { code: 'a', weight: 0.2, absenceRule: 'no_information', enabled: true },
      { code: 'b', weight: 0.3, absenceRule: 'no_information', enabled: true },
      { code: 'c', weight: 0.5, absenceRule: 'no_information', enabled: true },
    ]);
    const result = scoreRiskIndex('p1', [input('a', 100), input('b', 50), input('c', 0)], policy, grades, ASOF);
    const sum = result.components.reduce((s, c) => s + c.contribution, 0);
    expect(Math.round(sum * 10) / 10).toBe(result.score);
  });
});

describe('explainMove', () => {
  it('accounts for a component that disappeared', () => {
    // Otherwise the deltas do not add up to the change the reader can see on
    // screen, which is the fastest way to lose trust in the explanation.
    const previous = [
      { code: 'a', weight: 0.5, effectiveWeight: 0.5, value: 80, available: true, absenceRule: 'no_information' as const, contribution: 40, evidence: [], note: null },
      { code: 'b', weight: 0.5, effectiveWeight: 0.5, value: 60, available: true, absenceRule: 'no_information' as const, contribution: 30, evidence: [], note: null },
    ];
    const current = [
      { code: 'a', weight: 0.5, effectiveWeight: 1, value: 80, available: true, absenceRule: 'no_information' as const, contribution: 80, evidence: [], note: null },
    ];
    const move = explainMove(previous, current);
    expect(move.movers.map((m) => m.code)).toEqual(['a', 'b']);
    expect(move.scoreDelta).toBe(10);
  });
});

describe('normalisers', () => {
  it('takes the legal component to zero on one critical event', () => {
    expect(normaliseLegal([{ severity: 'critical' }])).toBe(0);
    expect(normaliseLegal([{ severity: 'medium' }])).toBe(65);
    expect(normaliseLegal([])).toBe(100);
  });

  it('lets repeated returned cheques dominate the exception component', () => {
    expect(normalisePaymentException([{ code: 'repeated_returned_cheque', severity: 'critical' }])).toBe(0);
    expect(normalisePaymentException([{ code: 'returned_cheque', severity: 'high' }])).toBe(40);
    expect(normalisePaymentException([])).toBe(100);
  });

  it('measures group concentration against the largest single limit, never the sum', () => {
    // The limits were approved one at a time for one company each. Adding them
    // up manufactures headroom nobody granted.
    expect(normaliseGroupExposure(10_000_000, 10_000_000)).toBeCloseTo(80, 0);
    expect(normaliseGroupExposure(30_000_000, 10_000_000)).toBe(0);
    expect(normaliseGroupExposure(5_000_000, 10_000_000)).toBe(100);
    expect(normaliseGroupExposure(5_000_000, null)).toBeNull();
  });
});
