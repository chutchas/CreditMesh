import type { LateChargePolicy, LateChargeRate } from '../tenant/profile';
import type { CurrencyCode, IsoDate, Uuid } from '../types/canonical';

/**
 * Module 14 — Late Payment Charge Manager.
 *
 * The simplest calculation in the product and the one with the least room for
 * error, because the output is real money billed to a customer. §7 makes the
 * acceptance condition explicit and it is a delivery gate, not a nicety:
 * recompute three months of charges and reconcile against what was actually
 * billed. One mismatch ends adoption.
 *
 * Two things follow.
 *
 * Every input is stored, not just the answer. Late-charge arguments are almost
 * never about the total; they are about which rate, from which date, over how
 * many days, on what principal. A stored amount with no inputs cannot be
 * defended in the meeting where it is questioned.
 *
 * The rate is the rate of the day, not today's rate. Rates carry effective
 * periods and a recomputation of last quarter uses last quarter's rate. If the
 * rate changes and old numbers stop reproducing, P6 is broken.
 *
 * P5 and P8 bound the output: this calculates, proposes and keeps evidence.
 * The debit note itself is issued by the ERP.
 */

export type SkipReason =
  | 'not_overdue'
  | 'in_grace'
  | 'below_minimum'
  | 'excluded_party'
  | 'no_rate';

export interface ChargeableItem {
  arItemId: Uuid;
  partyId: Uuid;
  partyName: string;
  legalEntityCode: string;
  documentNo: string;
  documentDate: IsoDate;
  dueDate: IsoDate;
  /** Null while still open; the charge then runs to the as-of date. */
  clearedDate: IsoDate | null;
  amount: number;
  currency: CurrencyCode;
  segment: string | null;
  gradeCode: string | null;
}

/** Every input to the calculation, kept so the number can be defended. */
export interface LateChargeLine {
  item: ChargeableItem;
  principal: number;
  annualRatePct: number;
  rateEffectiveFrom: IsoDate;
  dayCount: number;
  chargeFrom: IsoDate;
  chargeTo: IsoDate;
  lateDays: number;
  gracePeriodDays: number;
  rawAmount: number;
  chargeAmount: number;
  currency: CurrencyCode;
}

export interface SkippedItem {
  item: ChargeableItem;
  reason: SkipReason;
  detail: string;
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

/**
 * The rate in force on a given date.
 *
 * More specific beats more general: a rate scoped to a grade or a segment wins
 * over the house rate for the same period. Ties are resolved by the later
 * `effectiveFrom`, which is the one an organisation means when it adds a rate
 * without removing the old one.
 */
export function rateFor(
  policy: LateChargePolicy,
  onDate: IsoDate,
  segment: string | null,
  gradeCode: string | null,
): LateChargeRate | null {
  const applicable = policy.rates.filter((r) => {
    if (r.effectiveFrom > onDate) return false;
    if (r.effectiveTo !== null && r.effectiveTo < onDate) return false;
    if (r.segment !== null && r.segment !== segment) return false;
    if (r.gradeCode !== null && r.gradeCode !== gradeCode) return false;
    return true;
  });
  if (applicable.length === 0) return null;

  const specificity = (r: LateChargeRate) => (r.segment ? 1 : 0) + (r.gradeCode ? 1 : 0);
  return applicable.sort((a, b) => {
    const s = specificity(b) - specificity(a);
    if (s !== 0) return s;
    return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
  })[0]!;
}

function dayCountFor(convention: LateChargePolicy['dayCountConvention'], year: number): number {
  if (convention === '360') return 360;
  if (convention === '365') return 365;
  // actual: leap years have 366 days and pretending otherwise is a rounding
  // error somebody will find.
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeap ? 366 : 365;
}

function applyRounding(amount: number, rule: LateChargePolicy['roundingRule']): number {
  switch (rule) {
    case 'nearest_1':
      return Math.round(amount);
    case 'down_1':
      return Math.floor(amount);
    case 'nearest_0.01':
      return Math.round(amount * 100) / 100;
    default:
      return amount;
  }
}

/**
 * Compute the charge for one item, or say precisely why there is none.
 *
 * A skipped item is returned rather than dropped: "why did this invoice not
 * attract a charge" is asked as often as "why did this one".
 */
export function computeLateCharge(
  item: ChargeableItem,
  policy: LateChargePolicy,
  asOf: IsoDate,
): { line: LateChargeLine } | { skipped: SkippedItem } {
  if (policy.excludedPartyIds.includes(item.partyId)) {
    return {
      skipped: { item, reason: 'excluded_party', detail: 'this counterparty is excluded by agreement' },
    };
  }

  const startFrom = policy.chargeStartFrom === 'invoice_date' ? item.documentDate : item.dueDate;
  const endAt = item.clearedDate ?? asOf;
  const rawLateDays = daysBetween(startFrom, endAt);

  if (rawLateDays <= 0) {
    return { skipped: { item, reason: 'not_overdue', detail: `not yet past ${startFrom}` } };
  }
  if (rawLateDays <= policy.gracePeriodDays) {
    return {
      skipped: {
        item,
        reason: 'in_grace',
        detail: `${rawLateDays} days late, inside the ${policy.gracePeriodDays}-day grace period`,
      },
    };
  }

  // The rate of the day the lateness began, not today's rate. This is what
  // makes a recomputation of last quarter reproduce last quarter's invoice.
  const rate = rateFor(policy, startFrom, item.segment, item.gradeCode);
  if (!rate) {
    return {
      skipped: { item, reason: 'no_rate', detail: `no rate is in force on ${startFrom} for this counterparty` },
    };
  }

  const lateDays = rawLateDays - policy.gracePeriodDays;
  const dayCount = dayCountFor(policy.dayCountConvention, Number(startFrom.slice(0, 4)));
  const rawAmount = (item.amount * (rate.annualRatePct / 100) * lateDays) / dayCount;
  const chargeAmount = applyRounding(rawAmount, policy.roundingRule);

  if (chargeAmount < policy.minimumChargeAmount) {
    return {
      skipped: {
        item,
        reason: 'below_minimum',
        detail: `${chargeAmount} is below the ${policy.minimumChargeAmount} minimum`,
      },
    };
  }

  return {
    line: {
      item,
      principal: item.amount,
      annualRatePct: rate.annualRatePct,
      rateEffectiveFrom: rate.effectiveFrom,
      dayCount,
      chargeFrom: startFrom,
      chargeTo: endAt,
      lateDays,
      gracePeriodDays: policy.gracePeriodDays,
      rawAmount: Math.round(rawAmount * 100) / 100,
      chargeAmount,
      currency: item.currency,
    },
  };
}

export interface ChargeRunResult {
  lines: LateChargeLine[];
  skipped: SkippedItem[];
  total: number;
  /** The policy the run used, recorded so the numbers stay reproducible. */
  policySnapshot: {
    dayCountConvention: string;
    gracePeriodDays: number;
    minimumChargeAmount: number;
    roundingRule: string;
    chargeStartFrom: string;
    rateCount: number;
  };
}

export function runLateCharges(
  items: ChargeableItem[],
  policy: LateChargePolicy,
  asOf: IsoDate,
): ChargeRunResult {
  const lines: LateChargeLine[] = [];
  const skipped: SkippedItem[] = [];

  for (const item of items) {
    const result = computeLateCharge(item, policy, asOf);
    if ('line' in result) lines.push(result.line);
    else skipped.push(result.skipped);
  }

  return {
    lines,
    skipped,
    total: Math.round(lines.reduce((s, l) => s + l.chargeAmount, 0) * 100) / 100,
    policySnapshot: {
      dayCountConvention: policy.dayCountConvention,
      gracePeriodDays: policy.gracePeriodDays,
      minimumChargeAmount: policy.minimumChargeAmount,
      roundingRule: policy.roundingRule,
      chargeStartFrom: policy.chargeStartFrom,
      rateCount: policy.rates.length,
    },
  };
}

export interface WaiverRecord {
  partyId: Uuid;
  partyName: string;
  amount: number;
  approvedByLabel: string | null;
  reason: string | null;
  waivedAt: IsoDate;
}

export interface WaiverReport {
  waivedTotal: number;
  chargedTotal: number;
  waivedSharePct: number | null;
  byApprover: { approver: string; count: number; amount: number }[];
  byParty: { partyId: Uuid; partyName: string; count: number; amount: number }[];
}

/**
 * The report this module is actually bought for.
 *
 * §7 is right that the valuable number is not the charge total but the
 * **waived** total: how much was given away last year, to whom, approved by
 * whom. Almost no organisation can produce it today, and it is usually the
 * number that gets a whole project funded.
 */
export function waiverReport(waivers: WaiverRecord[], chargedTotal: number): WaiverReport {
  const byApprover = new Map<string, { count: number; amount: number }>();
  const byParty = new Map<string, { partyName: string; count: number; amount: number }>();

  for (const w of waivers) {
    const approver = w.approvedByLabel ?? 'unattributed';
    const a = byApprover.get(approver) ?? { count: 0, amount: 0 };
    a.count += 1;
    a.amount += w.amount;
    byApprover.set(approver, a);

    const p = byParty.get(w.partyId) ?? { partyName: w.partyName, count: 0, amount: 0 };
    p.count += 1;
    p.amount += w.amount;
    byParty.set(w.partyId, p);
  }

  const waivedTotal = Math.round(waivers.reduce((s, w) => s + w.amount, 0) * 100) / 100;
  const denominator = waivedTotal + chargedTotal;

  return {
    waivedTotal,
    chargedTotal: Math.round(chargedTotal * 100) / 100,
    waivedSharePct: denominator === 0 ? null : Math.round((waivedTotal / denominator) * 1000) / 10,
    byApprover: [...byApprover.entries()]
      .map(([approver, v]) => ({ approver, count: v.count, amount: Math.round(v.amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount),
    byParty: [...byParty.entries()]
      .map(([partyId, v]) => ({ partyId, ...v, amount: Math.round(v.amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/**
 * Who may waive how much, from §4.13 `waiver_authority`.
 *
 * A null `maxAmount` is unlimited. An empty authority list means nobody is
 * authorised yet, which returns false rather than true: an unset policy must
 * not read as permission.
 */
export function canWaive(
  policy: LateChargePolicy,
  roleCode: string,
  amount: number,
): { allowed: boolean; reason: string } {
  const entry = policy.waiverAuthority.find((w) => w.role === roleCode);
  if (!entry) {
    return { allowed: false, reason: `no waiver authority is configured for the role "${roleCode}"` };
  }
  if (entry.maxAmount === null) return { allowed: true, reason: 'unlimited authority' };
  if (amount <= entry.maxAmount) return { allowed: true, reason: `within the ${entry.maxAmount} limit` };
  return { allowed: false, reason: `${amount} exceeds the ${entry.maxAmount} limit for "${roleCode}"` };
}
