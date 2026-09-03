/**
 * Canonical Data Model (Spec §6)
 *
 * P2 — Core must not know the source system. No vendor/ERP terminology
 * (SAP, ACDOCA, company code, ...) may appear in this file or anywhere
 * under packages/core. Source-system concepts live in packages/adapters.
 * P6 — every derived number carries its evidence.
 */

export type Uuid = string;
/** ISO-8601 calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;
/** ISO-8601 instant, UTC. */
export type IsoTimestamp = string;
/** ISO-4217, e.g. `THB`, `USD`. */
export type CurrencyCode = string;

/** Money is never a bare number: the source currency must survive (NFR §11). */
export interface Money {
  amount: number;
  currency: CurrencyCode;
}

/** P3 — one party, many roles. There is no customer table and no supplier table. */
export type PartyRole = 'customer' | 'supplier' | 'prospect';

export type PartyLifecycle = 'active' | 'inactive' | 'blocked' | 'merged';

export interface Party {
  id: Uuid;
  tenantId: Uuid;
  legalName: string;
  displayName: string | null;
  /** National taxpayer id, normalised. Nullable: prospects may not have one yet. */
  taxId: string | null;
  countryCode: string | null;
  roles: PartyRole[];
  status: PartyLifecycle;
  /** Set when this party was merged into another during party resolution. */
  mergedIntoPartyId: Uuid | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/**
 * A party has many identifiers across many source systems and many entities.
 * Spec §6 "จุดที่คนพลาดบ่อย": this must be its own table, never a column.
 */
export type IdentifierKind = 'tax_id' | 'source_system' | 'registration_no' | 'internal' | 'other';

export interface PartyIdentifier {
  id: Uuid;
  tenantId: Uuid;
  partyId: Uuid;
  kind: IdentifierKind;
  /** Which system this identifier is native to. Opaque string to core. */
  systemId: string | null;
  legalEntityCode: string | null;
  value: string;
  isPrimary: boolean;
}

export interface LegalEntity {
  code: string;
  displayName: string;
  currency: CurrencyCode;
  parentCode: string | null;
  isActive: boolean;
}

export type RelationshipKind =
  | 'shareholder_of'
  | 'director_of'
  | 'parent_of'
  | 'same_registered_address'
  | 'name_similarity';

export interface PartyRelationship {
  id: Uuid;
  tenantId: Uuid;
  fromPartyId: Uuid;
  toPartyId: Uuid;
  kind: RelationshipKind;
  /** 0..1 */
  weight: number;
  evidence: Evidence[];
}

export interface PartyGroup {
  id: Uuid;
  tenantId: Uuid;
  name: string;
  memberPartyIds: Uuid[];
  /** 0..1 — below the tenant threshold the group is not shown at all. */
  confidence: number;
  evidence: Evidence[];
  confirmedBy: string | null;
  confirmedAt: IsoTimestamp | null;
}

/** P6 — a conclusion without evidence is not shippable. */
export interface Evidence {
  /** Machine-readable reason code, e.g. `shared_director`, `fs_equity_negative`. */
  code: string;
  /** Where the fact came from: adapter run id, enrichment snapshot id, user id. */
  sourceRef: string;
  /** As-of date of the underlying fact, so staleness is visible. */
  observedAt: IsoTimestamp;
  detail?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Receivables & exposure                                              */
/* ------------------------------------------------------------------ */

export interface ArItem {
  id: Uuid;
  tenantId: Uuid;
  partyId: Uuid;
  legalEntityCode: string;
  documentNo: string;
  documentDate: IsoDate;
  dueDate: IsoDate;
  /** Null while open. */
  clearedDate: IsoDate | null;
  amount: Money;
  amountBase: Money;
  isOpen: boolean;
  sourceRef: string;
}

export interface CreditLimit {
  id: Uuid;
  tenantId: Uuid;
  partyId: Uuid;
  legalEntityCode: string;
  limit: Money;
  validFrom: IsoDate;
  validTo: IsoDate | null;
  /** `source_system` = mirrored from an upstream system; `platform` = set here. */
  origin: 'source_system' | 'platform';
  sourceRef: string;
}

/**
 * Daily grain, not "current value" (Spec §6). Trend analysis and the ECL
 * module both need history, and backfilling it later is not possible.
 */
export interface ExposureSnapshot {
  tenantId: Uuid;
  partyId: Uuid;
  legalEntityCode: string;
  asOf: IsoDate;
  arOpen: Money;
  arOverdue: Money;
  openOrders: Money;
  undeliveredValue: Money;
  totalExposure: Money;
  creditLimit: Money | null;
  utilizationPct: number | null;
}

export interface PaymentBehavior {
  tenantId: Uuid;
  partyId: Uuid;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  invoiceCount: number;
  /** Weighted by amount — an unweighted average hides the large late ones. */
  weightedAvgDpd: number;
  maxDpd: number;
  onTimePct: number;
}

/* ------------------------------------------------------------------ */
/* Collateral (P4 — neutral, never a `bg` table)                       */
/* ------------------------------------------------------------------ */

export type CollateralType =
  | 'bank_guarantee'
  | 'letter_of_credit'
  | 'cash_deposit'
  | 'parent_guarantee'
  | 'performance_bond'
  | 'insurance'
  | 'other';

/** `inbound` = counterparty posted it to us. `outbound` = we posted it to them. */
export type CollateralDirection = 'inbound' | 'outbound';

export type CollateralStatus = 'active' | 'expired' | 'released' | 'claimed' | 'draft';

export interface Collateral {
  id: Uuid;
  tenantId: Uuid;
  partyId: Uuid;
  type: CollateralType;
  direction: CollateralDirection;
  reference: string;
  issuer: string | null;
  amount: Money;
  effectiveDate: IsoDate;
  expiryDate: IsoDate | null;
  claimDeadline: IsoDate | null;
  physicalLocation: string | null;
  status: CollateralStatus;
}

export interface CollateralAllocation {
  id: Uuid;
  tenantId: Uuid;
  collateralId: Uuid;
  legalEntityCode: string;
  allocated: Money;
  utilized: Money;
  validFrom: IsoDate;
  validTo: IsoDate | null;
}

/* ------------------------------------------------------------------ */
/* Enrichment                                                          */
/* ------------------------------------------------------------------ */

export interface FinancialStatement {
  id: Uuid;
  tenantId: Uuid;
  partyId: Uuid;
  fiscalYear: number;
  periodEnd: IsoDate;
  currency: CurrencyCode;
  revenue: number | null;
  grossProfit: number | null;
  netProfit: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  cash: number | null;
  inventory: number | null;
  receivables: number | null;
  /** Which provider this came from, or `manual_upload`. */
  providerId: string;
  retrievedAt: IsoTimestamp;
}

export type RiskGradeCode = string;

export interface RiskAssessment {
  id: Uuid;
  tenantId: Uuid;
  partyId: Uuid;
  asOf: IsoDate;
  score: number;
  grade: RiskGradeCode;
  /** Per-component contribution, so the total can be taken apart on screen. */
  components: RiskComponent[];
  evidence: Evidence[];
}

export interface RiskComponent {
  code: string;
  label: string;
  rawValue: number | null;
  normalized: number;
  weight: number;
  contribution: number;
}

/* ------------------------------------------------------------------ */
/* Ingestion & audit                                                   */
/* ------------------------------------------------------------------ */

export type ImportStatus = 'pending' | 'validating' | 'applied' | 'failed' | 'rejected';

export interface ImportBatch {
  id: Uuid;
  tenantId: Uuid;
  systemId: string;
  datasetId: string;
  status: ImportStatus;
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  /** Freshness of the data itself, not of the upload (Adapter rule §5.2). */
  dataAsOf: IsoDate | null;
  startedAt: IsoTimestamp;
  finishedAt: IsoTimestamp | null;
  message: string | null;
}

export interface AuditEntry {
  id: Uuid;
  tenantId: Uuid;
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  at: IsoTimestamp;
  /** The values the actor was looking at when they decided (NFR §11). */
  snapshot: Record<string, unknown> | null;
}
