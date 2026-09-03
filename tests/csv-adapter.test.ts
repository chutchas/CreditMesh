import { describe, expect, it } from 'vitest';
import { autoMapHeaders, coerceDate, coerceNumber, getDataset, importCsv, parseCsv } from '@creditmesh/adapters';

describe('parseCsv', () => {
  it('handles quoted delimiters, embedded newlines and doubled quotes', () => {
    const csv = 'a,b\n"Acme, Ltd.","line1\nline2"\n"say ""hi""",2\n';
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(['a', 'b']);
    expect(parsed.rows[0]!.values.a).toBe('Acme, Ltd.');
    expect(parsed.rows[0]!.values.b).toBe('line1\nline2');
    expect(parsed.rows[1]!.values.a).toBe('say "hi"');
  });

  it('strips the BOM Excel writes and copes with CRLF', () => {
    const parsed = parseCsv('﻿name,amount\r\nAcme,10\r\n');
    expect(parsed.headers).toEqual(['name', 'amount']);
    expect(parsed.rows).toHaveLength(1);
  });

  it('detects semicolon files', () => {
    const parsed = parseCsv('name;amount\nAcme;10\n');
    expect(parsed.delimiter).toBe(';');
    expect(parsed.rows[0]!.values.amount).toBe('10');
  });

  it('numbers rows the way the spreadsheet does', () => {
    const parsed = parseCsv('name\nA\nB\n');
    expect(parsed.rows.map((r) => r.rowNumber)).toEqual([2, 3]);
  });
});

describe('coerceNumber', () => {
  it('reads the shapes spreadsheets actually produce', () => {
    expect(coerceNumber('1,234.50')).toEqual({ ok: true, value: 1234.5 });
    expect(coerceNumber('(1,234.50)')).toEqual({ ok: true, value: -1234.5 });
    expect(coerceNumber('1234.50-')).toEqual({ ok: true, value: -1234.5 });
    expect(coerceNumber('')).toEqual({ ok: true, value: null });
    expect(coerceNumber('n/a')).toEqual({ ok: true, value: null });
  });

  it('refuses text rather than silently producing zero', () => {
    expect(coerceNumber('abc').ok).toBe(false);
  });
});

describe('coerceDate', () => {
  it('reads ISO and day-first forms', () => {
    expect(coerceDate('2026-07-01')).toEqual({ ok: true, value: '2026-07-01' });
    expect(coerceDate('01/07/2026')).toEqual({ ok: true, value: '2026-07-01' });
    expect(coerceDate('01/07/2026', { order: 'mdy' })).toEqual({ ok: true, value: '2026-01-07' });
  });

  it('converts Buddhist-era years', () => {
    expect(coerceDate('01/07/2569')).toEqual({ ok: true, value: '2026-07-01' });
  });

  it('rejects a date that does not exist', () => {
    expect(coerceDate('31/02/2026').ok).toBe(false);
  });
});

describe('autoMapHeaders', () => {
  it('maps Thai and English headers without configuration', () => {
    const spec = getDataset('party')!;
    const result = autoMapHeaders(spec, ['รหัสบริษัท', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'เลขผู้เสียภาษี', 'notes']);
    expect(result.missingRequired).toEqual([]);
    expect(result.unmappedHeaders).toEqual(['notes']);
  });

  it('reports what a file is missing instead of importing half of it', () => {
    const spec = getDataset('party')!;
    const result = autoMapHeaders(spec, ['name']);
    expect(result.missingRequired).toContain('sourceCode');
  });
});

describe('importCsv', () => {
  const header = 'entity,customer_code,customer_name,tax_id\n';

  it('accepts a clean file and defaults the role', () => {
    const result = importCsv(`${header}E01,C001,Acme Trading Co Ltd,0105536000020\n`, {
      datasetId: 'party',
      systemId: 'csv',
    });
    expect(result.report.rowsAccepted).toBe(1);
    expect(result.rows[0]!.role).toBe('customer');
    expect(result.rows[0]!.legalEntityCode).toBe('E01');
  });

  it('rejects the bad row and keeps the good one, citing the spreadsheet row', () => {
    const csv =
      'entity,customer_code,customer_name,tax_id,due_date\n' +
      'E01,C001,Acme,0105536000020,2026-07-01\n' +
      'E01,,Missing Code,0105536000020,2026-07-01\n';
    const result = importCsv(csv, { datasetId: 'party', systemId: 'csv', maxRejectRate: 0.9 });
    expect(result.report.rowsAccepted).toBe(1);
    expect(result.report.rowsRejected).toBe(1);
    expect(result.report.errors[0]!.rowNumber).toBe(3);
    expect(result.report.errors[0]!.code).toBe('missing_required');
  });

  it('applies nothing when a required column is absent from the file', () => {
    const result = importCsv('name\nAcme\n', { datasetId: 'party', systemId: 'csv' });
    expect(result.rows).toHaveLength(0);
    expect(result.report.errors.some((e) => e.code === 'missing_required')).toBe(true);
  });

  it('refuses a file that is mostly broken rather than half-importing it', () => {
    const rows = Array.from({ length: 10 }, (_, i) => `E01,,Broken ${i},x\n`).join('');
    const result = importCsv(`${header}${rows}`, { datasetId: 'party', systemId: 'csv' });
    expect(result.rows).toHaveLength(0);
    expect(result.report.rowsAccepted).toBe(0);
    expect(result.report.warnings.join(' ')).toMatch(/ceiling/);
  });

  it('defaults amountBase to amount when the file has one currency column', () => {
    const csv =
      'entity,customer_code,document_no,invoice_date,due_date,amount\n' +
      'E01,C001,INV-1,01/06/2026,01/07/2026,"1,500.00"\n';
    const result = importCsv(csv, { datasetId: 'ar_item', systemId: 'csv', defaultCurrency: 'THB' });
    expect(result.report.rowsAccepted).toBe(1);
    expect(result.rows[0]!.amount).toBe(1500);
    expect(result.rows[0]!.amountBase).toBe(1500);
    expect(result.rows[0]!.currency).toBe('THB');
  });
});
