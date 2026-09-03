import { NextResponse } from 'next/server';
import { detectRelatedParties, type OwnCompany, type SupplierPersonLink, type SupplierRecord } from '@creditmesh/core';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { canWrite, getSession } from '../../../../lib/session';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Runs related-party detection over the supplier register.
 *
 * Restricted to the audit and admin roles at the endpoint as well as in the
 * RLS policy. These findings name individuals, and §7 is explicit that they go
 * to internal audit and nowhere else — enforcing it in one layer only is how
 * that ends up being a documentation promise.
 *
 * There is no employee-list parameter, here or in the engine. Cross-checking
 * suppliers against staff records needs HR and a data protection review first,
 * and the absence of the code path is the point.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!canWrite(session)) return NextResponse.json({ error: 'not permitted' }, { status: 403 });
  if (session.roleCode !== 'auditor' && session.roleCode !== 'admin') {
    return NextResponse.json({ error: 'related-party findings are restricted to internal audit' }, { status: 403 });
  }

  const admin = createAdminClient();
  const tenantId = session.tenantId;
  const asOf = new Date().toISOString().slice(0, 10);

  const [{ data: suppliers, error }, { data: registry }, { data: links }, { data: commitments }] = await Promise.all([
    admin.from('party').select('id, legal_name, tax_id, roles').eq('tenant_id', tenantId).neq('status', 'merged'),
    admin.from('party_registry_profile').select('party_id, registered_address_norm').eq('tenant_id', tenantId),
    admin
      .from('person_party_role')
      .select('party_id, role, share_pct, person:person_id(full_name)')
      .eq('tenant_id', tenantId),
    admin.from('v_supplier_dependency').select('party_id, annual_spend').eq('tenant_id', tenantId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const addressByParty = new Map(
    ((registry ?? []) as { party_id: string; registered_address_norm: string | null }[]).map((r) => [
      r.party_id,
      r.registered_address_norm,
    ]),
  );
  const spendByParty = new Map(
    ((commitments ?? []) as { party_id: string; annual_spend: number | null }[]).map((c) => [
      c.party_id,
      Number(c.annual_spend ?? 0),
    ]),
  );

  const supplierRecords: SupplierRecord[] = ((suppliers ?? []) as { id: string; legal_name: string; tax_id: string | null; roles: string[] }[])
    .filter((p) => (p.roles ?? []).includes('supplier'))
    .map((p) => ({
      partyId: p.id,
      legalName: p.legal_name,
      taxId: p.tax_id,
      registeredAddressNorm: addressByParty.get(p.id) ?? null,
      annualSpend: spendByParty.get(p.id) ?? 0,
    }));

  // The group's own companies, from the legal entity register — the profile is
  // where an organisation states who it is (P1), not a table we infer it from.
  const ownCompanies: OwnCompany[] = session.profile.legalEntities.map((e) => ({
    partyId: null,
    legalName: e.displayName,
    taxId: null,
  }));

  const personLinks: SupplierPersonLink[] = ((links ?? []) as unknown as {
    party_id: string;
    role: string;
    share_pct: number | null;
    person: { full_name: string } | null;
  }[])
    .filter((l) => l.person?.full_name)
    .map((l) => ({
      personName: l.person!.full_name,
      partyId: l.party_id,
      role: l.role as 'director' | 'shareholder',
      sharePct: l.share_pct === null ? null : Number(l.share_pct),
    }));

  const findings = detectRelatedParties(supplierRecords, ownCompanies, personLinks, {
    excludedPersons: session.profile.groupResolution.excludedPersons,
    excludedAddresses: session.profile.groupResolution.excludedAddresses,
    nomineeThreshold: 5,
    asOf,
  });

  if (findings.length > 0) {
    const payload = findings.map((f) => ({
      tenant_id: tenantId,
      code: f.code,
      party_ids: f.partyIds,
      party_names: f.partyNames,
      person_names: f.personNames,
      link_strength: f.linkStrength,
      evidence: f.evidence,
      summary: f.summary,
      observed_at: f.observedAt,
      disposition: 'open',
    }));
    // A finding already dismissed by a reviewer keeps its disposition: nothing
    // is more corrosive to an audit queue than the same cleared item returning
    // every run.
    const { error: writeError } = await admin
      .from('related_party_finding')
      .upsert(payload, { onConflict: 'tenant_id,code,party_ids,observed_at', ignoreDuplicates: true });
    if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 });
  }

  await admin.from('audit_log').insert({
    tenant_id: tenantId,
    actor: session.userId,
    actor_label: session.email,
    action: 'related_party.run',
    object_type: 'related_party_finding',
    object_id: asOf,
    snapshot: { suppliers: supplierRecords.length, findings: findings.length },
  });

  return NextResponse.json({ ok: true, suppliers: supplierRecords.length, findings: findings.length });
}
