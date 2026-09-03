'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function GenerateMemoForm({
  parties,
  labels,
}: {
  parties: { id: string; name: string }[];
  labels: { choose: string; generate: string; generating: string; chooseRequired: string };
}) {
  const router = useRouter();
  const [partyId, setPartyId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!partyId) {
      setError(labels.chooseRequired);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/memo/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partyId }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `${res.status} ${res.statusText}`);
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-xs text-[#b42318]">{error}</span> : null}
      <select
        value={partyId}
        onChange={(e) => setPartyId(e.target.value)}
        className="max-w-56 rounded border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
      >
        <option value="">{labels.choose}</option>
        {parties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {busy ? labels.generating : labels.generate}
      </button>
    </span>
  );
}
