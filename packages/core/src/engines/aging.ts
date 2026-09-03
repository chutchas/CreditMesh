import type { ArItem, IsoDate, Money, PaymentBehavior } from '../types/canonical';
import type { AgingBucket, TenantProfile } from '../tenant/profile';

/**
 * Ageing and days-past-due.
 *
 * The DPD baseline is a tenant setting, not a constant: some organisations
 * count from the due date, others from the invoice date, and the same portfolio
 * produces materially different numbers under the two. Hard-coding it would
 * silently misstate every downstream figure for half of all tenants.
 */

const MS_PER_DAY = 86_400_000;

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

export type DpdDefinition = TenantProfile['creditPolicy']['dpdDefinition'];

/** Positive = overdue. Negative = not yet due. */
export function daysPastDue(item: ArItem, asOf: IsoDate, definition: DpdDefinition): number {
  const baseline = definition === 'from_invoice_date' ? item.documentDate : item.dueDate;
  const endpoint = item.clearedDate ?? asOf;
  return daysBetween(baseline, endpoint);
}

export function bucketFor(buckets: AgingBucket[], dpd: number): AgingBucket | null {
  return (
    buckets.find((b) => dpd >= b.fromDays && (b.toDays === null || dpd <= b.toDays)) ?? null
  );
}

export interface AgingRow {
  bucketCode: string;
  bucketLabel: string;
  amount: number;
  itemCount: number;
}

export interface AgingResult {
  currency: string;
  asOf: IsoDate;
  rows: AgingRow[];
  total: number;
  overdueTotal: number;
}

export function buildAging(
  items: ArItem[],
  profile: TenantProfile,
  asOf: IsoDate,
): AgingResult {
  const buckets = profile.creditPolicy.agingBuckets;
  const definition = profile.creditPolicy.dpdDefinition;
  const rows = new Map<string, AgingRow>(
    buckets.map((b) => [b.code, { bucketCode: b.code, bucketLabel: b.label, amount: 0, itemCount: 0 }]),
  );
  let total = 0;
  let overdueTotal = 0;

  for (const item of items) {
    if (!item.isOpen) continue;
    const dpd = daysPastDue(item, asOf, definition);
    const bucket = bucketFor(buckets, dpd);
    const amount = item.amountBase.amount;
    total += amount;
    if (daysBetween(item.dueDate, asOf) > 0) overdueTotal += amount;
    if (!bucket) continue;
    const row = rows.get(bucket.code)!;
    row.amount += amount;
    row.itemCount += 1;
  }

  return {
    currency: profile.identity.baseCurrency,
    asOf,
    rows: [...rows.values()],
    total,
    overdueTotal,
  };
}

/**
 * Payment behaviour from cleared items only. Open items say nothing about how
 * this counterparty pays — they say how long they have had the invoice.
 * Weighting by amount is deliberate: an unweighted mean lets a hundred prompt
 * small invoices bury one very late large one.
 */
export function summarisePaymentBehavior(
  tenantId: string,
  partyId: string,
  items: ArItem[],
  periodStart: IsoDate,
  periodEnd: IsoDate,
  definition: DpdDefinition,
): PaymentBehavior {
  const cleared = items.filter(
    (i) => i.clearedDate !== null && i.clearedDate >= periodStart && i.clearedDate <= periodEnd,
  );

  let weightedSum = 0;
  let weightTotal = 0;
  let maxDpd = 0;
  let onTime = 0;

  for (const item of cleared) {
    const dpd = daysPastDue(item, periodEnd, definition);
    const weight = Math.abs(item.amountBase.amount);
    weightedSum += dpd * weight;
    weightTotal += weight;
    if (dpd > maxDpd) maxDpd = dpd;
    if (daysBetween(item.dueDate, item.clearedDate!) <= 0) onTime += 1;
  }

  return {
    tenantId,
    partyId,
    periodStart,
    periodEnd,
    invoiceCount: cleared.length,
    weightedAvgDpd: weightTotal === 0 ? 0 : weightedSum / weightTotal,
    maxDpd,
    onTimePct: cleared.length === 0 ? 0 : (onTime / cleared.length) * 100,
  };
}

export function money(amount: number, currency: string): Money {
  return { amount, currency };
}

/**
 * Current delinquency, from OPEN items.
 *
 * summarisePaymentBehavior deliberately looks only at cleared items, because
 * how long someone has held an invoice is not how they pay. That reasoning is
 * only half right, and the half it gets wrong is the dangerous half: an invoice
 * 147 days past due and still unpaid is the strongest signal available, and
 * treating it as "no data" let a counterparty with the worst arrears in the
 * portfolio score as low risk on the strength of a four-year-old balance sheet.
 *
 * So arrears are their own measurement, taken from what is outstanding right
 * now, and they are scored separately from payment history.
 */
export interface DelinquencySummary {
  /** Worst days-past-due across open items; 0 when nothing is overdue. */
  maxOpenDpd: number;
  openTotal: number;
  openOverdue: number;
  /** Share of the open balance that is past due, 0–100. */
  overdueSharePct: number;
  overdueItemCount: number;
}

export function summariseDelinquency(
  items: ArItem[],
  asOf: IsoDate,
  definition: DpdDefinition,
): DelinquencySummary {
  let maxOpenDpd = 0;
  let openTotal = 0;
  let openOverdue = 0;
  let overdueItemCount = 0;

  for (const item of items) {
    if (!item.isOpen) continue;
    const amount = item.amountBase.amount;
    openTotal += amount;
    // Overdue is judged from the due date whatever the tenant's DPD baseline —
    // an invoice is late or it is not. The baseline only affects how late.
    if (daysBetween(item.dueDate, asOf) <= 0) continue;
    openOverdue += amount;
    overdueItemCount += 1;
    const dpd = daysPastDue(item, asOf, definition);
    if (dpd > maxOpenDpd) maxOpenDpd = dpd;
  }

  return {
    maxOpenDpd,
    openTotal,
    openOverdue,
    overdueSharePct: openTotal === 0 ? 0 : (openOverdue / openTotal) * 100,
    overdueItemCount,
  };
}
