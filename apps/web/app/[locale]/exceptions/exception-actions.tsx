'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Closing an exception.
 *
 * Resolving and writing off are separate outcomes on purpose. "Resolved" means
 * the money turned up or the error was corrected; "written off" means it did
 * not and somebody accepted the loss. Collapsing them into one button would
 * make the recovery rate — the number this module is judged on — meaningless.
 */
export default function ExceptionActions({
  exceptionId,
  labels,
}: {
  exceptionId: string;
  labels: { resolve: string; writeOff: string; note: string; saving: string };
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function close(status: 'resolved' | 'written_off') {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/exceptions/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ exceptionId, status, note }),
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
    <div className="w-44 space-y-1">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={labels.note}
        className="w-full rounded border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px]"
      />
      <div className="flex gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => close('resolved')}
          className="rounded border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px] disabled:opacity-60"
        >
          {busy ? labels.saving : labels.resolve}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => close('written_off')}
          className="rounded border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px] disabled:opacity-60"
        >
          {labels.writeOff}
        </button>
      </div>
      {error ? <div className="text-[11px] text-[#b42318]">{error}</div> : null}
    </div>
  );
}
