import type { CurrencyCode, IsoDate, Uuid } from '../types/canonical';

/**
 * Module 10 — ECL / Provision Assistant.
 *
 * Reuses the ageing and financial-analysis engines; what is new is the loss
 * rate matrix and one refusal that shapes the whole module:
 *
 * **When there is not enough history to derive a loss rate, say so.** Do not
 * fall back to a plausible-looking default. The output of this module goes
 * into a financial statement that somebody signs, and a provision built on an
 * invented rate is worse than a blank cell — a blank cell gets an accountant's
 * attention, a number does not.
 *
 * The second boundary is P5: this proposes, the accountant books. Nothing here
 * writes to a ledger, and the output is labelled a proposal at every level.
 */

export interface AgingCohort {
  /** The ageing bucket this cohort was in at the observation date. */
  bucketCode: string;
  /** Balance that sat in this bucket at the start of the observation window. */
  openingBalance: number;
  /** How much of it was never collected. */
  writtenOff: number;
  observedFrom: IsoDate;
  observedTo: IsoDate;
}

export interface LossRate {
  bucketCode: string;
  /** 0–100. Null when there is not enough history to derive one. */
  ratePct: number | null;
  /** Total balance the rate was derived from. Small = weak. */
  observationBase: number;
  cohortCount: number;
  /** Why a rate is null, in words an accountant can act on. */
  note: string | null;
}

export interface LossMatrixOptions {
  /** Minimum observed balance before a bucket's rate is trusted. */
  minObservationBase: number;
  /** Minimum number of separate periods observed. */
  minCohorts: number;
}

/**
 * Historical loss rates per ageing bucket.
 *
 * A rate derived from one quarter and ฿300k of history is not a loss rate, it
 * is an anecdote. Below the tenant's thresholds the rate comes back null with
 * a reason attached, and the caller must supply one or leave the bucket
 * unprovisioned deliberately.
 */
export function buildLossMatrix(
  cohorts: AgingCohort[],
  options: LossMatrixOptions,
): LossRate[] {
  const byBucket = new Map<string, AgingCohort[]>();
  for (const c of cohorts) {
    const bucket = byBucket.get(c.bucketCode) ?? [];
    bucket.push(c);
    byBucket.set(c.bucketCode, bucket);
  }

  return [...byBucket.entries()].map(([bucketCode, group]) => {
    const observationBase = group.reduce((s, c) => s + c.openingBalance, 0);
    const lost = group.reduce((s, c) => s + c.writtenOff, 0);

    if (group.length < options.minCohorts) {
      return {
        bucketCode,
        ratePct: null,
        observationBase,
        cohortCount: group.length,
        note: `only ${group.length} observed period(s); the tenant requires ${options.minCohorts}`,
      };
    }
    if (observationBase < options.minObservationBase) {
      return {
        bucketCode,
        ratePct: null,
        observationBase,
        cohortCount: group.length,
        note: `observed balance of ${Math.round(observationBase)} is below the ${options.minObservationBase} threshold — too thin to derive a rate from`,
      };
    }

    return {
      bucketCode,
      ratePct: Math.round((lost / observationBase) * 10000) / 100,
      observationBase,
      cohortCount: group.length,
      note: null,
    };
  });
}

export interface ProvisionInput {
  partyId: Uuid;
  partyName: string;
  legalEntityCode: string;
  /** Open balance per ageing bucket. */
  buckets: { bucketCode: string; amount: number }[];
  currency: CurrencyCode;
  /** Collateral that would be realised against this balance, if any. */
  securedAmount: number;
  /** From Module 1/17. Used only for the counterparty-specific overlay. */
  grade: string | null;
  /** Confirmed insolvency proceedings move a balance to specific provision. */
  hasCriticalLegalEvent: boolean;
}

export interface ProvisionLine {
  partyId: Uuid;
  partyName: string;
  legalEntityCode: string;
  currency: CurrencyCode;
  grossExposure: number;
  securedAmount: number;
  /** What the loss rates apply to: gross less what collateral would recover. */
  exposureAtDefault: number;
  bucketDetail: {
    bucketCode: string;
    amount: number;
    ratePct: number | null;
    provision: number;
    unrated: boolean;
  }[];
  /** Sum of bucket provisions before the forward-looking overlay. */
  baseProvision: number;
  forwardLookingPct: number;
  /** Specific provision when insolvency is confirmed — replaces the collective. */
  specificProvision: number | null;
  proposedProvision: number;
  /** Balance in buckets with no derivable rate. Never silently provisioned at 0. */
  unratedExposure: number;
  notes: string[];
}

export interface ProvisionOptions {
  /**
   * The macro overlay, as a percentage uplift. §4 requires it to be a stated
   * tenant input: an assistant that infers a forward-looking factor from data
   * it has is inventing an economic forecast.
   */
  forwardLookingPct: number;
  /** Provision rate applied to a counterparty in confirmed insolvency. */
  specificProvisionPct: number;
  /** Whether collateral reduces the exposure the rates apply to. */
  deductCollateral: boolean;
}

export function computeProvision(
  input: ProvisionInput,
  matrix: LossRate[],
  options: ProvisionOptions,
): ProvisionLine {
  const rateByBucket = new Map(matrix.map((r) => [r.bucketCode, r]));
  const notes: string[] = [];

  const grossExposure = input.buckets.reduce((s, b) => s + b.amount, 0);
  const secured = options.deductCollateral ? Math.min(input.securedAmount, grossExposure) : 0;
  const exposureAtDefault = grossExposure - secured;
  const recoveryFactor = grossExposure === 0 ? 0 : exposureAtDefault / grossExposure;

  let baseProvision = 0;
  let unratedExposure = 0;

  const bucketDetail = input.buckets.map((b) => {
    const rate = rateByBucket.get(b.bucketCode);
    const atDefault = b.amount * recoveryFactor;
    if (!rate || rate.ratePct === null) {
      unratedExposure += b.amount;
      return { bucketCode: b.bucketCode, amount: b.amount, ratePct: null, provision: 0, unrated: true };
    }
    const provision = (atDefault * rate.ratePct) / 100;
    baseProvision += provision;
    return {
      bucketCode: b.bucketCode,
      amount: b.amount,
      ratePct: rate.ratePct,
      provision: Math.round(provision * 100) / 100,
      unrated: false,
    };
  });

  if (unratedExposure > 0) {
    // Loudly, and in the line itself. A zero provision on an unrated bucket
    // looks identical to a genuine zero unless it says otherwise.
    notes.push(
      `${Math.round(unratedExposure)} sits in ageing buckets with no derivable loss rate and is NOT provisioned here — decide these deliberately rather than accepting zero`,
    );
  }

  let specificProvision: number | null = null;
  if (input.hasCriticalLegalEvent) {
    specificProvision = Math.round(((exposureAtDefault * options.specificProvisionPct) / 100) * 100) / 100;
    notes.push(
      `confirmed insolvency proceedings — a specific provision at ${options.specificProvisionPct}% replaces the collective calculation`,
    );
  }

  const withOverlay = baseProvision * (1 + options.forwardLookingPct / 100);
  const proposed = specificProvision ?? withOverlay;

  if (secured > 0) {
    notes.push(`${Math.round(secured)} of collateral deducted before applying the loss rates`);
  }

  return {
    partyId: input.partyId,
    partyName: input.partyName,
    legalEntityCode: input.legalEntityCode,
    currency: input.currency,
    grossExposure: Math.round(grossExposure * 100) / 100,
    securedAmount: Math.round(secured * 100) / 100,
    exposureAtDefault: Math.round(exposureAtDefault * 100) / 100,
    bucketDetail,
    baseProvision: Math.round(baseProvision * 100) / 100,
    forwardLookingPct: options.forwardLookingPct,
    specificProvision,
    proposedProvision: Math.round(proposed * 100) / 100,
    unratedExposure: Math.round(unratedExposure * 100) / 100,
    notes,
  };
}

export interface ProvisionSummary {
  parties: number;
  grossExposure: number;
  proposedProvision: number;
  coveragePct: number | null;
  /** Balance the model could not rate. The number an auditor asks about first. */
  unratedExposure: number;
  specificCases: number;
  bucketsWithoutRate: string[];
}

export function summariseProvision(lines: ProvisionLine[], matrix: LossRate[]): ProvisionSummary {
  const gross = lines.reduce((s, l) => s + l.grossExposure, 0);
  const provision = lines.reduce((s, l) => s + l.proposedProvision, 0);
  return {
    parties: new Set(lines.map((l) => l.partyId)).size,
    grossExposure: Math.round(gross * 100) / 100,
    proposedProvision: Math.round(provision * 100) / 100,
    coveragePct: gross === 0 ? null : Math.round((provision / gross) * 1000) / 10,
    unratedExposure: Math.round(lines.reduce((s, l) => s + l.unratedExposure, 0) * 100) / 100,
    specificCases: lines.filter((l) => l.specificProvision !== null).length,
    bucketsWithoutRate: matrix.filter((r) => r.ratePct === null).map((r) => r.bucketCode),
  };
}
