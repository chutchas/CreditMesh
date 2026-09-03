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
