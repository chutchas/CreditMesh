import { describe, expect, it } from 'vitest';
import { buildCreditMemo, memoIsReviewable, type MemoInputs } from '@creditmesh/core';

function inputs(patch: Partial<MemoInputs> = {}): MemoInputs {
  return {
    partyId: 'p1',
    partyName: 'Acme Trading Co Ltd',
    taxId: '0105536000020',
    currency: 'THB',
    asOf: '2026-09-03',
    registry: { legalStatus: 'ปกติ', registeredCapital: 5_000_000, registrationDate: '2010-04-01' },
    group: null,
    exposure: { total: 4_000_000, arOpen: 4_000_000, arOverdue: 0, creditLimit: 5_000_000, maxDpd: 0 },
    paymentBehavior: { avgDaysLate: 4, onTimePct: 82, sampleSize: 30 },
    collateral: null,
    financials: {
      fiscalYear: 2025,
      revenue: 90_000_000,
      netProfit: 4_000_000,
      equity: 20_000_000,
      currentRatio: 1.6,
      debtToEquity: 1.2,
    },
    riskIndex: null,
    legalEvents: [],
    signals: [],
    ...patch,
  };
}

describe('buildCreditMemo', () => {
  it('never writes the recommendation', () => {
    // The module's whole positioning: it drafts the facts, the analyst supplies
    // the judgement. A generated recommendation adds no information over the
    // numbers printed above it and invites the reader to skip them.
    const memo = buildCreditMemo(inputs());
    expect(memo.analystSections.map((s) => s.code)).toEqual([
      'assessment',
      'limit_proposal',
      'conditions',
      'recommendation',
    ]);
    expect(memo.analystSections.every((s) => s.content === '')).toBe(true);
  });

  it('prints what is missing instead of leaving the section out', () => {
    // A memo silently missing its financial section reads like a company with
    // unremarkable financials. One that says so reads like what it is.
    const memo = buildCreditMemo(inputs({ financials: null, paymentBehavior: null }));
    expect(memo.gaps).toContain('financial statements');
    expect(memo.gaps).toContain('settled payment history');
    const financials = memo.sections.find((s) => s.code === 'financials')!;
    expect(financials.observations[0]).toContain('No financial statements');
  });

  it('refuses to read no payment history as paying on time', () => {
    const memo = buildCreditMemo(inputs({ paymentBehavior: null }));
    const section = memo.sections.find((s) => s.code === 'payment_behavior')!;
    expect(section.observations.join(' ')).toContain('not the same as paying on time');
  });

  it('flags a group over the largest single limit approved in it', () => {
    const memo = buildCreditMemo(
      inputs({
        group: { name: 'Acme Group', memberCount: 3, totalExposure: 12_500_000, maxSingleLimit: 6_000_000 },
      }),
    );
    const group = memo.sections.find((s) => s.code === 'group')!;
    expect(group.observations[0]).toContain('exceeds the largest single limit');
  });

  it('says how old the accounts are', () => {
    const memo = buildCreditMemo(inputs({ financials: { ...inputs().financials!, fiscalYear: 2023 } }));
    const financials = memo.sections.find((s) => s.code === 'financials')!;
    expect(financials.observations.join(' ')).toContain('3 years old');
  });

  it('warns that a legal search finding nothing is not a clean search', () => {
    const memo = buildCreditMemo(inputs());
    const legal = memo.sections.find((s) => s.code === 'legal')!;
    expect(legal.observations.join(' ')).toContain('not the same as a clean search');
  });

  it('carries the incompleteness warning through from the risk index', () => {
    const memo = buildCreditMemo(
      inputs({ riskIndex: { score: 62, grade: 'C', incomplete: true, componentsScored: 3, componentsEnabled: 9 } }),
    );
    const section = memo.sections.find((s) => s.code === 'risk_index')!;
    expect(section.observations[0]).toContain('should not be compared with a full one');
  });

  it('gives every figure a stated source', () => {
    const memo = buildCreditMemo(inputs());
    const facts = memo.sections.flatMap((s) => s.facts);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.source.length > 0)).toBe(true);
  });

  it('reports completeness so an analyst knows what they picked up', () => {
    const full = buildCreditMemo(inputs());
    const thin = buildCreditMemo(
      inputs({ registry: null, financials: null, paymentBehavior: null, collateral: null }),
    );
    expect(full.completenessPct).toBeGreaterThan(thin.completenessPct);
  });
});

describe('memoIsReviewable', () => {
  it('blocks review while any analyst section is empty', () => {
    const memo = buildCreditMemo(inputs());
    expect(memoIsReviewable(memo).ok).toBe(false);
    expect(memoIsReviewable(memo).missing).toHaveLength(4);

    const filled = { ...memo, analystSections: memo.analystSections.map((s) => ({ ...s, content: 'written' })) };
    expect(memoIsReviewable(filled).ok).toBe(true);
  });

  it('does not accept whitespace as an assessment', () => {
    const memo = buildCreditMemo(inputs());
    const whitespace = { ...memo, analystSections: memo.analystSections.map((s) => ({ ...s, content: '   \n ' })) };
    expect(memoIsReviewable(whitespace).ok).toBe(false);
  });
});
