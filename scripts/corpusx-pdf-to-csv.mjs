#!/usr/bin/env node
/**
 * Converts CorpusX PDF pages into the CSV datasets the importer reads.
 *
 * The .xlsx export puts the registry pages — profile, directors and
 * shareholders, change history, related companies — into the workbook as
 * screenshots. The cells behind them are empty, so the spreadsheet reader can
 * see the financial statements and nothing else. The PDF of the same pages
 * carries a real text layer, which is why this exists alongside
 * corpusx-to-csv.mjs rather than replacing it:
 *
 *   .xlsx  →  financial_statement  (five fiscal years, BS and IC)
 *   .pdf   →  registry_profile, director, shareholder, and the group signals
 *
 * Together they cover what a counterparty file needs. Neither alone does.
 *
 * The four page types, told apart by the English title CorpusX prints in the
 * top-right corner (its own spelling of "Related Comapany" included):
 *
 *   Business Profile        → registry_profile, now with the address and the
 *                             TSIC code the OnePage sheet never had.
 *   Director & Shareholder  → director + shareholder. This is what Module 2
 *                             group resolution actually runs on.
 *   Historical Changing     → registry_change: capital, name and status moves
 *                             with their dates.
 *   Related Comapany        → the person × company grid. Its ticks are images,
 *                             not text, so they are read from the rendered
 *                             page — see readTicks below.
 *
 * Needs poppler-utils on the path (`brew install poppler`), same as the xlsx
 * script needs unzip. It shells out rather than taking a PDF library as a
 * dependency: this is an ingestion step run by hand, not part of the app.
 *
 * Usage:  node scripts/corpusx-pdf-to-csv.mjs <files or dir> --out docs/imported
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

/* ------------------------------------------------------------------ */
/* Reading a page                                                       */
/* ------------------------------------------------------------------ */

function decode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * Lines of text with their boxes, in points from the top-left.
 *
 * Everything downstream is positional. CorpusX lays these pages out as a form
 * — a label in one column, its value in another — so reading order alone tells
 * you nothing, and the only reliable statement about a value is which label it
 * sits beside.
 */
export function readLines(file) {
  const xml = execFileSync('pdftotext', ['-bbox-layout', file, '-'], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');

  const lines = [];
  for (const m of xml.matchAll(
    /<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/line>/gs,
  )) {
    const words = [...m[5].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/gs)].map(
      (w) => ({ x0: Number(w[1]), y0: Number(w[2]), x1: Number(w[3]), y1: Number(w[4]), text: decode(w[5]) }),
    );
    if (words.length === 0) continue;
    lines.push({
      x0: Number(m[1]),
      y0: Number(m[2]),
      x1: Number(m[3]),
      y1: Number(m[4]),
      text: words.map((w) => w.text).join(' '),
      words,
    });
  }
  return lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/** CorpusX prints the page type in English at the top right. */
export function pageKind(lines) {
  const title = lines.find((l) => l.y0 < 50 && l.x0 > 400 && /^[A-Za-z& ]+$/.test(l.text));
  return title ? title.text.trim() : null;
}

const KIND = {
  'Business Profile': 'profile',
  'Director & Shareholder': 'people',
  'Historical Changing': 'history',
  // CorpusX's spelling, not ours. Matching what the file says beats matching
  // what it ought to say.
  'Related Comapany': 'related',
  'Related Company': 'related',
};

/* ------------------------------------------------------------------ */
/* Values                                                               */
/* ------------------------------------------------------------------ */

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/**
 * "21 กันยายน 2547" → "2004-09-21".
 *
 * Registry pages are in Buddhist-era years throughout, and a year under 2400
 * would mean CorpusX changed something, so it is left alone and reported as-is
 * rather than quietly shifted by 543 in the wrong direction.
 */
export function thaiDate(text) {
  const m = /(\d{1,2})\s+(\S+)\s+(\d{4})/.exec(String(text ?? ''));
  if (!m) return '';
  const month = THAI_MONTHS.indexOf(m[2]);
  if (month === -1) return '';
  const year = Number(m[3]) > 2400 ? Number(m[3]) - 543 : Number(m[3]);
  return `${year}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export const num = (text) => {
  const cleaned = String(text ?? '').replace(/[^\d.-]/g, '');
  return cleaned === '' || cleaned === '-' ? '' : Number(cleaned);
};

/**
 * The value beside a label on a two-column form page.
 *
 * The window runs from the label's own line down to the next line in the label
 * column, so a two-line address is picked up whole and a one-line value does
 * not swallow the next field. Values sit a fraction above their labels often
 * enough that the window starts slightly high.
 */
export function fieldAfter(lines, label, { valueX0 = 118, labelX1 = 118 } = {}) {
  const labelLines = lines.filter((l) => l.x0 < labelX1);
  const index = labelLines.findIndex((l) => l.text.startsWith(label));
  if (index === -1) return '';
  const from = labelLines[index].y0 - 3;
  const to = labelLines[index + 1] ? labelLines[index + 1].y0 - 3 : Infinity;
  return lines
    .filter((l) => l.x0 >= valueX0 && l.x0 < 360 && l.y0 >= from && l.y0 < to)
    .map((l) => l.text)
    .join(' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Page: Business Profile                                               */
/* ------------------------------------------------------------------ */

export function readProfile(lines) {
  const industry = fieldAfter(lines, 'ประเภทธุรกิจ');
  // "(ล่าสุด) 1. การซื้อ… (68101) (2568) 1. …" — the latest classification
  // comes first, and only its five-digit TSIC code is worth carrying.
  const code = /\((\d{5})\)/.exec(industry);

  return {
    taxId: fieldAfter(lines, 'เลขทะเบียนนิติบุคคล:').replace(/\D/g, ''),
    legalStatus: fieldAfter(lines, 'สถานะกิจการ:'),
    registeredCapital: num(fieldAfter(lines, 'ทุนจดทะเบียนล่าสุด:')),
    registrationDate: thaiDate(fieldAfter(lines, 'วันที่จดทะเบียน:')),
    registeredAddress: fieldAfter(lines, 'ที่ตั้ง (กระทรวง):'),
    industryCode: code ? code[1] : '',
  };
}

/**
 * Things on this page that no dataset takes yet, reported rather than dropped.
 *
 * The former registration number matters most: a party carried over from an
 * older system may still be keyed by it, and knowing the two numbers are one
 * company is the difference between one counterparty and two.
 */
export function readProfileExtras(lines) {
  return {
    formerTaxId: fieldAfter(lines, 'เลขทะเบียนนิติบุคคล\n')
      || fieldAfter(lines, 'เลขทะเบียนนิติบุคคล (เดิม)')
      || profileFormerId(lines),
    businessSize: fieldAfter(lines, 'ขนาดธุรกิจ:'),
    phone: fieldAfter(lines, 'หมายเลขโทรศัพท์:'),
    signingAuthority: fieldAfter(lines, 'อำนาจกรรมการ'),
  };
}

/** The "(เดิม)" label wraps onto a second line, so it needs its own reach. */
function profileFormerId(lines) {
  const label = lines.find((l) => l.x0 < 118 && l.text.startsWith('(เดิม)'));
  if (!label) return '';
  const value = lines.find((l) => l.x0 >= 118 && l.x0 < 360 && Math.abs(l.y0 - (label.y0 - 11)) < 6);
  return value ? value.text.replace(/\D/g, '') : '';
}

/* ------------------------------------------------------------------ */
/* Page: Director & Shareholder                                         */
/* ------------------------------------------------------------------ */

const COMPANY_PREFIX = /^(บริษัท|บมจ\.|หจก\.|ห้างหุ้นส่วน|ห\.จ\.ก\.)/;

/**
 * Two tables that happen to share a page and do not share a shape.
 *
 * Directors are a plain numbered list down the left. Shareholders are a wide
 * table on the right, under a header that also has a nationality summary above
 * it using the same column positions — so the shareholder rows are everything
 * below that header, and the summary is excluded by its y rather than by
 * guessing from its content.
 */
export function readPeople(lines, taxId) {
  const directors = lines
    .filter((l) => l.x0 > 60 && l.x0 < 100 && /^(นาย|นาง|นางสาว|น\.ส\.|ดร\.|Mr|Mrs|Ms)/.test(l.text))
    .map((l, i) => ({ taxId, personName: l.text.trim(), position: 'กรรมการ', since: '', seq: i + 1 }));

  const header = lines.find((l) => l.x0 > 200 && l.x0 < 300 && l.text.startsWith('รายชื่อผู้ถือหุ้น'));
  const meetingLine = lines.find((l) => l.text.includes('วันที่ประชุมผู้ถือหุ้น'));
  const asOf = meetingLine ? thaiDate(meetingLine.text) : '';

  const shareholders = [];
  if (header) {
    // Rows are keyed off the sequence number in its own narrow column: it is
    // the one cell guaranteed present, and the name, value and percentage sit
    // within a few points of it vertically.
    const seqCells = lines.filter(
      (l) => l.y0 > header.y0 + 10 && l.x0 > 215 && l.x1 < 240 && /^\d+$/.test(l.text),
    );
    for (const seq of seqCells) {
      const band = (from, to) =>
        lines.find((l) => Math.abs(l.y0 - seq.y0) < 6 && l.x0 >= from && l.x0 < to);
      const name = band(240, 350);
      if (!name) continue;
      const value = band(350, 425);
      const shares = band(425, 540);
      const pct = band(540, 600);
      // "809,900 ไทย" — count and nationality share one cell.
      const sharesText = shares ? shares.text : '';
      shareholders.push({
        taxId,
        holderName: name.text.trim(),
        holderType: COMPANY_PREFIX.test(name.text.trim()) ? 'company' : 'person',
        holderTaxId: '',
        sharePct: num(pct ? pct.text : ''),
        shareValue: num(value ? value.text : ''),
        shareCount: num(sharesText.split(/\s+/)[0] ?? ''),
        nationality: sharesText.replace(/[\d.,]/g, '').trim(),
        asOf,
      });
    }
  }

  return { directors, shareholders };
}

/* ------------------------------------------------------------------ */
/* Page: Historical Changing                                            */
/* ------------------------------------------------------------------ */

/**
 * Capital, name and status changes, each with the date it happened.
 *
 * A name change is the one that quietly breaks things: a counterparty imported
 * under the old name and one imported under the new are two parties until
 * somebody notices. Emitting both names with the date between them is what
 * lets that be caught rather than discovered.
 */
export function readHistory(lines, taxId) {
  const rows = [];

  for (const line of lines) {
    const date = thaiDate(line.text);
    if (!date) continue;

    // Capital: "เปลี่ยนแปลงครั้งที่ 1  29 ธันวาคม 2552  30,000,000.00" — the
    // amount is in a column of its own to the right.
    const amount = lines.find(
      (l) => Math.abs(l.y0 - line.y0) < 4 && l.x0 > line.x1 && /^[\d,]+\.\d{2}$/.test(l.text.trim()),
    );
    if (amount && line.x0 > 200) {
      rows.push({ taxId, kind: 'capital', changedOn: date, value: num(amount.text), note: line.text.replace(/\s*\d{1,2}\s+\S+\s+\d{4}\s*/, '').trim() });
      continue;
    }

    // Name: the Thai and English names sit to the right of the date on the
    // same line band.
    const named = lines.filter(
      (l) => Math.abs(l.y0 - line.y0) < 4 && l.x0 > 150 && /บริษัท|CO\.,LTD|COMPANY|LIMITED/i.test(l.text),
    );
    if (named.length > 0 && line.x0 < 150) {
      rows.push({
        taxId,
        kind: 'name',
        changedOn: date,
        value: named.map((l) => l.text.trim()).join(' | '),
        note: line.text.replace(/\s*\d{1,2}\s+\S+\s+\d{4}\s*/, '').trim(),
      });
    }
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/* Page: Related Comapany                                               */
/* ------------------------------------------------------------------ */

/**
 * Where every cell of the grid is, read from the text alone.
 *
 * Split out from the ink test because this is the part with the judgement in
 * it, and because the ink test needs a rendered page while this needs nothing.
 */
export function tickGeometry(lines) {
  // The column numbers 1..n above the header names give the exact centre of
  // every person's column.
  const headerDigits = lines
    .filter((l) => l.y0 < 70 && l.x0 > 170 && /^\d+$/.test(l.text.trim()))
    .sort((a, b) => a.x0 - b.x0)
    .map((l) => (l.x0 + l.x1) / 2);

  // Header names are assembled from WORDS, not lines. pdftotext runs two
  // adjacent columns into one line where the names sit at the same height —
  // "นาย กฤษณ นางสาว ปิ ย" is columns 5 and 6 in a single line — and each
  // word's own box still says which column it belongs to.
  const headerWords = lines
    .filter((l) => l.y0 >= 70 && l.y0 < 110)
    .flatMap((l) => l.words.map((w) => ({ ...w, lineY: l.y0 })));

  const columns = headerDigits.map((x) => ({
    x,
    personName: headerWords
      .filter((w) => Math.abs((w.x0 + w.x1) / 2 - x) < 26)
      .sort((a, b) => a.lineY - b.lineY || a.x0 - b.x0)
      .map((w) => w.text)
      .join('')
      .replace(/\s+/g, ''),
  }));

  // Row numbers run down the far left — as words, not as lines. Where a
  // company name wraps onto two lines the number ends up on a line of its own;
  // where it fits on one, pdftotext puts the number and the name in the same
  // line. Reading the number as a word covers both, and an export contains
  // some rows of each shape, so handling only one silently drops the others.
  const bodyWords = lines
    .filter((l) => l.y0 > 105)
    .flatMap((l) => l.words.map((w) => ({ ...w, lineY: l.y0 })));

  const rows = bodyWords
    .filter((w) => w.x0 < 50 && /^\d+$/.test(w.text.trim()))
    .sort((a, b) => a.y0 - b.y0)
    .map((digit) => {
      const nameWords = bodyWords
        // To the right of the number and left of the status column. Anchoring
        // on the number rather than on a fixed x is what makes the two row
        // shapes — number alone, number followed by the name — read the same.
        .filter((w) => w.x0 > digit.x1 && w.x0 < 135 && Math.abs(w.lineY - digit.lineY) < 14)
        .sort((a, b) => a.lineY - b.lineY || a.x0 - b.x0);
      const spans = [digit, ...nameWords];
      return {
        // A company whose name wraps has its tick centred on the pair of
        // lines, not on the number.
        y: (Math.min(...spans.map((s) => s.y0)) + Math.max(...spans.map((s) => s.y1))) / 2,
        companyName: nameWords.map((w) => w.text).join(' ').trim(),
      };
    });

  return { columns, rows };
}

/**
 * The grid of which of this company's people also sit on which other company.
 *
 * Its ticks are 7.5pt PNGs, not characters, so no amount of text extraction
 * finds them — the page is rendered to greyscale and each cell is asked
 * whether it has ink in it. That sounds fragile and is not: the page is
 * machine-generated on a fixed grid, a tick covers most of its cell, and an
 * empty cell is pure white. The cells are not guessed either; tickGeometry
 * reads their centres from the row and column numbers, which are text.
 *
 * This is the page worth the trouble. Directors and shareholders tell you
 * about one company; this one names the other eighteen the same people sit on,
 * which is the group.
 */
export function readTicks(file, lines) {
  const dpi = 150;
  const dir = join(tmpdir(), `corpusx-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const prefix = join(dir, 'page');

  try {
    execFileSync('pdftoppm', ['-gray', '-r', String(dpi), '-f', '1', '-l', '1', file, prefix]);
    const pgm = readFileSync(`${prefix}-1.pgm`);

    // P5 header: magic, width, height, maxval, each followed by whitespace.
    const header = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(pgm.subarray(0, 64).toString('latin1'));
    if (!header) throw new Error('pdftoppm did not produce a raw greyscale page');
    const width = Number(header[1]);
    const offset = header[0].length;
    const scale = dpi / 72;

    /** Mean grey in a small box centred on a point, in page points. 0 = black. */
    const grey = (x, y, half) => {
      const px = Math.round(x * scale);
      const py = Math.round(y * scale);
      const r = Math.round(half * scale);
      let total = 0;
      let count = 0;
      for (let j = py - r; j <= py + r; j += 1) {
        for (let i = px - r; i <= px + r; i += 1) {
          total += pgm[offset + j * width + i];
          count += 1;
        }
      }
      return total / count;
    };

    const { columns, rows } = tickGeometry(lines);
    const links = [];

    for (const row of rows) {
      // The status icon sits in its own column between the name and the first
      // person. It is the same glyph whether or not the company still trades —
      // dark while it does, pale once it does not — so it is the shade that
      // carries the meaning and a plain ink test would call every row active.
      const active = grey(150, row.y, 3) < 190;
      for (const column of columns) {
        // A tick is nearly black over most of its cell; an empty cell is the
        // page. Anything in between would be a change at CorpusX's end.
        if (grey(column.x, row.y, 5) < 250) {
          links.push({ companyName: row.companyName, personName: column.personName, active });
        }
      }
    }

    return { columns, rows, links };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* CSV                                                                  */
/* ------------------------------------------------------------------ */

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n';
}

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

export { KIND };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outDir = outIndex === -1 ? 'docs/imported' : args[outIndex + 1];
  const inputs = (outIndex === -1 ? args : args.slice(0, outIndex)).flatMap((p) =>
    statSync(p).isDirectory()
      ? readdirSync(p).filter((f) => f.toLowerCase().endsWith('.pdf')).map((f) => join(p, f))
      : [p],
  );

  if (inputs.length === 0) {
    console.error('usage: node scripts/corpusx-pdf-to-csv.mjs <files or dir> [--out docs/imported]');
    process.exit(1);
  }

  // The pages of one company arrive as separate files with no id on most of
  // them, so the profile page's registration number is what ties the set
  // together. Companies are keyed by their Thai legal name, which every page
  // does carry, and the tax id is filled in once the profile page is read.
  const companies = new Map();
  const company = (name) => {
    if (!companies.has(name)) {
      companies.set(name, { legalName: name, taxId: '', profile: null, extras: null, directors: [], shareholders: [], history: [], related: [] });
    }
    return companies.get(name);
  };

  const unknown = [];

  for (const file of inputs) {
    const lines = readLines(file);
    const kind = KIND[pageKind(lines) ?? ''];
    const nameLine = lines.find((l) => l.x0 < 60 && l.y0 > 25 && l.y0 < 40);
    const legalName = nameLine ? nameLine.text.trim() : basename(file, extname(file));
    const record = company(legalName);

    if (kind === 'profile') {
      record.profile = readProfile(lines);
      record.extras = readProfileExtras(lines);
      record.taxId = record.profile.taxId;
    } else if (kind === 'people') {
      const { directors, shareholders } = readPeople(lines, '');
      record.directors = directors;
      record.shareholders = shareholders;
    } else if (kind === 'history') {
      record.history = readHistory(lines, '');
    } else if (kind === 'related') {
      record.related = readTicks(file, lines).links;
    } else {
      unknown.push(`${basename(file)}  (${pageKind(lines) ?? 'no title found'})`);
    }
  }

  const directors = [];
  const shareholders = [];
  const registries = [];
  const history = [];
  const related = [];
  const missingId = [];

  for (const record of companies.values()) {
    if (!record.taxId) {
      missingId.push(record.legalName);
      continue;
    }
    if (record.profile) registries.push(record.profile);
    for (const d of record.directors) directors.push({ ...d, taxId: record.taxId });
    for (const s of record.shareholders) shareholders.push({ ...s, taxId: record.taxId });
    for (const h of record.history) history.push({ ...h, taxId: record.taxId });
    for (const r of record.related) related.push({ ofTaxId: record.taxId, ...r });

    console.log(
      `${record.taxId}  ${record.legalName.slice(0, 30).padEnd(32)} ` +
        `${String(record.directors.length).padStart(2)} directors  ` +
        `${String(record.shareholders.length).padStart(2)} shareholders  ` +
        `${String(record.related.length).padStart(3)} group links`,
    );
  }

  mkdirSync(outDir, { recursive: true });
  if (registries.length > 0) {
    writeFileSync(
      join(outDir, 'registry_profile.pdf.csv'),
      toCsv(['taxId', 'legalStatus', 'registeredCapital', 'registrationDate', 'registeredAddress', 'industryCode'], registries),
    );
  }
  if (directors.length > 0) {
    writeFileSync(join(outDir, 'director.csv'), toCsv(['taxId', 'personName', 'position', 'since'], directors));
  }
  if (shareholders.length > 0) {
    writeFileSync(
      join(outDir, 'shareholder.csv'),
      toCsv(['taxId', 'holderName', 'holderType', 'holderTaxId', 'sharePct'], shareholders),
    );
  }
  // No dataset takes these two yet, so they are written under names the
  // importer will not offer to map — a file that looks importable and is not
  // wastes somebody's afternoon.
  if (history.length > 0) {
    writeFileSync(join(outDir, 'registry_change.reference.csv'), toCsv(['taxId', 'kind', 'changedOn', 'value', 'note'], history));
  }
  if (related.length > 0) {
    writeFileSync(
      join(outDir, 'related_company.reference.csv'),
      toCsv(['ofTaxId', 'companyName', 'personName', 'active'], related),
    );
  }

  console.log(`\nwrote ${registries.length} profiles, ${directors.length} directors, ${shareholders.length} shareholders to ${outDir}`);
  if (related.length > 0) {
    const others = new Set(related.map((r) => r.companyName));
    console.log(
      `${related.length} person-to-company links across ${others.size} companies — export those from CorpusX next ` +
        `and their tax ids turn these into group edges`,
    );
  }
  if (missingId.length > 0) {
    console.log('\nno Business Profile page, so no tax id — these were skipped:');
    for (const name of missingId) console.log(`  ${name}`);
  }
  if (unknown.length > 0) {
    console.log('\npages whose type was not recognised:');
    for (const u of unknown) console.log(`  ${u}`);
  }
}
