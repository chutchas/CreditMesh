-- CreditMesh — 0011 Give the group limit figure its context.
--
-- v_group_exposure already sums the credit limits of a group's members, and
-- that sum is easy to misread. Sitting next to the group's exposure it invites
-- the reading "78% used, room left" — when the entire point of Module 2 is that
-- nobody ever approved that amount to this owner. Three separate approvals do
-- not add up to one decision.
--
-- The largest single limit is the honest comparison: it is the biggest amount
-- anyone actually decided to lend this owner in one go, and a group exposure
-- well above it is precisely the finding the module exists to surface — the
-- case for a group limit rather than a set of company limits.

-- Dropped rather than replaced: CREATE OR REPLACE VIEW can only append
-- columns at the end, and max_single_limit belongs beside the other limit
-- figures rather than tacked on after the as-of date. Nothing depends on this
-- view, so dropping it costs nothing.
drop view if exists public.v_group_exposure;

create view public.v_group_exposure as
select
  g.tenant_id,
  g.id                          as group_id,
  g.name                        as group_name,
  g.confidence,
  g.status,
  count(distinct m.party_id)    as member_count,
  count(distinct e.legal_entity_code) as entity_count,
  coalesce(sum(e.total_exposure), 0) as total_exposure,
  coalesce(sum(e.ar_overdue), 0)     as total_overdue,
  nullif(sum(e.credit_limit), 0)     as total_credit_limit,
  max(e.credit_limit)                as max_single_limit,
  max(e.as_of)                       as exposure_as_of
from public.party_group g
join public.party_group_member m on m.group_id = g.id
left join public.v_exposure_current e on e.party_id = m.party_id
group by g.id;

alter view public.v_group_exposure set (security_invoker = on);
