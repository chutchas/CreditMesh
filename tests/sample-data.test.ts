import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importCsv, suggestDatasets } from '@creditmesh/adapters';

/**
 * Every sample CSV must parse cleanly under the dataset it is named for.
 *
 * This is not a test of the parser — that has its own. It is a test of the
 * eighteen datasets against the files the README tells a new organisation to
 * upload first, in order. A column spec that drifts away from its sample file
 * produces a first-run experience of rejected rows, which is the one
 * impression that cannot be repaired later.
 */
const SAMPLES = join(__dirname, '..', 'docs', 'samples');

const files = readdirSync(SAMPLES).filter((f) => f.endsWith('.csv'));

describe('sample data', () => {
  it('covers every file with a dataset of the same name', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const datasetId = file.replace(/\.csv$/, '');

    it(`${file} imports with no rejected rows`, () => {
      const text = readFileSync(join(SAMPLES, file), 'utf8');
      const result = importCsv(text, { datasetId, systemId: 'csv', maxRejectRate: 0 });

      // A rejected row here means a column spec and its own sample disagree.
      expect(result.report.rowsRejected, JSON.stringify(result.report.errors?.slice(0, 3))).toBe(0);
      expect(result.report.rowsAccepted).toBeGreaterThan(0);
      expect(result.report.rowsAccepted).toBe(result.report.rowsRead);
    });

    it(`${file} is recognised as the ${datasetId} dataset from its headers alone`, () => {
      const text = readFileSync(join(SAMPLES, file), 'utf8');
      const headers = text.split(/\r?\n/)[0]!.split(',').map((h) => h.replace(/^"|"$/g, ''));
      const suggestions = suggestDatasets(headers);
      // Header auto-detection is what saves a new user from picking the wrong
      // dataset and reading "no column maps to personName" with no idea why.
      expect(suggestions.map((s) => s.datasetId)).toContain(datasetId);
    });
  }
});
