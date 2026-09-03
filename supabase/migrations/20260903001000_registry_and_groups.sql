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
