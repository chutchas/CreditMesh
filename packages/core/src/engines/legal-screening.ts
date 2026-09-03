import type { LegalScreeningPolicy } from '../tenant/profile';
import type { IsoDate, Uuid } from '../types/canonical';
import { normalizeName, normalizeTaxId, nameSimilarity } from './party-resolution';

/**
 * Module 16 — Legal & Insolvency Screening.
 *
 * The one module where being wrong is worse than being silent. A bankruptcy
 * matched to the wrong company stops that company's orders; matched to the
 * wrong person it is a defamation risk with our evidence panel attached to it.
 *
 * So the rule the whole file is built around: **a name is never a match.** A
 * search result links to a counterparty only when a taxpayer id or registration
 * number agrees. Everything else is a review item addressed to a human, which
 * is what §4.15's `match_rule` and `review_required` mean in code.
 */

export type LegalEventType =
  | 'bankruptcy'
  | 'rehabilitation'
  | 'legal_execution'
  | 'litigation'
  | 'dissolution'
  | 'liquidation'
  | 'status_change';

export type LegalSeverity = 'critical' | 'high' | 'medium' | 'low';

/** How a result came to be attached to a counterparty. Never hidden from view. */
export type MatchBasis = 'tax_id' | 'registration_no' | 'name_only' | 'unmatched';

/** A search result as it arrived, before we decide anything about it. */
export interface LegalSearchResult {
  /** The court, agency or provider reference. Required — §4.15. */
  caseNo: string;
  source: string;
  eventType: LegalEventType;
  subjectType: 'party' | 'person';
  subjectName: string;
  /** Taxpayer id / registration number of the subject, when the source gave one. */
  subjectIdentifier: string | null;
  eventDate: IsoDate | null;
  publishedDate: IsoDate | null;
  court: string | null;
  detail: string | null;
}

export interface ScreeningParty {
  partyId: Uuid;
  legalName: string;
  taxId: string | null;
  registrationNo: string | null;
}

export interface MatchedLegalEvent {
  result: LegalSearchResult;
  partyId: Uuid | null;
  matchBasis: MatchBasis;
  severity: LegalSeverity;
  /** Why this landed where it did, in words a reviewer can check. */
  matchNote: string;
  /** Candidates a human should look at when the identifier did not decide it. */
  nameCandidates: { partyId: Uuid; legalName: string; similarity: number }[];
  /**
   * Always true while `reviewRequired` is on. The platform proposes; nothing
   * downstream may treat a legal event as fact until a person has confirmed it.
   */
  needsReview: boolean;
}

const NAME_CANDIDATE_FLOOR = 0.72;

export function severityFor(eventType: string, policy: LegalScreeningPolicy): LegalSeverity {
  return policy.severityMap[eventType] ?? 'medium';
}

/**
 * Attach one search result to a counterparty, or refuse to.
 *
 * With `requireIdentifierMatch` on — the default, and the setting nobody should
 * turn off — a name similarity of 0.99 still produces `partyId: null`. The
 * near-matches travel with the result as candidates so the reviewer has
 * somewhere to start, but the link is theirs to make, not ours.
 */
export function matchLegalResult(
  result: LegalSearchResult,
  parties: ScreeningParty[],
  policy: LegalScreeningPolicy,
): MatchedLegalEvent {
  const severity = severityFor(result.eventType, policy);
  const identifier = normalizeTaxId(result.subjectIdentifier ?? '');

  if (identifier) {
    const byTaxId = parties.find((p) => p.taxId && normalizeTaxId(p.taxId) === identifier);
    if (byTaxId) {
      return {
        result,
        partyId: byTaxId.partyId,
        matchBasis: 'tax_id',
        severity,
        matchNote: `taxpayer id ${identifier} matches ${byTaxId.legalName}`,
        nameCandidates: [],
        needsReview: policy.reviewRequired,
      };
    }
    const byRegistration = parties.find(
      (p) => p.registrationNo && normalizeTaxId(p.registrationNo) === identifier,
    );
    if (byRegistration) {
      return {
        result,
        partyId: byRegistration.partyId,
        matchBasis: 'registration_no',
        severity,
        matchNote: `registration number ${identifier} matches ${byRegistration.legalName}`,
        nameCandidates: [],
        needsReview: policy.reviewRequired,
      };
    }
  }

  const subject = normalizeName(result.subjectName);
  const nameCandidates = parties
    .map((p) => ({ partyId: p.partyId, legalName: p.legalName, similarity: nameSimilarity(subject, normalizeName(p.legalName)) }))
    .filter((c) => c.similarity >= NAME_CANDIDATE_FLOOR)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  if (!policy.requireIdentifierMatch && nameCandidates.length === 1 && nameCandidates[0]!.similarity >= 0.95) {
    // Only reachable when an organisation has explicitly switched the guard
    // off. Kept honest about what it did: the basis is recorded as name_only,
    // so every downstream screen can tell this link from a verified one.
    return {
      result,
      partyId: nameCandidates[0]!.partyId,
      matchBasis: 'name_only',
      severity,
      matchNote: `matched on name alone (${nameCandidates[0]!.similarity.toFixed(2)}) — identifier matching is switched off`,
      nameCandidates,
      needsReview: true,
    };
  }

  return {
    result,
    partyId: null,
    matchBasis: 'unmatched',
    severity,
    matchNote: identifier
      ? `identifier ${identifier} is not in the register`
      : 'the source gave no identifier — a name is not a match',
    nameCandidates,
    // An unmatched result always needs a human, whatever the policy says about
    // matched ones: somebody has to decide whether it is one of ours.
    needsReview: true,
  };
}

export interface ScreeningDueItem {
  partyId: Uuid;
  legalName: string;
  grade: string | null;
  lastScreenedAt: IsoDate | null;
  dueEveryDays: number;
  daysSinceLastScreening: number | null;
  overdueDays: number;
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / DAY_MS);
}

/**
 * Who is due for a re-screen, worst grades first.
 *
 * A counterparty never screened is due immediately rather than "due in 180
 * days from a date we do not have" — the absence of a screening is not the same
 * as a recent one.
 */
export function screeningDue(
  parties: { partyId: Uuid; legalName: string; grade: string | null; lastScreenedAt: IsoDate | null }[],
  policy: LegalScreeningPolicy,
  asOf: IsoDate,
): ScreeningDueItem[] {
  return parties
    .map((p) => {
      const dueEveryDays =
        (p.grade ? policy.frequencyDaysByGrade[p.grade] : undefined) ?? policy.defaultFrequencyDays;
      const daysSince = p.lastScreenedAt === null ? null : daysBetween(p.lastScreenedAt, asOf);
      const overdueDays = daysSince === null ? dueEveryDays : daysSince - dueEveryDays;
      return {
        partyId: p.partyId,
        legalName: p.legalName,
        grade: p.grade,
        lastScreenedAt: p.lastScreenedAt,
        dueEveryDays,
        daysSinceLastScreening: daysSince,
        overdueDays,
      };
    })
    .filter((i) => i.overdueDays >= 0)
    .sort((a, b) => b.overdueDays - a.overdueDays);
}

export interface LegalScreeningSummary {
  confirmedEvents: number;
  pendingReview: number;
  /** Results nobody could attach to a counterparty. High = a register gap. */
  unmatched: number;
  criticalParties: number;
  partiesWithEvents: number;
  byType: { eventType: string; count: number }[];
  bySeverity: Record<LegalSeverity, number>;
}

export interface StoredLegalEvent {
  partyId: Uuid | null;
  eventType: string;
  severity: LegalSeverity;
  reviewStatus: 'pending' | 'confirmed' | 'rejected';
  matchBasis: MatchBasis;
}

export function summariseLegalScreening(events: StoredLegalEvent[]): LegalScreeningSummary {
  const byType = new Map<string, number>();
  const bySeverity: Record<LegalSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const criticalParties = new Set<Uuid>();
  const partiesWithEvents = new Set<Uuid>();

  for (const e of events) {
    // Rejected events are kept — a rejection is evidence too — but they count
    // for nothing, and a screen that included them would re-raise every false
    // positive a reviewer has already dismissed.
    if (e.reviewStatus === 'rejected') continue;
    byType.set(e.eventType, (byType.get(e.eventType) ?? 0) + 1);
    bySeverity[e.severity] += 1;
    if (e.reviewStatus === 'confirmed' && e.partyId) {
      partiesWithEvents.add(e.partyId);
      if (e.severity === 'critical') criticalParties.add(e.partyId);
    }
  }

  return {
    confirmedEvents: events.filter((e) => e.reviewStatus === 'confirmed').length,
    pendingReview: events.filter((e) => e.reviewStatus === 'pending').length,
    unmatched: events.filter((e) => e.reviewStatus !== 'rejected' && e.partyId === null).length,
    criticalParties: criticalParties.size,
    partiesWithEvents: partiesWithEvents.size,
    byType: [...byType.entries()]
      .map(([eventType, count]) => ({ eventType, count }))
      .sort((a, b) => b.count - a.count),
    bySeverity,
  };
}

/**
 * What may be stored about a natural person, per §4.15 `person_id_storage`.
 *
 * Never the whole number. `last4` is enough for a reviewer to tell two people
 * with the same name apart, which is the only thing it is for.
 */
export function maskPersonIdentifier(
  identifier: string | null,
  mode: LegalScreeningPolicy['personIdStorage'],
): string | null {
  if (!identifier) return null;
  const digits = identifier.replace(/\D/g, '');
  if (mode === 'none' || digits.length === 0) return null;
  if (mode === 'last4') return digits.slice(-4);
  // A stable, non-reversible handle for deduplication. Not cryptographic
  // secrecy — it is here so the same person is recognised across two uploads
  // without the number itself being kept.
  let hash = 0;
  for (let i = 0; i < digits.length; i += 1) hash = (hash * 31 + digits.charCodeAt(i)) | 0;
  return `h${(hash >>> 0).toString(36)}`;
}
