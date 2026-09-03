import type { Evidence, FinancialStatement, IsoDate } from '../types/canonical';

/**
 * Financial Analysis Engine — built once in Module 1 (Portfolio X-ray) and
 * reused unchanged by Module 9 (Supplier Financial Watch) and Module 10 (ECL).
 * That reuse is the reason it takes only the statements and a reference date,
 * and knows nothing about which register the party came from.
 */

export type FlagSeverity = 'critical' | 'high' | 'medium' | 'info';

export interface FinancialFlag {
  code: string;
  severity: FlagSeverity;
  /** Short bilingual label; the UI picks by locale rather than re-deriving. */
  labelTh: string;
  labelEn: string;
  evidence: Evidence[];
}

export interface FinancialRatios {
  fiscalYear: number;
  currentRatio: number | null;
  quickRatio: number | null;
  debtToEquity: number | null;
  netMarginPct: number | null;
  grossMarginPct: number | null;
  returnOnEquityPct: number | null;
  /** Year-over-year, versus the immediately preceding statement only. */
  revenueGrowthPct: number | null;
}

export interface FinancialAnalysis {
  partyId: string;
  /** Newest first. */
  ratios: FinancialRatios[];
  flags: FinancialFlag[];
  latestFiscalYear: number | null;
  yearsSinceLastFiling: number | null;
  hasAnyStatement: boolean;
}

const div = (a: number | null, b: number | null): number | null => {
  if (a === null || b === null) return null;
  if (b === 0) return null;
  return a / b;
};

const pct = (v: number | null): number | null => (v === null ? null : v * 100);

function evidenceFrom(fs: FinancialStatement, code: string, detail?: Record<string, unknown>): Evidence {
  return {
    code,
    sourceRef: `financial_statement:${fs.id}`,
    observedAt: fs.retrievedAt,
    detail: { fiscalYear: fs.fiscalYear, providerId: fs.providerId, ...detail },
  };
}

export function computeRatios(fs: FinancialStatement, previous?: FinancialStatement): FinancialRatios {
  const quickAssets =
    fs.currentAssets === null ? null : fs.currentAssets - (fs.inventory ?? 0);
  return {
    fiscalYear: fs.fiscalYear,
    currentRatio: div(fs.currentAssets, fs.currentLiabilities),
    quickRatio: div(quickAssets, fs.currentLiabilities),
    debtToEquity: fs.equity !== null && fs.equity > 0 ? div(fs.totalLiabilities, fs.equity) : null,
    netMarginPct: pct(div(fs.netProfit, fs.revenue)),
    grossMarginPct: pct(div(fs.grossProfit, fs.revenue)),
    returnOnEquityPct: fs.equity !== null && fs.equity > 0 ? pct(div(fs.netProfit, fs.equity)) : null,
    revenueGrowthPct:
      previous && previous.revenue !== null && previous.revenue > 0 && fs.revenue !== null
        ? ((fs.revenue - previous.revenue) / previous.revenue) * 100
        : null,
  };
}

export interface AnalyseOptions {
  /** Usually today. Injected so the report is reproducible and testable. */
  asOf: IsoDate;
  /** Consecutive loss-making years before the flag fires. Spec §7 M1 says 3. */
  consecutiveLossYears?: number;
  /** Filing gap in years before the flag fires. Spec §7 M1 says 2. */
  staleFilingYears?: number;
  currentRatioFloor?: number;
  debtToEquityCeiling?: number;
}

/**
 * A party with no statements is flagged `no_statement`, not skipped. Silence in
 * a portfolio report reads as "fine", which is exactly backwards for a
 * counterparty nobody has financials on.
 */
export function analyseFinancials(
  partyId: string,
  statements: FinancialStatement[],
  options: AnalyseOptions,
): FinancialAnalysis {
  const {
    asOf,
    consecutiveLossYears = 3,
    staleFilingYears = 2,
    currentRatioFloor = 1,
    debtToEquityCeiling = 3,
  } = options;

  const sorted = [...statements].sort((a, b) => b.fiscalYear - a.fiscalYear);
  const flags: FinancialFlag[] = [];

  if (sorted.length === 0) {
    return {
      partyId,
      ratios: [],
      flags: [
        {
          code: 'no_statement',
          severity: 'high',
          labelTh: 'ไม่มีงบการเงินในระบบ',
          labelEn: 'No financial statement on file',
          evidence: [{ code: 'no_statement', sourceRef: 'enrichment:none', observedAt: `${asOf}T00:00:00Z` }],
        },
      ],
      latestFiscalYear: null,
      yearsSinceLastFiling: null,
      hasAnyStatement: false,
    };
  }

  const ratios = sorted.map((fs, i) => computeRatios(fs, sorted[i + 1]));
  const latest = sorted[0]!;
  const asOfYear = Number(asOf.slice(0, 4));
  const yearsSinceLastFiling = asOfYear - latest.fiscalYear;

  if (yearsSinceLastFiling >= staleFilingYears) {
    flags.push({
      code: 'stale_filing',
      severity: 'high',
      labelTh: `ไม่ส่งงบการเงิน ${yearsSinceLastFiling} ปี`,
      labelEn: `No filing for ${yearsSinceLastFiling} year(s)`,
      evidence: [evidenceFrom(latest, 'stale_filing', { asOf, yearsSinceLastFiling })],
    });
  }

  if (latest.equity !== null && latest.equity < 0) {
    flags.push({
      code: 'negative_equity',
      severity: 'critical',
      labelTh: 'ส่วนของผู้ถือหุ้นติดลบ',
      labelEn: 'Negative shareholders’ equity',
      evidence: [evidenceFrom(latest, 'negative_equity', { equity: latest.equity })],
    });
  }

  // Consecutive losses must start at the most recent year. A loss three years
  // ago followed by two profitable years is a recovery, not a red flag.
  const lossRun: FinancialStatement[] = [];
  for (const fs of sorted) {
    if (fs.netProfit !== null && fs.netProfit < 0) lossRun.push(fs);
    else break;
  }
  if (lossRun.length >= consecutiveLossYears) {
    flags.push({
      code: 'consecutive_losses',
      severity: 'critical',
      labelTh: `ขาดทุนต่อเนื่อง ${lossRun.length} ปี`,
      labelEn: `Loss-making for ${lossRun.length} consecutive years`,
      evidence: lossRun.map((fs) => evidenceFrom(fs, 'consecutive_losses', { netProfit: fs.netProfit })),
    });
  }

  const latestRatios = ratios[0]!;
  if (latestRatios.currentRatio !== null && latestRatios.currentRatio < currentRatioFloor) {
    flags.push({
      code: 'liquidity_below_floor',
      severity: 'high',
      labelTh: `อัตราส่วนสภาพคล่องต่ำกว่า ${currentRatioFloor}`,
      labelEn: `Current ratio below ${currentRatioFloor}`,
      evidence: [evidenceFrom(latest, 'liquidity_below_floor', { currentRatio: latestRatios.currentRatio })],
    });
  }
  if (latestRatios.debtToEquity !== null && latestRatios.debtToEquity > debtToEquityCeiling) {
    flags.push({
      code: 'leverage_above_ceiling',
      severity: 'medium',
      labelTh: `อัตราส่วนหนี้สินต่อทุนสูงกว่า ${debtToEquityCeiling}`,
      labelEn: `Debt-to-equity above ${debtToEquityCeiling}`,
      evidence: [evidenceFrom(latest, 'leverage_above_ceiling', { debtToEquity: latestRatios.debtToEquity })],
    });
  }

  // Two consecutive contractions read differently from one bad year.
  const declines = ratios.slice(0, 2).filter((r) => r.revenueGrowthPct !== null && r.revenueGrowthPct < 0);
  if (declines.length === 2) {
    flags.push({
      code: 'revenue_decline_2y',
      severity: 'medium',
      labelTh: 'รายได้ลดลงติดต่อกัน 2 ปี',
      labelEn: 'Revenue declined two years running',
      evidence: sorted.slice(0, 3).map((fs) => evidenceFrom(fs, 'revenue_decline_2y', { revenue: fs.revenue })),
    });
  }

  return {
    partyId,
    ratios,
    flags,
    latestFiscalYear: latest.fiscalYear,
    yearsSinceLastFiling,
    hasAnyStatement: true,
  };
}

const SEVERITY_RANK: Record<FlagSeverity, number> = { critical: 0, high: 1, medium: 2, info: 3 };

export function worstSeverity(flags: FinancialFlag[]): FlagSeverity | null {
  if (flags.length === 0) return null;
  return [...flags].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0]!.severity;
}
