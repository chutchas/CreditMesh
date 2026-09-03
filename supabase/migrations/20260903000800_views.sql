-- CreditMesh — 0008 Read models for the Portfolio X-ray.
--
-- These exist so a portfolio screen is one query rather than a fan-out of
-- per-party requests. All of them are security_invoker, so the RLS in 0007 is
-- what decides which rows a given user gets back.

-- Latest exposure per party per entity. distinct on is the cheap way to take
-- the newest row per key in Postgres.
create or replace view public.v_exposure_current as
select distinct on (e.tenant_id, e.party_id, e.legal_entity_code)
  e.tenant_id,
  e.party_id,
  e.legal_entity_code,
  e.as_of,
  e.ar_open,
  e.ar_overdue,
  e.open_orders,
  e.undelivered_value,
  e.total_exposure,
  e.credit_limit,
  e.utilization_pct,
  e.base_currency
from public.exposure_snapshot e
order by e.tenant_id, e.party_id, e.legal_entity_code, e.as_of desc;

create or replace view public.v_risk_current as
select distinct on (r.tenant_id, r.party_id)
  r.tenant_id,
  r.party_id,
  r.as_of,
  r.score,
  r.grade,
  r.components,
  r.flags,
  r.profile_version
from public.risk_assessment r
order by r.tenant_id, r.party_id, r.as_of desc;

-- One row per counterparty: who they are, what they owe us across every
-- entity, and what the last assessment concluded. This is the X-ray table.
create or replace view public.v_party_portfolio as
select
  p.tenant_id,
  p.id as party_id,
  p.legal_name,
  p.tax_id,
  p.roles,
  p.status,
  coalesce(x.entity_count, 0)          as entity_count,
  coalesce(x.total_exposure, 0)        as total_exposure,
  coalesce(x.total_ar_open, 0)         as total_ar_open,
  coalesce(x.total_ar_overdue, 0)      as total_ar_overdue,
  x.total_credit_limit,
  case
    when x.total_credit_limit is null or x.total_credit_limit = 0 then null
    else round(coalesce(x.total_exposure, 0) / x.total_credit_limit * 100, 2)
  end                                   as utilization_pct,
  x.as_of                               as exposure_as_of,
  r.score,
  r.grade,
  r.flags,
  r.as_of                               as risk_as_of,
  fs.latest_fiscal_year
from public.party p
left join (
  select
    tenant_id,
    party_id,
    count(*)                     as entity_count,
    sum(total_exposure)          as total_exposure,
    sum(ar_open)                 as total_ar_open,
    sum(ar_overdue)              as total_ar_overdue,
    -- Summing limits across entities is the group-level number the ERP cannot
    -- produce; it is not the same thing as a group limit, and the UI labels it
    -- as the sum it is.
    nullif(sum(credit_limit), 0) as total_credit_limit,
    max(as_of)                   as as_of
  from public.v_exposure_current
  group by tenant_id, party_id
) x on x.tenant_id = p.tenant_id and x.party_id = p.id
left join public.v_risk_current r on r.tenant_id = p.tenant_id and r.party_id = p.id
left join (
  select tenant_id, party_id, max(fiscal_year) as latest_fiscal_year
  from public.financial_statement group by tenant_id, party_id
) fs on fs.tenant_id = p.tenant_id and fs.party_id = p.id
where p.status <> 'merged';

alter view public.v_exposure_current set (security_invoker = on);
alter view public.v_risk_current     set (security_invoker = on);
alter view public.v_party_portfolio  set (security_invoker = on);

-- Grade distribution with the exposure sitting in each band. The second number
-- is the one that gets budget approved: a count of risky counterparties means
-- little without the money behind them.
create or replace function public.portfolio_by_grade()
returns table (grade text, party_count bigint, total_exposure numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(v.grade, 'ungraded') as grade,
         count(*)                      as party_count,
         coalesce(sum(v.total_exposure), 0) as total_exposure
  from public.v_party_portfolio v
  group by coalesce(v.grade, 'ungraded')
  order by 1
$$;
