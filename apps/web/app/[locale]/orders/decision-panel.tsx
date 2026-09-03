'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type DecisionOutcome = 'recommend_release' | 'hold' | 'partial' | 'escalate' | 'reject';

/**
 * The decision box on a held order.
 *
 * Two deliberate frictions: the reason field is required, and the buttons never
 * say "release". Neither is an oversight — the platform cannot release
 * anything, and a decision with no reason is unusable three weeks later when
 * somebody asks why the goods went out.
 */
export default function DecisionPanel({
  blockId,
  evidence,
  labels,
}: {
  blockId: string;
  evidence: Record<string, unknown>;
  labels: {
    decide: string;
    reason: string;
    reasonPlaceholder: string;
    saving: string;
    saved: string;
    reasonRequired: string;
    outcomes: Record<DecisionOutcome, string>;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function decide(outcome: DecisionOutcome) {
    if (reason.trim().length < 3) {
      setError(labels.reasonRequired);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/order-blocks/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blockId, outcome, reason, evidence }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `${res.status} ${res.statusText}`);
      return;
    }
    setDone(true);
    setOpen(false);
    setReason('');
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {done ? <span className="text-xs text-[#067647]">{labels.saved}</span> : null}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-[var(--color-line)] bg-white px-2.5 py-1 text-xs"
        >
          {labels.decide}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded border border-[var(--color-line)] bg-[var(--color-canvas)] p-2.5">
      <label className="block text-[11px] text-[var(--color-muted)]">{labels.reason}</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder={labels.reasonPlaceholder}
        className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
      />
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(labels.outcomes) as DecisionOutcome[]).map((outcome) => (
          <button
            key={outcome}
            type="button"
            disabled={busy}
            onClick={() => decide(outcome)}
            className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-[11px] disabled:opacity-60"
          >
            {busy ? labels.saving : labels.outcomes[outcome]}
          </button>
        ))}
      </div>
      {error ? <div className="text-[11px] text-[#b42318]">{error}</div> : null}
    </div>
  );
}
