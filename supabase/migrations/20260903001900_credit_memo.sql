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
