-- CreditMesh — 0007 Row level security.
--
-- Two rules, applied consistently:
--
--   1. Every row belongs to a tenant, and a user only ever sees their own.
--   2. Rows that carry money at a legal-entity grain are additionally scoped to
--      the entities the user is allowed to see. A user with an empty
--      entity_scope (central credit, admin, auditor) sees across all of them.
--      NFR §11 calls this out specifically: letting every BU see every other
--      BU's balances is politically explosive in most groups, so the default is
--      the narrow one.
--
-- The party master itself is tenant-wide rather than entity-scoped. Knowing a
-- counterparty exists is not sensitive; knowing what they owe another BU is,
-- and that lives in ar_item, credit_limit and exposure_snapshot.
--
-- Writes are deliberately not granted to end users here. Ingestion and every
-- state change run through server-side handlers on the service role, which
-- check permissions and write audit_log in the same transaction. A direct
-- client write would bypass the audit trail, and an unauditable change is
-- exactly what this product exists to eliminate.

-- ---------------------------------------------------------------- enable ---
alter table public.tenant                  enable row level security;
alter table public.tenant_profile          enable row level security;
alter table public.legal_entity            enable row level security;
alter table public.app_user                enable row level security;
alter table public.party                   enable row level security;
alter table public.party_identifier        enable row level security;
alter table public.party_relationship      enable row level security;
alter table public.party_group             enable row level security;
alter table public.party_group_member      enable row level security;
alter table public.party_merge_candidate   enable row level security;
alter table public.ar_item                 enable row level security;
alter table public.credit_limit            enable row level security;
alter table public.exposure_snapshot       enable row level security;
alter table public.payment_behavior        enable row level security;
alter table public.collateral              enable row level security;
alter table public.collateral_allocation   enable row level security;
alter table public.collateral_event        enable row level security;
alter table public.financial_statement     enable row level security;
alter table public.enrichment_snapshot     enable row level security;
alter table public.person                  enable row level security;
alter table public.person_party_role       enable row level security;
alter table public.risk_assessment         enable row level security;
alter table public.import_batch            enable row level security;
alter table public.dataset_freshness       enable row level security;
alter table public.audit_log               enable row level security;

-- ------------------------------------------------------- identity & config ---
create policy tenant_read on public.tenant
  for select to authenticated
  using (id = public.current_tenant_id());

create policy tenant_profile_read on public.tenant_profile
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy app_user_read_self on public.app_user
  for select to authenticated
  using (user_id = auth.uid());

-- Admins need the roster to manage access; nobody else does.
create policy app_user_read_admin on public.app_user
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

create policy legal_entity_read on public.legal_entity
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(code));

-- ------------------------------------------------------------ party master ---
create policy party_read on public.party
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy party_identifier_read on public.party_identifier
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy party_relationship_read on public.party_relationship
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy party_group_read on public.party_group
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy party_group_member_read on public.party_group_member
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy party_merge_candidate_read on public.party_merge_candidate
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- --------------------------------------------------- entity-scoped money ---
create policy ar_item_read on public.ar_item
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy credit_limit_read on public.credit_limit
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy exposure_snapshot_read on public.exposure_snapshot
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy payment_behavior_read on public.payment_behavior
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy collateral_allocation_read on public.collateral_allocation
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

-- A collateral instrument is visible when the user can see at least one of the
-- entities it is allocated to, or when it is not yet allocated anywhere —
-- unallocated instruments are precisely what central credit is looking for.
create policy collateral_read on public.collateral
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      exists (
        select 1 from public.collateral_allocation a
        where a.collateral_id = collateral.id
          and public.has_entity_access(a.legal_entity_code)
      )
      or not exists (
        select 1 from public.collateral_allocation a where a.collateral_id = collateral.id
      )
    )
  );

create policy collateral_event_read on public.collateral_event
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and exists (select 1 from public.collateral c where c.id = collateral_event.collateral_id)
  );

-- --------------------------------------------------- enrichment & scoring ---
create policy financial_statement_read on public.financial_statement
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy enrichment_snapshot_read on public.enrichment_snapshot
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy risk_assessment_read on public.risk_assessment
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- Natural-person data is narrower than company data on purpose (NFR §11).
-- Module 8 can affect individuals personally, so its inputs are not general
-- reading material.
create policy person_read on public.person
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'central_credit', 'auditor')
  );

create policy person_party_role_read on public.person_party_role
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'central_credit', 'auditor')
  );

-- --------------------------------------------------------- ops & evidence ---
create policy import_batch_read on public.import_batch
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy dataset_freshness_read on public.dataset_freshness
  for select to authenticated using (tenant_id = public.current_tenant_id());

create policy audit_log_read on public.audit_log
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'auditor', 'central_credit')
  );

-- Views must run as the caller, or RLS on the underlying tables is bypassed.
alter view public.collateral_balance set (security_invoker = on);
