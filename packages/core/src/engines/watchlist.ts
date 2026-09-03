import type { NotificationPolicy } from '../tenant/profile';
import type { IsoDate, IsoTimestamp, Uuid } from '../types/canonical';

/**
 * Module 5 — Watchlist & Signal.
 *
 * The detection is trivial: compare two snapshots. The module's whole
 * difficulty is restraint. §7 is explicit that too many alerts get the feature
 * switched off inside two weeks and never switched back on, so this engine's
 * main job is deciding what NOT to raise.
 *
 * The test applied to every change below: **would a credit officer do something
 * differently today because of it?** A registered capital increase is
 * interesting and changes nothing. A capital decrease changes what stands
 * behind the limit. Only the second one is an alert; the first is a line in the
 * weekly digest.
 *
 * The second job is spreading. A signal about one company reaches every entity
 * with exposure to that company's group, because §1's opening complaint is that
 * one BU gets burned while another keeps shipping.
 *
 * Boundary with Module 12, which must stay sharp: this says who is risky;
 * the collection workbench says who to call today.
 */

export type ChangeCode =
  | 'legal_status_change'
  | 'capital_decrease'
  | 'capital_increase'
  | 'address_change'
  | 'director_change'
  | 'industry_change'
  | 'grade_drop'
  | 'grade_rise'
  | 'exposure_jump'
  | 'first_overdue'
  | 'filing_overdue';

export interface RegistrySnapshot {
  legalStatus: string | null;
  registeredCapital: number | null;
  registeredAddress: string | null;
  industryCode: string | null;
  directorNames: string[];
  capturedAt: IsoTimestamp;
}

export interface DetectedChange {
  partyId: Uuid;
  partyName: string;
  code: ChangeCode;
  /** True when a person should look at this today. False = digest material. */
  actionable: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
  before: string | number | null;
  after: string | number | null;
  detail: string;
  observedAt: IsoDate;
}

/**
 * Statuses that mean the company is no longer trading normally.
 *
 * Kept as a list of *normal* statuses rather than abnormal ones: registries
 * invent new words for trouble faster than we can enumerate them, and an
 * unrecognised status should raise a question, not pass silently.
 */
const NORMAL_STATUSES = ['active', 'ปกติ', 'ดำเนินกิจการอยู่', 'registered', 'operating'];

function isNormalStatus(status: string | null): boolean {
  if (!status) return true;
  return NORMAL_STATUSES.some((s) => status.toLowerCase().includes(s.toLowerCase()));
}

export function detectRegistryChanges(
  partyId: Uuid,
  partyName: string,
  before: RegistrySnapshot | null,
  after: RegistrySnapshot,
  observedAt: IsoDate,
): DetectedChange[] {
  // No previous snapshot is not a change. Reporting the first import of a
  // company as "director changed" is how the first week produces 400 alerts.
  if (!before) return [];

  const changes: DetectedChange[] = [];

  if (before.legalStatus !== after.legalStatus) {
    const stillNormal = isNormalStatus(after.legalStatus);
    changes.push({
      partyId,
      partyName,
      code: 'legal_status_change',
      actionable: !stillNormal,
      severity: stillNormal ? 'low' : 'critical',
      before: before.legalStatus,
      after: after.legalStatus,
      detail: stillNormal
        ? 'registry status changed but still reads as trading'
        : `registry status is now "${after.legalStatus}"`,
      observedAt,
    });
  }

  if (
    before.registeredCapital !== null &&
    after.registeredCapital !== null &&
    before.registeredCapital !== after.registeredCapital
  ) {
    const decreased = after.registeredCapital < before.registeredCapital;
    changes.push({
      partyId,
      partyName,
      code: decreased ? 'capital_decrease' : 'capital_increase',
      // A capital increase is interesting and changes nothing anybody does
      // today. A decrease changes what stands behind the limit.
      actionable: decreased,
      severity: decreased ? 'high' : 'low',
      before: before.registeredCapital,
      after: after.registeredCapital,
      detail: decreased
        ? `registered capital fell from ${before.registeredCapital} to ${after.registeredCapital}`
        : `registered capital rose to ${after.registeredCapital}`,
      observedAt,
    });
  }

  const beforeDirectors = new Set(before.directorNames.map((d) => d.trim()).filter(Boolean));
  const afterDirectors = new Set(after.directorNames.map((d) => d.trim()).filter(Boolean));
  const departed = [...beforeDirectors].filter((d) => !afterDirectors.has(d));
  const arrived = [...afterDirectors].filter((d) => !beforeDirectors.has(d));
  if (departed.length > 0 || arrived.length > 0) {
    // A whole board leaving at once is a different event from one director
    // rotating out, and only the first is worth interrupting someone for.
    const wholesale = beforeDirectors.size > 0 && departed.length >= beforeDirectors.size;
    changes.push({
      partyId,
      partyName,
      code: 'director_change',
      actionable: wholesale,
      severity: wholesale ? 'high' : 'low',
      before: [...beforeDirectors].join(', ') || null,
      after: [...afterDirectors].join(', ') || null,
      detail: wholesale
        ? 'every director on record has been replaced'
        : `${arrived.length} joined, ${departed.length} left`,
      observedAt,
    });
  }

  if (before.registeredAddress !== after.registeredAddress && after.registeredAddress) {
    changes.push({
      partyId,
      partyName,
      code: 'address_change',
      // Companies move offices. On its own this is digest material; it matters
      // as corroboration inside group resolution, not as an alert.
      actionable: false,
      severity: 'low',
      before: before.registeredAddress,
      after: after.registeredAddress,
      detail: 'registered address changed',
      observedAt,
    });
  }

  if (before.industryCode !== after.industryCode && after.industryCode) {
    changes.push({
      partyId,
      partyName,
      code: 'industry_change',
      actionable: false,
      severity: 'low',
      before: before.industryCode,
      after: after.industryCode,
      detail: 'registered industry classification changed',
      observedAt,
    });
  }

  return changes;
}

export interface GradeMove {
  partyId: Uuid;
  partyName: string;
  previousGrade: string | null;
  currentGrade: string | null;
  previousScore: number | null;
  currentScore: number | null;
}

/**
 * Grade movements worth raising.
 *
 * A drop of one band is noise on a score that moves with every import; two is
 * a change in the organisation's own opinion of the counterparty. An
 * improvement is never an alert — nobody needs to act on good news the same
 * day.
 */
export function detectGradeMoves(
  moves: GradeMove[],
  gradeRank: Map<string, number>,
  observedAt: IsoDate,
  dropBandsForAlert = 2,
): DetectedChange[] {
  const changes: DetectedChange[] = [];
  for (const m of moves) {
    if (!m.previousGrade || !m.currentGrade || m.previousGrade === m.currentGrade) continue;
    const before = gradeRank.get(m.previousGrade);
    const after = gradeRank.get(m.currentGrade);
    if (before === undefined || after === undefined) continue;
    const bands = after - before;
    if (bands > 0) {
      changes.push({
        partyId: m.partyId,
        partyName: m.partyName,
        code: 'grade_drop',
        actionable: bands >= dropBandsForAlert,
        severity: bands >= dropBandsForAlert ? 'high' : 'medium',
        before: m.previousGrade,
        after: m.currentGrade,
        detail: `grade fell ${bands} band${bands > 1 ? 's' : ''}, ${m.previousScore ?? '—'} → ${m.currentScore ?? '—'}`,
        observedAt,
      });
    } else {
      changes.push({
        partyId: m.partyId,
        partyName: m.partyName,
        code: 'grade_rise',
        actionable: false,
        severity: 'low',
        before: m.previousGrade,
        after: m.currentGrade,
        detail: `grade improved to ${m.currentGrade}`,
        observedAt,
      });
    }
  }
  return changes;
}

export interface GroupSpread {
  change: DetectedChange;
  /** Every entity holding exposure to any member of this party's group. */
  affectedEntities: { legalEntityCode: string; partyId: Uuid; partyName: string; exposure: number }[];
  totalGroupExposure: number;
}

/**
 * Push one company's signal out to everyone exposed to its group.
 *
 * This is §1's opening complaint answered directly: one BU gets burned while
 * another keeps shipping, because the signal never crossed the boundary.
 *
 * Only confirmed groups spread. An unconfirmed proposal must not cause an
 * alert against a company nobody has agreed is related — the same rule that
 * stops a proposed group from affecting a limit.
 */
export function spreadAcrossGroup(
  change: DetectedChange,
  confirmedGroupMembers: Map<Uuid, Uuid[]>,
  exposures: { partyId: Uuid; partyName: string; legalEntityCode: string; exposure: number }[],
): GroupSpread {
  const members = confirmedGroupMembers.get(change.partyId) ?? [change.partyId];
  const memberSet = new Set(members);
  const affected = exposures
    .filter((e) => memberSet.has(e.partyId) && e.exposure > 0)
    .sort((a, b) => b.exposure - a.exposure);

  return {
    change,
    affectedEntities: affected,
    totalGroupExposure: Math.round(affected.reduce((s, e) => s + e.exposure, 0) * 100) / 100,
  };
}

export interface AlertBudget {
  /** Alerts raised. */
  raised: DetectedChange[];
  /** Real changes deliberately held back to the digest. */
  digest: DetectedChange[];
  /** Actionable changes dropped because the day's budget was spent. */
  deferred: DetectedChange[];
}

/**
 * Enforce a daily alert budget.
 *
 * §7's warning is that volume, not accuracy, is what kills this module. When
 * more actionable changes arrive than the budget allows, the overflow is
 * deferred rather than sent — and reported as deferred, so nobody believes a
 * quiet inbox means a quiet day. A silently truncated alert list would be the
 * worse failure of the two.
 */
export function applyAlertBudget(changes: DetectedChange[], maxPerRun = 25): AlertBudget {
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const actionable = changes
    .filter((c) => c.actionable)
    .sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    raised: actionable.slice(0, maxPerRun),
    digest: changes.filter((c) => !c.actionable),
    deferred: actionable.slice(maxPerRun),
  };
}

export interface DigestLine {
  code: ChangeCode;
  count: number;
  parties: string[];
}

export function weeklyDigest(changes: DetectedChange[]): DigestLine[] {
  const byCode = new Map<ChangeCode, Set<string>>();
  for (const c of changes) {
    const bucket = byCode.get(c.code) ?? new Set<string>();
    bucket.add(c.partyName);
    byCode.set(c.code, bucket);
  }
  return [...byCode.entries()]
    .map(([code, parties]) => ({ code, count: parties.size, parties: [...parties].slice(0, 10) }))
    .sort((a, b) => b.count - a.count);
}

/**
 * What may leave the building, per §4.9 `detailLevel`.
 *
 * `link_only` exists because some organisations forbid counterparty data in
 * chat apps entirely, and a product that only discovers this at rollout has to
 * rebuild its notification layer. The rule is applied here rather than at each
 * channel so no channel can forget it.
 */
export function renderNotification(
  change: DetectedChange,
  policy: NotificationPolicy,
  linkBase: string,
): string {
  const link = `${linkBase}/parties/${change.partyId}`;
  if (policy.detailLevel === 'link_only') return `CreditMesh: a counterparty needs review — ${link}`;
  if (policy.detailLevel === 'summary') return `${change.partyName}: ${change.code} — ${link}`;
  return `${change.partyName}: ${change.detail} (${String(change.before)} → ${String(change.after)}) — ${link}`;
}
