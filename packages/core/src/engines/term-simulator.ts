/**
 * Credit Term Simulator — Module 7.
 *
 * Purpose per the spec: turn the recurring argument with sales over payment
 * terms from an argument about instinct into one about numbers. Pure model,
 * no data dependencies, which is why it ships in R1 alongside the X-ray.
 *
 * Convention: rates are fractions (0.06 = 6%), terms are days, money is in the
 * tenant base currency. Nothing here is annualised behind the caller's back.
 */

export interface TermScenarioInput {
  /** Annual revenue at today's terms. */
  currentAnnualRevenue: number;
  /** Today's effective payment terms in days (use actual DSO, not policy). */
  currentTermDays: number;
  /** Terms being proposed. */
  proposedTermDays: number;
  /** Gross margin as a fraction of revenue. */
  grossMarginRate: number;
  /** The organisation's cost of capital, annual fraction. */
  costOfCapitalRate: number;
  /** Expected revenue uplift from the longer terms, fraction. */
  expectedRevenueUpliftRate: number;
  /** Bad-debt rate today, fraction of revenue. */
  currentBadDebtRate: number;
  /** Expected bad-debt rate under the proposed terms, fraction of revenue. */
  proposedBadDebtRate: number;
  daysInYear?: number;
}

export interface TermScenarioResult {
  baseline: {
    revenue: number;
    receivablesBalance: number;
    grossProfit: number;
    badDebtCost: number;
    carryingCost: number;
    contribution: number;
  };
  scenario: {
    revenue: number;
    receivablesBalance: number;
    grossProfit: number;
    badDebtCost: number;
    carryingCost: number;
    contribution: number;
  };
  delta: {
    revenue: number;
    /** Positive = cash tied up in receivables goes up. */
    receivablesBalance: number;
    grossProfit: number;
    badDebtCost: number;
    carryingCost: number;
    /** The single number the discussion is actually about. */
    netImpact: number;
  };
  /** One-time cash movement in the transition period, negative = cash out. */
  cashFlowImpact: number;
  /**
   * Revenue uplift needed for the proposal to break even, as a fraction.
   * `null` when no uplift can pay for it — margin is thinner than the carrying
   * and loss cost of the extra days, so the answer is "not at these terms".
   */
  breakEvenUpliftRate: number | null;
  /** True when the proposal pays for itself at the uplift the caller assumed. */
  viableAtAssumedUplift: boolean;
}

export function simulateTermChange(input: TermScenarioInput): TermScenarioResult {
  const {
    currentAnnualRevenue: r0,
    currentTermDays: t0,
    proposedTermDays: t1,
    grossMarginRate: m,
    costOfCapitalRate: k,
    expectedRevenueUpliftRate: g,
    currentBadDebtRate: b0,
    proposedBadDebtRate: b1,
    daysInYear = 365,
  } = input;

  const r1 = r0 * (1 + g);

  const ar0 = (r0 * t0) / daysInYear;
  const ar1 = (r1 * t1) / daysInYear;

  const gp0 = r0 * m;
  const gp1 = r1 * m;

  const bad0 = r0 * b0;
  const bad1 = r1 * b1;

  // Carrying cost is the cost of financing the receivables balance for a year.
  const carry0 = ar0 * k;
  const carry1 = ar1 * k;

  const contribution0 = gp0 - bad0 - carry0;
  const contribution1 = gp1 - bad1 - carry1;

  // Break-even uplift, solved from contribution1(g) - contribution0 = 0:
  //   g * (m - k*t1/daysInYear - b1) = k*(t1 - t0)/daysInYear + (b1 - b0)
  const denominator = m - (k * t1) / daysInYear - b1;
  const numerator = (k * (t1 - t0)) / daysInYear + (b1 - b0);
  const breakEvenUpliftRate = denominator > 0 ? numerator / denominator : null;

  return {
    baseline: {
      revenue: r0,
      receivablesBalance: ar0,
      grossProfit: gp0,
      badDebtCost: bad0,
      carryingCost: carry0,
      contribution: contribution0,
    },
    scenario: {
      revenue: r1,
      receivablesBalance: ar1,
      grossProfit: gp1,
      badDebtCost: bad1,
      carryingCost: carry1,
      contribution: contribution1,
    },
    delta: {
      revenue: r1 - r0,
      receivablesBalance: ar1 - ar0,
      grossProfit: gp1 - gp0,
      badDebtCost: bad1 - bad0,
      carryingCost: carry1 - carry0,
      netImpact: contribution1 - contribution0,
    },
    cashFlowImpact: -(ar1 - ar0),
    breakEvenUpliftRate,
    viableAtAssumedUplift: contribution1 - contribution0 > 0,
  };
}

/** Sensitivity strip for the one-page summary: net impact across uplift levels. */
export function upliftSensitivity(
  input: TermScenarioInput,
  upliftRates: number[],
): { upliftRate: number; netImpact: number }[] {
  return upliftRates.map((rate) => ({
    upliftRate: rate,
    netImpact: simulateTermChange({ ...input, expectedRevenueUpliftRate: rate }).delta.netImpact,
  }));
}
