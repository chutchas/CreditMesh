import type { Evidence, PaymentBehavior, RiskComponent } from '../types/canonical';
import type { DelinquencySummary } from './aging';
import type { TenantProfile } from '../tenant/profile';
import { gradeForScore } from '../tenant/profile';
import type { FinancialAnalysis } from './financial-analysis';

/**
 * Risk scoring — P6 above all else.
 *
 * The score is a weighted sum of normalised components, and every component
 * comes back with its raw value, its normalisation and its contribution, so the
 * UI can take the number apart on screen. The person using this signs their
 * name to the decision; a single opaque number is not something they can sign.
 *
 * Weights come from the tenant profile. Components with no data are dropped and
 * the remaining weights are renormalised — scoring a missing input as zero
 * would quietly punish every counterparty the enrichment provider has no file
 * on, which is a data gap, not a risk finding.
 */

export const COMPONENT_CODES = [
  'profitability',
  'liquidity',
  'leverage',
  'equity_strength',
  'filing_currency',
  'payment_behavior',
  'delinquency',
] as const;

export type ComponentCode = (typeof COMPONENT_CODES)[number];

/**
 * Current arrears carry the largest single weight, and deliberately so. A
 * balance sheet describes what a counterparty looked like at a year end that
 * may be years past; an unpaid invoice describes what they are doing to us
 * today. When the two disagree, the invoice is the more recent evidence.
 */
export const DEFAULT_WEIGHTS: Record<ComponentCode, number> = {
  profitability: 0.15,
  liquidity: 0.15,
  leverage: 0.1,
  equity_strength: 0.1,
  filing_currency: 0.1,
  payment_behavior: 0.15,
  delinquency: 0.25,
};

const LABELS: Record<ComponentCode, { th: string; en: string }> = {
  profitability: { th: 'ความสามารถทำกำไร', en: 'Profitability' },
  liquidity: { th: 'สภาพคล่อง', en: 'Liquidity' },
  leverage: { th: 'ภาระหนี้', en: 'Leverage' },
  equity_strength: { th: 'ความแข็งแรงของส่วนทุน', en: 'Equity strength' },
  filing_currency: { th: 'ความสดของงบการเงิน', en: 'Filing currency' },
  payment_behavior: { th: 'พฤติกรรมการชำระ', en: 'Payment behaviour' },
  delinquency: { th: 'ยอดค้างเกินกำหนดปัจจุบัน', en: 'Current arrears' },
};

/** Maps a raw value onto 0..1 where 1 is best, clamped at both ends. */
function ramp(value: number, worst: number, best: number): number {
  if (best === worst) return 0.5;
  const t = (value - worst) / (best - worst);
  return Math.min(1, Math.max(0, t));
}

export interface ScoreInput {
  analysis: FinancialAnalysis;
  paymentBehavior?: PaymentBehavior | null;
  /** Open arrears right now. Omitted only when the party has no receivables. */
  delinquency?: DelinquencySummary | null;
  asOf: string;
}

export interface ScoreResult {
  score: number;
  gradeCode: string | null;
  gradeLabel: string | null;
  gradeColor: string | null;
  components: RiskComponent[];
  /** Components skipped for lack of data — shown, never silently ignored. */
  missingComponents: ComponentCode[];
  evidence: Evidence[];
}

export function scoreParty(profile: TenantProfile, input: ScoreInput): ScoreResult {
  const { analysis, paymentBehavior, delinquency } = input;
  const weights = { ...DEFAULT_WEIGHTS, ...(profile.creditPolicy.scoringWeights as Partial<Record<ComponentCode, number>>) };
  const latest = analysis.ratios[0] ?? null;

  const raw: { code: ComponentCode; value: number | null; normalized: number | null }[] = [
    {
      code: 'profitability',
      value: latest?.netMarginPct ?? null,
      normalized: latest?.netMarginPct != null ? ramp(latest.netMarginPct, -10, 15) : null,
    },
    {
      code: 'liquidity',
      value: latest?.currentRatio ?? null,
      normalized: latest?.currentRatio != null ? ramp(latest.currentRatio, 0.5, 2) : null,
    },
    {
      code: 'leverage',
      // Inverted: higher debt-to-equity is worse, so best sits at the low end.
      value: latest?.debtToEquity ?? null,
      normalized: latest?.debtToEquity != null ? ramp(latest.debtToEquity, 5, 0.5) : null,
    },
    {
      code: 'equity_strength',
      value: latest?.returnOnEquityPct ?? null,
      normalized: latest?.returnOnEquityPct != null ? ramp(latest.returnOnEquityPct, -20, 20) : null,
    },
    {
      code: 'filing_currency',
      value: analysis.yearsSinceLastFiling,
      normalized: analysis.yearsSinceLastFiling != null ? ramp(analysis.yearsSinceLastFiling, 3, 0) : null,
    },
    {
      code: 'payment_behavior',
      value: paymentBehavior?.weightedAvgDpd ?? null,
      normalized: paymentBehavior ? ramp(paymentBehavior.weightedAvgDpd, 60, 0) : null,
    },
    {
      code: 'delinquency',
      // Worst open item, blended with how much of the balance is late: one
      // small stale invoice is not the same as the whole book being overdue.
      value: delinquency?.maxOpenDpd ?? null,
      normalized: delinquency
        ? ramp(delinquency.maxOpenDpd, 90, 0) * 0.7 + ramp(delinquency.overdueSharePct, 100, 0) * 0.3
        : null,
    },
  ];

  const present = raw.filter((r) => r.normalized !== null);
  const missingComponents = raw.filter((r) => r.normalized === null).map((r) => r.code);

  const weightTotal = present.reduce((sum, r) => sum + (weights[r.code] ?? 0), 0);
  const components: RiskComponent[] = present.map((r) => {
    const effectiveWeight = weightTotal === 0 ? 0 : (weights[r.code] ?? 0) / weightTotal;
    return {
      code: r.code,
      label: profile.identity.locale === 'en-US' ? LABELS[r.code].en : LABELS[r.code].th,
      rawValue: r.value,
      normalized: r.normalized!,
      weight: effectiveWeight,
      contribution: r.normalized! * effectiveWeight * 100,
    };
  });

  const score = Math.round(components.reduce((sum, c) => sum + c.contribution, 0) * 10) / 10;
  const grade = gradeForScore(profile, score);

  const evidence: Evidence[] = [
    ...analysis.flags.flatMap((f) => f.evidence),
    ...(delinquency
      ? [
          {
            code: 'delinquency',
            sourceRef: `ar_item:open:${input.asOf}`,
            observedAt: `${input.asOf}T00:00:00Z`,
            detail: {
              maxOpenDpd: delinquency.maxOpenDpd,
              openOverdue: delinquency.openOverdue,
              overdueSharePct: Math.round(delinquency.overdueSharePct * 10) / 10,
              overdueItemCount: delinquency.overdueItemCount,
            },
          } satisfies Evidence,
        ]
      : []),
    ...(paymentBehavior
      ? [
          {
            code: 'payment_behavior',
            sourceRef: `payment_behavior:${paymentBehavior.partyId}:${paymentBehavior.periodEnd}`,
            observedAt: `${paymentBehavior.periodEnd}T00:00:00Z`,
            detail: {
              weightedAvgDpd: paymentBehavior.weightedAvgDpd,
              invoiceCount: paymentBehavior.invoiceCount,
            },
          } satisfies Evidence,
        ]
      : []),
  ];

  return {
    score,
    gradeCode: grade?.code ?? null,
    gradeLabel: grade?.label ?? null,
    gradeColor: grade?.color ?? null,
    components,
    missingComponents,
    evidence,
  };
}
