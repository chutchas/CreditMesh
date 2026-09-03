/**
 * Adapter contract (Spec §5.1–5.2).
 *
 * An adapter declares what it can supply; core switches modules on and off from
 * that declaration rather than guessing. This is what lets an organisation
 * start on file upload and move to an API later without any core change.
 */

export type CanonicalEntity =
  | 'party'
  | 'ar_open_item'
  | 'ar_cleared_item'
  | 'credit_limit'
  | 'sales_order'
  | 'delivery'
  | 'billing'
  | 'order_block'
  | 'purchase_order'
  | 'supplier'
  | 'collateral'
  | 'financial_statement';

export interface AdapterCapabilities {
  adapterId: string;
  version: string;
  entitiesSupported: CanonicalEntity[];
  syncModes: ('full_snapshot' | 'incremental' | 'event')[];
  /** Always false in the first release — P5, read-only. */
  writeSupported: false;
  maxBatchSize: number;
  watermarkField: string | null;
}

/** §5.2 "report your own health" — every run, whether it succeeded or not. */
export interface AdapterRunReport {
  adapterId: string;
  datasetId: string;
  startedAt: string;
  finishedAt: string;
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  /** As-of date of the data itself, which is not the time of the upload. */
  dataAsOf: string | null;
  watermark: string | null;
  errors: AdapterRowError[];
  warnings: string[];
}

export interface AdapterRowError {
  /** 1-based, counting the header, so it matches what the user sees in Excel. */
  rowNumber: number;
  column: string | null;
  code: 'missing_required' | 'unparseable_number' | 'unparseable_date' | 'unknown_entity' | 'invalid_value';
  message: string;
}

export interface AdapterResult<T> {
  rows: T[];
  report: AdapterRunReport;
}

/**
 * §5.2 "fail loudly". A dataset that could not be refreshed must surface as
 * stale on every screen that uses it, not quietly serve yesterday's numbers.
 */
export interface DatasetFreshness {
  datasetId: string;
  lastSuccessAt: string | null;
  dataAsOf: string | null;
  staleAfterHours: number;
  isStale: boolean;
}

export function evaluateFreshness(
  datasetId: string,
  lastSuccessAt: string | null,
  dataAsOf: string | null,
  staleAfterHours: number,
  now: Date = new Date(),
): DatasetFreshness {
  const isStale =
    lastSuccessAt === null ||
    now.getTime() - Date.parse(lastSuccessAt) > staleAfterHours * 3_600_000;
  return { datasetId, lastSuccessAt, dataAsOf, staleAfterHours, isStale };
}
