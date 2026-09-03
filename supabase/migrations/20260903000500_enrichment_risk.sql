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
