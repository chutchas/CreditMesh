import { describe, expect, it } from 'vitest';
import {
  buildLossMatrix,
  computeProvision,
  detectRelatedParties,
  findWhiteSpace,
  scoreProspects,
  summariseProvision,
  summariseWhiteSpace,
  type AgingCohort,
  type CustomerFootprint,
  type ProspectCandidate,
  type ProvisionInput,
  type SupplierPersonLink,
  type SupplierRecord,
} from '@creditmesh/core';

const ASOF = '2026-09-03';

/* Module 8 ------------------------------------------------------------- */

function supplier(patch: Partial<SupplierRecord> & { partyId: string }): SupplierRecord {
  return {
    legalName: `Supplier ${patch.partyId}`,
    taxId: null,
    registeredAddressNorm: null,
    annualSpend: 1_000_000,
    ...patch,
  };
}

const relatedOptions = { excludedPersons: [], excludedAddresses: [], nomineeThreshold: 5, asOf: ASOF };

describe('detectRelatedParties', () => {
  it('surfaces several suppliers behind one shareholder', () => {
    const links: SupplierPersonLink[] = [
      { personName: 'สมชาย รัตนวงศ์', partyId: 's1', role: 'shareholder', sharePct: 60 },
      { personName: 'สมชาย รัตนวงศ์', partyId: 's2', role: 'shareholder', sharePct: 55 },
    ];
    const findings = detectRelatedParties([supplier({ partyId: 's1' }), supplier({ partyId: 's2' })], [], links, relatedOptions);
    expect(findings[0]!.code).toBe('common_owner_suppliers');
    expect(findings[0]!.linkStrength).toBe(0.9);
    expect(findings[0]!.summary).toContain('bid separately');
  });

  it('ignores a professional director sitting on many boards', () => {
    // Reporting the accountant who sits on twelve boards is how this module
    // loses its audience in week one.
    const links: SupplierPersonLink[] = Array.from({ length: 8 }, (_, i) => ({
      personName: 'นอมินี ก',
      partyId: `s${i}`,
      role: 'director' as const,
      sharePct: null,
    }));
    const suppliers = links.map((l) => supplier({ partyId: l.partyId }));
    expect(detectRelatedParties(suppliers, [], links, relatedOptions)).toHaveLength(0);
  });

  it('honours the tenant’s own exclusion list', () => {
    const links: SupplierPersonLink[] = [
      { personName: 'สมชาย รัตนวงศ์', partyId: 's1', role: 'director', sharePct: null },
      { personName: 'สมชาย รัตนวงศ์', partyId: 's2', role: 'director', sharePct: null },
    ];
    const findings = detectRelatedParties(
      [supplier({ partyId: 's1' }), supplier({ partyId: 's2' })],
      [],
      links,
      { ...relatedOptions, excludedPersons: ['สมชาย รัตนวงศ์'] },
    );
    expect(findings).toHaveLength(0);
  });

  it('rates a shared address as the weak signal it is', () => {
    const findings = detectRelatedParties(
      [
        supplier({ partyId: 's1', registeredAddressNorm: '99 sathorn' }),
        supplier({ partyId: 's2', registeredAddressNorm: '99 sathorn' }),
      ],
      [],
      [],
      relatedOptions,
    );
    expect(findings[0]!.code).toBe('shared_registered_address');
    // Companies share buildings. This corroborates; it does not accuse.
    expect(findings[0]!.linkStrength).toBeLessThan(0.5);
    expect(findings[0]!.summary).toContain('companies share buildings');
  });

  it('marks every finding as audit-restricted', () => {
    const findings = detectRelatedParties(
      [supplier({ partyId: 's1', taxId: '0105536000020' })],
      [{ partyId: null, legalName: 'Our Trading Arm', taxId: '0105536000020' }],
      [],
      relatedOptions,
    );
    expect(findings[0]!.code).toBe('supplier_in_own_group');
    expect(findings.every((f) => f.restrictedToAudit === true)).toBe(true);
  });
});

/* Module 10 ------------------------------------------------------------ */

describe('buildLossMatrix', () => {
  it('refuses to derive a rate from too little history', () => {
    const cohorts: AgingCohort[] = [
      { bucketCode: 'd90_plus', openingBalance: 200_000, writtenOff: 100_000, observedFrom: '2025-01-01', observedTo: ASOF },
    ];
    const matrix = buildLossMatrix(cohorts, { minObservationBase: 1_000_000, minCohorts: 1 });
    expect(matrix[0]!.ratePct).toBeNull();
    expect(matrix[0]!.note).toContain('too thin');
  });

  it('derives a rate once the base is big enough', () => {
    const matrix = buildLossMatrix(
      [{ bucketCode: 'd90_plus', openingBalance: 10_000_000, writtenOff: 1_500_000, observedFrom: '2024-01-01', observedTo: ASOF }],
      { minObservationBase: 1_000_000, minCohorts: 1 },
    );
    expect(matrix[0]!.ratePct).toBe(15);
  });
});

describe('computeProvision', () => {
  const matrix = buildLossMatrix(
    [
      { bucketCode: 'd1_30', openingBalance: 20_000_000, writtenOff: 200_000, observedFrom: '2024-01-01', observedTo: ASOF },
      { bucketCode: 'd90_plus', openingBalance: 10_000_000, writtenOff: 2_000_000, observedFrom: '2024-01-01', observedTo: ASOF },
    ],
    { minObservationBase: 1_000_000, minCohorts: 1 },
  );

  function input(patch: Partial<ProvisionInput> = {}): ProvisionInput {
    return {
      partyId: 'p1',
      partyName: 'Acme',
      legalEntityCode: 'E01',
      buckets: [
        { bucketCode: 'd1_30', amount: 1_000_000 },
        { bucketCode: 'd90_plus', amount: 500_000 },
      ],
      currency: 'THB',
      securedAmount: 0,
      grade: 'C',
      hasCriticalLegalEvent: false,
      ...patch,
    };
  }

  it('leaves an unrated bucket unprovisioned and says so loudly', () => {
    // The failure this guards: zero on an unrated bucket looks identical to a
    // genuine zero once it is inside a total.
    const line = computeProvision(
      input({ buckets: [{ bucketCode: 'd31_60', amount: 800_000 }] }),
      matrix,
      { forwardLookingPct: 0, specificProvisionPct: 100, deductCollateral: true },
    );
    expect(line.proposedProvision).toBe(0);
    expect(line.unratedExposure).toBe(800_000);
    expect(line.notes.join(' ')).toContain('NOT provisioned');
  });

  it('deducts collateral before applying the rates', () => {
    const unsecured = computeProvision(input(), matrix, { forwardLookingPct: 0, specificProvisionPct: 100, deductCollateral: true });
    const secured = computeProvision(input({ securedAmount: 750_000 }), matrix, {
      forwardLookingPct: 0,
      specificProvisionPct: 100,
      deductCollateral: true,
    });
    expect(secured.proposedProvision).toBeLessThan(unsecured.proposedProvision);
    expect(secured.exposureAtDefault).toBe(750_000);
  });

  it('applies the forward-looking overlay as a stated input', () => {
    const flat = computeProvision(input(), matrix, { forwardLookingPct: 0, specificProvisionPct: 100, deductCollateral: true });
    const uplifted = computeProvision(input(), matrix, { forwardLookingPct: 20, specificProvisionPct: 100, deductCollateral: true });
    expect(uplifted.proposedProvision).toBeCloseTo(flat.proposedProvision * 1.2, 1);
  });

  it('replaces the collective calculation on confirmed insolvency', () => {
    const line = computeProvision(input({ hasCriticalLegalEvent: true }), matrix, {
      forwardLookingPct: 50,
      specificProvisionPct: 100,
      deductCollateral: true,
    });
    expect(line.specificProvision).toBe(1_500_000);
    expect(line.proposedProvision).toBe(1_500_000);
    expect(line.notes.join(' ')).toContain('specific provision');
  });

  it('reports the unrated balance in the portfolio summary', () => {
    const lines = [
      computeProvision(input(), matrix, { forwardLookingPct: 0, specificProvisionPct: 100, deductCollateral: true }),
      computeProvision(input({ partyId: 'p2', buckets: [{ bucketCode: 'd31_60', amount: 400_000 }] }), matrix, {
        forwardLookingPct: 0,
        specificProvisionPct: 100,
        deductCollateral: true,
      }),
    ];
    const summary = summariseProvision(lines, matrix);
    expect(summary.unratedExposure).toBe(400_000);
    expect(summary.parties).toBe(2);
  });
});

/* Module 6 ------------------------------------------------------------- */

describe('findWhiteSpace', () => {
  function footprint(patch: Partial<CustomerFootprint> & { partyId: string }): CustomerFootprint {
    return {
      partyName: `Customer ${patch.partyId}`,
      entities: [{ legalEntityCode: 'E01', revenue: 1_000_000, sinceDate: null }],
      grade: 'B',
      overdueAnywhere: 0,
      ...patch,
    };
  }

  it('lists a caution rather than hiding the counterparty', () => {
    // Filtering silently leaves sales wondering why an obvious name is missing,
    // and credit's reason is exactly what they need before calling.
    const items = findWhiteSpace([footprint({ partyId: 'p1', overdueAnywhere: 900_000 })], ['E01', 'E02'], {
      minRevenueToRank: 0,
      worstGradeCode: 'E',
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.cautions[0]).toContain('past due');
  });

  it('skips counterparties already in every entity', () => {
    const items = findWhiteSpace(
      [
        footprint({
          partyId: 'p1',
          entities: [
            { legalEntityCode: 'E01', revenue: 1_000_000, sinceDate: null },
            { legalEntityCode: 'E02', revenue: 500_000, sinceDate: null },
          ],
        }),
      ],
      ['E01', 'E02'],
      { minRevenueToRank: 0, worstGradeCode: 'E' },
    );
    expect(items).toHaveLength(0);
  });

  it('ranks by spend today weighted by how much of the group they have not met', () => {
    const items = findWhiteSpace(
      [
        footprint({ partyId: 'big-narrow', entities: [{ legalEntityCode: 'E01', revenue: 5_000_000, sinceDate: null }] }),
        footprint({
          partyId: 'small-wide',
          entities: [{ legalEntityCode: 'E01', revenue: 200_000, sinceDate: null }],
        }),
      ],
      ['E01', 'E02', 'E03'],
      { minRevenueToRank: 0, worstGradeCode: 'E' },
    );
    expect(items[0]!.partyId).toBe('big-narrow');
  });

  it('summarises which entity has the most to gain', () => {
    const items = findWhiteSpace(
      [
        footprint({ partyId: 'p1', entities: [{ legalEntityCode: 'E01', revenue: 3_000_000, sinceDate: null }] }),
        footprint({ partyId: 'p2', entities: [{ legalEntityCode: 'E02', revenue: 1_000_000, sinceDate: null }] }),
      ],
      ['E01', 'E02'],
      { minRevenueToRank: 0, worstGradeCode: 'E' },
    );
    const summary = summariseWhiteSpace(items);
    expect(summary.byEntity[0]!.legalEntityCode).toBe('E02');
    expect(summary.counterparties).toBe(2);
  });
});

describe('scoreProspects', () => {
  function candidate(patch: Partial<ProspectCandidate> = {}): ProspectCandidate {
    return {
      legalName: 'Prospect Co Ltd',
      taxId: '0105599000111',
      industryCode: '46900',
      registeredCapital: 10_000_000,
      revenue: 100_000_000,
      netProfit: 6_000_000,
      equity: 40_000_000,
      providerId: 'manual_upload',
      retrievedAt: ASOF,
      ...patch,
    };
  }

  const options = {
    currency: 'THB',
    limitAsPctOfRevenue: 5,
    maxIndicativeLimit: 10_000_000,
    knownTaxIds: new Set(['0105536000020']),
  };

  it('refuses an indicative limit where the accounts do not support one', () => {
    // This list goes to sales, who will quote the number. An opening figure
    // that turns out to be indefensible costs credit more standing than none.
    const [scored] = scoreProspects([candidate({ equity: -5_000_000 })], options);
    expect(scored!.indicativeLimit).toBeNull();
    expect(scored!.reasons.join(' ')).toContain('negative or nil equity');
  });

  it('produces no score at all on incomplete accounts', () => {
    const [scored] = scoreProspects([candidate({ revenue: null })], options);
    expect(scored!.strengthScore).toBeNull();
    expect(scored!.indicativeLimit).toBeNull();
  });

  it('caps the indicative limit at equity and at the tenant ceiling', () => {
    const [scored] = scoreProspects([candidate({ revenue: 900_000_000, equity: 8_000_000 })], options);
    // 5% of revenue is 45M, the ceiling is 10M, equity is 8M — the smallest wins.
    expect(scored!.indicativeLimit).toBe(8_000_000);
  });

  it('marks a candidate we already deal with', () => {
    const [scored] = scoreProspects([candidate({ taxId: '0105536000020' })], options);
    expect(scored!.alreadyKnown).toBe(true);
  });
});
