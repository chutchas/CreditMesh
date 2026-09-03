-- CreditMesh — 0013 A natural key for collateral allocations.
--
-- 0004 created collateral_allocation with a surrogate id and nothing else, so
-- re-importing an allocation register produced a second row for the same
-- allocation and quietly doubled what an instrument appeared to cover. §5.2
-- requires ingestion to be idempotent, and this is the table where a duplicate
-- does the most damage: over-allocation is the finding the module exists to
-- surface, and duplicates manufacture it.
--
-- An entity can hold more than one allocation against the same instrument over
-- time, so the key includes the start date. Two allocations starting on the
-- same day for the same entity against the same instrument are the same
-- allocation.

delete from public.collateral_allocation a
using public.collateral_allocation b
where a.ctid > b.ctid
  and a.tenant_id = b.tenant_id
  and a.collateral_id = b.collateral_id
  and a.legal_entity_code = b.legal_entity_code
  and a.valid_from = b.valid_from;

create unique index collateral_allocation_natural_key
  on public.collateral_allocation (tenant_id, collateral_id, legal_entity_code, valid_from);
