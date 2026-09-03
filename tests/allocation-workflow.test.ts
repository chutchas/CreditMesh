import { describe, expect, it } from 'vitest';
import {
  allocationChangesFor,
  approvalChainFor,
  canApply,
  computeBalances,
  createStarterProfile,
  evaluateChain,
  proposeAllocation,
  summariseWorkflow,
  validateAllocationRequest,
  type AllocationRecord,
  type AllocationRequest,
  type ApprovalRecord,
  type CollateralRecord,
} from '@creditmesh/core';

const profile = createStarterProfile('t', 'Demo');
const policy = profile.collateralPolicy;
const ASOF = '2026-09-03';

function instrument(patch: Partial<CollateralRecord> = {}): CollateralRecord {
  return {
    id: 'c1',
    partyId: 'p1',
    partyName: 'Acme Trading',
    type: 'bank_guarantee',
    direction: 'inbound',
    reference: 'BG-1',
    issuer: 'Bank',
    amount: 5_000_000,
    currency: 'THB',
    effectiveDate: '2025-01-01',
    expiryDate: '2027-01-01',
    claimDeadline: null,
    status: 'active',
    ...patch,
  };
}

function allocation(patch: Partial<AllocationRecord> & { legalEntityCode: string }): AllocationRecord {
  return {
    collateralId: 'c1',
    allocated: 0,
    utilized: 0,
    validFrom: '2025-01-01',
    validTo: null,
    ...patch,
  };
}

function balanceOf(collateral: CollateralRecord, allocations: AllocationRecord[]) {
  return computeBalances([collateral], allocations, { asOf: ASOF, allowOverAllocation: policy.allowOverAllocation })[0]!;
}

describe('validateAllocationRequest', () => {
  it('refuses to move value that is already drawn', () => {
    // The rule this whole module exists to hold. E01 has 3M allocated with 2.5M
    // drawn — the drawn part is covering a balance that exists, and moving it
    // would leave that balance uncovered without anyone deciding to.
    const balance = balanceOf(instrument(), [
      allocation({ legalEntityCode: 'E01', allocated: 3_000_000, utilized: 2_500_000 }),
    ]);
    const result = validateAllocationRequest(
      { collateralId: 'c1', fromEntityCode: 'E01', toEntityCode: 'E02', amount: 1_000_000 },
      balance,
      policy,
      ASOF,
    );
    expect(result.ok).toBe(false);
    expect(result.refusals.map((r) => r.code)).toContain('exceeds_undrawn');
    expect(result.refusals.find((r) => r.code === 'exceeds_undrawn')!.detail).toContain('500000 undrawn');
  });

  it('allows exactly the undrawn amount', () => {
    const balance = balanceOf(instrument(), [
      allocation({ legalEntityCode: 'E01', allocated: 3_000_000, utilized: 2_500_000 }),
    ]);
    const result = validateAllocationRequest(
      { collateralId: 'c1', fromEntityCode: 'E01', toEntityCode: 'E02', amount: 500_000 },
      balance,
      policy,
      ASOF,
    );
    expect(result.ok).toBe(true);
    expect(result.effect).toEqual({
      sourceAllocatedAfter: 2_500_000,
      sourceUndrawnAfter: 0,
      targetAllocatedAfter: 500_000,
      instrumentUnallocatedAfter: 2_000_000,
    });
  });

  it('never allocates outbound collateral', () => {
    // It is our obligation to a counterparty, not cover we hold.
    const balance = balanceOf(instrument({ direction: 'outbound' }), []);
    const result = validateAllocationRequest(
      { collateralId: 'c1', fromEntityCode: null, toEntityCode: 'E01', amount: 100_000 },
      balance,
      policy,
      ASOF,
    );
    expect(result.refusals.map((r) => r.code)).toContain('outbound_instrument');
  });

  it('refuses an instrument whose claim window has closed even while it looks live', () => {
    // Inside its validity, past its claim deadline: it looks live on the
    // register and nothing can be recovered under it.
    const balance = balanceOf(instrument({ claimDeadline: '2026-08-01' }), []);
    const result = validateAllocationRequest(
      { collateralId: 'c1', fromEntityCode: null, toEntityCode: 'E01', amount: 100_000 },
      balance,
      policy,
      ASOF,
    );
    expect(result.refusals.map((r) => r.code)).toContain('claim_window_closed');
  });

  it('reports every refusal at once rather than the first', () => {
    const balance = balanceOf(instrument({ direction: 'outbound', status: 'expired' }), []);
    const result = validateAllocationRequest(
      { collateralId: 'c1', fromEntityCode: 'E01', toEntityCode: 'E01', amount: -5 },
      balance,
      policy,
      ASOF,
    );
    expect(result.refusals.length).toBeGreaterThan(3);
    expect(result.effect).toBeNull();
  });

  it('stops a move from the free pool that exceeds what is free', () => {
    const balance = balanceOf(instrument(), [allocation({ legalEntityCode: 'E01', allocated: 4_500_000 })]);
    const result = validateAllocationRequest(
      { collateralId: 'c1', fromEntityCode: null, toEntityCode: 'E02', amount: 1_000_000 },
      balance,
      policy,
      ASOF,
    );
    expect(result.refusals.map((r) => r.code)).toContain('exceeds_unallocated');
  });
});

describe('approvalChainFor', () => {
  it('always puts the entity giving up cover on the chain', () => {
    // Central credit approving alone is how one BU discovers on a Monday that
    // its guarantee went somewhere else.
    const chain = approvalChainFor({ fromEntityCode: 'E01', toEntityCode: 'E02' }, policy);
    expect(chain[0]).toMatchObject({ approver: 'E01', kind: 'entity' });
  });

  it('never returns an empty chain when nothing is configured', () => {
    // An unset approval list must not mean "anyone may move collateral".
    const chain = approvalChainFor({ fromEntityCode: null, toEntityCode: 'E02' }, { ...policy, reallocationApproval: [] });
    expect(chain).toHaveLength(1);
    expect(chain[0]!.approver).toBe('admin');
  });

  it('adds the roles the tenant named, after the losing entity', () => {
    const chain = approvalChainFor(
      { fromEntityCode: 'E01', toEntityCode: 'E02' },
      { ...policy, reallocationApproval: ['credit_manager', 'cfo'] },
    );
    expect(chain.map((s) => s.approver)).toEqual(['E01', 'credit_manager', 'cfo']);
  });
});

describe('evaluateChain', () => {
  const chain = approvalChainFor(
    { fromEntityCode: 'E01', toEntityCode: 'E02' },
    { ...policy, reallocationApproval: ['credit_manager'] },
  );

  function record(approver: string, decision: 'approved' | 'rejected'): ApprovalRecord {
    return { approver, kind: 'role', decision, decidedBy: 'u1', decidedAt: '2026-09-01T00:00:00Z', note: null };
  }

  it('stays pending until every step has approved', () => {
    const state = evaluateChain(chain, [record('E01', 'approved')]);
    expect(state.status).toBe('pending');
    expect(state.outstanding.map((s) => s.approver)).toEqual(['credit_manager']);
  });

  it('one rejection ends it, whatever else was approved', () => {
    // There is no majority on a question about whose guarantee this is.
    const state = evaluateChain(chain, [record('credit_manager', 'approved'), record('E01', 'rejected')]);
    expect(state.status).toBe('rejected');
    expect(state.rejectedBy?.approver).toBe('E01');
  });

  it('is approved only when nothing is outstanding', () => {
    const state = evaluateChain(chain, [record('E01', 'approved'), record('credit_manager', 'approved')]);
    expect(state.status).toBe('approved');
  });
});

describe('canApply', () => {
  const chain = approvalChainFor({ fromEntityCode: 'E01', toEntityCode: 'E02' }, policy);
  const approved = evaluateChain(chain, [
    { approver: 'E01', kind: 'entity', decision: 'approved', decidedBy: 'u1', decidedAt: '2026-09-01T00:00:00Z', note: null },
  ]);

  const request: AllocationRequest = {
    requestId: 'r1',
    collateralId: 'c1',
    fromEntityCode: 'E01',
    toEntityCode: 'E02',
    amount: 500_000,
    reason: 'new order at E02',
    requestedBy: 'u1',
    requestedAt: '2026-09-01T00:00:00Z',
    status: 'approved',
  };

  it('applies when the balances still support it', () => {
    const balance = balanceOf(instrument(), [
      allocation({ legalEntityCode: 'E01', allocated: 3_000_000, utilized: 2_000_000 }),
    ]);
    expect(canApply(request, approved, balance, policy, ASOF).ok).toBe(true);
  });

  it('refuses when the source has drawn down since approval', () => {
    // The reason approving and applying are separate acts: E01 drew on its
    // allocation after the approval, and the move would now strip live cover.
    const balance = balanceOf(instrument(), [
      allocation({ legalEntityCode: 'E01', allocated: 3_000_000, utilized: 2_900_000 }),
    ]);
    const result = canApply(request, approved, balance, policy, ASOF);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('stale');
    expect('refusals' in result.error && result.error.refusals.map((r) => r.code)).toContain('exceeds_undrawn');
  });

  it('refuses while an approver is still outstanding', () => {
    const partial = evaluateChain(
      approvalChainFor({ fromEntityCode: 'E01', toEntityCode: 'E02' }, { ...policy, reallocationApproval: ['cfo'] }),
      [{ approver: 'E01', kind: 'entity', decision: 'approved', decidedBy: 'u1', decidedAt: 'x', note: null }],
    );
    const balance = balanceOf(instrument(), [allocation({ legalEntityCode: 'E01', allocated: 3_000_000 })]);
    const result = canApply(request, partial, balance, policy, ASOF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_approved');
  });

  it('refuses a request that was never approved', () => {
    const balance = balanceOf(instrument(), [allocation({ legalEntityCode: 'E01', allocated: 3_000_000 })]);
    const result = canApply({ ...request, status: 'pending' }, approved, balance, policy, ASOF);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('wrong_status');
  });
});

describe('allocationChangesFor', () => {
  it('writes both sides of the move and leaves utilisation alone', () => {
    const balance = balanceOf(instrument(), [
      allocation({ legalEntityCode: 'E01', allocated: 3_000_000, utilized: 1_000_000 }),
    ]);
    const changes = allocationChangesFor(
      { fromEntityCode: 'E01', toEntityCode: 'E02', amount: 500_000 },
      balance,
    );
    expect(changes).toEqual([
      { legalEntityCode: 'E01', allocatedBefore: 3_000_000, allocatedAfter: 2_500_000, utilized: 1_000_000 },
      { legalEntityCode: 'E02', allocatedBefore: 0, allocatedAfter: 500_000, utilized: 0 },
    ]);
  });
});

describe('proposeAllocation', () => {
  const uncovered = [
    { legalEntityCode: 'E01', uncovered: 400_000 },
    { legalEntityCode: 'E02', uncovered: 900_000 },
  ];

  it('proposes nothing when the organisation chose manual', () => {
    // Choosing manual is a statement that a person decides. A suggestion is the
    // first step towards the system deciding.
    expect(proposeAllocation(1_000_000, uncovered, { ...policy, allocationMethod: 'manual' })).toEqual([]);
  });

  it('follows the stated priority order when there is one', () => {
    const proposals = proposeAllocation(1_000_000, uncovered, {
      ...policy,
      allocationMethod: 'priority_order',
      priorityOrder: ['E02', 'E01'],
    });
    expect(proposals.map((p) => p.legalEntityCode)).toEqual(['E02', 'E01']);
  });

  it('ranks by uncovered exposure under pro rata', () => {
    const proposals = proposeAllocation(1_000_000, uncovered, { ...policy, allocationMethod: 'pro_rata' });
    expect(proposals[0]!.legalEntityCode).toBe('E02');
  });
});

describe('summariseWorkflow', () => {
  it('counts approved-but-not-applied separately — the queue that grows quietly', () => {
    const summary = summariseWorkflow(
      [
        { status: 'pending', amount: 100, outstanding: ['E01'] },
        { status: 'pending', amount: 200, outstanding: ['cfo'] },
        { status: 'approved', amount: 300, outstanding: [] },
        { status: 'applied', amount: 400, outstanding: [] },
      ],
      ['E01'],
    );
    expect(summary.pending).toBe(2);
    expect(summary.awaitingMe).toBe(1);
    expect(summary.approvedNotApplied).toBe(1);
    expect(summary.valueInFlight).toBe(600);
  });
});
