import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourcePath = 'scripts/meta-paid-lark-drain-queryable-entry.mjs';

test('queryable entry removes database_id and verifies exact name-resolved SELECT 1 before drain', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /materializeNameResolvedD1Config/u);
  assert.match(source, /databaseIdRemovedFromTemporaryConfig:\s*true/u);
  assert.match(source, /'d1', 'execute', 'MKT_STATE_DB'/u);
  assert.match(source, /SELECT 1 AS meta_paid_lark_d1_probe/u);
  assert.match(source, /await proveQueryable\(runtimeEnv, temporaryConfigPath\)/u);
  assert.match(source, /meta-paid-lark-drain-closeout-supervised\.mjs/u);
  assert.doesNotMatch(source, /'d1', 'list'/u);
});

test('queryable entry preserves source config and uses a private temporary config', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /mkdtemp\(join\(tmpdir\(\), 'meta-paid-lark-queryable-d1-'\)\)/u);
  assert.match(source, /writeFile\(temporaryConfigPath, materialized\.text, \{ mode: 0o600 \}\)/u);
  assert.match(source, /chmod\(temporaryConfigPath, 0o600\)/u);
  assert.match(source, /MKT_META_D1_ONLY_WRANGLER_CONFIG:\s*temporaryConfigPath/u);
  assert.doesNotMatch(source, /writeFile\(sourceConfigPath/u);
});

test('queryable entry retries only pre-closeout read failures and blocks after closeout evidence', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /const MAX_ATTEMPTS = 3/u);
  assert.match(source, /META_PAID_LARK_DRAIN_COMMAND_FAILED/u);
  assert.match(source, /if \(closeoutLaunched\)[\s\S]*retry is blocked/u);
  assert.match(source, /launch_existing_closeout\|private-safe-config-materialized\|META_PAID_LARK_CLOSEOUT_COMPLETED_SAFE/u);
  assert.match(source, /META_PAID_LARK_QUERYABLE_RETRY_EXHAUSTED/u);
});

test('queryable entry adds no direct mutation command', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.doesNotMatch(source, /wrangler['",\s]+deploy/iu);
  assert.doesNotMatch(source, /\.send\s*\(/u);
  assert.doesNotMatch(source, /['"`]\s*(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/iu);
  assert.match(source, /directRemoteMutationPerformed:\s*false/u);
});
