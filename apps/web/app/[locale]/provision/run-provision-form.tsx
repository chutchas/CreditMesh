'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The forward-looking overlay is typed in, never derived.
 *
 * An assistant that infers a macro factor from the receivables it happens to
 * hold is producing an economic forecast and calling it arithmetic. The field
 * is on the form so the number has an owner.
 */
export default function RunProvisionForm({
  labels,
}: {
  labels: { run: string; running: string; forwardLooking: string; asOf: string; provision: string };
}) {
  const router = useRouter();
  const [asOf, setAsOf] = useState('');
  const [overlay, setOverlay] = useState('0');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/provision/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ asOf: asOf || undefined, forwardLookingPct: Number(overlay) || 0 }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `${res.status} ${res.statusText}`);
      return;
    }
    setSummary(`${labels.provision}: ${Math.round(Number(body.proposedProvision ?? 0)).toLocaleString()}`);
    router.refresh();
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {error ? <span className="text-xs text-[#b42318]">{error}</span> : null}
      {summary && !error ? <span className="tabular text-xs text-[var(--color-muted)]">{summary}</span> : null}
      <label className="flex items-center gap-1 text-xs text-[var(--color-muted)]">
        {labels.forwardLooking}
        <input
          value={overlay}
          onChange={(e) => setOverlay(e.target.value)}
          className="w-14 rounded border border-[var(--color-line)] bg-white px-1.5 py-1 text-right text-xs"
        />
        %
      </label>
      <input
        type="date"
        value={asOf}
        onChange={(e) => setAsOf(e.target.value)}
        title={labels.asOf}
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
