# CorpusX exports as an input channel

CorpusX is an enrichment provider in §4.4 terms. What an organisation has on
day one, though, is not an API key — it is a folder of `.xlsx` files downloaded
one company at a time. Channel 1 (`manual_upload`) is exactly the channel for
that, and `scripts/corpusx-to-csv.mjs` is the one step between the two:

```
node scripts/corpusx-to-csv.mjs <files or dir> --out docs/imported
```

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
| `ข้อมูลพื้นฐาน` | — | Empty in every export seen. |
| `กรรมการและผู้ถือหุ้น` | `director`, `shareholder` | **Empty in every export seen.** |
| `ประวัติการเปลี่ยนแปลง` | `registry_change` | Empty in every export seen. |
| `บริษัทที่เกี่ยวข้อง` | — | Empty in every export seen. |

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

## What these exports cannot feed

The directors, shareholders, change-history and related-company sheets arrive
empty. That is not a small gap: those sheets are what Module 2 (group
resolution) and Module 8 (related-party detection) read. Without them the
platform has no basis on which to say two counterparties are one group, and the
converter reports the emptiness per company rather than writing zero rows,
because a silent zero reads as "this company has no directors" instead of "we
were not sent any".

`registeredAddress` and `industryCode` are likewise absent from `OnePage` and
stay blank rather than being filled from the business-size cell that sits near
them.

## Two things the workbooks do that a reader has to know about

Both produced output that looked like data, which is why
`tests/corpusx-layout.test.ts` exists.

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
