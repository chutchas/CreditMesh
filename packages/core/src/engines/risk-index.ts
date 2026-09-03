import type { RiskGrade, RiskIndexPolicy } from '../tenant/profile';
import type { Evidence, IsoDate, Uuid } from '../types/canonical';

/**
 * Module 17 — Customer Risk Index.
 *
 * The point where every module converges, and the one most likely to do harm.
 * §7 names the risk exactly: a single credible-looking number makes people stop
 * looking at what is underneath it, which is worse than having no number at
 * all. So this engine returns the components, their weights, their evidence and
 * their availability alongside the score, always, and the screen shows them
 * open rather than behind a click.
 *
 * `absenceRule` is here because of a real bug in R1. A counterparty with no
 * cleared payment history scored well: the payment-behaviour component was
 * dropped, its weight redistributed onto a two-year-old balance sheet, and the
 * fact that its entire balance was past due never reached the number. So per
 * component the tenant declares what "no data" means:
 *
 *   no_information — drop it, renormalise, and record that the score is
 *                    incomplete. Honest only when absence really is ignorance.
 *   treat_as_worst — absence IS the answer. No cleared payments from a
 *                    counterparty that owes you money is not missing data.
 *   block_score    — refuse to produce a score at all. For components without
 *                    which the number would mislead.
 *
 * Redistribution is never the default, and a score built on fewer components
 * than the tenant's floor is labelled incomplete rather than quietly shown as
 * equal to a complete one.
 */

export interface ComponentInput {
  code: string;
  /** 0–100, higher is safer. Null means no data for this counterparty. */
  value: number | null;
  evidence: Evidence[];
  /** One line a reader can check, e.g. "no cleared invoices on record". */
  note: string | null;
}

export interface ScoredComponent {
  code: string;
  weight: number;
  /** Weight after renormalisation. Zero when the component was dropped. */
  effectiveWeight: number;
  value: number | null;
  available: boolean;
  absenceRule: 'no_information' | 'treat_as_worst' | 'block_score';
  /** Points this component contributed to the final score. */
  contribution: number;
  evidence: Evidence[];
  note: string | null;
}

export interface RiskIndexResult {
  partyId: Uuid;
  asOf: IsoDate;
  /** Null when a block_score component is missing. The reason says which. */
  score: number | null;
  grade: string | null;
  blockedBy: string | null;
  components: ScoredComponent[];
  availability: { scored: number; enabled: number; pct: number };
  /** True when fewer components were scored than the tenant's floor. */
  incomplete: boolean;
  recommendedAction: string | null;
}

export function scoreRiskIndex(
  partyId: Uuid,
  inputs: ComponentInput[],
  policy: RiskIndexPolicy,
  grades: RiskGrade[],
  asOf: IsoDate,
): RiskIndexResult {
  const byCode = new Map(inputs.map((i) => [i.code, i]));
  const enabled = policy.components.filter((c) => c.enabled);

  // First pass: decide availability and apply each component's absence rule.
  const staged = enabled.map((config) => {
    const input = byCode.get(config.code);
    const rawValue = input?.value ?? null;
    const available = rawValue !== null;

    let effectiveValue: number | null = rawValue;
    if (!available) {
      if (config.absenceRule === 'treat_as_worst') effectiveValue = 0;
      else effectiveValue = null; // dropped, or blocking
    }

    return { config, input, available, effectiveValue };
  });

  const blocking = staged.find((s) => !s.available && s.config.absenceRule === 'block_score');

  const contributing = staged.filter((s) => s.effectiveValue !== null);
  const weightTotal = contributing.reduce((sum, s) => sum + s.config.weight, 0);

  const components: ScoredComponent[] = staged.map((s) => {
    const effectiveWeight =
      s.effectiveValue === null || weightTotal === 0 ? 0 : s.config.weight / weightTotal;
    return {
      code: s.config.code,
      weight: s.config.weight,
      effectiveWeight: Math.round(effectiveWeight * 1000) / 1000,
      value: s.available ? s.effectiveValue : s.config.absenceRule === 'treat_as_worst' ? 0 : null,
      available: s.available,
      absenceRule: s.config.absenceRule,
      contribution:
        s.effectiveValue === null ? 0 : Math.round(s.effectiveValue * effectiveWeight * 100) / 100,
      evidence: s.input?.evidence ?? [],
      note:
        s.input?.note ??
        (s.available
          ? null
          : s.config.absenceRule === 'treat_as_worst'
            ? 'no data, and for this component that is the answer rather than ignorance'
            : s.config.absenceRule === 'block_score'
              ? 'no data, and the tenant treats this component as required'
              : 'no data — dropped, and the score is marked incomplete'),
    };
  });

  const scoredCount = staged.filter((s) => s.available).length;
  const availability = {
    scored: scoredCount,
    enabled: enabled.length,
    pct: enabled.length === 0 ? 0 : Math.round((scoredCount / enabled.length) * 1000) / 10,
  };

  if (blocking) {
    return {
      partyId,
      asOf,
      score: null,
      grade: null,
      blockedBy: blocking.config.code,
      components,
      availability,
      incomplete: true,
      recommendedAction: null,
    };
  }

  const score =
    weightTotal === 0
      ? null
      : Math.round(components.reduce((sum, c) => sum + c.contribution, 0) * 10) / 10;

  const grade =
    score === null
      ? null
      : (grades.find((g) => score >= g.minScore && score <= g.maxScore)?.code ?? null);

  const action = grade ? (policy.actionMap.find((a) => a.gradeCode === grade)?.action ?? null) : null;

  return {
    partyId,
    asOf,
    score,
    grade,
    blockedBy: null,
    components,
    availability,
    // Not a warning about the counterparty — a warning about the number. A
    // score from three components is not the same kind of thing as a score
    // from nine, even at the same value.
    incomplete: scoredCount < policy.minComponentsForConfidence,
    recommendedAction: action,
  };
}

export interface IndexMove {
  code: string;
  previousContribution: number;
  currentContribution: number;
  delta: number;
}

/**
 * What moved the score since last time, largest mover first.
 *
 * Answering "why did this drop" with the component deltas is the difference
 * between a number people trust and a number people argue with.
 */
export function explainMove(
  previous: ScoredComponent[],
  current: ScoredComponent[],
): { movers: IndexMove[]; scoreDelta: number } {
  const prevByCode = new Map(previous.map((c) => [c.code, c]));
  const movers: IndexMove[] = [];

  for (const c of current) {
    const before = prevByCode.get(c.code);
    const previousContribution = before?.contribution ?? 0;
    const delta = Math.round((c.contribution - previousContribution) * 100) / 100;
    if (delta !== 0) {
      movers.push({ code: c.code, previousContribution, currentContribution: c.contribution, delta });
    }
  }

  // A component that disappeared moved the score too, and leaving it out makes
  // the deltas fail to add up to the change people can see.
  for (const before of previous) {
    if (current.some((c) => c.code === before.code)) continue;
    movers.push({
      code: before.code,
      previousContribution: before.contribution,
      currentContribution: 0,
      delta: -before.contribution,
    });
  }

  return {
    movers: movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    scoreDelta: Math.round(movers.reduce((s, m) => s + m.delta, 0) * 10) / 10,
  };
}

/* ------------------------------------------------------------------ */
/* Normalisers — raw module output onto the 0–100, higher-is-safer axis */
/* ------------------------------------------------------------------ */

function ramp(value: number, worst: number, best: number): number {
  if (worst === best) return 100;
  const t = (value - worst) / (best - worst);
  return Math.max(0, Math.min(1, t)) * 100;
}

/** Legal events: one critical event is enough to take the component to zero. */
export function normaliseLegal(events: { severity: string }[]): number {
  if (events.some((e) => e.severity === 'critical')) return 0;
  if (events.some((e) => e.severity === 'high')) return 30;
  if (events.some((e) => e.severity === 'medium')) return 65;
  return 100;
}

/** Payment exceptions: returned cheques dominate, by design. */
export function normalisePaymentException(signals: { code: string; severity: string }[]): number {
  if (signals.some((s) => s.code === 'repeated_returned_cheque')) return 0;
  if (signals.some((s) => s.severity === 'critical')) return 10;
  if (signals.some((s) => s.severity === 'high')) return 40;
  if (signals.length > 0) return 70;
  return 100;
}

/** Collection outcome: how reliably promises are kept. */
export function normaliseCollectionOutcome(keptRatePct: number | null): number | null {
  if (keptRatePct === null) return null;
  return ramp(keptRatePct, 0, 100);
}

/** Collateral coverage: the share of exposure with something behind it. */
export function normaliseCollateralCoverage(coveragePct: number | null): number | null {
  if (coveragePct === null) return null;
  return Math.min(100, coveragePct);
}

/**
 * Group exposure: concentration against the largest single limit in the group.
 *
 * Never against the sum of the limits. A group's limits were approved one at a
 * time for one company each; adding them up produces headroom nobody granted.
 */
export function normaliseGroupExposure(
  groupExposure: number | null,
  maxSingleLimit: number | null,
): number | null {
  if (groupExposure === null || maxSingleLimit === null || maxSingleLimit <= 0) return null;
  return ramp(groupExposure / maxSingleLimit, 3, 0.5);
}
