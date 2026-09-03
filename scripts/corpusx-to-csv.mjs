#!/usr/bin/env node
/**
 * Converts CorpusX company workbooks into the CSV datasets the importer reads.
 *
 * CorpusX is an enrichment provider in §4.4 terms, but what an organisation
 * actually has on day one is a folder of downloaded .xlsx files rather than an
 * API key. That is exactly what `manual_upload` exists for, and this is the
 * step that gets those files into the shape the platform already understands —
 * so nothing about the importer, the datasets or the engines has to know
 * CorpusX exists (P2).
 *
 * What it reads, and what it deliberately does not:
 *
 *   BS + IC   → financial_statement, one row per fiscal year per company.
 *   OnePage   → registry_profile: status, registered capital, registration
 *               date. It carries no address and no industry code — those cells
 *               are not in the export, so they stay blank rather than being
 *               filled from the business-size cell that happens to sit nearby.
 *   Ratio     → ignored. CorpusX computes current ratio, D/E and the rest, and
 *               so do we, from the same statements. Importing theirs would put
 *               two numbers for one thing on two screens, and the day they
 *               disagree is the day nobody trusts either.
 *
 * The directors, shareholders, change-history and related-company sheets are
 * read if present and reported as empty if not — in the exports seen so far
 * they are empty, which matters because those are the sheets Module 2 needs.
 *
 * Usage:  node scripts/corpusx-to-csv.mjs <files or dir> --out docs/imported
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/* ------------------------------------------------------------------ */
/* Minimal xlsx reader — enough for these workbooks, no dependency      */
/* ------------------------------------------------------------------ */

function unzip(file, entry) {
  return execFileSync('unzip', ['-p', file, entry], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
}

function sharedStrings(file) {
  let xml;
  try {
    xml = unzip(file, 'xl/sharedStrings.xml');
  } catch {
    return [];
  }
  // Each <si> may hold several <t> runs; concatenating them is what Excel shows.
  return [...xml.matchAll(/<si>(.*?)<\/si>/gs)].map(([, si]) =>
    [...si.matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((m) => decode(m[1])).join(''),
  );
}

function decode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

function sheetIndex(file) {
  const wb = unzip(file, 'xl/workbook.xml');
  const rels = unzip(file, 'xl/_rels/workbook.xml.rels');
  const relTarget = new Map(
    [...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(([, id, target]) => [id, target]),
  );
  return [...wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(([, name, rid]) => ({
    name: decode(name),
    path: `xl/${relTarget.get(rid).replace(/^\/?xl\//, '')}`,
  }));
}

/** Sparse grid keyed "R,C", 1-based, matching how a person reads a spreadsheet. */
function readSheet(file, path, strings) {
  const xml = unzip(file, path);
  const cells = new Map();
  for (const [, ref, attrs, inner] of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)(?:\/>|>(.*?)<\/c>)/gs)) {
    if (inner === undefined) continue;
    const type = /t="([^"]+)"/.exec(attrs)?.[1];
    const raw = /<v>(.*?)<\/v>/s.exec(inner)?.[1];
    let value;
    if (type === 's') value = strings[Number(raw)];
    else if (type === 'inlineStr') value = decode(/<t[^>]*>(.*?)<\/t>/s.exec(inner)?.[1] ?? '');
    else if (raw !== undefined) value = Number(raw);
    if (value === undefined || value === '') continue;
    const [, col, row] = /^([A-Z]+)(\d+)$/.exec(ref);
    let c = 0;
    for (const ch of col) c = c * 26 + (ch.charCodeAt(0) - 64);
    cells.set(`${row},${c}`, value);
  }
  return cells;
}

const at = (cells, r, c) => cells.get(`${r},${c}`);

/* ------------------------------------------------------------------ */
/* CorpusX layout                                                       */
/* ------------------------------------------------------------------ */

/**
 * BS and IC put the line item in column A (Thai) and B (English), and then a
 * pair of columns per fiscal year: the value, then its percentage. Row 1 from
 * column 4 onward carries the statement dates.
 *
 * The newest year is the awkward one. Its header sits in column 4 and its
 * percentage in column 5, but the value itself lands in column 3 OR column 4
 * depending on the row — on the BS every line item uses column 3, on the IC
 * ten of the fifteen use column 4. Never both in the same row, checked across
 * all four workbooks, so reading "3 if present, else 4" is unambiguous rather
 * than a guess. Every older year is well behaved: value in the header column,
 * percentage in the one after it.
 *
 * This only looks like pedantry until you see what the naive reading produces:
 * a 2025 row with a gross profit and nothing else, which reads as a company
 * that filed half a statement rather than a reader that looked in the wrong
 * column.
 */
function statementColumns(cells) {
  const columns = [];
  for (let c = 3; c <= 400; c += 1) {
    const header = at(cells, 1, c);
    if (typeof header === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(header)) {
      const [d, m, y] = header.split('/').map(Number);
      // CorpusX writes AD years on these two sheets and Buddhist-era years on
      // the Ratio sheet. Converting anything above 2400 is the same rule the
      // CSV coercer uses, kept here so a stray BE year cannot slip through.
      const year = y > 2400 ? y - 543 : y;
      columns.push({
        // Leftmost year: try the column before the header too.
        valueColumns: columns.length === 0 ? [c - 1, c] : [c],
        fiscalYear: year,
        periodEnd: `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      });
    }
  }
  return columns;
}

/** First of the candidate columns that actually holds a value on this row. */
function valueAt(cells, row, candidates) {
  for (const c of candidates) {
    const v = at(cells, row, c);
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

/**
 * Excel keeps a date as a day count from 1899-12-30, and a cell read without
 * its number format gives back the count. OnePage's registration date is one
 * of those, so 36557 has to become 2000-02-01 before it goes anywhere near a
 * column the importer will coerce as a date.
 */
function excelDate(value) {
  if (typeof value === 'number' && value > 0 && value < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (dmy) {
    const year = Number(dmy[3]) > 2400 ? Number(dmy[3]) - 543 : Number(dmy[3]);
    return `${year}-${dmy[2]}-${dmy[1]}`;
  }
  return text.slice(0, 10);
}

function lineValues(cells, label) {
  const wanted = label.toLowerCase();
  for (let r = 4; r <= 200; r += 1) {
    const en = at(cells, r, 2);
    if (typeof en === 'string' && en.trim().toLowerCase() === wanted) return r;
  }
  return null;
}

const BS_LINES = {
  totalAssets: 'Total assets',
  totalLiabilities: 'Total Liabilities',
  equity: "Total shareholders' equity",
  currentAssets: 'Total current assets',
  currentLiabilities: 'Total current liabilities',
  cash: 'Cash and deposits at financial institutions',
  inventory: 'Inventories - net',
  receivables: 'Accounts receivable',
};

const IC_LINES = {
  revenue: 'Total revenue',
  grossProfit: 'Gross profit (loss)',
  netProfit: 'Net income (loss)',
};

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n';
}

/* ------------------------------------------------------------------ */

function convert(file) {
  const strings = sharedStrings(file);
  const sheets = new Map(sheetIndex(file).map((s) => [s.name, s.path]));
  const read = (name) => (sheets.has(name) ? readSheet(file, sheets.get(name), strings) : new Map());

  // The taxpayer id is the filename: CorpusX names each export after it, and
  // it is the only place in the workbook it reliably appears.
  const taxId = basename(file, extname(file)).replace(/\D/g, '').slice(-13);

  const onePage = read('OnePage');
  const bs = read('BS');
  const ic = read('IC');

  const legalName = String(at(onePage, 4, 3) ?? '').trim();
  const columns = statementColumns(bs);
  const icColumns = statementColumns(ic);

  const bsRows = Object.fromEntries(Object.entries(BS_LINES).map(([k, label]) => [k, lineValues(bs, label)]));
  const icRows = Object.fromEntries(Object.entries(IC_LINES).map(([k, label]) => [k, lineValues(ic, label)]));

  const statements = columns.map(({ valueColumns, fiscalYear, periodEnd }) => {
    const icColumns_ = icColumns.find((c) => c.fiscalYear === fiscalYear)?.valueColumns;
    const row = { taxId, fiscalYear, periodEnd, currency: 'THB' };
    for (const [field, r] of Object.entries(bsRows)) {
      row[field] = r ? valueAt(bs, r, valueColumns) : '';
    }
    for (const [field, r] of Object.entries(icRows)) {
      row[field] = r && icColumns_ ? valueAt(ic, r, icColumns_) : '';
    }
    return row;
  });

  // OnePage carries no labels in its cells — they are part of the sheet's
  // formatting — so these are fixed positions, verified identical in all four
  // workbooks. Address and industry code are simply not in this export; they
  // stay blank rather than being invented from the business-size cell.
  const registry = {
    taxId,
    legalStatus: at(onePage, 7, 8) ?? '',
    registeredCapital: at(onePage, 8, 3) ?? '',
    registrationDate: excelDate(at(onePage, 7, 3)),
    registeredAddress: '',
    industryCode: '',
  };

  // Reported rather than assumed. These are the sheets Module 2 depends on, and
  // in every export seen so far they are empty — a silent zero here would look
  // like "this company has no directors" rather than "we were not sent any".
  const coverage = {
    directors: read('กรรมการและผู้ถือหุ้น').size,
    changeHistory: read('ประวัติการเปลี่ยนแปลง').size,
    relatedCompanies: read('บริษัทที่เกี่ยวข้อง').size,
    basicInfo: read('ข้อมูลพื้นฐาน').size,
  };

  return { taxId, legalName, statements, registry, coverage };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

// The layout readers are exported so the two mistakes below stay fixed: the
// leftmost fiscal year lives in a column the header row does not point at, and
// OnePage's registration date arrives as an Excel day count. Both produced
// output that looked like data rather than like a bug, which is the kind worth
// a test.
export { statementColumns, valueAt, excelDate, at };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

function main() {
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = outIndex === -1 ? 'docs/imported' : args[outIndex + 1];
const inputs = (outIndex === -1 ? args : args.slice(0, outIndex)).flatMap((p) =>
  statSync(p).isDirectory()
    ? readdirSync(p).filter((f) => f.endsWith('.xlsx')).map((f) => join(p, f))
    : [p],
);

if (inputs.length === 0) {
  console.error('usage: node scripts/corpusx-to-csv.mjs <files or dir> [--out docs/imported]');
  process.exit(1);
}

const parties = [];
const statements = [];
const registries = [];
const gaps = [];

for (const file of inputs) {
  const result = convert(file);
  parties.push({ taxId: result.taxId, legalName: result.legalName, role: 'customer' });
  statements.push(...result.statements);
  registries.push(result.registry);

  const empty = Object.entries(result.coverage)
    .filter(([, size]) => size === 0)
    .map(([k]) => k);
  if (empty.length > 0) gaps.push({ taxId: result.taxId, legalName: result.legalName, empty });

  console.log(
    `${result.taxId}  ${result.legalName.slice(0, 34).padEnd(36)} ${String(result.statements.length).padStart(2)} fiscal years`,
  );
}

mkdirSync(outDir, { recursive: true });

writeFileSync(
  join(outDir, 'financial_statement.csv'),
  toCsv(
    ['taxId', 'fiscalYear', 'periodEnd', 'currency', 'revenue', 'grossProfit', 'netProfit', 'totalAssets', 'totalLiabilities', 'equity', 'currentAssets', 'currentLiabilities', 'cash', 'inventory', 'receivables'],
    statements,
  ),
);
writeFileSync(
  join(outDir, 'registry_profile.csv'),
  toCsv(['taxId', 'legalStatus', 'registeredCapital', 'registrationDate', 'registeredAddress', 'industryCode'], registries),
);
// The counterparty register is emitted WITHOUT entity or customer code on
// purpose: those come from the organisation's own ERP, not from CorpusX. It is
// a starting point for a person to complete, not a file to import as it stands.
writeFileSync(
  join(outDir, 'party.template.csv'),
  toCsv(['entity', 'customer_code', 'customer_name', 'tax_id', 'role'], parties.map((p) => ({
    entity: '',
    customer_code: '',
    customer_name: p.legalName,
    tax_id: p.taxId,
    role: p.role,
  }))),
);

console.log(`\nwrote ${statements.length} statement rows and ${registries.length} registry rows to ${outDir}`);
if (gaps.length > 0) {
  console.log('\nsheets that arrived empty — Module 2 group resolution has nothing to work from for these:');
  for (const g of gaps) console.log(`  ${g.taxId}  ${g.empty.join(', ')}`);
}
}
