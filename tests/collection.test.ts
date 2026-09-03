import { describe, expect, it } from 'vitest';
import {
  buildCollectionQueue,
  createStarterProfile,
  dsoCountBack,
  promiseKeptRate,
  suggestedStageFor,
  summariseCollection,
  type CollectionCaseInput,
} from '@creditmesh/core';

const profile = createStarterProfile('t', 'Demo');
const policy = profile.collectionPolicy;
const ASOF = '2026-09-03';

// Worst grade ranks highest, matching how the page builds it.
const gradeRank = new Map(
  [...profile.creditPolicy.riskGrades].sort((a, b) => b.minScore - a.minScore).map((g, i) => [g.code, i]),
);

function kase(patch: Partial<CollectionCaseInput> & { caseId: string }): CollectionCaseInput {
  return {
    partyId: `p-${patch.caseId}`,
    partyName: 'Acme Trading',
    legalEntityCode: 'E01',
    ownerUserId: null,
    ownerLabel: null,
    stage: null,
    status: 'open',
    openAmount: 1_000_000,
    overdueAmount: 1_000_000,
    currency: 'THB',
    maxDpd: 30,
    grade: 'C',
    score: 55,
    lastContactAt: null,
    manualRank: null,
    hasAcceptedDispute: false,
    openPromise: null,
    brokenPromiseCount: 0,
    ...patch,
  };
}

describe('buildCollectionQueue', () => {
  it('takes a case with an accepted dispute out of the chase queue', () => {
    // Chasing a dispute the organisation has itself accepted is how a
    // collections team loses an argument it already lost.
    const queue = buildCollectionQueue(
      [kase({ caseId: 'a' }), kase({ caseId: 'disputed', hasAcceptedDispute: true, overdueAmount: 9_000_000 })],
      policy,
      ASOF,
      gradeRank,
    );
    expect(queue[0]!.case.caseId).toBe('a');
    const held = queue.find((q) => q.case.caseId === 'disputed')!;
    expect(held.onHold).toBe(true);
    expect(held.holdReason).toContain('dispute');
  });

  it('honours a collector’s own order over ours', () => {
    const queue = buildCollectionQueue(
      [
        kase({ caseId: 'big', overdueAmount: 9_000_000 }),
        kase({ caseId: 'chosen', overdueAmount: 50_000, manualRank: 1 }),
      ],
      policy,
      ASOF,
      gradeRank,
    );
    expect(queue[0]!.case.caseId).toBe('chosen');
  });

  it('drops a case with an open promise still inside its window', () => {
    // There is nothing to say to someone who promised to pay on Friday, and a
    // queue that calls them anyway is the queue a collector abandons.
    const queue = buildCollectionQueue(
      [
        kase({ caseId: 'promised', overdueAmount: 5_000_000, openPromise: { amount: 5_000_000, promisedDate: '2026-09-20' } }),
        kase({ caseId: 'plain', overdueAmount: 100_000 }),
      ],
      policy,
      ASOF,
      gradeRank,
    );
    expect(queue[0]!.case.caseId).toBe('plain');
    expect(queue[1]!.promiseState).toBe('open');
    expect(queue[1]!.reasons.join(' ')).toContain('nothing to chase yet');
  });

  it('marks a promise whose date has passed as broken', () => {
    const queue = buildCollectionQueue(
      [kase({ caseId: 'a', openPromise: { amount: 400_000, promisedDate: '2026-08-25' } })],
      policy,
      ASOF,
      gradeRank,
    );
    expect(queue[0]!.promiseState).toBe('broken');
  });

  it('weights the queue from the tenant policy, not a constant', () => {
    const amountOnly = { ...policy, strategyWeights: { amount: 1, daysOverdue: 0, riskGrade: 0 } };
    const ageOnly = { ...policy, strategyWeights: { amount: 0, daysOverdue: 1, riskGrade: 0 } };
    const cases = [
      kase({ caseId: 'big-recent', overdueAmount: 9_000_000, maxDpd: 5 }),
      kase({ caseId: 'small-ancient', overdueAmount: 100_000, maxDpd: 300 }),
    ];
    expect(buildCollectionQueue(cases, amountOnly, ASOF, gradeRank)[0]!.case.caseId).toBe('big-recent');
    expect(buildCollectionQueue(cases, ageOnly, ASOF, gradeRank)[0]!.case.caseId).toBe('small-ancient');
  });

  it('suggests a stage but never applies one', () => {
    const queue = buildCollectionQueue([kase({ caseId: 'a', maxDpd: 65, stage: 'reminder' })], policy, ASOF, gradeRank);
    expect(queue[0]!.suggestedStage).toBe('final_notice');
    // The stored stage is untouched: an organisation running dunning in its
    // ERP must not get two final notices from two systems.
    expect(queue[0]!.case.stage).toBe('reminder');
  });
});

describe('suggestedStageFor', () => {
  it('picks the highest stage the days have passed', () => {
    expect(suggestedStageFor(0, policy)).toBeNull();
    expect(suggestedStageFor(3, policy)).toBe('reminder');
    expect(suggestedStageFor(31, policy)).toBe('formal_notice');
    expect(suggestedStageFor(400, policy)).toBe('legal_notice');
  });
});

describe('promiseKeptRate', () => {
  it('excludes cancelled promises from both sides', () => {
    // A promise withdrawn by agreement says nothing about whether this customer
    // keeps their word; counting it as broken makes the one metric collections
    // teams already report quietly wrong.
    const rate = promiseKeptRate([
      { amount: 1, promisedDate: '2026-01-01', status: 'kept' },
      { amount: 1, promisedDate: '2026-01-01', status: 'broken' },
      { amount: 1, promisedDate: '2026-01-01', status: 'cancelled' },
      { amount: 1, promisedDate: '2026-01-01', status: 'open' },
    ]);
    expect(rate.ratePct).toBe(50);
  });

  it('returns null rather than 0% when nothing has settled', () => {
    expect(promiseKeptRate([{ amount: 1, promisedDate: '2026-01-01', status: 'open' }]).ratePct).toBeNull();
  });
});

describe('summariseCollection', () => {
  it('separates what can be chased from what is held', () => {
    const queue = buildCollectionQueue(
      [
        kase({ caseId: 'a' }),
        kase({ caseId: 'b', hasAcceptedDispute: true }),
        kase({ caseId: 'c', lastContactAt: '2026-09-01T09:00:00Z' }),
      ],
      policy,
      ASOF,
      gradeRank,
    );
    const s = summariseCollection(queue, policy);
    expect(s.openCases).toBe(3);
    expect(s.chaseable).toBe(2);
    expect(s.onHold).toBe(1);
    expect(s.neverContacted).toBe(2);
  });
});

describe('dsoCountBack', () => {
  it('walks the balance back through real monthly sales', () => {
    const dso = dsoCountBack(4_500_000, [
      { month: '2026-08', sales: 3_000_000, days: 31 },
      { month: '2026-07', sales: 3_000_000, days: 31 },
    ]);
    // 3.0M covers August (31 days), the remaining 1.5M is half of July.
    expect(dso).toBe(46.5);
  });

  it('says it cannot tell rather than inventing a number', () => {
    // The balance exceeds every month of sales on record. Reporting a DSO
    // built on nothing is worse than reporting none.
    expect(dsoCountBack(50_000_000, [{ month: '2026-08', sales: 1_000_000, days: 31 }])).toBeNull();
  });
});
