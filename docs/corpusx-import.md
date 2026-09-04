# CorpusX exports as an input channel

CorpusX is an enrichment provider in §4.4 terms. What an organisation has on
day one, though, is not an API key — it is a folder of files downloaded one
company at a time. Channel 1 (`manual_upload`) is exactly the channel for that,
and two scripts stand between the two:

```
node scripts/corpusx-prepare.mjs <dir of pdf + xlsx> --out docs/imported
```

That runs both readers, joins them on the taxpayer id, and writes a numbered
set with an `UPLOAD.md` saying which dataset each file goes to and in what
order. For a demo runbook built on it, see `corpusx-demo-runbook.md`. The two
readers can also be run on their own:

```
node scripts/corpusx-to-csv.mjs     <xlsx files or dir> --out docs/imported
node scripts/corpusx-pdf-to-csv.mjs <pdf files or dir>  --out docs/imported
```

**Both are needed, and they are not alternatives.** The workbook has the
financial statements and nothing else — its registry sheets are screenshots
pasted over empty cells. The PDF of the same pages has a real text layer, so
that is where the registry, the directors and the shareholders come from. Run
the workbook for the numbers and the PDFs for the register.

The PDF script needs poppler-utils on the path (`brew install poppler`), the
same way the workbook script needs `unzip`.

It writes the CSVs the existing importer already understands. Nothing in the
importer, the datasets or the engines knows CorpusX exists (P2), and the files
it produces carry `systemId: corpusx` when uploaded, so every figure that comes
from here keeps its provenance (P6).

## What each sheet becomes

| Sheet | Dataset | Notes |
|---|---|---|
| `BS` + `IC` | `financial_statement` | One row per fiscal year. Five years per company in the exports seen so far. |
| `OnePage` | `registry_profile` | Legal name, status, registered capital, registration date. |
| `Ratio` | — | Deliberately not imported. |
| `ข้อมูลพื้นฐาน` | — | **Screenshot, not cells** — use the PDF. |
| `กรรมการและผู้ถือหุ้น` | `director`, `shareholder` | **Screenshot, not cells** — use the PDF. |
| `ประวัติการเปลี่ยนแปลง` | — | **Screenshot, not cells** — use the PDF. |
| `บริษัทที่เกี่ยวข้อง` | — | **Screenshot, not cells** — use the PDF. |

Those four sheets hold PNG images anchored over an empty grid. A cell reader
sees nothing there and, read carelessly, reports a company with no directors
rather than a sheet it cannot read — which is why the workbook script counts
them and says so per company instead of writing zero rows.

## What each PDF page becomes

| Page (its English title) | Output | Notes |
|---|---|---|
| `Business Profile` | `registry_profile` | Status, capital, registration date, **and the registered address and TSIC code the workbook never had**. |
| `Director & Shareholder` | `director`, `shareholder` | Names, holder type, nationality, share count and percentage, plus the meeting date the register was taken at. |
| `Historical Changing` | `registry_change.reference.csv` | Capital, name and status changes with their dates. No dataset takes it yet, so the filename says reference. |
| `Related Comapany` (CorpusX's spelling) | `related_company.reference.csv` | The person × company grid — every other company these same people sit on, and whether it still trades. |

Every BS and IC line the `financial_statement` dataset needs has an exact
English label on the sheet, so the mapping is a lookup rather than a guess.

### Why `Ratio` is ignored

CorpusX computes current ratio, D/E, margins and the rest — and so do we, from
the same statements. Importing theirs would put two numbers for one thing on
two screens, and the day they disagree is the day nobody trusts either. The
sheet also uses Buddhist-era years where `BS` and `IC` use AD, which is a
second reason not to mix them.

### Why the counterparty register is a template

`party.template.csv` comes out **without** entity or customer code. Those come
from the organisation's own ERP, not from CorpusX; the file is a starting point
for a person to complete, not something to import as it stands. Tax id is the
join key back to the two datasets above.

## Reading the Related Company grid

Its ticks are 7.5pt PNGs, not characters, so no amount of text extraction finds
them. The page is rendered to greyscale and each cell is asked whether it has
ink in it. That sounds fragile and is not: the page is machine-generated on a
fixed grid, a tick covers most of its cell, and an empty cell is the bare page.
The cells are not guessed either — the row numbers down the left and the column
numbers across the top are text, and they give the exact centre of every one.

The status icon beside each company is the same glyph whether or not it still
trades, drawn dark while it does and pale once it does not, so that column is
read by shade rather than by presence.

This page is the one worth the trouble. Directors and shareholders describe one
company; this grid names every other company the same people sit on, which is
the group. It arrives as names without tax ids, so it cannot become `director`
rows directly — it is the worklist saying which companies to export from
CorpusX next, and once those are exported the links close by themselves.

## Personal data

The registry pages carry a PDPA notice, and they mean it: director and
shareholder names are personal data. `docs/imported/` is gitignored for that
reason — a git history is the one place you cannot later delete them from.

## Things a reader has to know about

Each of these produced output that looked like data rather than like a bug,
which is why `tests/corpusx-layout.test.ts` and `tests/corpusx-pdf.test.ts`
exist.

1. **The newest fiscal year's value is not under its own header.** The header
   for the latest year sits in column 4 and its percentage in column 5, but the
   value lands in column 3 *or* column 4 depending on the row — on the `BS`
   every line uses column 3, on the `IC` ten of the fifteen use column 4. Never
   both in the same row, checked across all four workbooks. Reading only the
   header column yields a latest year with a gross profit and nothing else,
   which reads as a company that filed half a statement.
2. **`OnePage`'s registration date is a raw Excel day count.** 36557 is
   2000-02-01, and it has to be converted before it reaches a column the
   importer coerces as a date.
3. **The Related Company row number sometimes shares a line with its company
   name.** Where the name wraps onto two lines the number gets a line of its
   own; where it fits on one, `pdftotext` puts both in the same line. A reader
   that handles only the first shape silently drops six of nineteen rows and
   eleven of fifty-nine links — no error, just a smaller group.
4. **The header names run two columns into one line.** Where two people's names
   sit at the same height, `pdftotext` emits them as a single line, so the
   column each name belongs to comes from each word's own box rather than from
   the line's.
