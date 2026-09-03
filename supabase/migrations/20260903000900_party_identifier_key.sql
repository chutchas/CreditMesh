-- CreditMesh — 0009 Fix the party_identifier uniqueness key.
--
-- 0002 declared uniqueness as an expression index over coalesce(system_id, '')
-- and coalesce(legal_entity_code, ''). Postgres will not match an
-- `on conflict (tenant_id, kind, system_id, legal_entity_code, value)` clause to
-- an expression index, so every identifier upsert failed with "there is no
-- unique or exclusion constraint matching the ON CONFLICT specification".
--
-- The consequence was worse than a failed write: with no identifiers on file,
-- receivables and limits could not be matched to a counterparty by source code,
-- and financial statements could not be matched by tax id. Imports reported
-- success and wrote nothing.
--
-- The fix is to stop using NULL as "not applicable" here. An identifier that is
-- not scoped to a system or an entity now carries an empty string, so the key
-- can be a plain column list that both Postgres and PostgREST understand.

update public.party_identifier
   set system_id = coalesce(system_id, ''),
       legal_entity_code = coalesce(legal_entity_code, '');

alter table public.party_identifier
  alter column system_id set default '',
  alter column system_id set not null,
  alter column legal_entity_code set default '',
  alter column legal_entity_code set not null;

drop index if exists public.party_identifier_unique;

create unique index party_identifier_unique
  on public.party_identifier (tenant_id, kind, system_id, legal_entity_code, value);
