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
