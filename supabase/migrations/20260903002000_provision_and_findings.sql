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
