import type { AdapterResult, AdapterRowError, AdapterRunReport } from '../contract';
import { applyTransform, coerceDate, coerceNumber } from './coerce';
import type { ColumnSpec, DatasetSpec } from './datasets';
import { getDataset } from './datasets';
import { parseCsv } from './parse';

/**
 * CSV importer.
 *
 * §5.2 constrains this hard: the adapter transforms and nothing else. It does
 * not compute exposure, does not group parties and does not decide anything.
 * It maps columns, coerces values, and reports precisely what it could not
 * read — with the spreadsheet row number, because the person fixing the file is
 * looking at Excel, not at a stack trace.
 */

export interface ColumnMapping {
  canonicalField: string;
  /** Header as it appears in the uploaded file. */
  sourceHeader: string;
  transform?: string;
  transformArg?: string | null;
}

export interface ImportOptions {
  datasetId: string;
  systemId: string;
  /** Explicit mappings win; anything unmapped falls back to alias matching. */
  mappings?: ColumnMapping[];
  dateOrder?: 'dmy' | 'mdy';
  defaultCurrency?: string;
  dataAsOf?: string | null;
  /** Above this, the run is rejected wholesale rather than half-applied. */
  maxRejectRate?: number;
}

export type ImportedRow = Record<string, string | number | null> & { __rowNumber: number };

export interface AutoMapResult {
  mappings: ColumnMapping[];
  unmappedHeaders: string[];
  missingRequired: string[];
}

const norm = (h: string) => h.toLowerCase().replace(/[\s_\-.]/g, '');

/** Header guessing so a first upload usually needs no configuration at all. */
export function autoMapHeaders(spec: DatasetSpec, headers: string[]): AutoMapResult {
  const mappings: ColumnMapping[] = [];
  const used = new Set<string>();

  for (const col of spec.columns) {
    const candidates = new Set([norm(col.canonicalField), ...col.aliases.map(norm)]);
    const hit = headers.find((h) => !used.has(h) && candidates.has(norm(h)));
    if (hit) {
      mappings.push({ canonicalField: col.canonicalField, sourceHeader: hit });
      used.add(hit);
    }
  }

  const mapped = new Set(mappings.map((m) => m.canonicalField));
  return {
    mappings,
    unmappedHeaders: headers.filter((h) => !used.has(h)),
    missingRequired: spec.columns.filter((c) => c.required && !mapped.has(c.canonicalField)).map((c) => c.canonicalField),
  };
}

function coerceValue(
  col: ColumnSpec,
  raw: string,
  rowNumber: number,
  dateOrder: 'dmy' | 'mdy',
  errors: AdapterRowError[],
): string | number | null {
  if (raw === '') {
    if (col.required) {
      errors.push({ rowNumber, column: col.canonicalField, code: 'missing_required', message: `${col.canonicalField} is required` });
    }
    return null;
  }
  switch (col.type) {
    case 'number': {
      const r = coerceNumber(raw);
      if (!r.ok) {
        errors.push({ rowNumber, column: col.canonicalField, code: 'unparseable_number', message: r.reason });
        return null;
      }
      return r.value;
    }
    case 'date': {
      const r = coerceDate(raw, { order: dateOrder });
      if (!r.ok) {
        errors.push({ rowNumber, column: col.canonicalField, code: 'unparseable_date', message: r.reason });
        return null;
      }
      return r.value;
    }
    case 'enum': {
      const v = raw.toLowerCase();
      if (col.enumValues && !col.enumValues.includes(v)) {
        errors.push({
          rowNumber,
          column: col.canonicalField,
          code: 'invalid_value',
          message: `"${raw}" is not one of ${col.enumValues.join(', ')}`,
        });
        return null;
      }
      return v;
    }
    default:
      return raw;
  }
}

export function importCsv(csvText: string, options: ImportOptions): AdapterResult<ImportedRow> {
  const startedAt = new Date().toISOString();
  const spec = getDataset(options.datasetId);
  if (!spec) {
    return {
      rows: [],
      report: {
        adapterId: 'csv',
        datasetId: options.datasetId,
        startedAt,
        finishedAt: new Date().toISOString(),
        rowsRead: 0,
        rowsAccepted: 0,
        rowsRejected: 0,
        dataAsOf: options.dataAsOf ?? null,
        watermark: null,
        errors: [{ rowNumber: 0, column: null, code: 'unknown_entity', message: `unknown dataset "${options.datasetId}"` }],
        warnings: [],
      },
    };
  }

  const parsed = parseCsv(csvText);
  const auto = autoMapHeaders(spec, parsed.headers);
  const mappingByField = new Map<string, ColumnMapping>();
  for (const m of auto.mappings) mappingByField.set(m.canonicalField, m);
  for (const m of options.mappings ?? []) mappingByField.set(m.canonicalField, m);

  const errors: AdapterRowError[] = [];
  const warnings: string[] = [];

  const stillMissing = spec.columns.filter((c) => c.required && !mappingByField.has(c.canonicalField));
  if (stillMissing.length > 0) {
    return {
      rows: [],
      report: {
        adapterId: 'csv',
        datasetId: spec.datasetId,
        startedAt,
        finishedAt: new Date().toISOString(),
        rowsRead: parsed.rows.length,
        rowsAccepted: 0,
        rowsRejected: parsed.rows.length,
        dataAsOf: options.dataAsOf ?? null,
        watermark: null,
        errors: stillMissing.map((c) => ({
          rowNumber: 1,
          column: c.canonicalField,
          code: 'missing_required' as const,
          message: `no column maps to "${c.canonicalField}" — expected one of: ${[c.canonicalField, ...c.aliases].join(', ')}`,
        })),
        warnings,
      },
    };
  }

  if (auto.unmappedHeaders.length > 0) {
    warnings.push(`ignored ${auto.unmappedHeaders.length} unmapped column(s): ${auto.unmappedHeaders.join(', ')}`);
  }

  const dateOrder = options.dateOrder ?? 'dmy';
  const rows: ImportedRow[] = [];
  let rejected = 0;

  for (const rec of parsed.rows) {
    const before = errors.length;
    const out: ImportedRow = { __rowNumber: rec.rowNumber };

    for (const col of spec.columns) {
      const mapping = mappingByField.get(col.canonicalField);
      if (!mapping) {
        out[col.canonicalField] = null;
        continue;
      }
      const rawValue = rec.values[mapping.sourceHeader] ?? '';
      const transformed = mapping.transform
        ? applyTransform(rawValue, mapping.transform, mapping.transformArg ?? null)
        : rawValue;
      out[col.canonicalField] = coerceValue(col, transformed, rec.rowNumber, dateOrder, errors);
    }

    // Defaults applied here rather than in core: they are file-format
    // conveniences, not business rules.
    if (spec.datasetId === 'party' && out.role === null) out.role = 'customer';
    if (spec.datasetId === 'shareholder' && out.holderType === null) out.holderType = 'person';
    if ('currency' in out && (out.currency === null || out.currency === '') && options.defaultCurrency) {
      out.currency = options.defaultCurrency;
    }
    if (spec.datasetId === 'ar_item' && out.amountBase === null) out.amountBase = out.amount ?? null;

    if (errors.length > before) rejected += 1;
    else rows.push(out);
  }

  const rowsRead = parsed.rows.length;
  const rejectRate = rowsRead === 0 ? 0 : rejected / rowsRead;
  const maxRejectRate = options.maxRejectRate ?? 0.1;
  if (rejectRate > maxRejectRate) {
    warnings.push(
      `rejected ${(rejectRate * 100).toFixed(1)}% of rows, above the ${(maxRejectRate * 100).toFixed(0)}% ceiling — ` +
        'the file looks wrong rather than the rows; nothing was applied',
    );
    return {
      rows: [],
      report: {
        adapterId: 'csv',
        datasetId: spec.datasetId,
        startedAt,
        finishedAt: new Date().toISOString(),
        rowsRead,
        rowsAccepted: 0,
        rowsRejected: rowsRead,
        dataAsOf: options.dataAsOf ?? null,
        watermark: null,
        errors,
        warnings,
      },
    };
  }

  const report: AdapterRunReport = {
    adapterId: 'csv',
    datasetId: spec.datasetId,
    startedAt,
    finishedAt: new Date().toISOString(),
    rowsRead,
    rowsAccepted: rows.length,
    rowsRejected: rejected,
    dataAsOf: options.dataAsOf ?? null,
    watermark: null,
    errors,
    warnings,
  };

  return { rows, report };
}
