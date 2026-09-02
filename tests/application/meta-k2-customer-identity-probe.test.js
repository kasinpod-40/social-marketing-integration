import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PROBE = new URL('../../scripts/meta-k2-customer-identity-probe.mjs', import.meta.url);

test('Customer K2 identity probe cannot enter a business-write mode', async () => {
  const source = await readFile(PROBE, 'utf8');

  assert.match(source, /mode:\s*'identity_probe_only'/u);
  assert.doesNotMatch(source, /mode:\s*'write'/u);
  assert.doesNotMatch(source, /mode:\s*'finalize'/u);
  assert.doesNotMatch(source, /sync_work_units/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/u);
  assert.match(source, /sourceUnitPayloadReads:\s*0/u);
  assert.match(source, /providerReads:\s*0/u);
  assert.match(source, /d1Writes:\s*0/u);
  assert.match(source, /larkWrites:\s*0/u);
  assert.match(source, /queueSends:\s*0/u);
});

test('Customer K2 identity probe scans retained cursor candidates instead of retargeting to the current fence', async () => {
  const source = await readFile(PROBE, 'utf8');

  assert.match(source, /const MAX_CANDIDATES = 16/u);
  assert.match(source, /FROM sync_work_runs AS r/u);
  assert.match(source, /WHERE r\.cursor_key='\$\{CURSOR_KEY\}'/u);
  assert.match(source, /ORDER BY r\.generation DESC/u);
  assert.match(source, /LEFT JOIN sync_generation_fences AS f ON f\.cursor_key=r\.cursor_key/u);
  assert.doesNotMatch(source, /FROM sync_generation_fences f\s+JOIN sync_work_runs/u);
  assert.match(source, /lock\.lock_key=r\.cursor_key/u);
});

test('Customer K2 identity probe treats mode-invalid as exact identity proof and exposes only safe state', async () => {
  const source = await readFile(PROBE, 'utf8');

  assert.match(source, /EXPECTED_MODE_INVALID = 'META_K2_LOCAL_LARK_MODE_INVALID'/u);
  assert.match(source, /TARGET_MISMATCH = 'META_K2_LOCAL_LARK_TARGET_MISMATCH'/u);
  assert.match(source, /status:\s*'CUSTOMER_META_K2_IDENTITY_EXACT'/u);
  assert.match(source, /exactTargetState:/u);
  assert.match(source, /currentFence:\s*Number\(row\.is_current_fence\) === 1/u);
  assert.match(source, /unlocked:\s*Number\(row\.active_lock_count\) === 0/u);
  assert.match(source, /safeFieldName\(payload\?\.diagnostic\?\.fieldName\)/u);
  assert.match(source, /\['operationId', 'workKey', 'generation'\]\.includes\(value\)/u);
  assert.match(source, /!\/token\|secret\|authorization\|workKey\|operationId\|generation\/iu/u);
});
