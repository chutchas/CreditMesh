#!/usr/bin/env node
/**
 * The two design principles that are easy to state and easy to violate, checked
 * mechanically so they are enforced by CI rather than by memory.
 *
 *   P1 — no organisation's own names in source. The spec's own acceptance test:
 *        grep the repo for a customer's name; if it appears outside a fixture,
 *        this is not a product yet.
 *   P2 — core must not know the source system. Vendor and ERP vocabulary lives
 *        in packages/adapters and nowhere else.
 *
 * Run: npm run lint:no-tenant-names
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist-types', 'coverage', '.vercel']);
const CODE_EXT = /\.(ts|tsx|sql|mjs|js|jsx)$/;

/** P2: forbidden anywhere under packages/core. */
const SOURCE_SYSTEM_TOKENS = [
  'sap', 'acdoca', 's/4hana', 's4hana', 'company code', 'company_code',
  'oracle', 'netsuite', 'dynamics 365', 'cds view', 'bapi', 'idoc',
];

/** P1: one name per line; blank lines and `#` comments ignored. */
const DENYLIST_FILE = join(ROOT, 'config', 'tenant-name-denylist.txt');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (CODE_EXT.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];

// ---- P2 -------------------------------------------------------------------
const coreDir = join(ROOT, 'packages', 'core', 'src');
if (existsSync(coreDir)) {
  for (const file of walk(coreDir)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // The principle is stated in prose in several headers; only code counts.
      const stripped = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
      const lower = stripped.toLowerCase();
      for (const token of SOURCE_SYSTEM_TOKENS) {
        if (lower.includes(token)) {
          violations.push({
            principle: 'P2',
            file: relative(ROOT, file),
            line: i + 1,
            detail: `core references the source system: "${token}"`,
          });
        }
      }
    });
  }
}

// ---- P1 -------------------------------------------------------------------
if (existsSync(DENYLIST_FILE)) {
  const names = readFileSync(DENYLIST_FILE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (names.length > 0) {
    const targets = ['apps', 'packages', 'supabase', 'scripts']
      .map((d) => join(ROOT, d))
      .filter(existsSync)
      .flatMap((d) => walk(d));

    for (const file of targets) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const lower = line.toLowerCase();
        for (const name of names) {
          if (lower.includes(name.toLowerCase())) {
            violations.push({
              principle: 'P1',
              file: relative(ROOT, file),
              line: i + 1,
              detail: `organisation-specific name in source: "${name}" — move it to the tenant profile`,
            });
          }
        }
      });
    }
  }
}

if (violations.length === 0) {
  console.log('P1/P2 check passed — core is source-system agnostic and no tenant names are hard-coded.');
  process.exit(0);
}

for (const v of violations) {
  console.error(`${v.principle}  ${v.file}:${v.line}  ${v.detail}`);
}
console.error(`\n${violations.length} violation(s).`);
process.exit(1);
