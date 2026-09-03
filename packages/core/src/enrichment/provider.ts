import type { IsoDate, IsoTimestamp } from '../types/canonical';

/**
 * Enrichment provider interface (Spec §3).
 *
 * The commercial shape of the product depends on this being an interface from
 * day one. Company data belongs to whoever collected it: the platform never
 * resells it, each tenant supplies their own account, calls are made on their
 * behalf and the cost is theirs. A tenant already paying one provider must be
 * able to keep using it, and the platform must not be stranded if a provider
 * changes its terms.
 *
 * So no provider name appears anywhere outside a provider implementation, and
 * `manual_upload` — a spreadsheet a person maintains — is a first-class provider
 * rather than a fallback bolted on later. Module 2 runs identically on either.
 */

export type EnrichmentDataset =
  | 'financial_statement'
  | 'shareholder'
  | 'director'
  | 'status'
  | 'litigation';

/** Registry facts about a company. Nullable throughout: registries have gaps. */
export interface RegistryStatus {
  legalStatus: string | null;
  registeredCapital: number | null;
  registrationDate: IsoDate | null;
  registeredAddress: string | null;
  industryCode: string | null;
}

export interface DirectorRecord {
  fullName: string;
  /** As the registry words it; not normalised, because the wording is evidence. */
  position: string | null;
  since: IsoDate | null;
}

export interface ShareholderRecord {
  holderName: string;
  /** A company shareholder becomes a party relationship; a person becomes a person. */
  holderType: 'person' | 'company';
  holderTaxId: string | null;
  sharePct: number | null;
}

export interface EnrichmentPayload {
  status?: RegistryStatus;
  directors?: DirectorRecord[];
  shareholders?: ShareholderRecord[];
}

export interface EnrichmentRequest {
  taxId: string;
  datasets: EnrichmentDataset[];
}

export interface EnrichmentResult {
  providerId: string;
  taxId: string;
  retrievedAt: IsoTimestamp;
  payload: EnrichmentPayload;
  /** True when served from a stored snapshot rather than a fresh provider call. */
  fromCache: boolean;
  /** Datasets the caller asked for that this provider could not supply. */
  unavailable: EnrichmentDataset[];
}

export interface EnrichmentProvider {
  readonly providerId: string;
  readonly supports: readonly EnrichmentDataset[];
  /**
   * Providers receive no credentials as arguments. They resolve their own from
   * the secret store using the reference in the tenant profile, so a credential
   * never travels through core and never lands in a log line.
   */
  fetch(request: EnrichmentRequest): Promise<EnrichmentResult>;
}

/** Stored point-in-time copies. Module 5 detects change by comparing them. */
export interface SnapshotStore {
  readLatest(taxId: string, dataset: EnrichmentDataset): Promise<{ payload: EnrichmentPayload; retrievedAt: IsoTimestamp } | null>;
  write(providerId: string, taxId: string, dataset: EnrichmentDataset, payload: EnrichmentPayload): Promise<void>;
}

/**
 * A provider that never calls anything: the data arrives by spreadsheet upload
 * and is read back from the snapshot store.
 *
 * This is what lets an organisation run Module 2 before any provider contract
 * exists — which matters, because the contract usually takes longer to sign
 * than the module takes to build.
 */
export class ManualUploadProvider implements EnrichmentProvider {
  readonly providerId = 'manual_upload';
  readonly supports = ['status', 'director', 'shareholder', 'financial_statement'] as const;

  constructor(private readonly store: SnapshotStore) {}

  async fetch(request: EnrichmentRequest): Promise<EnrichmentResult> {
    const payload: EnrichmentPayload = {};
    const unavailable: EnrichmentDataset[] = [];
    let newest: IsoTimestamp | null = null;

    for (const dataset of request.datasets) {
      const snapshot = await this.store.readLatest(request.taxId, dataset);
      if (!snapshot) {
        unavailable.push(dataset);
        continue;
      }
      Object.assign(payload, snapshot.payload);
      if (newest === null || snapshot.retrievedAt > newest) newest = snapshot.retrievedAt;
    }

    return {
      providerId: this.providerId,
      taxId: request.taxId,
      retrievedAt: newest ?? new Date().toISOString(),
      payload,
      fromCache: true,
      unavailable,
    };
  }
}
