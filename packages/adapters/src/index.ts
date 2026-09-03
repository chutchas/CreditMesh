export * from './contract';
export * from './csv/parse';
export * from './csv/coerce';
export * from './csv/datasets';
export * from './csv/importer';

import type { AdapterCapabilities } from './contract';

/** §5.1 — the CSV adapter's declared capabilities. Read-only, always. */
export const CSV_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  adapterId: 'csv',
  version: '1.0.0',
  entitiesSupported: [
    'party',
    'ar_open_item',
    'ar_cleared_item',
    'credit_limit',
    'financial_statement',
    'purchase_order',
    'collateral',
    'order_block',
    'legal_event',
    'incoming_payment',
    'payment_exception',
  ],
  syncModes: ['full_snapshot'],
  writeSupported: false,
  maxBatchSize: 50_000,
  watermarkField: null,
  // A spreadsheet of receipts usually carries the invoice number the finance
  // team wrote next to it, so the CSV route can reach the highest grain — but
  // only per file. The importer downgrades to receipt_header when the column
  // is absent rather than assuming the best case.
  paymentGrain: 'matched_to_invoice',
};
