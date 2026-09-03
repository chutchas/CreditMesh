import { describe, expect, it } from 'vitest';
import {
  buildAging,
  createStarterProfile,
  daysPastDue,
  summariseDelinquency,
  summarisePaymentBehavior,
  type ArItem,
} from '@creditmesh/core';

const profile = createStarterProfile('t', 'Demo');

function item(patch: Partial<ArItem> & { documentNo: string }): ArItem {
  return {
    id: patch.documentNo,
    tenantId: 't',
    partyId: 'p',
    legalEntityCode: 'E01',
    documentDate: '2026-06-01',
    dueDate: '2026-07-01',
    clearedDate: null,
    amount: { amount: 1000, currency: 'THB' },
    amountBase: { amount: 1000, currency: 'THB' },
    isOpen: true,
    sourceRef: 'test',
    ...patch,
  };
}

describe('daysPastDue', () => {
  const invoice = item({ documentNo: 'INV1', documentDate: '2026-06-01', dueDate: '2026-07-01' });

  it('counts from the due date under the default definition', () => {
    expect(daysPastDue(invoice, '2026-07-31', 'from_due_date')).toBe(30);
  });

  it('counts from the invoice date when the tenant defines it that way', () => {
    // Same invoice, same day, a different number — which is exactly why this is
    // a tenant setting and not a constant.
    expect(daysPastDue(invoice, '2026-07-31', 'from_invoice_date')).toBe(60);
  });

  it('is negative before the due date', () => {
    expect(daysPastDue(invoice, '2026-06-20', 'from_due_date')).toBeLessThan(0);
  });

  it('stops counting at the clearing date for a paid invoice', () => {
    const cleared = item({ documentNo: 'INV2', clearedDate: '2026-07-10' });
    expect(daysPastDue(cleared, '2026-12-31', 'from_due_date')).toBe(9);
  });
});

describe('buildAging', () => {
  it('places each open item in exactly one bucket and ignores cleared ones', () => {
    const result = buildAging(
      [
        item({ documentNo: 'A', dueDate: '2026-08-15' }),
        item({ documentNo: 'B', dueDate: '2026-07-15' }),
        item({ documentNo: 'C', dueDate: '2026-05-01' }),
        item({ documentNo: 'D', dueDate: '2026-01-01', clearedDate: '2026-02-01', isOpen: false }),
      ],
      profile,
      '2026-08-01',
    );

    expect(result.total).toBe(3000);
    const byCode = Object.fromEntries(result.rows.map((r) => [r.bucketCode, r.amount]));
    expect(byCode.not_due).toBe(1000);
    expect(byCode.d1_30).toBe(1000);
    expect(byCode.d90_plus).toBe(1000);
    // Every open item lands somewhere: buckets must tile the whole line.
    expect(result.rows.reduce((s, r) => s + r.amount, 0)).toBe(result.total);
  });

  it('counts only genuinely overdue money as overdue', () => {
    const result = buildAging(
      [item({ documentNo: 'A', dueDate: '2026-09-01' }), item({ documentNo: 'B', dueDate: '2026-07-01' })],
      profile,
      '2026-08-01',
    );
    expect(result.overdueTotal).toBe(1000);
  });
});

describe('summarisePaymentBehavior', () => {
  it('weights days-late by amount', () => {
    const result = summarisePaymentBehavior(
      't',
      'p',
      [
        item({ documentNo: 'small', dueDate: '2026-07-01', clearedDate: '2026-07-01', amountBase: { amount: 100, currency: 'THB' } }),
        item({ documentNo: 'large', dueDate: '2026-07-01', clearedDate: '2026-08-30', amountBase: { amount: 900, currency: 'THB' } }),
      ],
      '2026-01-01',
      '2026-12-31',
      'from_due_date',
    );

    expect(result.invoiceCount).toBe(2);
    // 60 days late on 900 dominates 0 days on 100: (0*100 + 60*900)/1000.
    expect(result.weightedAvgDpd).toBeCloseTo(54);
    expect(result.maxDpd).toBe(60);
    expect(result.onTimePct).toBe(50);
  });

  it('reports nothing from open items alone', () => {
    const result = summarisePaymentBehavior('t', 'p', [item({ documentNo: 'open' })], '2026-01-01', '2026-12-31', 'from_due_date');
    expect(result.invoiceCount).toBe(0);
    expect(result.weightedAvgDpd).toBe(0);
  });
});

describe('summariseDelinquency', () => {
  it('measures the worst open item and the share of the book that is late', () => {
    const result = summariseDelinquency(
      [
        item({ documentNo: 'late', dueDate: '2026-04-09', amountBase: { amount: 5_900_000, currency: 'THB' } }),
        item({ documentNo: 'current', dueDate: '2026-10-01', amountBase: { amount: 100_000, currency: 'THB' } }),
      ],
      '2026-09-03',
      'from_due_date',
    );

    expect(result.maxOpenDpd).toBe(147);
    expect(result.openOverdue).toBe(5_900_000);
    expect(result.openTotal).toBe(6_000_000);
    expect(result.overdueSharePct).toBeCloseTo(98.33, 1);
    expect(result.overdueItemCount).toBe(1);
  });

  it('ignores cleared items — arrears are what is outstanding now', () => {
    const result = summariseDelinquency(
      [item({ documentNo: 'paid', dueDate: '2026-01-01', clearedDate: '2026-06-01', isOpen: false })],
      '2026-09-03',
      'from_due_date',
    );
    expect(result.maxOpenDpd).toBe(0);
    expect(result.openTotal).toBe(0);
  });

  it('reports nothing overdue when everything is within terms', () => {
    const result = summariseDelinquency(
      [item({ documentNo: 'a', dueDate: '2026-10-01' })],
      '2026-09-03',
      'from_due_date',
    );
    expect(result.maxOpenDpd).toBe(0);
    expect(result.overdueSharePct).toBe(0);
  });

  it('counts an item as overdue from its due date even when DPD runs from the invoice date', () => {
    // The baseline changes how late something is, never whether it is late.
    const result = summariseDelinquency(
      [item({ documentNo: 'a', documentDate: '2026-06-01', dueDate: '2026-10-01' })],
      '2026-09-03',
      'from_invoice_date',
    );
    expect(result.overdueItemCount).toBe(0);
  });
});
