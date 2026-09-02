import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertMetaK2RetainedTargetRow } from '../../apps/sync-worker/src/meta-k2-local-lark-projection-http.js';

const FINALIZER = new URL('../../scripts/meta-k2-customer-local-finalizer.mjs', import.meta.url);
const OPERATION = Object.freeze({
  workKey: 'meta_ads:chemistry_k2:meta-ads-chemistry-k2-scheduled-20260827',
  generation: 1_787_938_203_000,
});

function row(overrides = {}) {
  return {
    work_key: OPERATION.workKey,
    generation: OPERATION.generation,
    lifecycle_status: 'active',
    terminal_reason: null,
    source_stage: 'complete',
    source_complete: 1,
    source_expected_items: 194,
    source_processed_items: 194,
    active_lock_count: 0,
    ...overrides,
  };
}

test('Preview target guard accepts the exact active unlocked source-complete retained K2 Work', () => {
  assert.equal(assertMetaK2RetainedTargetRow(row(), OPERATION), true);
});

test('Preview target guard retains backward compatibility for retry-exhausted terminal source-complete Work', () => {
  assert.equal(assertMetaK2RetainedTargetRow(row({
    lifecycle_status: 'terminal',
    terminal_reason: 'QUEUE_RETRY_EXHAUSTED',
  }), OPERATION), true);
});

test('Preview target guard rejects finished, unsafe-terminal, locked, incomplete, and wrong-generation Work', () => {
  const invalidRows = [
    row({ lifecycle_status: 'completed' }),
    row({ lifecycle_status: 'superseded' }),
    row({ lifecycle_status: 'terminal', terminal_reason: 'SOURCE_AUTH_FAILED' }),
    row({ active_lock_count: 1 }),
    row({ source_stage: 'in_progress' }),
    row({ source_complete: 0 }),
    row({ source_processed_items: 193 }),
    row({ generation: OPERATION.generation + 1 }),
  ];
  for (const invalid of invalidRows) {
    assert.throws(
      () => assertMetaK2RetainedTargetRow(invalid, OPERATION),
      (error) => error?.code === 'META_K2_LOCAL_LARK_TARGET_NOT_WRITABLE',
    );
  }
});

test('local finalizer selects the reviewed retained 20260827 194-of-194 Work independently of the current fence', async () => {
  const source = await readFile(FINALIZER, 'utf8');

  assert.match(source, /const EXACT_OPERATION_DATE = '20260827'/u);
  assert.match(source, /const EXACT_SOURCE_ITEMS = 194/u);
  assert.match(source, /FROM sync_work_runs AS r/u);
  assert.match(source, /WHERE r\.cursor_key=\?/u);
  assert.match(source, /ORDER BY r\.generation DESC/u);
  assert.match(source, /operationId\?\.endsWith\(EXACT_OPERATION_DATE\)/u);
  assert.match(source, /Number\(candidate\.expected_items\) === EXACT_SOURCE_ITEMS/u);
  assert.match(source, /Number\(candidate\.processed_items\) === EXACT_SOURCE_ITEMS/u);
  assert.match(source, /assertRetainedTargetStable\(db, snapshot\)/u);
  assert.match(source, /row\?\.lifecycle_status === 'active'/u);
  assert.match(source, /row\?\.terminal_reason === 'QUEUE_RETRY_EXHAUSTED'/u);
  assert.match(source, /WHERE lock_key=\? AND expires_at>unixepoch\(\)\*1000/u);
  assert.doesNotMatch(source, /FROM sync_generation_fences f/u);
  assert.doesNotMatch(source, /assertFenceUnchanged/u);
  assert.doesNotMatch(source, /(?:INSERT|UPDATE|DELETE|REPLACE)\s+sync_generation_fences/iu);
});
