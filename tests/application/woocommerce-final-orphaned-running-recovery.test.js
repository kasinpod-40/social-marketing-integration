import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WOOCOMMERCE_ORPHANED_RUNNING_CAUSE_CODE,
  WOOCOMMERCE_ORPHANED_RUNNING_CONFIRMATION,
  WOOCOMMERCE_ORPHANED_RUNNING_GENERATION,
  WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID,
  WOOCOMMERCE_ORPHANED_RUNNING_RESUME_ERROR_CODE,
  WOOCOMMERCE_ORPHANED_RUNNING_WORK_KEY,
  assertWooCommerceOrphanedRunningRecoveryConfirmation,
  buildWooCommerceOrphanedRunningRecoverySql,
  buildWooCommerceOrphanedRunningSnapshotSql,
  getWooCommerceOrphanedRunningStabilityWindowMs,
  parseWooCommerceOrphanedRunningRecoveryArgs,
  verifyWooCommerceOrphanedRunningEligibility,
  verifyWooCommerceOrphanedRunningMutation,
  verifyWooCommerceOrphanedRunningPostState,
  verifyWooCommerceOrphanedRunningStable,
} from '../../scripts/lib/woocommerce-final-orphaned-running-recovery.js';
import {
  selectWooCommerceFullOperation,
} from '../../scripts/lib/woocommerce-final-rollout-operator.js';

const AUDIT_REFERENCE = `woocommerce-orphan-recovery:${'a'.repeat(40)}`;
const COUNTS = Object.freeze({
  raw_commerce_stores: 1,
  raw_commerce_orders: 1_000,
  raw_commerce_order_items: 1_001,
  raw_commerce_products: 0,
  raw_commerce_product_variations: 0,
  raw_commerce_categories: 0,
  raw_commerce_customers: 0,
  raw_commerce_coupons: 0,
  raw_commerce_refunds: 0,
  commerce_order_state: 1_000,
  commerce_product_state: 0,
  commerce_customer_aggregates: 816,
  commerce_daily_sales_facts: 60,
  commerce_product_daily_facts: 350,
});

function state() {
  const empty = {
    pages: 0,
    sourceRows: 0,
    expectedRows: 0,
    d1Rows: 0,
    derivedRows: 0,
    larkRows: 0,
    sourceWatermark: null,
  };
  return {
    scope: {
      customerKey: 'chemistry_k',
      accountKey: 'chemistry_k',
      fullReconciliation: true,
      modifiedAfter: null,
      incrementalBoundary: null,
      orderCreatedAfter: Date.parse('2026-01-01T00:00:00.000Z'),
      orderCreatedBefore: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION,
      reportingTimezone: 'Asia/Bangkok',
      defaultCurrency: 'THB',
      pageSize: 100,
      maxNestedPages: 100,
      nestedConcurrency: 3,
      revisionLookbackMs: 2_592_000_000,
    },
    storeContext: {
      reportingTimezone: 'Asia/Bangkok',
      defaultCurrency: 'THB',
    },
    datasetIndex: 1,
    page: 10,
    datasetCounts: {
      store: {
        pages: 1,
        sourceRows: 1,
        expectedRows: 1,
        d1Rows: 1,
        derivedRows: 0,
        larkRows: 1,
        sourceWatermark: 1785405639860,
      },
      orders: {
        pages: 9,
        sourceRows: 900,
        expectedRows: 3_433,
        d1Rows: 4_500,
        derivedRows: 1_203,
        larkRows: 3_903,
        sourceWatermark: 1772037938000,
      },
      products: { ...empty },
      categories: { ...empty },
      customers: { ...empty },
      coupons: { ...empty },
    },
    counts: {
      pages: 10,
      sourceRows: 901,
      d1Rows: 4_501,
      derivedRows: 1_203,
      larkRows: 3_904,
      failedRows: 0,
    },
  };
}

function row(overrides = {}) {
  return {
    sync_run_status: 'running',
    sync_run_finished_at: null,
    sync_run_error_code: null,
    sync_run_retryable: null,
    sync_run_started_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION,
    sync_run_updated_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION + 1_000,
    sync_run_details_json: '{}',
    sync_run_records_pulled: 901,
    sync_run_records_created: 0,
    sync_run_records_updated: 0,
    sync_run_records_skipped: 0,
    sync_run_records_written: 4_501,
    sync_run_retry_count: 0,
    work_lifecycle_status: 'active',
    work_generation: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION,
    work_requested_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION,
    work_completed_at: null,
    completion_json: null,
    work_updated_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION + 2_000,
    work_terminal_reason: null,
    work_abandoned_at: null,
    work_expires_at: null,
    work_audit_reference: null,
    phase_complete: 0,
    state_json: JSON.stringify(state()),
    active_lock_count: 0,
    queue_generation: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION,
    queue_original_requested_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION,
    queue_operation_attempts: 7,
    coverage_run_count: 2,
    invalid_coverage_count: 1,
    phase_count: 1,
    phase_expected_items: 0,
    phase_processed_items: 901,
    phase_pages_processed: 10,
    phase_chunks_processed: 10,
    work_unit_count: 0,
    generation_fence_count: 1,
    fence_generation: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION,
    fence_requested_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION,
    queue_operation_row_count: 1,
    active_work_count: 1,
    other_active_work_count: 0,
    observed_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION + 100_000,
    ...COUNTS,
    ...overrides,
  };
}

test('arguments and confirmation are pinned to the exact orphaned operation', () => {
  assert.deepEqual(
    parseWooCommerceOrphanedRunningRecoveryArgs([
      '--operation-id',
      WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID,
    ]),
    { execute: false, operationId: WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID },
  );
  assert.deepEqual(
    parseWooCommerceOrphanedRunningRecoveryArgs([
      `--operation-id=${WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID}`,
      '--execute',
    ]),
    { execute: true, operationId: WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID },
  );
  assert.throws(
    () => parseWooCommerceOrphanedRunningRecoveryArgs([
      '--operation-id',
      'woo-final-full-aaaaaaaaaaaa',
    ]),
    (error) => error?.code === 'WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_NOT_APPROVED',
  );
  assert.throws(
    () => assertWooCommerceOrphanedRunningRecoveryConfirmation({}),
    (error) => error?.code === 'WOOCOMMERCE_ORPHANED_RUNNING_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertWooCommerceOrphanedRunningRecoveryConfirmation({
    [WOOCOMMERCE_ORPHANED_RUNNING_CONFIRMATION.envName]:
      WOOCOMMERCE_ORPHANED_RUNNING_CONFIRMATION.value,
  }), true);
});

test('snapshot is SELECT-only and captures exact durable identity and stability fields', () => {
  const sql = buildWooCommerceOrphanedRunningSnapshotSql({
    accountKey: 'chemistry_k',
    operationId: WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID,
  });
  assert.match(sql, /^WITH base AS \(SELECT /u);
  assert.match(sql, new RegExp(WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID, 'u'));
  assert.match(sql, /sync_run_updated_at/u);
  assert.match(sql, /sync_run_details_json/u);
  assert.match(sql, /work_updated_at/u);
  assert.match(sql, /generation_fence_count/u);
  assert.match(sql, /queue_operation_row_count/u);
  assert.match(sql, /other_active_work_count/u);
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE|DROP|ALTER|REPLACE)\b/iu);
});

test('eligibility accepts only the exact stalled running snapshot', () => {
  const eligible = verifyWooCommerceOrphanedRunningEligibility(row());
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.operationId, WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID);
  assert.equal(eligible.workKey, WOOCOMMERCE_ORPHANED_RUNNING_WORK_KEY);
  assert.notEqual(eligible.immutableFingerprint, eligible.stabilityFingerprint);

  const rejected = [
    row({ sync_run_status: 'failed' }),
    row({ active_lock_count: 1 }),
    row({ queue_operation_attempts: 8 }),
    row({ coverage_run_count: 3 }),
    row({ raw_commerce_orders: 1_001 }),
    row({ other_active_work_count: 1, active_work_count: 2 }),
    row({ work_generation: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION + 1 }),
    row({ state_json: JSON.stringify({ ...state(), page: 11 }) }),
  ];
  for (const item of rejected) {
    assert.throws(
      () => verifyWooCommerceOrphanedRunningEligibility(item),
      (error) => error?.code === 'WOOCOMMERCE_ORPHANED_RUNNING_PREFLIGHT_REJECTED',
    );
  }
});

test('stability proof requires 30 seconds and rejects any durable or sync drift', () => {
  const before = verifyWooCommerceOrphanedRunningEligibility(row());
  const after = verifyWooCommerceOrphanedRunningEligibility(row({
    observed_at: row().observed_at + getWooCommerceOrphanedRunningStabilityWindowMs(),
  }));
  const stable = verifyWooCommerceOrphanedRunningStable(before, after);
  assert.equal(stable.stable, true);
  assert.equal(stable.elapsedMs, 30_000);

  const tooFast = verifyWooCommerceOrphanedRunningEligibility(row({
    observed_at: row().observed_at + 29_999,
  }));
  assert.throws(
    () => verifyWooCommerceOrphanedRunningStable(before, tooFast),
    (error) => error?.code === 'WOOCOMMERCE_ORPHANED_RUNNING_STABILITY_WINDOW_INVALID',
  );
  const changed = verifyWooCommerceOrphanedRunningEligibility(row({
    observed_at: row().observed_at + 30_000,
    sync_run_updated_at: row().sync_run_updated_at + 1,
  }));
  assert.throws(
    () => verifyWooCommerceOrphanedRunningStable(before, changed),
    (error) => error?.code === 'WOOCOMMERCE_ORPHANED_RUNNING_PROGRESS_OBSERVED',
  );
});

test('mutation updates one Sync Run only and repeats every race-sensitive guard', () => {
  const before = verifyWooCommerceOrphanedRunningEligibility(row());
  const after = verifyWooCommerceOrphanedRunningEligibility(row({
    observed_at: row().observed_at + 30_000,
  }));
  const stability = verifyWooCommerceOrphanedRunningStable(before, after);
  const sql = buildWooCommerceOrphanedRunningRecoverySql({
    stability,
    auditReference: AUDIT_REFERENCE,
  });
  assert.match(sql, /^UPDATE sync_runs SET status = 'failed'/u);
  assert.match(sql, /error_code = 'WOOCOMMERCE_D1_READ_FAILED'/u);
  assert.match(sql, /recoveryCauseCode/u);
  assert.match(sql, /WOOCOMMERCE_ORPHANED_EXECUTION/u);
  assert.match(sql, /'\$\.retryable', json\('true'\)/u);
  assert.match(sql, /wr\.lifecycle_status = 'active'/u);
  assert.match(sql, /swp\.state_json = /u);
  assert.match(sql, /qoa\.main_queue_attempts = 7/u);
  assert.match(sql, /COUNT\(\*\) FROM data_coverage_runs/u);
  assert.match(sql, /COUNT\(\*\) FROM raw_commerce_orders/u);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM sync_locks/u);
  assert.doesNotMatch(sql, /UPDATE sync_work_runs/u);
  assert.doesNotMatch(sql, /UPDATE (?:raw_commerce_|commerce_)/u);
  assert.doesNotMatch(sql, /\bDELETE\b/iu);
  assert.doesNotMatch(sql, /\bINSERT\b/iu);
});

test('mutation and post-state preserve durable work while making the Sync Run retryable', () => {
  assert.equal(verifyWooCommerceOrphanedRunningMutation({
    recovered_rows: 1,
    sync_run_id: WOOCOMMERCE_ORPHANED_RUNNING_WORK_KEY,
    status: 'failed',
    finished_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION + 200_000,
    error_code: WOOCOMMERCE_ORPHANED_RUNNING_RESUME_ERROR_CODE,
    retryable: 1,
    recovery_cause_code: WOOCOMMERCE_ORPHANED_RUNNING_CAUSE_CODE,
    recovery_audit_reference: AUDIT_REFERENCE,
  }, { auditReference: AUDIT_REFERENCE }).recoveredRows, 1);

  const before = verifyWooCommerceOrphanedRunningEligibility(row());
  const postDetails = JSON.stringify({
    retryable: true,
    recoveryCauseCode: WOOCOMMERCE_ORPHANED_RUNNING_CAUSE_CODE,
    recoveryMode: 'exact_durable_continuation',
    recoveryAuditReference: AUDIT_REFERENCE,
  });
  const post = verifyWooCommerceOrphanedRunningPostState(row({
    sync_run_status: 'failed',
    sync_run_finished_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION + 200_000,
    sync_run_error_code: WOOCOMMERCE_ORPHANED_RUNNING_RESUME_ERROR_CODE,
    sync_run_retryable: 1,
    sync_run_updated_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION + 200_000,
    sync_run_details_json: postDetails,
    observed_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION + 201_000,
  }), {
    immutableFingerprint: before.immutableFingerprint,
    auditReference: AUDIT_REFERENCE,
  });
  assert.equal(post.verified, true);
  assert.equal(post.evidence.snapshot.workLifecycleStatus, 'active');
  assert.equal(post.evidence.snapshot.queueOperationAttempts, 7);
  assert.equal(post.evidence.snapshot.counts.raw_commerce_orders, 1_000);
});

test('existing exact continuation accepts the compatibility class with true cause retained separately', () => {
  const snapshot = row({
    sync_run_status: 'failed',
    sync_run_finished_at: WOOCOMMERCE_ORPHANED_RUNNING_GENERATION + 200_000,
    sync_run_error_code: WOOCOMMERCE_ORPHANED_RUNNING_RESUME_ERROR_CODE,
    sync_run_retryable: 1,
  });
  const selected = selectWooCommerceFullOperation({
    resumeOperationId: WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID,
    snapshot,
    orderHistoryStart: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(selected.operationId, WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID);
  assert.equal(selected.requestedAt, WOOCOMMERCE_ORPHANED_RUNNING_GENERATION);
  assert.equal(selected.priorQueueAttempts, 7);
  assert.equal(WOOCOMMERCE_ORPHANED_RUNNING_CAUSE_CODE, 'WOOCOMMERCE_ORPHANED_EXECUTION');
});

test('CLI has one Sync Run mutation path and no Queue, deploy, Provider or Lark action', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-final-orphaned-running-recovery.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /verifyWooCommerceOrphanedRunningStable/u);
  assert.match(source, /runMutationOnce/u);
  assert.match(source, /syncRunMutationCount: 1/u);
  assert.match(source, /durableWorkMutationCount: 0/u);
  assert.match(source, /businessMutationCount: 0/u);
  assert.match(source, /queueMessageCount: 0/u);
  assert.match(source, /workerDeploymentCount: 0/u);
  assert.match(source, /larkRequestCount: 0/u);
  assert.doesNotMatch(source, /queues\/.+\/messages|\.send\(/u);
  assert.doesNotMatch(source, /wrangler[^\n]*deploy/u);
  assert.doesNotMatch(source, /createLark|Provider|fetch\(/u);
});
