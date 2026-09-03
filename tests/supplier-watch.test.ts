import { describe, expect, it } from 'vitest';
import {
  analyseFinancials,
  assessSupplier,
  coverageGapFor,
  rankSuppliers,
  summariseSupplierWatch,
  type FinancialStatement,
  type SupplierDependency,
} from '@creditmesh/core';

const asOf = '2026-09-03';

function dependency(patch: Partial<SupplierDependency> = {}): SupplierDependency {
  return {
    partyId: 'p1',
    openCommitment: 1_000_000,
    annualSpend: 36_500_000, // 100,000 a day, so lead-time arithmetic is legible
    categoryShare: 50,
    isSingleSource: false,
    switchingLeadTimeDays: 30,
    category: 'packaging',
    ...patch,
  };
}

function fs(fiscalYear: number, patch: Partial<FinancialStatement> = {}): FinancialStatement {
  return {
    id: `fs-${fiscalYear}`,
    tenantId: 't',
    partyId: 'p1',
    fiscalYear,
    periodEnd: `${fiscalYear}-12-31`,
    currency: 'THB',
    revenue: 100,
    grossProfit: 20,
    netProfit: 8,
    totalAssets: 200,
    totalLiabilities: 90,
    equity: 110,
    currentAssets: 120,
    currentLiabilities: 60,
    cash: 20,
    inventory: 20,
    receivables: 40,
    providerId: 'manual_upload',
    retrievedAt: `${fiscalYear}-12-31T00:00:00Z`,
    ...patch,
  };
}

const healthy = analyseFinancials('p1', [fs(2025)], { asOf });
const noBooks = analyseFinancials('p1', [], { asOf });

describe('coverageGapFor', () => {
  it('is total when nobody else is qualified', () => {
    expect(coverageGapFor(dependency({ isSingleSource: true }))).toBe(1);
  });

  it('is the supplier’s own share when alternatives exist', () => {
    expect(coverageGapFor(dependency({ categoryShare: 40 }))).toBeCloseTo(0.4);
  });

  it('sits in the middle when the share was never worked out', () => {
    // Unknown is not zero. Treating it as zero would rank a supplier nobody has
    // assessed as if it were safely second-sourced.
    expect(coverageGapFor(dependency({ categoryShare: null }))).toBe(0.5);
  });
});

describe('assessSupplier', () => {
  it('adds the flow that stops to the money already committed', () => {
    const row = assessSupplier('p1', 'Acme Packaging', dependency(), healthy, 80, 'A', { asOf });
    // 100,000/day × 30 days × 0.5 uncovered = 1,500,000, plus 1,000,000 ordered.
    expect(row.interruptionValue).toBeCloseTo(1_500_000);
    expect(row.disruptionExposure).toBeCloseTo(2_500_000);
  });

  it('a sole source loses the whole flow, not half of it', () => {
    const shared = assessSupplier('p1', 'Acme', dependency(), healthy, 80, 'A', { asOf });
    const sole = assessSupplier('p1', 'Acme', dependency({ isSingleSource: true }), healthy, 80, 'A', { asOf });
    expect(sole.disruptionExposure).toBeGreaterThan(shared.disruptionExposure);
    expect(sole.interruptionValue).toBeCloseTo(3_000_000);
  });

  it('a longer qualification time costs more', () => {
    const quick = assessSupplier('p1', 'Acme', dependency({ switchingLeadTimeDays: 30 }), healthy, 80, 'A', { asOf });
    const slow = assessSupplier('p1', 'Acme', dependency({ switchingLeadTimeDays: 120 }), healthy, 80, 'A', { asOf });
    expect(slow.disruptionExposure).toBeGreaterThan(quick.disruptionExposure);
  });

  it('says when the lead time was assumed rather than stated', () => {
    const row = assessSupplier('p1', 'Acme', dependency({ switchingLeadTimeDays: null }), healthy, 80, 'A', { asOf });
    const evidence = row.evidence.find((e) => e.code === 'supplier_dependency');
    expect(evidence?.detail?.leadTimeAssumed).toBe(true);
    expect(evidence?.detail?.switchingLeadTimeDays).toBe(60);
  });

  it('a weak supplier outranks a strong one at equal dependency', () => {
    const strong = assessSupplier('p1', 'Strong', dependency(), healthy, 90, 'A', { asOf });
    const weak = assessSupplier('p2', 'Weak', dependency(), healthy, 20, 'E', { asOf });
    expect(weak.priority).toBeGreaterThan(strong.priority);
    // Dependency is identical, so the money at stake must not have moved.
    expect(weak.disruptionExposure).toBeCloseTo(strong.disruptionExposure);
  });

  it('does not rank an unscored supplier as if it were safe', () => {
    // A supplier nobody has financials on is the one most worth looking at, so
    // it must not sort to the bottom.
    const unscored = assessSupplier('p1', 'Unknown', dependency(), noBooks, null, null, { asOf });
    const strong = assessSupplier('p2', 'Strong', dependency(), healthy, 90, 'A', { asOf });
    expect(unscored.priority).toBeGreaterThan(strong.priority);
    expect(unscored.flags.map((f) => f.code)).toContain('no_statement');
  });

  it('keeps the two dimensions separable', () => {
    const row = assessSupplier('p1', 'Acme', dependency(), healthy, 40, 'C', { asOf });
    // The headline is money; the fragility that scaled it is reported beside it
    // rather than folded in, because the two have different remedies.
    expect(row.disruptionExposure).toBeCloseTo(2_500_000);
    expect(row.fragilityScore).toBe(40);
    expect(row.priority).toBeCloseTo(2_500_000 * 0.6);
  });
});

describe('rankSuppliers and summary', () => {
  const rows = [
    assessSupplier('a', 'Small and solid', dependency({ annualSpend: 3_650_000, openCommitment: 100_000 }), healthy, 85, 'A', { asOf }),
    assessSupplier('b', 'Large and fragile', dependency({ isSingleSource: true }), noBooks, 25, 'E', { asOf }),
    assessSupplier('c', 'Large and solid', dependency({ isSingleSource: true }), healthy, 88, 'A', { asOf }),
  ];

  it('puts the fragile sole source first', () => {
    expect(rankSuppliers(rows)[0]!.legalName).toBe('Large and fragile');
  });

  it('counts the combination that actually stops a line', () => {
    const summary = summariseSupplierWatch(rows, 'THB');
    expect(summary.suppliersTracked).toBe(3);
    expect(summary.singleSourced).toBe(2);
    // Sole-sourced AND financially flagged — either alone is survivable.
    expect(summary.singleSourcedAndFlagged).toBe(1);
  });
});
