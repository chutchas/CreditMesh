'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupForm({ locale, defaultName }: { locale: string; defaultName: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      setError(body.error ?? `POST /api/bootstrap → ${res.status} ${res.statusText}`);
      return;
    }
    router.push(`/${locale}/admin`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-[var(--color-line)] bg-white p-5">
      <label className="block text-sm">
        <span className="text-xs text-[var(--color-muted)]">Organisation name</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          className="mt-1 w-full rounded border border-[var(--color-line)] px-2 py-1.5"
        />
      </label>
      {error ? <p className="text-sm text-[#b42318]">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-[var(--color-brand)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy ? '…' : locale === 'th' ? 'สร้าง workspace' : 'Create workspace'}
      </button>
    </form>
  );
}
