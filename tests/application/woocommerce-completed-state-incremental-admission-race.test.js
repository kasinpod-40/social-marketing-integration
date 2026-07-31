import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifyWooCommerceCompletedStatePoll,
} from '../../scripts/lib/woocommerce-final-completed-state-closeout.js';
import {
  WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_ERROR_CODE,
  WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONFIRMATION,
  assertWooCommerceIncrementalAdmissionRaceRecoveryConfirmation,
  buildWooCommerceIncrementalAdmissionRaceClosureSql,
  buildWooCommerceIncrementalAdmissionRaceStateSql,
  parseWooCommerceIncrementalAdmissionRaceRecoveryArgs,
  validateWooCommerceIncrementalAdmissionRaceIncident,
  validateWooCommerceIncrementalAdmissionRaceRecovered,
} from '../../scripts/lib/woocommerce-completed-state-incremental-admission-race-recovery.js';

const REQUESTED_AT = 1785480000000;
const OPERATION_ID = 'woo-final-incremental-abcdef123456';
const HISTORY_START = Date.parse('2026-01-01T00:00:00.000Z');

function dataset(sourceRows = 0) {
  return {
    pages: sourceRows > 0 ? 1 : 0,
    sourceRows,
    expectedRows: sourceRows,
    d1Rows: sourceRows,
    derivedRows: 0,
    larkRows: sourceRows,
    failedRows: 0,
  };
}

function completedIncrementalSnapshot(overrides = {}) {
  const completion = {
    schemaVersion: 'woocommerce_commerce_reconciliation_v1',
    workKey: `woocommerce:${OPERATION_ID}`,
    generation: REQUESTED_AT,
    scopeMode: 'report_range',
    sourceScope: {
      modifiedAfter: REQUESTED_AT - 86_400_000,
      incrementalBoundary: '2026-07-30T00:00:00.000Z',
      orderCreatedAfter: HISTORY_START,
      orderCreatedBefore: REQUESTED_AT,
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
      pages: 5,
      sourceRows: 5,
      d1Rows: 5,
      derivedRows: 0,
      larkRows: 5,
      failedRows: 0,
    },
    failed: 0,
  };
  return {
    sync_run_status: 'success',
    sync_run_finished_at: REQUESTED_AT + 10_000,
    sync_run_error_code: null,
    sync_run_retryable: null,
    work_lifecycle_status: 'completed',
    work_generation: REQUESTED_AT,
    work_requested_at: REQUESTED_AT,
    work_completed_at: REQUESTED_AT + 9_000,
    completion_json: JSON.stringify(completion),
    phase_complete: 0,
    state_json: null,
    active_lock_count: 0,
    queue_generation: REQUESTED_AT,
    queue_original_requested_at: REQUESTED_AT,
    queue_operation_attempts: 2,
    coverage_run_count: 6,
    invalid_coverage_count: 0,
    ...overrides,
  };
}

function exactIncident(overrides = {}) {
  return {
    queue_rows: 1,
    queue_attempts: 1,
    queue_generation_min: REQUESTED_AT,
    queue_generation_max: REQUESTED_AT,
    queue_original_min: REQUESTED_AT,
    queue_original_max: REQUESTED_AT,
    metadata_rows: 1,
    recovery_status: 'not_started',
    metadata_generation: REQUESTED_AT,
    metadata_original_requested_at: REQUESTED_AT,
    terminal_dlq_rows: 1,
    terminal_dlq_status: 'open',
    terminal_error_code: WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_ERROR_CODE,
    terminal_retry_count: 1,
    terminal_job_type: 'woocommerce.commerce.sync',
    message_identity_matches: 1,
    sync_rows: 0,
    sync_status: null,
    sync_error_code: null,
    work_rows: 0,
    work_lifecycle_status: null,
    completion_present: 0,
    phase_rows: 0,
    coverage_rows: 0,
    invalid_coverage_rows: 0,
    active_locks: 0,
    ...overrides,
  };
}

function recoveredIncident(overrides = {}) {
  return exactIncident({
    queue_attempts: 2,
    recovery_status: 'completed',
    terminal_dlq_status: 'redriven',
    message_identity_matches: 0,
    sync_rows: 1,
    sync_status: 'success',
    work_rows: 1,
    work_lifecycle_status: 'completed',
    completion_present: 1,
    coverage_rows: 6,
    ...overrides,
  });
}

test('recovery is plan-only by default and requires exact confirmation', () => {
  assert.deepEqual(
    parseWooCommerceIncrementalAdmissionRaceRecoveryArgs([]),
    { execute: false },
  );
  assert.deepEqual(
    parseWooCommerceIncrementalAdmissionRaceRecoveryArgs(['--execute']),
    { execute: true },
  );
  assert.throws(
    () => parseWooCommerceIncrementalAdmissionRaceRecoveryArgs(['--force']),
    (error) => error?.code === 'WOOCOMMERCE_INCREMENTAL_RACE_ARGUMENT_INVALID',
  );
  assert.throws(
    () => assertWooCommerceIncrementalAdmissionRaceRecoveryConfirmation({}),
    (error) => error?.code === 'WOOCOMMERCE_INCREMENTAL_RACE_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertWooCommerceIncrementalAdmissionRaceRecoveryConfirmation({
    CONFIRM_WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY:
      WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONFIRMATION,
  }), true);
});

test('poll keeps the UAT window active while Queue admission is not visible', () => {
  const result = classifyWooCommerceCompletedStatePoll({
    operationId: OPERATION_ID,
    snapshot: {},
    fullReconciliation: false,
    requireCurrentSourceParity: false,
    minimumQueueAttempts: 1,
  });
  assert.equal(result.complete, false);
  assert.equal(result.terminalFailure, false);
  assert.equal(result.pendingAdmission, true);
  assert.equal(result.pendingExecution, true);
});

test('poll treats Queue attempt without Sync or Work as pending execution', () => {
  const result = classifyWooCommerceCompletedStatePoll({
    operationId: OPERATION_ID,
    snapshot: {
      queue_generation: REQUESTED_AT,
      queue_original_requested_at: REQUESTED_AT,
      queue_operation_attempts: 1,
    },
    fullReconciliation: false,
    requireCurrentSourceParity: false,
    minimumQueueAttempts: 1,
  });
  assert.equal(result.complete, false);
  assert.equal(result.terminalFailure, false);
  assert.equal(result.pendingAdmission, false);
  assert.equal(result.pendingExecution, true);
});

test('poll treats running Sync and active durable Work as pending execution', () => {
  const result = classifyWooCommerceCompletedStatePoll({
    operationId: OPERATION_ID,
    snapshot: {
      sync_run_status: 'running',
      work_lifecycle_status: 'active',
      work_generation: REQUESTED_AT,
      work_requested_at: REQUESTED_AT,
      queue_generation: REQUESTED_AT,
      queue_original_requested_at: REQUESTED_AT,
      queue_operation_attempts: 2,
    },
    fullReconciliation: false,
    requireCurrentSourceParity: false,
    minimumQueueAttempts: 2,
  });
  assert.equal(result.complete, false);
  assert.equal(result.pendingAdmission, false);
  assert.equal(result.pendingExecution, true);
});

test('poll still accepts exact completed Incremental state', () => {
  const result = classifyWooCommerceCompletedStatePoll({
    operationId: OPERATION_ID,
    snapshot: completedIncrementalSnapshot(),
    fullReconciliation: false,
    requireCurrentSourceParity: false,
    minimumQueueAttempts: 2,
  });
  assert.equal(result.complete, true);
  assert.equal(result.terminalFailure, false);
  assert.equal(result.pendingAdmission, false);
  assert.equal(result.pendingExecution, false);
  assert.equal(result.selected.operationId, OPERATION_ID);
});

test('exact read-only incident contract admits only the observed safe-restored race', () => {
  const accepted = validateWooCommerceIncrementalAdmissionRaceIncident({
    operationId: OPERATION_ID,
    requestedAt: REQUESTED_AT,
    state: exactIncident(),
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.state.syncRows, 0);
  assert.equal(accepted.state.workRows, 0);
  assert.throws(
    () => validateWooCommerceIncrementalAdmissionRaceIncident({
      operationId: OPERATION_ID,
      requestedAt: REQUESTED_AT,
      state: exactIncident({ terminal_error_code: 'OTHER_ERROR' }),
    }),
    (error) => error?.code === 'WOOCOMMERCE_INCREMENTAL_RACE_INCIDENT_INVALID',
  );
  assert.throws(
    () => validateWooCommerceIncrementalAdmissionRaceIncident({
      operationId: OPERATION_ID,
      requestedAt: REQUESTED_AT,
      state: exactIncident({ work_rows: 1 }),
    }),
    (error) => error?.code === 'WOOCOMMERCE_INCREMENTAL_RACE_INCIDENT_INVALID',
  );
  assert.throws(
    () => validateWooCommerceIncrementalAdmissionRaceIncident({
      operationId: OPERATION_ID,
      requestedAt: REQUESTED_AT + 1,
      state: exactIncident(),
    }),
    (error) => error?.code === 'WOOCOMMERCE_INCREMENTAL_RACE_INCIDENT_INVALID',
  );
});

test('recovered contract requires the same operation, completion, Coverage and exact DLQ closure', () => {
  const accepted = validateWooCommerceIncrementalAdmissionRaceRecovered({
    operationId: OPERATION_ID,
    requestedAt: REQUESTED_AT,
    state: recoveredIncident(),
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.state.queueAttempts, 2);
  assert.equal(accepted.state.coverageRows, 6);
  assert.equal(accepted.state.messageIdentityMatches, false);
  assert.throws(
    () => validateWooCommerceIncrementalAdmissionRaceRecovered({
      operationId: OPERATION_ID,
      requestedAt: REQUESTED_AT,
      state: recoveredIncident({ recovery_status: 'not_started' }),
    }),
    (error) => error?.code === 'WOOCOMMERCE_INCREMENTAL_RACE_RECOVERY_INCOMPLETE',
  );
  assert.throws(
    () => validateWooCommerceIncrementalAdmissionRaceRecovered({
      operationId: OPERATION_ID,
      requestedAt: REQUESTED_AT,
      state: recoveredIncident({ coverage_rows: 5 }),
    }),
    (error) => error?.code === 'WOOCOMMERCE_INCREMENTAL_RACE_RECOVERY_INCOMPLETE',
  );
});

test('incident SQL is exact and closure mutates only DLQ recovery metadata', () => {
  const readSql = buildWooCommerceIncrementalAdmissionRaceStateSql({
    operationId: OPERATION_ID,
  });
  assert.match(readSql, /^SELECT /u);
  assert.match(readSql, /queue_operation_attempts/u);
  assert.match(readSql, /dead_letter_operation_metadata/u);
  assert.match(readSql, /dead_letter_jobs/u);
  assert.doesNotMatch(readSql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/iu);

  const closureSql = buildWooCommerceIncrementalAdmissionRaceClosureSql({
    operationId: OPERATION_ID,
    requestedAt: REQUESTED_AT,
    completedAt: REQUESTED_AT + 100_000,
    recoveryReference: 'recovery:test',
  });
  assert.match(closureSql, /^UPDATE dead_letter_jobs/u);
  assert.match(closureSql, /UPDATE dead_letter_operation_metadata/u);
  assert.match(closureSql, /WOOCOMMERCE_CONNECTOR_INVALID/u);
  assert.match(closureSql, /job_type='woocommerce\.commerce\.sync'/u);
  assert.match(closureSql, /retry_count=1/u);
  assert.doesNotMatch(closureSql, /\b(?:BEGIN|COMMIT|DELETE)\b/iu);
  assert.doesNotMatch(
    closureSql,
    /(?:raw_commerce_|commerce_order_|commerce_product_|commerce_daily_)/u,
  );
});

test('guarded operator preserves exact source evidence and mutation ordering', async () => {
  const source = await readFile(
    new URL(
      '../../scripts/woocommerce-completed-state-incremental-admission-race-recovery.mjs',
      import.meta.url,
    ),
    'utf8',
  );
  const backupIndex = source.indexOf("currentStage = 'fresh-d1-backup'");
  const deploymentIndex = source.indexOf("currentStage = 'temporary-woo-uat-window'");
  const sendIndex = source.indexOf(
    "currentStage = 'same-incremental-operation-recovery-send-or-verify'",
  );
  const completionIndex = source.indexOf(
    "currentStage = 'incremental-completion-and-d1-lark-parity'",
  );
  const closureIndex = source.indexOf("currentStage = 'exact-dlq-metadata-closeout'");
  const safeIndex = source.indexOf("currentStage = 'automatic-all-false-safe-restore'");
  assert.ok(backupIndex >= 0);
  assert.ok(deploymentIndex > backupIndex);
  assert.ok(sendIndex > deploymentIndex);
  assert.ok(completionIndex > sendIndex);
  assert.ok(closureIndex > completionIndex);
  assert.ok(safeIndex > closureIndex);
  assert.match(source, /delete queueBootstrapEnv\.MKT_WOOCOMMERCE_FINAL_QUEUE_ID/u);
  assert.match(source, /sourceEvidence\.job/u);
  assert.match(source, /minimumQueueAttempts:\s*2/u);
  assert.match(source, /replacementIncrementalOperation:\s*false/u);
  assert.match(source, /businessMutationCount:\s*0/u);
  assert.doesNotMatch(source, /createOperation\(['"]full['"]\)/u);
});

test('public launcher binds recovery evidence to exact repository Head', async () => {
  const source = await readFile(
    new URL(
      '../../scripts/woocommerce-completed-state-incremental-admission-race-recovery-launcher.mjs',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /git', \['rev-parse', 'HEAD'\]/u);
  assert.match(source, /MKT_WOOCOMMERCE_INCREMENTAL_RACE_PUBLIC_LAUNCHER/u);
  assert.match(source, /join\(evidenceBase, repositoryHead\)/u);
  assert.match(
    source,
    /woocommerce-completed-state-incremental-admission-race-recovery\.mjs/u,
  );
});
