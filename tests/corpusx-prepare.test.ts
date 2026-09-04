import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs script, no types
import { mergeRegistry } from '../scripts/corpusx-prepare.mjs';

/**
 * One company arrives through two files that disagree about how much they
 * know. Which one wins is decided per field, not per file.
 */
describe('merging the two CorpusX sources', () => {
  const pdf = {
    legalStatus: 'ยังดำเนินกิจการอยู่',
    registeredCapital: 480000000,
    registrationDate: '2004-09-21',
    registeredAddress: '1/2 ถนนสมมติ',
    industryCode: '68101',
  };
  const workbook = {
    legalStatus: 'Active',
    registeredCapital: 480000000,
    registrationDate: '2004-09-21',
    registeredAddress: '',
    industryCode: '',
  };

  it('takes the PDF where both have an answer', () => {
    // The registry's own wording, not the workbook's English summary of it.
    expect(mergeRegistry('X', pdf, workbook).legalStatus).toBe('ยังดำเนินกิจการอยู่');
  });

  it('takes the address and TSIC the workbook never carries', () => {
    const row = mergeRegistry('X', pdf, workbook);
    expect(row.registeredAddress).toBe('1/2 ถนนสมมติ');
    expect(row.industryCode).toBe('68101');
  });

  it('falls back to the workbook where the PDF is absent', () => {
    // Only the .xlsx was downloaded for this company.
    const row = mergeRegistry('X', null, workbook);
    expect(row.legalStatus).toBe('Active');
    expect(row.registeredCapital).toBe(480000000);
    // And says nothing rather than inventing what neither source has.
    expect(row.registeredAddress).toBe('');
    expect(row.industryCode).toBe('');
  });

  it('falls back field by field, not file by file', () => {
    // A profile page that read partially must not wipe out what the workbook
    // does know.
    const partial = { legalStatus: '', registeredCapital: '', registrationDate: '', registeredAddress: 'somewhere', industryCode: '' };
    const row = mergeRegistry('X', partial, workbook);
    expect(row.legalStatus).toBe('Active');
    expect(row.registrationDate).toBe('2004-09-21');
    expect(row.registeredAddress).toBe('somewhere');
  });
});
