import { describe, expect, it } from 'vitest';
import {
  buildExpiryAlerts,
  computeBalances,
  computeCoverage,
  createStarterProfile,
  summariseCollateral,
  type AllocationRecord,
  type CollateralRecord,
} from '@creditmesh/core';

const profile = createStarterProfile('t', 'Demo');
const asOf = '2026-09-03';

function instrument(patch: Partial<CollateralRecord> & { id: string }): CollateralRecord {
  return {
    partyId: 'party-1',
    partyName: 'Acme Trading',
    type: 'bank_guarantee',
    direction: 'inbound',
    reference: patch.id,
    issuer: 'A Bank',
    amount: 1_000_000,
    currency: 'THB',
    effectiveDate: '2025-01-01',
    expiryDate: '2027-01-01',
    claimDeadline: null,
    status: 'active',
    ...patch,
  };
}

function allocation(patch: Partial<AllocationRecord> & { collateralId: string }): AllocationRecord {
  return {
    legalEntityCode: 'E01',
    allocated: 500_000,
    utilized: 400_000,
    validFrom: '2025-01-01',
    validTo: null,
    ...patch,
  };
}

describe('computeBalances', () => {
  it('adds up allocation across entities against one instrument', () => {
    // The case the product exists for: one guarantee, two legal entities, and
    // nobody able to say what is left.
    const [balance] = computeBalances(
      [instrument({ id: 'BG-1', amount: 4_000_000 })],
      [
        allocation({ collateralId: 'BG-1', legalEntityCode: 'E01', allocated: 2_500_000, utilized: 2_480_000 }),
        allocation({ collateralId: 'BG-1', legalEntityCode: 'E02', allocated: 1_500_000, utilized: 1_500_000 }),
      ],
      { asOf },
    );

    expect(balance!.allocatedTotal).toBe(4_000_000);
    expect(balance!.utilizedTotal).toBe(3_980_000);
    expect(balance!.unallocated).toBe(0);
    expect(balance!.isOverAllocated).toBe(false);
  });

  it('flags allocation beyond face value as critical', () => {
    const [balance] = computeBalances(
      [instrument({ id: 'BG-2', amount: 1_500_000 })],
      [allocation({ collateralId: 'BG-2', allocated: 1_600_000, utilized: 640_000 })],
      { asOf },
    );

    expect(balance!.isOverAllocated).toBe(true);
    const warning = balance!.warnings.find((w) => w.code === 'over_allocated');
    expect(warning?.severity).toBe('critical');
    expect(warning?.detail.excess).toBe(100_000);
  });

  it('respects a tenant that permits over-allocation', () => {
    const [balance] = computeBalances(
      [instrument({ id: 'BG-2', amount: 1_500_000 })],
      [allocation({ collateralId: 'BG-2', allocated: 1_600_000 })],
      { asOf, allowOverAllocation: true },
    );
    expect(balance!.warnings.some((w) => w.code === 'over_allocated')).toBe(false);
    // Still true as a fact; only the warning is a policy question.
    expect(balance!.isOverAllocated).toBe(true);
  });

  it('flags a closed claim window on an instrument still marked active', () => {
    // Distinct from expiry, and a pure cash loss: the guarantee is gone and
    // nobody notices until they try to call on it.
    const [balance] = computeBalances(
      [instrument({ id: 'BG-3', expiryDate: '2026-06-30', claimDeadline: '2026-07-30' })],
      [allocation({ collateralId: 'BG-3' })],
      { asOf },
    );
    expect(balance!.warnings.map((w) => w.code)).toContain('claim_window_closed');
    expect(balance!.isEffective).toBe(false);
  });

  it('reports an allocation nobody draws on', () => {
    const [balance] = computeBalances(
      [instrument({ id: 'CD-1', amount: 800_000 })],
      [allocation({ collateralId: 'CD-1', allocated: 800_000, utilized: 0 })],
      { asOf },
    );
    expect(balance!.idle).toBe(800_000);
    expect(balance!.warnings.map((w) => w.code)).toContain('idle_allocation');
  });

  it('ignores an allocation that has lapsed', () => {
    const [balance] = computeBalances(
      [instrument({ id: 'BG-4' })],
      [allocation({ collateralId: 'BG-4', validTo: '2026-01-31' })],
      { asOf },
    );
    expect(balance!.allocatedTotal).toBe(0);
    expect(balance!.unallocated).toBe(1_000_000);
  });

  it('does not treat outbound collateral as protection', () => {
    // We posted it to them. It is our obligation, not our cover, and adding it
    // in would overstate coverage by the whole outbound book.
    const [balance] = computeBalances([instrument({ id: 'BG-5', direction: 'outbound' })], [], { asOf });
    expect(balance!.isEffective).toBe(false);
  });
});

describe('buildExpiryAlerts', () => {
  it('places each instrument in the tenant’s own alert band', () => {
    const balances = computeBalances(
      [
        instrument({ id: 'SOON', expiryDate: '2026-09-20' }),
        instrument({ id: 'LATER', expiryDate: '2026-11-15' }),
        instrument({ id: 'FAR', expiryDate: '2028-01-01' }),
      ],
      [],
      { asOf },
    );
    const alerts = buildExpiryAlerts(balances, profile, asOf);

    expect(alerts.map((a) => a.reference)).toEqual(['SOON', 'LATER']);
    expect(alerts[0]!.daysRemaining).toBe(17);
    expect(alerts[0]!.band).toBe(30);
    expect(alerts[1]!.band).toBe(90);
  });

  it('keeps an already-expired instrument at the top rather than dropping it', () => {
    const balances = computeBalances([instrument({ id: 'GONE', expiryDate: '2026-08-01' })], [], { asOf });
    const alerts = buildExpiryAlerts(balances, profile, asOf);
    expect(alerts[0]!.daysRemaining).toBeLessThan(0);
    expect(alerts[0]!.band).toBe(7);
  });

  it('says nothing about an instrument with no expiry', () => {
    const balances = computeBalances([instrument({ id: 'CASH', expiryDate: null })], [], { asOf });
    expect(buildExpiryAlerts(balances, profile, asOf)).toEqual([]);
  });
});

describe('computeCoverage', () => {
  const balances = computeBalances(
    [instrument({ id: 'BG-1', amount: 4_000_000 })],
    [
      allocation({ collateralId: 'BG-1', legalEntityCode: 'E01', allocated: 2_500_000, utilized: 2_480_000 }),
      allocation({ collateralId: 'BG-1', legalEntityCode: 'E02', allocated: 1_500_000, utilized: 1_500_000 }),
    ],
    { asOf },
  );
  const names = new Map([['party-1', 'Acme Trading']]);

  it('leaves an unused allocation in one entity out of another entity’s cover', () => {
    // Collapsing to the counterparty would show this party as fully covered.
    const coverage = computeCoverage(
      [
        { partyId: 'party-1', legalEntityCode: 'E01', exposure: 2_480_000 },
        { partyId: 'party-1', legalEntityCode: 'E02', exposure: 3_100_000 },
      ],
      balances,
      names,
    );

    const e02 = coverage.find((c) => c.legalEntityCode === 'E02')!;
    expect(e02.collateralAllocated).toBe(1_500_000);
    expect(e02.uncovered).toBe(1_600_000);

    const e01 = coverage.find((c) => c.legalEntityCode === 'E01')!;
    expect(e01.uncovered).toBe(0);
  });

  it('counts nothing from an instrument that is no longer effective', () => {
    const expired = computeBalances(
      [instrument({ id: 'BG-9', expiryDate: '2026-01-01' })],
      [allocation({ collateralId: 'BG-9', allocated: 900_000 })],
      { asOf },
    );
    const coverage = computeCoverage([{ partyId: 'party-1', legalEntityCode: 'E01', exposure: 900_000 }], expired, names);
    expect(coverage[0]!.uncovered).toBe(900_000);
  });

  it('sorts the most exposed and least protected to the top', () => {
    const coverage = computeCoverage(
      [
        { partyId: 'party-1', legalEntityCode: 'E01', exposure: 100_000 },
        { partyId: 'party-1', legalEntityCode: 'E02', exposure: 3_100_000 },
      ],
      balances,
      names,
    );
    expect(coverage[0]!.legalEntityCode).toBe('E02');
  });
});

describe('summariseCollateral', () => {
  it('reports utilisation and uncovered exposure — the two figures §12 asks for', () => {
    const balances = computeBalances(
      [
        instrument({ id: 'BG-1', amount: 4_000_000 }),
        instrument({ id: 'CD-1', amount: 800_000 }),
        instrument({ id: 'OUT-1', amount: 2_000_000, direction: 'outbound' }),
      ],
      [
        allocation({ collateralId: 'BG-1', allocated: 4_000_000, utilized: 3_000_000 }),
        allocation({ collateralId: 'CD-1', allocated: 800_000, utilized: 0 }),
      ],
      { asOf },
    );
    const coverage = computeCoverage(
      [{ partyId: 'party-1', legalEntityCode: 'E01', exposure: 6_000_000 }],
      balances,
      new Map([['party-1', 'Acme Trading']]),
    );
    const summary = summariseCollateral(balances, coverage, 'THB', asOf);

    // Outbound is excluded from everything: 4.0M + 0.8M held, not 6.8M.
    expect(summary.totalValue).toBe(4_800_000);
    expect(summary.utilizationPct).toBeCloseTo(62.5);
    expect(summary.idleTotal).toBe(1_800_000);
    expect(summary.uncoveredExposure).toBe(1_200_000);
    expect(summary.coveredExposure).toBe(4_800_000);
    expect(summary.evidence[0]!.detail?.instrumentsExcluded).toBe(1);
  });
});
