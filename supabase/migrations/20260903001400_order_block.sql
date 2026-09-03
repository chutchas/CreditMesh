-- CreditMesh — 0014 Held sales orders (Module 11).
--
-- The source system blocks the order; we never do, and in this phase we never
-- release one either (P5). What lives here is the block as the ERP reported it
-- plus the decision a human recorded about it, so that the release which
-- happens in SAP an hour later has a written reason attached to it here.
--
-- `block_code` and `block_reason` are the source's own words, stored verbatim.
-- The engine's diagnosis is computed at read time and deliberately not stored:
-- it is a function of today's exposure, limits and collateral, and a cached
-- copy would quietly go stale and be believed.

create table public.sales_order_block (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  order_ref         text not null,
  order_date        date,
  order_amount      numeric(20,2) not null,
  currency          char(3) not null,
  -- The source system's classification, kept as given. We do not map it onto
  -- our own cause codes: their taxonomy is theirs and changes without notice.
  block_code        text,
  block_reason      text,
  blocked_at        timestamptz not null,
  status            text not null default 'blocked'
                    check (status in ('blocked', 'released', 'cancelled')),
  released_at       timestamptz,
  source_ref        text,
  updated_at        timestamptz not null default now(),
  unique (tenant_id, legal_entity_code, order_ref),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index sales_order_block_open_idx
  on public.sales_order_block (tenant_id, blocked_at desc) where status = 'blocked';
create index sales_order_block_party_idx on public.sales_order_block (tenant_id, party_id);

-- A decision is a record of what a person concluded and why, not an
-- instruction to any other system. `outcome` deliberately has no
-- "release" value: nobody releases anything from here, they recommend it and
-- then act in the ERP. Calling the button Release would make the audit trail
-- claim an action the platform never performed.
create table public.order_block_decision (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  block_id      uuid not null references public.sales_order_block(id) on delete cascade,
  outcome       text not null
                check (outcome in ('recommend_release', 'hold', 'partial', 'escalate', 'reject')),
  reason        text not null,
  -- The diagnosis as it stood when the decision was made. This one IS stored,
  -- because the point of an audit trail is what was known at the time (P6).
  evidence      jsonb not null default '{}'::jsonb,
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz not null default now()
);

create index order_block_decision_block_idx
  on public.order_block_decision (tenant_id, block_id, decided_at desc);

-- Open blocks with the context the cockpit needs, in one round trip. The
-- diagnosis itself is computed in the engine, not here — SQL is a poor place
-- to keep a rule an auditor has to read.
create view public.v_order_block_open as
select
  b.id                          as block_id,
  b.tenant_id,
  b.party_id,
  p.legal_name,
  p.tax_id,
  b.legal_entity_code,
  b.order_ref,
  b.order_date,
  b.order_amount,
  b.currency,
  b.block_code,
  b.block_reason,
  b.blocked_at,
  e.ar_open,
  e.ar_overdue,
  e.total_exposure,
  e.credit_limit,
  r.score,
  r.grade,
  d.outcome                     as last_outcome,
  d.decided_at                  as last_decided_at
from public.sales_order_block b
join public.party p on p.id = b.party_id
left join public.v_exposure_current e
  on e.tenant_id = b.tenant_id and e.party_id = b.party_id and e.legal_entity_code = b.legal_entity_code
left join public.v_risk_current r
  on r.tenant_id = b.tenant_id and r.party_id = b.party_id
left join lateral (
  select outcome, decided_at
  from public.order_block_decision x
  where x.block_id = b.id
  order by x.decided_at desc
  limit 1
) d on true
where b.status = 'blocked';

alter view public.v_order_block_open set (security_invoker = on);

alter table public.sales_order_block enable row level security;
alter table public.order_block_decision enable row level security;

create policy sales_order_block_read on public.sales_order_block
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy order_block_decision_read on public.order_block_decision
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
