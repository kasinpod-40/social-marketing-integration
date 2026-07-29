import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION,
  assertWooCommerceFinalRecoveryOnlyConfirmation,
  buildWooCommerceFinalRecoveryOnlySnapshotSql,
  parseWooCommerceFinalRecoveryOnlyArgs,
  resolveWooCommerceFinalRecoveryOnlyIncident,
  verifyWooCommerceFinalRecoveryOnlyEligibility,
  verifyWooCommerceFinalRecoveryOnlyPostState,
} from '../../scripts/lib/woocommerce-final-recovery-only.js';

const ORIGINAL_OPERATION_ID = 'woo-final-full-e486b03cfe8d';
const INVALID_JSON_OPERATION_ID = 'woo-final-full-6f43ac8ee857';
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

test('recovery-only arguments and confirmations remain pinned per approved incident', () => {
  const incidents = [
    {
      operationId: ORIGINAL_OPERATION_ID,
      errorCode: 'WOOCOMMERCE_NETWORK_ERROR',
      confirmation: 'RECOVER_WOO_FINAL_FULL_E486B03CFE8D_ONLY',
    },
    {
      operationId: INVALID_JSON_OPERATION_ID,
      errorCode: 'WOOCOMMERCE_INVALID_JSON',
      confirmation: 'RECOVER_WOO_FINAL_FULL_6F43AC8EE857_ONLY',
    },
  ];

  for (const expected of incidents) {
    assert.deepEqual(
      parseWooCommerceFinalRecoveryOnlyArgs(['--operation-id', expected.operationId]),
      { execute: false, operationId: expected.operationId },
    );
    assert.deepEqual(
      parseWooCommerceFinalRecoveryOnlyArgs([
        `--operation-id=${expected.operationId}`,
        '--execute',
      ]),
      { execute: true, operationId: expected.operationId },
    );

    const incident = resolveWooCommerceFinalRecoveryOnlyIncident(expected.operationId);
    assert.equal(incident.expectedErrorCode, expected.errorCode);
    assert.equal(incident.confirmation.value, expected.confirmation);
    assert.equal(assertWooCommerceFinalRecoveryOnlyConfirmation({
      [incident.confirmation.envName]: incident.confirmation.value,
    }, { operationId: expected.operationId }), true);
  }

  assert.equal(
    WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION.value,
    'RECOVER_WOO_FINAL_FULL_E486B03CFE8D_ONLY',
  );
  assert.throws(
    () => parseWooCommerceFinalRecoveryOnlyArgs([
      '--operation-id',
      'woo-final-full-aaaaaaaaaaaa',
    ]),
    (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_OPERATION_NOT_APPROVED',
  );
  assert.throws(
    () => assertWooCommerceFinalRecoveryOnlyConfirmation({
      CONFIRM_WOOCOMMERCE_RECOVERY_ONLY:
        'RECOVER_WOO_FINAL_FULL_E486B03CFE8D_ONLY',
    }, { operationId: INVALID_JSON_OPERATION_ID }),
    (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_CONFIRMATION_REQUIRED',
  );
});

test('exact preflight snapshot is read-only and operation-scoped', () => {
  for (const operationId of [ORIGINAL_OPERATION_ID, INVALID_JSON_OPERATION_ID]) {
    const sql = buildWooCommerceFinalRecoveryOnlySnapshotSql({
      accountKey: 'chemistry_k',
      operationId,
    });
    assert.match(sql, /^SELECT /u);
    assert.match(sql, new RegExp(`woocommerce:${operationId}`, 'u'));
    assert.match(sql, /account_key = 'chemistry_k'/u);
    assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|DROP|ALTER|CREATE)\b/iu);
  }
});

test('eligibility accepts only the exact failed error and zero-fact stale state', () => {
  const original = verifyWooCommerceFinalRecoveryOnlyEligibility(snapshotRow(), {
    operationId: ORIGINAL_OPERATION_ID,
  });
  assert.equal(original.eligible, true);
  assert.equal(original.workKey, `woocommerce:${ORIGINAL_OPERATION_ID}`);
  assert.equal(original.expectedErrorCode, 'WOOCOMMERCE_NETWORK_ERROR');
  assert.equal(original.businessRows, 0);

  const invalidJson = verifyWooCommerceFinalRecoveryOnlyEligibility(snapshotRow({
    sync_run_finished_at: 1785309111346,
    sync_run_error_code: 'WOOCOMMERCE_INVALID_JSON',
  }), { operationId: INVALID_JSON_OPERATION_ID });
  assert.equal(invalidJson.eligible, true);
  assert.equal(invalidJson.workKey, `woocommerce:${INVALID_JSON_OPERATION_ID}`);
  assert.equal(invalidJson.expectedErrorCode, 'WOOCOMMERCE_INVALID_JSON');
  assert.equal(
    invalidJson.nextAction,
    'run_read_only_inspector_then_separately_authorize_provider_response_diagnostics',
  );

  const rejected = [
    [ORIGINAL_OPERATION_ID, snapshotRow({ sync_run_status: 'running' })],
    [ORIGINAL_OPERATION_ID, snapshotRow({ active_lock_count: 1 })],
    [ORIGINAL_OPERATION_ID, snapshotRow({ queue_operation_attempts: 2 })],
    [ORIGINAL_OPERATION_ID, snapshotRow({ coverage_run_count: 1 })],
    [ORIGINAL_OPERATION_ID, snapshotRow({ completion_json: JSON.stringify({ complete: true }) })],
    [ORIGINAL_OPERATION_ID, snapshotRow({ raw_commerce_orders: 1 })],
    [ORIGINAL_OPERATION_ID, snapshotRow({ sync_run_error_code: 'WOOCOMMERCE_INVALID_JSON' })],
    [INVALID_JSON_OPERATION_ID, snapshotRow()],
  ];
  for (const [operationId, row] of rejected) {
    assert.throws(
      () => verifyWooCommerceFinalRecoveryOnlyEligibility(row, { operationId }),
      (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_PREFLIGHT_REJECTED',
    );
  }
});

test('post-state preserves the incident error and forbids business, queue, coverage or phase drift', () => {
  const original = verifyWooCommerceFinalRecoveryOnlyPostState(snapshotRow({
    work_lifecycle_status: 'terminal',
  }), { operationId: ORIGINAL_OPERATION_ID });
  assert.equal(original.verified, true);
  assert.equal(original.businessRows, 0);

  const invalidJson = verifyWooCommerceFinalRecoveryOnlyPostState(snapshotRow({
    sync_run_error_code: 'WOOCOMMERCE_INVALID_JSON',
    work_lifecycle_status: 'terminal',
  }), { operationId: INVALID_JSON_OPERATION_ID });
  assert.equal(invalidJson.verified, true);
  assert.equal(invalidJson.expectedErrorCode, 'WOOCOMMERCE_INVALID_JSON');

  assert.throws(
    () => verifyWooCommerceFinalRecoveryOnlyPostState(snapshotRow({
      work_lifecycle_status: 'terminal',
      commerce_order_state: 1,
    }), { operationId: ORIGINAL_OPERATION_ID }),
    (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_POST_VERIFY_FAILED',
  );
  assert.throws(
    () => verifyWooCommerceFinalRecoveryOnlyPostState(snapshotRow({
      sync_run_error_code: 'WOOCOMMERCE_NETWORK_ERROR',
      work_lifecycle_status: 'terminal',
    }), { operationId: INVALID_JSON_OPERATION_ID }),
    (error) => error?.code === 'WOOCOMMERCE_RECOVERY_ONLY_POST_VERIFY_FAILED',
  );
});

test('CLI keeps one lifecycle mutation path and selects confirmation by exact operation', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-final-recovery-only.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /buildWooCommerceFailedWorkRecoverySql/u);
  assert.match(source, /resolveWooCommerceFinalRecoveryOnlyIncident/u);
  assert.match(source, /assertWooCommerceFinalRecoveryOnlyConfirmation\(env, \{/u);
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
