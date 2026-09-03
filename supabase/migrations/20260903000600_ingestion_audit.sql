-- CreditMesh — 0006 Ingestion and audit.

create type public.import_status as enum ('pending', 'validating', 'applied', 'failed', 'rejected');

create table public.import_batch (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  system_id     text not null default 'csv',
  dataset_id    text not null,
  file_name     text,
  status        public.import_status not null default 'pending',
  rows_read     integer not null default 0,
  rows_accepted integer not null default 0,
  rows_rejected integer not null default 0,
  -- The as-of date of the data, which is not the time it was uploaded. Every
  -- screen shows this, per §5.2.
  data_as_of    date,
  errors        jsonb not null default '[]'::jsonb,
  warnings      jsonb not null default '[]'::jsonb,
  uploaded_by   uuid,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index import_batch_tenant_idx on public.import_batch (tenant_id, dataset_id, started_at desc);

-- What every screen reads to decide whether to show a staleness warning.
-- §5.2: an adapter that fails must be visible, not silently serve old numbers.
create table public.dataset_freshness (
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  system_id        text not null,
  dataset_id       text not null,
  last_success_at  timestamptz,
  last_attempt_at  timestamptz,
  data_as_of       date,
  stale_after_hours integer not null default 48,
  last_error       text,
  primary key (tenant_id, system_id, dataset_id)
);

create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  actor       uuid,
  actor_label text,
  action      text not null,
  object_type text not null,
  object_id   text not null,
  -- The values the actor was looking at when they decided (NFR §11). Storing
  -- only the change makes an approval impossible to reconstruct later.
  snapshot    jsonb,
  at          timestamptz not null default now()
);

create index audit_log_tenant_idx on public.audit_log (tenant_id, at desc);
create index audit_log_object_idx on public.audit_log (tenant_id, object_type, object_id, at desc);
