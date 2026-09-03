'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The half of the memo the platform does not write.
 *
 * "Save and mark reviewed" is refused while any section is empty, by the server
 * as well as here. That refusal is the module's positioning made concrete:
 * a draft with no assessment in it is a printout of the database, and a review
 * step that accepts one erases the difference.
 */
export default function AnalystSections({
  memoId,
  initial,
  readOnly,
  labels,
}: {
  memoId: string;
  initial: { code: string; prompt: string; content: string }[];
  readOnly: boolean;
  labels: {
    save: string;
    saveAndReview: string;
    saving: string;
    saved: string;
    stillEmpty: string;
    reviewedOn: string;
  };
}) {
  const router = useRouter();
  const [sections, setSections] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(markReviewed: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/memo/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memoId, analystSections: sections, markReviewed }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    if (!res.ok) {
      const missing = (body.missing as string[] | undefined) ?? [];
      setError(
        missing.length > 0
          ? `${labels.stillEmpty} ${missing.join(', ')}`
          : ((body.error as string | undefined) ?? `${res.status} ${res.statusText}`),
      );
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <div key={s.code} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <label className="mb-1.5 block text-xs font-medium">{s.prompt}</label>
          <textarea
            value={s.content}
            readOnly={readOnly}
            onChange={(e) => {
              const next = [...sections];
              next[i] = { ...s, content: e.target.value };
              setSections(next);
              setSaved(false);
            }}
            rows={3}
            className="w-full rounded border border-[var(--color-line)] bg-white px-2 py-1.5 text-sm read-only:bg-[var(--color-canvas)]"
          />
        </div>
      ))}

      {readOnly ? (
        labels.reviewedOn ? <p className="text-xs text-[#067647]">{labels.reviewedOn}</p> : null
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => save(false)}
            className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {busy ? labels.saving : labels.save}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => save(true)}
            className="rounded bg-[var(--color-brand)] px-3 py-1.5 text-sm text-white disabled:opacity-60"
          >
            {labels.saveAndReview}
          </button>
          {saved && !error ? <span className="text-xs text-[#067647]">{labels.saved}</span> : null}
          {error ? <span className="text-xs text-[#b42318]">{error}</span> : null}
        </div>
      )}
    </div>
  );
}
