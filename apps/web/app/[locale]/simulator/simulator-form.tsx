'use client';

import { useMemo, useState } from 'react';
import { simulateTermChange, upliftSensitivity, type TermScenarioInput } from '@creditmesh/core';
import type { Locale } from '../../../lib/i18n/config';
import type { Dictionary } from '../../../lib/i18n/dictionaries';
import { formatMoney, formatPercent } from '../../../lib/format';

type Labels = Dictionary['simulator'];

const INITIAL: TermScenarioInput = {
  currentAnnualRevenue: 500_000_000,
  currentTermDays: 30,
  proposedTermDays: 60,
  grossMarginRate: 0.18,
  costOfCapitalRate: 0.06,
  expectedRevenueUpliftRate: 0.05,
  currentBadDebtRate: 0.004,
  proposedBadDebtRate: 0.006,
};

function Field({
  label,
  value,
  onChange,
  suffix,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs text-[var(--color-muted)]">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="tabular w-full rounded border border-[var(--color-line)] px-2 py-1.5 text-right"
        />
        {suffix ? <span className="text-xs text-[var(--color-muted)]">{suffix}</span> : null}
      </span>
    </label>
  );
}

export default function SimulatorForm({
  locale,
  currency,
  labels,
}: {
  locale: Locale;
  currency: string;
  labels: Labels;
}) {
  const [input, setInput] = useState<TermScenarioInput>(INITIAL);
  const set = <K extends keyof TermScenarioInput>(key: K) => (v: number) =>
    setInput((prev) => ({ ...prev, [key]: v }));

  // The model is a pure function in core, so it runs in the browser and the
  // numbers move as the assumptions are typed — which is the point of using it
  // live in a meeting with sales.
  const result = useMemo(() => simulateTermChange(input), [input]);
  const sensitivity = useMemo(
    () => upliftSensitivity(input, [0, 0.025, 0.05, 0.075, 0.1, 0.15]),
    [input],
  );

  const money = (n: number) => formatMoney(n, currency, locale, { compact: true });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
      <section className="rounded-lg border border-[var(--color-line)] bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">{labels.assumptions}</h2>
        <div className="space-y-3">
          <Field label={labels.currentRevenue} value={input.currentAnnualRevenue} onChange={set('currentAnnualRevenue')} step={1_000_000} suffix={currency} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={labels.currentTerms} value={input.currentTermDays} onChange={set('currentTermDays')} suffix={labels.days} />
            <Field label={labels.proposedTerms} value={input.proposedTermDays} onChange={set('proposedTermDays')} suffix={labels.days} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={labels.grossMargin} value={input.grossMarginRate * 100} onChange={(v) => set('grossMarginRate')(v / 100)} step={0.5} suffix="%" />
            <Field label={labels.costOfCapital} value={input.costOfCapitalRate * 100} onChange={(v) => set('costOfCapitalRate')(v / 100)} step={0.25} suffix="%" />
          </div>
          <Field label={labels.expectedUplift} value={input.expectedRevenueUpliftRate * 100} onChange={(v) => set('expectedRevenueUpliftRate')(v / 100)} step={0.5} suffix="%" />
          <div className="grid grid-cols-2 gap-3">
            <Field label={labels.currentBadDebt} value={input.currentBadDebtRate * 100} onChange={(v) => set('currentBadDebtRate')(v / 100)} step={0.05} suffix="%" />
            <Field label={labels.proposedBadDebt} value={input.proposedBadDebtRate * 100} onChange={(v) => set('proposedBadDebtRate')(v / 100)} step={0.05} suffix="%" />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div
          className={`rounded-lg border p-5 ${result.delta.netImpact >= 0 ? 'border-[#abdfb8] bg-[#f0fdf4]' : 'border-[#f5c2c0] bg-[#fef3f2]'}`}
        >
          <div className="text-xs text-[var(--color-muted)]">{labels.netImpact}</div>
          <div className={`tabular mt-1 text-3xl font-semibold ${result.delta.netImpact >= 0 ? 'text-[#1a7f37]' : 'text-[#b42318]'}`}>
            {money(result.delta.netImpact)}
          </div>
          <div className="mt-2 text-sm">
            {result.breakEvenUpliftRate === null ? (
              <span className="text-[#b42318]">{labels.notViable}</span>
            ) : (
              <>
                {labels.breakEven}: <strong className="tabular">{formatPercent(result.breakEvenUpliftRate * 100, locale, 1)}</strong>
                {result.viableAtAssumedUplift ? <span className="ml-2 text-[#1a7f37]">· {labels.viable}</span> : null}
              </>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: labels.grossProfitGain, value: result.delta.grossProfit, good: true },
            { label: labels.carryingCost, value: -result.delta.carryingCost, good: false },
            { label: labels.badDebtCost, value: -result.delta.badDebtCost, good: false },
            { label: labels.cashImpact, value: result.cashFlowImpact, good: false },
          ].map((tile) => (
            <div key={tile.label} className="rounded-lg border border-[var(--color-line)] bg-white p-4">
              <div className="text-xs text-[var(--color-muted)]">{tile.label}</div>
              <div className={`tabular mt-1 text-xl font-semibold ${tile.value < 0 ? 'text-[#b42318]' : ''}`}>{money(tile.value)}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-[var(--color-line)] bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">{labels.sensitivity}</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-[var(--color-muted)]">
              <tr>
                <th className="py-1 font-medium">{labels.upliftLevel}</th>
                <th className="py-1 text-right font-medium">{labels.netImpact}</th>
              </tr>
            </thead>
            <tbody>
              {sensitivity.map((row) => (
                <tr key={row.upliftRate} className="border-t border-[var(--color-line)]">
                  <td className="tabular py-1.5">{formatPercent(row.upliftRate * 100, locale, 1)}</td>
                  <td className={`tabular py-1.5 text-right ${row.netImpact < 0 ? 'text-[#b42318]' : 'text-[#1a7f37]'}`}>
                    {money(row.netImpact)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            {labels.extraReceivables}: <span className="tabular">{money(result.delta.receivablesBalance)}</span>
          </p>
        </div>
      </section>
    </div>
  );
}
