import type { PaymentPolicy } from '../tenant/profile';
import type { CurrencyCode, IsoDate, Uuid } from '../types/canonical';

/**
 * Module 13 — Payment & Receipt Monitoring.
 *
 * The gate of the whole Collect group. Modules 12, 14, 15 and 17 all need to
 * know whether the money arrived; a collections queue that does not is one that
 * tells a collector to chase a customer who paid yesterday, which is the
 * fastest way to lose the room.
 *
 * P8 governs everything here: the platform reads the *status* of money that has
 * already moved. It does not receive, transfer, clear or post anything back.
 *
 * The scope of this module is decided by what the source system can give, which
 * the adapter declares as `payment_grain`:
 *
 *   matched_to_invoice — the ERP already applied the receipt. We read it and
 *                        do not second-guess it.
 *   receipt_line       — amounts per line, no invoice link. We match.
 *   receipt_header     — a total per receipt. We match, less confidently.
 *   none               — no payment data at all; the module stays dark rather
 *                        than showing an empty screen that looks like "no one
 *                        has paid".
 *
 * The rule that keeps automatic matching safe: a rule must resolve to exactly
 * one open item. Two candidates is not a 50% match, it is an unanswered
 * question, and cash applied to the wrong invoice is worse than cash left
 * unapplied — the wrong invoice then looks paid and the right one goes to a
 * collector.
 */

export type PaymentGrain = 'none' | 'receipt_header' | 'receipt_line' | 'matched_to_invoice';

export type PaymentChannel = PaymentPolicy['channels'][number];

export type MatchRule = PaymentPolicy['matchingRules'][number] | 'source' | 'manual';

export interface IncomingPayment {
  paymentId: Uuid;
  partyId: Uuid | null;
  legalEntityCode: string;
  receiptRef: string;
  paymentDate: IsoDate;
  amount: number;
  currency: CurrencyCode;
  channel: PaymentChannel | string;
  /** Invoice number the source system already applied this to, when it did. */
  sourceDocumentNo: string | null;
  /** Whatever name the bank or the receipt carried. Often not our legal name. */
  payerName: string | null;
  reference: string | null;
}

export interface OpenItem {
  arItemId: Uuid;
  partyId: Uuid;
  legalEntityCode: string;
  documentNo: string;
  dueDate: IsoDate;
  amount: number;
  currency: CurrencyCode;
}

export interface PaymentApplication {
  paymentId: Uuid;
  arItemId: Uuid;
  appliedAmount: number;
  matchRule: MatchRule;
  /** How sure the rule is. `source` is 1: the ERP already decided. */
  confidence: number;
}

export type UnmatchedReason =
  | 'no_party'
  | 'no_open_item'
  | 'ambiguous'
  | 'outside_tolerance'
  | 'over_applied';

export interface UnmatchedPayment {
  payment: IncomingPayment;
  reason: UnmatchedReason;
  /** The open items the rules got as far as, so a human can finish the job. */
  candidates: { arItemId: Uuid; documentNo: string; amount: number; dueDate: IsoDate }[];
  note: string;
}

export interface MatchResult {
  applications: PaymentApplication[];
  unmatched: UnmatchedPayment[];
}

function withinAmountTolerance(a: number, b: number, policy: PaymentPolicy): boolean {
  const diff = Math.abs(a - b);
  return diff <= policy.amountTolerance || diff <= (Math.max(a, b) * policy.amountTolerancePct) / 100;
}

const DAY_MS = 86_400_000;

function dayDiff(a: string, b: string): number {
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((x - y) / DAY_MS));
}

function candidateSummary(items: OpenItem[]) {
  return items.slice(0, 8).map((i) => ({
    arItemId: i.arItemId,
    documentNo: i.documentNo,
    amount: i.amount,
    dueDate: i.dueDate,
  }));
}

/**
 * Apply receipts to open items.
 *
 * Rules are tried in the order the tenant configured them (§4.14
 * `matching_rule`). The first rule that resolves to exactly one candidate wins;
 * a rule that finds several stops the whole payment rather than falling through
 * to a looser rule, because a looser rule cannot resolve an ambiguity a
 * stricter one could not.
 */
export function matchPayments(
  payments: IncomingPayment[],
  openItems: OpenItem[],
  policy: PaymentPolicy,
  grain: PaymentGrain = 'receipt_header',
): MatchResult {
  const applications: PaymentApplication[] = [];
  const unmatched: UnmatchedPayment[] = [];

  const byDocumentNo = new Map<string, OpenItem[]>();
  const byParty = new Map<string, OpenItem[]>();
  for (const item of openItems) {
    const docKey = `${item.legalEntityCode}|${item.documentNo}`;
    const docBucket = byDocumentNo.get(docKey);
    if (docBucket) docBucket.push(item);
    else byDocumentNo.set(docKey, [item]);

    const partyKey = `${item.partyId}|${item.legalEntityCode}`;
    const partyBucket = byParty.get(partyKey);
    if (partyBucket) partyBucket.push(item);
    else byParty.set(partyKey, [item]);
  }

  for (const payment of payments) {
    // The ERP already did the work. Re-deriving it here would only create a
    // second opinion for somebody to reconcile.
    if (grain === 'matched_to_invoice' && payment.sourceDocumentNo) {
      const hit = byDocumentNo.get(`${payment.legalEntityCode}|${payment.sourceDocumentNo}`);
      if (hit && hit.length === 1) {
        applications.push({
          paymentId: payment.paymentId,
          arItemId: hit[0]!.arItemId,
          appliedAmount: Math.min(payment.amount, hit[0]!.amount),
          matchRule: 'source',
          confidence: 1,
        });
        continue;
      }
      unmatched.push({
        payment,
        reason: 'no_open_item',
        candidates: [],
        note: `the source applied this to ${payment.sourceDocumentNo}, which is not an open item here`,
      });
      continue;
    }

    // Money we cannot attribute to a counterparty is the §4.14
    // `unidentified_receipt` case, and it has its own SLA precisely because it
    // is the one that goes stale silently.
    if (!payment.partyId) {
      unmatched.push({
        payment,
        reason: 'no_party',
        candidates: [],
        note: payment.payerName
          ? `received from "${payment.payerName}", which is not a counterparty code we hold`
          : 'the receipt carries no counterparty',
      });
      continue;
    }

    const partyItems = byParty.get(`${payment.partyId}|${payment.legalEntityCode}`) ?? [];
    if (partyItems.length === 0) {
      unmatched.push({
        payment,
        reason: 'no_open_item',
        candidates: [],
        note: 'this counterparty has nothing open in this entity',
      });
      continue;
    }

    let applied = false;
    let lastAmbiguity: OpenItem[] | null = null;

    for (const rule of policy.matchingRules) {
      let candidates: OpenItem[] = [];

      if (rule === 'invoice_no') {
        if (!payment.sourceDocumentNo) continue;
        candidates = partyItems.filter((i) => i.documentNo === payment.sourceDocumentNo);
      } else if (rule === 'amount_and_date') {
        candidates = partyItems.filter(
          (i) =>
            withinAmountTolerance(i.amount, payment.amount, policy) &&
            dayDiff(i.dueDate, payment.paymentDate) <= policy.dateToleranceDays,
        );
      } else if (rule === 'party_and_amount') {
        candidates = partyItems.filter((i) => withinAmountTolerance(i.amount, payment.amount, policy));
      } else if (rule === 'party_and_reference') {
        if (!payment.reference) continue;
        const ref = payment.reference.toLowerCase();
        candidates = partyItems.filter((i) => ref.includes(i.documentNo.toLowerCase()));
      }

      if (candidates.length === 1) {
        const item = candidates[0]!;
        applications.push({
          paymentId: payment.paymentId,
          arItemId: item.arItemId,
          appliedAmount: Math.min(payment.amount, item.amount),
          matchRule: rule,
          // An invoice number is the source's own answer; an amount that
          // happens to agree is a coincidence that is usually right.
          confidence: rule === 'invoice_no' ? 0.95 : rule === 'amount_and_date' ? 0.8 : 0.6,
        });
        applied = true;
        break;
      }

      if (candidates.length > 1) {
        // Stop here. A looser rule cannot resolve what a stricter one could
        // not, and guessing puts cash on the wrong invoice.
        lastAmbiguity = candidates;
        break;
      }
    }

    if (applied) continue;

    if (lastAmbiguity) {
      unmatched.push({
        payment,
        reason: 'ambiguous',
        candidates: candidateSummary(lastAmbiguity),
        note: `${lastAmbiguity.length} open items fit equally well — applying it to one of them would make the others look unpaid`,
      });
      continue;
    }

    unmatched.push({
      payment,
      reason: 'outside_tolerance',
      candidates: candidateSummary(partyItems),
      note: `no open item is within ${policy.amountTolerance} / ${policy.amountTolerancePct}% and ${policy.dateToleranceDays} days`,
    });
  }

  return { applications, unmatched };
}

export interface PaymentMonitoringSummary {
  receiptCount: number;
  receiptTotal: number;
  matchedTotal: number;
  unappliedTotal: number;
  unidentifiedCount: number;
  unidentifiedTotal: number;
  ambiguousCount: number;
  /** Receipts held longer than the tenant's unidentified-receipt SLA. */
  slaBreaches: number;
  byChannel: { channel: string; count: number; total: number }[];
}

export function summarisePaymentMonitoring(
  payments: IncomingPayment[],
  applications: PaymentApplication[],
  unmatched: UnmatchedPayment[],
  policy: PaymentPolicy,
  asOf: IsoDate,
): PaymentMonitoringSummary {
  const appliedByPayment = new Map<string, number>();
  for (const a of applications) {
    appliedByPayment.set(a.paymentId, (appliedByPayment.get(a.paymentId) ?? 0) + a.appliedAmount);
  }

  const byChannel = new Map<string, { count: number; total: number }>();
  for (const p of payments) {
    const bucket = byChannel.get(p.channel) ?? { count: 0, total: 0 };
    bucket.count += 1;
    bucket.total += p.amount;
    byChannel.set(p.channel, bucket);
  }

  const unidentified = unmatched.filter((u) => u.reason === 'no_party');
  const receiptTotal = payments.reduce((s, p) => s + p.amount, 0);
  const matchedTotal = applications.reduce((s, a) => s + a.appliedAmount, 0);

  return {
    receiptCount: payments.length,
    receiptTotal: round2(receiptTotal),
    matchedTotal: round2(matchedTotal),
    unappliedTotal: round2(receiptTotal - matchedTotal),
    unidentifiedCount: unidentified.length,
    unidentifiedTotal: round2(unidentified.reduce((s, u) => s + u.payment.amount, 0)),
    ambiguousCount: unmatched.filter((u) => u.reason === 'ambiguous').length,
    slaBreaches: unidentified.filter(
      (u) => dayDiff(u.payment.paymentDate, asOf) > policy.unidentifiedReceiptSlaDays,
    ).length,
    byChannel: [...byChannel.entries()]
      .map(([channel, v]) => ({ channel, count: v.count, total: round2(v.total) }))
      .sort((a, b) => b.total - a.total),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CashBucket {
  label: string;
  fromDays: number;
  toDays: number | null;
  amount: number;
  itemCount: number;
}

/**
 * What is contractually due to arrive, by week.
 *
 * Deliberately built from due dates and confirmed promises only. It is not a
 * forecast and carries no probability: the moment a number like this acquires
 * a "likelihood", treasury starts planning against it and the platform has
 * quietly become something it is not.
 */
export function expectedCash(
  openItems: OpenItem[],
  promises: { partyId: Uuid; amount: number; promisedDate: IsoDate }[],
  asOf: IsoDate,
): { buckets: CashBucket[]; overdueAmount: number; promisedAmount: number } {
  const bands: { label: string; fromDays: number; toDays: number | null }[] = [
    { label: 'overdue', fromDays: -99999, toDays: -1 },
    { label: 'this_week', fromDays: 0, toDays: 7 },
    { label: 'next_week', fromDays: 8, toDays: 14 },
    { label: 'd15_30', fromDays: 15, toDays: 30 },
    { label: 'beyond_30', fromDays: 31, toDays: null },
  ];

  const buckets: CashBucket[] = bands.map((b) => ({ ...b, amount: 0, itemCount: 0 }));
  const asOfMs = Date.parse(asOf);

  const place = (dateStr: string, amount: number) => {
    const days = Math.round((Date.parse(dateStr) - asOfMs) / DAY_MS);
    const bucket = buckets.find((b) => days >= b.fromDays && (b.toDays === null || days <= b.toDays));
    if (!bucket) return;
    bucket.amount = round2(bucket.amount + amount);
    bucket.itemCount += 1;
  };

  for (const item of openItems) place(item.dueDate, item.amount);
  for (const promise of promises) place(promise.promisedDate, promise.amount);

  return {
    buckets,
    overdueAmount: buckets[0]!.amount,
    promisedAmount: round2(promises.reduce((s, p) => s + p.amount, 0)),
  };
}
