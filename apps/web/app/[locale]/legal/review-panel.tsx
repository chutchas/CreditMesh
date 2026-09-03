'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface Candidate {
  partyId: string;
  legalName: string;
  similarity: number;
}

/**
 * The review control on one search result.
 *
 * When the engine could not attach the result to anyone, confirming requires
 * picking the counterparty explicitly — there is no "confirm anyway" path. The
 * near-matches are offered as a starting point with their similarity shown, so
 * a reviewer can see how weak the resemblance actually is before selecting one.
 */
export default function ReviewPanel({
  eventId,
  linkedPartyId,
  candidates,
  labels,
}: {
  eventId: string;
  linkedPartyId: string | null;
  candidates: Candidate[];
  labels: {
    confirm: string;
    reject: string;
    saving: string;
    choose: string;
    chooseRequired: string;
    note: string;
    noCandidates: string;
  };
}) {
  const router = useRouter();
  const [partyId, setPartyId] = useState<string>(linkedPartyId ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'confirmed' | 'rejected') {
    if (decision === 'confirmed' && !partyId) {
      setError(labels.chooseRequired);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch('/api/legal/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId, decision, partyId: partyId || null, note }),
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
    <div className="space-y-2">
      {linkedPartyId ? null : candidates.length > 0 ? (
        <select
          value={partyId}
          onChange={(e) => setPartyId(e.target.value)}
          className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
        >
          <option value="">{labels.choose}</option>
          {candidates.map((c) => (
            <option key={c.partyId} value={c.partyId}>
              {c.legalName} · {Math.round(c.similarity * 100)}%
            </option>
          ))}
        </select>
      ) : (
        <div className="text-[11px] text-[var(--color-muted)]">{labels.noCandidates}</div>
      )}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={labels.note}
        className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide('confirmed')}
          className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-[11px] disabled:opacity-60"
        >
          {busy ? labels.saving : labels.confirm}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide('rejected')}
          className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-[11px] disabled:opacity-60"
        >
          {labels.reject}
        </button>
      </div>
      {error ? <div className="text-[11px] text-[#b42318]">{error}</div> : null}
    </div>
  );
}
