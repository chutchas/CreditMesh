'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Dictionary } from '../../../lib/i18n/dictionaries';

interface DatasetInfo {
  id: string;
  label: string;
  columns: { field: string; required: boolean; aliases: string[] }[];
}

interface Report {
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  errors: { rowNumber: number; column: string | null; code: string; message: string }[];
  warnings: string[];
  suggestedDatasetId?: string | null;
}

export default function ImportPanel({
  datasets,
  labels,
  commonLabels,
}: {
  datasets: DatasetInfo[];
  labels: Dictionary['importer'];
  commonLabels: { noData: string };
}) {
  const router = useRouter();
  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? 'party');
  const [file, setFile] = useState<File | null>(null);
  const [dataAsOf, setDataAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<Report | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const dataset = datasets.find((d) => d.id === datasetId);
  const validated = report !== null && report.rowsAccepted > 0;
  const suggested = report?.suggestedDatasetId
    ? datasets.find((d) => d.id === report.suggestedDatasetId)
    : undefined;
  const suggestion = suggested && suggested.id !== datasetId ? suggested : undefined;

  function chooseFile(next: File | null) {
    setFile(next);
    setReport(null);
    setApplied(null);
    setError(null);
  }

  async function send(dryRun: boolean, datasetOverride?: string) {
    if (!file) return;
    setBusy(true);
    setError(null);
    if (dryRun) setApplied(null);
    const form = new FormData();
    form.set('file', file);
    form.set('datasetId', datasetOverride ?? datasetId);
    form.set('dryRun', String(dryRun));
    form.set('dataAsOf', dataAsOf);

    const res = await fetch('/api/import', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({}) as Record<string, unknown>);
    setBusy(false);
    if (!res.ok) {
      setError((json.error as string | undefined) ?? `POST /api/import → ${res.status} ${res.statusText}`);
      return;
    }
    setReport(json.report);
    if (!dryRun) {
      const notes: string[] = json.notes ?? [];
      setApplied(
        `${labels.applied}: ${json.inserted ?? 0} + ${json.updated ?? 0}` +
          (notes.length ? ` · ${notes.join(' · ')}` : ''),
      );
      router.refresh();
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <section className="rounded-lg border border-[var(--color-line)] bg-white p-4">
        <label className="block text-sm">
          <span className="text-xs text-[var(--color-muted)]">{labels.dataset}</span>
          <select
            value={datasetId}
            onChange={(e) => {
              setDatasetId(e.target.value);
              setReport(null);
              setApplied(null);
              setError(null);
            }}
            className="mt-1 w-full rounded border border-[var(--color-line)] px-2 py-1.5 text-sm"
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-sm">
          <span className="text-xs text-[var(--color-muted)]">{labels.dataAsOf}</span>
          <input
            type="date"
            value={dataAsOf}
            onChange={(e) => setDataAsOf(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--color-line)] px-2 py-1.5 text-sm"
          />
        </label>

        {/* The browser's own file input is easy to miss next to two large
            buttons, and people reasonably read "Import" as the thing that opens
            the file dialog. So the input is hidden behind a drop zone that
            looks like what it is, and the numbered steps say what order the
            three actions happen in. */}
        <div className="mt-3">
          <span className="text-xs text-[var(--color-muted)]">
            <span className="font-medium">{labels.stepFile}</span> — {labels.chooseFile}
          </span>
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInput.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              chooseFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className={`mt-1 cursor-pointer rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
              dragging
                ? 'border-[var(--color-brand)] bg-[#eef4fa]'
                : file
                  ? 'border-[#abdfb8] bg-[#f0fdf4]'
                  : 'border-[var(--color-line)] bg-[var(--color-canvas)] hover:border-[var(--color-brand)]'
            }`}
          >
            {file ? (
              <>
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="tabular mt-0.5 text-xs text-[var(--color-muted)]">
                  {(file.size / 1024).toFixed(1)} KB · {labels.changeFile}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-[var(--color-brand)]">{labels.browse}</p>
                <p className="mt-0.5 text-xs text-[var(--color-muted)]">{labels.dropHint}</p>
              </>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => send(true)}
            className="flex-1 rounded border border-[var(--color-line)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="block text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              {labels.stepValidate}
            </span>
            {labels.preview}
          </button>
          <button
            type="button"
            // Applying is only offered once a validation run has actually
            // succeeded on rows — never straight from the file picker.
            disabled={!file || busy || !validated}
            onClick={() => send(false)}
            className="flex-1 rounded bg-[var(--color-brand)] px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="block text-[10px] uppercase tracking-wide text-white/70">{labels.stepApply}</span>
            {labels.apply}
          </button>
        </div>

        {/* A disabled button that does not say why it is disabled is the same
            problem in a different shape. */}
        {!file ? (
          <p className="mt-2 text-center text-xs text-[var(--color-muted)]">{labels.hintNeedFile}</p>
        ) : !validated ? (
          <p className="mt-2 text-center text-xs text-[var(--color-muted)]">{labels.hintNeedValidate}</p>
        ) : null}

        {suggestion ? (
          <div className="mt-3 rounded border border-[#fbe3a4] bg-[#fffaeb] p-3 text-xs text-[#b54708]">
            <p>
              {labels.wrongDataset}: <strong>{suggestion.label}</strong>
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDatasetId(suggestion.id);
                setApplied(null);
                void send(true, suggestion.id);
              }}
              className="mt-2 rounded border border-[#b54708] px-2 py-1 text-[11px] font-medium disabled:opacity-50"
            >
              {labels.switchDataset}
            </button>
          </div>
        ) : null}

        {dataset ? (
          <div className="mt-5 border-t border-[var(--color-line)] pt-3">
            <p className="mb-2 text-xs font-medium text-[var(--color-muted)]">{labels.mappedColumns}</p>
            <ul className="space-y-1 text-[11px] leading-4 text-[var(--color-muted)]">
              {dataset.columns.map((c) => (
                <li key={c.field}>
                  <span className={c.required ? 'font-semibold text-[var(--color-ink)]' : ''}>{c.field}</span>
                  {c.required ? ' *' : ''} — {c.aliases.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        {error ? <div className="rounded border border-[#f5c2c0] bg-[#fef3f2] p-3 text-sm text-[#b42318]">{error}</div> : null}
        {applied ? <div className="rounded border border-[#abdfb8] bg-[#f0fdf4] p-3 text-sm text-[#1a7f37]">{applied}</div> : null}

        {report ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-[var(--color-line)] bg-white p-3">
                <div className="text-xs text-[var(--color-muted)]">{labels.rowsRead}</div>
                <div className="tabular text-xl font-semibold">{report.rowsRead}</div>
              </div>
              <div className="rounded-lg border border-[var(--color-line)] bg-white p-3">
                <div className="text-xs text-[var(--color-muted)]">{labels.rowsAccepted}</div>
                <div className="tabular text-xl font-semibold text-[#1a7f37]">{report.rowsAccepted}</div>
              </div>
              <div className="rounded-lg border border-[var(--color-line)] bg-white p-3">
                <div className="text-xs text-[var(--color-muted)]">{labels.rowsRejected}</div>
                <div className={`tabular text-xl font-semibold ${report.rowsRejected > 0 ? 'text-[#b42318]' : ''}`}>
                  {report.rowsRejected}
                </div>
              </div>
            </div>

            {report.warnings.length > 0 ? (
              <div className="rounded-lg border border-[#fbe3a4] bg-[#fffaeb] p-3 text-xs text-[#b54708]">
                <p className="mb-1 font-medium">{labels.warnings}</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {report.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {report.errors.length > 0 ? (
              <div className="rounded-lg border border-[var(--color-line)] bg-white p-3">
                <p className="mb-2 text-xs font-medium text-[#b42318]">
                  {labels.errors} ({report.errors.length})
                </p>
                <table className="w-full text-xs">
                  <thead className="text-left text-[var(--color-muted)]">
                    <tr>
                      <th className="py-1 pr-3 font-medium">{labels.row}</th>
                      <th className="py-1 pr-3 font-medium">{labels.column}</th>
                      <th className="py-1 font-medium">{labels.message}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.errors.slice(0, 50).map((e, i) => (
                      <tr key={i} className="border-t border-[var(--color-line)]">
                        <td className="tabular py-1 pr-3">{e.rowNumber}</td>
                        <td className="py-1 pr-3">{e.column ?? '—'}</td>
                        <td className="py-1">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--color-line)] p-10 text-center text-sm text-[var(--color-muted)]">
            {commonLabels.noData}
          </div>
        )}
      </section>
    </div>
  );
}
