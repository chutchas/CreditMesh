'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * A waiver always carries a reason.
 *
 * The report this module exists for answers "how much did we give away, to
 * whom, approved by whom, and why". The last part is the one nobody can
 * reconstruct afterwards, so the field is required here and again on the server.
 */
export default function WaiveButton({
  itemId,
  labels,
}: {
  itemId: string;
  labels: { waive: string; reason: string; reasonRequired: string; saving: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function waive() {
    if (reason.trim().length < 3) {
      setError(labels.reasonRequired);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/late-charges/waive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId, reason }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `${res.status} ${res.statusText}`);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-[11px]"
      >
        {labels.waive}
      </button>
    );
  }

  return (
    <div className="w-44 space-y-1">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={labels.reason}
        className="w-full rounded border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px]"
      />
      <div className="flex gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={waive}
          className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-[11px] disabled:opacity-60"
        >
          {busy ? labels.saving : labels.waive}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-1 text-[11px] text-[var(--color-muted)]">
          ✕
        </button>
      </div>
      {error ? <div className="text-[11px] text-[#b42318]">{error}</div> : null}
    </div>
  );
}
