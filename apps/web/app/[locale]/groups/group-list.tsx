'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Locale } from '../../../lib/i18n/config';
import type { Dictionary } from '../../../lib/i18n/dictionaries';
import { formatMoney, formatPercent } from '../../../lib/format';

export interface GroupRow {
  id: string;
  name: string;
  status: 'proposed' | 'confirmed' | 'rejected';
  confidence: number;
  members: { partyId: string; legalName: string; taxId: string | null }[];
  edges: {
    leftPartyId: string;
    rightPartyId: string;
    confidence: number;
    signals: { kind: string; weight: number; detail: string }[];
  }[];
  totalExposure: number;
  totalOverdue: number;
  totalCreditLimit: number | null;
  maxSingleLimit: number | null;
  entityCount: number;
}

/**
 * A group is presented as a claim with its reasons attached, not as a fact.
 *
 * The evidence panel is open by default on proposals: the reviewer's job is to
 * judge the reasoning, and hiding it behind a click makes confirming easier
 * than checking — which is exactly the wrong way round for a decision that
 * changes how much credit a group is allowed.
 */
export default function GroupList({
  rows,
  locale,
  currency,
  canDecide,
  labels,
}: {
  rows: GroupRow[];
  locale: Locale;
  currency: string;
  canDecide: boolean;
  labels: Dictionary['groups'];
  flagLabels: { evidence: string };
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  async function decide(group: GroupRow, decision: 'confirmed' | 'rejected') {
    if (decision === 'confirmed' && !confirm(labels.confirmPrompt)) return;
    setBusyId(group.id);
    setError(null);
    const res = await fetch('/api/groups/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: group.id, decision, name: names[group.id] ?? group.name }),
    });
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    setBusyId(null);
    if (!res.ok) {
      setError((body.error as string | undefined) ?? `POST /api/groups/decide → ${res.status}`);
      return;
    }
    router.refresh();
  }

  const nameOf = (partyId: string, group: GroupRow) =>
    group.members.find((m) => m.partyId === partyId)?.legalName ?? partyId;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded border border-[#f5c2c0] bg-[#fef3f2] p-3 text-sm text-[#b42318]">{error}</div>
      ) : null}

      {rows.map((group) => {
        const confirmed = group.status === 'confirmed';
        return (
          <section
            key={group.id}
            className={`rounded-lg border bg-white ${confirmed ? 'border-[#abdfb8]' : 'border-[var(--color-line)]'}`}
          >
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-line)] p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      confirmed ? 'bg-[#1a7f37] text-white' : 'bg-[#fef0c7] text-[#b54708]'
                    }`}
                  >
                    {confirmed ? labels.confirmed : labels.proposed}
                  </span>
                  {confirmed ? (
                    <h2 className="text-base font-semibold">{group.name}</h2>
                  ) : (
                    <input
                      value={names[group.id] ?? group.name}
                      onChange={(e) => setNames((prev) => ({ ...prev, [group.id]: e.target.value }))}
                      aria-label={labels.groupName}
                      className="rounded border border-[var(--color-line)] px-2 py-1 text-base font-semibold"
                    />
                  )}
                  <span className="tabular text-xs text-[var(--color-muted)]">
                    {labels.confidence} {formatPercent(group.confidence * 100, locale, 0)}
                  </span>
                </div>
              </div>

              {canDecide && !confirmed ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={busyId === group.id}
                    onClick={() => decide(group, 'rejected')}
                    className="rounded border border-[var(--color-line)] px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    {labels.reject}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === group.id}
                    onClick={() => decide(group, 'confirmed')}
                    className="rounded bg-[var(--color-brand)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    {labels.confirm}
                  </button>
                </div>
              ) : null}
            </header>

            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label={labels.exposure} value={formatMoney(group.totalExposure, currency, locale, { compact: true })} />
                  <Stat
                    label={labels.overdue}
                    value={formatMoney(group.totalOverdue, currency, locale, { compact: true })}
                    tone={group.totalOverdue > 0 ? 'warn' : undefined}
                  />
                  {/* Labelled as the sum it is. Three separate approvals do not
                      add up to one decision, and a reader who takes this for a
                      group limit draws the opposite conclusion from the one the
                      module exists to deliver. */}
                  <Stat label={labels.limitSum} value={formatMoney(group.totalCreditLimit, currency, locale, { compact: true })} />
                  <Stat label={labels.entities} value={String(group.entityCount)} />
                </div>

                {group.maxSingleLimit !== null ? (
                  <p
                    className={`mb-3 text-[11px] leading-4 ${
                      group.totalExposure > group.maxSingleLimit ? 'text-[#b54708]' : 'text-[var(--color-muted)]'
                    }`}
                  >
                    {labels.limitSumCaveat}{' '}
                    <span className="tabular font-medium">
                      {formatMoney(group.maxSingleLimit, currency, locale, { compact: true })}
                    </span>
                    {group.totalCreditLimit ? (
                      <>
                        {' · '}
                        {labels.groupUtilisation}{' '}
                        <span className="tabular">
                          {formatPercent((group.totalExposure / group.totalCreditLimit) * 100, locale, 0)}
                        </span>
                      </>
                    ) : null}
                  </p>
                ) : null}

                <h3 className="mb-1.5 text-xs font-medium text-[var(--color-muted)]">
                  {labels.members} ({group.members.length})
                </h3>
                <ul className="space-y-1 text-sm">
                  {group.members.map((member) => (
                    <li key={member.partyId}>
                      <Link href={`/${locale}/parties/${member.partyId}`} className="text-[var(--color-brand)]">
                        {member.legalName}
                      </Link>
                      <span className="tabular ml-2 text-[11px] text-[var(--color-muted)]">{member.taxId ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="mb-1.5 text-xs font-medium text-[var(--color-muted)]">{labels.evidence}</h3>
                <ul className="space-y-2 text-sm">
                  {group.edges.map((edge, index) => (
                    <li key={index} className="rounded border border-[var(--color-line)] bg-[var(--color-canvas)] p-2.5">
                      <div className="text-xs font-medium">
                        {nameOf(edge.leftPartyId, group)} ↔ {nameOf(edge.rightPartyId, group)}
                        <span className="tabular ml-2 font-normal text-[var(--color-muted)]">
                          {formatPercent(edge.confidence * 100, locale, 0)}
                        </span>
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {edge.signals.map((signal, i) => (
                          <li key={i} className="text-[11px] leading-4 text-[var(--color-muted)]">
                            <code className="rounded bg-white px-1">{signal.kind}</code> {signal.detail}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div>
      <div className="text-[11px] text-[var(--color-muted)]">{label}</div>
      <div className={`tabular text-base font-semibold ${tone === 'warn' ? 'text-[#b54708]' : ''}`}>{value}</div>
    </div>
  );
}
