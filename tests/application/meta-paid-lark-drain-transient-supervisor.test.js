import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourcePath = 'scripts/meta-paid-lark-drain-transient-supervisor.mjs';

test('transient supervisor retries only bounded pre-closeout D1 transient failures', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /const MAX_ATTEMPTS = 6/u);
  assert.match(source, /RETRY_DELAYS_MS = Object\.freeze\(\[5_000, 10_000, 20_000, 30_000, 30_000\]\)/u);
  assert.match(source, /transient-read-retry-scheduled/u);
  assert.match(source, /META_PAID_LARK_TRANSIENT_SUPERVISOR_RETRY_EXHAUSTED/u);
});

test('transient supervisor recognizes Cloudflare D1 7500 and transport failures but not 7404', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /7500/u);
  assert.match(source, /internal error; reference/u);
  assert.match(source, /ECONNRESET/u);
  assert.match(source, /ETIMEDOUT/u);
  assert.match(source, /EAI_AGAIN/u);
  assert.match(source, /ENETUNREACH/u);
  assert.doesNotMatch(source, /7404/u);
});

test('transient supervisor blocks every automatic retry after closeout evidence', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /if \(closeoutLaunched\)[\s\S]*automatic retry is blocked/u);
  assert.match(source, /launch_existing_closeout\|private-safe-config-materialized\|META_PAID_LARK_CLOSEOUT_COMPLETED_SAFE/u);
  assert.match(source, /META_PAID_LARK_TRANSIENT_SUPERVISOR_CLOSEOUT_STARTED/u);
});

test('transient supervisor delegates to existing queryable entry and contains no direct mutation command', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /scripts\/meta-paid-lark-drain-queryable-entry\.mjs/u);
  assert.doesNotMatch(source, /wrangler['",\s]+deploy/iu);
  assert.doesNotMatch(source, /['"`]\s*(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/iu);
  assert.doesNotMatch(source, /\.send\s*\(/u);
  assert.match(source, /directRemoteMutationPerformed:\s*false/u);
});
