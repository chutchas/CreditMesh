import { describe, expect, it } from 'vitest';
import {
  canWaive,
  computeLateCharge,
  createStarterProfile,
  rateFor,
  runLateCharges,
  waiverReport,
  type ChargeableItem,
  type LateChargePolicy,
} from '@creditmesh/core';

const basePolicy = createStarterProfile('t', 'Demo').lateChargePolicy;
const ASOF = '2026-09-03';

function item(patch: Partial<ChargeableItem> & { arItemId: string }): ChargeableItem {
  return {
    partyId: 'p1',
    partyName: 'Acme Trading',
    legalEntityCode: 'E01',
    documentNo: 'INV-1',
    documentDate: '2026-05-01',
    dueDate: '2026-05-31',
    clearedDate: null,
    amount: 1_000_000,
    currency: 'THB',
    segment: null,
    gradeCode: null,
    ...patch,
  };
}

describe('rateFor', () => {
  const policy: LateChargePolicy = {
    ...basePolicy,
    rates: [
      { annualRatePct: 12, effectiveFrom: '2020-01-01', effectiveTo: '2025-12-31', segment: null, gradeCode: null },
      { annualRatePct: 15, effectiveFrom: '2026-01-01', effectiveTo: null, segment: null, gradeCode: null },
      { annualRatePct: 18, effectiveFrom: '2026-01-01', effectiveTo: null, segment: null, gradeCode: 'E' },
    ],
  };

  it('uses the rate in force on the day, not today’s rate', () => {
    // The whole reason rates carry periods: recomputing 2025 has to reproduce
    // what was billed in 2025, or the reconciliation gate in §7 cannot pass.
    expect(rateFor(policy, '2025-06-01', null, null)?.annualRatePct).toBe(12);
    expect(rateFor(policy, '2026-06-01', null, null)?.annualRatePct).toBe(15);
  });

  it('prefers a more specific rate over the house rate', () => {
    expect(rateFor(policy, '2026-06-01', null, 'E')?.annualRatePct).toBe(18);
    expect(rateFor(policy, '2026-06-01', null, 'A')?.annualRatePct).toBe(15);
  });

  it('returns null when no rate covers the date', () => {
    expect(rateFor(policy, '2019-01-01', null, null)).toBeNull();
  });
});

describe('computeLateCharge', () => {
  it('keeps every input beside the amount', () => {
    const result = computeLateCharge(item({ arItemId: 'a1' }), basePolicy, ASOF);
    expect('line' in result).toBe(true);
    if (!('line' in result)) return;
    const l = result.line;
    // Due 31 May, as of 3 Sep = 95 days, less the 7-day grace = 88.
    expect(l.lateDays).toBe(88);
    expect(l.principal).toBe(1_000_000);
    expect(l.annualRatePct).toBe(15);
    expect(l.rateEffectiveFrom).toBe('2020-01-01');
    expect(l.dayCount).toBe(365);
    expect(l.gracePeriodDays).toBe(7);
    // 1,000,000 x 15% x 88 / 365 = 36,164.38, rounded to the nearest 1.
    expect(l.chargeAmount).toBe(36_164);
  });

  it('charges to the payment date once an item has cleared', () => {
    const result = computeLateCharge(item({ arItemId: 'a1', clearedDate: '2026-07-01' }), basePolicy, ASOF);
    if (!('line' in result)) throw new Error('expected a charge');
    expect(result.line.chargeTo).toBe('2026-07-01');
    expect(result.line.lateDays).toBe(24);
  });

  it('says why an item was skipped instead of dropping it', () => {
    const notDue = computeLateCharge(item({ arItemId: 'a1', dueDate: '2026-12-31' }), basePolicy, ASOF);
    expect('skipped' in notDue && notDue.skipped.reason).toBe('not_overdue');

    const inGrace = computeLateCharge(item({ arItemId: 'a2', dueDate: '2026-08-30' }), basePolicy, ASOF);
    expect('skipped' in inGrace && inGrace.skipped.reason).toBe('in_grace');

    const tiny = computeLateCharge(item({ arItemId: 'a3', amount: 1_000, dueDate: '2026-08-20' }), basePolicy, ASOF);
    expect('skipped' in tiny && tiny.skipped.reason).toBe('below_minimum');

    const excluded = computeLateCharge(
      item({ arItemId: 'a4' }),
      { ...basePolicy, excludedPartyIds: ['p1'] },
      ASOF,
    );
    expect('skipped' in excluded && excluded.skipped.reason).toBe('excluded_party');
  });

  it('follows the tenant’s day count and charge start', () => {
    const from360 = computeLateCharge(item({ arItemId: 'a1' }), { ...basePolicy, dayCountConvention: '360' }, ASOF);
    if (!('line' in from360)) throw new Error('expected a charge');
    expect(from360.line.dayCount).toBe(360);

    const fromInvoice = computeLateCharge(
      item({ arItemId: 'a2' }),
      { ...basePolicy, chargeStartFrom: 'invoice_date' },
      ASOF,
    );
    if (!('line' in fromInvoice)) throw new Error('expected a charge');
    expect(fromInvoice.line.chargeFrom).toBe('2026-05-01');
  });

  it('reproduces a past period exactly when rerun', () => {
    // §7 makes this the delivery gate: recompute three months and reconcile.
    const first = computeLateCharge(item({ arItemId: 'a1' }), basePolicy, '2026-07-31');
    const second = computeLateCharge(item({ arItemId: 'a1' }), basePolicy, '2026-07-31');
    expect(first).toEqual(second);
  });
});

describe('runLateCharges', () => {
  it('records the policy it ran under', () => {
    const result = runLateCharges([item({ arItemId: 'a1' })], basePolicy, ASOF);
    expect(result.policySnapshot.dayCountConvention).toBe('365');
    expect(result.policySnapshot.gracePeriodDays).toBe(7);
    expect(result.total).toBe(36_164);
  });
});

describe('waiverReport', () => {
  it('reports what was given away, to whom, by whom', () => {
    const report = waiverReport(
      [
        { partyId: 'p1', partyName: 'Acme', amount: 40_000, approvedByLabel: 'somchai@x', reason: 'goodwill', waivedAt: '2026-08-01' },
        { partyId: 'p1', partyName: 'Acme', amount: 10_000, approvedByLabel: 'somchai@x', reason: 'goodwill', waivedAt: '2026-08-20' },
        { partyId: 'p2', partyName: 'Beta', amount: 25_000, approvedByLabel: null, reason: null, waivedAt: '2026-08-05' },
      ],
      175_000,
    );
    expect(report.waivedTotal).toBe(75_000);
    expect(report.waivedSharePct).toBe(30);
    expect(report.byApprover[0]).toEqual({ approver: 'somchai@x', count: 2, amount: 50_000 });
    // A waiver nobody is recorded against is still counted, under a name that
    // says so rather than being dropped from the report.
    expect(report.byApprover.find((a) => a.approver === 'unattributed')?.amount).toBe(25_000);
  });
});

describe('canWaive', () => {
  it('treats an unconfigured authority as no authority', () => {
    // Silence is not permission. Reading it as permission makes the waiver
    // report meaningless in its first month.
    expect(canWaive(basePolicy, 'credit_manager', 1_000).allowed).toBe(false);
  });

  it('applies the configured limit', () => {
    const policy = {
      ...basePolicy,
      waiverAuthority: [
        { role: 'credit_officer', maxAmount: 50_000 },
        { role: 'credit_manager', maxAmount: null },
      ],
    };
    expect(canWaive(policy, 'credit_officer', 40_000).allowed).toBe(true);
    expect(canWaive(policy, 'credit_officer', 60_000).allowed).toBe(false);
    expect(canWaive(policy, 'credit_manager', 5_000_000).allowed).toBe(true);
  });
});
