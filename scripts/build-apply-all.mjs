#!/usr/bin/env node
/**
 * Concatenates supabase/migrations into supabase/apply-all.sql.
 *
 * The generated file exists for people who are not running the Supabase CLI and
 * paste into the SQL editor instead. It was being maintained by hand, which is
 * how a migration ends up applied on one environment and not the other; this
 * makes it reproducible.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const parts = [
  `-- CreditMesh — all migrations concatenated, in order.
-- Generated from supabase/migrations/ by scripts/build-apply-all.mjs.
-- Paste into the Supabase SQL editor if you are not using the CLI. Running it
-- twice will fail on the CREATE TYPE statements — that is intentional, it is
-- not an idempotent script.
`,
];

for (const file of files) {
  parts.push(`
-- ============================================================
-- migrations/${file}
-- ============================================================

${readFileSync(join(dir, file), 'utf8').trimEnd()}
`);
}

writeFileSync(join(root, 'supabase', 'apply-all.sql'), parts.join(''));
console.log(`apply-all.sql regenerated from ${files.length} migrations`);
