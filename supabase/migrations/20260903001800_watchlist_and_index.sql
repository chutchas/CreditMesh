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
