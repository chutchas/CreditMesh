import { describe, expect, it } from 'vitest';
import {
  createStarterProfile,
  maskPersonIdentifier,
  matchLegalResult,
  screeningDue,
  severityFor,
  summariseLegalScreening,
  type LegalSearchResult,
  type ScreeningParty,
  type StoredLegalEvent,
} from '@creditmesh/core';

const policy = createStarterProfile('t', 'Demo').legalScreening;

const parties: ScreeningParty[] = [
  { partyId: 'p1', legalName: 'Northgate Steel Trading Co Ltd', taxId: '0105536000020', registrationNo: null },
  { partyId: 'p2', legalName: 'Harbour Chemicals Co Ltd', taxId: '0107537000122', registrationNo: null },
  { partyId: 'p3', legalName: 'Siam Metalwork Co Ltd', taxId: null, registrationNo: 'REG-99001' },
];

function result(patch: Partial<LegalSearchResult> = {}): LegalSearchResult {
  return {
    caseNo: 'ล 1/2569',
    source: 'led',
    eventType: 'bankruptcy',
    subjectType: 'party',
    subjectName: 'Harbour Chemicals Co Ltd',
    subjectIdentifier: '0107537000122',
    eventDate: '2026-05-08',
    publishedDate: '2026-05-15',
    court: 'ศาลล้มละลายกลาง',
    detail: null,
    ...patch,
  };
}

describe('matchLegalResult', () => {
  it('links on a taxpayer id', () => {
    const m = matchLegalResult(result(), parties, policy);
    expect(m.partyId).toBe('p2');
    expect(m.matchBasis).toBe('tax_id');
  });

  it('links on a registration number when there is no taxpayer id', () => {
    const m = matchLegalResult(
      result({ subjectName: 'Siam Metalwork Co Ltd', subjectIdentifier: 'REG-99001' }),
      parties,
      policy,
    );
    // normalizeTaxId keeps digits only, so REG-99001 and 99001 are the same key.
    expect(m.partyId).toBe('p3');
    expect(m.matchBasis).toBe('registration_no');
  });

  it('refuses an identical name with no identifier', () => {
    const m = matchLegalResult(
      result({ subjectName: 'Harbour Chemicals Co Ltd', subjectIdentifier: null }),
      parties,
      policy,
    );
    expect(m.partyId).toBeNull();
    expect(m.matchBasis).toBe('unmatched');
    expect(m.needsReview).toBe(true);
    // The near-match still travels with it, so the reviewer has a starting point.
    expect(m.nameCandidates[0]?.partyId).toBe('p2');
  });

  it('refuses a near-identical name when the identifier is one digit off', () => {
    // The case that makes this module worth building carefully: everything
    // looks right except the number, and the number is the only thing that
    // decides. Trusting the name here stops the wrong company's orders.
    const m = matchLegalResult(
      result({ subjectName: 'Northgate Steel Trading Company Limited', subjectIdentifier: '0105536000021' }),
      parties,
      policy,
    );
    expect(m.partyId).toBeNull();
    expect(m.matchNote).toContain('not in the register');
  });

  it('records name_only as the basis when an organisation switches the guard off', () => {
    const relaxed = { ...policy, requireIdentifierMatch: false };
    const m = matchLegalResult(
      result({ subjectName: 'Harbour Chemicals Co Ltd', subjectIdentifier: null }),
      parties,
      relaxed,
    );
    expect(m.partyId).toBe('p2');
    expect(m.matchBasis).toBe('name_only');
    // Still needs a human even then — the basis is recorded so no downstream
    // screen can mistake this for a verified link.
    expect(m.needsReview).toBe(true);
  });

  it('takes severity from the tenant policy, not a constant', () => {
    expect(severityFor('bankruptcy', policy)).toBe('critical');
    expect(severityFor('litigation', policy)).toBe('medium');
    expect(severityFor('something_new', policy)).toBe('medium');
    const custom = { ...policy, severityMap: { ...policy.severityMap, litigation: 'critical' as const } };
    expect(severityFor('litigation', custom)).toBe('critical');
  });
});

describe('maskPersonIdentifier', () => {
  it('never returns the whole number', () => {
    expect(maskPersonIdentifier('3101200456789', 'last4')).toBe('6789');
    expect(maskPersonIdentifier('3101200456789', 'none')).toBeNull();
    const hashed = maskPersonIdentifier('3101200456789', 'hash');
    expect(hashed).not.toContain('3101200456789');
    // Stable, so the same person is recognised across two uploads.
    expect(hashed).toBe(maskPersonIdentifier('3-1012-00456-78-9', 'hash'));
  });
});

describe('screeningDue', () => {
  it('treats never-screened as due now, not due in a frequency window', () => {
    const due = screeningDue(
      [{ partyId: 'p1', legalName: 'A', grade: 'A', lastScreenedAt: null }],
      policy,
      '2026-09-03',
    );
    expect(due).toHaveLength(1);
    expect(due[0]!.overdueDays).toBe(365);
  });

  it('screens worse grades more often and sorts by how overdue they are', () => {
    const due = screeningDue(
      [
        { partyId: 'good', legalName: 'A', grade: 'A', lastScreenedAt: '2026-06-01' },
        { partyId: 'bad', legalName: 'B', grade: 'E', lastScreenedAt: '2026-06-01' },
      ],
      policy,
      '2026-09-03',
    );
    // Grade A is on a 365-day cycle and not due; grade E is on 30 days.
    expect(due.map((d) => d.partyId)).toEqual(['bad']);
    expect(due[0]!.dueEveryDays).toBe(30);
  });
});

describe('summariseLegalScreening', () => {
  it('counts confirmed events only as facts, and rejected ones not at all', () => {
    const events: StoredLegalEvent[] = [
      { partyId: 'p1', eventType: 'bankruptcy', severity: 'critical', reviewStatus: 'confirmed', matchBasis: 'tax_id' },
      { partyId: 'p1', eventType: 'litigation', severity: 'medium', reviewStatus: 'pending', matchBasis: 'tax_id' },
      { partyId: null, eventType: 'litigation', severity: 'medium', reviewStatus: 'pending', matchBasis: 'unmatched' },
      { partyId: 'p2', eventType: 'bankruptcy', severity: 'critical', reviewStatus: 'rejected', matchBasis: 'name_only' },
    ];
    const s = summariseLegalScreening(events);
    expect(s.confirmedEvents).toBe(1);
    expect(s.pendingReview).toBe(2);
    expect(s.unmatched).toBe(1);
    expect(s.criticalParties).toBe(1);
    // The rejected critical event contributes nothing — a reviewer already
    // said it is not this company.
    expect(s.bySeverity.critical).toBe(1);
  });
});
