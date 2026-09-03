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
