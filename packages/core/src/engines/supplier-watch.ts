import type { Evidence } from '../types/canonical';
import type { FinancialAnalysis } from './financial-analysis';

/**
 * Supplier Financial Watch — Module 9.
 *
 * Reuses the Financial Analysis Engine unmodified; the only thing that changes
 * is which register is fed into it. That reuse is the payoff of P3: because
 * there is one `party` table with roles rather than a customer table and a
 * supplier table, this module costs a dependency model and a screen.
 *
 * The question it answers is not "which supplier looks weakest" — a fragile
 * supplier the organisation barely uses is not a problem. It is "what does it
 * cost us if this one stops delivering, and how likely is that". For a group
 * that manufactures, a supplier failing mid-contract hurts more than a bad
 * debt: the line stops and a replacement cannot be found in time.
 *
 * Two dimensions, always shown separately. Blending them into one number would
 * hide which half is driving the ranking, and the two have completely different
 * remedies: fragility is watched, dependency is engineered away.
 */

export interface SupplierDependency {
  partyId: string;
  /** Ordered and not yet delivered — money already committed. */
  openCommitment: number;
  /** Annual spend with this supplier, for the interruption estimate. */
  annualSpend: number;
  /** This supplier's share of its category, 0–100. Null when unknown. */
  categoryShare: number | null;
  /** No qualified alternative exists today. */
  isSingleSource: boolean;
  /** Working days to qualify and switch to an alternative. */
  switchingLeadTimeDays: number | null;
  category: string | null;
}

export interface SupplierWatchRow {
  partyId: string;
  legalName: string;
  /** From the shared engine. Null when nothing has been scored yet. */
  fragilityScore: number | null;
  grade: string | null;
  flags: { code: string; severity: string }[];
  dependency: SupplierDependency;
  /**
   * Money genuinely at stake if this supplier stops: what is already committed,
   * plus the value of the flow that cannot be covered while a replacement is
   * qualified.
   */
  disruptionExposure: number;
  /** The interruption half of the above, kept separate so it can be explained. */
  interruptionValue: number;
  /** Share of the flow no alternative covers, 0–1. */
  coverageGap: number;
  /**
   * Ordering only. Money at stake scaled by financial weakness — deliberately
   * NOT called an expected loss, because fragility is a score, not a
   * probability, and dressing a heuristic up as a calculation is the failure
   * this product exists to avoid.
   */
  priority: number;
  evidence: Evidence[];
}

export interface SupplierWatchOptions {
  asOf: string;
  daysInYear?: number;
  /** Assumed when a supplier has no stated switching time. */
  defaultSwitchingLeadTimeDays?: number;
}

/**
 * The share of the flow that stops.
 *
 * Sole-sourced means all of it. Otherwise the supplier's own share of the
 * category is what nobody else is already supplying — the alternatives that
 * hold the rest can usually absorb more, but not the part this one carries.
 */
export function coverageGapFor(dependency: SupplierDependency): number {
  if (dependency.isSingleSource) return 1;
  if (dependency.categoryShare === null) return 0.5;
  return Math.min(1, Math.max(0, dependency.categoryShare / 100));
}

export function assessSupplier(
  partyId: string,
  legalName: string,
  dependency: SupplierDependency,
  analysis: FinancialAnalysis,
  fragilityScore: number | null,
  grade: string | null,
  options: SupplierWatchOptions,
): SupplierWatchRow {
  const { asOf, daysInYear = 365, defaultSwitchingLeadTimeDays = 60 } = options;

  const leadTimeDays = dependency.switchingLeadTimeDays ?? defaultSwitchingLeadTimeDays;
  const coverageGap = coverageGapFor(dependency);
  const interruptionValue = (dependency.annualSpend / daysInYear) * leadTimeDays * coverageGap;
  const disruptionExposure = dependency.openCommitment + interruptionValue;

  // A supplier with no score yet is treated as mid-weak rather than as fine:
  // an unscored supplier is a gap in our data, and ranking it last would hide
  // exactly the ones nobody has looked at.
  const weakness = fragilityScore === null ? 0.5 : Math.min(1, Math.max(0, 1 - fragilityScore / 100));

  const evidence: Evidence[] = [
    {
      code: 'supplier_dependency',
      sourceRef: `supplier_commitment:${partyId}`,
      observedAt: `${asOf}T00:00:00Z`,
      detail: {
        openCommitment: dependency.openCommitment,
        annualSpend: dependency.annualSpend,
        categoryShare: dependency.categoryShare,
        isSingleSource: dependency.isSingleSource,
        switchingLeadTimeDays: leadTimeDays,
        leadTimeAssumed: dependency.switchingLeadTimeDays === null,
        coverageGap,
        interruptionValue: Math.round(interruptionValue),
      },
    },
    ...analysis.flags.flatMap((f) => f.evidence),
  ];

  return {
    partyId,
    legalName,
    fragilityScore,
    grade,
    flags: analysis.flags.map((f) => ({ code: f.code, severity: f.severity })),
    dependency,
    disruptionExposure,
    interruptionValue,
    coverageGap,
    priority: disruptionExposure * weakness,
    evidence,
  };
}

/** Highest priority first — the ranking the module exists to produce. */
export function rankSuppliers(rows: SupplierWatchRow[]): SupplierWatchRow[] {
  return [...rows].sort((a, b) => b.priority - a.priority);
}

export interface SupplierWatchSummary {
  suppliersTracked: number;
  singleSourced: number;
  /** Sole-sourced and financially flagged: the combination that stops a line. */
  singleSourcedAndFlagged: number;
  totalOpenCommitment: number;
  totalDisruptionExposure: number;
  currency: string;
}

export function summariseSupplierWatch(rows: SupplierWatchRow[], currency: string): SupplierWatchSummary {
  return {
    suppliersTracked: rows.length,
    singleSourced: rows.filter((r) => r.dependency.isSingleSource).length,
    singleSourcedAndFlagged: rows.filter(
      (r) => r.dependency.isSingleSource && r.flags.some((f) => f.severity === 'critical' || f.severity === 'high'),
    ).length,
    totalOpenCommitment: rows.reduce((sum, r) => sum + r.dependency.openCommitment, 0),
    totalDisruptionExposure: rows.reduce((sum, r) => sum + r.disruptionExposure, 0),
    currency,
  };
}
