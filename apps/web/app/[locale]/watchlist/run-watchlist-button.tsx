'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RunWatchlistButton({
  labels,
}: {
  labels: { run: string; running: string; raised: string; digest: string; deferred: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/watchlist/run', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `${res.status} ${res.statusText}`);
      return;
    }
    // The held-back counts are reported, never hidden. A quiet inbox must not
    // be mistaken for a quiet day.
    setSummary(
      `${body.raised ?? 0} ${labels.raised} · ${body.digest ?? 0} ${labels.digest} · ${body.deferred ?? 0} ${labels.deferred}`,
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
