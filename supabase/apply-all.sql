-- CreditMesh — all migrations concatenated, in order.
-- Generated from supabase/migrations/ by scripts/build-apply-all.mjs.
-- Paste into the Supabase SQL editor if you are not using the CLI. Running it
-- twice will fail on the CREATE TYPE statements — that is intentional, it is
-- not an idempotent script.

-- ============================================================
-- migrations/20260903000100_foundation.sql
-- ============================================================

-- CreditMesh — 0001 Foundation: tenants, profile versioning, users, helpers.
--
-- Multi-tenancy note (Spec §11): the first release deploys one database per
-- organisation. tenant_id is still carried on every row and enforced by RLS
-- anyway — retrofitting a tenant key onto a live schema is expensive, and
-- carrying it from day one costs an index.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------- tenant ---
create table public.tenant (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  display_name  text not null,
  base_currency char(3) not null default 'THB',
  locale        text not null default 'th-TH',
  timezone      text not null default 'Asia/Bangkok',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- P1 — the whole configuration of an organisation, versioned. Nothing that
-- names an organisation belongs in code, so this row is what makes onboarding
-- a data task rather than a development task.
create table public.tenant_profile (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  version        integer not null,
  profile        jsonb not null,
  effective_from date not null,
  is_current     boolean not null default false,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  unique (tenant_id, version)
);

-- Exactly one current profile per tenant: an ambiguous "current" config is a
-- class of bug that shows up as unexplainable numbers weeks later.
create unique index tenant_profile_one_current
  on public.tenant_profile (tenant_id)
  where is_current;

create table public.legal_entity (
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  code          text not null,
  display_name  text not null,
  currency      char(3) not null,
  parent_code   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, code),
  foreign key (tenant_id, parent_code) references public.legal_entity(tenant_id, code)
);

-- ------------------------------------------------------------------ user ---
-- entity_scope empty = every entity. Spec §11: a BU user sees their own entity
-- by default and the cross-entity picture is a central-credit privilege,
-- because letting every BU see every other BU's balances is politically
-- explosive in most groups.
create table public.app_user (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  role_code    text not null default 'entity_user',
  entity_scope text[] not null default '{}',
  display_name text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create index app_user_tenant_idx on public.app_user (tenant_id);

-- --------------------------------------------------------------- helpers ---
-- security definer so a policy on app_user itself cannot recurse; search_path
-- pinned so the function cannot be captured by a rogue schema.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tenant_id from public.app_user where user_id = auth.uid() and is_active
$$;

create or replace function public.current_role_code()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role_code from public.app_user where user_id = auth.uid() and is_active
$$;

create or replace function public.has_entity_access(p_entity_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.app_user u
    where u.user_id = auth.uid()
      and u.is_active
      and (cardinality(u.entity_scope) = 0 or p_entity_code = any (u.entity_scope))
  )
$$;

create or replace function public.set_current_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.tenant_profile where id = p_profile_id;
  if v_tenant is null then
    raise exception 'profile % not found', p_profile_id;
  end if;
  update public.tenant_profile set is_current = false where tenant_id = v_tenant and is_current;
  update public.tenant_profile set is_current = true where id = p_profile_id;
end;
$$;

-- ============================================================
-- migrations/20260903000200_party.sql
-- ============================================================

-- CreditMesh — 0002 Party (Golden Party Record, Module 0).
--
-- P3: there is no customer table and no supplier table. One company is
-- routinely both, and building two registers means building every analysis
-- engine twice. Modules 8 and 9 come almost free because of this one decision.

create type public.party_role as enum ('customer', 'supplier', 'prospect');
create type public.party_status as enum ('active', 'inactive', 'blocked', 'merged');
create type public.identifier_kind as enum ('tax_id', 'source_system', 'registration_no', 'internal', 'other');

create table public.party (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  legal_name    text not null,
  display_name  text,
  tax_id        text,
  country_code  char(2) default 'TH',
  roles         public.party_role[] not null default '{}',
  status        public.party_status not null default 'active',
  -- Set when party resolution folded this record into another. The row is kept
  -- so old references and old reports still resolve to something.
  merged_into_party_id uuid references public.party(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index party_tenant_tax_id_key
  on public.party (tenant_id, tax_id)
  where tax_id is not null and status <> 'merged';

create index party_tenant_idx on public.party (tenant_id);
create index party_name_trgm_idx on public.party using gin (legal_name gin_trgm_ops);

-- Spec §6: this must be a table, not a column on party. One counterparty holds
-- a different code in every system and often a different code per entity, and
-- the next organisation onboarded will have more systems than this one.
create table public.party_identifier (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  kind              public.identifier_kind not null,
  system_id         text,
  legal_entity_code text,
  value             text not null,
  is_primary        boolean not null default false,
  created_at        timestamptz not null default now()
);

create unique index party_identifier_unique
  on public.party_identifier (tenant_id, kind, coalesce(system_id, ''), coalesce(legal_entity_code, ''), value);
create index party_identifier_party_idx on public.party_identifier (party_id);

create type public.relationship_kind as enum (
  'shareholder_of', 'director_of', 'parent_of', 'same_registered_address', 'name_similarity'
);

create table public.party_relationship (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  from_party_id uuid not null references public.party(id) on delete cascade,
  to_party_id   uuid not null references public.party(id) on delete cascade,
  kind          public.relationship_kind not null,
  weight        numeric(4,3) not null default 0.5 check (weight >= 0 and weight <= 1),
  -- P6: no conclusion without its evidence, all the way down to edges.
  evidence      jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  check (from_party_id <> to_party_id)
);

create index party_relationship_from_idx on public.party_relationship (from_party_id);
create index party_relationship_to_idx on public.party_relationship (to_party_id);

create table public.party_group (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  name         text not null,
  confidence   numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  evidence     jsonb not null default '[]'::jsonb,
  -- Null until a person confirms. Spec §7 M2 forbids acting on an unconfirmed
  -- group, and specifically forbids blocking orders from it.
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);

create table public.party_group_member (
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  group_id  uuid not null references public.party_group(id) on delete cascade,
  party_id  uuid not null references public.party(id) on delete cascade,
  primary key (group_id, party_id)
);

-- Merge candidates the resolution engine could not decide on its own. A queue,
-- not an automatic action: a wrongly merged party produces a wrong exposure
-- total, and nobody goes looking for a total that looks plausible.
create table public.party_merge_candidate (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  left_party_id  uuid not null references public.party(id) on delete cascade,
  right_party_id uuid not null references public.party(id) on delete cascade,
  reason         text not null,
  score          numeric(4,3) not null,
  status         text not null default 'pending' check (status in ('pending', 'merged', 'rejected')),
  decided_by     uuid,
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

create index party_merge_candidate_pending_idx
  on public.party_merge_candidate (tenant_id) where status = 'pending';

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger party_touch_updated_at
  before update on public.party
  for each row execute function public.touch_updated_at();

-- ============================================================
-- migrations/20260903000300_receivables.sql
-- ============================================================

-- CreditMesh — 0003 Receivables, limits and exposure.

create table public.ar_item (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  system_id         text not null default 'csv',
  document_no       text not null,
  document_date     date not null,
  due_date          date not null,
  -- Null while open. Cleared items are what payment behaviour is computed from;
  -- open items say how long someone has held an invoice, not how they pay.
  cleared_date      date,
  amount            numeric(20,2) not null,
  currency          char(3) not null,
  -- Both currencies are kept (NFR §11). Converting and discarding the original
  -- makes every later restatement impossible.
  amount_base       numeric(20,2) not null,
  base_currency     char(3) not null,
  fx_rate           numeric(18,8),
  is_open           boolean generated always as (cleared_date is null) stored,
  source_ref        text not null,
  imported_at       timestamptz not null default now(),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create unique index ar_item_natural_key
  on public.ar_item (tenant_id, system_id, legal_entity_code, document_no);
create index ar_item_party_idx on public.ar_item (tenant_id, party_id);
create index ar_item_open_idx on public.ar_item (tenant_id, legal_entity_code, due_date) where cleared_date is null;

create type public.limit_origin as enum ('source_system', 'platform');

create table public.credit_limit (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  limit_amount      numeric(20,2) not null,
  currency          char(3) not null,
  valid_from        date not null default current_date,
  valid_to          date,
  origin            public.limit_origin not null default 'source_system',
  source_ref        text not null,
  created_at        timestamptz not null default now(),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index credit_limit_party_idx on public.credit_limit (tenant_id, party_id, legal_entity_code);

-- Daily grain on purpose (Spec §6). Trend analysis and the provision run both
-- need history, and history cannot be reconstructed after the fact.
create table public.exposure_snapshot (
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  as_of             date not null,
  ar_open           numeric(20,2) not null default 0,
  ar_overdue        numeric(20,2) not null default 0,
  open_orders       numeric(20,2) not null default 0,
  undelivered_value numeric(20,2) not null default 0,
  total_exposure    numeric(20,2) not null default 0,
  credit_limit      numeric(20,2),
  utilization_pct   numeric(8,2),
  base_currency     char(3) not null,
  computed_at       timestamptz not null default now(),
  primary key (tenant_id, party_id, legal_entity_code, as_of)
);

create index exposure_snapshot_asof_idx on public.exposure_snapshot (tenant_id, as_of desc);

create table public.payment_behavior (
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  party_id         uuid not null references public.party(id) on delete cascade,
  period_start     date not null,
  period_end       date not null,
  invoice_count    integer not null default 0,
  -- Amount-weighted: an unweighted mean lets many small prompt payments hide
  -- one very late large one, which is the case that matters.
  weighted_avg_dpd numeric(10,2) not null default 0,
  max_dpd          integer not null default 0,
  on_time_pct      numeric(5,2) not null default 0,
  computed_at      timestamptz not null default now(),
  primary key (tenant_id, party_id, period_start, period_end)
);

-- ============================================================
-- migrations/20260903000400_collateral.sql
-- ============================================================

-- CreditMesh — 0004 Collateral.
--
-- P4: there is no `bg` table. Spec §6 is explicit that starting with one and
-- then meeting a customer who uses parent guarantees or LCs means a rewrite,
-- and that the neutral shape costs the same to build today.

create type public.collateral_type as enum (
  'bank_guarantee', 'letter_of_credit', 'cash_deposit',
  'parent_guarantee', 'performance_bond', 'insurance', 'other'
);

-- inbound = the counterparty posted it to us; outbound = we posted it to them.
-- The supplier side is the same subject in the opposite direction, so this
-- column is what lets one ledger serve both.
create type public.collateral_direction as enum ('inbound', 'outbound');
create type public.collateral_status as enum ('draft', 'active', 'expired', 'released', 'claimed');

create table public.collateral (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  type              public.collateral_type not null,
  direction         public.collateral_direction not null default 'inbound',
  reference         text not null,
  issuer            text,
  amount            numeric(20,2) not null check (amount >= 0),
  currency          char(3) not null,
  effective_date    date not null,
  expiry_date       date,
  -- Distinct from expiry on purpose: a guarantee often stays claimable for a
  -- window after it expires, and missing that window is a pure cash loss.
  claim_deadline    date,
  physical_location text,
  status            public.collateral_status not null default 'active',
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (expiry_date is null or expiry_date >= effective_date)
);

create unique index collateral_reference_key on public.collateral (tenant_id, reference);
create index collateral_expiry_idx on public.collateral (tenant_id, expiry_date) where status = 'active';
create index collateral_party_idx on public.collateral (tenant_id, party_id);

create table public.collateral_allocation (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  collateral_id     uuid not null references public.collateral(id) on delete cascade,
  legal_entity_code text not null,
  allocated         numeric(20,2) not null check (allocated >= 0),
  utilized          numeric(20,2) not null default 0 check (utilized >= 0),
  valid_from        date not null default current_date,
  valid_to          date,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index collateral_allocation_collateral_idx on public.collateral_allocation (collateral_id);
create index collateral_allocation_entity_idx on public.collateral_allocation (tenant_id, legal_entity_code);

create type public.collateral_event_kind as enum (
  'issued', 'amended', 'renewed', 'released', 'expired', 'claimed', 'allocated', 'reallocated'
);

create table public.collateral_event (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  collateral_id uuid not null references public.collateral(id) on delete cascade,
  kind          public.collateral_event_kind not null,
  occurred_at   timestamptz not null default now(),
  actor         uuid,
  detail        jsonb not null default '{}'::jsonb
);

create index collateral_event_collateral_idx on public.collateral_event (collateral_id, occurred_at desc);

create trigger collateral_touch_updated_at
  before update on public.collateral
  for each row execute function public.touch_updated_at();

-- The number the spec says most organisations cannot answer on the spot:
-- how much of each instrument is actually spoken for, and by whom.
create or replace view public.collateral_balance as
select
  c.tenant_id,
  c.id as collateral_id,
  c.party_id,
  c.reference,
  c.type,
  c.direction,
  c.amount,
  c.currency,
  c.expiry_date,
  c.status,
  coalesce(sum(a.allocated), 0) as allocated_total,
  coalesce(sum(a.utilized), 0)  as utilized_total,
  c.amount - coalesce(sum(a.allocated), 0) as unallocated,
  case when c.amount = 0 then null
       else round(coalesce(sum(a.allocated), 0) / c.amount * 100, 2)
  end as allocated_pct,
  coalesce(sum(a.allocated), 0) > c.amount as is_over_allocated
from public.collateral c
left join public.collateral_allocation a
  on a.collateral_id = c.id
 and (a.valid_to is null or a.valid_to >= current_date)
group by c.id;

-- ============================================================
-- migrations/20260903000500_enrichment_risk.sql
-- ============================================================

-- CreditMesh — 0005 Enrichment, financials and risk.
--
-- The platform never resells counterparty data (§3, §12). Each tenant supplies
-- their own provider account; what is stored here is the tenant's own copy of
-- what they paid for, and provider_id is always recorded with it.

create table public.financial_statement (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenant(id) on delete cascade,
  party_id            uuid not null references public.party(id) on delete cascade,
  fiscal_year         integer not null,
  period_end          date,
  currency            char(3) not null default 'THB',
  revenue             numeric(20,2),
  gross_profit        numeric(20,2),
  net_profit          numeric(20,2),
  total_assets        numeric(20,2),
  total_liabilities   numeric(20,2),
  equity              numeric(20,2),
  current_assets      numeric(20,2),
  current_liabilities numeric(20,2),
  cash                numeric(20,2),
  inventory           numeric(20,2),
  receivables         numeric(20,2),
  provider_id         text not null default 'manual_upload',
  retrieved_at        timestamptz not null default now(),
  source_ref          text
);

create unique index financial_statement_key
  on public.financial_statement (tenant_id, party_id, fiscal_year);
create index financial_statement_party_idx on public.financial_statement (tenant_id, party_id, fiscal_year desc);

-- Point-in-time copies of registry data. Module 5 detects change by comparing
-- consecutive snapshots, which only works if the old one is never overwritten.
create table public.enrichment_snapshot (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  party_id     uuid not null references public.party(id) on delete cascade,
  provider_id  text not null,
  dataset      text not null,
  payload      jsonb not null,
  retrieved_at timestamptz not null default now()
);

create index enrichment_snapshot_party_idx
  on public.enrichment_snapshot (tenant_id, party_id, dataset, retrieved_at desc);

-- Natural persons from registry data. Held apart from company data because the
-- retention and masking rules are different (NFR §11) and because Module 8
-- touches individuals and can affect them personally.
create table public.person (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  full_name     text not null,
  -- Hashed, never stored in the clear: it is an identifier, not an attribute
  -- the platform ever needs to display.
  national_id_hash text,
  provider_id   text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index person_name_trgm_idx on public.person using gin (full_name gin_trgm_ops);

create table public.person_party_role (
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  person_id  uuid not null references public.person(id) on delete cascade,
  party_id   uuid not null references public.party(id) on delete cascade,
  role       text not null check (role in ('director', 'shareholder')),
  share_pct  numeric(6,3),
  as_of      date,
  source_ref text,
  primary key (person_id, party_id, role)
);

create table public.risk_assessment (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  party_id   uuid not null references public.party(id) on delete cascade,
  as_of      date not null default current_date,
  score      numeric(6,2) not null,
  grade      text not null,
  -- P6: the components are stored, not just the total, so the screen can take
  -- the score apart. The person using this signs their name to the decision.
  components jsonb not null default '[]'::jsonb,
  evidence   jsonb not null default '[]'::jsonb,
  flags      jsonb not null default '[]'::jsonb,
  -- Which profile version produced it: weights change, and a score computed
  -- under old weights must stay explainable.
  profile_version integer,
  computed_at timestamptz not null default now()
);

create unique index risk_assessment_key on public.risk_assessment (tenant_id, party_id, as_of);
create index risk_assessment_grade_idx on public.risk_assessment (tenant_id, grade, as_of desc);

-- ============================================================
-- migrations/20260903000600_ingestion_audit.sql
-- ============================================================

-- CreditMesh — 0006 Ingestion and audit.

create type public.import_status as enum ('pending', 'validating', 'applied', 'failed', 'rejected');

create table public.import_batch (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  system_id     text not null default 'csv',
  dataset_id    text not null,
  file_name     text,
  status        public.import_status not null default 'pending',
  rows_read     integer not null default 0,
  rows_accepted integer not null default 0,
  rows_rejected integer not null default 0,
  -- The as-of date of the data, which is not the time it was uploaded. Every
  -- screen shows this, per §5.2.
  data_as_of    date,
  errors        jsonb not null default '[]'::jsonb,
  warnings      jsonb not null default '[]'::jsonb,
  uploaded_by   uuid,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index import_batch_tenant_idx on public.import_batch (tenant_id, dataset_id, started_at desc);

-- What every screen reads to decide whether to show a staleness warning.
-- §5.2: an adapter that fails must be visible, not silently serve old numbers.
create table public.dataset_freshness (
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  system_id        text not null,
  dataset_id       text not null,
  last_success_at  timestamptz,
  last_attempt_at  timestamptz,
  data_as_of       date,
  stale_after_hours integer not null default 48,
  last_error       text,
  primary key (tenant_id, system_id, dataset_id)
);

create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  actor       uuid,
  actor_label text,
  action      text not null,
  object_type text not null,
  object_id   text not null,
  -- The values the actor was looking at when they decided (NFR §11). Storing
  -- only the change makes an approval impossible to reconstruct later.
  snapshot    jsonb,
  at          timestamptz not null default now()
);

create index audit_log_tenant_idx on public.audit_log (tenant_id, at desc);
create index audit_log_object_idx on public.audit_log (tenant_id, object_type, object_id, at desc);

-- ============================================================
-- migrations/20260903000700_rls.sql
-- ============================================================

-- CreditMesh — 0007 Row level security.
--
-- Two rules, applied consistently:
--
--   1. Every row belongs to a tenant, and a user only ever sees their own.
--   2. Rows that carry money at a legal-entity grain are additionally scoped to
--      the entities the user is allowed to see. A user with an empty
--      entity_scope (central credit, admin, auditor) sees across all of them.
--      NFR §11 calls this out specifically: letting every BU see every other
--      BU's balances is politically explosive in most groups, so the default is
--      the narrow one.
--
-- The party master itself is tenant-wide rather than entity-scoped. Knowing a
-- counterparty exists is not sensitive; knowing what they owe another BU is,
-- and that lives in ar_item, credit_limit and exposure_snapshot.
--
-- Writes are deliberately not granted to end users here. Ingestion and every
-- state change run through server-side handlers on the service role, which
-- check permissions and write audit_log in the same transaction. A direct
-- client write would bypass the audit trail, and an unauditable change is
-- exactly what this product exists to eliminate.

-- ---------------------------------------------------------------- enable ---
alter table public.tenant                  enable row level security;
alter table public.tenant_profile          enable row level security;
alter table public.legal_entity            enable row level security;
alter table public.app_user                enable row level security;
alter table public.party                   enable row level security;
alter table public.party_identifier        enable row level security;
alter table public.party_relationship      enable row level security;
alter table public.party_group             enable row level security;
alter table public.party_group_member      enable row level security;
alter table public.party_merge_candidate   enable row level security;
alter table public.ar_item                 enable row level security;
alter table public.credit_limit            enable row level security;
alter table public.exposure_snapshot       enable row level security;
alter table public.payment_behavior        enable row level security;
alter table public.collateral              enable row level security;
alter table public.collateral_allocation   enable row level security;
alter table public.collateral_event        enable row level security;
alter table public.financial_statement     enable row level security;
alter table public.enrichment_snapshot     enable row level security;
alter table public.person                  enable row level security;
alter table public.person_party_role       enable row level security;
alter table public.risk_assessment         enable row level security;
alter table public.import_batch            enable row level security;
alter table public.dataset_freshness       enable row level security;
alter table public.audit_log               enable row level security;

-- ------------------------------------------------------- identity & config ---
create policy tenant_read on public.tenant
  for select to authenticated
  using (id = public.current_tenant_id());

create policy tenant_profile_read on public.tenant_profile
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy app_user_read_self on public.app_user
  for select to authenticated
  using (user_id = auth.uid());

-- Admins need the roster to manage access; nobody else does.
create policy app_user_read_admin on public.app_user
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

create policy legal_entity_read on public.legal_entity
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(code));

-- ------------------------------------------------------------ party master ---
create policy party_read on public.party
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy party_identifier_read on public.party_identifier
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy party_relationship_read on public.party_relationship
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy party_group_read on public.party_group
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy party_group_member_read on public.party_group_member
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy party_merge_candidate_read on public.party_merge_candidate
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- --------------------------------------------------- entity-scoped money ---
create policy ar_item_read on public.ar_item
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy credit_limit_read on public.credit_limit
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy exposure_snapshot_read on public.exposure_snapshot
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy payment_behavior_read on public.payment_behavior
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy collateral_allocation_read on public.collateral_allocation
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

-- A collateral instrument is visible when the user can see at least one of the
-- entities it is allocated to, or when it is not yet allocated anywhere —
-- unallocated instruments are precisely what central credit is looking for.
create policy collateral_read on public.collateral
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      exists (
        select 1 from public.collateral_allocation a
        where a.collateral_id = collateral.id
          and public.has_entity_access(a.legal_entity_code)
      )
      or not exists (
        select 1 from public.collateral_allocation a where a.collateral_id = collateral.id
      )
    )
  );

create policy collateral_event_read on public.collateral_event
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and exists (select 1 from public.collateral c where c.id = collateral_event.collateral_id)
  );

-- --------------------------------------------------- enrichment & scoring ---
create policy financial_statement_read on public.financial_statement
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy enrichment_snapshot_read on public.enrichment_snapshot
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy risk_assessment_read on public.risk_assessment
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- Natural-person data is narrower than company data on purpose (NFR §11).
-- Module 8 can affect individuals personally, so its inputs are not general
-- reading material.
create policy person_read on public.person
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'central_credit', 'auditor')
  );

create policy person_party_role_read on public.person_party_role
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'central_credit', 'auditor')
  );

-- --------------------------------------------------------- ops & evidence ---
create policy import_batch_read on public.import_batch
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy dataset_freshness_read on public.dataset_freshness
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy audit_log_read on public.audit_log
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'auditor', 'central_credit')
  );

-- Views must run as the caller, or RLS on the underlying tables is bypassed.
alter view public.collateral_balance set (security_invoker = on);

-- ============================================================
-- migrations/20260903000800_views.sql
-- ============================================================

-- CreditMesh — 0008 Read models for the Portfolio X-ray.
--
-- These exist so a portfolio screen is one query rather than a fan-out of
-- per-party requests. All of them are security_invoker, so the RLS in 0007 is
-- what decides which rows a given user gets back.

-- Latest exposure per party per entity. distinct on is the cheap way to take
-- the newest row per key in Postgres.
create or replace view public.v_exposure_current as
select distinct on (e.tenant_id, e.party_id, e.legal_entity_code)
  e.tenant_id,
  e.party_id,
  e.legal_entity_code,
  e.as_of,
  e.ar_open,
  e.ar_overdue,
  e.open_orders,
  e.undelivered_value,
  e.total_exposure,
  e.credit_limit,
  e.utilization_pct,
  e.base_currency
from public.exposure_snapshot e
order by e.tenant_id, e.party_id, e.legal_entity_code, e.as_of desc;

create or replace view public.v_risk_current as
select distinct on (r.tenant_id, r.party_id)
  r.tenant_id,
  r.party_id,
  r.as_of,
  r.score,
  r.grade,
  r.components,
  r.flags,
  r.profile_version
from public.risk_assessment r
order by r.tenant_id, r.party_id, r.as_of desc;

-- One row per counterparty: who they are, what they owe us across every
-- entity, and what the last assessment concluded. This is the X-ray table.
create or replace view public.v_party_portfolio as
select
  p.tenant_id,
  p.id as party_id,
  p.legal_name,
  p.tax_id,
  p.roles,
  p.status,
  coalesce(x.entity_count, 0)          as entity_count,
  coalesce(x.total_exposure, 0)        as total_exposure,
  coalesce(x.total_ar_open, 0)         as total_ar_open,
  coalesce(x.total_ar_overdue, 0)      as total_ar_overdue,
  x.total_credit_limit,
  case
    when x.total_credit_limit is null or x.total_credit_limit = 0 then null
    else round(coalesce(x.total_exposure, 0) / x.total_credit_limit * 100, 2)
  end                                   as utilization_pct,
  x.as_of                               as exposure_as_of,
  r.score,
  r.grade,
  r.flags,
  r.as_of                               as risk_as_of,
  fs.latest_fiscal_year
from public.party p
left join (
  select
    tenant_id,
    party_id,
    count(*)                     as entity_count,
    sum(total_exposure)          as total_exposure,
    sum(ar_open)                 as total_ar_open,
    sum(ar_overdue)              as total_ar_overdue,
    -- Summing limits across entities is the group-level number the ERP cannot
    -- produce; it is not the same thing as a group limit, and the UI labels it
    -- as the sum it is.
    nullif(sum(credit_limit), 0) as total_credit_limit,
    max(as_of)                   as as_of
  from public.v_exposure_current
  group by tenant_id, party_id
) x on x.tenant_id = p.tenant_id and x.party_id = p.id
left join public.v_risk_current r on r.tenant_id = p.tenant_id and r.party_id = p.id
left join (
  select tenant_id, party_id, max(fiscal_year) as latest_fiscal_year
  from public.financial_statement group by tenant_id, party_id
) fs on fs.tenant_id = p.tenant_id and fs.party_id = p.id
where p.status <> 'merged';

alter view public.v_exposure_current set (security_invoker = on);
alter view public.v_risk_current     set (security_invoker = on);
alter view public.v_party_portfolio  set (security_invoker = on);

-- Grade distribution with the exposure sitting in each band. The second number
-- is the one that gets budget approved: a count of risky counterparties means
-- little without the money behind them.
create or replace function public.portfolio_by_grade()
returns table (grade text, party_count bigint, total_exposure numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(v.grade, 'ungraded') as grade,
         count(*)                      as party_count,
         coalesce(sum(v.total_exposure), 0) as total_exposure
  from public.v_party_portfolio v
  group by coalesce(v.grade, 'ungraded')
  order by 1
$$;

-- ============================================================
-- migrations/20260903000900_party_identifier_key.sql
-- ============================================================

-- CreditMesh — 0009 Fix the party_identifier uniqueness key.
--
-- 0002 declared uniqueness as an expression index over coalesce(system_id, '')
-- and coalesce(legal_entity_code, ''). Postgres will not match an
-- `on conflict (tenant_id, kind, system_id, legal_entity_code, value)` clause to
-- an expression index, so every identifier upsert failed with "there is no
-- unique or exclusion constraint matching the ON CONFLICT specification".
--
-- The consequence was worse than a failed write: with no identifiers on file,
-- receivables and limits could not be matched to a counterparty by source code,
-- and financial statements could not be matched by tax id. Imports reported
-- success and wrote nothing.
--
-- The fix is to stop using NULL as "not applicable" here. An identifier that is
-- not scoped to a system or an entity now carries an empty string, so the key
-- can be a plain column list that both Postgres and PostgREST understand.

update public.party_identifier
   set system_id = coalesce(system_id, ''),
       legal_entity_code = coalesce(legal_entity_code, '');

alter table public.party_identifier
  alter column system_id set default '',
  alter column system_id set not null,
  alter column legal_entity_code set default '',
  alter column legal_entity_code set not null;

drop index if exists public.party_identifier_unique;

create unique index party_identifier_unique
  on public.party_identifier (tenant_id, kind, system_id, legal_entity_code, value);

-- ============================================================
-- migrations/20260903001000_registry_and_groups.sql
-- ============================================================

-- CreditMesh — 0010 Registry profile, group proposals, group exposure.
--
-- Module 2 needs three things the receivables side does not provide: the
-- registry facts a group is inferred from, somewhere to keep a proposed group
-- while it waits for a human, and a way to add up exposure across a group the
-- same way it is already added up across a party.

-- Registry facts about a counterparty, from whichever provider the tenant pays
-- for — or from a spreadsheet. provider_id and retrieved_at travel with the row
-- because a conclusion drawn from it has to be traceable to its source (P6).
create table public.party_registry_profile (
  tenant_id           uuid not null references public.tenant(id) on delete cascade,
  party_id            uuid not null references public.party(id) on delete cascade,
  legal_status        text,
  registered_capital  numeric(20,2),
  registration_date   date,
  registered_address  text,
  -- Crude normalisation, matched on exactly. Anything cleverer starts guessing
  -- at administrative structure, and a wrong guess silently merges two
  -- unrelated companies.
  registered_address_norm text,
  industry_code       text,
  provider_id         text not null default 'manual_upload',
  retrieved_at        timestamptz not null default now(),
  primary key (tenant_id, party_id)
);

create index party_registry_address_idx
  on public.party_registry_profile (tenant_id, registered_address_norm)
  where registered_address_norm is not null;

-- Group proposals carry their own status. Spec §7 M2 forbids acting on a group
-- nobody has confirmed, and specifically forbids using one to block an order,
-- so "proposed" and "confirmed" cannot be the same state.
alter table public.party_group
  add column if not exists status text not null default 'proposed'
    check (status in ('proposed', 'confirmed', 'rejected')),
  add column if not exists run_id uuid,
  add column if not exists member_count integer not null default 0,
  add column if not exists rejected_by uuid,
  add column if not exists rejected_at timestamptz;

create index party_group_status_idx on public.party_group (tenant_id, status, confidence desc);

-- The edges behind a proposal, kept so the evidence panel can show why two
-- counterparties were joined rather than asserting that they are related.
create table public.party_group_edge (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  group_id        uuid not null references public.party_group(id) on delete cascade,
  left_party_id   uuid not null references public.party(id) on delete cascade,
  right_party_id  uuid not null references public.party(id) on delete cascade,
  confidence      numeric(4,3) not null,
  signals         jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create index party_group_edge_group_idx on public.party_group_edge (group_id);

-- Hub persons and addresses the engine ignored, offered back as exclusions.
-- The exclusion list is built from what the data actually contains rather than
-- expecting someone to curate it correctly before the first run.
create table public.group_exclusion_suggestion (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  kind         text not null check (kind in ('person', 'address')),
  value        text not null,
  party_count  integer not null,
  status       text not null default 'suggested' check (status in ('suggested', 'accepted', 'dismissed')),
  created_at   timestamptz not null default now(),
  unique (tenant_id, kind, value)
);

-- Group exposure across every legal entity: the number the ERP cannot produce,
-- and the reason a central credit function exists.
create or replace view public.v_group_exposure as
select
  g.tenant_id,
  g.id                          as group_id,
  g.name                        as group_name,
  g.confidence,
  g.status,
  count(distinct m.party_id)    as member_count,
  count(distinct e.legal_entity_code) as entity_count,
  coalesce(sum(e.total_exposure), 0) as total_exposure,
  coalesce(sum(e.ar_overdue), 0)     as total_overdue,
  nullif(sum(e.credit_limit), 0)     as total_credit_limit,
  max(e.as_of)                       as exposure_as_of
from public.party_group g
join public.party_group_member m on m.group_id = g.id
left join public.v_exposure_current e on e.party_id = m.party_id
group by g.id;

alter view public.v_group_exposure set (security_invoker = on);

-- ------------------------------------------------------------------- RLS ---
alter table public.party_registry_profile     enable row level security;
alter table public.party_group_edge           enable row level security;
alter table public.group_exclusion_suggestion enable row level security;

create policy party_registry_profile_read on public.party_registry_profile
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy party_group_edge_read on public.party_group_edge
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- Suggested exclusions name individual people. Same restriction as the person
-- table: this is not general reading material.
create policy group_exclusion_suggestion_read on public.group_exclusion_suggestion
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'central_credit', 'auditor')
  );

-- ============================================================
-- migrations/20260903001100_group_limit_context.sql
-- ============================================================

-- CreditMesh — 0011 Give the group limit figure its context.
--
-- v_group_exposure already sums the credit limits of a group's members, and
-- that sum is easy to misread. Sitting next to the group's exposure it invites
-- the reading "78% used, room left" — when the entire point of Module 2 is that
-- nobody ever approved that amount to this owner. Three separate approvals do
-- not add up to one decision.
--
-- The largest single limit is the honest comparison: it is the biggest amount
-- anyone actually decided to lend this owner in one go, and a group exposure
-- well above it is precisely the finding the module exists to surface — the
-- case for a group limit rather than a set of company limits.

-- Dropped rather than replaced: CREATE OR REPLACE VIEW can only append
-- columns at the end, and max_single_limit belongs beside the other limit
-- figures rather than tacked on after the as-of date. Nothing depends on this
-- view, so dropping it costs nothing.
drop view if exists public.v_group_exposure;

create view public.v_group_exposure as
select
  g.tenant_id,
  g.id                          as group_id,
  g.name                        as group_name,
  g.confidence,
  g.status,
  count(distinct m.party_id)    as member_count,
  count(distinct e.legal_entity_code) as entity_count,
  coalesce(sum(e.total_exposure), 0) as total_exposure,
  coalesce(sum(e.ar_overdue), 0)     as total_overdue,
  nullif(sum(e.credit_limit), 0)     as total_credit_limit,
  max(e.credit_limit)                as max_single_limit,
  max(e.as_of)                       as exposure_as_of
from public.party_group g
join public.party_group_member m on m.group_id = g.id
left join public.v_exposure_current e on e.party_id = m.party_id
group by g.id;

alter view public.v_group_exposure set (security_invoker = on);

-- ============================================================
-- migrations/20260903001200_supplier_commitment.sql
-- ============================================================

-- CreditMesh — 0012 Supplier commitments (Module 9).
--
-- Module 9 reuses the Financial Analysis Engine unchanged; the only thing it
-- needs that the receivables side does not provide is the other half of the
-- question. A fragile supplier the organisation barely uses is not a problem —
-- what matters is what it costs when this one stops delivering.
--
-- Note there is no supplier table. The counterparty is a `party` with the
-- supplier role (P3); this table holds the commercial dependency, nothing else.

create table public.supplier_commitment (
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  -- Ordered and not yet delivered: money already committed.
  open_commitment   numeric(20,2) not null default 0,
  annual_spend      numeric(20,2) not null default 0,
  category          text,
  -- This supplier's share of its category, 0–100. Null means nobody has
  -- worked it out, which is different from zero.
  category_share    numeric(5,2),
  -- No qualified alternative exists today. The single most important field
  -- here, and the one procurement usually knows without being asked.
  is_single_source  boolean not null default false,
  -- Working days to qualify and switch. Null means unknown, and the engine
  -- says so rather than quietly assuming.
  switching_lead_time_days integer,
  currency          char(3) not null,
  source_ref        text,
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, party_id, legal_entity_code),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index supplier_commitment_party_idx on public.supplier_commitment (tenant_id, party_id);
create index supplier_commitment_single_source_idx
  on public.supplier_commitment (tenant_id) where is_single_source;

-- One row per supplier across every entity, which is the grain the ranking
-- works at: a supplier serving three BUs is one dependency, not three.
create view public.v_supplier_dependency as
select
  c.tenant_id,
  c.party_id,
  p.legal_name,
  p.tax_id,
  count(distinct c.legal_entity_code)  as entity_count,
  sum(c.open_commitment)               as open_commitment,
  sum(c.annual_spend)                  as annual_spend,
  -- Spend-weighted, so a large BU's view of the category is not outvoted by a
  -- small one's. Null when no entity has stated a share.
  case when sum(c.annual_spend) > 0 and count(c.category_share) > 0
       then round(sum(coalesce(c.category_share, 0) * c.annual_spend) / sum(c.annual_spend), 2)
       else null end                   as category_share,
  bool_or(c.is_single_source)          as is_single_source,
  max(c.switching_lead_time_days)      as switching_lead_time_days,
  min(c.category)                      as category,
  max(c.currency)                      as currency,
  max(c.updated_at)                    as updated_at
from public.supplier_commitment c
join public.party p on p.id = c.party_id
where p.status <> 'merged'
group by c.tenant_id, c.party_id, p.legal_name, p.tax_id;

alter view public.v_supplier_dependency set (security_invoker = on);

alter table public.supplier_commitment enable row level security;

create policy supplier_commitment_read on public.supplier_commitment
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

-- ============================================================
-- migrations/20260903001300_collateral_allocation_key.sql
-- ============================================================

-- CreditMesh — 0013 A natural key for collateral allocations.
--
-- 0004 created collateral_allocation with a surrogate id and nothing else, so
-- re-importing an allocation register produced a second row for the same
-- allocation and quietly doubled what an instrument appeared to cover. §5.2
-- requires ingestion to be idempotent, and this is the table where a duplicate
-- does the most damage: over-allocation is the finding the module exists to
-- surface, and duplicates manufacture it.
--
-- An entity can hold more than one allocation against the same instrument over
-- time, so the key includes the start date. Two allocations starting on the
-- same day for the same entity against the same instrument are the same
-- allocation.

delete from public.collateral_allocation a
using public.collateral_allocation b
where a.ctid > b.ctid
  and a.tenant_id = b.tenant_id
  and a.collateral_id = b.collateral_id
  and a.legal_entity_code = b.legal_entity_code
  and a.valid_from = b.valid_from;

create unique index collateral_allocation_natural_key
  on public.collateral_allocation (tenant_id, collateral_id, legal_entity_code, valid_from);

-- ============================================================
-- migrations/20260903001400_order_block.sql
-- ============================================================

-- CreditMesh — 0014 Held sales orders (Module 11).
--
-- The source system blocks the order; we never do, and in this phase we never
-- release one either (P5). What lives here is the block as the ERP reported it
-- plus the decision a human recorded about it, so that the release which
-- happens in SAP an hour later has a written reason attached to it here.
--
-- `block_code` and `block_reason` are the source's own words, stored verbatim.
-- The engine's diagnosis is computed at read time and deliberately not stored:
-- it is a function of today's exposure, limits and collateral, and a cached
-- copy would quietly go stale and be believed.

create table public.sales_order_block (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  order_ref         text not null,
  order_date        date,
  order_amount      numeric(20,2) not null,
  currency          char(3) not null,
  -- The source system's classification, kept as given. We do not map it onto
  -- our own cause codes: their taxonomy is theirs and changes without notice.
  block_code        text,
  block_reason      text,
  blocked_at        timestamptz not null,
  status            text not null default 'blocked'
                    check (status in ('blocked', 'released', 'cancelled')),
  released_at       timestamptz,
  source_ref        text,
  updated_at        timestamptz not null default now(),
  unique (tenant_id, legal_entity_code, order_ref),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index sales_order_block_open_idx
  on public.sales_order_block (tenant_id, blocked_at desc) where status = 'blocked';
create index sales_order_block_party_idx on public.sales_order_block (tenant_id, party_id);

-- A decision is a record of what a person concluded and why, not an
-- instruction to any other system. `outcome` deliberately has no
-- "release" value: nobody releases anything from here, they recommend it and
-- then act in the ERP. Calling the button Release would make the audit trail
-- claim an action the platform never performed.
create table public.order_block_decision (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  block_id      uuid not null references public.sales_order_block(id) on delete cascade,
  outcome       text not null
                check (outcome in ('recommend_release', 'hold', 'partial', 'escalate', 'reject')),
  reason        text not null,
  -- The diagnosis as it stood when the decision was made. This one IS stored,
  -- because the point of an audit trail is what was known at the time (P6).
  evidence      jsonb not null default '{}'::jsonb,
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz not null default now()
);

create index order_block_decision_block_idx
  on public.order_block_decision (tenant_id, block_id, decided_at desc);

-- Open blocks with the context the cockpit needs, in one round trip. The
-- diagnosis itself is computed in the engine, not here — SQL is a poor place
-- to keep a rule an auditor has to read.
create view public.v_order_block_open as
select
  b.id                          as block_id,
  b.tenant_id,
  b.party_id,
  p.legal_name,
  p.tax_id,
  b.legal_entity_code,
  b.order_ref,
  b.order_date,
  b.order_amount,
  b.currency,
  b.block_code,
  b.block_reason,
  b.blocked_at,
  e.ar_open,
  e.ar_overdue,
  e.total_exposure,
  e.credit_limit,
  r.score,
  r.grade,
  d.outcome                     as last_outcome,
  d.decided_at                  as last_decided_at
from public.sales_order_block b
join public.party p on p.id = b.party_id
left join public.v_exposure_current e
  on e.tenant_id = b.tenant_id and e.party_id = b.party_id and e.legal_entity_code = b.legal_entity_code
left join public.v_risk_current r
  on r.tenant_id = b.tenant_id and r.party_id = b.party_id
left join lateral (
  select outcome, decided_at
  from public.order_block_decision x
  where x.block_id = b.id
  order by x.decided_at desc
  limit 1
) d on true
where b.status = 'blocked';

alter view public.v_order_block_open set (security_invoker = on);

alter table public.sales_order_block enable row level security;
alter table public.order_block_decision enable row level security;

create policy sales_order_block_read on public.sales_order_block
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy order_block_decision_read on public.order_block_decision
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- ============================================================
-- migrations/20260903001500_legal_screening.sql
-- ============================================================

-- CreditMesh — 0015 Legal & insolvency screening (Module 16).
--
-- Two constraints in this table are not style preferences.
--
-- `case_no` is NOT NULL. §4.15 requires a case or reference number from the
-- source, because a screening record with no case number cannot be checked by
-- anyone and cannot be withdrawn cleanly when it turns out to be someone else.
--
-- `party_id` is nullable and `match_basis` is stored beside it. A result links
-- to a counterparty only when an identifier agreed; a name match, however
-- close, arrives here unlinked with the near-matches recorded for a reviewer.
-- Every consumer can therefore tell a verified link from a suggested one, which
-- is the difference between a useful alert and a defamation claim.
--
-- For natural persons only a masked identifier is ever stored — `last4` or a
-- non-reversible handle, per the tenant's `person_id_storage`. The full number
-- has no place in this system.

create table public.legal_event (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  -- Null until an identifier match or a human confirmation attaches it.
  party_id       uuid references public.party(id) on delete cascade,
  subject_type   text not null check (subject_type in ('party', 'person')),
  subject_name   text not null,
  -- Masked. Never the whole identifier, for a person or a company.
  subject_id_masked text,
  event_type     text not null,
  severity       text not null check (severity in ('critical', 'high', 'medium', 'low')),
  case_no        text not null,
  source         text not null,
  court          text,
  event_date     date,
  published_date date,
  detail         text,
  match_basis    text not null default 'unmatched'
                 check (match_basis in ('tax_id', 'registration_no', 'name_only', 'unmatched')),
  match_note     text,
  -- The near-matches the engine found, so a reviewer starts somewhere.
  candidates     jsonb not null default '[]'::jsonb,
  review_status  text not null default 'pending'
                 check (review_status in ('pending', 'confirmed', 'rejected')),
  reviewed_by    uuid references auth.users(id),
  reviewed_at    timestamptz,
  review_note    text,
  retrieved_at   timestamptz not null default now(),
  -- The same case reported twice about the same subject is one event.
  unique (tenant_id, source, case_no, event_type, subject_name)
);

create index legal_event_party_idx on public.legal_event (tenant_id, party_id)
  where review_status = 'confirmed';
create index legal_event_review_idx on public.legal_event (tenant_id, retrieved_at desc)
  where review_status = 'pending';

-- When each counterparty was last screened, whatever the result. A screening
-- that found nothing is still a screening, so this is not derivable from
-- legal_event alone — an empty result set has to be recorded somewhere.
create table public.legal_screening_run (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  party_id     uuid not null references public.party(id) on delete cascade,
  source       text not null,
  screened_at  timestamptz not null default now(),
  results_found integer not null default 0,
  unique (tenant_id, party_id, source, screened_at)
);

create index legal_screening_run_party_idx
  on public.legal_screening_run (tenant_id, party_id, screened_at desc);

-- Confirmed events per counterparty, with the worst severity carried up. Only
-- confirmed rows: a pending review is a question, not a fact about a company.
create view public.v_party_legal_status as
select
  e.tenant_id,
  e.party_id,
  count(*)                                as event_count,
  min(case e.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end)
                                          as worst_severity_rank,
  max(e.event_date)                       as latest_event_date,
  array_agg(distinct e.event_type)        as event_types,
  max(r.screened_at)                      as last_screened_at
from public.legal_event e
left join public.legal_screening_run r
  on r.tenant_id = e.tenant_id and r.party_id = e.party_id
where e.review_status = 'confirmed' and e.party_id is not null
group by e.tenant_id, e.party_id;

alter view public.v_party_legal_status set (security_invoker = on);

alter table public.legal_event enable row level security;
alter table public.legal_screening_run enable row level security;

-- Screening results are tenant-wide rather than entity-scoped: a bankruptcy is
-- not a fact about one BU's relationship, and hiding it from the entity that
-- has not yet imported that customer is how the signal fails to cross BUs —
-- the exact problem §1 opens with.
create policy legal_event_read on public.legal_event
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy legal_screening_run_read on public.legal_screening_run
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- ============================================================
-- migrations/20260903001600_payments.sql
-- ============================================================

-- CreditMesh — 0016 Incoming payments and exceptions (Modules 13 and 15).
--
-- P8 in table form: these tables record the *status* of money that has already
-- moved. Nothing here receives, transfers, clears or posts anything back. There
-- is no balance to reconcile, no ledger to keep in step with the bank.
--
-- `party_id` is nullable on incoming_payment on purpose. Money arrives that
-- nobody can attribute yet — §4.14 calls it an unidentified receipt and gives
-- it its own SLA, because it is the case that goes stale silently. Forcing a
-- counterparty here would push somebody to guess one.
--
-- And there is no returned_cheque table. Reversals, failed transfers,
-- unidentified receipts and overpayments arrive right behind it, and a table
-- per event type is the same mistake as a table per collateral instrument.
-- One payment_exception table, one `type` column.

create table public.incoming_payment (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  -- Null while the receipt cannot be attributed to anyone.
  party_id          uuid references public.party(id) on delete set null,
  legal_entity_code text not null,
  receipt_ref       text not null,
  payment_date      date not null,
  value_date        date,
  amount            numeric(20,2) not null,
  currency          char(3) not null,
  channel           text not null default 'bank_transfer',
  -- The invoice the source system already applied this to, when it did. What
  -- the adapter can give here is exactly what payment_grain declares.
  source_document_no text,
  -- The name on the bank line, which is very often not our legal name for them.
  payer_name        text,
  reference         text,
  cheque_no         text,
  cheque_due_date   date,
  status            text not null default 'open'
                    check (status in ('open', 'matched', 'partial', 'unidentified', 'reversed')),
  source_ref        text,
  imported_at       timestamptz not null default now(),
  unique (tenant_id, legal_entity_code, receipt_ref),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index incoming_payment_party_idx on public.incoming_payment (tenant_id, party_id, payment_date desc);
create index incoming_payment_open_idx on public.incoming_payment (tenant_id, payment_date desc)
  where status in ('open', 'unidentified');

-- One receipt can settle several invoices and one invoice can take several
-- receipts, so this is its own table rather than a column on either side.
create table public.payment_application (
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  payment_id     uuid not null references public.incoming_payment(id) on delete cascade,
  ar_item_id     uuid not null references public.ar_item(id) on delete cascade,
  applied_amount numeric(20,2) not null,
  -- How this link was made. 'source' means the ERP decided and we read it;
  -- everything else is ours, and 'manual' is a person's. A later reader must be
  -- able to tell a read fact from a derived guess.
  match_rule     text not null
                 check (match_rule in ('source', 'invoice_no', 'amount_and_date',
                                       'party_and_amount', 'party_and_reference', 'manual')),
  confidence     numeric(4,3) not null default 1,
  matched_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  primary key (tenant_id, payment_id, ar_item_id)
);

create index payment_application_item_idx on public.payment_application (tenant_id, ar_item_id);

create table public.payment_exception (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid references public.party(id) on delete set null,
  legal_entity_code text not null,
  payment_id        uuid references public.incoming_payment(id) on delete set null,
  type              text not null
                    check (type in ('returned_cheque', 'reversal', 'mismatch', 'missing',
                                    'failed_transfer', 'overpayment', 'unidentified_receipt')),
  amount            numeric(20,2) not null default 0,
  currency          char(3) not null,
  occurred_at       date not null,
  reason_code       text,
  reason_text       text,
  -- NOT NULL because it is part of the natural key. A null here would make
  -- every re-import insert a duplicate instead of updating: nulls never
  -- conflict in a unique index, so the upsert would silently stop being one.
  reference         text not null,
  -- bank | erp | manual_entry. manual_entry is supported from day one: in most
  -- organisations a returned cheque is known first from a phone call.
  source            text not null default 'manual_entry',
  status            text not null default 'open'
                    check (status in ('open', 'resolved', 'written_off')),
  resolved_at       timestamptz,
  resolved_by       uuid references auth.users(id),
  resolution_note   text,
  created_at        timestamptz not null default now(),
  unique (tenant_id, type, reference, occurred_at, legal_entity_code),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index payment_exception_open_idx
  on public.payment_exception (tenant_id, occurred_at desc) where status = 'open';
create index payment_exception_party_idx on public.payment_exception (tenant_id, party_id);

-- Signals raised from exceptions, stored so the path from a bounced cheque to a
-- credit decision is auditable rather than recomputed and forgotten (P7).
-- `targets` is an array because one event legitimately goes to several places.
create table public.credit_signal (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  party_id     uuid not null references public.party(id) on delete cascade,
  code         text not null,
  severity     text not null check (severity in ('critical', 'high', 'medium')),
  targets      text[] not null default '{}',
  reason       text not null,
  evidence     jsonb not null default '{}'::jsonb,
  raised_at    date not null,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  unique (tenant_id, party_id, code, raised_at)
);

create index credit_signal_open_idx on public.credit_signal (tenant_id, raised_at desc)
  where acknowledged_at is null;

-- Receipt with how much of it has been applied. The unapplied remainder is the
-- number the finance team chases, and computing it in one place stops two
-- screens disagreeing about it.
create view public.v_payment_status as
select
  p.id                                        as payment_id,
  p.tenant_id,
  p.party_id,
  p.legal_entity_code,
  p.receipt_ref,
  p.payment_date,
  p.amount,
  p.currency,
  p.channel,
  p.payer_name,
  p.source_document_no,
  p.status,
  coalesce(sum(a.applied_amount), 0)          as applied_amount,
  p.amount - coalesce(sum(a.applied_amount), 0) as unapplied_amount,
  count(a.ar_item_id)                         as application_count,
  min(a.confidence)                           as lowest_confidence
from public.incoming_payment p
left join public.payment_application a on a.payment_id = p.id
group by p.id;

alter view public.v_payment_status set (security_invoker = on);

alter table public.incoming_payment enable row level security;
alter table public.payment_application enable row level security;
alter table public.payment_exception enable row level security;
alter table public.credit_signal enable row level security;

create policy incoming_payment_read on public.incoming_payment
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy payment_application_read on public.payment_application
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy payment_exception_read on public.payment_exception
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

-- Signals are tenant-wide, like legal events: a bounced cheque in one BU is a
-- fact about the counterparty, and hiding it from the BU that has not yet met
-- them is precisely the cross-BU blindness §1 opens with.
create policy credit_signal_read on public.credit_signal
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- ============================================================
-- migrations/20260903001700_collection_and_charges.sql
-- ============================================================

-- CreditMesh — 0017 Collection workbench and late payment charges (Modules 12, 14).
--
-- collection_case is keyed party × legal_entity, NOT per invoice. A collector
-- makes one call about eleven invoices; per-invoice cases scatter that one
-- conversation across eleven contact histories until none of them is readable,
-- and the history is the part of this module people come to depend on.
--
-- late_charge_item stores every input to the calculation, not just the amount.
-- Late-charge arguments are never about the total — they are about which rate,
-- from which date, over how many days, on what principal. An amount with no
-- inputs cannot be defended in the meeting where it is questioned, and §7 makes
-- reconciling three months of recomputed charges a delivery gate.

/* Module 12 ------------------------------------------------------------- */

create table public.collection_case (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  owner_user_id     uuid references auth.users(id),
  stage             text,
  status            text not null default 'open' check (status in ('open', 'on_hold', 'closed')),
  -- A collector's own position in the queue. §7's advice on adoption in one
  -- column: let them reorder, keep what they did, and use it to fix the weights.
  manual_rank       integer,
  opened_at         timestamptz not null default now(),
  last_contact_at   timestamptz,
  next_action_at    date,
  closed_at         timestamptz,
  unique (tenant_id, party_id, legal_entity_code),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index collection_case_owner_idx
  on public.collection_case (tenant_id, owner_user_id) where status = 'open';

create table public.collection_activity (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  case_id        uuid not null references public.collection_case(id) on delete cascade,
  type           text not null
                 check (type in ('call', 'email', 'letter', 'visit', 'note', 'stage_change', 'reorder')),
  outcome        text,
  note           text,
  contact_person text,
  occurred_at    timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);

create index collection_activity_case_idx
  on public.collection_activity (tenant_id, case_id, occurred_at desc);

create table public.promise_to_pay (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  case_id       uuid not null references public.collection_case(id) on delete cascade,
  party_id      uuid not null references public.party(id) on delete cascade,
  amount        numeric(20,2) not null,
  currency      char(3) not null,
  promised_date date not null,
  -- 'cancelled' is separate from 'broken' on purpose: a promise withdrawn by
  -- agreement says nothing about whether this customer keeps their word, and
  -- folding it into broken makes the kept-rate quietly wrong.
  status        text not null default 'open'
                check (status in ('open', 'kept', 'broken', 'cancelled')),
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);

create index promise_to_pay_due_idx
  on public.promise_to_pay (tenant_id, promised_date) where status = 'open';

create table public.collection_dispute (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  case_id      uuid not null references public.collection_case(id) on delete cascade,
  ar_item_id   uuid references public.ar_item(id) on delete set null,
  reason_code  text not null,
  amount       numeric(20,2) not null default 0,
  -- 'accepted' means the organisation agrees the customer has a point, and it
  -- is what takes the case out of the chase queue.
  status       text not null default 'open'
               check (status in ('open', 'accepted', 'rejected', 'resolved')),
  owner_user_id uuid references auth.users(id),
  note         text,
  raised_at    timestamptz not null default now(),
  settled_at   timestamptz
);

create index collection_dispute_case_idx on public.collection_dispute (tenant_id, case_id);

/* Module 14 ------------------------------------------------------------- */

create table public.late_charge_run (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  as_of       date not null,
  -- The profile version the run used. Without it a recomputed number cannot be
  -- reconciled against the one that was billed (P6).
  profile_version integer,
  policy_snapshot jsonb not null default '{}'::jsonb,
  item_count  integer not null default 0,
  total_amount numeric(20,2) not null default 0,
  status      text not null default 'draft' check (status in ('draft', 'approved', 'issued')),
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index late_charge_run_idx on public.late_charge_run (tenant_id, as_of desc);

create table public.late_charge_item (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  run_id            uuid not null references public.late_charge_run(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  ar_item_id        uuid references public.ar_item(id) on delete set null,
  document_no       text not null,
  -- Every input, stored. Not a convenience: it is the whole defence of the
  -- number when a customer disputes it six weeks later.
  principal         numeric(20,2) not null,
  annual_rate_pct   numeric(8,4) not null,
  rate_effective_from date not null,
  day_count         integer not null,
  charge_from       date not null,
  charge_to         date not null,
  late_days         integer not null,
  grace_days        integer not null,
  raw_amount        numeric(20,2) not null,
  charge_amount     numeric(20,2) not null,
  currency          char(3) not null,
  status            text not null default 'proposed'
                    check (status in ('proposed', 'approved', 'waived', 'issued')),
  waiver_reason     text,
  waived_by         uuid references auth.users(id),
  waived_at         timestamptz,
  created_at        timestamptz not null default now(),
  unique (tenant_id, run_id, document_no)
);

create index late_charge_item_party_idx on public.late_charge_item (tenant_id, party_id);
create index late_charge_item_waived_idx
  on public.late_charge_item (tenant_id, waived_at desc) where status = 'waived';

-- The report the module is bought for: what was given away, to whom, by whom.
-- Almost no organisation can produce this today.
create view public.v_late_charge_waivers as
select
  i.tenant_id,
  i.party_id,
  p.legal_name,
  i.waived_by,
  count(*)                as waiver_count,
  sum(i.charge_amount)    as waived_amount,
  max(i.waived_at)        as latest_waiver
from public.late_charge_item i
join public.party p on p.id = i.party_id
where i.status = 'waived'
group by i.tenant_id, i.party_id, p.legal_name, i.waived_by;

alter view public.v_late_charge_waivers set (security_invoker = on);

-- One row per open case with the numbers the queue needs, already net of what
-- Module 13 applied. "Already net" is the whole reason 13 ships before 12.
create view public.v_collection_case_context as
select
  c.id                                   as case_id,
  c.tenant_id,
  c.party_id,
  p.legal_name,
  c.legal_entity_code,
  c.owner_user_id,
  c.stage,
  c.status,
  c.manual_rank,
  c.last_contact_at,
  c.next_action_at,
  coalesce(sum(a.amount_base) filter (where a.cleared_date is null), 0)          as open_amount,
  coalesce(sum(a.amount_base) filter (where a.cleared_date is null
                                        and a.due_date < current_date), 0)       as overdue_amount,
  coalesce(max(current_date - a.due_date) filter (where a.cleared_date is null), 0) as max_dpd,
  r.score,
  r.grade,
  exists (select 1 from public.collection_dispute d
           where d.case_id = c.id and d.status = 'accepted')                     as has_accepted_dispute,
  (select count(*) from public.promise_to_pay t
    where t.case_id = c.id and t.status = 'broken')                              as broken_promise_count
from public.collection_case c
join public.party p on p.id = c.party_id
left join public.ar_item a
  on a.tenant_id = c.tenant_id and a.party_id = c.party_id and a.legal_entity_code = c.legal_entity_code
left join public.v_risk_current r on r.tenant_id = c.tenant_id and r.party_id = c.party_id
where c.status <> 'closed'
group by c.id, c.tenant_id, c.party_id, p.legal_name, c.legal_entity_code, c.owner_user_id,
         c.stage, c.status, c.manual_rank, c.last_contact_at, c.next_action_at, r.score, r.grade;

alter view public.v_collection_case_context set (security_invoker = on);

alter table public.collection_case enable row level security;
alter table public.collection_activity enable row level security;
alter table public.promise_to_pay enable row level security;
alter table public.collection_dispute enable row level security;
alter table public.late_charge_run enable row level security;
alter table public.late_charge_item enable row level security;

create policy collection_case_read on public.collection_case
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy collection_activity_read on public.collection_activity
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy promise_to_pay_read on public.promise_to_pay
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy collection_dispute_read on public.collection_dispute
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy late_charge_run_read on public.late_charge_run
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy late_charge_item_read on public.late_charge_item
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

-- ============================================================
-- migrations/20260903001800_watchlist_and_index.sql
-- ============================================================

-- CreditMesh — 0018 Watchlist and risk index (Modules 5 and 17).
--
-- party_registry_profile holds one current row per counterparty, which is what
-- group resolution needs and what change detection cannot work from. The
-- trigger below keeps the row that is about to be overwritten, so "what changed
-- since last time" has something to compare against. Doing it in a trigger
-- rather than in the importer means it holds however the row was written.
--
-- risk_index stores availability separately from value. A score of 62 built
-- from three components is not the same object as a score of 62 built from
-- nine, and a schema that cannot tell them apart guarantees somebody will one
-- day treat them as equal.

create table public.party_registry_snapshot (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant(id) on delete cascade,
  party_id           uuid not null references public.party(id) on delete cascade,
  legal_status       text,
  registered_capital numeric(20,2),
  registered_address text,
  industry_code      text,
  director_names     text[] not null default '{}',
  provider_id        text,
  captured_at        timestamptz not null default now()
);

create index party_registry_snapshot_idx
  on public.party_registry_snapshot (tenant_id, party_id, captured_at desc);

create or replace function public.capture_registry_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.party_registry_snapshot (
    tenant_id, party_id, legal_status, registered_capital, registered_address,
    industry_code, director_names, provider_id, captured_at
  )
  select
    old.tenant_id, old.party_id, old.legal_status, old.registered_capital,
    old.registered_address, old.industry_code,
    coalesce(
      (select array_agg(pe.full_name order by pe.full_name)
         from public.person_party_role r
         join public.person pe on pe.id = r.person_id
        where r.tenant_id = old.tenant_id and r.party_id = old.party_id and r.role = 'director'),
      '{}'),
    old.provider_id, old.retrieved_at;
  return new;
end;
$$;

create trigger party_registry_profile_snapshot
  before update on public.party_registry_profile
  for each row execute function public.capture_registry_snapshot();

create table public.watchlist_entry (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  party_id    uuid not null references public.party(id) on delete cascade,
  reason      text not null,
  severity    text not null default 'medium'
              check (severity in ('critical', 'high', 'medium', 'low')),
  -- 'signal' entries were added by an engine; 'manual' by a person. Keeping
  -- them apart matters when someone asks why a customer is on the list.
  source      text not null default 'manual' check (source in ('manual', 'signal')),
  added_by    uuid references auth.users(id),
  added_at    timestamptz not null default now(),
  removed_by  uuid references auth.users(id),
  removed_at  timestamptz,
  note        text
);

-- One live entry per counterparty; history is kept by leaving removed rows.
create unique index watchlist_entry_live_key
  on public.watchlist_entry (tenant_id, party_id) where removed_at is null;

-- Detected changes, stored so a weekly digest can be rebuilt and so an alert
-- that fired can be shown to have fired.
create table public.watchlist_change (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  party_id    uuid not null references public.party(id) on delete cascade,
  code        text not null,
  severity    text not null check (severity in ('critical', 'high', 'medium', 'low')),
  -- False means digest material: a real change nobody has to act on today.
  -- §7 is explicit that alert volume, not accuracy, is what kills this module.
  actionable  boolean not null default false,
  before_value text,
  after_value  text,
  detail      text not null,
  observed_at date not null,
  notified_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  unique (tenant_id, party_id, code, observed_at)
);

create index watchlist_change_open_idx
  on public.watchlist_change (tenant_id, observed_at desc) where acknowledged_at is null;

create table public.risk_index (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  party_id        uuid not null references public.party(id) on delete cascade,
  as_of           date not null,
  -- Null when a block_score component was missing. blocked_by says which.
  score           numeric(6,2),
  grade           text,
  blocked_by      text,
  -- Availability is stored beside the value, never folded into it.
  components_scored  integer not null default 0,
  components_enabled integer not null default 0,
  incomplete      boolean not null default false,
  recommended_action text,
  profile_version integer,
  computed_at     timestamptz not null default now(),
  unique (tenant_id, party_id, as_of)
);

create index risk_index_current_idx on public.risk_index (tenant_id, party_id, as_of desc);

create table public.risk_index_component (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  risk_index_id   uuid not null references public.risk_index(id) on delete cascade,
  code            text not null,
  weight          numeric(6,4) not null,
  effective_weight numeric(6,4) not null,
  value           numeric(6,2),
  available       boolean not null,
  absence_rule    text not null,
  contribution    numeric(8,3) not null,
  note            text,
  evidence        jsonb not null default '[]'::jsonb,
  unique (tenant_id, risk_index_id, code)
);

create view public.v_risk_index_current as
select distinct on (i.tenant_id, i.party_id)
  i.id,
  i.tenant_id,
  i.party_id,
  i.as_of,
  i.score,
  i.grade,
  i.blocked_by,
  i.components_scored,
  i.components_enabled,
  i.incomplete,
  i.recommended_action,
  i.profile_version
from public.risk_index i
order by i.tenant_id, i.party_id, i.as_of desc;

alter view public.v_risk_index_current set (security_invoker = on);

alter table public.party_registry_snapshot enable row level security;
alter table public.watchlist_entry enable row level security;
alter table public.watchlist_change enable row level security;
alter table public.risk_index enable row level security;
alter table public.risk_index_component enable row level security;

create policy party_registry_snapshot_read on public.party_registry_snapshot
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy watchlist_entry_read on public.watchlist_entry
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy watchlist_change_read on public.watchlist_change
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy risk_index_read on public.risk_index
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy risk_index_component_read on public.risk_index_component
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- ============================================================
-- migrations/20260903001900_credit_memo.sql
-- ============================================================

-- CreditMesh — 0019 Credit memo drafts (Module 4).
--
-- The memo stores the assembled sections AND the analyst's own sections
-- separately. Keeping them apart is the whole point of the module's
-- positioning: §7 requires it to be understood as drafting 80% with the
-- analyst's judgement supplying the rest, and a schema that merged the two
-- would make it impossible to tell later which sentences the platform wrote.
--
-- A memo also stores the as-of numbers it was built from rather than
-- re-deriving them on open. A credit committee reads a memo weeks after it was
-- written, and it must show what was known then, not what is true now.

create table public.credit_memo (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  party_id        uuid not null references public.party(id) on delete cascade,
  as_of           date not null,
  -- What the platform assembled, with each figure's source.
  sections        jsonb not null default '[]'::jsonb,
  -- What the analyst wrote. Empty until a person fills it in.
  analyst_sections jsonb not null default '[]'::jsonb,
  gaps            jsonb not null default '[]'::jsonb,
  completeness_pct numeric(5,2) not null default 0,
  status          text not null default 'draft'
                  check (status in ('draft', 'reviewed', 'submitted', 'archived')),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  reviewed_by     uuid references auth.users(id),
  reviewed_at     timestamptz,
  profile_version integer
);

create index credit_memo_party_idx on public.credit_memo (tenant_id, party_id, created_at desc);
create index credit_memo_open_idx on public.credit_memo (tenant_id, created_at desc) where status = 'draft';

alter table public.credit_memo enable row level security;

create policy credit_memo_read on public.credit_memo
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- ============================================================
-- migrations/20260903002000_provision_and_findings.sql
-- ============================================================

-- CreditMesh — 0020 Provision runs and related-party findings (Modules 10, 8).
--
-- provision_run keeps the loss matrix it used, not a pointer to today's. The
-- output of this module goes into a financial statement somebody signs, and an
-- auditor asking "what rates produced this figure" six months later must get
-- the rates that produced it, not the rates in force when they asked.
--
-- related_party_finding rows concern named individuals. There is no field for
-- a conclusion, only for evidence and for a reviewer's disposition, because a
-- verdict column gets filled in. Read access is restricted to the audit and
-- admin roles rather than to everyone in the tenant.

create table public.provision_run (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  as_of         date not null,
  -- The rates used, kept with the run. Never re-derived on open.
  loss_matrix   jsonb not null default '[]'::jsonb,
  options       jsonb not null default '{}'::jsonb,
  gross_exposure   numeric(20,2) not null default 0,
  proposed_provision numeric(20,2) not null default 0,
  -- Balance in buckets with no derivable loss rate. The first number an
  -- auditor asks about, so it is a column rather than something derived later.
  unrated_exposure numeric(20,2) not null default 0,
  status        text not null default 'draft' check (status in ('draft', 'reviewed', 'archived')),
  profile_version integer,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (tenant_id, as_of, created_at)
);

create index provision_run_idx on public.provision_run (tenant_id, as_of desc);

create table public.provision_item (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  run_id            uuid not null references public.provision_run(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  currency          char(3) not null,
  gross_exposure    numeric(20,2) not null,
  secured_amount    numeric(20,2) not null default 0,
  exposure_at_default numeric(20,2) not null,
  base_provision    numeric(20,2) not null default 0,
  forward_looking_pct numeric(6,2) not null default 0,
  specific_provision numeric(20,2),
  proposed_provision numeric(20,2) not null default 0,
  unrated_exposure  numeric(20,2) not null default 0,
  -- Per-bucket amounts and the rate applied to each, so any single figure can
  -- be taken apart without rerunning anything.
  bucket_detail     jsonb not null default '[]'::jsonb,
  notes             jsonb not null default '[]'::jsonb,
  unique (tenant_id, run_id, party_id, legal_entity_code)
);

create index provision_item_party_idx on public.provision_item (tenant_id, party_id);

create table public.related_party_finding (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  code          text not null,
  party_ids     uuid[] not null default '{}',
  party_names   text[] not null default '{}',
  person_names  text[] not null default '{}',
  -- Strength of the link. Never a probability of wrongdoing, and there is no
  -- column that could be read as one.
  link_strength numeric(4,3) not null,
  evidence      jsonb not null default '[]'::jsonb,
  summary       text not null,
  observed_at   date not null,
  -- What a reviewer did with it. 'checked_no_issue' is a first-class outcome:
  -- most of these findings will be innocent, and a queue that cannot record
  -- that fills up with the same items every run.
  disposition   text not null default 'open'
                check (disposition in ('open', 'checked_no_issue', 'escalated', 'declared')),
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  review_note   text,
  unique (tenant_id, code, party_ids, observed_at)
);

create index related_party_finding_open_idx
  on public.related_party_finding (tenant_id, observed_at desc) where disposition = 'open';

alter table public.provision_run enable row level security;
alter table public.provision_item enable row level security;
alter table public.related_party_finding enable row level security;

create policy provision_run_read on public.provision_run
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy provision_item_read on public.provision_item
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

-- Deliberately narrower than every other policy in this schema. These rows
-- name individuals; §7 requires them to reach internal audit and nobody else.
create policy related_party_finding_read on public.related_party_finding
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('auditor', 'admin')
  );
