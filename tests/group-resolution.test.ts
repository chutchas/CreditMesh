import { describe, expect, it } from 'vitest';
import {
  createStarterProfile,
  normalizeAddress,
  normalizePersonName,
  resolveGroups,
  type CompanyShareholding,
  type GroupResolutionParty,
  type PersonLink,
} from '@creditmesh/core';

const profile = createStarterProfile('t', 'Demo');

const party = (id: string, name: string, address: string | null = null): GroupResolutionParty => ({
  partyId: id,
  legalName: name,
  taxId: `010553600${id.padStart(4, '0')}`,
  registeredAddress: address,
});

const director = (personKey: string, personName: string, partyId: string): PersonLink => ({
  personKey,
  personName,
  partyId,
  role: 'director',
  sharePct: null,
});

const shareholder = (personKey: string, personName: string, partyId: string, sharePct = 50): PersonLink => ({
  personKey,
  personName,
  partyId,
  role: 'shareholder',
  sharePct,
});

describe('normalizePersonName', () => {
  it('strips honorifics so one person spelled two ways still matches', () => {
    expect(normalizePersonName('นาย สมชาย ใจดี')).toBe(normalizePersonName('สมชาย ใจดี'));
    expect(normalizePersonName('Mr. John Smith')).toBe(normalizePersonName('John Smith'));
  });
});

describe('normalizeAddress', () => {
  it('ignores punctuation and spacing only', () => {
    expect(normalizeAddress('123/4  Rama IV Rd., Bangkok')).toBe('123 4 rama iv rd bangkok');
  });
});

describe('resolveGroups', () => {
  const asOf = { observedAt: '2026-09-03T00:00:00Z' };

  it('proposes a group from a shared director', () => {
    const result = resolveGroups(
      [party('1', 'Alpha Trading'), party('2', 'Beta Trading')],
      [director('p1', 'สมชาย ใจดี', '1'), director('p1', 'สมชาย ใจดี', '2')],
      [],
      profile,
      asOf,
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.memberPartyIds).toEqual(['1', '2']);
    expect(result.groups[0]!.confidence).toBeCloseTo(0.3, 3);
    expect(result.groups[0]!.evidence.length).toBeGreaterThan(0);
  });

  it('never proposes a group from a shared address alone', () => {
    // An address is usually a building. On its own it must corroborate, never
    // conclude — this is the single most common source of false positives.
    const result = resolveGroups(
      [party('1', 'Alpha Trading', '99 Sathorn Rd'), party('2', 'Beta Trading', '99 Sathorn Rd')],
      [],
      [],
      profile,
      asOf,
    );
    expect(result.groups).toHaveLength(0);
    expect(result.stats.edgesBelowThreshold).toBe(1);
  });

  it('combines two weak signals into something worth reviewing', () => {
    const shared = [party('1', 'Alpha Trading', '99 Sathorn Rd'), party('2', 'Beta Trading', '99 Sathorn Rd')];
    const withDirector = resolveGroups(
      shared,
      [director('p1', 'สมชาย ใจดี', '1'), director('p1', 'สมชาย ใจดี', '2')],
      [],
      profile,
      asOf,
    );
    // 1 - (1-0.3)(1-0.15) = 0.405: more than the director alone, less than certainty.
    expect(withDirector.groups[0]!.confidence).toBeCloseTo(0.405, 3);
  });

  it('ignores a nominee director rather than fusing the portfolio', () => {
    const parties = Array.from({ length: 15 }, (_, i) => party(String(i + 1), `Company ${i + 1}`));
    const links = parties.map((p) => director('nominee', 'กรรมการรับจ้าง', p.partyId));

    const result = resolveGroups(parties, links, [], profile, { ...asOf, nomineePersonThreshold: 10 });

    expect(result.groups).toHaveLength(0);
    expect(result.stats.hubPersonsIgnored).toBe(1);
    // And it says so, so the exclusion list gets built from real data.
    expect(result.suggestedExclusions[0]).toMatchObject({ kind: 'person', partyCount: 15, applied: true });
  });

  it('ignores a serviced building the same way', () => {
    const parties = Array.from({ length: 8 }, (_, i) => party(String(i + 1), `Tenant ${i + 1}`, '1 Office Tower'));
    const result = resolveGroups(parties, [], [], profile, { ...asOf, sharedAddressThreshold: 5 });

    expect(result.stats.hubAddressesIgnored).toBe(1);
    expect(result.suggestedExclusions.some((s) => s.kind === 'address')).toBe(true);
  });

  it('honours the tenant’s own exclusion list', () => {
    const tuned = structuredClone(profile);
    tuned.groupResolution.excludedPersons = ['นาย สมชาย ใจดี'];

    const result = resolveGroups(
      [party('1', 'Alpha Trading'), party('2', 'Beta Trading')],
      [director('p1', 'สมชาย ใจดี', '1'), director('p1', 'สมชาย ใจดี', '2')],
      [],
      tuned,
      asOf,
    );
    expect(result.groups).toHaveLength(0);
  });

  it('follows a company shareholding between two counterparties', () => {
    const holdings: CompanyShareholding[] = [{ holderPartyId: '1', ownedPartyId: '2', sharePct: 70 }];
    const result = resolveGroups([party('1', 'Holdco'), party('2', 'Opco')], [], holdings, profile, asOf);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.confidence).toBeCloseTo(0.5, 3);
    expect(result.groups[0]!.edges[0]!.signals[0]!.detail).toContain('70%');
  });

  it('scores a group by its weakest link, not its strongest', () => {
    // A ↔ B by shareholder (0.5), B ↔ C by director (0.3). The chain is only
    // as good as the director edge, so C could be wrongly attached.
    const result = resolveGroups(
      [party('1', 'Alpha'), party('2', 'Beta'), party('3', 'Gamma')],
      [
        shareholder('p1', 'Owner One', '1'),
        shareholder('p1', 'Owner One', '2'),
        director('p2', 'Director Two', '2'),
        director('p2', 'Director Two', '3'),
      ],
      [],
      profile,
      asOf,
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.memberPartyIds).toEqual(['1', '2', '3']);
    expect(result.groups[0]!.confidence).toBeCloseTo(0.3, 3);
  });

  it('produces nothing from a signal the tenant switched off', () => {
    const tuned = structuredClone(profile);
    tuned.groupResolution.signalsEnabled = ['shareholder'];

    const result = resolveGroups(
      [party('1', 'Alpha Trading'), party('2', 'Beta Trading')],
      [director('p1', 'สมชาย ใจดี', '1'), director('p1', 'สมชาย ใจดี', '2')],
      [],
      tuned,
      asOf,
    );
    expect(result.groups).toHaveLength(0);
  });

  it('attaches evidence to every edge it keeps', () => {
    const result = resolveGroups(
      [party('1', 'Alpha'), party('2', 'Beta')],
      [shareholder('p1', 'Owner One', '1', 60), shareholder('p1', 'Owner One', '2', 40)],
      [],
      profile,
      asOf,
    );
    const evidence = result.groups[0]!.evidence;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.code).toBe('group_shareholder');
    expect(evidence[0]!.sourceRef).toContain('party:1');
    expect(evidence[0]!.observedAt).toBe('2026-09-03T00:00:00Z');
  });

  it('leaves unconnected counterparties out entirely', () => {
    const result = resolveGroups([party('1', 'Alpha'), party('2', 'Beta'), party('3', 'Lonely')], [], [], profile, asOf);
    expect(result.groups).toHaveLength(0);
    expect(result.stats.partiesConsidered).toBe(3);
  });
});
