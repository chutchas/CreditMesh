/**
 * Minimal RFC-4180 CSV reader.
 *
 * Written out rather than pulled in because the failure modes that matter here
 * are the boring ones a dependency would also have to be configured for: a BOM
 * from Excel on Windows, CRLF, quoted fields containing commas and newlines,
 * and doubled quotes. Users export from a spreadsheet; all four turn up.
 */

export interface ParsedCsv {
  headers: string[];
  /** Header-keyed rows. `rowNumber` counts the header as row 1, as Excel does. */
  rows: { rowNumber: number; values: Record<string, string> }[];
  delimiter: string;
}

/** Picks between comma, semicolon and tab from the header line. */
export function detectDelimiter(sample: string): string {
  const line = sample.split(/\r?\n/, 1)[0] ?? '';
  const counts: [string, number][] = [
    [',', (line.match(/,/g) ?? []).length],
    [';', (line.match(/;/g) ?? []).length],
    ['\t', (line.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}

export function parseCsv(input: string, delimiter?: string): ParsedCsv {
  const text = input.replace(/^﻿/, '');
  const delim = delimiter ?? detectDelimiter(text);

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    // A trailing newline should not produce a phantom empty record.
    if (!(record.length === 1 && record[0] === '')) records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delim) {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRecord();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || record.length > 0) endRecord();

  if (records.length === 0) return { headers: [], rows: [], delimiter: delim };

  const headers = records[0]!.map((h) => h.trim());
  const rows = records.slice(1).map((values, idx) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, col) => {
      obj[h] = (values[col] ?? '').trim();
    });
    return { rowNumber: idx + 2, values: obj };
  });

  return { headers, rows, delimiter: delim };
}
