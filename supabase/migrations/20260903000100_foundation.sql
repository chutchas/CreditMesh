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
