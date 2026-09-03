import type { PaymentPolicy } from '../tenant/profile';
import type { CurrencyCode, IsoDate, IsoTimestamp, Uuid } from '../types/canonical';

/**
 * Module 15 — Payment Exception & Returned Cheque Monitor.
 *
 * The clearest demonstration of P7 in the product. A returned cheque is the
 * freshest fact an organisation holds about a counterparty's ability to pay —
 * far fresher than last year's filed accounts — and today it ends its life in a
 * reconciliation report that the person approving the credit limit never sees.
 *
 * So the output of this engine is not a list. It is a set of **signals with
 * declared destinations**: the risk index, the watchlist, a credit review, an
 * order flag, a collection escalation. §7's test is that a feature ending at a
 * report with nobody consuming it is not finished.
 *
 * One destination is deliberately missing. Nothing here blocks an order. Two
 * returned cheques raise a flag for a human on the next order; they do not stop
 * a shipment automatically, for the same reason Module 2 never auto-applies a
 * group: an automatic consequence built on one imperfect data feed will one day
 * halt a good customer's line and nobody will find the rule that did it.
 */

export type ExceptionType =
  | 'returned_cheque'
  | 'reversal'
  | 'mismatch'
  | 'missing'
  | 'failed_transfer'
  | 'overpayment'
  | 'unidentified_receipt';

export type ExceptionStatus = 'open' | 'resolved' | 'written_off';

export interface PaymentException {
  exceptionId: Uuid;
  partyId: Uuid | null;
  partyName: string | null;
  legalEntityCode: string;
  type: ExceptionType;
  amount: number;
  currency: CurrencyCode;
  occurredAt: IsoDate;
  reasonCode: string | null;
  reasonText: string | null;
  reference: string | null;
  status: ExceptionStatus;
  resolvedAt: IsoTimestamp | null;
  /** bank | erp | manual_entry — manual_entry is a first-class route, always. */
  source: string;
}

export type SignalTarget =
  | 'risk_index'
  | 'watchlist'
  | 'credit_review'
  | 'order_review'
  | 'collection_escalation';

export interface CreditSignal {
  partyId: Uuid;
  partyName: string | null;
  code: string;
  severity: 'critical' | 'high' | 'medium';
  /** Where this goes next. A signal with no target is not a signal. */
  targets: SignalTarget[];
  /** Plain words a credit officer can check, with the numbers in them. */
  reason: string;
  evidenceExceptionIds: Uuid[];
  raisedAt: IsoDate;
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / DAY_MS);
}

/**
 * Turn exceptions into signals, per the tenant's `credit_signal_map`.
 *
 * Which types count as a credit signal at all is configuration, not code
 * (P1): an overpayment is an accounting chore in most organisations and a
 * warning sign in a few, and neither of them is wrong.
 */
export function assessExceptionSignals(
  exceptions: PaymentException[],
  policy: PaymentPolicy,
  asOf: IsoDate,
): CreditSignal[] {
  const signals: CreditSignal[] = [];
  const byParty = new Map<string, PaymentException[]>();

  for (const e of exceptions) {
    if (!e.partyId) continue;
    if (!policy.creditSignalTypes.includes(e.type)) continue;
    const bucket = byParty.get(e.partyId);
    if (bucket) bucket.push(e);
    else byParty.set(e.partyId, [e]);
  }

  for (const [partyId, all] of byParty) {
    const partyName = all[0]?.partyName ?? null;

    /* Repeated returned cheques inside the tenant's window ------------- */
    const recentReturns = all.filter(
      (e) => e.type === 'returned_cheque' && daysBetween(e.occurredAt, asOf) <= policy.chequeReturnWindowDays,
    );
    if (recentReturns.length >= policy.chequeReturnCountForWatchlist) {
      signals.push({
        partyId,
        partyName,
        code: 'repeated_returned_cheque',
        severity: 'critical',
        // Note what is not here: no order block. A human decides that.
        targets: ['risk_index', 'watchlist', 'credit_review', 'order_review', 'collection_escalation'],
        reason: `${recentReturns.length} returned cheques in ${policy.chequeReturnWindowDays} days, totalling ${round2(
          recentReturns.reduce((s, e) => s + e.amount, 0),
        )}`,
        evidenceExceptionIds: recentReturns.map((e) => e.exceptionId),
        raisedAt: asOf,
      });
    } else if (recentReturns.length === 1) {
      // One returned cheque is an event, not a pattern. It still reaches the
      // score and the watchlist, but it does not trigger a credit review —
      // a threshold that fires on every single bounce is one people learn to
      // ignore, and then the second one goes unnoticed too.
      signals.push({
        partyId,
        partyName,
        code: 'returned_cheque',
        severity: 'high',
        targets: ['risk_index', 'watchlist'],
        reason: `a cheque was returned on ${recentReturns[0]!.occurredAt} for ${round2(recentReturns[0]!.amount)}`,
        evidenceExceptionIds: [recentReturns[0]!.exceptionId],
        raisedAt: asOf,
      });
    }

    /* Failed transfers and reversals ----------------------------------- */
    const failures = all.filter((e) => e.type === 'failed_transfer' || e.type === 'reversal');
    const recentFailures = failures.filter(
      (e) => daysBetween(e.occurredAt, asOf) <= policy.chequeReturnWindowDays,
    );
    if (recentFailures.length >= 2) {
      signals.push({
        partyId,
        partyName,
        code: 'repeated_payment_failure',
        severity: 'high',
        targets: ['risk_index', 'watchlist', 'collection_escalation'],
        reason: `${recentFailures.length} failed or reversed payments in ${policy.chequeReturnWindowDays} days`,
        evidenceExceptionIds: recentFailures.map((e) => e.exceptionId),
        raisedAt: asOf,
      });
    }

    /* Nobody has closed it -------------------------------------------- */
    const stale = all.filter(
      (e) => e.status === 'open' && daysBetween(e.occurredAt, asOf) > policy.resolutionSlaDays,
    );
    if (stale.length > 0) {
      signals.push({
        partyId,
        partyName,
        code: 'unresolved_exception',
        severity: 'medium',
        targets: ['collection_escalation'],
        reason: `${stale.length} exception(s) open longer than the ${policy.resolutionSlaDays}-day resolution SLA`,
        evidenceExceptionIds: stale.map((e) => e.exceptionId),
        raisedAt: asOf,
      });
    }
  }

  const rank = { critical: 0, high: 1, medium: 2 };
  return signals.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface ExceptionSummary {
  openCount: number;
  openTotal: number;
  resolvedThisPeriod: number;
  slaBreaches: number;
  /** Money that arrived and belongs to nobody yet. Its own SLA in §4.14. */
  unidentifiedTotal: number;
  partiesSignalled: number;
  byType: { type: ExceptionType; open: number; total: number }[];
  oldestOpenDays: number;
}

export function summariseExceptions(
  exceptions: PaymentException[],
  signals: CreditSignal[],
  policy: PaymentPolicy,
  asOf: IsoDate,
): ExceptionSummary {
  const open = exceptions.filter((e) => e.status === 'open');
  const byType = new Map<ExceptionType, { open: number; total: number }>();
  for (const e of open) {
    const bucket = byType.get(e.type) ?? { open: 0, total: 0 };
    bucket.open += 1;
    bucket.total += e.amount;
    byType.set(e.type, bucket);
  }

  const slaFor = (e: PaymentException) =>
    e.type === 'unidentified_receipt' ? policy.unidentifiedReceiptSlaDays : policy.resolutionSlaDays;

  return {
    openCount: open.length,
    openTotal: round2(open.reduce((s, e) => s + e.amount, 0)),
    resolvedThisPeriod: exceptions.filter((e) => e.status === 'resolved').length,
    slaBreaches: open.filter((e) => daysBetween(e.occurredAt, asOf) > slaFor(e)).length,
    unidentifiedTotal: round2(
      open.filter((e) => e.type === 'unidentified_receipt').reduce((s, e) => s + e.amount, 0),
    ),
    partiesSignalled: new Set(signals.map((s) => s.partyId)).size,
    byType: [...byType.entries()]
      .map(([type, v]) => ({ type, open: v.open, total: round2(v.total) }))
      .sort((a, b) => b.total - a.total),
    oldestOpenDays: open.reduce((m, e) => Math.max(m, daysBetween(e.occurredAt, asOf)), 0),
  };
}

/**
 * The returned-cheque history a credit officer actually asks for: per
 * counterparty, over the whole record rather than the signal window.
 */
export function chequeReturnHistory(
  exceptions: PaymentException[],
): { partyId: Uuid; partyName: string | null; count: number; total: number; latest: IsoDate }[] {
  const byParty = new Map<string, { partyName: string | null; count: number; total: number; latest: IsoDate }>();
  for (const e of exceptions) {
    if (e.type !== 'returned_cheque' || !e.partyId) continue;
    const bucket = byParty.get(e.partyId) ?? {
      partyName: e.partyName,
      count: 0,
      total: 0,
      latest: e.occurredAt,
    };
    bucket.count += 1;
    bucket.total += e.amount;
    if (e.occurredAt > bucket.latest) bucket.latest = e.occurredAt;
    byParty.set(e.partyId, bucket);
  }
  return [...byParty.entries()]
    .map(([partyId, v]) => ({ partyId, ...v, total: round2(v.total) }))
    .sort((a, b) => b.count - a.count || b.total - a.total);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
