'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface RequestRow {
  requestId: string;
  reference: string;
  partyName: string;
  fromEntityCode: string | null;
  toEntityCode: string;
  amount: number;
  reason: string;
  status: string;
  requestedAt: string;
  approvedBy: string[];
  rejectedBy: string | null;
  chain: { approver: string; kind: string; reason: string }[];
}

export interface Labels {
  raise: string;
  instrument: string;
  from: string;
  fromPool: string;
  to: string;
  amount: string;
  reason: string;
  reasonPlaceholder: string;
  submit: string;
  submitting: string;
  cancel: string;
  approve: string;
  reject: string;
  apply: string;
  applying: string;
  note: string;
  waitingOn: string;
  approvedBy: string;
  rejectedBy: string;
  readyToApply: string;
  staleWarning: string;
}

/**
 * Raising a request, deciding on one, and applying an approved one.
 *
 * The apply button is deliberately not automatic on the last approval. The
 * server re-validates at that moment and can refuse, and when it does the
 * refusals are shown in full — that refusal is the workflow working, not a bug,
 * so it gets the same prominence as a success.
 */
export default function AllocationPanel({
  instruments,
  entities,
  requests,
  canDecide,
  labels,
}: {
  instruments: { id: string; reference: string; partyName: string; unallocated: number }[];
  entities: { code: string; name: string }[];
  requests: RequestRow[];
  canDecide: boolean;
  labels: Labels;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [collateralId, setCollateralId] = useState('');
  const [fromEntityCode, setFrom] = useState('');
  const [toEntityCode, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<{ code: string; detail: string }[]>([]);

  async function post(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setRefusals([]);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!res.ok) {
      setError((payload.error as string | undefined) ?? `${res.status} ${res.statusText}`);
      setRefusals((payload.refusals as { code: string; detail: string }[] | undefined) ?? []);
      return false;
    }
    router.refresh();
    return true;
  }

  async function submit() {
    const ok = await post('/api/collateral/request', {
      collateralId,
      fromEntityCode: fromEntityCode || null,
      toEntityCode,
      amount: Number(amount.replace(/,/g, '')),
      reason,
    });
    if (ok) {
      setOpen(false);
      setAmount('');
      setReason('');
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded border border-[#fda29b] bg-[#fffbfa] px-3 py-2 text-xs text-[#b42318]">
          <div className="font-medium">{error}</div>
          {refusals.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {refusals.map((r) => (
                <li key={r.code}>· {r.detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="space-y-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--color-muted)]">{labels.instrument}</span>
              <select
                value={collateralId}
                onChange={(e) => setCollateralId(e.target.value)}
                className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
              >
                <option value="">—</option>
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.reference} · {i.partyName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--color-muted)]">{labels.from}</span>
              <select
                value={fromEntityCode}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
              >
                <option value="">{labels.fromPool}</option>
                {entities.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.code} — {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--color-muted)]">{labels.to}</span>
              <select
                value={toEntityCode}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
              >
                <option value="">—</option>
                {entities.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.code} — {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--color-muted)]">{labels.amount}</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular w-full rounded border border-[var(--color-line)] bg-white px-2 py-1 text-right text-xs"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] text-[var(--color-muted)]">{labels.reason}</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={labels.reasonPlaceholder}
                className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="rounded bg-[var(--color-brand)] px-3 py-1.5 text-xs text-white disabled:opacity-60"
            >
              {busy ? labels.submitting : labels.submit}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs"
            >
              {labels.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm"
        >
          {labels.raise}
        </button>
      )}

      {requests.length > 0 ? (
        <div className="space-y-2">
          {requests.map((r) => {
            const outstanding = r.chain.filter((s) => !r.approvedBy.includes(s.approver));
            return (
              <div key={r.requestId} className="rounded-lg border border-[var(--color-line)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="tabular text-sm font-medium">
                      {r.reference} · {r.fromEntityCode ?? labels.fromPool} → {r.toEntityCode} ·{' '}
                      {r.amount.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-[var(--color-muted)]">
                      {r.partyName} · {r.reason}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                      {r.rejectedBy ? (
                        <span className="rounded bg-[#fef3f2] px-1.5 py-0.5 text-[#b42318]">
                          {labels.rejectedBy} {r.rejectedBy}
                        </span>
                      ) : outstanding.length > 0 ? (
                        <span className="rounded bg-[#fffaeb] px-1.5 py-0.5 text-[#b54708]">
                          {labels.waitingOn} {outstanding.map((s) => s.approver).join(', ')}
                        </span>
                      ) : (
                        <span className="rounded bg-[#ecfdf3] px-1.5 py-0.5 text-[#067647]">{labels.readyToApply}</span>
                      )}
                      {r.approvedBy.map((a) => (
                        <span key={a} className="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[var(--color-muted)]">
                          {labels.approvedBy} {a}
                        </span>
                      ))}
                    </div>
                  </div>

                  {canDecide ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {outstanding.map((step) => (
                        <span key={step.approver} className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            title={step.reason}
                            onClick={() =>
                              post('/api/collateral/decide', {
                                requestId: r.requestId,
                                approver: step.approver,
                                decision: 'approved',
                              })
                            }
                            className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-[11px] disabled:opacity-60"
                          >
                            {labels.approve} · {step.approver}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              post('/api/collateral/decide', {
                                requestId: r.requestId,
                                approver: step.approver,
                                decision: 'rejected',
                              })
                            }
                            className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-[11px] disabled:opacity-60"
                          >
                            {labels.reject}
                          </button>
                        </span>
                      ))}
                      {r.status === 'approved' && outstanding.length === 0 ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => post('/api/collateral/apply', { requestId: r.requestId })}
                          className="rounded bg-[var(--color-brand)] px-2.5 py-1 text-[11px] text-white disabled:opacity-60"
                        >
                          {busy ? labels.applying : labels.apply}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-[var(--color-muted)]">{labels.staleWarning}</p>
        </div>
      ) : null}
    </div>
  );
}
