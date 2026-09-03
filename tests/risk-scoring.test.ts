import { describe, expect, it } from 'vitest';
import {
  analyseFinancials,
  createStarterProfile,
  scoreParty,
  type FinancialStatement,
  type PaymentBehavior,
} from '@creditmesh/core';

const profile = createStarterProfile('t', 'Demo');

function fs(fiscalYear: number, patch: Partial<FinancialStatement> = {}): FinancialStatement {
  return {
    id: `fs-${fiscalYear}`,
    tenantId: 't',
    partyId: 'p',
    fiscalYear,
    periodEnd: `${fiscalYear}-12-31`,
    currency: 'THB',
    revenue: 100,
    grossProfit: 25,
    netProfit: 12,
    totalAssets: 200,
    totalLiabilities: 80,
    equity: 120,
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

const behaviour = (dpd: number): PaymentBehavior => ({
  tenantId: 't',
  partyId: 'p',
  periodStart: '2025-09-03',
  periodEnd: '2026-09-03',
  invoiceCount: 20,
  weightedAvgDpd: dpd,
  maxDpd: dpd,
  onTimePct: 80,
});

describe('scoreParty', () => {
  const asOf = '2026-09-03';

  it('scores a healthy prompt payer above a weak late one', () => {
    const strong = scoreParty(profile, {
      analysis: analyseFinancials('p', [fs(2025), fs(2024)], { asOf }),
      paymentBehavior: behaviour(2),
      asOf,
    });
    const weak = scoreParty(profile, {
      analysis: analyseFinancials('p', [fs(2025, { netProfit: -30, equity: 5, currentAssets: 30, totalLiabilities: 190 })], { asOf }),
      paymentBehavior: behaviour(75),
      asOf,
    });
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.gradeCode).not.toBeNull();
  });

  it('keeps the score inside the 0–100 the grade bands assume', () => {
    for (const dpd of [0, 30, 120]) {
      const result = scoreParty(profile, {
        analysis: analyseFinancials('p', [fs(2025)], { asOf }),
        paymentBehavior: behaviour(dpd),
        asOf,
      });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it('renormalises weights instead of scoring missing data as zero', () => {
    // A counterparty with no payment history must not be punished for a gap in
    // our data — that is a data problem, not a risk finding.
    const result = scoreParty(profile, {
      analysis: analyseFinancials('p', [fs(2025)], { asOf }),
      paymentBehavior: null,
      asOf,
    });
    expect(result.missingComponents).toContain('payment_behavior');
    const weightSum = result.components.reduce((s, c) => s + c.weight, 0);
    expect(weightSum).toBeCloseTo(1, 6);
  });

  it('exposes every component so the total can be taken apart on screen', () => {
    const result = scoreParty(profile, {
      analysis: analyseFinancials('p', [fs(2025)], { asOf }),
      paymentBehavior: behaviour(5),
      asOf,
    });
    const summed = result.components.reduce((s, c) => s + c.contribution, 0);
    expect(summed).toBeCloseTo(result.score, 1);
  });

  it('still produces a score for a party with no financials at all', () => {
    const result = scoreParty(profile, {
      analysis: analyseFinancials('p', [], { asOf }),
      paymentBehavior: behaviour(10),
      asOf,
    });
    expect(result.components).toHaveLength(1);
    expect(result.missingComponents.length).toBeGreaterThan(0);
  });
});
