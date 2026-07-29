import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION,
  assertWooCommerceFinalRecoveryOnlyConfirmation,
  buildWooCommerceFinalRecoveryOnlySnapshotSql,
  parseWooCommerceFinalRecoveryOnlyArgs,
  verifyWooCommerceFinalRecoveryOnlyEligibility,
  verifyWooCommerceFinalRecoveryOnlyPostState,
} from '../../scripts/lib/woocommerce-final-recovery-only.js';

const OPERATION_ID = 'woo-final-full-6f43ac8ee857';
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

function snapshotRow(overrides = {}) {
  return {
    sync_run_status: 'failed',
    sync_run_finished_at: 1785262407705,
    sync_run_error_code: 'WOOCOMMERCE_NETWORK_ERROR',
    work_lifecycle_status: 'active',
    work_completed_at: null,
    completion_json: null,
    phase_complete: 0,
    state_json: JSON.stringify({ datasetIndex: 0, page: 1 }),
    active_lock_count: 0,
    queue_operation_attempts: 1,
    coverage_run_count: 0,
    invalid_coverage_count: 0,
    ...Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])),
    ...overrides,
  };
}

test('recovery-only arguments and confirmation are pinned to the exact approved incident', () => {
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

test('exact preflight snapshot is read-only and operation-scoped', () => {
  const sql = buildWooCommerceFinalRecoveryOnlySnapshotSql({
    accountKey: 'chemistry_k',
    operationId: OPERATION_ID,
  });
  assert.match(sql, /^SELECT /u);
  assert.match(sql, /woocommerce:woo-final-full-6f43ac8ee857/u);
  assert.match(sql, /account_key = 'chemistry_k'/u);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|DROP|ALTER|CREATE)\b/iu);
});

test('eligibility accepts only failed unlocked zero-fact single-attempt stale work', () => {
  const result = verifyWooCommerceFinalRecoveryOnlyEligibility(snapshotRow(), {
    operationId: OPERATION_ID,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.workKey, `woocommerce:${OPERATION_ID}`);
  assert.equal(result.businessRows, 0);

  const rejected = [
    snapshotRow({ sync_run_status: 'running' }),
    snapshotRow({ active_lock_count: 1 }),
    snapshotRow({ queue_operation_attempts: 2 }),
    snapshotRow({ coverage_run_count: 1 }),
    snapshotRow({ completion_json: JSON.stringify({ complete: true }) }),
    snapshotRow({ raw_commerce_orders: 1 }),
  ];
  for (const row of rejected) {
    assert.throws(
      () => verifyWooCommerceFinalRecoveryOnlyEligibility(row, { operationId: OPERATION_ID }),
      (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_PREFLIGHT_REJECTED',
    );
  }
});

test('post-state requires terminal lifecycle without business, queue, coverage or phase drift', () => {
  const result = verifyWooCommerceFinalRecoveryOnlyPostState(snapshotRow({
    work_lifecycle_status: 'terminal',
  }), { operationId: OPERATION_ID });
  assert.equal(result.verified, true);
  assert.equal(result.businessRows, 0);

  assert.throws(
    () => verifyWooCommerceFinalRecoveryOnlyPostState(snapshotRow({
      work_lifecycle_status: 'terminal',
      commerce_order_state: 1,
    }), { operationId: OPERATION_ID }),
    (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_POST_VERIFY_FAILED',
  );
});

test('CLI has one recovery mutation path and no rollout, Queue, deploy or Lark path', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-final-recovery-only.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /buildWooCommerceFailedWorkRecoverySql/u);
  assert.match(source, /runMutationOnce/u);
  assert.match(source, /durableLifecycleMutationCount: 1/u);
  assert.match(source, /businessMutationCount: 0/u);
  assert.match(source, /queueMessageCount: 0/u);
  assert.match(source, /workerDeploymentCount: 0/u);
  assert.match(source, /larkRequestCount: 0/u);
  assert.doesNotMatch(source, /woocommerce-final-one-command/u);
  assert.doesNotMatch(source, /queues\/.+\/messages|wrangler\(\['deploy'|createLark|LarkBitable/u);
  assert.doesNotMatch(source, /MKT_SYNC_QUEUE|\.send\(/u);
});
