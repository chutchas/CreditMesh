-- CreditMesh — 0015 Legal & insolvency screening (Module 16).
--
-- Two constraints in this table are not style preferences.
--
-- `case_no` is NOT NULL. §4.15 requires a case or reference number from the
-- source, because a screening record with no case number cannot be checked by
-- anyone and cannot be withdrawn cleanly when it turns out to be someone else.
--
-- `party_id` is nullable and `match_basis` is stored beside it. A result links
-- to a counterparty only when an identifier agreed; a name match, however
-- close, arrives here unlinked with the near-matches recorded for a reviewer.
-- Every consumer can therefore tell a verified link from a suggested one, which
-- is the difference between a useful alert and a defamation claim.
--
-- For natural persons only a masked identifier is ever stored — `last4` or a
-- non-reversible handle, per the tenant's `person_id_storage`. The full number
-- has no place in this system.

create table public.legal_event (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  -- Null until an identifier match or a human confirmation attaches it.
  party_id       uuid references public.party(id) on delete cascade,
  subject_type   text not null check (subject_type in ('party', 'person')),
  subject_name   text not null,
  -- Masked. Never the whole identifier, for a person or a company.
  subject_id_masked text,
  event_type     text not null,
  severity       text not null check (severity in ('critical', 'high', 'medium', 'low')),
  case_no        text not null,
  source         text not null,
  court          text,
  event_date     date,
  published_date date,
  detail         text,
  match_basis    text not null default 'unmatched'
                 check (match_basis in ('tax_id', 'registration_no', 'name_only', 'unmatched')),
  match_note     text,
  -- The near-matches the engine found, so a reviewer starts somewhere.
  candidates     jsonb not null default '[]'::jsonb,
  review_status  text not null default 'pending'
                 check (review_status in ('pending', 'confirmed', 'rejected')),
  reviewed_by    uuid references auth.users(id),
  reviewed_at    timestamptz,
  review_note    text,
  retrieved_at   timestamptz not null default now(),
  -- The same case reported twice about the same subject is one event.
  unique (tenant_id, source, case_no, event_type, subject_name)
);

create index legal_event_party_idx on public.legal_event (tenant_id, party_id)
  where review_status = 'confirmed';
create index legal_event_review_idx on public.legal_event (tenant_id, retrieved_at desc)
  where review_status = 'pending';

-- When each counterparty was last screened, whatever the result. A screening
-- that found nothing is still a screening, so this is not derivable from
-- legal_event alone — an empty result set has to be recorded somewhere.
create table public.legal_screening_run (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  party_id     uuid not null references public.party(id) on delete cascade,
  source       text not null,
  screened_at  timestamptz not null default now(),
  results_found integer not null default 0,
  unique (tenant_id, party_id, source, screened_at)
);

create index legal_screening_run_party_idx
  on public.legal_screening_run (tenant_id, party_id, screened_at desc);

-- Confirmed events per counterparty, with the worst severity carried up. Only
-- confirmed rows: a pending review is a question, not a fact about a company.
create view public.v_party_legal_status as
select
  e.tenant_id,
  e.party_id,
  count(*)                                as event_count,
  min(case e.severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end)
                                          as worst_severity_rank,
  max(e.event_date)                       as latest_event_date,
  array_agg(distinct e.event_type)        as event_types,
  max(r.screened_at)                      as last_screened_at
from public.legal_event e
left join public.legal_screening_run r
  on r.tenant_id = e.tenant_id and r.party_id = e.party_id
where e.review_status = 'confirmed' and e.party_id is not null
group by e.tenant_id, e.party_id;

alter view public.v_party_legal_status set (security_invoker = on);

alter table public.legal_event enable row level security;
alter table public.legal_screening_run enable row level security;

-- Screening results are tenant-wide rather than entity-scoped: a bankruptcy is
-- not a fact about one BU's relationship, and hiding it from the entity that
-- has not yet imported that customer is how the signal fails to cross BUs —
-- the exact problem §1 opens with.
create policy legal_event_read on public.legal_event
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy legal_screening_run_read on public.legal_screening_run
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
