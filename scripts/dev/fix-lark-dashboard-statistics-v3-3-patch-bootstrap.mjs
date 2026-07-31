#!/usr/bin/env node

import { readFile, unlink, writeFile } from 'node:fs/promises';

const path = 'scripts/dev/apply-lark-dashboard-statistics-v3-3-patch.mjs';
const source = await readFile(path, 'utf8');
const before = "    process.stdout.write(`${JSON.stringify(probeSummary, null, 2)}\\\\n`);";
const after = "    process.stdout.write(`\\${JSON.stringify(probeSummary, null, 2)}\\\\n`);";
const first = source.indexOf(before);
if (first < 0) throw new Error('Missing v3.3 probe summary literal');
if (source.indexOf(before, first + before.length) >= 0) {
  throw new Error('Non-unique v3.3 probe summary literal');
}
await writeFile(path, `${source.slice(0, first)}${after}${source.slice(first + before.length)}`);
await unlink(new URL(import.meta.url));
process.stdout.write(`${JSON.stringify({
  ok: true,
  decision: 'LARK_DASHBOARD_V3_3_PATCH_BOOTSTRAP_APPLIED',
  temporaryBootstrapDeleted: true,
}, null, 2)}\n`);
