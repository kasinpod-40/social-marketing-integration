import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WOOCOMMERCE_FINAL_FLAGS,
  WOOCOMMERCE_ORDER_STATUS_OPTIONS,
  assertWooCommerceFinalConfirmation,
  buildWooCommerceConfigWindows,
  buildWooCommerceFinalJob,
  buildWooCommerceLarkSelectOptionRepair,
  buildWooCommerceFinalSnapshotSql,
  classifyWooCommerceFinalCompletion,
  compareWooCommerceParity,
  compareWooCommerceRerun,
  createWooCommerceLarkSchemaContract,
  isWooCommerceExactContinuationSnapshotEmpty,
  normalizeWooCommerceFinalSnapshot,
  parseWooCommerceFinalArgs,
  selectWooCommerceFullOperation,
  verifyWooCommerceLarkSelectOptionRepair,
} from '../../scripts/lib/woocommerce-final-rollout-operator.js';

function configText() {
  const contracts = createWooCommerceLarkSchemaContract();
  return JSON.stringify({ vars: Object.fromEntries([
    ...WOOCOMMERCE_FINAL_FLAGS.map((name) => [name, 'false']),
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
    work_generation: 1785000000000,
    work_requested_at: 1785000000000,
    work_completed_at: 1,
    completion_json: JSON.stringify({ ok: true }),
    phase_complete: 1,
    state_json: JSON.stringify(state),
    active_lock_count: 0,
    queue_generation: 1785000000000,
    queue_original_requested_at: 1785000000000,
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
  const orders = contract.find((item) => item.tableKey === 'mktCommerceOrders');
  const status = orders.fields.find((field) => field.fieldName === 'status');
  assert.equal(status.type, 3);
  assert.equal(status.uiType, 'SingleSelect');
  assert.deepEqual(
    status.property.options.map((option) => option.name),
    WOOCOMMERCE_ORDER_STATUS_OPTIONS,
  );
  assert.equal(WOOCOMMERCE_ORDER_STATUS_OPTIONS.includes('cancelled'), true);
});

test('Lark Select repair preserves existing option IDs and leaves new options unassigned', () => {
  const contract = createWooCommerceLarkSchemaContract()
    .find((item) => item.tableKey === 'mktCommerceOrders')
    .fields.find((field) => field.fieldName === 'status');
  const before = {
    fieldId: 'fld_status',
    fieldName: 'status',
    type: 3,
    uiType: 'SingleSelect',
    description: 'Canonical order status',
    property: {
      options: [
        { id: 'opt_completed', name: 'completed', color: 0 },
        { id: 'opt_on_hold', name: 'on-hold', color: 1 },
      ],
    },
  };
  const repair = buildWooCommerceLarkSelectOptionRepair({
    contractField: contract,
    liveField: before,
  });
  assert.deepEqual(repair.existingOptionNames, ['completed', 'on-hold']);
  assert.equal(repair.addedOptionNames.includes('cancelled'), true);
  assert.deepEqual(
    repair.field.property.options.slice(0, 2).map((option) => option.id),
    ['opt_completed', 'opt_on_hold'],
  );
  assert.equal(repair.field.description, 'Canonical order status');
  assert.equal(
    repair.field.property.options.slice(2).some((option) => 'id' in option),
    false,
  );
  assert.deepEqual(
    repair.field.property.options.slice(0, 2).map((option) => option.name),
    ['completed', 'on-hold'],
  );

  const after = {
    ...before,
    property: {
      options: repair.field.property.options.map((option, index) => ({
        id: `opt_${index}`,
        ...option,
      })),
    },
  };
  assert.equal(verifyWooCommerceLarkSelectOptionRepair({
    beforeField: before,
    afterField: after,
    repair,
  }).accepted, true);
  assert.throws(() => verifyWooCommerceLarkSelectOptionRepair({
    beforeField: before,
    afterField: {
      ...after,
      property: {
        options: after.property.options.map((option) => (
          option.name === 'completed'
            ? { ...option, id: 'opt_replaced' }
            : option
        )),
      },
    },
    repair,
  }), /did not converge/u);
  assert.equal(buildWooCommerceLarkSelectOptionRepair({
    contractField: contract,
    liveField: after,
  }), null);
  assert.equal(buildWooCommerceLarkSelectOptionRepair({
    contractField: contract,
    liveField: { ...before, type: 1, property: null },
  }), null);
  assert.throws(() => verifyWooCommerceLarkSelectOptionRepair({
    beforeField: before,
    afterField: {
      ...after,
      property: {
        options: after.property.options.filter((option) => option.name !== 'completed'),
      },
    },
    repair,
  }), /did not converge/u);
});

test('config windows are exact safe, UAT and all-false closeout flag sets', () => {
  const tableIds = Object.fromEntries(createWooCommerceLarkSchemaContract().map((item, index) => [item.tableKey, `tbl_${index}`]));
  const windows = buildWooCommerceConfigWindows({ configText: configText(), tableIds });
  assert.deepEqual(windows.safeTrueFlags, []);
  assert.deepEqual(windows.uatTrueFlags, [
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED',
    'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
  ]);
  assert.deepEqual(windows.closeoutTrueFlags, []);
  assert.match(windows.closeout, /"LARK_TABLE_RAW_COMMERCE_STORES": "tbl_0"/u);
  assert.equal(windows.closeoutSha256, windows.safeSha256);
});

test('config windows safely materialize omitted default-false gates and Lark mappings', () => {
  const source = `{
    // Canonical local config may omit connector defaults that Runtime treats as false.
    "name": "social-mkt-sync-worker",
    "vars": {
      "MKT_ENV": "development",
      "MKT_CUSTOMER_PROFILE": "integration_workspace",
      "MKT_CONNECTION_CUSTOMER_KEY": "chemistry_k",
      "UNRELATED_NON_SECRET_VALUE": "preserve-me",
    },
  }`;
  const tableIds = Object.fromEntries(createWooCommerceLarkSchemaContract().map((item, index) => [item.tableKey, `tbl_generated_${index}`]));
  const windows = buildWooCommerceConfigWindows({ configText: source, tableIds });
  const safe = JSON.parse(windows.safe);
  const uat = JSON.parse(windows.uat);
  const closeout = JSON.parse(windows.closeout);

  assert.equal(safe.vars.UNRELATED_NON_SECRET_VALUE, 'preserve-me');
  for (const flag of WOOCOMMERCE_FINAL_FLAGS) assert.equal(safe.vars[flag], 'false', flag);
  for (const [index, contract] of createWooCommerceLarkSchemaContract().entries()) {
    assert.equal(safe.vars[contract.envName], `tbl_generated_${index}`, contract.envName);
  }
  assert.equal(uat.vars.MKT_WOOCOMMERCE_D1_WRITE_ENABLED, 'true');
  assert.equal(uat.vars.MKT_SCHEDULE_WOOCOMMERCE_ENABLED, 'false');
  for (const flag of WOOCOMMERCE_FINAL_FLAGS) assert.equal(closeout.vars[flag], 'false', flag);
  assert.deepEqual(windows.safeTrueFlags, []);
  assert.deepEqual(windows.closeoutTrueFlags, []);
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
  assert.match(sql, /MAX\(main_queue_attempts\)/u);
  assert.match(sql, /json_extract\(details_json, '\$\.retryable'\)/u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/iu);
});

test('snapshot normalization is idempotent across raw and normalized contracts', () => {
  const raw = completedSnapshot(7);
  const once = normalizeWooCommerceFinalSnapshot(raw);
  const twice = normalizeWooCommerceFinalSnapshot(once);
  assert.deepEqual(twice, once);
  assert.equal(twice.syncRunStatus, 'success');
  assert.equal(twice.syncRunRetryable, null);
  assert.equal(twice.workLifecycleStatus, 'completed');
  assert.equal(twice.queueOperationAttempts, 7);
  assert.equal(twice.coverageRunCount, 6);
  assert.equal(twice.counts.raw_commerce_orders, 2);
  assert.equal(twice.state.datasetIndex, 6);
});

test('exact continuation accepts only the existing partial failed durable identity', () => {
  const partial = {
    ...completedSnapshot(3),
    sync_run_status: 'failed',
    sync_run_finished_at: 1785000005000,
    sync_run_error_code: 'WOOCOMMERCE_D1_READ_FAILED',
    work_lifecycle_status: 'active',
    work_completed_at: null,
    phase_complete: 0,
    coverage_run_count: 2,
    invalid_coverage_count: 1,
  };
  const selected = selectWooCommerceFullOperation({
    resumeOperationId: 'woo-final-full-e2372e56d52d',
    snapshot: partial,
  });
  assert.equal(selected.operationId, 'woo-final-full-e2372e56d52d');
  assert.equal(selected.requestedAt, 1785000000000);
  assert.equal(selected.priorQueueAttempts, 3);
  assert.equal(selected.resumedExactOperation, true);
  assert.deepEqual(selectWooCommerceFullOperation({
    resumeOperationId: 'woo-final-full-e2372e56d52d',
    snapshot: normalizeWooCommerceFinalSnapshot(partial),
  }), selected);
  assert.equal(selectWooCommerceFullOperation({
    resumeOperationId: 'woo-final-full-e2372e56d52d',
    snapshot: {
      ...partial,
      sync_run_error_code: 'LARK_PREFLIGHT_FAILED',
      sync_run_retryable: 0,
    },
  }).operationId, 'woo-final-full-e2372e56d52d');
  assert.equal(selectWooCommerceFullOperation({}), null);

  assert.throws(() => selectWooCommerceFullOperation({
    resumeOperationId: 'woo-final-full-e2372e56d52d',
    snapshot: { ...partial, work_generation: 1785000000001 },
  }), /preflight rejected/u);
  assert.throws(() => selectWooCommerceFullOperation({
    resumeOperationId: 'woo-final-full-e2372e56d52d',
    snapshot: { ...partial, sync_run_error_code: 'UNRELATED_FAILURE' },
  }), /preflight rejected/u);
  const emptyPartial = { ...partial };
  for (const item of createWooCommerceLarkSchemaContract()) emptyPartial[item.d1Table] = 0;
  assert.throws(() => selectWooCommerceFullOperation({
    resumeOperationId: 'woo-final-full-e2372e56d52d',
    snapshot: emptyPartial,
  }), /preflight rejected/u);
});

test('exact continuation classifies only a fully empty semantic snapshot as retryable', () => {
  assert.equal(isWooCommerceExactContinuationSnapshotEmpty({}), true);
  assert.equal(isWooCommerceExactContinuationSnapshotEmpty({
    raw_commerce_orders: 1,
  }), false);
  assert.equal(isWooCommerceExactContinuationSnapshotEmpty({
    work_lifecycle_status: 'active',
  }), false);
  assert.equal(isWooCommerceExactContinuationSnapshotEmpty({
    queue_operation_attempts: 1,
  }), false);
  assert.equal(isWooCommerceExactContinuationSnapshotEmpty({
    sync_run_retryable: 0,
  }), false);
  assert.equal(isWooCommerceExactContinuationSnapshotEmpty({
    state_json: JSON.stringify({ datasetIndex: 1, page: 2 }),
  }), false);
});

test('final CLI retries semantic-empty exact snapshots before any mutation stage', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-final-rollout-operator.mjs', import.meta.url),
    'utf8',
  );
  const retryIndex = source.indexOf('readExactContinuation(resumeOperationId)');
  const larkIndex = source.indexOf("currentStage = 'lark-schema-additive-repair'");
  assert.ok(retryIndex > 0);
  assert.ok(larkIndex > retryIndex);
  assert.match(source, /woocommerce-final-exact-snapshot-semantic-retry/u);
  assert.match(source, /WOOCOMMERCE_D1_READ_RETRY_DELAYS_MS/u);
  assert.match(source, /businessMutationCount: 0/u);
});

test('completion requires durable work, six Coverage datasets and zero failures', () => {
  assert.equal(classifyWooCommerceFinalCompletion(completedSnapshot(), { fullReconciliation: true }).complete, true);
  assert.equal(classifyWooCommerceFinalCompletion({ ...completedSnapshot(), coverage_run_count: 5 }, { fullReconciliation: true }).complete, false);
  const permanent = classifyWooCommerceFinalCompletion({
    ...completedSnapshot(),
    sync_run_status: 'failed',
    sync_run_error_code: 'LARK_PREFLIGHT_FAILED',
    sync_run_retryable: 0,
    work_lifecycle_status: 'active',
    work_completed_at: null,
    phase_complete: 0,
    coverage_run_count: 2,
    invalid_coverage_count: 1,
  }, { fullReconciliation: true });
  assert.equal(permanent.complete, false);
  assert.equal(permanent.terminalFailure, true);
  assert.equal(permanent.reason, 'woocommerce_terminal_failure');
  assert.equal(classifyWooCommerceFinalCompletion(permanent.snapshot, {
    fullReconciliation: true,
    minimumQueueAttempts: 2,
  }).terminalFailure, false);
  assert.equal(classifyWooCommerceFinalCompletion({
    ...permanent.snapshot,
    queueOperationAttempts: 2,
  }, {
    fullReconciliation: true,
    minimumQueueAttempts: 2,
  }).terminalFailure, true);
  assert.equal(classifyWooCommerceFinalCompletion({
    ...permanent.snapshot,
    syncRunRetryable: true,
  }, { fullReconciliation: true }).terminalFailure, false);
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

test('final CLI deploys all-false Safe closeout and never deploys a scheduled window', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-final-rollout-operator.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /currentStage = 'deploy-safe-closeout'/u);
  assert.match(source, /windows\.closeoutTrueFlags/u);
  assert.match(source, /executionFlagsAllFalse: true/u);
  assert.match(source, /scheduleEnabled: false/u);
  assert.match(source, /classification\.terminalFailure/u);
  assert.match(source, /WOOCOMMERCE_FINAL_OPERATION_TERMINAL_FAILURE/u);
  assert.match(source, /full\.priorQueueAttempts \+ 1/u);
  assert.match(source, /minimumQueueAttempts/u);
  assert.match(source, /buildWooCommerceLarkSelectOptionRepair/u);
  assert.match(source, /larkFieldValueFingerprint/u);
  assert.doesNotMatch(source, /deploy-scheduled-window|scheduled-active-window/u);
  assert.ok(
    source.indexOf("currentStage = 'exact-continuation-preflight'")
      < source.indexOf("currentStage = 'lark-schema-additive-repair'"),
  );
});
