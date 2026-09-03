import { describe, expect, it } from 'vitest';
import { analyseFinancials, computeRatios, type FinancialStatement } from '@creditmesh/core';

function fs(fiscalYear: number, patch: Partial<FinancialStatement> = {}): FinancialStatement {
  return {
    id: `fs-${fiscalYear}`,
    tenantId: 't',
    partyId: 'p',
    fiscalYear,
    periodEnd: `${fiscalYear}-12-31`,
    currency: 'THB',
    revenue: 100,
    grossProfit: 20,
    netProfit: 5,
    totalAssets: 200,
    totalLiabilities: 120,
    equity: 80,
    currentAssets: 90,
    currentLiabilities: 60,
    cash: 10,
    inventory: 30,
    receivables: 40,
    providerId: 'manual_upload',
    retrievedAt: `${fiscalYear}-12-31T00:00:00Z`,
    ...patch,
  };
}

describe('computeRatios', () => {
  it('computes the standard ratios', () => {
    const r = computeRatios(fs(2025));
    expect(r.currentRatio).toBeCloseTo(1.5);
    expect(r.quickRatio).toBeCloseTo(1);
    expect(r.debtToEquity).toBeCloseTo(1.5);
    expect(r.netMarginPct).toBeCloseTo(5);
  });

  it('returns null rather than Infinity when the denominator is zero', () => {
    const r = computeRatios(fs(2025, { currentLiabilities: 0, equity: 0, revenue: 0 }));
    expect(r.currentRatio).toBeNull();
    expect(r.debtToEquity).toBeNull();
    expect(r.netMarginPct).toBeNull();
  });

  it('does not compute return on equity when equity is negative', () => {
    // A negative denominator produces a large positive ROE, which reads as a
    // strong company when it means the opposite.
    const r = computeRatios(fs(2025, { equity: -50, netProfit: -10 }));
    expect(r.returnOnEquityPct).toBeNull();
    expect(r.debtToEquity).toBeNull();
  });
});

describe('analyseFinancials', () => {
  it('flags a party with no statements rather than passing it silently', () => {
    const a = analyseFinancials('p', [], { asOf: '2026-09-03' });
    expect(a.hasAnyStatement).toBe(false);
    expect(a.flags.map((f) => f.code)).toContain('no_statement');
  });

  it('flags three consecutive loss years counted from the latest', () => {
    const a = analyseFinancials(
      'p',
      [fs(2025, { netProfit: -5 }), fs(2024, { netProfit: -8 }), fs(2023, { netProfit: -3 })],
      { asOf: '2026-01-01', staleFilingYears: 5 },
    );
    const flag = a.flags.find((f) => f.code === 'consecutive_losses');
    expect(flag).toBeDefined();
    expect(flag!.evidence).toHaveLength(3);
  });

  it('does not flag an old loss run that has since recovered', () => {
    const a = analyseFinancials(
      'p',
      [fs(2025, { netProfit: 10 }), fs(2024, { netProfit: -5 }), fs(2023, { netProfit: -8 }), fs(2022, { netProfit: -9 })],
      { asOf: '2026-01-01', staleFilingYears: 5 },
    );
    expect(a.flags.map((f) => f.code)).not.toContain('consecutive_losses');
  });

  it('flags negative equity as critical', () => {
    const a = analyseFinancials('p', [fs(2025, { equity: -20 })], { asOf: '2026-01-01', staleFilingYears: 5 });
    const flag = a.flags.find((f) => f.code === 'negative_equity');
    expect(flag?.severity).toBe('critical');
  });

  it('flags a filing gap at the tenant threshold', () => {
    const a = analyseFinancials('p', [fs(2024)], { asOf: '2026-09-03', staleFilingYears: 2 });
    expect(a.yearsSinceLastFiling).toBe(2);
    expect(a.flags.map((f) => f.code)).toContain('stale_filing');
  });

  it('attaches evidence to every flag it raises', () => {
    const a = analyseFinancials('p', [fs(2020, { equity: -1, netProfit: -1 })], { asOf: '2026-01-01' });
    expect(a.flags.length).toBeGreaterThan(0);
    for (const flag of a.flags) expect(flag.evidence.length).toBeGreaterThan(0);
  });
});
