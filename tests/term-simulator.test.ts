import { describe, expect, it } from 'vitest';
import { simulateTermChange, upliftSensitivity, type TermScenarioInput } from '@creditmesh/core';

const base: TermScenarioInput = {
  currentAnnualRevenue: 500_000_000,
  currentTermDays: 30,
  proposedTermDays: 60,
  grossMarginRate: 0.18,
  costOfCapitalRate: 0.06,
  expectedRevenueUpliftRate: 0.05,
  currentBadDebtRate: 0.004,
  proposedBadDebtRate: 0.006,
};

describe('simulateTermChange', () => {
  it('ties up more cash when terms are extended', () => {
    const r = simulateTermChange({ ...base, expectedRevenueUpliftRate: 0 });
    expect(r.delta.receivablesBalance).toBeGreaterThan(0);
    expect(r.cashFlowImpact).toBeLessThan(0);
  });

  it('loses money on longer terms with no uplift', () => {
    const r = simulateTermChange({ ...base, expectedRevenueUpliftRate: 0 });
    expect(r.delta.netImpact).toBeLessThan(0);
    expect(r.viableAtAssumedUplift).toBe(false);
  });

  it('breaks even exactly at the break-even uplift it reports', () => {
    // The closed-form solution and the model must agree, or the headline number
    // and the number people plan against are different numbers.
    const r = simulateTermChange(base);
    expect(r.breakEvenUpliftRate).not.toBeNull();
    const atBreakEven = simulateTermChange({ ...base, expectedRevenueUpliftRate: r.breakEvenUpliftRate! });
    expect(atBreakEven.delta.netImpact).toBeCloseTo(0, 6);
  });

  it('reports no break-even when margin cannot cover the extra days', () => {
    const r = simulateTermChange({
      ...base,
      grossMarginRate: 0.01,
      proposedTermDays: 180,
      costOfCapitalRate: 0.12,
      proposedBadDebtRate: 0.02,
    });
    expect(r.breakEvenUpliftRate).toBeNull();
  });

  it('is a no-op when nothing changes', () => {
    const r = simulateTermChange({
      ...base,
      proposedTermDays: base.currentTermDays,
      expectedRevenueUpliftRate: 0,
      proposedBadDebtRate: base.currentBadDebtRate,
    });
    expect(r.delta.netImpact).toBeCloseTo(0, 9);
    expect(r.breakEvenUpliftRate).toBeCloseTo(0, 9);
  });

  it('shortening terms releases cash', () => {
    const r = simulateTermChange({ ...base, proposedTermDays: 15, expectedRevenueUpliftRate: 0 });
    expect(r.cashFlowImpact).toBeGreaterThan(0);
  });

  it('produces a monotonically improving sensitivity strip', () => {
    const strip = upliftSensitivity(base, [0, 0.05, 0.1]);
    expect(strip[1]!.netImpact).toBeGreaterThan(strip[0]!.netImpact);
    expect(strip[2]!.netImpact).toBeGreaterThan(strip[1]!.netImpact);
  });
});
