-- CreditMesh — 0021 Allocation workflow (Module 3, phase two).
--
-- Phase one was the register, read only, deliberately changing nobody's
-- process. This is the part §7 warns is organisational rather than technical:
-- who has first claim on a guarantee, and who may move it.
--
-- Two things in this schema are the workflow rather than plumbing.
--
-- `allocation_approval` keys on (request, approver) so an entity giving up
-- cover has a row of its own that nobody else can satisfy. Central credit
-- cannot approve on that entity's behalf by approving twice.
--
-- `applied_at` is separate from `decided_at` because approving and applying
-- are different acts. Time passes between them, balances move, and the apply
-- step re-validates. A single "approved" flag would let a decision taken last
-- week execute against this week's numbers.

create table public.allocation_request (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  collateral_id     uuid not null references public.collateral(id) on delete cascade,
  -- Null means the instrument's unallocated remainder rather than another
  -- entity's holding. The two are different asks and need different approvals.
  from_entity_code  text,
  to_entity_code    text not null,
  amount            numeric(20,2) not null check (amount > 0),
  currency          char(3) not null,
  reason            text not null,
  status            text not null default 'pending'
                    check (status in ('draft', 'pending', 'approved', 'rejected', 'applied', 'withdrawn')),
  -- The balances the requester was looking at. An approver weeks later needs
  -- to see what was true when the ask was made, not only what is true now.
  requested_snapshot jsonb not null default '{}'::jsonb,
  requested_by      uuid references auth.users(id),
  requested_at      timestamptz not null default now(),
  applied_by        uuid references auth.users(id),
  applied_at        timestamptz,
  foreign key (tenant_id, to_entity_code) references public.legal_entity(tenant_id, code)
);

create index allocation_request_open_idx
  on public.allocation_request (tenant_id, requested_at desc) where status in ('pending', 'approved');
create index allocation_request_collateral_idx
  on public.allocation_request (tenant_id, collateral_id, requested_at desc);

create table public.allocation_approval (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  request_id    uuid not null references public.allocation_request(id) on delete cascade,
  -- A role code, or a legal entity code when the approver IS an entity.
  approver      text not null,
  approver_kind text not null check (approver_kind in ('role', 'entity')),
  decision      text not null check (decision in ('approved', 'rejected')),
  note          text,
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz not null default now(),
  -- One decision per approver per request. The entity losing cover cannot be
  -- spoken for by anybody else.
  unique (tenant_id, request_id, approver)
);

create index allocation_approval_request_idx on public.allocation_approval (tenant_id, request_id);

-- Open requests with the instrument and the outstanding balance beside them,
-- so the queue is one query rather than a fan-out per row.
create view public.v_allocation_request_open as
select
  r.id                    as request_id,
  r.tenant_id,
  r.collateral_id,
  c.reference,
  c.type                  as collateral_type,
  c.direction,
  c.status                as collateral_status,
  c.amount                as face_value,
  c.expiry_date,
  c.claim_deadline,
  p.legal_name            as party_name,
  c.party_id,
  r.from_entity_code,
  r.to_entity_code,
  r.amount,
  r.currency,
  r.reason,
  r.status,
  r.requested_snapshot,
  r.requested_by,
  r.requested_at,
  coalesce(
    (select array_agg(a.approver order by a.decided_at)
       from public.allocation_approval a
      where a.request_id = r.id and a.decision = 'approved'),
    '{}'
  )                       as approved_by,
  (select a.approver from public.allocation_approval a
    where a.request_id = r.id and a.decision = 'rejected' limit 1) as rejected_by
from public.allocation_request r
join public.collateral c on c.id = r.collateral_id
join public.party p on p.id = c.party_id
where r.status in ('pending', 'approved');

alter view public.v_allocation_request_open set (security_invoker = on);

alter table public.allocation_request enable row level security;
alter table public.allocation_approval enable row level security;

-- Readable by both entities involved, not just the one asking. An entity has
-- to be able to see a request for its own collateral before it is asked to
-- approve one, or the approval step is a surprise rather than a decision.
create policy allocation_request_read on public.allocation_request
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.has_entity_access(to_entity_code)
      or (from_entity_code is not null and public.has_entity_access(from_entity_code))
    )
  );

create policy allocation_approval_read on public.allocation_approval
  for select to authenticated using (tenant_id = public.current_tenant_id());
