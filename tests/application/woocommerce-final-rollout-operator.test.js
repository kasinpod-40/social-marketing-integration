import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertWooCommerceFinalConfirmation,
  buildWooCommerceConfigWindows,
  buildWooCommerceFinalJob,
  buildWooCommerceFinalSnapshotSql,
  classifyWooCommerceFinalCompletion,
  compareWooCommerceParity,
  compareWooCommerceRerun,
  createWooCommerceLarkSchemaContract,
  parseWooCommerceFinalArgs,
} from '../../scripts/lib/woocommerce-final-rollout-operator.js';

function configText() {
  const flags = [
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_REPORT_READ_ENABLED',
    'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED',
    'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
  ];
  const contracts = createWooCommerceLarkSchemaContract();
  return JSON.stringify({ vars: Object.fromEntries([
    ...flags.map((name) => [name, 'false']),
    ...contracts.map((item) => [item.envName, 'replace-with-table-id']),
  ]) }, null, 2);
}

function completedSnapshot(attempts = 1) {
  const state = {
    datasetIndex: 6,
    counts: { failedRows: 0 },
    datasetCounts: Object.fromEntries(['store', 'orders', 'products', 'categories', 'customers', 'coupons'].map((key) => [key, { expectedRows: 1, sourceRows: 1 }])),
  };
  const row = {
    sync_run_status: 'success',
    sync_run_finished_at: 1,
    sync_run_error_code: null,
    work_lifecycle_status: 'completed',
    work_completed_at: 1,
    completion_json: JSON.stringify({ ok: true }),
    phase_complete: 1,
    state_json: JSON.stringify(state),
    active_lock_count: 0,
    queue_operation_attempts: attempts,
    coverage_run_count: 6,
    invalid_coverage_count: 0,
  };
  for (const item of createWooCommerceLarkSchemaContract()) row[item.d1Table] = 2;
  return row;
}

test('final operator is plan-only by default and needs exact confirmation', () => {
  assert.deepEqual(parseWooCommerceFinalArgs([]), { execute: false });
  assert.deepEqual(parseWooCommerceFinalArgs(['--execute']), { execute: true });
  assert.throws(() => parseWooCommerceFinalArgs(['--phase=deploy']));
  assert.throws(() => assertWooCommerceFinalConfirmation({}));
  assert.equal(assertWooCommerceFinalConfirmation({
    CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT: 'EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT',
  }), true);
});

test('Lark schema contract covers exact 14 mappings and matching key fields', () => {
  const contract = createWooCommerceLarkSchemaContract();
  assert.equal(contract.length, 14);
  assert.equal(new Set(contract.map((item) => item.tableKey)).size, 14);
  assert.equal(new Set(contract.map((item) => item.d1Table)).size, 14);
  for (const item of contract) {
    assert.equal(item.fields[0].fieldName, item.keyField);
    assert.equal(item.fields[0].type, 1);
  }
});

test('config windows are exact safe, UAT and scheduled flag sets', () => {
  const tableIds = Object.fromEntries(createWooCommerceLarkSchemaContract().map((item, index) => [item.tableKey, `tbl_${index}`]));
  const windows = buildWooCommerceConfigWindows({ configText: configText(), tableIds });
  assert.deepEqual(windows.safeTrueFlags, []);
  assert.deepEqual(windows.uatTrueFlags, [
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED',
    'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
  ]);
  assert.deepEqual(windows.scheduledTrueFlags, [
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
    'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
  ]);
  assert.match(windows.scheduled, /"LARK_TABLE_RAW_COMMERCE_STORES": "tbl_0"/u);
});

test('full and incremental Queue jobs use stable WooCommerce identity', () => {
  const full = buildWooCommerceFinalJob({ operationId: 'woo-final-full-12345678', requestedAt: 1785000000000, fullReconciliation: true });
  assert.equal(full.workKey, 'woocommerce:woo-final-full-12345678');
  assert.equal(full.fullReconciliation, true);
  const incremental = buildWooCommerceFinalJob({ operationId: 'woo-final-incremental-12345678', requestedAt: 1785000001000, fullReconciliation: false, modifiedAfter: 1784000000000 });
  assert.equal(incremental.modifiedAfter, 1784000000000);
});

test('snapshot SQL is SELECT-only and scopes operation/account', () => {
  const sql = buildWooCommerceFinalSnapshotSql({ accountKey: 'chemistry_k', operationId: 'woo-final-full-12345678' });
  assert.match(sql, /^SELECT /u);
  assert.match(sql, /woocommerce:woo-final-full-12345678/u);
  assert.match(sql, /commerce_daily_sales_facts/u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/iu);
});

test('completion requires durable work, six Coverage datasets and zero failures', () => {
  assert.equal(classifyWooCommerceFinalCompletion(completedSnapshot(), { fullReconciliation: true }).complete, true);
  assert.equal(classifyWooCommerceFinalCompletion({ ...completedSnapshot(), coverage_run_count: 5 }, { fullReconciliation: true }).complete, false);
});

test('rerun accepts only increased attempt with unchanged Business and Coverage counts', () => {
  assert.equal(compareWooCommerceRerun(completedSnapshot(1), completedSnapshot(2)).accepted, true);
  const drift = completedSnapshot(2);
  drift.raw_commerce_orders = 3;
  assert.throws(() => compareWooCommerceRerun(completedSnapshot(1), drift), /changed Business row counts/u);
});

test('D1/Lark parity checks all 14 table mappings exactly', () => {
  const contract = createWooCommerceLarkSchemaContract();
  const d1Counts = Object.fromEntries(contract.map((item) => [item.d1Table, 4]));
  const larkCounts = Object.fromEntries(contract.map((item) => [item.tableKey, 4]));
  assert.equal(compareWooCommerceParity({ d1Counts, larkCounts }).tableCount, 14);
  larkCounts.rawCommerceOrders = 3;
  assert.throws(() => compareWooCommerceParity({ d1Counts, larkCounts }), /parity mismatch/u);
});
