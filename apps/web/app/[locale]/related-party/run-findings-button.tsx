'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RunFindingsButton({
  labels,
}: {
  labels: { run: string; running: string; findings: string; suppliers: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/related-party/run', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `${res.status} ${res.statusText}`);
      return;
    }
    setSummary(`${body.suppliers ?? 0} ${labels.suppliers} · ${body.findings ?? 0} ${labels.findings}`);
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
