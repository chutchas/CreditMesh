import type { CurrencyCode, IsoDate, IsoTimestamp, Uuid } from '../types/canonical';

/**
 * Module 11 — Order Block Cockpit.
 *
 * The source system decides what to block. This engine never disputes that and
 * never releases anything (P5): it answers the three questions a credit officer
 * asks in front of a held order — why is it stuck, what would clear it, and
 * what becomes true if it goes out — and records who decided what.
 *
 * The honesty rule that shapes the whole file: the causes below are conditions
 * that are true in CreditMesh's data at the moment of the block and would
 * explain it. They are not the source system's rule, which we do not have. When
 * none of them holds, the answer is `not_visible` — a cockpit that invents a
 * plausible reason for a block it cannot see is worse than one that admits the
 * gap, because the officer acts on the invention.
 */

export type BlockCauseCode =
  | 'limit_exceeded'
  | 'no_limit_set'
  | 'limit_expired'
  | 'overdue_balance'
  | 'collateral_expired'
  | 'collateral_shortfall'
  | 'worst_risk_grade'
  | 'group_limit_pressure'
  | 'not_visible';

export interface BlockCause {
  code: BlockCauseCode;
  severity: 'critical' | 'warning' | 'info';
  /** The numbers that make the case. Rendered as evidence, never hidden (P6). */
  detail: Record<string, number | string | null>;
}

export type RemedyCode =
  | 'collect_overdue'
  | 'raise_limit'
  | 'add_collateral'
  | 'partial_release'
  | 'prepayment'
  | 'renew_limit'
  | 'credit_review'
  | 'ask_source_system';

export interface Remedy {
  code: RemedyCode;
  /** What the remedy costs, in base currency. Null when it is not a number. */
  amount: number | null;
  /** Which of the diagnosed causes this would answer. */
  clears: BlockCauseCode[];
}

export interface BlockedOrder {
  blockId: Uuid;
  orderRef: string;
  partyId: Uuid;
  partyName: string;
  legalEntityCode: string;
  orderAmount: number;
  currency: CurrencyCode;
  orderDate: IsoDate | null;
  blockedAt: IsoTimestamp;
  /** The source system's own code and words, kept verbatim. */
  blockCode: string | null;
  blockReason: string | null;
}

export interface BlockContext {
  exposure: number;
  creditLimit: number | null;
  limitValidTo: IsoDate | null;
  arOverdue: number;
  maxOpenDpd: number | null;
  /** Inbound collateral still available to allocate to this party × entity. */
  collateralAvailable: number;
  /** Face value of inbound collateral that has expired but is still on the books. */
  collateralExpired: number;
  /** Exposure this collateral does not cover, from the Module 3 coverage view. */
  uncoveredExposure: number;
  grade: string | null;
  score: number | null;
  /** Group totals from Module 2, when the party belongs to a resolved group. */
  groupExposure: number | null;
  groupMaxSingleLimit: number | null;
}

export interface OrderBlockPolicy {
  /** The tenant's lowest grade band. A party sitting on it is worth naming. */
  worstGradeCode: string | null;
  /** After this many days a block is itself the problem, whatever caused it. */
  ageAlertDays: number;
}

export interface ReleaseImpact {
  exposureBefore: number;
  exposureAfter: number;
  creditLimit: number | null;
  headroomBefore: number | null;
  headroomAfter: number | null;
  utilizationAfterPct: number | null;
  uncoveredAfter: number;
  groupExposureAfter: number | null;
}

export interface OrderBlockDiagnosis {
  order: BlockedOrder;
  causes: BlockCause[];
  remedies: Remedy[];
  impact: ReleaseImpact;
  daysBlocked: number;
  /** False when nothing in our data accounts for the block. */
  explained: boolean;
  /** Ordering device for the queue. Not a score, not a recommendation. */
  priority: number;
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Diagnose one held order.
 *
 * Every cause is checked independently and all of them are reported. A block
 * usually has more than one thing wrong behind it, and showing only the first
 * sends the officer to fix a limit when the real problem is ฿6M past due.
 */
export function diagnoseOrderBlock(
  order: BlockedOrder,
  ctx: BlockContext,
  policy: OrderBlockPolicy,
  asOf: IsoTimestamp,
): OrderBlockDiagnosis {
  const causes: BlockCause[] = [];
  const remedies: Remedy[] = [];

  const exposureAfter = ctx.exposure + order.orderAmount;
  const headroomBefore = ctx.creditLimit === null ? null : ctx.creditLimit - ctx.exposure;
  const headroomAfter = ctx.creditLimit === null ? null : ctx.creditLimit - exposureAfter;

  /* Limit ---------------------------------------------------------------- */
  if (ctx.creditLimit === null || ctx.creditLimit === 0) {
    causes.push({
      code: 'no_limit_set',
      severity: 'critical',
      detail: { exposure: round2(ctx.exposure), orderAmount: round2(order.orderAmount) },
    });
    remedies.push({ code: 'raise_limit', amount: round2(exposureAfter), clears: ['no_limit_set'] });
  } else if (headroomAfter !== null && headroomAfter < 0) {
    causes.push({
      code: 'limit_exceeded',
      severity: 'critical',
      detail: {
        creditLimit: round2(ctx.creditLimit),
        exposure: round2(ctx.exposure),
        orderAmount: round2(order.orderAmount),
        shortfall: round2(-headroomAfter),
      },
    });
    remedies.push({ code: 'raise_limit', amount: round2(-headroomAfter), clears: ['limit_exceeded'] });
    remedies.push({ code: 'prepayment', amount: round2(-headroomAfter), clears: ['limit_exceeded'] });
    // Only worth offering when part of the order genuinely fits. A "partial
    // release" of nothing is a button that wastes someone's afternoon.
    if (headroomBefore !== null && headroomBefore > 0) {
      remedies.push({ code: 'partial_release', amount: round2(headroomBefore), clears: ['limit_exceeded'] });
    }
  }

  if (ctx.limitValidTo && ctx.limitValidTo < asOf.slice(0, 10)) {
    causes.push({
      code: 'limit_expired',
      severity: 'critical',
      detail: { limitValidTo: ctx.limitValidTo, creditLimit: ctx.creditLimit },
    });
    remedies.push({ code: 'renew_limit', amount: null, clears: ['limit_expired'] });
  }

  /* Receivables ---------------------------------------------------------- */
  if (ctx.arOverdue > 0) {
    causes.push({
      code: 'overdue_balance',
      severity: ctx.maxOpenDpd !== null && ctx.maxOpenDpd >= 90 ? 'critical' : 'warning',
      detail: { arOverdue: round2(ctx.arOverdue), maxOpenDpd: ctx.maxOpenDpd },
    });
    remedies.push({ code: 'collect_overdue', amount: round2(ctx.arOverdue), clears: ['overdue_balance'] });
  }

  /* Collateral ----------------------------------------------------------- */
  if (ctx.collateralExpired > 0) {
    causes.push({
      code: 'collateral_expired',
      severity: 'critical',
      detail: { expiredFaceValue: round2(ctx.collateralExpired) },
    });
  }

  const uncoveredAfter = Math.max(0, ctx.uncoveredExposure + order.orderAmount - ctx.collateralAvailable);
  if (uncoveredAfter > 0 && (ctx.collateralAvailable > 0 || ctx.collateralExpired > 0)) {
    // Only raised for parties the organisation actually secures. Telling an
    // unsecured customer's officer that ฿4M is "uncovered" is true of every
    // unsecured customer and therefore says nothing.
    causes.push({
      code: 'collateral_shortfall',
      severity: 'warning',
      detail: {
        available: round2(ctx.collateralAvailable),
        uncoveredNow: round2(ctx.uncoveredExposure),
        uncoveredAfterRelease: round2(uncoveredAfter),
      },
    });
    remedies.push({
      code: 'add_collateral',
      amount: round2(uncoveredAfter),
      clears: ['collateral_shortfall', 'collateral_expired'],
    });
  }

  /* Group ---------------------------------------------------------------- */
  const groupExposureAfter = ctx.groupExposure === null ? null : ctx.groupExposure + order.orderAmount;
  if (
    groupExposureAfter !== null &&
    ctx.groupMaxSingleLimit !== null &&
    ctx.groupMaxSingleLimit > 0 &&
    groupExposureAfter > ctx.groupMaxSingleLimit
  ) {
    causes.push({
      code: 'group_limit_pressure',
      severity: 'warning',
      detail: {
        groupExposureAfter: round2(groupExposureAfter),
        maxSingleLimit: round2(ctx.groupMaxSingleLimit),
      },
    });
  }

  /* Risk grade ----------------------------------------------------------- */
  if (policy.worstGradeCode && ctx.grade === policy.worstGradeCode) {
    causes.push({
      code: 'worst_risk_grade',
      severity: 'warning',
      detail: { grade: ctx.grade, score: ctx.score },
    });
    remedies.push({ code: 'credit_review', amount: null, clears: ['worst_risk_grade'] });
  }

  const explained = causes.length > 0;
  if (!explained) {
    causes.push({
      code: 'not_visible',
      severity: 'info',
      detail: { blockCode: order.blockCode, blockReason: order.blockReason },
    });
    remedies.push({ code: 'ask_source_system', amount: null, clears: ['not_visible'] });
  }

  const daysBlocked = daysBetween(order.blockedAt, asOf);

  // Value first, age second. An order held a week for ฿8M outranks one held a
  // month for ฿50K, but age still moves things up so nothing sits forever.
  const ageWeight = 1 + Math.min(daysBlocked, policy.ageAlertDays * 2) / (policy.ageAlertDays * 2);
  const priority = order.orderAmount * ageWeight;

  return {
    order,
    causes,
    remedies,
    impact: {
      exposureBefore: round2(ctx.exposure),
      exposureAfter: round2(exposureAfter),
      creditLimit: ctx.creditLimit === null ? null : round2(ctx.creditLimit),
      headroomBefore: headroomBefore === null ? null : round2(headroomBefore),
      headroomAfter: headroomAfter === null ? null : round2(headroomAfter),
      utilizationAfterPct:
        ctx.creditLimit === null || ctx.creditLimit === 0
          ? null
          : round2((exposureAfter / ctx.creditLimit) * 100),
      uncoveredAfter: round2(uncoveredAfter),
      groupExposureAfter: groupExposureAfter === null ? null : round2(groupExposureAfter),
    },
    daysBlocked,
    explained,
    priority: round2(priority),
  };
}

export interface OrderBlockSummary {
  blockedCount: number;
  blockedValue: number;
  /** Blocks our data cannot account for. A high number means the adapter is thin. */
  unexplainedCount: number;
  /** Held longer than the tenant's alert threshold. */
  agedCount: number;
  oldestDaysBlocked: number;
  /** Value that would clear if every overdue balance behind these blocks were paid. */
  clearableByCollection: number;
  byCause: { code: BlockCauseCode; count: number; value: number }[];
}

export function summariseOrderBlocks(
  diagnoses: OrderBlockDiagnosis[],
  policy: OrderBlockPolicy,
): OrderBlockSummary {
  const byCause = new Map<BlockCauseCode, { count: number; value: number }>();
  let clearable = 0;

  for (const d of diagnoses) {
    for (const c of d.causes) {
      const bucket = byCause.get(c.code) ?? { count: 0, value: 0 };
      bucket.count += 1;
      bucket.value += d.order.orderAmount;
      byCause.set(c.code, bucket);
    }
    // "Clearable by collection" means overdue is the *only* critical cause. An
    // order also over its limit does not go out because someone paid an invoice.
    const criticals = d.causes.filter((c) => c.severity === 'critical').map((c) => c.code);
    if (criticals.length === 0 && d.causes.some((c) => c.code === 'overdue_balance')) {
      clearable += d.order.orderAmount;
    }
  }

  return {
    blockedCount: diagnoses.length,
    blockedValue: round2(diagnoses.reduce((s, d) => s + d.order.orderAmount, 0)),
    unexplainedCount: diagnoses.filter((d) => !d.explained).length,
    agedCount: diagnoses.filter((d) => d.daysBlocked >= policy.ageAlertDays).length,
    oldestDaysBlocked: diagnoses.reduce((m, d) => Math.max(m, d.daysBlocked), 0),
    clearableByCollection: round2(clearable),
    byCause: [...byCause.entries()]
      .map(([code, v]) => ({ code, count: v.count, value: round2(v.value) }))
      .sort((a, b) => b.value - a.value),
  };
}

export function rankOrderBlocks(diagnoses: OrderBlockDiagnosis[]): OrderBlockDiagnosis[] {
  return [...diagnoses].sort((a, b) => b.priority - a.priority);
}
