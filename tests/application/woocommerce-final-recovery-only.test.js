import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION,
  assertWooCommerceFinalRecoveryOnlyConfirmation,
  buildWooCommerceFinalRecoveryOnlyMutationSql,
  buildWooCommerceFinalRecoveryOnlySnapshotSql,
  classifyWooCommerceFinalRecoveryOnlyState,
  parseWooCommerceFinalRecoveryOnlyArgs,
  verifyWooCommerceFinalRecoveryOnlyEligibility,
  verifyWooCommerceFinalRecoveryOnlyPostState,
} from '../../scripts/lib/woocommerce-final-recovery-only.js';

const OPERATION_ID = 'woo-final-full-5b56469100a9';
const GENERATION = 1785395464000;
const COUNT_KEYS = Object.freeze([
  'raw_commerce_stores',
  'raw_commerce_orders',
  'raw_commerce_order_items',
  'raw_commerce_products',
  'raw_commerce_product_variations',
  'raw_commerce_categories',
  'raw_commerce_customers',
  'raw_commerce_coupons',
  'raw_commerce_refunds',
  'commerce_order_state',
  'commerce_product_state',
  'commerce_customer_aggregates',
  'commerce_daily_sales_facts',
  'commerce_product_daily_facts',
]);
const INCIDENT_TABLE_KEYS = Object.freeze([
  'raw_commerce_stores',
  'raw_commerce_orders',
  'raw_commerce_order_items',
  'raw_commerce_products',
  'raw_commerce_product_variations',
  'raw_commerce_categories',
  'raw_commerce_customers',
  'raw_commerce_coupons',
  'raw_commerce_refunds',
  'commerce_store_state',
  'commerce_order_state',
  'commerce_order_status_observations',
  'commerce_order_line_facts',
  'commerce_product_state',
  'commerce_customer_aggregates',
  'commerce_daily_sales_facts',
  'commerce_product_daily_facts',
]);
const INCIDENT_COUNT_KEYS = Object.freeze(
  INCIDENT_TABLE_KEYS.map((key) => `incident_${key}`),
);

function snapshotRow(overrides = {}) {
  return {
    sync_run_status: 'failed',
    sync_run_finished_at: GENERATION + 1_000,
    sync_run_error_code: 'WOOCOMMERCE_INVALID_JSON',
    sync_run_retryable: 0,
    work_lifecycle_status: 'active',
    work_generation: GENERATION,
    work_requested_at: GENERATION,
    work_completed_at: null,
    completion_json: null,
    phase_complete: 0,
    state_json: JSON.stringify({ datasetIndex: 0, page: 1 }),
    active_lock_count: 0,
    queue_generation: GENERATION,
    queue_original_requested_at: GENERATION,
    queue_operation_attempts: 1,
    coverage_run_count: 0,
    invalid_coverage_count: 0,
    ...Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])),
    ...Object.fromEntries(INCIDENT_COUNT_KEYS.map((key) => [key, 0])),
    ...overrides,
  };
}

test('recovery-only arguments and confirmation are pinned to the current exact incident', () => {
  assert.deepEqual(
    parseWooCommerceFinalRecoveryOnlyArgs(['--operation-id', OPERATION_ID]),
    { execute: false, operationId: OPERATION_ID },
  );
  assert.deepEqual(
    parseWooCommerceFinalRecoveryOnlyArgs([`--operation-id=${OPERATION_ID}`, '--execute']),
    { execute: true, operationId: OPERATION_ID },
  );
  assert.throws(
    () => parseWooCommerceFinalRecoveryOnlyArgs(['--operation-id', 'woo-final-full-aaaaaaaaaaaa']),
    (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_OPERATION_NOT_APPROVED',
  );
  assert.equal(assertWooCommerceFinalRecoveryOnlyConfirmation({
    [WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION.envName]:
      WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION.value,
  }), true);
});

test('exact preflight snapshot is read-only and operation-scoped across every D1 write table', () => {
  const sql = buildWooCommerceFinalRecoveryOnlySnapshotSql({
    accountKey: 'chemistry_k',
    operationId: OPERATION_ID,
  });
  assert.match(sql, /^SELECT /u);
  assert.match(sql, /woocommerce:woo-final-full-5b56469100a9/u);
  assert.match(sql, /account_key = 'chemistry_k'/u);
  for (const table of INCIDENT_TABLE_KEYS) {
    assert.match(sql, new RegExp(`incident_${table}`, 'u'));
  }
  assert.match(sql, /commerce_store_state[^;]+last_sync_run_id = 'woocommerce:woo-final-full-5b56469100a9'/u);
  assert.match(sql, /commerce_order_status_observations[^;]+sync_run_id = 'woocommerce:woo-final-full-5b56469100a9'/u);
  assert.match(sql, /commerce_order_line_facts[^;]+last_sync_run_id = 'woocommerce:woo-final-full-5b56469100a9'/u);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|DROP|ALTER|CREATE)\b/iu);
});

test('exact mutation closes one lifecycle row and repeats every race-sensitive guard', () => {
  const sql = buildWooCommerceFinalRecoveryOnlyMutationSql({
    operationId: OPERATION_ID,
    auditReference: `woocommerce-final-recovery:${'a'.repeat(40)}`,
  });
  assert.match(sql, /^UPDATE sync_work_runs SET lifecycle_status = 'terminal'/u);
  assert.match(sql, /work_key = 'woocommerce:woo-final-full-5b56469100a9'/u);
  assert.match(sql, /completed_at IS NULL/u);
  assert.match(sql, /completion_json IS NULL/u);
  assert.match(sql, /generation = requested_at/u);
  assert.match(sql, /sr\.status = 'failed'/u);
  assert.match(sql, /sr\.finished_at IS NOT NULL/u);
  assert.match(sql, /sr\.error_code = 'WOOCOMMERCE_INVALID_JSON'/u);
  assert.match(sql, /json_extract\(sr\.details_json, '\$\.retryable'\)/u);
  assert.match(sql, /sr\.account_key = 'chemistry_k'/u);
  assert.match(sql, /swp\.phase = 'woocommerce_commerce_pages_v1'/u);
  assert.match(sql, /swp\.complete = 1/u);
  assert.match(sql, /qoa\.generation = sync_work_runs\.generation/u);
  assert.match(sql, /qoa\.original_requested_at = sync_work_runs\.requested_at/u);
  assert.match(sql, /MAX\(qoa\.main_queue_attempts\)/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM data_coverage_runs/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM sync_locks/u);
  for (const table of INCIDENT_TABLE_KEYS) {
    assert.match(sql, new RegExp(`SELECT COUNT\\(\\*\\) FROM ${table}`, 'u'));
  }
  assert.match(sql, /raw_commerce_stores[^;]+sync_run_id = sr\.sync_run_id/u);
  assert.match(sql, /commerce_store_state[^;]+last_sync_run_id = sr\.sync_run_id/u);
  assert.match(sql, /commerce_order_status_observations[^;]+sync_run_id = sr\.sync_run_id/u);
  assert.match(sql, /commerce_order_line_facts[^;]+last_sync_run_id = sr\.sync_run_id/u);
  assert.doesNotMatch(
    sql,
    /UPDATE (?:raw_commerce_|commerce_store_state|commerce_order_|commerce_product_state|commerce_customer_aggregates|commerce_daily_sales_facts|commerce_product_daily_facts)/u,
  );
  assert.doesNotMatch(sql, /DELETE FROM/u);
});

test('eligibility accepts retained master facts but requires exact permanent incident identity', () => {
  const result = verifyWooCommerceFinalRecoveryOnlyEligibility(snapshotRow({
    raw_commerce_stores: 1,
    raw_commerce_products: 250,
    commerce_product_state: 250,
  }), {
    operationId: OPERATION_ID,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.workKey, `woocommerce:${OPERATION_ID}`);
  assert.equal(result.businessRows, 0);
  assert.equal(result.incidentBusinessRows, 0);
  assert.equal(result.retainedBusinessRows, 501);
  assert.equal(result.generationsAgree, true);

  const rejected = [
    snapshotRow({ sync_run_status: 'running' }),
    snapshotRow({ sync_run_error_code: 'WOOCOMMERCE_NETWORK_ERROR' }),
    snapshotRow({ sync_run_retryable: 1 }),
    snapshotRow({ work_generation: GENERATION + 1 }),
    snapshotRow({ work_requested_at: GENERATION + 1 }),
    snapshotRow({ queue_generation: GENERATION + 1 }),
    snapshotRow({ queue_original_requested_at: GENERATION + 1 }),
    snapshotRow({ active_lock_count: 1 }),
    snapshotRow({ queue_operation_attempts: 2 }),
    snapshotRow({ coverage_run_count: 1 }),
    snapshotRow({ completion_json: JSON.stringify({ complete: true }) }),
    snapshotRow({ incident_raw_commerce_orders: 1 }),
    snapshotRow({ incident_commerce_store_state: 1 }),
    snapshotRow({ incident_commerce_order_status_observations: 1 }),
    snapshotRow({ incident_commerce_order_line_facts: 1 }),
  ];
  for (const row of rejected) {
    assert.throws(
      () => verifyWooCommerceFinalRecoveryOnlyEligibility(row, { operationId: OPERATION_ID }),
      (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_PREFLIGHT_REJECTED',
    );
  }
});

test('state classifier distinguishes active recovery from already terminal recovery', () => {
  assert.equal(
    classifyWooCommerceFinalRecoveryOnlyState(snapshotRow(), {
      operationId: OPERATION_ID,
    }).state,
    'active_recovery_required',
  );
  assert.equal(
    classifyWooCommerceFinalRecoveryOnlyState(snapshotRow({
      work_lifecycle_status: 'terminal',
    }), {
      operationId: OPERATION_ID,
    }).state,
    'terminal_recovery_complete',
  );
  assert.throws(
    () => classifyWooCommerceFinalRecoveryOnlyState(snapshotRow({
      work_lifecycle_status: 'completed',
    }), { operationId: OPERATION_ID }),
    (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_STATE_INVALID',
  );
});

test('post-state requires terminal lifecycle without identity, incident or reliability drift', () => {
  const result = verifyWooCommerceFinalRecoveryOnlyPostState(snapshotRow({
    work_lifecycle_status: 'terminal',
    raw_commerce_products: 250,
    commerce_product_state: 250,
  }), { operationId: OPERATION_ID });
  assert.equal(result.verified, true);
  assert.equal(result.businessRows, 0);
  assert.equal(result.retainedBusinessRows, 500);
  assert.equal(result.generationsAgree, true);

  assert.throws(
    () => verifyWooCommerceFinalRecoveryOnlyPostState(snapshotRow({
      work_lifecycle_status: 'terminal',
      incident_commerce_order_state: 1,
    }), { operationId: OPERATION_ID }),
    (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_POST_VERIFY_FAILED',
  );
  assert.throws(
    () => verifyWooCommerceFinalRecoveryOnlyPostState(snapshotRow({
      work_lifecycle_status: 'terminal',
      sync_run_error_code: 'WOOCOMMERCE_NETWORK_ERROR',
    }), { operationId: OPERATION_ID }),
    (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_POST_VERIFY_FAILED',
  );
  assert.throws(
    () => verifyWooCommerceFinalRecoveryOnlyPostState(snapshotRow({
      work_lifecycle_status: 'terminal',
      queue_generation: GENERATION + 1,
    }), { operationId: OPERATION_ID }),
    (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_POST_VERIFY_FAILED',
  );
});

test('CLI uses the exact incident mutation and contains no rollout, Queue, deploy or Lark path', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-final-recovery-only.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /buildWooCommerceFinalRecoveryOnlyMutationSql/u);
  assert.doesNotMatch(source, /buildWooCommerceFailedWorkRecoverySql/u);
  assert.match(source, /runMutationOnce/u);
  assert.match(source, /incidentBusinessRowsBefore/u);
  assert.match(source, /retainedBusinessRowsAfter/u);
  assert.match(source, /durableLifecycleMutationCount: 1/u);
  assert.match(source, /businessMutationCount: 0/u);
  assert.match(source, /queueMessageCount: 0/u);
  assert.match(source, /workerDeploymentCount: 0/u);
  assert.match(source, /larkRequestCount: 0/u);
  assert.doesNotMatch(source, /woocommerce-final-one-command/u);
  assert.doesNotMatch(source, /queues\/.+\/messages|wrangler\(\['deploy'|createLark|LarkBitable/u);
  assert.doesNotMatch(source, /MKT_SYNC_QUEUE|\.send\(/u);
});
