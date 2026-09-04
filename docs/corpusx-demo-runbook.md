# Demo runbook — CorpusX files only, no ERP

What a customer can be shown using nothing but downloaded CorpusX files. It is
half the platform, and it is the half that works before anyone touches their
SAP: everything about *who this counterparty is*. The other half — what they
owe us, whether they pay — needs their receivables, and every screen that
depends on it says so out loud rather than showing a convincing zero.

## Before the demo

**Download from CorpusX, per company:** the `.xlsx` (for the statements) and
all four PDF pages — Business Profile, Director & Shareholder, Historical
Changing, Related Comapany. Put them all in one folder; the companies can be
mixed together, since the files are matched up by the taxpayer id inside them.

**One command:**

```
node scripts/corpusx-prepare.mjs ~/Downloads/corpusx --out docs/imported
```

It prints a line per company and writes `UPLOAD.md` beside the files with the
order and the row counts. Read the warnings it prints — particularly *"only one
source"*, which names companies that have a workbook but no PDFs, or the
reverse. Those look complete on every screen and are not, and finding that out
in front of a customer is worse than finding it out now.

Needs `poppler-utils` (`brew install poppler`).

## The upload, in order

The platform's import screen takes **CSV**. The PDFs and the workbook are read
by the command above; they are not uploaded directly. Six clicks:

| # | File | Dataset |
|---|---|---|
| 1 | `01-party.csv` | `party` |
| 2 | `02-registry_profile.csv` | `registry_profile` |
| 3 | `03-financial_statement.csv` | `financial_statement` |
| 4 | `04-director.csv` | `director` |
| 5 | `05-shareholder.csv` | `shareholder` |

**The order is not cosmetic.** Every dataset after the first is keyed to a
party that must already exist; a director row for a company the platform has
never been told about is skipped in silence, which looks exactly like a
successful import of nothing. If a demo ever shows a company with no directors,
this is why.

Each upload runs as a dry run first and shows what it will do before it does
it. That screen is worth showing on purpose — it is §10's reconciliation step,
and it is the difference between an import and a hope.

## Then run the engines

Nothing is computed at import time. Four buttons, in this order:

1. **Portfolio → Run analysis.** Ratios, flags, score and grade.
2. **Groups → Run resolution.** Proposals only. Confirming a group is a
   person's decision and it survives every later run.
3. **Risk index → Run.**
4. **Credit memo → Generate** for whichever counterparty you want to talk about.

## What there is to show

Measured on a real export — four companies, five fiscal years each, one of them
with the full set of four PDF pages.

### Portfolio (Module 1)

Every counterparty with a grade, a score and the year of its last filing. For
the property developer in the sample:

```
2025  current 8.02   D/E 1.89   net% 3.64   gross% 44.41   ROE% 0.97   revenue -45.7%
2024  current 7.74   D/E 1.84   net% 4.19   gross% 30.69   ROE% 2.41   revenue +67.4%
2023  current 34.06  D/E 2.49   net% 3.82   gross% 29.70   ROE% 1.70   revenue  -5.3%
2022  current 42.05  D/E 3.51   net% 3.76   gross% 15.92   ROE% 2.47   revenue -12.7%
2021  current 25.10  D/E 3.66   net% 3.86   gross% 16.45   ROE% 2.98
```

Score **70 → grade B**, and the screen shows where the 70 came from: liquidity
25.0, profitability 13.6, leverage 11.5, filing currency 11.1, equity strength
8.7 — with `payment_behavior` and `delinquency` listed as *missing*, not scored
as zero.

No flag fires on that 45.7% revenue drop, and that is the rule working: one bad
year after a 67% year reads differently from two contractions running, so the
flag needs two. Worth saying out loud if a customer notices, because they will.

### Party detail

Statements, ratios, registry profile, identifiers, and every figure traceable
to the file it came from.

### Groups (Module 2)

Directors and shareholders become group edges with their reasons attached —
*"นาย ก is a director of both"* — and a confidence number. Nothing is confirmed
automatically, and §7 is explicit that an unconfirmed group must never block an
order.

The Related Company page adds the strongest part of the story even though it is
not importable yet: for one company in the sample it names **19 companies and
59 person-to-company links**. That is the group, in the customer's own registry
data, and it is also the list of which companies to export from CorpusX next.

### Credit memo (Module 4)

Assembles to about **80% complete** and prints the rest as named gaps rather
than blanks:

- *"No settled invoices on record. That is not the same as paying on time, and
  it should not be read as such."*
- *"absence of a result is not the same as a clean search"*

`reviewable: false` until an analyst writes the four sections that are theirs:
assessment, limit proposal, conditions, recommendation. That refusal is the
product, not a limitation of it.

### Risk index (Module 17)

**It will come out low and flagged incomplete, and that is correct.** On the
sample it reads 31.1 with `incomplete: true`, because the `delinquency`
component's absence rule is `treat_as_worst` and there is no receivable data to
score it with. The memo says as much: *"computed from incomplete data and
should not be compared with a full one."*

Decide before the demo which story you want. Leaving it as it is demonstrates
that the platform will not flatter a counterparty it knows nothing about.
Setting the rule to `no_information` on the Admin screen drops the component
instead and gives a number that reflects only what is actually known. Both are
defensible; being surprised by it in the room is not.

### Watchlist (Module 5)

Nothing to see on a first import — a change needs a before and an after. To
demonstrate it: import, edit one value in `02-registry_profile.csv` (the status,
or the capital), import again, then run the watchlist. The change appears with
both values and the date.

### Simulator (Module 9)

Takes its inputs on the screen, so it works standalone and needs no data at
all. A good one to end on.

## What will be empty, and why

Collateral, order blocks, collection, payments, late charges, provisioning and
white space all need receivables, limits or collateral from the customer's own
systems. CorpusX has none of that and never will.

Say this before opening those screens rather than after. "This is the half that
works from public registry data; the other half switches on when your AR ledger
does" is a much better sentence than an empty table.

## Personal data

Director and shareholder names are personal data under the PDPA, and the
CorpusX pages carry the notice themselves. `docs/imported/` is gitignored. If
the demo runs against a shared database, use companies whose registers you are
comfortable having sat there afterwards.
