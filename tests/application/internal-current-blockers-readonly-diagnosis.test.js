import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SCRIPT = new URL('../../scripts/internal-current-blockers-readonly-diagnosis.mjs', import.meta.url);

test('internal blocker diagnosis plan is metadata-only and non-mutating', () => {
  const result = spawnSync(process.execPath, [SCRIPT.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'plan');
  assert.equal(payload.status, 'INTERNAL_CURRENT_BLOCKERS_READONLY_DIAGNOSIS_PLAN');
  assert.equal(payload.targetCursorCount, 6);
  assert.equal(payload.payloadReads, 0);
  assert.equal(payload.providerReads, 0);
  assert.equal(payload.d1Writes, 0);
  assert.equal(payload.larkReads, 0);
  assert.equal(payload.larkWrites, 0);
  assert.equal(payload.queueSends, 0);
  assert.equal(payload.customerBaseReads, 0);
  assert.equal(payload.customerBaseWrites, 0);
  assert.equal(payload.persistentConfigWrites, 0);
});

test('internal blocker diagnosis targets only reviewed runtime metadata', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /const CONFIGURED_DATABASE_NAME = 'social-mkt-state-dev'/u);
  assert.match(source, /const TARGET_BINDING = 'MKT_STATE_DB'/u);
  assert.match(source, /scheduled_end_to_end_chemistry_k2/u);
  assert.match(source, /scheduled_end_to_end_chemistry_k3/u);
  assert.match(source, /chatwoot:chemistry_k:analytics/u);
  assert.match(source, /organic_sync/u);
  assert.match(source, /paid_ads_delivery/u);
  assert.match(source, /facebook:chemistry_k:scheduled_end_to_end/u);
  assert.match(source, /sqlite_master/u);
  assert.match(source, /sync_work_phases/u);
  assert.match(source, /dead_letter_jobs/u);
  assert.match(source, /system_alerts/u);
  assert.match(source, /sync_work_units AS u/u);
  assert.doesNotMatch(source, /u\.payload_json/u);
  assert.doesNotMatch(source, /SELECT\s+payload_json/iu);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|PRAGMA)\b[^'"`]*--command/iu);
});

test('internal blocker diagnosis requires schema proof before querying the sole renamed D1', async () => {
  const source = await readFile(SCRIPT, 'utf8');

  assert.match(source, /databases\.length === 1/u);
  assert.match(source, /INTERNAL_BLOCKER_DIAG_SCHEMA_MISMATCH/u);
  assert.match(source, /missingSchema\.length > 0/u);
  assert.match(source, /temporaryConfigUsed:\s*true/u);
  assert.match(source, /persistentConfigChanged:\s*false/u);
  assert.match(source, /await rm\(tempConfigPath, \{ force: true \}\)/u);
});
