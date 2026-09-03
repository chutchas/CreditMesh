import type { CurrencyCode, IsoDate, Uuid } from '../types/canonical';

/**
 * Module 6 — Prospect & White Space Finder.
 *
 * Two halves with very different dependencies, and being honest about that is
 * most of the design.
 *
 * **White space** needs nothing outside the platform. It is the question "who
 * buys from entity A and not from entity B", which no single ERP can answer
 * for a group and which this platform already holds the data for. §7 notes it
 * matters most to groups with several lines of business, which is the same
 * profile as the customers this product is for.
 *
 * **Prospecting** needs a company database the platform does not have and will
 * not resell (§3). It runs through the Enrichment Gateway on the tenant's own
 * provider account, and with `manual_upload` — which is what most tenants
 * start on — the candidate list is a file somebody produced. The engine scores
 * whatever list it is given and never pretends to have found the companies.
 *
 * §7's other warning is not technical and is worth repeating in code: a list
 * nobody in sales has agreed to call is a list nobody calls. Every output here
 * carries an owner field for that reason.
 */

export interface CustomerFootprint {
  partyId: Uuid;
  partyName: string;
  /** Entities this counterparty already buys from, with what they spend. */
  entities: { legalEntityCode: string; revenue: number; sinceDate: IsoDate | null }[];
  grade: string | null;
  /** Overdue balance anywhere in the group. A bad payer is not white space. */
  overdueAnywhere: number;
}

export interface WhiteSpaceItem {
  partyId: Uuid;
  partyName: string;
  /** Entities they already buy from. */
  presentIn: string[];
  /** Entities they do not. The opportunity. */
  absentFrom: string[];
  /** What they spend with us today, across the group. */
  currentRevenue: number;
  grade: string | null;
  /** Ordering device, not a revenue forecast. */
  opportunityScore: number;
  /** Reasons a salesperson should not call — stated, not silently filtered. */
  cautions: string[];
}

/**
 * Counterparties buying from some of the group's entities but not others.
 *
 * A customer with an overdue balance is not filtered out; it is listed with the
 * caution attached. Silently hiding them would leave sales wondering why an
 * obvious name is missing, and credit's reason for excluding it is exactly the
 * information sales needs.
 */
export function findWhiteSpace(
  footprints: CustomerFootprint[],
  allEntityCodes: string[],
  options: { minRevenueToRank: number; worstGradeCode: string | null },
): WhiteSpaceItem[] {
  const items: WhiteSpaceItem[] = [];

  for (const f of footprints) {
    const presentIn = f.entities.map((e) => e.legalEntityCode);
    const absentFrom = allEntityCodes.filter((code) => !presentIn.includes(code));
    if (absentFrom.length === 0 || presentIn.length === 0) continue;

    const currentRevenue = f.entities.reduce((s, e) => s + e.revenue, 0);
    const cautions: string[] = [];
    if (f.overdueAnywhere > 0) {
      cautions.push(`${Math.round(f.overdueAnywhere)} past due elsewhere in the group`);
    }
    if (options.worstGradeCode && f.grade === options.worstGradeCode) {
      cautions.push(`on the group's lowest credit grade (${f.grade})`);
    }

    // Spend today × how much of the group they have not met. A customer
    // spending well with one BU and absent from four is the strongest case.
    const reach = absentFrom.length / Math.max(1, allEntityCodes.length - 1);
    const opportunityScore = Math.round(currentRevenue * reach * 100) / 100;

    items.push({
      partyId: f.partyId,
      partyName: f.partyName,
      presentIn,
      absentFrom,
      currentRevenue,
      grade: f.grade,
      opportunityScore: currentRevenue < options.minRevenueToRank ? 0 : opportunityScore,
      cautions,
    });
  }

  return items.sort((a, b) => b.opportunityScore - a.opportunityScore);
}

export interface ProspectCandidate {
  legalName: string;
  taxId: string | null;
  industryCode: string | null;
  registeredCapital: number | null;
  revenue: number | null;
  netProfit: number | null;
  equity: number | null;
  /** Which provider supplied this row. `manual_upload` is normal and honest. */
  providerId: string;
  retrievedAt: IsoDate;
}

export interface ScoredProspect {
  candidate: ProspectCandidate;
  /** 0–100 on financial strength alone. Not a limit and not a recommendation. */
  strengthScore: number | null;
  /** An opening limit to discuss, from the tenant's own rule. Null when unsafe. */
  indicativeLimit: number | null;
  currency: CurrencyCode;
  reasons: string[];
  /** True when this company is already a counterparty somewhere in the group. */
  alreadyKnown: boolean;
}

export interface ProspectOptions {
  currency: CurrencyCode;
  /** Opening limit as a share of annual revenue — the tenant's own rule. */
  limitAsPctOfRevenue: number;
  /** Hard ceiling on any indicative figure, whatever the arithmetic says. */
  maxIndicativeLimit: number;
  /** Taxpayer ids already on the register, so known names are marked. */
  knownTaxIds: Set<string>;
}

/**
 * Score a supplied candidate list.
 *
 * The indicative limit is deliberately conservative and refuses to produce a
 * figure at all where the accounts do not support one. An opening number that
 * turns out to be indefensible costs the credit team more standing than no
 * number at all — and this list is going to sales, who will quote it.
 */
export function scoreProspects(
  candidates: ProspectCandidate[],
  options: ProspectOptions,
): ScoredProspect[] {
  return candidates
    .map((candidate): ScoredProspect => {
      const reasons: string[] = [];
      const alreadyKnown = Boolean(
        candidate.taxId && options.knownTaxIds.has(candidate.taxId.replace(/\D/g, '')),
      );
      if (alreadyKnown) reasons.push('already a counterparty somewhere in the group');

      if (candidate.revenue === null || candidate.equity === null) {
        reasons.push('accounts incomplete — no strength score and no indicative limit');
        return {
          candidate,
          strengthScore: null,
          indicativeLimit: null,
          currency: options.currency,
          reasons,
          alreadyKnown,
        };
      }

      if (candidate.equity <= 0) {
        reasons.push('negative or nil equity');
        return {
          candidate,
          strengthScore: 0,
          indicativeLimit: null,
          currency: options.currency,
          reasons,
          alreadyKnown,
        };
      }

      const margin = candidate.netProfit === null ? null : (candidate.netProfit / candidate.revenue) * 100;
      const equityRatio = (candidate.equity / Math.max(candidate.revenue, 1)) * 100;

      let score = 50;
      if (margin !== null) {
        score += Math.max(-25, Math.min(25, margin * 2.5));
        reasons.push(`net margin ${margin.toFixed(1)}%`);
      }
      score += Math.max(-15, Math.min(25, equityRatio / 2));
      reasons.push(`equity is ${equityRatio.toFixed(0)}% of revenue`);
      const strengthScore = Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;

      const raw = (candidate.revenue * options.limitAsPctOfRevenue) / 100;
      const indicativeLimit =
        strengthScore < 40
          ? null
          : Math.round(Math.min(raw, options.maxIndicativeLimit, candidate.equity));
      if (indicativeLimit === null) reasons.push('strength below the floor for an indicative limit');

      return { candidate, strengthScore, indicativeLimit, currency: options.currency, reasons, alreadyKnown };
    })
    .sort((a, b) => (b.strengthScore ?? -1) - (a.strengthScore ?? -1));
}

export interface WhiteSpaceSummary {
  counterparties: number;
  totalCurrentRevenue: number;
  /** Cross-sell opportunities where credit has no objection. */
  clean: number;
  withCautions: number;
  byEntity: { legalEntityCode: string; absentCount: number; revenueElsewhere: number }[];
}

export function summariseWhiteSpace(items: WhiteSpaceItem[]): WhiteSpaceSummary {
  const byEntity = new Map<string, { absentCount: number; revenueElsewhere: number }>();
  for (const item of items) {
    for (const code of item.absentFrom) {
      const bucket = byEntity.get(code) ?? { absentCount: 0, revenueElsewhere: 0 };
      bucket.absentCount += 1;
      bucket.revenueElsewhere += item.currentRevenue;
      byEntity.set(code, bucket);
    }
  }

  return {
    counterparties: items.length,
    totalCurrentRevenue: Math.round(items.reduce((s, i) => s + i.currentRevenue, 0) * 100) / 100,
    clean: items.filter((i) => i.cautions.length === 0).length,
    withCautions: items.filter((i) => i.cautions.length > 0).length,
    byEntity: [...byEntity.entries()]
      .map(([legalEntityCode, v]) => ({
        legalEntityCode,
        absentCount: v.absentCount,
        revenueElsewhere: Math.round(v.revenueElsewhere * 100) / 100,
      }))
      .sort((a, b) => b.revenueElsewhere - a.revenueElsewhere),
  };
}
