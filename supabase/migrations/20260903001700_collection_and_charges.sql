-- CreditMesh — 0017 Collection workbench and late payment charges (Modules 12, 14).
--
-- collection_case is keyed party × legal_entity, NOT per invoice. A collector
-- makes one call about eleven invoices; per-invoice cases scatter that one
-- conversation across eleven contact histories until none of them is readable,
-- and the history is the part of this module people come to depend on.
--
-- late_charge_item stores every input to the calculation, not just the amount.
-- Late-charge arguments are never about the total — they are about which rate,
-- from which date, over how many days, on what principal. An amount with no
-- inputs cannot be defended in the meeting where it is questioned, and §7 makes
-- reconciling three months of recomputed charges a delivery gate.

/* Module 12 ------------------------------------------------------------- */

create table public.collection_case (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  owner_user_id     uuid references auth.users(id),
  stage             text,
  status            text not null default 'open' check (status in ('open', 'on_hold', 'closed')),
  -- A collector's own position in the queue. §7's advice on adoption in one
  -- column: let them reorder, keep what they did, and use it to fix the weights.
  manual_rank       integer,
  opened_at         timestamptz not null default now(),
  last_contact_at   timestamptz,
  next_action_at    date,
  closed_at         timestamptz,
  unique (tenant_id, party_id, legal_entity_code),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index collection_case_owner_idx
  on public.collection_case (tenant_id, owner_user_id) where status = 'open';

create table public.collection_activity (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  case_id        uuid not null references public.collection_case(id) on delete cascade,
  type           text not null
                 check (type in ('call', 'email', 'letter', 'visit', 'note', 'stage_change', 'reorder')),
  outcome        text,
  note           text,
  contact_person text,
  occurred_at    timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);

create index collection_activity_case_idx
  on public.collection_activity (tenant_id, case_id, occurred_at desc);

create table public.promise_to_pay (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  case_id       uuid not null references public.collection_case(id) on delete cascade,
  party_id      uuid not null references public.party(id) on delete cascade,
  amount        numeric(20,2) not null,
  currency      char(3) not null,
  promised_date date not null,
  -- 'cancelled' is separate from 'broken' on purpose: a promise withdrawn by
  -- agreement says nothing about whether this customer keeps their word, and
  -- folding it into broken makes the kept-rate quietly wrong.
  status        text not null default 'open'
                check (status in ('open', 'kept', 'broken', 'cancelled')),
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);

create index promise_to_pay_due_idx
  on public.promise_to_pay (tenant_id, promised_date) where status = 'open';

create table public.collection_dispute (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  case_id      uuid not null references public.collection_case(id) on delete cascade,
  ar_item_id   uuid references public.ar_item(id) on delete set null,
  reason_code  text not null,
  amount       numeric(20,2) not null default 0,
  -- 'accepted' means the organisation agrees the customer has a point, and it
  -- is what takes the case out of the chase queue.
  status       text not null default 'open'
               check (status in ('open', 'accepted', 'rejected', 'resolved')),
  owner_user_id uuid references auth.users(id),
  note         text,
  raised_at    timestamptz not null default now(),
  settled_at   timestamptz
);

create index collection_dispute_case_idx on public.collection_dispute (tenant_id, case_id);

/* Module 14 ------------------------------------------------------------- */

create table public.late_charge_run (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  as_of       date not null,
  -- The profile version the run used. Without it a recomputed number cannot be
  -- reconciled against the one that was billed (P6).
  profile_version integer,
  policy_snapshot jsonb not null default '{}'::jsonb,
  item_count  integer not null default 0,
  total_amount numeric(20,2) not null default 0,
  status      text not null default 'draft' check (status in ('draft', 'approved', 'issued')),
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index late_charge_run_idx on public.late_charge_run (tenant_id, as_of desc);

create table public.late_charge_item (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  run_id            uuid not null references public.late_charge_run(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  ar_item_id        uuid references public.ar_item(id) on delete set null,
  document_no       text not null,
  -- Every input, stored. Not a convenience: it is the whole defence of the
  -- number when a customer disputes it six weeks later.
  principal         numeric(20,2) not null,
  annual_rate_pct   numeric(8,4) not null,
  rate_effective_from date not null,
  day_count         integer not null,
  charge_from       date not null,
  charge_to         date not null,
  late_days         integer not null,
  grace_days        integer not null,
  raw_amount        numeric(20,2) not null,
  charge_amount     numeric(20,2) not null,
  currency          char(3) not null,
  status            text not null default 'proposed'
                    check (status in ('proposed', 'approved', 'waived', 'issued')),
  waiver_reason     text,
  waived_by         uuid references auth.users(id),
  waived_at         timestamptz,
  created_at        timestamptz not null default now(),
  unique (tenant_id, run_id, document_no)
);

create index late_charge_item_party_idx on public.late_charge_item (tenant_id, party_id);
create index late_charge_item_waived_idx
  on public.late_charge_item (tenant_id, waived_at desc) where status = 'waived';

-- The report the module is bought for: what was given away, to whom, by whom.
-- Almost no organisation can produce this today.
create view public.v_late_charge_waivers as
select
  i.tenant_id,
  i.party_id,
  p.legal_name,
  i.waived_by,
  count(*)                as waiver_count,
  sum(i.charge_amount)    as waived_amount,
  max(i.waived_at)        as latest_waiver
from public.late_charge_item i
join public.party p on p.id = i.party_id
where i.status = 'waived'
group by i.tenant_id, i.party_id, p.legal_name, i.waived_by;

alter view public.v_late_charge_waivers set (security_invoker = on);

-- One row per open case with the numbers the queue needs, already net of what
-- Module 13 applied. "Already net" is the whole reason 13 ships before 12.
create view public.v_collection_case_context as
select
  c.id                                   as case_id,
  c.tenant_id,
  c.party_id,
  p.legal_name,
  c.legal_entity_code,
  c.owner_user_id,
  c.stage,
  c.status,
  c.manual_rank,
  c.last_contact_at,
  c.next_action_at,
  coalesce(sum(a.amount_base) filter (where a.cleared_date is null), 0)          as open_amount,
  coalesce(sum(a.amount_base) filter (where a.cleared_date is null
                                        and a.due_date < current_date), 0)       as overdue_amount,
  coalesce(max(current_date - a.due_date) filter (where a.cleared_date is null), 0) as max_dpd,
  r.score,
  r.grade,
  exists (select 1 from public.collection_dispute d
           where d.case_id = c.id and d.status = 'accepted')                     as has_accepted_dispute,
  (select count(*) from public.promise_to_pay t
    where t.case_id = c.id and t.status = 'broken')                              as broken_promise_count
from public.collection_case c
join public.party p on p.id = c.party_id
left join public.ar_item a
  on a.tenant_id = c.tenant_id and a.party_id = c.party_id and a.legal_entity_code = c.legal_entity_code
left join public.v_risk_current r on r.tenant_id = c.tenant_id and r.party_id = c.party_id
where c.status <> 'closed'
group by c.id, c.tenant_id, c.party_id, p.legal_name, c.legal_entity_code, c.owner_user_id,
         c.stage, c.status, c.manual_rank, c.last_contact_at, c.next_action_at, r.score, r.grade;

alter view public.v_collection_case_context set (security_invoker = on);

alter table public.collection_case enable row level security;
alter table public.collection_activity enable row level security;
alter table public.promise_to_pay enable row level security;
alter table public.collection_dispute enable row level security;
alter table public.late_charge_run enable row level security;
alter table public.late_charge_item enable row level security;

create policy collection_case_read on public.collection_case
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy collection_activity_read on public.collection_activity
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy promise_to_pay_read on public.promise_to_pay
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy collection_dispute_read on public.collection_dispute
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy late_charge_run_read on public.late_charge_run
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy late_charge_item_read on public.late_charge_item
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));
