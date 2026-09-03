'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RunAnalysisButton({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/analysis/run', { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-xs text-[#b42318]">{error}</span> : null}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {busy ? '…' : label}
      </button>
    </span>
  );
}
