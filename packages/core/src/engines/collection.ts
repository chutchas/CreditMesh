import type { CollectionPolicy } from '../tenant/profile';
import type { CurrencyCode, IsoDate, IsoTimestamp, Uuid } from '../types/canonical';

/**
 * Module 12 — Collection Management Workbench.
 *
 * The first module that changes how somebody's day works rather than adding
 * information to it, and §7 is blunt about the consequence: if the queue does
 * not match what a collector thinks they should be chasing in the first week,
 * they go back to Excel and do not come back.
 *
 * Three things follow from that, and they are the design.
 *
 * 1. The queue is a suggestion. Collectors reorder it, and the reorder is
 *    recorded — that record is how the weights get better, and it is worth more
 *    than any ordering we could guess at the start.
 * 2. Money received comes off first. A queue that does not know about
 *    yesterday's receipt sends someone to chase a customer who has paid, which
 *    destroys trust faster than any missing feature. Module 13 exists before
 *    this one for exactly this reason.
 * 3. No forced stages and no SLA in the first phase. Contact log and queue
 *    only. Process enforcement arrives after the team has agreed the queue is
 *    right, not before.
 *
 * Boundary with Module 5, which must stay sharp: **Watchlist says who is
 * risky; this says who to call today.** If the two ever start overlapping, one
 * of them is designed wrong.
 */

export type ContactStage = CollectionPolicy['contactStages'][number];

export type CaseStatus = 'open' | 'on_hold' | 'closed';

export interface CollectionCaseInput {
  caseId: Uuid;
  partyId: Uuid;
  partyName: string;
  legalEntityCode: string;
  ownerUserId: Uuid | null;
  ownerLabel: string | null;
  stage: ContactStage | null;
  status: CaseStatus;
  /** Open balance already net of receipts applied by Module 13. */
  openAmount: number;
  overdueAmount: number;
  currency: CurrencyCode;
  maxDpd: number;
  grade: string | null;
  score: number | null;
  lastContactAt: IsoTimestamp | null;
  /** Set when a collector moved this case by hand. We keep their order. */
  manualRank: number | null;
  hasAcceptedDispute: boolean;
  openPromise: { amount: number; promisedDate: IsoDate } | null;
  brokenPromiseCount: number;
}

export interface QueueItem {
  case: CollectionCaseInput;
  /** 0–100. An ordering device from the tenant's own weights, not a risk score. */
  priority: number;
  /** What the policy's day thresholds suggest. Never applied automatically. */
  suggestedStage: ContactStage | null;
  /** Why this is here, in words a collector can argue with. */
  reasons: string[];
  /** True when the policy says this case must not be chased at all. */
  onHold: boolean;
  holdReason: string | null;
  daysSinceContact: number | null;
  promiseState: 'none' | 'open' | 'due_today' | 'broken';
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

function normalise(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

/**
 * The stage the policy's day thresholds point at.
 *
 * Returned as a suggestion, never applied. An organisation that already runs
 * dunning in its ERP must not have a second system quietly advancing stages
 * and sending a customer two final notices from two places.
 */
export function suggestedStageFor(maxDpd: number, policy: CollectionPolicy): ContactStage | null {
  let best: ContactStage | null = null;
  let bestDays = -1;
  for (const stage of policy.contactStages) {
    const trigger = policy.stageTriggerDays[stage];
    if (trigger === undefined) continue;
    if (maxDpd >= trigger && trigger > bestDays) {
      best = stage;
      bestDays = trigger;
    }
  }
  return best;
}

export function buildCollectionQueue(
  cases: CollectionCaseInput[],
  policy: CollectionPolicy,
  asOf: IsoDate,
  gradeRank: Map<string, number>,
): QueueItem[] {
  const maxOverdue = Math.max(1, ...cases.map((c) => c.overdueAmount));
  const maxDpd = Math.max(1, ...cases.map((c) => c.maxDpd));
  const weights = policy.strategyWeights;
  const weightTotal = weights.amount + weights.daysOverdue + weights.riskGrade || 1;

  const items = cases.map((c): QueueItem => {
    const reasons: string[] = [];

    // A dispute the organisation has itself accepted is not a debt to chase.
    // Chasing it is how a collections team loses an argument it already lost.
    let onHold = false;
    let holdReason: string | null = null;
    if (policy.holdWhenDisputeAccepted && c.hasAcceptedDispute) {
      onHold = true;
      holdReason = 'an accepted dispute is open on this account';
    }
    if (c.status === 'on_hold') {
      onHold = true;
      holdReason = holdReason ?? 'the case is on hold';
    }

    const gradeComponent = c.grade === null ? 0.5 : normalise(gradeRank.get(c.grade) ?? 0, Math.max(1, gradeRank.size - 1));
    const priority =
      ((normalise(c.overdueAmount, maxOverdue) * weights.amount +
        normalise(c.maxDpd, maxDpd) * weights.daysOverdue +
        gradeComponent * weights.riskGrade) /
        weightTotal) *
      100;

    if (c.overdueAmount > 0) reasons.push(`${c.overdueAmount} overdue, oldest ${c.maxDpd} days`);
    if (c.brokenPromiseCount >= policy.ptpMaxBrokenBeforeEscalation) {
      reasons.push(`${c.brokenPromiseCount} broken promises`);
    }
    if (c.lastContactAt === null && c.overdueAmount > 0) reasons.push('never contacted');

    let promiseState: QueueItem['promiseState'] = 'none';
    if (c.openPromise) {
      const days = daysBetween(asOf, c.openPromise.promisedDate);
      if (days < 0) {
        promiseState = 'broken';
        reasons.push(`promise of ${c.openPromise.amount} was due ${-days} days ago`);
      } else if (days === 0) {
        promiseState = 'due_today';
        reasons.push(`promise of ${c.openPromise.amount} falls due today`);
      } else {
        promiseState = 'open';
        // An open promise inside its window is a reason NOT to call, and the
        // queue says so rather than silently ranking the case low.
        reasons.push(`promised ${c.openPromise.amount} for ${c.openPromise.promisedDate} — nothing to chase yet`);
      }
    }

    return {
      case: c,
      priority: Math.round(priority * 10) / 10,
      suggestedStage: suggestedStageFor(c.maxDpd, policy),
      reasons,
      onHold,
      holdReason,
      daysSinceContact: c.lastContactAt === null ? null : daysBetween(c.lastContactAt.slice(0, 10), asOf),
      promiseState,
    };
  });

  return items.sort((a, b) => {
    // Held cases leave the working queue entirely rather than sitting at the
    // bottom of it, where somebody eventually calls them anyway.
    if (a.onHold !== b.onHold) return a.onHold ? 1 : -1;
    // A collector's own order beats ours, always. Recording it is the point.
    const am = a.case.manualRank;
    const bm = b.case.manualRank;
    if (am !== null && bm !== null && am !== bm) return am - bm;
    if (am !== null && bm === null) return -1;
    if (am === null && bm !== null) return 1;
    // An open promise inside its window drops down: there is nothing to say yet.
    if (a.promiseState === 'open' && b.promiseState !== 'open') return 1;
    if (b.promiseState === 'open' && a.promiseState !== 'open') return -1;
    return b.priority - a.priority;
  });
}

export interface CollectionSummary {
  openCases: number;
  chaseable: number;
  onHold: number;
  totalOverdue: number;
  promisesDueToday: number;
  promisesBroken: number;
  neverContacted: number;
  /** Cases with no contact in longer than the longest stage trigger. */
  goneQuiet: number;
}

export function summariseCollection(
  queue: QueueItem[],
  policy: CollectionPolicy,
): CollectionSummary {
  const quietAfter = Math.max(...Object.values(policy.stageTriggerDays), 30);
  return {
    openCases: queue.length,
    chaseable: queue.filter((q) => !q.onHold).length,
    onHold: queue.filter((q) => q.onHold).length,
    totalOverdue: Math.round(queue.reduce((s, q) => s + q.case.overdueAmount, 0) * 100) / 100,
    promisesDueToday: queue.filter((q) => q.promiseState === 'due_today').length,
    promisesBroken: queue.filter((q) => q.promiseState === 'broken').length,
    neverContacted: queue.filter((q) => q.case.lastContactAt === null && q.case.overdueAmount > 0).length,
    goneQuiet: queue.filter((q) => q.daysSinceContact !== null && q.daysSinceContact > quietAfter).length,
  };
}

export interface PromiseRecord {
  amount: number;
  promisedDate: IsoDate;
  status: 'open' | 'kept' | 'broken' | 'cancelled';
}

/**
 * Promise-to-pay kept rate.
 *
 * Cancelled promises are excluded from both sides rather than counted as
 * broken: a promise withdrawn by agreement says nothing about whether this
 * customer keeps their word, and folding it in makes the one collections
 * metric people already report quietly wrong.
 */
export function promiseKeptRate(promises: PromiseRecord[]): { kept: number; broken: number; ratePct: number | null } {
  const kept = promises.filter((p) => p.status === 'kept').length;
  const broken = promises.filter((p) => p.status === 'broken').length;
  const settled = kept + broken;
  return { kept, broken, ratePct: settled === 0 ? null : Math.round((kept / settled) * 1000) / 10 };
}

/**
 * Days sales outstanding, the count-back way.
 *
 * The simple formula (AR ÷ revenue × days) is what most teams quote and it
 * lies whenever sales are seasonal, which for these groups they always are.
 * Count-back walks the balance backwards through actual monthly sales, so a
 * quiet December does not read as a collections failure.
 */
export function dsoCountBack(
  arBalance: number,
  monthlySales: { month: string; sales: number; days: number }[],
): number | null {
  if (arBalance <= 0 || monthlySales.length === 0) return null;
  let remaining = arBalance;
  let days = 0;
  // Most recent month first.
  const months = [...monthlySales].sort((a, b) => (a.month < b.month ? 1 : -1));
  for (const m of months) {
    if (m.sales <= 0) continue;
    if (remaining <= m.sales) {
      days += (remaining / m.sales) * m.days;
      return Math.round(days * 10) / 10;
    }
    remaining -= m.sales;
    days += m.days;
  }
  // The balance exceeds every month of sales we have. Saying "we cannot tell
  // from this much history" beats reporting a number built on nothing.
  return null;
}
