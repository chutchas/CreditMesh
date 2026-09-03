import type { Evidence, IsoDate, Uuid } from '../types/canonical';
import { normalizePersonName } from './group-resolution';

/**
 * Module 8 — Related Party & Conflict Detection.
 *
 * Almost free: it is the Module 2 group engine with the supplier register fed
 * in instead of the customer one. That is what P3's neutral `party` with a
 * `roles[]` array bought — one architectural decision, two modules.
 *
 * It also carries the single largest warning in the whole spec, and the code
 * has to hold the line rather than the documentation:
 *
 * 1. **No employee data.** Cross-checking suppliers against a staff list is
 *    where this becomes an HR and PDPA matter, and it needs a legal review and
 *    HR's participation before a line of it is written. There is deliberately
 *    no function here that takes an employee list, so nobody can wire one in
 *    over a weekend.
 * 2. **Findings, never verdicts.** Every output is an item to check, with the
 *    evidence attached. A shared surname is not corruption. The output shape
 *    has no field for a conclusion, because a field like that gets filled in.
 * 3. **Audit only.** These findings concern named individuals; the caller is
 *    expected to gate them to the audit role, and the finding carries a flag
 *    saying so rather than relying on somebody remembering.
 */

export type ConflictCode =
  | 'supplier_in_own_group'
  | 'common_owner_suppliers'
  | 'director_also_customer'
  | 'shared_registered_address';

export interface RelatedPartyFinding {
  code: ConflictCode;
  /** The counterparties this concerns. */
  partyIds: Uuid[];
  partyNames: string[];
  /** Named individuals, when the link runs through a person. */
  personNames: string[];
  /** 0–1. Never a probability of wrongdoing — a strength of the link only. */
  linkStrength: number;
  evidence: Evidence[];
  /** Plain words an auditor can verify against the register themselves. */
  summary: string;
  /** Always true. These findings concern individuals and are audit material. */
  restrictedToAudit: true;
  observedAt: IsoDate;
}

export interface SupplierRecord {
  partyId: Uuid;
  legalName: string;
  taxId: string | null;
  registeredAddressNorm: string | null;
  annualSpend: number;
}

/** Renamed from the group engine's own PersonLink: same shape, different
 * register, and two exports of one name in the barrel is a trap. */
export interface SupplierPersonLink {
  personName: string;
  partyId: Uuid;
  role: 'director' | 'shareholder';
  sharePct: number | null;
}

export interface OwnCompany {
  partyId: Uuid | null;
  legalName: string;
  taxId: string | null;
}

export interface RelatedPartyOptions {
  /** Persons the tenant has excluded — nominee directors, agents (§4.7). */
  excludedPersons: string[];
  /** Addresses the tenant has excluded — accountants, serviced offices. */
  excludedAddresses: string[];
  /** A person on more boards than this is a professional, not an owner. */
  nomineeThreshold: number;
  asOf: IsoDate;
}

/**
 * Find suppliers that may be related to the buying group or to each other.
 *
 * Employee data is not a parameter and never will be without HR and a data
 * protection review; see the file header.
 */
export function detectRelatedParties(
  suppliers: SupplierRecord[],
  ownCompanies: OwnCompany[],
  personLinks: SupplierPersonLink[],
  options: RelatedPartyOptions,
): RelatedPartyFinding[] {
  const findings: RelatedPartyFinding[] = [];
  const supplierById = new Map(suppliers.map((s) => [s.partyId, s]));
  const excludedPersons = new Set(options.excludedPersons.map(normalizePersonName));
  const excludedAddresses = new Set(options.excludedAddresses.map((a) => a.trim().toLowerCase()));

  /* 1. A supplier that IS one of our own companies -------------------- */
  const ownTaxIds = new Map(
    ownCompanies.filter((c) => c.taxId).map((c) => [c.taxId!.replace(/\D/g, ''), c]),
  );
  for (const supplier of suppliers) {
    const key = supplier.taxId?.replace(/\D/g, '');
    if (!key) continue;
    const own = ownTaxIds.get(key);
    if (!own) continue;
    findings.push({
      code: 'supplier_in_own_group',
      partyIds: [supplier.partyId],
      partyNames: [supplier.legalName, own.legalName],
      personNames: [],
      linkStrength: 1,
      evidence: [
        {
          code: 'shared_tax_id',
          sourceRef: 'counterparty register',
          observedAt: options.asOf,
          detail: { taxId: key, ownCompany: own.legalName },
        },
      ],
      summary: `${supplier.legalName} shares a taxpayer id with the group company ${own.legalName}`,
      restrictedToAudit: true,
      observedAt: options.asOf,
    });
  }

  /* 2. Several suppliers behind one person ---------------------------- */
  const byPerson = new Map<string, { display: string; links: SupplierPersonLink[] }>();
  for (const link of personLinks) {
    if (!supplierById.has(link.partyId)) continue;
    const key = normalizePersonName(link.personName);
    if (!key || excludedPersons.has(key)) continue;
    const bucket = byPerson.get(key) ?? { display: link.personName, links: [] };
    bucket.links.push(link);
    byPerson.set(key, bucket);
  }

  for (const [key, bucket] of byPerson) {
    const partyIds = [...new Set(bucket.links.map((l) => l.partyId))];
    if (partyIds.length < 2) continue;
    // A person sitting on many boards is a professional director, not an owner
    // running a cartel. Reporting them is how this module loses its audience.
    if (partyIds.length > options.nomineeThreshold) continue;

    const owns = bucket.links.filter((l) => l.role === 'shareholder');
    const spend = partyIds.reduce((s, id) => s + (supplierById.get(id)?.annualSpend ?? 0), 0);

    findings.push({
      code: 'common_owner_suppliers',
      partyIds,
      partyNames: partyIds.map((id) => supplierById.get(id)?.legalName ?? id),
      personNames: [bucket.display],
      // Ownership is a stronger link than a directorship, and neither is proof
      // of anything on its own.
      linkStrength: owns.length >= 2 ? 0.9 : 0.6,
      evidence: bucket.links.map((l) => ({
        code: l.role === 'shareholder' ? 'shared_shareholder' : 'shared_director',
        sourceRef: 'company registry',
        observedAt: options.asOf,
        detail: {
          person: bucket.display,
          supplier: supplierById.get(l.partyId)?.legalName ?? l.partyId,
          sharePct: l.sharePct,
        },
      })),
      summary: `${partyIds.length} suppliers share ${bucket.display} as ${owns.length >= 2 ? 'a shareholder' : 'a director'} — combined annual spend ${Math.round(spend)}. Worth checking whether they bid separately.`,
      restrictedToAudit: true,
      observedAt: options.asOf,
    });
    void key;
  }

  /* 3. Suppliers at the same registered address ------------------------ */
  const byAddress = new Map<string, SupplierRecord[]>();
  for (const supplier of suppliers) {
    const address = supplier.registeredAddressNorm?.trim().toLowerCase();
    if (!address || excludedAddresses.has(address)) continue;
    const bucket = byAddress.get(address) ?? [];
    bucket.push(supplier);
    byAddress.set(address, bucket);
  }
  for (const [address, group] of byAddress) {
    if (group.length < 2) continue;
    // An address shared by a dozen companies is an accountant's office. The
    // tenant's exclusion list catches the known ones; this catches the rest.
    if (group.length > 5) continue;
    findings.push({
      code: 'shared_registered_address',
      partyIds: group.map((s) => s.partyId),
      partyNames: group.map((s) => s.legalName),
      personNames: [],
      // Weakest of the signals, and rated as such. Companies share buildings.
      linkStrength: 0.35,
      evidence: [
        {
          code: 'shared_registered_address',
          sourceRef: 'company registry',
          observedAt: options.asOf,
          detail: { address, suppliers: group.map((s) => s.legalName) },
        },
      ],
      summary: `${group.length} suppliers are registered at the same address. On its own this means little — companies share buildings — but it corroborates other links.`,
      restrictedToAudit: true,
      observedAt: options.asOf,
    });
  }

  return findings.sort((a, b) => b.linkStrength - a.linkStrength);
}

export interface RelatedPartySummary {
  findings: number;
  suppliersInvolved: number;
  spendInvolved: number;
  byCode: { code: ConflictCode; count: number }[];
}

export function summariseRelatedParties(
  findings: RelatedPartyFinding[],
  suppliers: SupplierRecord[],
): RelatedPartySummary {
  const spendById = new Map(suppliers.map((s) => [s.partyId, s.annualSpend]));
  const involved = new Set(findings.flatMap((f) => f.partyIds));
  const byCode = new Map<ConflictCode, number>();
  for (const f of findings) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);

  return {
    findings: findings.length,
    suppliersInvolved: involved.size,
    spendInvolved: Math.round([...involved].reduce((s, id) => s + (spendById.get(id) ?? 0), 0) * 100) / 100,
    byCode: [...byCode.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
  };
}
