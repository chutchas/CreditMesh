import { describe, expect, it } from 'vitest';
import {
  assessExceptionSignals,
  chequeReturnHistory,
  createStarterProfile,
  summariseExceptions,
  type PaymentException,
} from '@creditmesh/core';

const policy = createStarterProfile('t', 'Demo').paymentPolicy;
const ASOF = '2026-09-03';

function exception(patch: Partial<PaymentException> & { exceptionId: string }): PaymentException {
  return {
    partyId: 'p1',
    partyName: 'Acme Trading',
    legalEntityCode: 'E01',
    type: 'returned_cheque',
    amount: 1_000_000,
    currency: 'THB',
    occurredAt: '2026-08-20',
    reasonCode: 'R01',
    reasonText: null,
    reference: 'CHQ-1',
    status: 'open',
    resolvedAt: null,
    source: 'bank',
    ...patch,
  };
}

describe('assessExceptionSignals', () => {
  it('never routes a signal to blocking an order', () => {
    // The most important assertion in this file. Two bounced cheques flag the
    // next order for a human; an automatic consequence built on one imperfect
    // feed will one day halt a good customer and nobody will find the rule.
    const signals = assessExceptionSignals(
      [
        exception({ exceptionId: 'e1', occurredAt: '2026-08-20' }),
        exception({ exceptionId: 'e2', reference: 'CHQ-2', occurredAt: '2026-09-01' }),
      ],
      policy,
      ASOF,
    );
    const targets = signals.flatMap((s) => s.targets);
    expect(targets).toContain('order_review');
    expect(targets).not.toContain('order_block');
  });

  it('escalates only once the tenant threshold is met', () => {
    const one = assessExceptionSignals([exception({ exceptionId: 'e1' })], policy, ASOF);
    expect(one[0]!.code).toBe('returned_cheque');
    // A single bounce reaches the score and the watchlist but does not demand
    // a credit review: a threshold that fires every time is one people learn
    // to ignore, and then the second one passes unnoticed too.
    expect(one[0]!.targets).not.toContain('credit_review');

    const two = assessExceptionSignals(
      [exception({ exceptionId: 'e1' }), exception({ exceptionId: 'e2', reference: 'CHQ-2' })],
      policy,
      ASOF,
    );
    expect(two[0]!.code).toBe('repeated_returned_cheque');
    expect(two[0]!.targets).toContain('credit_review');
  });

  it('counts only returns inside the tenant window', () => {
    const signals = assessExceptionSignals(
      [
        exception({ exceptionId: 'old', occurredAt: '2026-01-10' }),
        exception({ exceptionId: 'recent', reference: 'CHQ-2', occurredAt: '2026-09-01' }),
      ],
      policy,
      ASOF,
    );
    expect(signals[0]!.code).toBe('returned_cheque');
  });

  it('raises nothing for a type the tenant does not treat as a credit signal', () => {
    // An overpayment is an accounting chore in most organisations. Whether it
    // is a warning sign is configuration, not a rule in code.
    const signals = assessExceptionSignals(
      [exception({ exceptionId: 'e1', type: 'overpayment' })],
      policy,
      ASOF,
    );
    expect(signals).toHaveLength(0);
  });

  it('follows the tenant when it does treat one as a signal', () => {
    const custom = { ...policy, creditSignalTypes: [...policy.creditSignalTypes, 'overpayment'] };
    const signals = assessExceptionSignals(
      [exception({ exceptionId: 'e1', type: 'overpayment', occurredAt: '2026-07-01' })],
      custom,
      ASOF,
    );
    expect(signals.map((s) => s.code)).toContain('unresolved_exception');
  });

  it('leaves an exception nobody has attributed out of the signal path', () => {
    const signals = assessExceptionSignals(
      [exception({ exceptionId: 'e1', partyId: null })],
      policy,
      ASOF,
    );
    expect(signals).toHaveLength(0);
  });
});

describe('summariseExceptions', () => {
  it('applies the unidentified-receipt SLA separately from the general one', () => {
    const exceptions = [
      // 12 days old: past the 7-day resolution SLA.
      exception({ exceptionId: 'e1', occurredAt: '2026-08-22' }),
      // 4 days old: inside the 5-day unidentified SLA, so not a breach.
      exception({
        exceptionId: 'e2',
        type: 'unidentified_receipt',
        partyId: null,
        occurredAt: '2026-08-30',
        amount: 350_000,
        reference: 'RC-9',
      }),
    ];
    const s = summariseExceptions(exceptions, [], policy, ASOF);
    expect(s.openCount).toBe(2);
    expect(s.slaBreaches).toBe(1);
    expect(s.unidentifiedTotal).toBe(350_000);
  });
});

describe('chequeReturnHistory', () => {
  it('counts over the whole record, not the signal window', () => {
    const history = chequeReturnHistory([
      exception({ exceptionId: 'e1', occurredAt: '2025-02-10' }),
      exception({ exceptionId: 'e2', reference: 'CHQ-2', occurredAt: '2026-09-01', amount: 500_000 }),
      exception({ exceptionId: 'e3', type: 'reversal', reference: 'REV-1' }),
    ]);
    expect(history).toHaveLength(1);
    expect(history[0]!.count).toBe(2);
    expect(history[0]!.total).toBe(1_500_000);
    expect(history[0]!.latest).toBe('2026-09-01');
  });
});
