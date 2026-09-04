#!/usr/bin/env node
/**
 * One command that turns a folder of CorpusX downloads into the exact files to
 * upload, in the exact order to upload them.
 *
 * The two readers each answer half the question — the workbook has the
 * statements, the PDFs have the register — and neither knows about the other.
 * This joins them on the taxpayer id and writes a numbered set, because the
 * order is not cosmetic: every dataset except the counterparty register is
 * keyed to a party that must already exist. Import a director for a company the
 * platform has never heard of and the row is skipped in silence, which looks
 * exactly like a successful import of nothing.
 *
 *   01-party.csv                the register itself, first, always
 *   02-registry_profile.csv     status, capital, address, TSIC
 *   03-financial_statement.csv  five fiscal years per company
 *   04-director.csv
 *   05-shareholder.csv
 *
 * Two more are written under reference/. No dataset takes them yet, and a file
 * that looks importable and is not costs somebody an afternoon.
 *
 * Where both sources carry the same field, the PDF wins: its Business Profile
 * page has the registered address and the TSIC code, and the workbook's OnePage
 * sheet has neither.
 *
 * Usage:
 *   node scripts/corpusx-prepare.mjs <dir> --out docs/imported [--entity E01]
 *
 * E01 is the starter profile's own legal entity, so the default lands somewhere
 * that already exists. An entity the file names and the tenant does not have is
 * created rather than rejected — on a first upload the register is the only
 * thing that knows what the entities are.
 *
 * The folder can hold any number of companies mixed together — files are
 * matched up by the taxpayer id inside them, not by their names.
 */
import { writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { convert as convertWorkbook } from './corpusx-to-csv.mjs';
import { readLines, pageKind, readProfile, readPeople, readHistory, readTicks, KIND } from './corpusx-pdf-to-csv.mjs';

/* ------------------------------------------------------------------ */

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toCsv = (headers, rows) =>
  [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n';

/** Prefer the first source that actually said something. */
const pick = (...values) => values.find((v) => v !== undefined && v !== null && v !== '') ?? '';

/**
 * One registry row out of the two sources.
 *
 * The PDF wins field by field rather than wholesale, because "the PDF is
 * better" is only true where the PDF has an answer. Its Business Profile page
 * is the only place the registered address and the TSIC code appear at all,
 * and the workbook's OnePage sheet is a perfectly good fallback for the three
 * fields they both carry.
 */
export function mergeRegistry(taxId, pdf, workbook) {
  const p = pdf ?? {};
  const w = workbook ?? {};
  return {
    taxId,
    legalStatus: pick(p.legalStatus, w.legalStatus),
    registeredCapital: pick(p.registeredCapital, w.registeredCapital),
    registrationDate: pick(p.registrationDate, w.registrationDate),
    // Not in the workbook at any price.
    registeredAddress: pick(p.registeredAddress),
    industryCode: pick(p.industryCode),
  };
}

/* ------------------------------------------------------------------ */

export function prepare(files, { entityCode = 'E01' } = {}) {
  /** Everything known about one company, from however many files mention it. */
  const byTaxId = new Map();
  const company = (taxId) => {
    if (!byTaxId.has(taxId)) {
      byTaxId.set(taxId, {
        taxId,
        legalName: '',
        sources: new Set(),
        workbookRegistry: null,
        pdfRegistry: null,
        statements: [],
        directors: [],
        shareholders: [],
        history: [],
        related: [],
        screenshotSheets: [],
      });
    }
    return byTaxId.get(taxId);
  };

  // PDF pages carry the taxpayer id only on the Business Profile page, so the
  // pages of one company are gathered by legal name first and keyed by id
  // afterwards. The name is printed on every page; the id is not.
  const pdfByName = new Map();
  const unreadable = [];

  for (const file of files) {
    const extension = extname(file).toLowerCase();

    if (extension === '.xlsx') {
      const result = convertWorkbook(file);
      const record = company(result.taxId);
      record.legalName = pick(record.legalName, result.legalName);
      record.sources.add('workbook');
      record.workbookRegistry = result.registry;
      record.statements = result.statements;
      record.screenshotSheets = Object.entries(result.coverage)
        .filter(([, size]) => size === 0)
        .map(([name]) => name);
      continue;
    }

    if (extension !== '.pdf') continue;

    const lines = readLines(file);
    const kind = KIND[pageKind(lines) ?? ''];
    if (!kind) {
      unreadable.push(`${basename(file)} — ${pageKind(lines) ?? 'no page title'}`);
      continue;
    }
    const nameLine = lines.find((l) => l.x0 < 60 && l.y0 > 25 && l.y0 < 40);
    const name = nameLine ? nameLine.text.trim() : basename(file, extension);
    if (!pdfByName.has(name)) pdfByName.set(name, { name, pages: [] });
    pdfByName.get(name).pages.push({ file, kind, lines });
  }

  const noProfilePage = [];

  for (const { name, pages } of pdfByName.values()) {
    const profilePage = pages.find((p) => p.kind === 'profile');
    if (!profilePage) {
      // Without it there is no taxpayer id, and without that there is nothing
      // to attach these people to. Said out loud rather than dropped.
      noProfilePage.push(`${name} — ${pages.map((p) => p.kind).join(', ')}`);
      continue;
    }
    const registry = readProfile(profilePage.lines);
    const record = company(registry.taxId);
    record.legalName = pick(record.legalName, name);
    record.sources.add('pdf');
    record.pdfRegistry = registry;

    for (const page of pages) {
      if (page.kind === 'people') {
        const { directors, shareholders } = readPeople(page.lines, registry.taxId);
        record.directors = directors;
        record.shareholders = shareholders;
      } else if (page.kind === 'history') {
        record.history = readHistory(page.lines, registry.taxId);
      } else if (page.kind === 'related') {
        record.related = readTicks(page.file, page.lines).links;
      }
    }
  }

  /* ---------------------------------------------------------------- */

  const parties = [];
  const registries = [];
  const statements = [];
  const directors = [];
  const shareholders = [];
  const history = [];
  const related = [];

  for (const record of [...byTaxId.values()].sort((a, b) => a.taxId.localeCompare(b.taxId))) {
    // No ERP in a demo, so the party's code in "the source system" is the one
    // identifier CorpusX actually gives: the taxpayer id. Real codes replace
    // these the day the ERP feed arrives, and the tax id is what matches the
    // two records up.
    parties.push({
      legalEntityCode: entityCode,
      sourceCode: record.taxId,
      legalName: record.legalName,
      taxId: record.taxId,
      role: 'customer',
    });

    if (record.pdfRegistry || record.workbookRegistry) {
      registries.push(mergeRegistry(record.taxId, record.pdfRegistry, record.workbookRegistry));
    }

    statements.push(...record.statements);
    for (const d of record.directors) directors.push({ ...d, taxId: record.taxId });
    for (const s of record.shareholders) shareholders.push({ ...s, taxId: record.taxId });
    for (const h of record.history) history.push({ ...h, taxId: record.taxId });
    for (const r of record.related) related.push({ ofTaxId: record.taxId, ...r });
  }

  return {
    companies: [...byTaxId.values()],
    parties,
    registries,
    statements,
    directors,
    shareholders,
    history,
    related,
    unreadable,
    noProfilePage,
  };
}

/* ------------------------------------------------------------------ */

const STEPS = [
  ['01-party.csv', 'party', 'The register itself. Nothing else can attach to a company the platform has not been told about.'],
  ['02-registry_profile.csv', 'registry_profile', 'Status, capital, registration date, address and TSIC code.'],
  ['03-financial_statement.csv', 'financial_statement', 'Five fiscal years per company, from the workbook.'],
  ['04-director.csv', 'director', 'Feeds group resolution.'],
  ['05-shareholder.csv', 'shareholder', 'Feeds group resolution, weighted higher than a directorship.'],
];

function uploadNotes(result, entityCode) {
  const lines = [
    '# Upload these in order',
    '',
    'On the Import screen, pick the dataset named beside each file and upload it.',
    'The order matters: every dataset below except the first is keyed to a party',
    'that must already exist, and a row for an unknown company is skipped in',
    'silence — which looks exactly like a successful import of nothing.',
    '',
    '| # | File | Dataset | Rows | Why |',
    '|---|---|---|---|---|',
  ];
  const counts = [result.parties, result.registries, result.statements, result.directors, result.shareholders];
  STEPS.forEach(([file, dataset, why], i) => {
    lines.push(`| ${i + 1} | \`${file}\` | \`${dataset}\` | ${counts[i].length} | ${why} |`);
  });
  lines.push(
    '',
    'Then, on the screens themselves:',
    '',
    '1. **Portfolio** → Run analysis. This is what computes the ratios, the score and the grade.',
    '2. **Groups** → Run resolution. Proposals only; confirming a group is a person\'s decision.',
    '3. **Risk index** → Run. It will report itself incomplete, and it should: there is no',
    '   payment or receivable data here, and the index says so rather than pretending.',
    '4. **Credit memo** → Generate for any counterparty. It assembles about 80% and prints',
    '   the rest as named gaps for an analyst to write.',
    '',
    `Every party is created under legal entity \`${entityCode}\` with its taxpayer id as the`,
    'source code, because a demo has no ERP to take those from. Real codes replace them',
    'when the ERP feed arrives; the tax id is what matches the two records up.',
    '',
    '## Not importable yet',
    '',
    'Under `reference/`. No dataset takes them, so they are named so nobody tries.',
    '',
    `- \`registry_change.csv\` (${result.history.length} rows) — capital, name and status changes with dates.`,
    `- \`related_company.csv\` (${result.related.length} rows) — every other company these same people sit on.`,
    '  Names without taxpayer ids, so it is the worklist saying which companies to export',
    '  from CorpusX next. Once those are in, the group edges close by themselves.',
    '',
    '## Personal data',
    '',
    'Director and shareholder names are personal data under the PDPA — the CorpusX pages',
    'say so themselves. This folder is gitignored for that reason.',
    '',
  );
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : args[i + 1];
  };
  const outDir = flag('--out', 'docs/imported');
  const entityCode = flag('--entity', 'E01');
  const inputs = args
    .filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out' && args[args.indexOf(a) - 1] !== '--entity')
    .flatMap((p) =>
      statSync(p).isDirectory()
        ? readdirSync(p)
            .filter((f) => /\.(pdf|xlsx)$/i.test(f))
            .map((f) => join(p, f))
        : [p],
    );

  if (inputs.length === 0) {
    console.error('usage: node scripts/corpusx-prepare.mjs <dir or files> [--out docs/imported] [--entity E01]');
    process.exit(1);
  }

  const result = prepare(inputs, { entityCode });

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'reference'), { recursive: true });

  writeFileSync(
    join(outDir, '01-party.csv'),
    toCsv(['legalEntityCode', 'sourceCode', 'legalName', 'taxId', 'role'], result.parties),
  );
  writeFileSync(
    join(outDir, '02-registry_profile.csv'),
    toCsv(['taxId', 'legalStatus', 'registeredCapital', 'registrationDate', 'registeredAddress', 'industryCode'], result.registries),
  );
  writeFileSync(
    join(outDir, '03-financial_statement.csv'),
    toCsv(
      ['taxId', 'fiscalYear', 'periodEnd', 'currency', 'revenue', 'grossProfit', 'netProfit', 'totalAssets', 'totalLiabilities', 'equity', 'currentAssets', 'currentLiabilities', 'cash', 'inventory', 'receivables'],
      result.statements,
    ),
  );
  writeFileSync(join(outDir, '04-director.csv'), toCsv(['taxId', 'personName', 'position', 'since'], result.directors));
  writeFileSync(
    join(outDir, '05-shareholder.csv'),
    toCsv(['taxId', 'holderName', 'holderType', 'holderTaxId', 'sharePct'], result.shareholders),
  );
  writeFileSync(
    join(outDir, 'reference', 'registry_change.csv'),
    toCsv(['taxId', 'kind', 'changedOn', 'value', 'note'], result.history),
  );
  writeFileSync(
    join(outDir, 'reference', 'related_company.csv'),
    toCsv(['ofTaxId', 'companyName', 'personName', 'active'], result.related),
  );
  writeFileSync(join(outDir, 'UPLOAD.md'), uploadNotes(result, entityCode));

  /* Report ---------------------------------------------------------- */

  console.log('taxpayer id     company                          from        yrs  dir  sh   links');
  for (const c of result.companies.sort((a, b) => a.taxId.localeCompare(b.taxId))) {
    console.log(
      `${c.taxId}  ${c.legalName.slice(0, 30).padEnd(32)} ${[...c.sources].join('+').padEnd(12)}` +
        `${String(c.statements.length).padStart(3)}  ${String(c.directors.length).padStart(3)}  ` +
        `${String(c.shareholders.length).padStart(3)}  ${String(c.related.length).padStart(4)}`,
    );
  }

  console.log(`\nwrote ${STEPS.length} numbered files to ${outDir} — see UPLOAD.md for the order and what to do next`);

  // A company seen through only one of the two sources is the mistake this
  // report exists to catch: half a counterparty looks like a whole one on
  // every screen until somebody asks why it has no directors.
  const partial = result.companies.filter((c) => c.sources.size < 2);
  if (partial.length > 0) {
    console.log('\nonly one source — these will look complete and will not be:');
    for (const c of partial) {
      const missing = c.sources.has('pdf') ? 'no workbook, so no financial statements' : 'no PDFs, so no register';
      console.log(`  ${c.taxId}  ${c.legalName.slice(0, 28).padEnd(30)} ${missing}`);
    }
  }
  if (result.noProfilePage.length > 0) {
    console.log('\nPDF pages with no Business Profile page beside them, so no taxpayer id to attach them to:');
    for (const n of result.noProfilePage) console.log(`  ${n}`);
  }
  if (result.unreadable.length > 0) {
    console.log('\nfiles whose page type was not recognised:');
    for (const u of result.unreadable) console.log(`  ${u}`);
  }
}
