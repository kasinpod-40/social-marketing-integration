import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONFIRMATION,
  WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
  assertWooCommerceCompletedStateCloseoutConfirmation,
  classifyWooCommerceCompletedStatePoll,
  compareWooCommerceCompletedStateReplay,
  completedStateFingerprint,
  parseWooCommerceCompletedStateCloseoutArgs,
  selectWooCommerceCompletedState,
  validateWooCommerceCompletedStateLarkTables,
  validateWooCommerceCompletedStateRemotePreflight,
} from '../../scripts/lib/woocommerce-final-completed-state-closeout.js';
import {
  createWooCommerceLarkSchemaContract,
} from '../../scripts/lib/woocommerce-final-rollout-operator.js';

const GENERATION = 1785405597071;
const HISTORY_START = Date.parse('2026-01-01T00:00:00.000Z');

function dataset(sourceRows, extra = {}) {
  return {
    pages: 1,
    sourceRows,
    expectedRows: sourceRows,
    d1Rows: sourceRows,
    derivedRows: 0,
    larkRows: sourceRows,
    sourceWatermark: GENERATION,
    ...extra,
  };
}

function completion(overrides = {}) {
  return {
    schemaVersion: 'woocommerce_commerce_reconciliation_v1',
    workKey: `woocommerce:${WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID}`,
    generation: GENERATION,
    scopeMode: 'report_range',
    sourceScope: {
      modifiedAfter: null,
      incrementalBoundary: null,
      orderCreatedAfter: HISTORY_START,
      orderCreatedBefore: GENERATION,
      reportingTimezone: 'Asia/Bangkok',
      defaultCurrency: 'THB',
    },
    datasets: {
      store: dataset(1),
      orders: dataset(3_433),
      products: dataset(12),
      categories: dataset(5),
      customers: dataset(3_200),
      coupons: dataset(4),
    },
    totals: {
      pages: 41,
      sourceRows: 6_655,
      d1Rows: 9_100,
      derivedRows: 2_500,
      larkRows: 8_900,
      failedRows: 0,
    },
    failed: 0,
    ...overrides,
  };
}

function completedSnapshot(overrides = {}) {
  const row = {
    sync_run_status: 'success',
    sync_run_finished_at: GENERATION + 10_000,
    sync_run_error_code: null,
    sync_run_retryable: null,
    work_lifecycle_status: 'completed',
    work_generation: GENERATION,
    work_requested_at: GENERATION,
    work_completed_at: GENERATION + 9_000,
    completion_json: JSON.stringify(completion()),
    phase_complete: 0,
    state_json: null,
    active_lock_count: 0,
    queue_generation: GENERATION,
    queue_original_requested_at: GENERATION,
    queue_operation_attempts: 24,
    coverage_run_count: 6,
    invalid_coverage_count: 0,
    raw_commerce_stores: 1,
    raw_commerce_orders: 3_433,
    raw_commerce_order_items: 3_439,
    raw_commerce_products: 12,
    raw_commerce_product_variations: 2,
    raw_commerce_categories: 5,
    // Historical Raw Customer/Coupon rows are intentionally retained and may exceed 2026 scope.
    raw_commerce_customers: 5_000,
    raw_commerce_coupons: 50,
    raw_commerce_refunds: 3,
    commerce_order_state: 3_433,
    commerce_product_state: 14,
    commerce_customer_aggregates: 3_200,
    commerce_daily_sales_facts: 210,
    commerce_product_daily_facts: 700,
    ...overrides,
  };
  return row;
}

function incrementalSnapshot(overrides = {}) {
  const operationId = 'woo-final-incremental-abcdef123456';
  const requestedAt = GENERATION + 100_000;
  const value = completion({
    workKey: `woocommerce:${operationId}`,
    generation: requestedAt,
    sourceScope: {
      modifiedAfter: GENERATION,
      incrementalBoundary: '2026-07-30T00:00:00.000Z',
      orderCreatedAfter: HISTORY_START,
      orderCreatedBefore: requestedAt,
      reportingTimezone: 'Asia/Bangkok',
      defaultCurrency: 'THB',
    },
    datasets: {
      store: dataset(1),
      orders: dataset(2),
      products: dataset(1),
      categories: dataset(0),
      customers: dataset(1),
      coupons: dataset(0),
    },
    totals: {
      pages: 6,
      sourceRows: 5,
      d1Rows: 12,
      derivedRows: 4,
      larkRows: 10,
      failedRows: 0,
    },
  });
  return {
    ...completedSnapshot(),
    work_generation: requestedAt,
    work_requested_at: requestedAt,
    work_completed_at: requestedAt + 9_000,
    completion_json: JSON.stringify(value),
    queue_generation: requestedAt,
    queue_original_requested_at: requestedAt,
    queue_operation_attempts: 1,
    ...overrides,
  };
}

test('completed-state closeout requires exact argument and confirmation', () => {
  assert.deepEqual(parseWooCommerceCompletedStateCloseoutArgs([]), { execute: false });
  assert.deepEqual(parseWooCommerceCompletedStateCloseoutArgs(['--execute']), { execute: true });
  assert.throws(
    () => parseWooCommerceCompletedStateCloseoutArgs(['--force']),
    (error) => error?.code === 'WOOCOMMERCE_COMPLETED_STATE_ARGUMENT_INVALID',
  );
  assert.equal(assertWooCommerceCompletedStateCloseoutConfirmation({
    CONFIRM_WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT:
      WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONFIRMATION,
  }), true);
  assert.throws(
    () => assertWooCommerceCompletedStateCloseoutConfirmation({}),
    (error) => error?.code === 'WOOCOMMERCE_COMPLETED_STATE_CONFIRMATION_REQUIRED',
  );
});

test('exact completed Full admission uses completion_json after phase retirement', () => {
  const selected = selectWooCommerceCompletedState({
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    snapshot: completedSnapshot(),
    fullReconciliation: true,
    requireCurrentSourceParity: true,
  });
  assert.equal(selected.operationId, WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID);
  assert.equal(selected.requestedAt, GENERATION);
  assert.equal(selected.priorQueueAttempts, 24);
  assert.equal(selected.reusedCompletedOperation, true);
  assert.equal(selected.snapshot.phaseComplete, false);
  assert.equal(selected.snapshot.state, null);
  assert.equal(selected.datasetSummary.datasetCount, 6);
  assert.equal(selected.datasetSummary.failedRows, 0);
  assert.equal(typeof selected.completionFingerprint, 'string');
});

test('retained historical Customer and Coupon Raw rows do not invalidate 2026 completion', () => {
  const selected = selectWooCommerceCompletedState({
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    snapshot: completedSnapshot({
      raw_commerce_customers: 9_000,
      raw_commerce_coupons: 900,
    }),
    fullReconciliation: true,
  });
  assert.equal(selected.completion.datasets.customers.sourceRows, 3_200);
  assert.equal(selected.snapshot.counts.raw_commerce_customers, 9_000);
  assert.equal(selected.snapshot.counts.raw_commerce_coupons, 900);
});

test('initial Full admission rejects current cleaned-range Source drift', () => {
  assert.throws(
    () => selectWooCommerceCompletedState({
      operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
      snapshot: completedSnapshot({ raw_commerce_orders: 3_432 }),
      fullReconciliation: true,
      requireCurrentSourceParity: true,
    }),
    (error) => error?.code === 'WOOCOMMERCE_COMPLETED_STATE_SOURCE_COUNT_DRIFT',
  );
});

test('incremental completed state does not compare delta Source rows to current totals', () => {
  const selected = selectWooCommerceCompletedState({
    operationId: 'woo-final-incremental-abcdef123456',
    snapshot: incrementalSnapshot(),
    fullReconciliation: false,
    requireCurrentSourceParity: false,
  });
  assert.equal(selected.fullReconciliation, false);
  assert.equal(selected.completion.datasets.orders.sourceRows, 2);
  assert.equal(selected.snapshot.counts.raw_commerce_orders, 3_433);
});

test('completed-state admission rejects identity, scope, coverage and retained phase drift', () => {
  assert.throws(
    () => selectWooCommerceCompletedState({
      operationId: 'woo-final-full-abcdef123456',
      snapshot: completedSnapshot(),
      fullReconciliation: true,
    }),
    (error) => error?.code === 'WOOCOMMERCE_COMPLETED_STATE_INVALID'
      && error?.details?.exactFullIdentity === false,
  );
  const wrongScope = completion();
  wrongScope.sourceScope.orderCreatedAfter = Date.parse('2025-01-01T00:00:00.000Z');
  assert.throws(
    () => selectWooCommerceCompletedState({
      snapshot: completedSnapshot({ completion_json: JSON.stringify(wrongScope) }),
    }),
    (error) => error?.code === 'WOOCOMMERCE_COMPLETED_STATE_INVALID',
  );
  assert.throws(
    () => selectWooCommerceCompletedState({
      snapshot: completedSnapshot({ coverage_run_count: 5 }),
    }),
    (error) => error?.code === 'WOOCOMMERCE_COMPLETED_STATE_INVALID',
  );
  assert.throws(
    () => selectWooCommerceCompletedState({
      snapshot: completedSnapshot({
        phase_complete: 1,
        state_json: JSON.stringify({ datasetIndex: 6 }),
      }),
    }),
    (error) => error?.code === 'WOOCOMMERCE_COMPLETED_STATE_INVALID',
  );
});

test('poll classifier accepts completed state and identifies permanent failure only', () => {
  const complete = classifyWooCommerceCompletedStatePoll({
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    snapshot: completedSnapshot(),
    fullReconciliation: true,
    minimumQueueAttempts: 24,
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.terminalFailure, false);
  const permanent = classifyWooCommerceCompletedStatePoll({
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    snapshot: completedSnapshot({
      sync_run_status: 'failed',
      sync_run_error_code: 'PERMANENT_FAILURE',
      sync_run_retryable: 0,
      work_lifecycle_status: 'terminal',
      queue_operation_attempts: 25,
    }),
    fullReconciliation: true,
    minimumQueueAttempts: 25,
  });
  assert.equal(permanent.complete, false);
  assert.equal(permanent.terminalFailure, true);
});

test('same completed operation replay requires attempt growth and immutable facts', () => {
  const before = completedSnapshot();
  const after = completedSnapshot({ queue_operation_attempts: 25 });
  const result = compareWooCommerceCompletedStateReplay(
    { snapshot: before, fullReconciliation: true },
    { snapshot: after, fullReconciliation: true },
  );
  assert.equal(result.accepted, true);
  assert.equal(result.businessCountDrift, false);
  assert.equal(result.coverageDrift, false);
  assert.throws(
    () => compareWooCommerceCompletedStateReplay(
      { snapshot: before, fullReconciliation: true },
      { snapshot: completedSnapshot({ queue_operation_attempts: 24 }), fullReconciliation: true },
    ),
    (error) => error?.code === 'WOOCOMMERCE_COMPLETED_STATE_REPLAY_INVALID',
  );
  assert.throws(
    () => compareWooCommerceCompletedStateReplay(
      { snapshot: before, fullReconciliation: true },
      {
        snapshot: completedSnapshot({
          queue_operation_attempts: 25,
          raw_commerce_order_items: 3_440,
        }),
        fullReconciliation: true,
      },
    ),
    (error) => error?.code === 'WOOCOMMERCE_COMPLETED_STATE_REPLAY_INVALID',
  );
});

test('completion fingerprint ignores observer timestamps and current counts but not completion', () => {
  const before = completedStateFingerprint({
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    snapshot: completedSnapshot(),
  });
  const afterCurrentChange = completedStateFingerprint({
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    snapshot: completedSnapshot({
      sync_run_finished_at: GENERATION + 20_000,
      raw_commerce_orders: 3_434,
    }),
  });
  assert.equal(afterCurrentChange, before);
  const changedCompletion = completion();
  changedCompletion.sourceScope.defaultCurrency = 'USD';
  assert.notEqual(completedStateFingerprint({
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    snapshot: completedSnapshot({ completion_json: JSON.stringify(changedCompletion) }),
  }), before);
});

test('remote preflight requires zero active reliability state and pre-2026 facts', () => {
  const clean = validateWooCommerceCompletedStateRemotePreflight({
    active_work: 0,
    active_locks: 0,
    active_queue_operations: 0,
    old_raw_order_items: 0,
    old_raw_refunds: 0,
    old_raw_orders: 0,
    old_order_status_observations: 0,
    old_order_line_facts: 0,
    old_order_state: 0,
    old_daily: 0,
    old_product_daily: 0,
  });
  assert.deepEqual(clean, {
    activeWork: 0,
    activeLocks: 0,
    activeQueueOperations: 0,
    oldRows: 0,
  });
  assert.throws(
    () => validateWooCommerceCompletedStateRemotePreflight({
      active_work: 1,
      active_locks: 0,
      active_queue_operations: 1,
    }),
    (error) => error?.code === 'WOOCOMMERCE_COMPLETED_STATE_REMOTE_PREFLIGHT_INVALID',
  );
});

test('Lark table admission reuses exact configured table IDs without schema creation', () => {
  const contracts = createWooCommerceLarkSchemaContract();
  const env = Object.fromEntries(
    contracts.map((contract, index) => [contract.envName, `tbl_${index}`]),
  );
  const liveTables = contracts.map((contract, index) => ({
    tableId: `tbl_${index}`,
    name: contract.tableName,
  }));
  const tableIds = validateWooCommerceCompletedStateLarkTables({ env, liveTables });
  assert.equal(Object.keys(tableIds).length, contracts.length);
  assert.equal(tableIds.mktCommerceOrders, env.LARK_TABLE_MKT_COMMERCE_ORDERS);
  assert.throws(
    () => validateWooCommerceCompletedStateLarkTables({
      env,
      liveTables: liveTables.slice(1),
    }),
    (error) => error?.code === 'WOOCOMMERCE_COMPLETED_STATE_LARK_TABLE_INVALID',
  );
});

test('operator closes from exact completed state without replacement Full admission', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-final-completed-state-closeout.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /woo-final-full-011368480910|WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID/u);
  assert.doesNotMatch(source, /createOperation\(['"]full['"]\)/u);
  assert.doesNotMatch(source, /orphaned-running-recovery|ORPHANED_SYNC_MARKED_RETRYABLE/u);
  assert.match(source, /initialFullQueueMessageSent:\s*false/u);
  assert.match(source, /requireCurrentSourceParity:\s*true/u);
  assert.match(source, /requireCurrentSourceParity:\s*false/u);
  assert.match(source, /WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE/u);
  assert.match(source, /WOOCOMMERCE_2026_COMPLETED_SAFE/u);
  assert.match(source, /automatic-safe-restore/u);
  assert.match(source, /gitText\(\['fetch', 'origin', 'main', '--quiet'\]\)/u);
  assert.match(source, /\['npm', \['ci'\]\]/u);
  assert.match(source, /\['npm', \['test'\]\]/u);
  assert.match(source, /test:report-reliability/u);
  assert.match(source, /audit-level=high/u);
  assert.match(source, /deploy:dry-run/u);
  assert.ok(
    source.indexOf("currentStage = 'd1-lark-parity'")
      < source.indexOf("currentStage = 'same-completed-operation-idempotent-replay'"),
  );
  assert.ok(
    source.indexOf("currentStage = 'fresh-d1-backup'")
      < source.indexOf("currentStage = 'manual-uat-window'"),
  );
});
