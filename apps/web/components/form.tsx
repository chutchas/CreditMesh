'use client';

import type { ReactNode } from 'react';

/**
 * Form primitives for the Tenant Profile editor.
 *
 * Deliberately plain: this screen is edited rarely, by an administrator, and
 * usually while reconciling against a policy document. Legibility and being
 * able to see many settings at once matter more than interaction polish.
 */

export function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`block text-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs font-medium text-[var(--color-muted)]">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint ? <span className="mt-0.5 block text-[11px] leading-4 text-[var(--color-muted)]">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  'w-full rounded border border-[var(--color-line)] bg-white px-2 py-1.5 text-sm disabled:bg-[var(--color-canvas)] disabled:text-[var(--color-muted)]';

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} ${mono ? 'tabular font-mono' : ''}`}
    />
  );
}

/**
 * A date the tenant states, always ISO and always nullable-by-empty.
 *
 * Used for the effective period on a late-charge rate, which is the one field
 * in the profile where a wrong or missing date silently changes money that was
 * already billed: a recomputation of last quarter has to find last quarter's
 * rate, and it finds it by this date.
 */
export function DateInput({
  value,
  onChange,
  disabled,
  nullable,
  nullLabel,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  nullable?: boolean;
  nullLabel?: string;
}) {
  if (nullable && value === null) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--color-muted)]">{nullLabel}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(new Date().toISOString().slice(0, 10))}
          className="rounded border border-[var(--color-line)] bg-white px-2 py-1 text-[11px] disabled:opacity-60"
        >
          +
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputClass}
      />
      {nullable ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className="rounded px-1.5 py-1 text-[11px] text-[var(--color-muted)] disabled:opacity-60"
          title={nullLabel}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  disabled,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  suffix?: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className={`${inputClass} tabular text-right`}
      />
      {suffix ? <span className="shrink-0 text-xs text-[var(--color-muted)]">{suffix}</span> : null}
    </span>
  );
}

/** Accepts null so "open ended" and "not set" stay distinct from zero. */
export function NullableNumberInput({
  value,
  onChange,
  nullLabel,
  step = 1,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  nullLabel: string;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      <input
        type="number"
        value={value ?? ''}
        step={step}
        disabled={disabled || value === null}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={`${inputClass} tabular text-right`}
      />
      <label className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--color-muted)]">
        <input
          type="checkbox"
          checked={value === null}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? null : 0)}
        />
        {nullLabel}
      </label>
    </span>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={inputClass}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        <span className="block">{label}</span>
        {hint ? <span className="block text-[11px] leading-4 text-[var(--color-muted)]">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ColorInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 rounded border border-[var(--color-line)]"
      />
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} tabular font-mono`}
      />
    </span>
  );
}

/** Comma-separated list editor, for the many string[] fields in the profile. */
export function ListInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <textarea
      rows={Math.min(6, Math.max(2, value.length))}
      value={value.join('\n')}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) =>
        onChange(
          e.target.value
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
        )
      }
      className={`${inputClass} font-mono text-xs`}
    />
  );
}

export function CheckboxGroup<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T[];
  options: { value: T; label: string }[];
  onChange: (v: T[]) => void;
  disabled?: boolean;
}) {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1.5">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={value.includes(o.value)}
            disabled={disabled}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))
            }
          />
          {o.label}
        </label>
      ))}
    </span>
  );
}

/**
 * Repeating rows with add and remove.
 *
 * Rows are removed rather than soft-deleted here because the profile is
 * versioned as a whole: the previous version still holds the removed row, so
 * nothing is actually lost by taking it out of the draft.
 */
export function ArrayEditor<T>({
  items,
  onChange,
  renderRow,
  makeEmpty,
  addLabel,
  removeLabel,
  emptyLabel,
  disabled,
  minItems = 0,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  renderRow: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
  makeEmpty: () => T;
  addLabel: string;
  removeLabel: string;
  emptyLabel: string;
  disabled?: boolean;
  minItems?: number;
}) {
  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-xs text-[var(--color-muted)]">
          {emptyLabel}
        </p>
      ) : null}

      {items.map((item, index) => (
        <div
          key={index}
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {renderRow(
              item,
              (patch) => onChange(items.map((row, i) => (i === index ? { ...row, ...patch } : row))),
              index,
            )}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={disabled || items.length <= minItems}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              className="text-xs text-[#b42318] disabled:cursor-not-allowed disabled:text-[var(--color-muted)]"
            >
              {removeLabel}
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...items, makeEmpty()])}
        className="rounded border border-[var(--color-line)] bg-white px-3 py-1.5 text-sm disabled:opacity-50"
      >
        + {addLabel}
      </button>
    </div>
  );
}

/** Editor for Record<string, number>, used by the scoring weights. */
export function WeightsEditor({
  value,
  keys,
  labelFor,
  onChange,
  disabled,
}: {
  value: Record<string, number>;
  keys: string[];
  labelFor: (key: string) => string;
  onChange: (v: Record<string, number>) => void;
  disabled?: boolean;
}) {
  const total = keys.reduce((sum, k) => sum + (value[k] ?? 0), 0);
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {keys.map((key) => (
          <Field key={key} label={labelFor(key)}>
            <NumberInput
              value={value[key] ?? 0}
              step={0.05}
              min={0}
              max={1}
              disabled={disabled}
              onChange={(v) => onChange({ ...value, [key]: v })}
            />
          </Field>
        ))}
      </div>
      {/* Weights are renormalised at scoring time, so a total other than 1 is
          not an error — but it is almost always a mistake, and worth saying. */}
      <p className={`mt-2 text-xs ${Math.abs(total - 1) > 0.001 ? 'text-[#b54708]' : 'text-[var(--color-muted)]'}`}>
        Σ {total.toFixed(2)}
      </p>
    </div>
  );
}
