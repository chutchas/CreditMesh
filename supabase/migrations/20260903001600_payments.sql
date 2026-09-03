-- CreditMesh — 0016 Incoming payments and exceptions (Modules 13 and 15).
--
-- P8 in table form: these tables record the *status* of money that has already
-- moved. Nothing here receives, transfers, clears or posts anything back. There
-- is no balance to reconcile, no ledger to keep in step with the bank.
--
-- `party_id` is nullable on incoming_payment on purpose. Money arrives that
-- nobody can attribute yet — §4.14 calls it an unidentified receipt and gives
-- it its own SLA, because it is the case that goes stale silently. Forcing a
-- counterparty here would push somebody to guess one.
--
-- And there is no returned_cheque table. Reversals, failed transfers,
-- unidentified receipts and overpayments arrive right behind it, and a table
-- per event type is the same mistake as a table per collateral instrument.
-- One payment_exception table, one `type` column.

create table public.incoming_payment (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  -- Null while the receipt cannot be attributed to anyone.
  party_id          uuid references public.party(id) on delete set null,
  legal_entity_code text not null,
  receipt_ref       text not null,
  payment_date      date not null,
  value_date        date,
  amount            numeric(20,2) not null,
  currency          char(3) not null,
  channel           text not null default 'bank_transfer',
  -- The invoice the source system already applied this to, when it did. What
  -- the adapter can give here is exactly what payment_grain declares.
  source_document_no text,
  -- The name on the bank line, which is very often not our legal name for them.
  payer_name        text,
  reference         text,
  cheque_no         text,
  cheque_due_date   date,
  status            text not null default 'open'
                    check (status in ('open', 'matched', 'partial', 'unidentified', 'reversed')),
  source_ref        text,
  imported_at       timestamptz not null default now(),
  unique (tenant_id, legal_entity_code, receipt_ref),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index incoming_payment_party_idx on public.incoming_payment (tenant_id, party_id, payment_date desc);
create index incoming_payment_open_idx on public.incoming_payment (tenant_id, payment_date desc)
  where status in ('open', 'unidentified');

-- One receipt can settle several invoices and one invoice can take several
-- receipts, so this is its own table rather than a column on either side.
create table public.payment_application (
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  payment_id     uuid not null references public.incoming_payment(id) on delete cascade,
  ar_item_id     uuid not null references public.ar_item(id) on delete cascade,
  applied_amount numeric(20,2) not null,
  -- How this link was made. 'source' means the ERP decided and we read it;
  -- everything else is ours, and 'manual' is a person's. A later reader must be
  -- able to tell a read fact from a derived guess.
  match_rule     text not null
                 check (match_rule in ('source', 'invoice_no', 'amount_and_date',
                                       'party_and_amount', 'party_and_reference', 'manual')),
  confidence     numeric(4,3) not null default 1,
  matched_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  primary key (tenant_id, payment_id, ar_item_id)
);

create index payment_application_item_idx on public.payment_application (tenant_id, ar_item_id);

create table public.payment_exception (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  party_id          uuid references public.party(id) on delete set null,
  legal_entity_code text not null,
  payment_id        uuid references public.incoming_payment(id) on delete set null,
  type              text not null
                    check (type in ('returned_cheque', 'reversal', 'mismatch', 'missing',
                                    'failed_transfer', 'overpayment', 'unidentified_receipt')),
  amount            numeric(20,2) not null default 0,
  currency          char(3) not null,
  occurred_at       date not null,
  reason_code       text,
  reason_text       text,
  -- NOT NULL because it is part of the natural key. A null here would make
  -- every re-import insert a duplicate instead of updating: nulls never
  -- conflict in a unique index, so the upsert would silently stop being one.
  reference         text not null,
  -- bank | erp | manual_entry. manual_entry is supported from day one: in most
  -- organisations a returned cheque is known first from a phone call.
  source            text not null default 'manual_entry',
  status            text not null default 'open'
                    check (status in ('open', 'resolved', 'written_off')),
  resolved_at       timestamptz,
  resolved_by       uuid references auth.users(id),
  resolution_note   text,
  created_at        timestamptz not null default now(),
  unique (tenant_id, type, reference, occurred_at, legal_entity_code),
  foreign key (tenant_id, legal_entity_code) references public.legal_entity(tenant_id, code)
);

create index payment_exception_open_idx
  on public.payment_exception (tenant_id, occurred_at desc) where status = 'open';
create index payment_exception_party_idx on public.payment_exception (tenant_id, party_id);

-- Signals raised from exceptions, stored so the path from a bounced cheque to a
-- credit decision is auditable rather than recomputed and forgotten (P7).
-- `targets` is an array because one event legitimately goes to several places.
create table public.credit_signal (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  party_id     uuid not null references public.party(id) on delete cascade,
  code         text not null,
  severity     text not null check (severity in ('critical', 'high', 'medium')),
  targets      text[] not null default '{}',
  reason       text not null,
  evidence     jsonb not null default '{}'::jsonb,
  raised_at    date not null,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  unique (tenant_id, party_id, code, raised_at)
);

create index credit_signal_open_idx on public.credit_signal (tenant_id, raised_at desc)
  where acknowledged_at is null;

-- Receipt with how much of it has been applied. The unapplied remainder is the
-- number the finance team chases, and computing it in one place stops two
-- screens disagreeing about it.
create view public.v_payment_status as
select
  p.id                                        as payment_id,
  p.tenant_id,
  p.party_id,
  p.legal_entity_code,
  p.receipt_ref,
  p.payment_date,
  p.amount,
  p.currency,
  p.channel,
  p.payer_name,
  p.source_document_no,
  p.status,
  coalesce(sum(a.applied_amount), 0)          as applied_amount,
  p.amount - coalesce(sum(a.applied_amount), 0) as unapplied_amount,
  count(a.ar_item_id)                         as application_count,
  min(a.confidence)                           as lowest_confidence
from public.incoming_payment p
left join public.payment_application a on a.payment_id = p.id
group by p.id;

alter view public.v_payment_status set (security_invoker = on);

alter table public.incoming_payment enable row level security;
alter table public.payment_application enable row level security;
alter table public.payment_exception enable row level security;
alter table public.credit_signal enable row level security;

create policy incoming_payment_read on public.incoming_payment
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

create policy payment_application_read on public.payment_application
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy payment_exception_read on public.payment_exception
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_entity_access(legal_entity_code));

-- Signals are tenant-wide, like legal events: a bounced cheque in one BU is a
-- fact about the counterparty, and hiding it from the BU that has not yet met
-- them is precisely the cross-BU blindness §1 opens with.
create policy credit_signal_read on public.credit_signal
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
