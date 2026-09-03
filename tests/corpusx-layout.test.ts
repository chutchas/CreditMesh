import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs script, no types
import { statementColumns, valueAt, excelDate } from '../scripts/corpusx-to-csv.mjs';

/**
 * Two bugs in reading CorpusX workbooks, both of which produced output that
 * looked like data. Neither would have failed a schema check, which is exactly
 * why they need a test rather than a validator.
 */

const grid = (entries: [number, number, string | number][]) =>
  new Map(entries.map(([r, c, v]) => [`${r},${c}`, v] as const));

describe('CorpusX sheet layout', () => {
  const header = grid([
    [1, 3, 'วันที่งบการเงิน'],
    [1, 4, '31/12/2025'],
    [1, 5, '%'],
    [1, 6, '31/12/2024'],
    [1, 7, '%'],
    [1, 8, '31/12/2023'],
  ]);

  it('reads a date header row into fiscal years', () => {
    expect(statementColumns(header).map((c: { fiscalYear: number }) => c.fiscalYear)).toEqual([2025, 2024, 2023]);
    expect(statementColumns(header)[0].periodEnd).toBe('2025-12-31');
  });

  it('lets the newest year take the column before its header', () => {
    const columns = statementColumns(header);
    // The header for 2025 is in column 4, but the value may be in either 3 or 4.
    expect(columns[0].valueColumns).toEqual([3, 4]);
    // Older years are only ever in their own column — falling back one to the
    // left there would pick up the previous year's percentage.
    expect(columns[1].valueColumns).toEqual([6]);
    expect(columns[2].valueColumns).toEqual([8]);
  });

  it('finds the newest value whichever of the two columns holds it', () => {
    const bsStyle = grid([[9, 3, 18130.1], [9, 5, 0.0043]]);
    const icStyle = grid([[9, 4, 1120539.63], [9, 5, 0.0776]]);
    expect(valueAt(bsStyle, 9, [3, 4])).toBe(18130.1);
    expect(valueAt(icStyle, 9, [3, 4])).toBe(1120539.63);
    expect(valueAt(grid([]), 9, [3, 4])).toBe('');
  });

  it('does not read a percentage as a value for an older year', () => {
    // Column 5 is 2025's percentage. A 2024 row with no value must stay empty.
    const cells = grid([[9, 5, 0.0043]]);
    expect(valueAt(cells, 9, [6])).toBe('');
  });

  it('turns an Excel day count into a date', () => {
    expect(excelDate(36557)).toBe('2000-02-01');
    expect(excelDate(33613)).toBe('1992-01-10');
    // Already a date on the sheet — dd/mm/yyyy, and Buddhist-era on some sheets.
    expect(excelDate('29/05/2026')).toBe('2026-05-29');
    expect(excelDate('29/05/2569')).toBe('2026-05-29');
    expect(excelDate(undefined)).toBe('');
  });
});
