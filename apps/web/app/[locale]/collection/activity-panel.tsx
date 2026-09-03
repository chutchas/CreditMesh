'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type ActivityType = 'call' | 'email' | 'letter' | 'visit' | 'note';

/**
 * Logging a call, and the two things that come out of one.
 *
 * A collector who has just put the phone down has about fifteen seconds of
 * willingness to type. So the promise and the dispute are on the same form as
 * the contact rather than behind their own screens — a promise-to-pay recorded
 * "later" is a promise-to-pay never recorded, and then the kept-rate is a
 * number about how good the team is at data entry.
 */
export default function ActivityPanel({
  caseId,
  disputeReasons,
  labels,
}: {
  caseId: string;
  disputeReasons: string[];
  labels: {
    logContact: string;
    outcome: string;
    note: string;
    promiseAmount: string;
    promiseDate: string;
    addPromise: string;
    addDispute: string;
    disputeReason: string;
    save: string;
    saving: string;
    moveUp: string;
    types: Record<ActivityType, string>;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ActivityType>('call');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState('');
  const [withPromise, setWithPromise] = useState(false);
  const [promiseAmount, setPromiseAmount] = useState('');
  const [promiseDate, setPromiseDate] = useState('');
  const [withDispute, setWithDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState(disputeReasons[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/collection/activity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caseId, ...body }),
    });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!res.ok) {
      setError((payload.error as string | undefined) ?? `${res.status} ${res.statusText}`);
      return false;
    }
    router.refresh();
    return true;
  }

  async function save() {
    const body: Record<string, unknown> = { type, outcome: outcome || null, note: note || null };
    if (withPromise && promiseAmount && promiseDate) {
      body.promise = { amount: Number(promiseAmount.replace(/,/g, '')), promisedDate: promiseDate };
    }
    if (withDispute && disputeReason) {
      body.dispute = { reasonCode: disputeReason, amount: 0 };
    }
    const ok = await post(body);
    if (ok) {
      setOpen(false);
      setNote('');
      setOutcome('');
      setWithPromise(false);
      setWithDispute(false);
      setPromiseAmount('');
      setPromiseDate('');
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-[11px]"
        >
          {labels.logContact}
        </button>
        <button
          type="button"
          onClick={() => post({ type: 'reorder', manualRank: 1, note: labels.moveUp })}
          className="text-[11px] text-[var(--color-muted)] underline"
        >
          {labels.moveUp}
        </button>
      </div>
    );
  }

  return (
    <div className="w-56 space-y-1.5 rounded border border-[var(--color-line)] bg-[var(--color-canvas)] p-2">
      <div className="flex flex-wrap gap-1">
        {(Object.keys(labels.types) as ActivityType[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setType(option)}
            className={`rounded px-1.5 py-0.5 text-[11px] ${
              type === option ? 'bg-[var(--color-brand)] text-white' : 'border border-[var(--color-line)] bg-white'
            }`}
          >
            {labels.types[option]}
          </button>
        ))}
      </div>
      <input
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
        placeholder={labels.outcome}
        className="w-full rounded border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px]"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={labels.note}
        className="w-full rounded border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px]"
      />

      <label className="flex items-center gap-1.5 text-[11px]">
        <input type="checkbox" checked={withPromise} onChange={(e) => setWithPromise(e.target.checked)} />
        {labels.addPromise}
      </label>
      {withPromise ? (
        <div className="flex gap-1">
          <input
            value={promiseAmount}
            onChange={(e) => setPromiseAmount(e.target.value)}
            placeholder={labels.promiseAmount}
            className="w-1/2 rounded border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px]"
          />
          <input
            type="date"
            value={promiseDate}
            onChange={(e) => setPromiseDate(e.target.value)}
            title={labels.promiseDate}
            className="w-1/2 rounded border border-[var(--color-line)] bg-white px-1 py-1 text-[11px]"
          />
        </div>
      ) : null}

      <label className="flex items-center gap-1.5 text-[11px]">
        <input type="checkbox" checked={withDispute} onChange={(e) => setWithDispute(e.target.checked)} />
        {labels.addDispute}
      </label>
      {withDispute ? (
        <select
          value={disputeReason}
          onChange={(e) => setDisputeReason(e.target.value)}
          title={labels.disputeReason}
          className="w-full rounded border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px]"
        >
          {disputeReasons.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ) : null}

      <div className="flex gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-[11px] disabled:opacity-60"
        >
          {busy ? labels.saving : labels.save}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-2 py-1 text-[11px] text-[var(--color-muted)]"
        >
          ✕
        </button>
      </div>
      {error ? <div className="text-[11px] text-[#b42318]">{error}</div> : null}
    </div>
  );
}
