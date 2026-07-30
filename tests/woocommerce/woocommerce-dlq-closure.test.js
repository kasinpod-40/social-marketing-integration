import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WOOCOMMERCE_DLQ_CLOSURE_CONFIRMATION,
  WOOCOMMERCE_DLQ_CLOSURE_INCIDENT,
  assertWooCommerceDlqClosureConfirmation,
  assertWooCommerceDlqClosureNoSnapshotDrift,
  assertWooCommerceDlqClosureSnapshot,
  assertWooCommerceDlqClosureSummary,
  buildWooCommerceDlqClosureEvidenceSql,
  buildWooCommerceDlqClosureRepairSql,
  validateWooCommerceDlqClosureRepairResults,
  validateWooCommerceDlqClosureRows,
} from '../../scripts/lib/woocommerce-dlq-closure.js';

test('WooCommerce DLQ closure requires exact confirmation and Final summary', () => {
  assert.throws(
    () => assertWooCommerceDlqClosureConfirmation({}),
    (error) => error.code === 'WOOCOMMERCE_DLQ_CLOSURE_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertWooCommerceDlqClosureConfirmation({
    CONFIRM_WOOCOMMERCE_DLQ_CLOSURE: WOOCOMMERCE_DLQ_CLOSURE_CONFIRMATION,
  }), true);
  assert.equal(assertWooCommerceDlqClosureSummary(validSummary()), true);
  assert.throws(
    () => assertWooCommerceDlqClosureSummary({
      ...validSummary(),
      executionFlagsAllFalse: false,
    }),
    (error) => error.code === 'WOOCOMMERCE_DLQ_CLOSURE_SUMMARY_INVALID',
  );
});

test('WooCommerce DLQ closure accepts only the completed exact full snapshot', () => {
  const result = assertWooCommerceDlqClosureSnapshot(validSnapshot());
  assert.equal(result.workLifecycleStatus, 'completed');
  assert.throws(
    () => assertWooCommerceDlqClosureSnapshot({
      ...validSnapshot(),
      active_lock_count: 1,
    }),
    (error) => error.code === 'WOOCOMMERCE_DLQ_CLOSURE_COMPLETION_INVALID',
  );
});

test('WooCommerce DLQ closure evidence pins all three immutable incidents', () => {
  const before = incidentRows('before');
  assert.deepEqual(validateWooCommerceDlqClosureRows(before), {
    rowCount: 3,
    openRows: 3,
    redrivenRows: 0,
    completedMetadataRows: 0,
  });
  const final = incidentRows('final');
  assert.deepEqual(validateWooCommerceDlqClosureRows(final, 'final'), {
    rowCount: 3,
    openRows: 0,
    redrivenRows: 3,
    completedMetadataRows: 3,
  });
  const interrupted = incidentRows('before');
  interrupted[0] = {
    ...interrupted[0],
    status: 'redriven',
    redrive_reference: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.rows[0].closureReference,
    redriven_at: 1785456000000,
  };
  assert.equal(validateWooCommerceDlqClosureRows(interrupted).redrivenRows, 1);
  assert.throws(
    () => validateWooCommerceDlqClosureRows(before.slice(1)),
    (error) => error.code === 'WOOCOMMERCE_DLQ_CLOSURE_EVIDENCE_MISMATCH',
  );
});

test('WooCommerce DLQ repair SQL is metadata-only and guarded by completion and zero lock', () => {
  const sql = buildWooCommerceDlqClosureRepairSql(1785456000000);
  for (const row of WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.rows) {
    assert.match(sql, new RegExp(row.dlqId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.match(sql, new RegExp(row.errorCode, 'u'));
  }
  assert.equal((sql.match(/UPDATE dead_letter_jobs/gu) ?? []).length, 3);
  assert.equal((sql.match(/UPDATE dead_letter_operation_metadata/gu) ?? []).length, 3);
  assert.match(sql, /lifecycle_status = 'completed'/u);
  assert.match(sql, /scopeMode'\) = 'full_inventory'/u);
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM sync_locks/gu);
  assert.doesNotMatch(sql, /DELETE\s+FROM/iu);
  assert.doesNotMatch(sql, /UPDATE\s+(?:sync_work_runs|sync_runs|data_coverage_runs|raw_commerce_|commerce_)/iu);
  assert.deepEqual(validateWooCommerceDlqClosureRepairResults([
    { dead_letter_rows: 1 }, { metadata_rows: 1 },
    { dead_letter_rows: 1 }, { metadata_rows: 1 },
    { dead_letter_rows: 1 }, { metadata_rows: 1 },
  ]), { statementCount: 6, updatedRows: 6 });
});

test('WooCommerce DLQ closure evidence SQL is exact and snapshot drift is rejected', () => {
  const sql = buildWooCommerceDlqClosureEvidenceSql();
  assert.match(sql, /JOIN dead_letter_operation_metadata/u);
  assert.equal((sql.match(/(?:dlq|terminal):[a-f0-9]{32}/gu) ?? []).length, 3);
  assert.equal(assertWooCommerceDlqClosureNoSnapshotDrift(validSnapshot(), validSnapshot()), true);
  assert.throws(
    () => assertWooCommerceDlqClosureNoSnapshotDrift(
      validSnapshot(),
      { ...validSnapshot(), raw_commerce_orders: 999 },
    ),
    (error) => error.code === 'WOOCOMMERCE_DLQ_CLOSURE_SNAPSHOT_DRIFT',
  );
});

test('WooCommerce DLQ closure operator is one-phase, backup-first and has no deploy or Queue path', () => {
  const source = readFileSync(
    new URL('../../scripts/woocommerce-dlq-closure-operator.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /if \(!execute\) printPlan\(\)/u);
  assert.match(source, /const backup = await createBackup[\s\S]*const snapshotBefore/u);
  assert.match(source, /assertWooCommerceDlqClosureSummary/u);
  assert.match(source, /assertWooCommerceDlqClosureNoSnapshotDrift/u);
  assert.doesNotMatch(source, /wrangler', 'deploy/u);
  assert.doesNotMatch(source, /queues\/.*messages/u);
  assert.doesNotMatch(source, /method:\s*'POST'/u);
});

function validSummary() {
  return {
    accepted: true,
    contractVersion: 'woocommerce_final_rollout_v1',
    fullReconciliation: { operationId: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.operationId },
    resumedExactOperation: true,
    parityVerified: true,
    idempotentRerunVerified: true,
    incrementalVerified: true,
    executionFlagsAllFalse: true,
    scheduleEnabled: false,
    production: false,
  };
}

function validSnapshot() {
  const datasetCounts = Object.fromEntries(
    ['store', 'orders', 'products', 'categories', 'customers', 'coupons']
      .map((key) => [key, { expectedRows: 1, sourceRows: 1 }]),
  );
  return {
    sync_run_status: 'success',
    sync_run_finished_at: 1785456000000,
    sync_run_error_code: null,
    work_lifecycle_status: 'completed',
    work_generation: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.generation,
    work_requested_at: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.requestedAt,
    work_completed_at: 1785456000000,
    completion_json: JSON.stringify({
      schemaVersion: 'woocommerce_commerce_reconciliation_v1',
      scopeMode: 'full_inventory',
      failed: 0,
    }),
    phase_complete: 1,
    state_json: JSON.stringify({
      datasetIndex: 6,
      counts: { failedRows: 0 },
      datasetCounts,
    }),
    active_lock_count: 0,
    queue_generation: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.generation,
    queue_original_requested_at: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.requestedAt,
    queue_operation_attempts: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.minimumQueueAttempts,
    coverage_run_count: 6,
    invalid_coverage_count: 0,
    raw_commerce_stores: 1,
    raw_commerce_orders: 1,
    raw_commerce_order_items: 1,
    raw_commerce_products: 1,
    raw_commerce_product_variations: 1,
    raw_commerce_categories: 1,
    raw_commerce_customers: 1,
    raw_commerce_coupons: 1,
    raw_commerce_refunds: 1,
    commerce_store_state: 1,
    commerce_order_state: 1,
    commerce_order_status_observations: 1,
    commerce_order_line_facts: 1,
    commerce_product_state: 1,
    commerce_customer_aggregates: 1,
    commerce_daily_sales_facts: 1,
    commerce_product_daily_facts: 1,
  };
}

function incidentRows(stage) {
  const final = stage === 'final';
  return WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.rows.map((expected) => ({
    dlq_id: expected.dlqId,
    message_id: expected.messageId,
    status: final ? 'redriven' : 'open',
    job_type: 'woocommerce.commerce.sync',
    error_code: expected.errorCode,
    retry_count: expected.retryCount,
    redrive_reference: final ? expected.closureReference : null,
    redriven_at: final ? 1785456000000 : null,
    operation_id: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.operationId,
    original_work_key: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.workKey,
    generation: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.generation,
    original_requested_at: WOOCOMMERCE_DLQ_CLOSURE_INCIDENT.requestedAt,
    main_queue_attempts: expected.mainQueueAttempts,
    dlq_delivery_attempts: expected.dlqDeliveryAttempts,
    recovery_status: final ? 'completed' : 'not_started',
    recovery_reference: final ? expected.closureReference : null,
    recovery_completed_at: final ? 1785456000000 : null,
    audit_reference: final ? expected.closureReference : null,
  }));
}
