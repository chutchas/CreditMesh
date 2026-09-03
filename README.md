# CreditMesh

Counterparty credit and collateral intelligence for groups that run several legal
entities on one ERP. The full product specification is in
[`CreditMesh_Platform_Spec.md`](./CreditMesh_Platform_Spec.md); this file covers
what exists in the repository and how to run it.

**This release is R1 — Insight Pack:** Module 0 (Core Foundation), Module 1
(Portfolio X-ray), Module 7 (Credit Term Simulator) and the CSV adapter. It runs
without connecting to any source system, which is the point: an organisation can
see a result from a single file upload before anyone opens an IT ticket.

---

## Layout

```
apps/web              Next.js 15 (App Router, TypeScript) — the Experience layer
packages/core         Domain model, tenant profile, engines — the Core layer.
                      Knows nothing about any source system (P2).
packages/adapters     CSV/Excel adapter, adapter contract — the Adapter layer
supabase/migrations   Schema, RLS, read models
tests                 Engine tests (vitest)
docs/samples          Example upload files for each dataset
scripts               P1/P2 enforcement check
config                Tenant-name denylist used by that check
```

The three-layer split is the architecture in §3 of the spec, and the dependency
direction is the whole point: `core` imports nothing from `adapters` or `web`.

## Design principles enforced in code

| Principle | Where it is enforced |
|---|---|
| P1 Config over code | `packages/core/src/tenant/profile.ts`, plus `npm run lint:no-tenant-names` |
| P2 Core doesn't know the source system | same check, scanning `packages/core` for ERP vocabulary |
| P3 Party is neutral | one `party` table with a `roles[]` array — no customer/supplier split |
| P4 Collateral is neutral | `collateral` with `type` and `direction`; there is no `bg` table |
| P5 Read-only first | `AdapterCapabilities.writeSupported` is typed as `false` |
| P6 Everything explains itself | `Evidence[]` on every derived record; score components stored, not just totals |

## Getting started

```bash
npm install
cp .env.example apps/web/.env.local     # fill in the three values
npm run dev
```

Environment variables:

| Name | Where it goes | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | safe to expose; RLS is what protects data |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | required for imports, analysis runs and bootstrap |

### Database

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Migrations are ordered and independent; `0007_rls.sql` is the one to read first
if you want to understand who can see what.

### First run

1. Create a user in Supabase Auth (Dashboard → Authentication → Users).
2. Sign in at `/th/login`. An account with no workspace lands on `/th/setup`.
3. Create the workspace — that writes tenant, starter profile v1, one
   placeholder legal entity, and makes you admin.
4. Import in this order, from `docs/samples/`: `party.csv`, then `ar_item.csv`,
   `credit_limit.csv` and `financial_statement.csv`. Receivables and limits are
   matched to counterparties by their source-system code, and statements by tax
   id, so the register has to exist first.
5. Portfolio → **Re-run analysis** to compute exposure, payment behaviour and
   risk assessments.

Every import runs in validate-first mode; nothing is written until you have seen
the row counts and the rejected rows.

## Deploying to Vercel

Root directory: `apps/web`. The build command and output are the Next.js
defaults. Set all three environment variables in the project settings — the
service role key as a plain (non-`NEXT_PUBLIC_`) variable, on Production and
Preview.

## Commands

```bash
npm run dev                    # Next.js dev server
npm run build                  # production build
npm test                       # engine tests
npm run typecheck              # project references typecheck
npm run lint:no-tenant-names   # P1 / P2 check
```

## What is deliberately not here yet

Group resolution (Module 2), the collateral ledger workflow (Module 3), the
enrichment gateway and the SAP adapter are R2/R3 and are not stubbed. The
database carries the tables and the neutral shapes they need — `party_group`,
`collateral`, `collateral_allocation`, `enrichment_snapshot` — because §6 is
explicit that retrofitting those shapes later means a rewrite, but no code reads
them yet.

Exposure currently means receivables only. `open_orders` and `undelivered_value`
exist on `exposure_snapshot` and stay zero until an order feed exists, so the
shape does not change when it arrives.
