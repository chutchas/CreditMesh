import { describe, expect, it } from 'vitest';
import {
  diagnoseOrderBlock,
  rankOrderBlocks,
  summariseOrderBlocks,
  type BlockContext,
  type BlockedOrder,
  type OrderBlockPolicy,
} from '@creditmesh/core';

const NOW = '2026-09-03T09:00:00Z';
const policy: OrderBlockPolicy = { worstGradeCode: 'E', ageAlertDays: 7 };

function order(patch: Partial<BlockedOrder> = {}): BlockedOrder {
  return {
    blockId: 'b1',
    orderRef: 'SO-1',
    partyId: 'p1',
    partyName: 'Acme Trading',
    legalEntityCode: 'E01',
    orderAmount: 1_000_000,
    currency: 'THB',
    orderDate: '2026-08-25',
    blockedAt: '2026-08-26T00:00:00Z',
    blockCode: 'Z1',
    blockReason: 'Credit limit check failed',
    ...patch,
  };
}

function context(patch: Partial<BlockContext> = {}): BlockContext {
  return {
    exposure: 0,
    creditLimit: 5_000_000,
    limitValidTo: null,
    arOverdue: 0,
    maxOpenDpd: null,
    collateralAvailable: 0,
    collateralExpired: 0,
    uncoveredExposure: 0,
    grade: 'B',
    score: 70,
    groupExposure: null,
    groupMaxSingleLimit: null,
    ...patch,
  };
}

describe('diagnoseOrderBlock', () => {
  it('names a limit breach with the shortfall, not just the fact', () => {
    const d = diagnoseOrderBlock(order({ orderAmount: 2_000_000 }), context({ exposure: 4_000_000 }), policy, NOW);
    const cause = d.causes.find((c) => c.code === 'limit_exceeded');
    expect(cause?.detail.shortfall).toBe(1_000_000);
    expect(d.impact.headroomAfter).toBe(-1_000_000);
  });

  it('offers a partial release only when part of the order actually fits', () => {
    const fits = diagnoseOrderBlock(order({ orderAmount: 2_000_000 }), context({ exposure: 4_000_000 }), policy, NOW);
    expect(fits.remedies.find((r) => r.code === 'partial_release')?.amount).toBe(1_000_000);

    // Already over the limit before this order: there is no headroom to fill,
    // and a "release 0" button wastes an afternoon.
    const none = diagnoseOrderBlock(order({ orderAmount: 2_000_000 }), context({ exposure: 5_400_000 }), policy, NOW);
    expect(none.remedies.some((r) => r.code === 'partial_release')).toBe(false);
  });

  it('says so when nothing in our data explains the block', () => {
    const d = diagnoseOrderBlock(order({ orderAmount: 500_000 }), context({ exposure: 1_000_000 }), policy, NOW);
    expect(d.explained).toBe(false);
    expect(d.causes.map((c) => c.code)).toEqual(['not_visible']);
    expect(d.remedies.map((r) => r.code)).toEqual(['ask_source_system']);
  });

  it('reports every cause, not the first one found', () => {
    const d = diagnoseOrderBlock(
      order({ orderAmount: 2_000_000 }),
      context({ exposure: 4_500_000, arOverdue: 900_000, maxOpenDpd: 120, grade: 'E', score: 20 }),
      policy,
      NOW,
    );
    expect(d.causes.map((c) => c.code).sort()).toEqual(['limit_exceeded', 'overdue_balance', 'worst_risk_grade']);
  });

  it('does not call an unsecured customer under-collateralised', () => {
    // No inbound instrument at all: "uncovered" is true of every unsecured
    // customer and therefore tells the officer nothing.
    const unsecured = diagnoseOrderBlock(
      order(),
      context({ exposure: 1_000_000, uncoveredExposure: 1_000_000, arOverdue: 10 }),
      policy,
      NOW,
    );
    expect(unsecured.causes.some((c) => c.code === 'collateral_shortfall')).toBe(false);

    const secured = diagnoseOrderBlock(
      order(),
      context({ exposure: 1_000_000, uncoveredExposure: 200_000, collateralAvailable: 300_000, arOverdue: 10 }),
      policy,
      NOW,
    );
    const cause = secured.causes.find((c) => c.code === 'collateral_shortfall');
    expect(cause?.detail.uncoveredAfterRelease).toBe(900_000);
  });

  it('treats an expired limit as its own problem, separate from the amount', () => {
    const d = diagnoseOrderBlock(order(), context({ exposure: 100_000, limitValidTo: '2026-06-30' }), policy, NOW);
    expect(d.causes.map((c) => c.code)).toContain('limit_expired');
    expect(d.causes.some((c) => c.code === 'limit_exceeded')).toBe(false);
  });

  it('raises group pressure against the largest single limit, never their sum', () => {
    const d = diagnoseOrderBlock(
      order({ orderAmount: 1_000_000 }),
      context({ exposure: 500_000, groupExposure: 9_500_000, groupMaxSingleLimit: 10_000_000 }),
      policy,
      NOW,
    );
    const cause = d.causes.find((c) => c.code === 'group_limit_pressure');
    expect(cause?.detail.groupExposureAfter).toBe(10_500_000);
  });

  it('counts days held from the block date', () => {
    const d = diagnoseOrderBlock(order({ blockedAt: '2026-08-20T00:00:00Z' }), context(), policy, NOW);
    expect(d.daysBlocked).toBe(14);
  });
});

describe('summariseOrderBlocks', () => {
  it('counts as clearable-by-collection only orders overdue is the sole blocker for', () => {
    const overdueOnly = diagnoseOrderBlock(
      order({ blockId: 'a', orderAmount: 400_000 }),
      context({ exposure: 100_000, arOverdue: 250_000, maxOpenDpd: 40 }),
      policy,
      NOW,
    );
    // Also over its limit — paying an invoice does not send this one out.
    const alsoOverLimit = diagnoseOrderBlock(
      order({ blockId: 'b', orderAmount: 900_000 }),
      context({ exposure: 4_800_000, arOverdue: 250_000, maxOpenDpd: 40 }),
      policy,
      NOW,
    );
    const summary = summariseOrderBlocks([overdueOnly, alsoOverLimit], policy);
    expect(summary.clearableByCollection).toBe(400_000);
    expect(summary.blockedValue).toBe(1_300_000);
    expect(summary.unexplainedCount).toBe(0);
  });

  it('surfaces how many blocks our data cannot account for', () => {
    const blind = diagnoseOrderBlock(order({ blockId: 'c' }), context({ exposure: 10 }), policy, NOW);
    expect(summariseOrderBlocks([blind], policy).unexplainedCount).toBe(1);
  });
});

describe('rankOrderBlocks', () => {
  it('puts value first and lets age break the tie', () => {
    const big = diagnoseOrderBlock(order({ blockId: 'big', orderAmount: 8_000_000 }), context(), policy, NOW);
    const oldSmall = diagnoseOrderBlock(
      order({ blockId: 'old', orderAmount: 50_000, blockedAt: '2026-07-01T00:00:00Z' }),
      context(),
      policy,
      NOW,
    );
    const sameSizeOlder = diagnoseOrderBlock(
      order({ blockId: 'older', orderAmount: 8_000_000, blockedAt: '2026-07-01T00:00:00Z' }),
      context(),
      policy,
      NOW,
    );
    expect(rankOrderBlocks([oldSmall, big, sameSizeOlder]).map((d) => d.order.blockId)).toEqual([
      'older',
      'big',
      'old',
    ]);
  });
});
