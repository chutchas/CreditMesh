'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RunIndexButton({
  labels,
}: {
  labels: { run: string; running: string; scored: string; blocked: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/risk-index/run', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `${res.status} ${res.statusText}`);
      return;
    }
    setSummary(`${body.scored ?? 0} ${labels.scored} · ${body.blocked ?? 0} ${labels.blocked}`);
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
