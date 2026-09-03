'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RunGroupsButton({
  labels,
}: {
  labels: {
    run: string;
    running: string;
    groupsProposed: string;
    edgesFound: string;
    hubsIgnored: string;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/groups/run', { method: 'POST' });
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    setBusy(false);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `POST /api/groups/run → ${res.status} ${res.statusText}`);
      return;
    }
    // Bilingual like every other number on screen (NFR §11) — a run summary in
    // one language on a Thai page is exactly the kind of seam that makes a
    // product feel translated rather than built in both.
    const hubs = Number(body.hubPersonsIgnored ?? 0) + Number(body.hubAddressesIgnored ?? 0);
    setSummary(
      `${body.proposed ?? 0} ${labels.groupsProposed} · ${body.edgesFound ?? 0} ${labels.edgesFound} · ${hubs} ${labels.hubsIgnored}`,
    );
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-xs text-[#b42318]">{error}</span> : null}
      {summary && !error ? <span className="tabular text-xs text-[var(--color-muted)]">{summary}</span> : null}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {busy ? labels.running : labels.run}
      </button>
    </span>
  );
}
