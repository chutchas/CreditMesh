import type { CollateralDirection, CollateralStatus, CollateralType, Evidence, IsoDate } from '../types/canonical';
import type { TenantProfile } from '../tenant/profile';
import { daysBetween } from './aging';

/**
 * Collateral & Allocation Ledger — Module 3, first phase.
 *
 * The spec is unusually specific about how to introduce this one: start as a
 * read-only register, put the numbers everyone is already using on one screen,
 * and change nobody's process. Only once every entity agrees on what the
 * figures are does the request-and-approve workflow go in. The difficulty here
 * was never technical — it is agreeing who has first claim on a guarantee — and
 * a system that arrives with an answer to that question gets rejected before
 * anyone reads the numbers.
 *
 * So this file computes and explains. It moves nothing.
 */

export interface CollateralRecord {
  id: string;
  partyId: string;
  partyName: string;
  type: CollateralType;
  direction: CollateralDirection;
  reference: string;
  issuer: string | null;
  amount: number;
  currency: string;
  effectiveDate: IsoDate;
  expiryDate: IsoDate | null;
  claimDeadline: IsoDate | null;
  status: CollateralStatus;
}

export interface AllocationRecord {
  collateralId: string;
  legalEntityCode: string;
  allocated: number;
  utilized: number;
  validFrom: IsoDate;
  validTo: IsoDate | null;
}

export interface CollateralBalance {
  collateral: CollateralRecord;
  allocations: AllocationRecord[];
  allocatedTotal: number;
  utilizedTotal: number;
  /** Value not spoken for by any entity. */
  unallocated: number;
  /** Allocated to an entity and never drawn on: a right held and unused. */
  idle: number;
  allocatedPct: number | null;
  isOverAllocated: boolean;
  /** Counts toward coverage: inbound, active, and not past its expiry. */
  isEffective: boolean;
  warnings: CollateralWarning[];
}

export type CollateralWarningCode =
  | 'over_allocated'
  | 'claim_window_closed'
  | 'expired_but_active'
  | 'idle_allocation'
  | 'unallocated';

export interface CollateralWarning {
  code: CollateralWarningCode;
  severity: 'critical' | 'high' | 'medium' | 'info';
  detail: Record<string, unknown>;
}

function allocationIsLive(allocation: AllocationRecord, asOf: IsoDate): boolean {
  if (allocation.validFrom > asOf) return false;
  return allocation.validTo === null || allocation.validTo >= asOf;
}

export interface BalanceOptions {
  asOf: IsoDate;
  allowOverAllocation?: boolean;
  /** Below this share drawn, an allocation is reported as sitting idle. */
  idleThresholdPct?: number;
}

export function computeBalances(
  collaterals: CollateralRecord[],
  allocations: AllocationRecord[],
  options: BalanceOptions,
): CollateralBalance[] {
  const { asOf, allowOverAllocation = false, idleThresholdPct = 5 } = options;

  const byCollateral = new Map<string, AllocationRecord[]>();
  for (const allocation of allocations) {
    if (!allocationIsLive(allocation, asOf)) continue;
    const bucket = byCollateral.get(allocation.collateralId);
    if (bucket) bucket.push(allocation);
    else byCollateral.set(allocation.collateralId, [allocation]);
  }

  return collaterals.map((collateral) => {
    const live = byCollateral.get(collateral.id) ?? [];
    const allocatedTotal = live.reduce((sum, a) => sum + a.allocated, 0);
    const utilizedTotal = live.reduce((sum, a) => sum + a.utilized, 0);
    const unallocated = collateral.amount - allocatedTotal;
    const idle = Math.max(0, allocatedTotal - utilizedTotal);
    const isExpired = collateral.expiryDate !== null && collateral.expiryDate < asOf;
    const warnings: CollateralWarning[] = [];

    if (allocatedTotal > collateral.amount && !allowOverAllocation) {
      warnings.push({
        code: 'over_allocated',
        severity: 'critical',
        detail: { amount: collateral.amount, allocatedTotal, excess: allocatedTotal - collateral.amount },
      });
    }

    // Distinct from expiry on purpose. A guarantee often stays claimable for a
    // window after it expires, and letting that window close on an instrument
    // still carrying exposure is a pure cash loss — the kind nobody discovers
    // until they try to call on it.
    if (collateral.claimDeadline !== null && collateral.claimDeadline < asOf && collateral.status === 'active') {
      warnings.push({
        code: 'claim_window_closed',
        severity: 'critical',
        detail: { claimDeadline: collateral.claimDeadline, asOf },
      });
    }

    if (isExpired && collateral.status === 'active') {
      warnings.push({
        code: 'expired_but_active',
        severity: 'high',
        detail: { expiryDate: collateral.expiryDate, asOf },
      });
    }

    if (allocatedTotal > 0 && (utilizedTotal / allocatedTotal) * 100 < idleThresholdPct) {
      // Not a fault, but the number the spec says organisations cannot answer:
      // how much of what we hold is spoken for and doing nothing.
      warnings.push({
        code: 'idle_allocation',
        severity: 'info',
        detail: { allocatedTotal, utilizedTotal, idle },
      });
    }

    if (unallocated > 0 && collateral.status === 'active' && !isExpired) {
      warnings.push({ code: 'unallocated', severity: 'info', detail: { unallocated } });
    }

    return {
      collateral,
      allocations: live,
      allocatedTotal,
      utilizedTotal,
      unallocated,
      idle,
      allocatedPct: collateral.amount === 0 ? null : (allocatedTotal / collateral.amount) * 100,
      isOverAllocated: allocatedTotal > collateral.amount,
      // Only inbound instruments cover anything. Outbound collateral is what we
      // posted to somebody else — our exposure, not our protection — and adding
      // the two together would overstate coverage by the whole outbound book.
      isEffective:
        collateral.direction === 'inbound' &&
        collateral.status === 'active' &&
        !isExpired &&
        (collateral.claimDeadline === null || collateral.claimDeadline >= asOf),
      warnings,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Expiry                                                              */
/* ------------------------------------------------------------------ */

export interface ExpiryAlert {
  collateralId: string;
  reference: string;
  partyId: string;
  partyName: string;
  expiryDate: IsoDate;
  daysRemaining: number;
  /** The tenant's own alert band this falls into, in days. */
  band: number;
  amount: number;
  allocatedTotal: number;
  currency: string;
}

/**
 * Alerts use the bands in the tenant profile, not a fixed schedule. A group
 * that needs ninety days to renew a bank guarantee and one that needs a
 * fortnight are asking different questions of the same date.
 */
export function buildExpiryAlerts(
  balances: CollateralBalance[],
  profile: TenantProfile,
  asOf: IsoDate,
): ExpiryAlert[] {
  const bands = [...profile.collateralPolicy.expiryAlertDays].sort((a, b) => a - b);
  if (bands.length === 0) return [];
  const widest = bands[bands.length - 1]!;

  const alerts: ExpiryAlert[] = [];
  for (const balance of balances) {
    const { collateral } = balance;
    if (collateral.expiryDate === null) continue;
    if (collateral.status !== 'active') continue;

    const daysRemaining = daysBetween(asOf, collateral.expiryDate);
    if (daysRemaining > widest) continue;

    // Already expired instruments stay in the list, at the tightest band: they
    // are the most urgent thing on the page, not the least.
    const band = bands.find((b) => daysRemaining <= b) ?? bands[0]!;

    alerts.push({
      collateralId: collateral.id,
      reference: collateral.reference,
      partyId: collateral.partyId,
      partyName: collateral.partyName,
      expiryDate: collateral.expiryDate,
      daysRemaining,
      band,
      amount: collateral.amount,
      allocatedTotal: balance.allocatedTotal,
      currency: collateral.currency,
    });
  }

  return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

export interface ExposurePoint {
  partyId: string;
  legalEntityCode: string;
  exposure: number;
}

export interface CoverageRow {
  partyId: string;
  partyName: string;
  legalEntityCode: string;
  exposure: number;
  collateralAllocated: number;
  /** Exposure with nothing behind it. The number that gets budget approved. */
  uncovered: number;
  coveragePct: number | null;
}

/**
 * Coverage is computed per party per legal entity, because that is the grain at
 * which an allocation is actually made. Collapsing to the party would let an
 * unused allocation in one entity appear to protect a balance in another — the
 * exact confusion this ledger exists to remove.
 */
export function computeCoverage(
  exposures: ExposurePoint[],
  balances: CollateralBalance[],
  partyNames: Map<string, string>,
): CoverageRow[] {
  const allocatedByKey = new Map<string, number>();
  for (const balance of balances) {
    if (!balance.isEffective) continue;
    for (const allocation of balance.allocations) {
      const key = `${balance.collateral.partyId}|${allocation.legalEntityCode}`;
      allocatedByKey.set(key, (allocatedByKey.get(key) ?? 0) + allocation.allocated);
    }
  }

  return exposures
    .map((point) => {
      const key = `${point.partyId}|${point.legalEntityCode}`;
      const collateralAllocated = allocatedByKey.get(key) ?? 0;
      return {
        partyId: point.partyId,
        partyName: partyNames.get(point.partyId) ?? point.partyId,
        legalEntityCode: point.legalEntityCode,
        exposure: point.exposure,
        collateralAllocated,
        uncovered: Math.max(0, point.exposure - collateralAllocated),
        coveragePct: point.exposure === 0 ? null : (collateralAllocated / point.exposure) * 100,
      };
    })
    .sort((a, b) => b.uncovered - a.uncovered);
}

export interface CollateralSummary {
  instrumentCount: number;
  totalValue: number;
  allocatedTotal: number;
  utilizedTotal: number;
  unallocatedTotal: number;
  idleTotal: number;
  /** Drawn against what is held. The figure §12 says nobody can answer on the spot. */
  utilizationPct: number | null;
  allocationPct: number | null;
  overAllocatedCount: number;
  claimWindowClosedCount: number;
  totalExposure: number;
  coveredExposure: number;
  uncoveredExposure: number;
  currency: string;
  evidence: Evidence[];
}

export function summariseCollateral(
  balances: CollateralBalance[],
  coverage: CoverageRow[],
  currency: string,
  asOf: IsoDate,
): CollateralSummary {
  const effective = balances.filter((b) => b.isEffective);
  const totalValue = effective.reduce((sum, b) => sum + b.collateral.amount, 0);
  const allocatedTotal = effective.reduce((sum, b) => sum + b.allocatedTotal, 0);
  const utilizedTotal = effective.reduce((sum, b) => sum + b.utilizedTotal, 0);
  const totalExposure = coverage.reduce((sum, c) => sum + c.exposure, 0);
  const uncoveredExposure = coverage.reduce((sum, c) => sum + c.uncovered, 0);

  return {
    instrumentCount: balances.length,
    totalValue,
    allocatedTotal,
    utilizedTotal,
    unallocatedTotal: effective.reduce((sum, b) => sum + Math.max(0, b.unallocated), 0),
    idleTotal: effective.reduce((sum, b) => sum + b.idle, 0),
    utilizationPct: totalValue === 0 ? null : (utilizedTotal / totalValue) * 100,
    allocationPct: totalValue === 0 ? null : (allocatedTotal / totalValue) * 100,
    overAllocatedCount: balances.filter((b) => b.isOverAllocated).length,
    claimWindowClosedCount: balances.filter((b) =>
      b.warnings.some((w) => w.code === 'claim_window_closed'),
    ).length,
    totalExposure,
    coveredExposure: totalExposure - uncoveredExposure,
    uncoveredExposure,
    currency,
    evidence: [
      {
        code: 'collateral_summary',
        sourceRef: `collateral:as_of:${asOf}`,
        observedAt: `${asOf}T00:00:00Z`,
        detail: {
          instrumentsCounted: balances.length,
          instrumentsEffective: effective.length,
          instrumentsExcluded: balances.length - effective.length,
        },
      },
    ],
  };
}
