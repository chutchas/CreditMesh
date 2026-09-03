import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeBalances, type AllocationRecord, type CollateralBalance, type CollateralRecord } from '@creditmesh/core';

/**
 * Loads one instrument's live balance.
 *
 * The allocation workflow reads this twice for every request — once when it is
 * raised and once when it is applied — and both reads must go through the same
 * function as the register screen. Two code paths computing "how much of this
 * guarantee is spoken for" is precisely the disagreement this ledger exists to
 * end, and the workflow is the place where a disagreement would cost money.
 */
export async function loadCollateralBalance(
  admin: SupabaseClient,
  tenantId: string,
  collateralId: string,
  asOf: string,
  options: { allowOverAllocation: boolean },
): Promise<CollateralBalance | null> {
  const [{ data: instrument }, { data: allocations }] = await Promise.all([
    admin
      .from('collateral')
      .select('id, party_id, type, direction, reference, issuer, amount, currency, effective_date, expiry_date, claim_deadline, status, party:party_id(legal_name)')
      .eq('tenant_id', tenantId)
      .eq('id', collateralId)
      .maybeSingle(),
    admin
      .from('collateral_allocation')
      .select('collateral_id, legal_entity_code, allocated, utilized, valid_from, valid_to')
      .eq('tenant_id', tenantId)
      .eq('collateral_id', collateralId),
  ]);

  if (!instrument) return null;

  const row = instrument as unknown as Record<string, string | number | null> & {
    party: { legal_name: string } | null;
  };

  const record: CollateralRecord = {
    id: String(row.id),
    partyId: String(row.party_id),
    partyName: row.party?.legal_name ?? String(row.party_id),
    type: row.type as CollateralRecord['type'],
    direction: row.direction as CollateralRecord['direction'],
    reference: String(row.reference),
    issuer: row.issuer === null ? null : String(row.issuer),
    amount: Number(row.amount),
    currency: String(row.currency),
    effectiveDate: String(row.effective_date),
    expiryDate: row.expiry_date === null ? null : String(row.expiry_date),
    claimDeadline: row.claim_deadline === null ? null : String(row.claim_deadline),
    status: row.status as CollateralRecord['status'],
  };

  const allocationRecords: AllocationRecord[] = (allocations ?? []).map((a) => ({
    collateralId: a.collateral_id as string,
    legalEntityCode: a.legal_entity_code as string,
    allocated: Number(a.allocated),
    utilized: Number(a.utilized),
    validFrom: a.valid_from as string,
    validTo: (a.valid_to as string | null) ?? null,
  }));

  return (
    computeBalances([record], allocationRecords, {
      asOf,
      allowOverAllocation: options.allowOverAllocation,
    })[0] ?? null
  );
}
