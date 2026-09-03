'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RunChargesButton({
  labels,
}: {
  labels: { run: string; running: string; items: string; skipped: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState('');

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/late-charges/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(asOf ? { asOf } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `${res.status} ${res.statusText}`);
      return;
    }
    setSummary(`${body.itemCount ?? 0} ${labels.items} · ${body.skipped ?? 0} ${labels.skipped}`);
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-xs text-[#b42318]">{error}</span> : null}
      {summary && !error ? <span className="tabular text-xs text-[var(--color-muted)]">{summary}</span> : null}
      {/* A past as-of date is a first-class input, not a debugging affordance:
          §7 makes recomputing three months and reconciling it the acceptance
          test for this module. */}
      <input
        type="date"
        value={asOf}
        onChange={(e) => setAsOf(e.target.value)}
        className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
      />
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
