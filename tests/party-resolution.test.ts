import { describe, expect, it } from 'vitest';
import { isValidThaiTaxId, nameSimilarity, normalizeTaxId, resolveParties, type PartySourceRow } from '@creditmesh/core';

function row(patch: Partial<PartySourceRow>): PartySourceRow {
  return {
    systemId: 'erp',
    legalEntityCode: 'E01',
    sourceCode: 'C001',
    legalName: 'Acme Trading Co., Ltd.',
    taxId: '0105536000020',
    role: 'customer',
    sourceRef: 'import:erp:2',
    observedAt: '2026-09-03T00:00:00Z',
    ...patch,
  };
}

describe('normalizeTaxId', () => {
  it('strips the punctuation people type', () => {
    expect(normalizeTaxId('0-1055-36000-02-0')).toBe('0105536000020');
    expect(normalizeTaxId('  0105536000020 ')).toBe('0105536000020');
    expect(normalizeTaxId('')).toBeNull();
    expect(normalizeTaxId(null)).toBeNull();
  });
});

describe('isValidThaiTaxId', () => {
  it('accepts a valid check digit and rejects a broken one', () => {
    expect(isValidThaiTaxId('0105536000020')).toBe(true);
    expect(isValidThaiTaxId('0105536000021')).toBe(false);
    expect(isValidThaiTaxId('12345')).toBe(false);
  });
});

describe('nameSimilarity', () => {
  it('ignores legal-form words and punctuation', () => {
    expect(nameSimilarity('Acme Trading Co., Ltd.', 'ACME TRADING COMPANY LIMITED')).toBeGreaterThan(0.9);
  });

  it('keeps genuinely different names apart', () => {
    expect(nameSimilarity('Acme Trading', 'Zenith Logistics')).toBeLessThan(0.3);
  });
});

describe('resolveParties', () => {
  it('folds the same tax id across systems and entities into one party', () => {
    const result = resolveParties([
      row({ systemId: 'erp', legalEntityCode: 'E01', sourceCode: 'C001' }),
      row({ systemId: 'erp', legalEntityCode: 'E02', sourceCode: 'K900' }),
      row({ systemId: 'wms', legalEntityCode: 'E01', sourceCode: 'W-77', role: 'supplier' }),
    ]);

    expect(result.parties).toHaveLength(1);
    const party = result.parties[0]!;
    expect(party.rowCount).toBe(3);
    expect(party.legalEntityCodes.sort()).toEqual(['E01', 'E02']);
    // P3 — one party carries both roles rather than being two registers.
    expect(party.roles.sort()).toEqual(['customer', 'supplier']);
    // Every original code survives; nothing is thrown away in the merge.
    expect(party.identifiers.filter((i) => i.kind === 'source_system').map((i) => i.value).sort())
      .toEqual(['C001', 'K900', 'W-77']);
  });

  it('keeps different tax ids apart even when the names match', () => {
    const result = resolveParties([
      row({ taxId: '0105536000020' }),
      row({ taxId: '0105558000138', sourceCode: 'C002' }),
    ]);
    expect(result.parties).toHaveLength(2);
  });

  it('proposes rather than performs a name-similarity merge', () => {
    const result = resolveParties([
      row({ taxId: null, sourceCode: 'C001', legalName: 'Acme Trading Co., Ltd.', systemId: 'a' }),
      row({ taxId: null, sourceCode: 'C002', legalName: 'Acme Trading Company Limited', systemId: 'b' }),
    ]);
    expect(result.parties).toHaveLength(2);
    expect(result.mergeCandidates).toHaveLength(1);
    expect(result.mergeCandidates[0]!.score).toBeGreaterThan(0.86);
  });

  it('warns about a failed check digit without dropping the row', () => {
    const result = resolveParties([row({ taxId: '0105536000021' })]);
    expect(result.parties).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).toContain('invalid_tax_id_checksum');
  });

  it('warns when the same tax id carries two unrelated names', () => {
    const result = resolveParties([
      row({ legalName: 'Acme Trading Co., Ltd.' }),
      row({ legalName: 'Zenith Logistics Public Company', sourceCode: 'C002' }),
    ]);
    expect(result.warnings.map((w) => w.code)).toContain('tax_id_name_conflict');
    expect(result.parties).toHaveLength(1);
  });

  it('marks a party resolved without a tax id as a weak key', () => {
    const result = resolveParties([row({ taxId: null })]);
    expect(result.parties[0]!.weakKey).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('missing_tax_id');
  });
});
