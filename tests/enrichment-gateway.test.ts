import { describe, expect, it } from 'vitest';
import {
  createStarterProfile,
  EnrichmentGateway,
  ManualUploadProvider,
  type EnrichmentDataset,
  type EnrichmentPayload,
  type EnrichmentProvider,
  type QuotaCounter,
  type SnapshotStore,
} from '@creditmesh/core';

class MemoryStore implements SnapshotStore {
  rows: { taxId: string; dataset: EnrichmentDataset; payload: EnrichmentPayload; retrievedAt: string }[] = [];

  async readLatest(taxId: string, dataset: EnrichmentDataset) {
    const hits = this.rows
      .filter((r) => r.taxId === taxId && r.dataset === dataset)
      .sort((a, b) => (a.retrievedAt < b.retrievedAt ? 1 : -1));
    return hits[0] ? { payload: hits[0].payload, retrievedAt: hits[0].retrievedAt } : null;
  }

  async write(_providerId: string, taxId: string, dataset: EnrichmentDataset, payload: EnrichmentPayload) {
    this.rows.push({ taxId, dataset, payload, retrievedAt: new Date().toISOString() });
  }
}

class MemoryQuota implements QuotaCounter {
  counts = new Map<string, number>();
  async used(providerId: string) {
    return this.counts.get(providerId) ?? 0;
  }
  async record(providerId: string, count: number) {
    this.counts.set(providerId, (this.counts.get(providerId) ?? 0) + count);
  }
}

class CountingProvider implements EnrichmentProvider {
  readonly providerId = 'test_provider';
  readonly supports = ['status', 'director'] as const;
  calls = 0;

  constructor(private readonly failWith?: string) {}

  async fetch(request: { taxId: string; datasets: EnrichmentDataset[] }) {
    this.calls += 1;
    if (this.failWith) throw new Error(this.failWith);
    return {
      providerId: this.providerId,
      taxId: request.taxId,
      retrievedAt: new Date().toISOString(),
      payload: { status: { legalStatus: 'active', registeredCapital: 1_000_000, registrationDate: null, registeredAddress: '1 Test Rd', industryCode: null } },
      fromCache: false,
      unavailable: [] as EnrichmentDataset[],
    };
  }
}

function profileWith(providerId: string, patch: { quotaPerDay?: number | null; cacheTtlDays?: number } = {}) {
  const profile = createStarterProfile('t', 'Demo');
  profile.enrichmentProviders = [
    {
      providerId,
      credentialRef: null,
      enabledDatasets: ['status', 'director'],
      quotaPerDay: patch.quotaPerDay ?? null,
      cacheTtlDays: patch.cacheTtlDays ?? 90,
    },
  ];
  return profile;
}

describe('EnrichmentGateway', () => {
  it('says so plainly when no provider covers the request', async () => {
    const gateway = new EnrichmentGateway(createStarterProfile('t', 'Demo'), [], new MemoryStore(), new MemoryQuota());
    const outcome = await gateway.lookup({ taxId: '0105536000020', datasets: ['status'] });
    expect(outcome.status).toBe('no_provider');
  });

  it('serves a fresh snapshot without calling the provider', async () => {
    const store = new MemoryStore();
    const provider = new CountingProvider();
    await store.write('test_provider', '0105536000020', 'status', { status: { legalStatus: 'active', registeredCapital: null, registrationDate: null, registeredAddress: null, industryCode: null } });

    const gateway = new EnrichmentGateway(profileWith('test_provider'), [provider], store, new MemoryQuota());
    const outcome = await gateway.lookup({ taxId: '0105536000020', datasets: ['status'] });

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.result.fromCache).toBe(true);
    // Company records do not change daily; re-fetching one is pure cost.
    expect(provider.calls).toBe(0);
  });

  it('calls the provider when the snapshot is older than the tenant’s window', async () => {
    const store = new MemoryStore();
    store.rows.push({
      taxId: '0105536000020',
      dataset: 'status',
      payload: {},
      retrievedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
    });
    const provider = new CountingProvider();
    const quota = new MemoryQuota();

    const gateway = new EnrichmentGateway(profileWith('test_provider', { cacheTtlDays: 90 }), [provider], store, quota);
    const outcome = await gateway.lookup({ taxId: '0105536000020', datasets: ['status'] });

    expect(outcome.status).toBe('ok');
    expect(provider.calls).toBe(1);
    expect(await quota.used('test_provider')).toBe(1);
    expect(store.rows.length).toBe(2);
  });

  it('stops at the tenant’s daily quota rather than spending their money', async () => {
    const provider = new CountingProvider();
    const quota = new MemoryQuota();
    await quota.record('test_provider', 5);

    const gateway = new EnrichmentGateway(profileWith('test_provider', { quotaPerDay: 5 }), [provider], new MemoryStore(), quota);
    const outcome = await gateway.lookup({ taxId: '0105536000020', datasets: ['status'] });

    expect(outcome.status).toBe('quota_exceeded');
    expect(provider.calls).toBe(0);
  });

  it('reports a provider outage by name instead of serving stale data silently', async () => {
    const provider = new CountingProvider('registry timed out');
    const gateway = new EnrichmentGateway(profileWith('test_provider'), [provider], new MemoryStore(), new MemoryQuota());
    const outcome = await gateway.lookup({ taxId: '0105536000020', datasets: ['status'], force: true });

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.providerId).toBe('test_provider');
      expect(outcome.message).toBe('registry timed out');
    }
  });

  it('force refresh bypasses the cache', async () => {
    const store = new MemoryStore();
    await store.write('test_provider', '0105536000020', 'status', {});
    const provider = new CountingProvider();

    const gateway = new EnrichmentGateway(profileWith('test_provider'), [provider], store, new MemoryQuota());
    await gateway.lookup({ taxId: '0105536000020', datasets: ['status'], force: true });

    expect(provider.calls).toBe(1);
  });
});

describe('ManualUploadProvider', () => {
  it('serves what was uploaded and never spends quota', async () => {
    const store = new MemoryStore();
    await store.write('manual_upload', '0105536000020', 'director', {
      directors: [{ fullName: 'สมชาย ใจดี', position: 'กรรมการ', since: null }],
    });

    const quota = new MemoryQuota();
    const gateway = new EnrichmentGateway(
      profileWith('manual_upload', { quotaPerDay: 0 }),
      [new ManualUploadProvider(store)],
      store,
      quota,
    );

    // Quota is zero, and it still works: a spreadsheet costs nothing to read.
    const outcome = await gateway.lookup({ taxId: '0105536000020', datasets: ['director'], force: true });
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.result.payload.directors?.[0]?.fullName).toBe('สมชาย ใจดี');
      expect(outcome.result.fromCache).toBe(true);
    }
    expect(await quota.used('manual_upload')).toBe(0);
  });

  it('names the datasets it has nothing for', async () => {
    const store = new MemoryStore();
    const provider = new ManualUploadProvider(store);
    const result = await provider.fetch({ taxId: '0105536000020', datasets: ['director', 'status'] });
    expect(result.unavailable).toEqual(['director', 'status']);
  });
});
