import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WOOCOMMERCE_FINAL_EXACT_RESUME_ACCIDENT_AUDIT,
  WOOCOMMERCE_FINAL_EXACT_RESUME_CONFIRMATION,
  WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID,
  WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY,
  assertWooCommerceExactResumeReactivationConfirmation,
  buildWooCommerceExactResumeReactivationSnapshotSql,
  buildWooCommerceExactResumeReactivationSql,
  parseWooCommerceExactResumeReactivationArgs,
  verifyWooCommerceExactResumeReactivationEligibility,
  verifyWooCommerceExactResumeReactivationMutation,
  verifyWooCommerceExactResumeReactivationPostState,
} from '../../scripts/lib/woocommerce-final-exact-resume-reactivation.js';

const GENERATION = 1785330000000;
const COUNTS = Object.freeze({
  raw_commerce_stores: 1,
  raw_commerce_orders: 200,
  raw_commerce_order_items: 201,
  raw_commerce_products: 0,
  raw_commerce_product_variations: 0,
  raw_commerce_categories: 0,
  raw_commerce_customers: 0,
  raw_commerce_coupons: 0,
  raw_commerce_refunds: 0,
  commerce_order_state: 200,
  commerce_product_state: 0,
  commerce_customer_aggregates: 199,
  commerce_daily_sales_facts: 38,
  commerce_product_daily_facts: 58,
});

function incidentRow(overrides = {}) {
  return {
    sync_run_status: 'failed',
    sync_run_finished_at: GENERATION + 1000,
    sync_run_error_code: 'WOOCOMMERCE_D1_READ_FAILED',
    work_lifecycle_status: 'terminal',
    work_generation: GENERATION,
    work_requested_at: GENERATION,
    work_completed_at: null,
    completion_json: null,
    phase_complete: 0,
    state_json: JSON.stringify({ datasetIndex: 1, page: 2 }),
    active_lock_count: 0,
    queue_generation: GENERATION,
    queue_original_requested_at: GENERATION,
    queue_operation_attempts: 6,
    coverage_run_count: 2,
    invalid_coverage_count: 1,
    work_terminal_reason: 'woocommerce_final_failed_sync_recovery',
    work_abandoned_at: GENERATION + 2000,
    work_expires_at: GENERATION + 604802000,
    work_audit_reference: WOOCOMMERCE_FINAL_EXACT_RESUME_ACCIDENT_AUDIT,
    phase_count: 1,
    phase_expected_items: 25680,
    phase_processed_items: 200,
    phase_pages_processed: 2,
    phase_chunks_processed: 2,
    work_unit_count: 0,
    generation_fence_count: 1,
    fence_generation: GENERATION,
    fence_requested_at: GENERATION,
    queue_operation_row_count: 1,
    active_work_count: 0,
    other_active_work_count: 0,
    other_active_woo_work_count: 0,
    ...COUNTS,
    ...overrides,
  };
}

test('reactivation arguments and confirmation are pinned to the exact partial operation', () => {
  assert.deepEqual(
    parseWooCommerceExactResumeReactivationArgs([
      '--operation-id',
      WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID,
    ]),
    {
      execute: false,
      operationId: WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID,
    },
  );
  assert.throws(
    () => parseWooCommerceExactResumeReactivationArgs([
      '--operation-id=woo-final-full-aaaaaaaaaaaa',
    ]),
    (error) => (
      error?.code
      === 'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_OPERATION_NOT_APPROVED'
    ),
  );
  assert.equal(assertWooCommerceExactResumeReactivationConfirmation({
    [WOOCOMMERCE_FINAL_EXACT_RESUME_CONFIRMATION.envName]:
      WOOCOMMERCE_FINAL_EXACT_RESUME_CONFIRMATION.value,
  }), true);
});

test('reactivation pre/post snapshot is read-only and exact-target scoped', () => {
  const sql = buildWooCommerceExactResumeReactivationSnapshotSql({
    accountKey: 'chemistry_k',
    operationId: WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID,
  });
  assert.match(sql, /^WITH base AS \(SELECT /u);
  assert.match(sql, new RegExp(WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY, 'u'));
  assert.match(sql, /account_key = 'chemistry_k'/u);
  assert.match(sql, /other_active_work_count/u);
  assert.doesNotMatch(
    sql,
    /\b(?:UPDATE|DELETE|INSERT|DROP|ALTER|CREATE)\b/iu,
  );
});

test('eligibility accepts only the exact accidental terminalization state', () => {
  const eligible = verifyWooCommerceExactResumeReactivationEligibility(
    incidentRow(),
  );
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.operationId, WOOCOMMERCE_FINAL_EXACT_RESUME_OPERATION_ID);
  assert.equal(eligible.workKey, WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY);
  assert.equal(eligible.immutableFingerprint.length, 64);

  const rejected = [
    incidentRow({ work_lifecycle_status: 'active' }),
    incidentRow({ sync_run_error_code: 'WOOCOMMERCE_NETWORK_ERROR' }),
    incidentRow({ state_json: JSON.stringify({ datasetIndex: 1, page: 3 }) }),
    incidentRow({ raw_commerce_orders: 201 }),
    incidentRow({ coverage_run_count: 1 }),
    incidentRow({ queue_generation: GENERATION + 1 }),
    incidentRow({ active_work_count: 1 }),
    incidentRow({ work_audit_reference: 'woocommerce-final-recovery:wrong' }),
  ];
  for (const row of rejected) {
    assert.throws(
      () => verifyWooCommerceExactResumeReactivationEligibility(row),
      (error) => (
        error?.code === 'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_PREFLIGHT_REJECTED'
      ),
    );
  }
});

test('reactivation SQL updates only the exact lifecycle row with immutable guards', () => {
  const eligibility = verifyWooCommerceExactResumeReactivationEligibility(
    incidentRow(),
  );
  const sql = buildWooCommerceExactResumeReactivationSql({ eligibility });
  assert.match(sql, /^UPDATE sync_work_runs SET lifecycle_status = 'active'/u);
  assert.match(sql, /terminal_reason = NULL/u);
  assert.match(sql, /abandoned_at = NULL/u);
  assert.match(sql, /expires_at = NULL/u);
  assert.match(sql, /audit_reference = NULL/u);
  assert.match(sql, /state_json = '\{"datasetIndex":1,"page":2\}'/u);
  assert.match(sql, /main_queue_attempts = 6/u);
  assert.match(sql, /COUNT\(\*\) FROM raw_commerce_orders/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM sync_work_runs/u);
  assert.doesNotMatch(sql, /\b(?:DELETE|INSERT|DROP|ALTER|CREATE)\b/iu);
  assert.doesNotMatch(
    sql,
    /UPDATE (?:sync_work_phases|sync_work_units|sync_generation_fences|queue_operation_attempts|data_coverage_runs|raw_commerce_|commerce_)/u,
  );
});

test('mutation and post-state verification require one active row and no immutable drift', () => {
  const eligibility = verifyWooCommerceExactResumeReactivationEligibility(
    incidentRow(),
  );
  const mutation = verifyWooCommerceExactResumeReactivationMutation({
    reactivated_rows: 1,
    work_key: WOOCOMMERCE_FINAL_EXACT_RESUME_WORK_KEY,
    lifecycle_status: 'active',
    terminal_reason: null,
    abandoned_at: null,
    expires_at: null,
    audit_reference: null,
  });
  assert.equal(mutation.reactivatedRows, 1);
  assert.equal(mutation.workKeyFingerprint.length, 64);

  const post = verifyWooCommerceExactResumeReactivationPostState(incidentRow({
    work_lifecycle_status: 'active',
    work_terminal_reason: null,
    work_abandoned_at: null,
    work_expires_at: null,
    work_audit_reference: null,
    active_work_count: 1,
  }), {
    immutableFingerprint: eligibility.immutableFingerprint,
  });
  assert.equal(post.verified, true);

  assert.throws(
    () => verifyWooCommerceExactResumeReactivationPostState(incidentRow({
      work_lifecycle_status: 'active',
      work_terminal_reason: null,
      work_abandoned_at: null,
      work_expires_at: null,
      work_audit_reference: null,
      active_work_count: 1,
      phase_processed_items: 201,
    }), {
      immutableFingerprint: eligibility.immutableFingerprint,
    }),
    (error) => (
      error?.code === 'WOOCOMMERCE_EXACT_RESUME_REACTIVATION_POST_VERIFY_FAILED'
    ),
  );
});

test('CLI contains one lifecycle mutation path and no Queue, deploy or Lark client', async () => {
  const source = await readFile(
    new URL(
      '../../scripts/woocommerce-final-exact-resume-reactivate.mjs',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /buildWooCommerceExactResumeReactivationSql/u);
  assert.match(source, /runMutationOnce/u);
  assert.match(source, /durableLifecycleMutationCount: 1/u);
  assert.match(source, /businessMutationCount: 0/u);
  assert.match(source, /queueMessageCount: 0/u);
  assert.match(source, /workerDeploymentCount: 0/u);
  assert.match(source, /larkRequestCount: 0/u);
  assert.doesNotMatch(
    source,
    /queues\/.+\/messages|wrangler\(\['deploy'|createLark|LarkBitable|\.send\(/u,
  );
});
