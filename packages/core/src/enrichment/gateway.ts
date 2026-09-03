import type { TenantProfile } from '../tenant/profile';
import type {
  EnrichmentDataset,
  EnrichmentPayload,
  EnrichmentProvider,
  EnrichmentResult,
  SnapshotStore,
} from './provider';

/**
 * Enrichment Gateway (Spec §3).
 *
 * Sits between the modules and whichever provider a tenant pays for. It exists
 * to enforce three things the modules must not have to think about:
 *
 *   - the tenant's daily quota, because every call spends their money and an
 *     unbounded engine will spend a lot of it in one afternoon;
 *   - the cache window, because company registry data does not change daily and
 *     re-fetching it is pure cost;
 *   - that every fact carries the provider and the moment it was retrieved, so
 *     a conclusion drawn from it can be traced (P6) and so Module 5 can detect
 *     change by comparing consecutive snapshots.
 */

export interface QuotaCounter {
  /** Calls already made today for this tenant and provider. */
  used(providerId: string): Promise<number>;
  record(providerId: string, count: number): Promise<void>;
}

export interface GatewayLookup {
  taxId: string;
  datasets: EnrichmentDataset[];
  /** Ignores the cache window. Used when a person explicitly asks to refresh. */
  force?: boolean;
}

export type LookupOutcome =
  | { status: 'ok'; result: EnrichmentResult }
  | { status: 'no_provider'; datasets: EnrichmentDataset[] }
  | { status: 'quota_exceeded'; providerId: string; quotaPerDay: number }
  | { status: 'failed'; providerId: string; message: string };

const MS_PER_DAY = 86_400_000;

export class EnrichmentGateway {
  constructor(
    private readonly profile: TenantProfile,
    private readonly providers: EnrichmentProvider[],
    private readonly store: SnapshotStore,
    private readonly quota: QuotaCounter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** First provider the tenant enabled that supports every dataset asked for. */
  private providerFor(datasets: EnrichmentDataset[]): { provider: EnrichmentProvider; cacheTtlDays: number; quotaPerDay: number | null } | null {
    for (const configured of this.profile.enrichmentProviders) {
      const provider = this.providers.find((p) => p.providerId === configured.providerId);
      if (!provider) continue;
      const enabled = new Set(configured.enabledDatasets);
      const covers = datasets.every((d) => enabled.has(d) && provider.supports.includes(d));
      if (!covers) continue;
      return { provider, cacheTtlDays: configured.cacheTtlDays, quotaPerDay: configured.quotaPerDay };
    }
    return null;
  }

  async lookup(request: GatewayLookup): Promise<LookupOutcome> {
    const configured = this.providerFor(request.datasets);
    if (!configured) return { status: 'no_provider', datasets: request.datasets };

    const { provider, cacheTtlDays, quotaPerDay } = configured;

    if (!request.force) {
      const cached = await this.readFreshCache(request.datasets, request.taxId, cacheTtlDays);
      if (cached) {
        return {
          status: 'ok',
          result: {
            providerId: provider.providerId,
            taxId: request.taxId,
            retrievedAt: cached.retrievedAt,
            payload: cached.payload,
            fromCache: true,
            unavailable: [],
          },
        };
      }
    }

    // manual_upload never calls anything, so it never spends quota.
    if (quotaPerDay !== null && provider.providerId !== 'manual_upload') {
      const used = await this.quota.used(provider.providerId);
      if (used >= quotaPerDay) {
        return { status: 'quota_exceeded', providerId: provider.providerId, quotaPerDay };
      }
    }

    let result: EnrichmentResult;
    try {
      result = await provider.fetch({ taxId: request.taxId, datasets: request.datasets });
    } catch (error) {
      // Fail loudly and by name. A gateway that swallows a provider outage
      // turns into a system quietly serving month-old company records.
      return {
        status: 'failed',
        providerId: provider.providerId,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (!result.fromCache) {
      await this.quota.record(provider.providerId, 1);
      for (const dataset of request.datasets) {
        if (result.unavailable.includes(dataset)) continue;
        await this.store.write(provider.providerId, request.taxId, dataset, result.payload);
      }
    }

    return { status: 'ok', result };
  }

  /** Every requested dataset must be present and inside the window, or it is a miss. */
  private async readFreshCache(
    datasets: EnrichmentDataset[],
    taxId: string,
    cacheTtlDays: number,
  ): Promise<{ payload: EnrichmentPayload; retrievedAt: string } | null> {
    const cutoff = this.now().getTime() - cacheTtlDays * MS_PER_DAY;
    const payload: EnrichmentPayload = {};
    let oldest: string | null = null;

    for (const dataset of datasets) {
      const snapshot = await this.store.readLatest(taxId, dataset);
      if (!snapshot || Date.parse(snapshot.retrievedAt) < cutoff) return null;
      Object.assign(payload, snapshot.payload);
      if (oldest === null || snapshot.retrievedAt < oldest) oldest = snapshot.retrievedAt;
    }

    return oldest === null ? null : { payload, retrievedAt: oldest };
  }
}
