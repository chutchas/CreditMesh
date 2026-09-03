import type { ReactNode } from 'react';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-line)] pb-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-[var(--color-muted)]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
      {title ? (
        <h2 className="border-b border-[var(--color-line)] px-4 py-3 text-sm font-semibold">{title}</h2>
      ) : null}
      <div className="p-4">{children}</div>
      {footer ? <div className="border-t border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-muted)]">{footer}</div> : null}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'warn' | 'bad' | 'good';
}) {
  const toneClass =
    tone === 'bad' ? 'text-[#b42318]' : tone === 'warn' ? 'text-[#b54708]' : tone === 'good' ? 'text-[#1a7f37]' : '';
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
      <div className={`tabular mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--color-muted)]">{hint}</div> : null}
    </div>
  );
}

/**
 * Grade colours come from the tenant profile, never from a constant here — P1.
 * A group that grades 1–7 in its own palette must not be repainted by us.
 */
export function GradeBadge({ grade, color }: { grade: string | null; color?: string | null }) {
  if (!grade) return <span className="text-xs text-[var(--color-muted)]">—</span>;
  return (
    <span
      className="inline-flex min-w-7 items-center justify-center rounded px-2 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: color ?? '#5b6b7c' }}
    >
      {grade}
    </span>
  );
}

const FLAG_TONE: Record<string, string> = {
  negative_equity: 'bg-[#fee4e2] text-[#b42318]',
  consecutive_losses: 'bg-[#fee4e2] text-[#b42318]',
  stale_filing: 'bg-[#fef0c7] text-[#b54708]',
  no_statement: 'bg-[#fef0c7] text-[#b54708]',
  liquidity_below_floor: 'bg-[#fef0c7] text-[#b54708]',
  leverage_above_ceiling: 'bg-[#eaecf0] text-[#475467]',
  revenue_decline_2y: 'bg-[#eaecf0] text-[#475467]',
};

export function FlagChip({ code, label }: { code: string; label: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] leading-4 ${FLAG_TONE[code] ?? 'bg-[#eaecf0] text-[#475467]'}`}>
      {label}
    </span>
  );
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
          {head}
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 text-sm text-[var(--color-muted)]">{hint}</p> : null}
    </div>
  );
}

/**
 * §5.2: every screen backed by adapter data has to say when that data is from,
 * and warn when it is older than its threshold. Silence reads as "current".
 */
export function FreshnessNote({ label, asOf, isStale, warning }: { label: string; asOf: string; isStale: boolean; warning: string }) {
  return (
    <p className={`text-xs ${isStale ? 'text-[#b54708]' : 'text-[var(--color-muted)]'}`}>
      {label} {asOf}
      {isStale ? ` · ${warning}` : ''}
    </p>
  );
}
