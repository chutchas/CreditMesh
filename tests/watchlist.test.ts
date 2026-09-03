import { describe, expect, it } from 'vitest';
import {
  applyAlertBudget,
  createStarterProfile,
  detectGradeMoves,
  detectRegistryChanges,
  renderNotification,
  spreadAcrossGroup,
  weeklyDigest,
  type DetectedChange,
  type RegistrySnapshot,
} from '@creditmesh/core';

const OBSERVED = '2026-09-03';

function snapshot(patch: Partial<RegistrySnapshot> = {}): RegistrySnapshot {
  return {
    legalStatus: 'ปกติ',
    registeredCapital: 5_000_000,
    registeredAddress: '99 Sathorn Road',
    industryCode: '46900',
    directorNames: ['สมชาย ก', 'สมหญิง ข'],
    capturedAt: '2026-08-01T00:00:00Z',
    ...patch,
  };
}

describe('detectRegistryChanges', () => {
  it('reports nothing for a counterparty seen for the first time', () => {
    // Otherwise the first import produces a change for every company on file,
    // which is exactly the week-one alert flood that gets this switched off.
    expect(detectRegistryChanges('p1', 'Acme', null, snapshot(), OBSERVED)).toEqual([]);
  });

  it('alerts on a capital decrease and not on an increase', () => {
    const down = detectRegistryChanges('p1', 'Acme', snapshot(), snapshot({ registeredCapital: 1_000_000 }), OBSERVED);
    expect(down[0]!.code).toBe('capital_decrease');
    expect(down[0]!.actionable).toBe(true);

    const up = detectRegistryChanges('p1', 'Acme', snapshot(), snapshot({ registeredCapital: 9_000_000 }), OBSERVED);
    expect(up[0]!.code).toBe('capital_increase');
    // Interesting, and nobody does anything differently today.
    expect(up[0]!.actionable).toBe(false);
  });

  it('treats an unrecognised registry status as trouble, not as fine', () => {
    // Registries invent new words for trouble faster than we can enumerate
    // them, so the list is of normal statuses and anything else asks a question.
    const changes = detectRegistryChanges('p1', 'Acme', snapshot(), snapshot({ legalStatus: 'เลิกกิจการ' }), OBSERVED);
    expect(changes[0]!.actionable).toBe(true);
    expect(changes[0]!.severity).toBe('critical');
  });

  it('separates a whole board leaving from one director rotating out', () => {
    const wholesale = detectRegistryChanges(
      'p1',
      'Acme',
      snapshot(),
      snapshot({ directorNames: ['ใหม่ ค', 'ใหม่ ง'] }),
      OBSERVED,
    );
    expect(wholesale[0]!.actionable).toBe(true);

    const rotation = detectRegistryChanges(
      'p1',
      'Acme',
      snapshot(),
      snapshot({ directorNames: ['สมชาย ก', 'ใหม่ ค'] }),
      OBSERVED,
    );
    expect(rotation[0]!.actionable).toBe(false);
  });

  it('keeps an address move out of the alert path', () => {
    const changes = detectRegistryChanges(
      'p1',
      'Acme',
      snapshot(),
      snapshot({ registeredAddress: '1 Rama IV' }),
      OBSERVED,
    );
    expect(changes[0]!.code).toBe('address_change');
    expect(changes[0]!.actionable).toBe(false);
  });
});

describe('detectGradeMoves', () => {
  const gradeRank = new Map([
    ['A', 0],
    ['B', 1],
    ['C', 2],
    ['D', 3],
    ['E', 4],
  ]);

  it('alerts on a two-band fall but not a one-band wobble', () => {
    const two = detectGradeMoves(
      [{ partyId: 'p1', partyName: 'Acme', previousGrade: 'B', currentGrade: 'D', previousScore: 70, currentScore: 40 }],
      gradeRank,
      OBSERVED,
    );
    expect(two[0]!.actionable).toBe(true);

    const one = detectGradeMoves(
      [{ partyId: 'p1', partyName: 'Acme', previousGrade: 'B', currentGrade: 'C', previousScore: 70, currentScore: 60 }],
      gradeRank,
      OBSERVED,
    );
    expect(one[0]!.actionable).toBe(false);
  });

  it('never alerts on good news', () => {
    const up = detectGradeMoves(
      [{ partyId: 'p1', partyName: 'Acme', previousGrade: 'E', currentGrade: 'A', previousScore: 20, currentScore: 90 }],
      gradeRank,
      OBSERVED,
    );
    expect(up[0]!.code).toBe('grade_rise');
    expect(up[0]!.actionable).toBe(false);
  });
});

describe('spreadAcrossGroup', () => {
  const change: DetectedChange = {
    partyId: 'p1',
    partyName: 'Acme',
    code: 'legal_status_change',
    actionable: true,
    severity: 'critical',
    before: 'ปกติ',
    after: 'เลิกกิจการ',
    detail: 'dissolved',
    observedAt: OBSERVED,
  };

  it('reaches every entity exposed to any member of the group', () => {
    // §1's opening complaint: one BU gets burned while another keeps shipping.
    const spread = spreadAcrossGroup(
      change,
      new Map([['p1', ['p1', 'p2']]]),
      [
        { partyId: 'p1', partyName: 'Acme', legalEntityCode: 'E01', exposure: 2_000_000 },
        { partyId: 'p2', partyName: 'Acme Logistics', legalEntityCode: 'E02', exposure: 3_000_000 },
        { partyId: 'p9', partyName: 'Unrelated', legalEntityCode: 'E01', exposure: 9_000_000 },
      ],
    );
    expect(spread.affectedEntities.map((e) => e.legalEntityCode)).toEqual(['E02', 'E01']);
    expect(spread.totalGroupExposure).toBe(5_000_000);
  });

  it('stays on the one company when no confirmed group exists', () => {
    const spread = spreadAcrossGroup(change, new Map(), [
      { partyId: 'p1', partyName: 'Acme', legalEntityCode: 'E01', exposure: 2_000_000 },
      { partyId: 'p2', partyName: 'Maybe related', legalEntityCode: 'E02', exposure: 3_000_000 },
    ]);
    expect(spread.totalGroupExposure).toBe(2_000_000);
  });
});

describe('applyAlertBudget', () => {
  function change(id: string, actionable: boolean, severity: DetectedChange['severity']): DetectedChange {
    return {
      partyId: id,
      partyName: id,
      code: 'grade_drop',
      actionable,
      severity,
      before: null,
      after: null,
      detail: '',
      observedAt: OBSERVED,
    };
  }

  it('raises the worst first and reports what it held back', () => {
    // A silently truncated alert list is worse than a truncated one that says
    // so: a quiet inbox would then be mistaken for a quiet day.
    const budget = applyAlertBudget(
      [
        change('a', true, 'medium'),
        change('b', true, 'critical'),
        change('c', true, 'high'),
        change('d', false, 'low'),
      ],
      2,
    );
    expect(budget.raised.map((c) => c.partyId)).toEqual(['b', 'c']);
    expect(budget.deferred.map((c) => c.partyId)).toEqual(['a']);
    expect(budget.digest.map((c) => c.partyId)).toEqual(['d']);
  });
});

describe('weeklyDigest', () => {
  it('groups by change type and counts distinct counterparties', () => {
    const lines = weeklyDigest([
      { partyId: 'p1', partyName: 'A', code: 'address_change', actionable: false, severity: 'low', before: null, after: null, detail: '', observedAt: OBSERVED },
      { partyId: 'p2', partyName: 'B', code: 'address_change', actionable: false, severity: 'low', before: null, after: null, detail: '', observedAt: OBSERVED },
      { partyId: 'p3', partyName: 'C', code: 'grade_rise', actionable: false, severity: 'low', before: null, after: null, detail: '', observedAt: OBSERVED },
    ]);
    expect(lines[0]).toEqual({ code: 'address_change', count: 2, parties: ['A', 'B'] });
  });
});

describe('renderNotification', () => {
  const change: DetectedChange = {
    partyId: 'p1',
    partyName: 'Acme Trading',
    code: 'capital_decrease',
    actionable: true,
    severity: 'high',
    before: 5_000_000,
    after: 1_000_000,
    detail: 'registered capital fell',
    observedAt: OBSERVED,
  };

  it('sends no counterparty data at all under link_only', () => {
    // Some organisations forbid counterparty data in chat apps outright, and
    // discovering that at rollout means rebuilding the notification layer.
    const policy = { ...createStarterProfile('t', 'D').notification, detailLevel: 'link_only' as const };
    const message = renderNotification(change, policy, 'https://x');
    expect(message).not.toContain('Acme');
    expect(message).toContain('https://x/parties/p1');
  });

  it('includes the numbers under full detail', () => {
    const policy = { ...createStarterProfile('t', 'D').notification, detailLevel: 'full' as const };
    expect(renderNotification(change, policy, 'https://x')).toContain('5000000');
  });
});
