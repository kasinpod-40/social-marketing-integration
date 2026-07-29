import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifyWooCommerceFinalOperationInspection,
} from '../../scripts/lib/woocommerce-final-operation-inspector.js';

const DATASET_KEYS = Object.freeze([
  'store',
  'orders',
  'products',
  'categories',
  'customers',
  'coupons',
]);

function completedRow(overrides = {}) {
  return {
    sync_run_status: 'success',
    sync_run_finished_at: 1,
    sync_run_error_code: null,
    work_lifecycle_status: 'completed',
    work_completed_at: 1,
    completion_json: JSON.stringify({ providerRequestCount: 12 }),
    phase_complete: 1,
    state_json: JSON.stringify({
      datasetIndex: 6,
      counts: { failedRows: 0 },
      datasetCounts: Object.fromEntries(DATASET_KEYS.map((key) => [key, {
        expectedRows: 1,
        sourceRows: 1,
      }])),
    }),
    active_lock_count: 0,
    queue_operation_attempts: 1,
    coverage_run_count: 6,
    invalid_coverage_count: 0,
    ...overrides,
  };
}

test('classifies a complete admitted full operation without authorizing a new send', () => {
  const result = classifyWooCommerceFinalOperationInspection(completedRow());
  assert.equal(result.decision, 'COMPLETE');
  assert.equal(result.complete, true);
  assert.equal(
    result.nextAction,
    'do_not_send_new_full_operation_continue_closeout_from_existing_operation',
  );
  assert.equal(result.snapshot.queueOperationAttempts, 1);
});

test('classifies active work as wait and reinspect the same operation', () => {
  const result = classifyWooCommerceFinalOperationInspection(completedRow({
    sync_run_status: 'running',
    sync_run_finished_at: null,
    work_lifecycle_status: 'active',
    work_completed_at: null,
    phase_complete: 0,
    active_lock_count: 1,
    coverage_run_count: 0,
  }));
  assert.equal(result.decision, 'ACTIVE');
  assert.equal(result.complete, false);
  assert.equal(result.nextAction, 'do_not_rerun_wait_then_reinspect_same_operation');
});

test('classifies terminal failure without automatic resend', () => {
  const result = classifyWooCommerceFinalOperationInspection(completedRow({
    sync_run_status: 'failed',
    sync_run_finished_at: 2,
    sync_run_error_code: 'WOOCOMMERCE_NETWORK_ERROR',
    work_lifecycle_status: 'failed',
    work_completed_at: null,
    phase_complete: 0,
    coverage_run_count: 0,
  }));
  assert.equal(result.decision, 'TERMINAL_FAILED');
  assert.equal(result.complete, false);
  assert.equal(
    result.nextAction,
    'do_not_resend_automatically_inspect_failure_and_recovery_contract',
  );
});

test('keeps missing terminal evidence indeterminate and blocks rerun', () => {
  const result = classifyWooCommerceFinalOperationInspection({
    sync_run_status: null,
    sync_run_finished_at: null,
    sync_run_error_code: null,
    work_lifecycle_status: null,
    work_completed_at: null,
    phase_complete: 0,
    active_lock_count: 0,
    queue_operation_attempts: 1,
    coverage_run_count: 0,
    invalid_coverage_count: 0,
  });
  assert.equal(result.decision, 'INDETERMINATE');
  assert.equal(result.complete, false);
  assert.equal(
    result.nextAction,
    'do_not_rerun_investigate_missing_terminal_evidence',
  );
});

test('inspection CLI is D1 read-only and has no Queue, deploy, Lark or SQL mutation path', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-final-operation-inspect.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /buildWooCommerceFinalSnapshotSql/u);
  assert.match(source, /classifyWooCommerceD1ReadCommand/u);
  assert.match(source, /'d1',\s*\n\s*'execute'/u);
  assert.match(source, /'--remote'/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE)\b/u);
  assert.doesNotMatch(source, /createLark|LarkBitable|wrangler\(\['deploy'/u);
});
