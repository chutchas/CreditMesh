-- CreditMesh — 0012 Supplier commitments (Module 9).
--
-- Module 9 reuses the Financial Analysis Engine unchanged; the only thing it
-- needs that the receivables side does not provide is the other half of the
-- question. A fragile supplier the organisation barely uses is not a problem —
-- what matters is what it costs when this one stops delivering.
--
-- Note there is no supplier table. The counterparty is a `party` with the
-- supplier role (P3); this table holds the commercial dependency, nothing else.

create table public.supplier_commitment (
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid not null references public.party(id) on delete cascade,
  legal_entity_code text not null,
  -- Ordered and not yet delivered: money already committed.
  open_commitment   numeric(20,2) not null default 0,
  annual_spend      numeric(20,2) not null default 0,
  category          text,
  -- This supplier's share of its category, 0–100. Null means nobody has
  -- worked it out, which is different from zero.
  category_share    numeric(5,2),
  -- No qualified alternative exists today. The single most important field
  -- here, and the one procurement usually knows without being asked.
  is_single_source  boolean not null default false,
  -- Working days to qualify and switch. Null means unknown, and the engine
  -- says so rather than quietly assuming.
  switching_lead_time_days integer,
  currency          char(3) not null,
  source_ref        text,
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, party_id, legal_entity_code),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index supplier_commitment_party_idx on public.supplier_commitment (tenant_id, party_id);
create index supplier_commitment_single_source_idx
  on public.supplier_commitment (tenant_id) where is_single_source;

-- One row per supplier across every entity, which is the grain the ranking
-- works at: a supplier serving three BUs is one dependency, not three.
create view public.v_supplier_dependency as
select
  c.tenant_id,
  c.party_id,
  p.legal_name,
  p.tax_id,
  count(distinct c.legal_entity_code)  as entity_count,
  sum(c.open_commitment)               as open_commitment,
  sum(c.annual_spend)                  as annual_spend,
  -- Spend-weighted, so a large BU's view of the category is not outvoted by a
  -- small one's. Null when no entity has stated a share.
  case when sum(c.annual_spend) > 0 and count(c.category_share) > 0
       then round(sum(coalesce(c.category_share, 0) * c.annual_spend) / sum(c.annual_spend), 2)
       else null end                   as category_share,
  bool_or(c.is_single_source)          as is_single_source,
  max(c.switching_lead_time_days)      as switching_lead_time_days,
  min(c.category)                      as category,
  max(c.currency)                      as currency,
  max(c.updated_at)                    as updated_at
from public.supplier_commitment c
join public.party p on p.id = c.party_id
where p.status <> 'merged'
group by c.tenant_id, c.party_id, p.legal_name, p.tax_id;

alter view public.v_supplier_dependency set (security_invoker = on);

alter table public.supplier_commitment enable row level security;

create policy supplier_commitment_read on public.supplier_commitment
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));
