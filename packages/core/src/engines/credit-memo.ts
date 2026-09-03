import type { CurrencyCode, IsoDate, Uuid } from '../types/canonical';

/**
 * Module 4 — Credit Memo Writer.
 *
 * §7 is specific about how this must be positioned, and it is not marketing
 * caution: **it drafts 80%, the analyst's judgement is the rest.** A tool sold
 * as replacing the analyst gets rejected by the analysts who have to use it.
 *
 * That positioning is enforced here rather than left to the copy. This engine
 * assembles what is known and cites where each number came from. It does not
 * write the recommendation, does not propose a limit, and does not conclude
 * anything about whether to lend. Those fields exist, they start empty, and a
 * memo cannot be marked reviewed while they are.
 *
 * The reason is not modesty. A recommendation generated from the same numbers
 * that are printed above it adds no information, and it invites the reader to
 * skip the numbers — the same failure Module 17 guards against.
 */

export interface MemoFact {
  label: string;
  value: string | number | null;
  /** Where this came from, in words: "AR ledger, imported 3 Sep". */
  source: string;
  /** Set when the fact is missing, saying why rather than showing a blank. */
  absent?: string;
}

export interface MemoSection {
  code: string;
  facts: MemoFact[];
  /** Points the assembler noticed that an analyst should address. */
  observations: string[];
}

export interface MemoInputs {
  partyId: Uuid;
  partyName: string;
  taxId: string | null;
  currency: CurrencyCode;
  asOf: IsoDate;

  registry: { legalStatus: string | null; registeredCapital: number | null; registrationDate: IsoDate | null } | null;
  group: { name: string; memberCount: number; totalExposure: number; maxSingleLimit: number | null } | null;
  exposure: { total: number; arOpen: number; arOverdue: number; creditLimit: number | null; maxDpd: number | null };
  paymentBehavior: { avgDaysLate: number | null; onTimePct: number | null; sampleSize: number } | null;
  collateral: { heldValue: number; allocated: number; uncovered: number; nearestExpiry: IsoDate | null } | null;
  financials: {
    fiscalYear: number;
    revenue: number | null;
    netProfit: number | null;
    equity: number | null;
    currentRatio: number | null;
    debtToEquity: number | null;
  } | null;
  riskIndex: { score: number | null; grade: string | null; incomplete: boolean; componentsScored: number; componentsEnabled: number } | null;
  legalEvents: { eventType: string; caseNo: string; eventDate: IsoDate | null; severity: string }[];
  signals: { code: string; reason: string; severity: string }[];
}

export interface CreditMemo {
  partyId: Uuid;
  partyName: string;
  asOf: IsoDate;
  sections: MemoSection[];
  /** Things the analyst must decide. Always empty from here. */
  analystSections: { code: string; prompt: string; content: string }[];
  /** Facts the memo wanted and could not get. Printed, never hidden. */
  gaps: string[];
  completenessPct: number;
}

const ANALYST_PROMPTS: { code: string; prompt: string }[] = [
  { code: 'assessment', prompt: 'Your assessment of the counterparty and the trend behind these numbers' },
  { code: 'limit_proposal', prompt: 'Limit proposed, and the reasoning for that figure' },
  { code: 'conditions', prompt: 'Conditions attached — collateral, review frequency, payment terms' },
  { code: 'recommendation', prompt: 'Your recommendation, and what would change it' },
];

function fact(label: string, value: string | number | null, source: string, absent?: string): MemoFact {
  return value === null || value === undefined ? { label, value: null, source, absent: absent ?? 'not on file' } : { label, value, source };
}

/**
 * Assemble the draft.
 *
 * Every section prints its gaps rather than omitting them. A memo silently
 * missing the financial section reads like a company with unremarkable
 * financials; a memo that says "no statements filed since 2023" reads like what
 * it is, and that difference is the point of the whole exercise.
 */
export function buildCreditMemo(inputs: MemoInputs): CreditMemo {
  const sections: MemoSection[] = [];
  const gaps: string[] = [];

  /* Identity ---------------------------------------------------------- */
  sections.push({
    code: 'identity',
    facts: [
      fact('legal_name', inputs.partyName, 'counterparty register'),
      fact('tax_id', inputs.taxId, 'counterparty register', 'no taxpayer id recorded'),
      fact('legal_status', inputs.registry?.legalStatus ?? null, 'company registry', 'registry profile not imported'),
      fact('registered_capital', inputs.registry?.registeredCapital ?? null, 'company registry'),
      fact('registered_since', inputs.registry?.registrationDate ?? null, 'company registry'),
    ],
    observations:
      inputs.registry === null ? ['No registry profile on file — identity rests on the ERP record alone.'] : [],
  });
  if (!inputs.registry) gaps.push('company registry profile');

  /* Exposure ---------------------------------------------------------- */
  const utilisation =
    inputs.exposure.creditLimit && inputs.exposure.creditLimit > 0
      ? (inputs.exposure.total / inputs.exposure.creditLimit) * 100
      : null;
  const exposureObservations: string[] = [];
  if (inputs.exposure.arOverdue > 0) {
    exposureObservations.push(
      `${inputs.exposure.arOverdue} is past due, the oldest by ${inputs.exposure.maxDpd ?? '?'} days.`,
    );
  }
  if (utilisation !== null && utilisation > 90) {
    exposureObservations.push(`Utilisation is ${utilisation.toFixed(0)}% of the approved limit.`);
  }
  if (inputs.exposure.creditLimit === null) {
    exposureObservations.push('No credit limit is recorded for this counterparty.');
  }
  sections.push({
    code: 'exposure',
    facts: [
      fact('total_exposure', inputs.exposure.total, 'exposure snapshot'),
      fact('ar_open', inputs.exposure.arOpen, 'AR ledger'),
      fact('ar_overdue', inputs.exposure.arOverdue, 'AR ledger'),
      fact('credit_limit', inputs.exposure.creditLimit, 'credit limit register'),
      fact('utilisation_pct', utilisation === null ? null : Math.round(utilisation * 10) / 10, 'derived'),
      fact('max_dpd', inputs.exposure.maxDpd, 'AR ledger'),
    ],
    observations: exposureObservations,
  });

  /* Group ------------------------------------------------------------- */
  if (inputs.group) {
    const observations: string[] = [];
    if (inputs.group.maxSingleLimit !== null && inputs.group.totalExposure > inputs.group.maxSingleLimit) {
      observations.push(
        `Group exposure of ${inputs.group.totalExposure} exceeds the largest single limit approved anywhere in the group (${inputs.group.maxSingleLimit}).`,
      );
    }
    sections.push({
      code: 'group',
      facts: [
        fact('group_name', inputs.group.name, 'group resolution, confirmed'),
        fact('members', inputs.group.memberCount, 'group resolution, confirmed'),
        fact('group_exposure', inputs.group.totalExposure, 'exposure snapshot, summed across members'),
        fact('largest_single_limit', inputs.group.maxSingleLimit, 'credit limit register'),
      ],
      observations,
    });
  } else {
    gaps.push('confirmed corporate group');
  }

  /* Payment behaviour -------------------------------------------------- */
  if (inputs.paymentBehavior && inputs.paymentBehavior.sampleSize > 0) {
    sections.push({
      code: 'payment_behavior',
      facts: [
        fact('avg_days_late', inputs.paymentBehavior.avgDaysLate, 'cleared AR items'),
        fact('on_time_pct', inputs.paymentBehavior.onTimePct, 'cleared AR items'),
        fact('sample_size', inputs.paymentBehavior.sampleSize, 'cleared AR items'),
      ],
      observations:
        inputs.paymentBehavior.sampleSize < 5
          ? [`Only ${inputs.paymentBehavior.sampleSize} settled invoices — too few to read a pattern from.`]
          : [],
    });
  } else {
    gaps.push('settled payment history');
    sections.push({
      code: 'payment_behavior',
      facts: [],
      observations: [
        'No settled invoices on record. That is not the same as paying on time, and it should not be read as such.',
      ],
    });
  }

  /* Collateral --------------------------------------------------------- */
  if (inputs.collateral) {
    const observations: string[] = [];
    if (inputs.collateral.uncovered > 0) {
      observations.push(`${inputs.collateral.uncovered} of exposure has nothing behind it.`);
    }
    if (inputs.collateral.nearestExpiry) {
      observations.push(`Nearest instrument expiry: ${inputs.collateral.nearestExpiry}.`);
    }
    sections.push({
      code: 'collateral',
      facts: [
        fact('held_face_value', inputs.collateral.heldValue, 'collateral register'),
        fact('allocated_here', inputs.collateral.allocated, 'collateral allocations'),
        fact('uncovered_exposure', inputs.collateral.uncovered, 'derived'),
      ],
      observations,
    });
  } else {
    gaps.push('collateral');
  }

  /* Financials --------------------------------------------------------- */
  if (inputs.financials) {
    const age = Number(inputs.asOf.slice(0, 4)) - inputs.financials.fiscalYear;
    const observations: string[] = [];
    if (age >= 2) observations.push(`The most recent statement is for ${inputs.financials.fiscalYear} — ${age} years old.`);
    if ((inputs.financials.equity ?? 0) < 0) observations.push('Equity is negative.');
    sections.push({
      code: 'financials',
      facts: [
        fact('fiscal_year', inputs.financials.fiscalYear, 'filed accounts'),
        fact('revenue', inputs.financials.revenue, 'filed accounts'),
        fact('net_profit', inputs.financials.netProfit, 'filed accounts'),
        fact('equity', inputs.financials.equity, 'filed accounts'),
        fact('current_ratio', inputs.financials.currentRatio, 'derived from filed accounts'),
        fact('debt_to_equity', inputs.financials.debtToEquity, 'derived from filed accounts'),
      ],
      observations,
    });
  } else {
    gaps.push('financial statements');
    sections.push({
      code: 'financials',
      facts: [],
      observations: ['No financial statements on file for this counterparty.'],
    });
  }

  /* Risk index --------------------------------------------------------- */
  if (inputs.riskIndex) {
    sections.push({
      code: 'risk_index',
      facts: [
        fact('score', inputs.riskIndex.score, 'risk index'),
        fact('grade', inputs.riskIndex.grade, 'risk index'),
        fact(
          'components_scored',
          `${inputs.riskIndex.componentsScored}/${inputs.riskIndex.componentsEnabled}`,
          'risk index',
        ),
      ],
      observations: inputs.riskIndex.incomplete
        ? ['This score was computed from incomplete data and should not be compared with a full one.']
        : [],
    });
  }

  /* Legal and signals --------------------------------------------------- */
  sections.push({
    code: 'legal',
    facts: inputs.legalEvents.map((e) =>
      fact(e.eventType, `${e.caseNo}${e.eventDate ? ` (${e.eventDate})` : ''}`, 'legal screening, confirmed'),
    ),
    observations:
      inputs.legalEvents.length === 0
        ? ['No confirmed legal events. Note that absence of a result is not the same as a clean search.']
        : [],
  });

  if (inputs.signals.length > 0) {
    sections.push({
      code: 'signals',
      facts: inputs.signals.map((s) => fact(s.code, s.reason, 'operational signals')),
      observations: [],
    });
  }

  const totalFacts = sections.reduce((s, sec) => s + sec.facts.length, 0);
  const presentFacts = sections.reduce((s, sec) => s + sec.facts.filter((f) => f.value !== null).length, 0);

  return {
    partyId: inputs.partyId,
    partyName: inputs.partyName,
    asOf: inputs.asOf,
    sections,
    // Always empty. The whole positioning of this module lives in this line.
    analystSections: ANALYST_PROMPTS.map((p) => ({ ...p, content: '' })),
    gaps,
    completenessPct: totalFacts === 0 ? 0 : Math.round((presentFacts / totalFacts) * 1000) / 10,
  };
}

/**
 * Whether a draft may be marked reviewed.
 *
 * A memo whose analyst sections are still empty is a printout of the database,
 * not a credit memo, and letting it through review would make the distinction
 * disappear within a month.
 */
export function memoIsReviewable(memo: CreditMemo): { ok: boolean; missing: string[] } {
  const missing = memo.analystSections.filter((s) => s.content.trim().length === 0).map((s) => s.code);
  return { ok: missing.length === 0, missing };
}
