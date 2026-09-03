import type { CollateralPolicy } from '../tenant/profile';
import type { IsoDate, IsoTimestamp, Uuid } from '../types/canonical';
import type { CollateralBalance } from './collateral';

/**
 * Module 3, second phase — requesting, approving and applying an allocation.
 *
 * §7 calls this module the product's core and is blunt that the hard part is
 * not technical: it is agreeing who has first claim on a guarantee and who may
 * move it. That is why phase one was a read-only register — put the numbers
 * everyone already uses on one screen, change nobody's process — and why this
 * phase only starts once every entity agrees what the numbers are.
 *
 * Four refusals carry the weight here, and each of them is a rule somebody
 * will eventually ask to relax:
 *
 * 1. **Only undrawn headroom moves.** An allocation that is drawn against is
 *    covering a balance that exists. Moving it leaves that balance uncovered
 *    without anyone deciding to leave it uncovered.
 * 2. **The entity losing cover approves.** Central credit approving on its own
 *    is how one BU discovers on a Monday that its guarantee went elsewhere.
 * 3. **Approving and applying are separate acts.** Exposure moves between the
 *    two, so applying re-validates against the balances at that moment and
 *    fails loudly rather than executing a decision that was true last week.
 * 4. **Outbound collateral is never allocatable.** It is our obligation, not
 *    our protection.
 */

export type RequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'applied' | 'withdrawn';

export interface AllocationRequest {
  requestId: Uuid;
  collateralId: Uuid;
  /** Null means "take from the instrument's unallocated remainder". */
  fromEntityCode: string | null;
  toEntityCode: string;
  amount: number;
  reason: string;
  requestedBy: Uuid;
  requestedAt: IsoTimestamp;
  status: RequestStatus;
}

export type RefusalCode =
  | 'outbound_instrument'
  | 'instrument_not_effective'
  | 'claim_window_closed'
  | 'exceeds_unallocated'
  | 'exceeds_undrawn'
  | 'source_not_allocated'
  | 'same_entity'
  | 'not_positive'
  | 'would_over_allocate';

export interface Refusal {
  code: RefusalCode;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  refusals: Refusal[];
  /** What the move would leave behind, so an approver sees the consequence. */
  effect: {
    sourceAllocatedAfter: number | null;
    sourceUndrawnAfter: number | null;
    targetAllocatedAfter: number;
    instrumentUnallocatedAfter: number;
  } | null;
}

/**
 * Can this move be made at all?
 *
 * Returns every refusal rather than the first, because a request that fails on
 * three counts should be rewritten once, not three times.
 */
export function validateAllocationRequest(
  request: Pick<AllocationRequest, 'collateralId' | 'fromEntityCode' | 'toEntityCode' | 'amount'>,
  balance: CollateralBalance,
  policy: CollateralPolicy,
  asOf: IsoDate,
): ValidationResult {
  const refusals: Refusal[] = [];

  if (request.amount <= 0) {
    refusals.push({ code: 'not_positive', detail: 'the amount must be greater than zero' });
  }
  if (request.fromEntityCode === request.toEntityCode) {
    refusals.push({ code: 'same_entity', detail: 'the source and target entity are the same' });
  }

  if (balance.collateral.direction === 'outbound') {
    refusals.push({
      code: 'outbound_instrument',
      detail: 'this is collateral we posted to a counterparty — it is our obligation, not cover we can allocate',
    });
  }

  if (!balance.isEffective && balance.collateral.direction === 'inbound') {
    refusals.push({
      code: 'instrument_not_effective',
      detail: `the instrument is ${balance.collateral.status}${balance.collateral.expiryDate ? ` and expires ${balance.collateral.expiryDate}` : ''} — allocating it would record cover that does not exist`,
    });
  }

  // Expiry and the claim window are different dates and the second one is the
  // one that actually ends recovery. An instrument inside its validity but past
  // its claim deadline looks live and is worthless.
  if (balance.collateral.claimDeadline && balance.collateral.claimDeadline < asOf) {
    refusals.push({
      code: 'claim_window_closed',
      detail: `the claim window closed on ${balance.collateral.claimDeadline}; nothing can be recovered under this instrument`,
    });
  }

  const source = request.fromEntityCode
    ? balance.allocations.find((a) => a.legalEntityCode === request.fromEntityCode)
    : null;

  let sourceAllocatedAfter: number | null = null;
  let sourceUndrawnAfter: number | null = null;

  if (request.fromEntityCode) {
    if (!source) {
      refusals.push({
        code: 'source_not_allocated',
        detail: `${request.fromEntityCode} holds no allocation on this instrument`,
      });
    } else {
      const undrawn = source.allocated - source.utilized;
      if (request.amount > undrawn) {
        // The rule this module exists to hold. Everything else is arithmetic.
        refusals.push({
          code: 'exceeds_undrawn',
          detail: `${request.fromEntityCode} has ${undrawn} undrawn of ${source.allocated} allocated — the rest is covering a balance that exists, and moving it would leave that balance uncovered without anyone deciding to`,
        });
      } else {
        sourceAllocatedAfter = source.allocated - request.amount;
        sourceUndrawnAfter = undrawn - request.amount;
      }
    }
  } else if (request.amount > balance.unallocated) {
    refusals.push({
      code: 'exceeds_unallocated',
      detail: `only ${Math.max(0, balance.unallocated)} of this instrument is unallocated; take the rest from an entity that holds it`,
    });
  }

  const target = balance.allocations.find((a) => a.legalEntityCode === request.toEntityCode);
  const targetAllocatedAfter = (target?.allocated ?? 0) + request.amount;

  const instrumentUnallocatedAfter = request.fromEntityCode
    ? balance.unallocated
    : balance.unallocated - request.amount;

  if (instrumentUnallocatedAfter < 0 && !policy.allowOverAllocation) {
    refusals.push({
      code: 'would_over_allocate',
      detail: 'the instrument would be allocated beyond its face value, which this organisation does not permit',
    });
  }

  return {
    ok: refusals.length === 0,
    refusals,
    effect:
      refusals.length === 0
        ? {
            sourceAllocatedAfter,
            sourceUndrawnAfter,
            targetAllocatedAfter,
            instrumentUnallocatedAfter,
          }
        : null,
  };
}

export interface ApprovalStep {
  /** A role from the tenant's own list, or the code of an entity that must agree. */
  approver: string;
  kind: 'role' | 'entity';
  reason: string;
}

/**
 * Who has to say yes.
 *
 * The entity giving up cover is always on the list when there is one. §7 names
 * this as the organisational heart of the module: central credit approving a
 * move on its own is how one BU finds out on a Monday that its guarantee went
 * somewhere else, and it is the fastest way to lose the ledger's credibility.
 */
export function approvalChainFor(
  request: Pick<AllocationRequest, 'fromEntityCode' | 'toEntityCode'>,
  policy: CollateralPolicy,
): ApprovalStep[] {
  const steps: ApprovalStep[] = [];

  if (request.fromEntityCode) {
    steps.push({
      approver: request.fromEntityCode,
      kind: 'entity',
      reason: 'this entity is giving up cover it currently holds',
    });
  }

  for (const role of policy.reallocationApproval) {
    steps.push({ approver: role, kind: 'role', reason: 'named in the collateral policy' });
  }

  // An unconfigured approval chain does not mean "anyone may move collateral".
  // With nothing configured the request still needs the losing entity, and a
  // move from the free pool needs somebody: an empty list would let the whole
  // workflow be bypassed by leaving a setting blank.
  if (steps.length === 0) {
    steps.push({
      approver: 'admin',
      kind: 'role',
      reason: 'no reallocation approvers are configured, so the request falls to an administrator',
    });
  }

  return steps;
}

export interface ApprovalRecord {
  approver: string;
  kind: 'role' | 'entity';
  decision: 'approved' | 'rejected';
  decidedBy: Uuid;
  decidedAt: IsoTimestamp;
  note: string | null;
}

export interface ChainState {
  chain: ApprovalStep[];
  records: ApprovalRecord[];
  outstanding: ApprovalStep[];
  status: 'pending' | 'approved' | 'rejected';
  /** Present when rejected: who refused and what they said. */
  rejectedBy: ApprovalRecord | null;
}

export function evaluateChain(chain: ApprovalStep[], records: ApprovalRecord[]): ChainState {
  const rejected = records.find((r) => r.decision === 'rejected') ?? null;
  const approvedSet = new Set(records.filter((r) => r.decision === 'approved').map((r) => r.approver));
  const outstanding = chain.filter((step) => !approvedSet.has(step.approver));

  return {
    chain,
    records,
    outstanding,
    // One rejection ends it. There is no "majority" on a question about whose
    // guarantee this is.
    status: rejected ? 'rejected' : outstanding.length === 0 ? 'approved' : 'pending',
    rejectedBy: rejected,
  };
}

export type TransitionError =
  | { code: 'wrong_status'; detail: string }
  | { code: 'not_approved'; detail: string }
  | { code: 'stale'; detail: string; refusals: Refusal[] };

/**
 * Re-check an approved request at the moment it is applied.
 *
 * Approval and application are deliberately separate, and time passes between
 * them: an entity draws on its allocation, an instrument expires, exposure
 * moves. Applying a decision that was true last week without re-testing it is
 * how a ledger that is supposed to be the system of record starts disagreeing
 * with itself.
 */
export function canApply(
  request: AllocationRequest,
  chain: ChainState,
  balance: CollateralBalance,
  policy: CollateralPolicy,
  asOf: IsoDate,
): { ok: true } | { ok: false; error: TransitionError } {
  if (request.status !== 'approved') {
    return { ok: false, error: { code: 'wrong_status', detail: `the request is ${request.status}` } };
  }
  if (chain.status !== 'approved') {
    return {
      ok: false,
      error: {
        code: 'not_approved',
        detail:
          chain.status === 'rejected'
            ? `rejected by ${chain.rejectedBy?.approver}`
            : `still waiting on ${chain.outstanding.map((s) => s.approver).join(', ')}`,
      },
    };
  }

  const revalidation = validateAllocationRequest(request, balance, policy, asOf);
  if (!revalidation.ok) {
    return {
      ok: false,
      error: {
        code: 'stale',
        detail: 'the balances have changed since this was approved and it no longer holds',
        refusals: revalidation.refusals,
      },
    };
  }

  return { ok: true };
}

export interface AllocationChange {
  legalEntityCode: string;
  allocatedBefore: number;
  allocatedAfter: number;
  utilized: number;
}

/**
 * The two rows the ledger has to write. Returned rather than applied, so the
 * caller writes both in one transaction or neither.
 */
export function allocationChangesFor(
  request: Pick<AllocationRequest, 'fromEntityCode' | 'toEntityCode' | 'amount'>,
  balance: CollateralBalance,
): AllocationChange[] {
  const changes: AllocationChange[] = [];

  if (request.fromEntityCode) {
    const source = balance.allocations.find((a) => a.legalEntityCode === request.fromEntityCode);
    if (source) {
      changes.push({
        legalEntityCode: source.legalEntityCode,
        allocatedBefore: source.allocated,
        allocatedAfter: source.allocated - request.amount,
        utilized: source.utilized,
      });
    }
  }

  const target = balance.allocations.find((a) => a.legalEntityCode === request.toEntityCode);
  changes.push({
    legalEntityCode: request.toEntityCode,
    allocatedBefore: target?.allocated ?? 0,
    allocatedAfter: (target?.allocated ?? 0) + request.amount,
    utilized: target?.utilized ?? 0,
  });

  return changes;
}

export interface PriorityProposal {
  legalEntityCode: string;
  uncovered: number;
  rank: number;
  reason: string;
}

/**
 * Where the free value on an instrument would go under the tenant's own rule.
 *
 * A proposal, never applied. §4.6 lets an organisation say `priority_order`,
 * and this ranks by it; under `pro_rata` it ranks by uncovered exposure; under
 * `manual` it returns nothing, because an organisation that chose manual has
 * said it wants a person to decide and a suggestion is the first step towards
 * the system deciding.
 */
export function proposeAllocation(
  unallocated: number,
  uncoveredByEntity: { legalEntityCode: string; uncovered: number }[],
  policy: CollateralPolicy,
): PriorityProposal[] {
  if (unallocated <= 0 || policy.allocationMethod === 'manual') return [];

  if (policy.allocationMethod === 'priority_order') {
    return policy.priorityOrder
      .map((code, index) => {
        const row = uncoveredByEntity.find((u) => u.legalEntityCode === code);
        return {
          legalEntityCode: code,
          uncovered: row?.uncovered ?? 0,
          rank: index + 1,
          reason: `position ${index + 1} in the organisation's priority order`,
        };
      })
      .filter((p) => p.uncovered > 0);
  }

  return [...uncoveredByEntity]
    .filter((u) => u.uncovered > 0)
    .sort((a, b) => b.uncovered - a.uncovered)
    .map((u, index) => ({
      legalEntityCode: u.legalEntityCode,
      uncovered: u.uncovered,
      rank: index + 1,
      reason: 'ranked by uncovered exposure, pro rata',
    }));
}

export interface WorkflowSummary {
  pending: number;
  awaitingMe: number;
  approvedNotApplied: number;
  rejectedThisPeriod: number;
  valueInFlight: number;
}

export function summariseWorkflow(
  requests: { status: RequestStatus; amount: number; outstanding: string[] }[],
  myApproverKeys: string[],
): WorkflowSummary {
  const mine = new Set(myApproverKeys);
  return {
    pending: requests.filter((r) => r.status === 'pending').length,
    awaitingMe: requests.filter((r) => r.status === 'pending' && r.outstanding.some((o) => mine.has(o))).length,
    // The queue that quietly grows: approved, and nobody executed it.
    approvedNotApplied: requests.filter((r) => r.status === 'approved').length,
    rejectedThisPeriod: requests.filter((r) => r.status === 'rejected').length,
    valueInFlight: Math.round(
      requests.filter((r) => r.status === 'pending' || r.status === 'approved').reduce((s, r) => s + r.amount, 0) * 100,
    ) / 100,
  };
}
