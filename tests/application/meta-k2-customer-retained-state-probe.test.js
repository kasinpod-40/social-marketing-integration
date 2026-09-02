import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PROBE = new URL('../../scripts/meta-k2-customer-retained-state-probe.mjs', import.meta.url);

test('retained K2 state probe is D1 read-only and never requires Preview identity inputs', async () => {
  const source = await readFile(PROBE, 'utf8');

  assert.match(source, /const EXACT_OPERATION_DATE = '20260827'/u);
  assert.match(source, /const EXACT_SOURCE_ITEMS = 194/u);
  assert.match(source, /status:\s*'CUSTOMER_META_K2_20260827_RETAINED_STATE'/u);
  assert.match(source, /previewRequests:\s*0/u);
  assert.doesNotMatch(source, /MKT_META_K2_LARK_PROJECTION_URL/u);
  assert.doesNotMatch(source, /MKT_META_K2_LARK_PROJECTION_TOKEN_FILE/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /sync_work_units/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/u);
  assert.match(source, /providerReads:\s*0/u);
  assert.match(source, /d1Writes:\s*0/u);
  assert.match(source, /larkWrites:\s*0/u);
  assert.match(source, /queueSends:\s*0/u);
});

test('retained K2 state probe identifies the reviewed source-complete operation without following the current fence', async () => {
  const source = await readFile(PROBE, 'utf8');

  assert.match(source, /FROM sync_work_runs AS r/u);
  assert.match(source, /WHERE r\.cursor_key='\$\{CURSOR_KEY\}'/u);
  assert.match(source, /LEFT JOIN sync_generation_fences AS f ON f\.cursor_key=r\.cursor_key/u);
  assert.doesNotMatch(source, /FROM sync_generation_fences f\s+JOIN sync_work_runs/u);
  assert.match(source, /operationId\.endsWith\(EXACT_OPERATION_DATE\)/u);
  assert.match(source, /Number\(row\?\.expected_items\) === EXACT_SOURCE_ITEMS/u);
  assert.match(source, /Number\(row\?\.processed_items\) === EXACT_SOURCE_ITEMS/u);
  assert.match(source, /Number\(row\?\.complete\) === 1/u);
  assert.match(source, /currentFence:\s*Number\(row\.is_current_fence\) === 1/u);
  assert.match(source, /unlocked:\s*Number\(row\.active_lock_count\) === 0/u);
});

test('retained K2 state probe never exposes exact operation identity', async () => {
  const source = await readFile(PROBE, 'utf8');

  assert.match(source, /!\/token\|secret\|authorization\|workKey\|operationId\|generation\/iu/u);
  assert.doesNotMatch(source, /console\.log\([^)]*workKey/u);
  assert.doesNotMatch(source, /console\.log\([^)]*operationId/u);
  assert.doesNotMatch(source, /console\.log\([^)]*generation/u);
});
