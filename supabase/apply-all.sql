-- CreditMesh — all migrations concatenated, in order.
-- Generated from supabase/migrations/. Paste into the Supabase SQL editor if
-- you are not using the CLI. Running it twice will fail on the CREATE TYPE
-- statements — that is intentional, it is not an idempotent script.

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

