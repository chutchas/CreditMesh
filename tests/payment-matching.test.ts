import { describe, expect, it } from 'vitest';
import {
  createStarterProfile,
  expectedCash,
  matchPayments,
  summarisePaymentMonitoring,
  type IncomingPayment,
  type OpenItem,
} from '@creditmesh/core';

const policy = createStarterProfile('t', 'Demo').paymentPolicy;
const ASOF = '2026-09-03';

function payment(patch: Partial<IncomingPayment> = {}): IncomingPayment {
  return {
    paymentId: 'pay-1',
    partyId: 'p1',
    legalEntityCode: 'E01',
    receiptRef: 'RC-1',
    paymentDate: '2026-08-20',
    amount: 1_000_000,
    currency: 'THB',
    channel: 'bank_transfer',
    sourceDocumentNo: null,
    payerName: null,
    reference: null,
    ...patch,
  };
}

function item(patch: Partial<OpenItem> & { arItemId: string }): OpenItem {
  return {
    partyId: 'p1',
    legalEntityCode: 'E01',
    documentNo: 'INV-1',
    dueDate: '2026-08-20',
    amount: 1_000_000,
    currency: 'THB',
    ...patch,
  };
}

describe('matchPayments', () => {
  it('reads the source application instead of re-deriving it', () => {
    const { applications } = matchPayments(
      [payment({ sourceDocumentNo: 'INV-1' })],
      [item({ arItemId: 'a1' }), item({ arItemId: 'a2', documentNo: 'INV-2' })],
      policy,
      'matched_to_invoice',
    );
    expect(applications).toHaveLength(1);
    expect(applications[0]!.matchRule).toBe('source');
    expect(applications[0]!.confidence).toBe(1);
  });

  it('refuses to apply a receipt that fits two open items equally', () => {
    // The failure this guard exists for: pick one and the other looks unpaid,
    // and a collector calls a customer who settled it last week.
    const { applications, unmatched } = matchPayments(
      [payment()],
      [
        item({ arItemId: 'a1', documentNo: 'INV-1' }),
        item({ arItemId: 'a2', documentNo: 'INV-2' }),
      ],
      policy,
    );
    expect(applications).toHaveLength(0);
    expect(unmatched[0]!.reason).toBe('ambiguous');
    expect(unmatched[0]!.candidates).toHaveLength(2);
  });

  it('does not fall through to a looser rule after an ambiguity', () => {
    // amount_and_date finds two; party_and_amount would find the same two.
    // Trying it anyway would only produce the same ambiguity with less
    // information, or worse, a different arbitrary winner.
    const { unmatched } = matchPayments(
      [payment()],
      [item({ arItemId: 'a1' }), item({ arItemId: 'a2', documentNo: 'INV-2' })],
      policy,
    );
    expect(unmatched[0]!.reason).toBe('ambiguous');
  });

  it('keeps an unattributable receipt instead of guessing a counterparty', () => {
    const { unmatched } = matchPayments(
      [payment({ partyId: null, payerName: 'SIAM METAL WORK CO.' })],
      [item({ arItemId: 'a1' })],
      policy,
    );
    expect(unmatched[0]!.reason).toBe('no_party');
    expect(unmatched[0]!.note).toContain('SIAM METAL WORK CO.');
  });

  it('applies within the tenant tolerance and refuses outside it', () => {
    const inside = matchPayments([payment({ amount: 999_999.5 })], [item({ arItemId: 'a1' })], policy);
    expect(inside.applications).toHaveLength(1);

    const outside = matchPayments([payment({ amount: 400_000 })], [item({ arItemId: 'a1' })], policy);
    expect(outside.applications).toHaveLength(0);
    expect(outside.unmatched[0]!.reason).toBe('outside_tolerance');
  });

  it('never applies more than the open item is worth', () => {
    const { applications } = matchPayments(
      [payment({ amount: 1_200_000, sourceDocumentNo: 'INV-1' })],
      [item({ arItemId: 'a1', amount: 1_000_000 })],
      policy,
      'matched_to_invoice',
    );
    expect(applications[0]!.appliedAmount).toBe(1_000_000);
  });

  it('ranks confidence by how much the rule actually knew', () => {
    const byInvoice = matchPayments(
      [payment({ sourceDocumentNo: 'INV-1', amount: 500_000 })],
      [item({ arItemId: 'a1', amount: 500_000 })],
      policy,
    );
    const byAmount = matchPayments([payment({ amount: 1_000_000 })], [item({ arItemId: 'a1' })], policy);
    expect(byInvoice.applications[0]!.confidence).toBeGreaterThan(byAmount.applications[0]!.confidence);
  });

  it('says the source pointed at an invoice we do not hold', () => {
    const { unmatched } = matchPayments(
      [payment({ sourceDocumentNo: 'INV-999' })],
      [item({ arItemId: 'a1' })],
      policy,
      'matched_to_invoice',
    );
    expect(unmatched[0]!.reason).toBe('no_open_item');
    expect(unmatched[0]!.note).toContain('INV-999');
  });
});

describe('summarisePaymentMonitoring', () => {
  it('counts unidentified money and its SLA breaches separately', () => {
    const payments = [
      payment({ paymentId: 'p-old', partyId: null, amount: 350_000, paymentDate: '2026-08-01' }),
      payment({ paymentId: 'p-new', partyId: null, amount: 120_000, paymentDate: '2026-09-02' }),
    ];
    const { unmatched } = matchPayments(payments, [], policy);
    const s = summarisePaymentMonitoring(payments, [], unmatched, policy, ASOF);
    expect(s.unidentifiedCount).toBe(2);
    expect(s.unidentifiedTotal).toBe(470_000);
    // Only the one older than the 5-day SLA.
    expect(s.slaBreaches).toBe(1);
  });
});

describe('expectedCash', () => {
  it('separates what is already overdue from what is still to fall due', () => {
    const cash = expectedCash(
      [
        item({ arItemId: 'a1', dueDate: '2026-07-01', amount: 500_000 }),
        item({ arItemId: 'a2', dueDate: '2026-09-05', amount: 300_000 }),
        item({ arItemId: 'a3', dueDate: '2026-10-20', amount: 900_000 }),
      ],
      [{ partyId: 'p1', amount: 200_000, promisedDate: '2026-09-12' }],
      ASOF,
    );
    expect(cash.overdueAmount).toBe(500_000);
    expect(cash.buckets.find((b) => b.label === 'this_week')!.amount).toBe(300_000);
    // A confirmed promise sits in the window it was promised for, alongside
    // the invoices that fall due there.
    expect(cash.buckets.find((b) => b.label === 'next_week')!.amount).toBe(200_000);
    expect(cash.buckets.find((b) => b.label === 'beyond_30')!.amount).toBe(900_000);
    expect(cash.promisedAmount).toBe(200_000);
  });

  it('puts the boundary day in the earlier window', () => {
    // Day 7 is "within 7 days", not "8-14". Worth pinning: a boundary that
    // drifts moves money between two buckets somebody reads every morning.
    const cash = expectedCash(
      [item({ arItemId: 'a1', dueDate: '2026-09-10', amount: 100_000 })],
      [],
      ASOF,
    );
    expect(cash.buckets.find((b) => b.label === 'this_week')!.amount).toBe(100_000);
    expect(cash.buckets.find((b) => b.label === 'next_week')!.amount).toBe(0);
  });
});
