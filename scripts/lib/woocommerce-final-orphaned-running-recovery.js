import { createHash } from 'node:crypto';
import {
  buildWooCommerceFinalSnapshotSql,
  normalizeWooCommerceFinalSnapshot,
} from './woocommerce-final-rollout-operator.js';

export const WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID =
  'woo-final-full-011368480910';
export const WOOCOMMERCE_ORPHANED_RUNNING_WORK_KEY =
  `woocommerce:${WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID}`;
export const WOOCOMMERCE_ORPHANED_RUNNING_GENERATION = 1785405597071;
export const WOOCOMMERCE_ORPHANED_RUNNING_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_WOOCOMMERCE_ORPHANED_RUNNING_RECOVERY',
  value: 'RECOVER_WOO_FINAL_FULL_011368480910_ONLY',
});

// Final exact continuation already treats this retryable class as resumable.
// The actual orphan cause remains explicit in details_json/error_message.
export const WOOCOMMERCE_ORPHANED_RUNNING_RESUME_ERROR_CODE =
  'WOOCOMMERCE_D1_READ_FAILED';
export const WOOCOMMERCE_ORPHANED_RUNNING_CAUSE_CODE =
  'WOOCOMMERCE_ORPHANED_EXECUTION';

const HISTORY_START_MS = Date.parse('2026-01-01T00:00:00.000Z');
const STABILITY_WINDOW_MS = 30_000;
const EXPECTED_COUNTS = Object.freeze({
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

export function parseWooCommerceOrphanedRunningRecoveryArgs(args = []) {
  let execute = false;
  let operationId = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--execute') {
      execute = true;
    } else if (arg === '--operation-id') {
      operationId = args[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith('--operation-id=')) {
      operationId = arg.slice('--operation-id='.length);
    } else {
      throw recoveryError(
        `Unknown WooCommerce orphaned-running recovery argument: ${arg}`,
        'WOOCOMMERCE_ORPHANED_RUNNING_ARGUMENT_INVALID',
      );
    }
  }
  const exactOperationId = requireOperationId(operationId);
  if (exactOperationId !== WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID) {
    throw recoveryError(
      'Orphaned-running recovery is pinned to the approved operation',
      'WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_NOT_APPROVED',
      { operationIdFingerprint: sha256(exactOperationId) },
    );
  }
  return Object.freeze({ execute, operationId: exactOperationId });
}

export function assertWooCommerceOrphanedRunningRecoveryConfirmation(env = {}) {
  const { envName, value } = WOOCOMMERCE_ORPHANED_RUNNING_CONFIRMATION;
  if (env[envName] !== value) {
    throw recoveryError(
      `Orphaned-running recovery requires ${envName}=${value}`,
      'WOOCOMMERCE_ORPHANED_RUNNING_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function getWooCommerceOrphanedRunningStabilityWindowMs() {
  return STABILITY_WINDOW_MS;
}

export function buildWooCommerceOrphanedRunningSnapshotSql(input = {}) {
  requireExactTarget(input);
  const base = buildWooCommerceFinalSnapshotSql({
    accountKey: 'chemistry_k',
    operationId: WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID,
  }).replace(/;\s*$/u, '');
  const workKey = sqlQuote(WOOCOMMERCE_ORPHANED_RUNNING_WORK_KEY);
  const operationId = sqlQuote(WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID);
  return compactSql(`
    WITH base AS (${base})
    SELECT
      base.*,
      (SELECT started_at FROM sync_runs WHERE sync_run_id = ${workKey})
        AS sync_run_started_at,
      (SELECT updated_at FROM sync_runs WHERE sync_run_id = ${workKey})
        AS sync_run_updated_at,
      (SELECT details_json FROM sync_runs WHERE sync_run_id = ${workKey})
        AS sync_run_details_json,
      (SELECT records_pulled FROM sync_runs WHERE sync_run_id = ${workKey})
        AS sync_run_records_pulled,
      (SELECT records_created FROM sync_runs WHERE sync_run_id = ${workKey})
        AS sync_run_records_created,
      (SELECT records_updated FROM sync_runs WHERE sync_run_id = ${workKey})
        AS sync_run_records_updated,
      (SELECT records_skipped FROM sync_runs WHERE sync_run_id = ${workKey})
        AS sync_run_records_skipped,
      (SELECT records_written FROM sync_runs WHERE sync_run_id = ${workKey})
        AS sync_run_records_written,
      (SELECT retry_count FROM sync_runs WHERE sync_run_id = ${workKey})
        AS sync_run_retry_count,
      (SELECT updated_at FROM sync_work_runs WHERE work_key = ${workKey})
        AS work_updated_at,
      (SELECT terminal_reason FROM sync_work_runs WHERE work_key = ${workKey})
        AS work_terminal_reason,
      (SELECT abandoned_at FROM sync_work_runs WHERE work_key = ${workKey})
        AS work_abandoned_at,
      (SELECT expires_at FROM sync_work_runs WHERE work_key = ${workKey})
        AS work_expires_at,
      (SELECT audit_reference FROM sync_work_runs WHERE work_key = ${workKey})
        AS work_audit_reference,
      (SELECT COUNT(*) FROM sync_work_phases WHERE work_key = ${workKey})
        AS phase_count,
      (SELECT expected_items FROM sync_work_phases
        WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1')
        AS phase_expected_items,
      (SELECT processed_items FROM sync_work_phases
        WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1')
        AS phase_processed_items,
      (SELECT pages_processed FROM sync_work_phases
        WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1')
        AS phase_pages_processed,
      (SELECT chunks_processed FROM sync_work_phases
        WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1')
        AS phase_chunks_processed,
      (SELECT COUNT(*) FROM sync_work_units WHERE work_key = ${workKey})
        AS work_unit_count,
      (SELECT COUNT(*) FROM sync_generation_fences WHERE work_key = ${workKey})
        AS generation_fence_count,
      (SELECT generation FROM sync_generation_fences WHERE work_key = ${workKey})
        AS fence_generation,
      (SELECT requested_at FROM sync_generation_fences WHERE work_key = ${workKey})
        AS fence_requested_at,
      (SELECT COUNT(*) FROM queue_operation_attempts
        WHERE operation_id = ${operationId} AND work_key = ${workKey})
        AS queue_operation_row_count,
      (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active')
        AS active_work_count,
      (SELECT COUNT(*) FROM sync_work_runs
        WHERE lifecycle_status = 'active' AND work_key <> ${workKey})
        AS other_active_work_count,
      unixepoch('now') * 1000 AS observed_at
    FROM base;
  `);
}

export function verifyWooCommerceOrphanedRunningEligibility(row) {
  const evidence = normalizeEvidence(row);
  const violations = validateImmutableIncident(evidence);
  const snapshot = evidence.snapshot;
  if (snapshot.syncRunStatus !== 'running') violations.push('sync_run_not_running');
  if (snapshot.syncRunFinishedAt !== null) violations.push('sync_run_finished');
  if (snapshot.syncRunErrorCode !== null) violations.push('sync_run_error_present');
  if (snapshot.syncRunRetryable !== null) violations.push('sync_run_retryability_present');
  if (snapshot.workLifecycleStatus !== 'active') violations.push('work_not_active');
  if (evidence.activeWorkCount !== 1) violations.push('active_work_count_not_one');
  if (evidence.otherActiveWorkCount !== 0) violations.push('other_active_work_present');
  rejectViolations(violations, evidence, 'PREFLIGHT_REJECTED');
  return Object.freeze({
    eligible: true,
    operationId: WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID,
    workKey: WOOCOMMERCE_ORPHANED_RUNNING_WORK_KEY,
    immutableFingerprint: evidence.immutableFingerprint,
    evidence,
  });
}

export function verifyWooCommerceOrphanedRunningStable(beforeInput, afterInput) {
  const before = requireEligibility(beforeInput, 'before');
  const after = requireEligibility(afterInput, 'after');
  const elapsedMs = after.evidence.observedAt - before.evidence.observedAt;
  if (elapsedMs < STABILITY_WINDOW_MS) {
    throw recoveryError(
      'Orphaned-running stability window is too short',
      'WOOCOMMERCE_ORPHANED_RUNNING_STABILITY_WINDOW_INVALID',
      { elapsedMs, minimumElapsedMs: STABILITY_WINDOW_MS },
    );
  }
  if (before.immutableFingerprint !== after.immutableFingerprint) {
    throw recoveryError(
      'WooCommerce operation changed during orphan stability verification',
      'WOOCOMMERCE_ORPHANED_RUNNING_PROGRESS_OBSERVED',
      {
        beforeFingerprint: before.immutableFingerprint,
        afterFingerprint: after.immutableFingerprint,
        elapsedMs,
      },
    );
  }
  return Object.freeze({
    stable: true,
    elapsedMs,
    immutableFingerprint: after.immutableFingerprint,
    evidence: after.evidence,
  });
}

export function buildWooCommerceOrphanedRunningRecoverySql(input = {}) {
  const stability = input.stability;
  const auditReference = requireAuditReference(input.auditReference);
  if (!stability?.stable
    || stability.immutableFingerprint !== stability.evidence?.immutableFingerprint) {
    throw recoveryError(
      'Verified orphan stability evidence is required',
      'WOOCOMMERCE_ORPHANED_RUNNING_STABILITY_REQUIRED',
    );
  }
  const evidence = stability.evidence;
  const snapshot = evidence.snapshot;
  const workKey = sqlQuote(WOOCOMMERCE_ORPHANED_RUNNING_WORK_KEY);
  const operationId = sqlQuote(WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID);
  const now = "unixepoch('now') * 1000";
  const countGuards = Object.entries(EXPECTED_COUNTS)
    .map(([table, expected]) => (
      `(SELECT COUNT(*) FROM ${table} WHERE account_key = 'chemistry_k') = ${expected}`
    ))
    .join(' AND ');
  const errorMessage =
    'WooCommerce execution became orphaned after bounded verification timeout; exact durable continuation required';
  return compactSql(`
    UPDATE sync_runs
    SET status = 'failed',
        finished_at = ${now},
        error_code = ${sqlQuote(WOOCOMMERCE_ORPHANED_RUNNING_RESUME_ERROR_CODE)},
        error_message = ${sqlQuote(errorMessage)},
        details_json = json_set(
          details_json,
          '$.retryable', json('true'),
          '$.recoveryCauseCode', ${sqlQuote(WOOCOMMERCE_ORPHANED_RUNNING_CAUSE_CODE)},
          '$.recoveryMode', 'exact_durable_continuation',
          '$.recoveryAuditReference', ${sqlQuote(auditReference)}
        ),
        updated_at = ${now}
    WHERE sync_run_id = ${workKey}
      AND status = 'running'
      AND finished_at IS NULL
      AND error_code IS NULL
      AND updated_at = ${evidence.syncRunUpdatedAt}
      AND details_json = ${sqlQuote(evidence.syncRunDetailsJson)}
      AND json_valid(details_json) = 1
      AND EXISTS (
        SELECT 1 FROM sync_work_runs wr
        WHERE wr.work_key = ${workKey}
          AND wr.lifecycle_status = 'active'
          AND wr.completed_at IS NULL
          AND wr.completion_json IS NULL
          AND wr.generation = ${snapshot.workGeneration}
          AND wr.requested_at = ${snapshot.workRequestedAt}
          AND wr.updated_at = ${evidence.workUpdatedAt}
          AND wr.terminal_reason IS NULL
          AND wr.abandoned_at IS NULL
          AND wr.expires_at IS NULL
          AND wr.audit_reference IS NULL
      )
      AND EXISTS (
        SELECT 1 FROM sync_work_phases swp
        WHERE swp.work_key = ${workKey}
          AND swp.phase = 'woocommerce_commerce_pages_v1'
          AND swp.complete = 0
          AND swp.state_json = ${sqlQuote(evidence.stateJson)}
          AND swp.expected_items = ${evidence.phaseExpectedItems}
          AND swp.processed_items = ${evidence.phaseProcessedItems}
          AND swp.pages_processed = ${evidence.phasePagesProcessed}
          AND swp.chunks_processed = ${evidence.phaseChunksProcessed}
      )
      AND (SELECT COUNT(*) FROM sync_work_phases WHERE work_key = ${workKey})
        = ${evidence.phaseCount}
      AND (SELECT COUNT(*) FROM sync_work_units WHERE work_key = ${workKey})
        = ${evidence.workUnitCount}
      AND EXISTS (
        SELECT 1 FROM sync_generation_fences sgf
        WHERE sgf.work_key = ${workKey}
          AND sgf.generation = ${evidence.fenceGeneration}
          AND sgf.requested_at = ${evidence.fenceRequestedAt}
      )
      AND (SELECT COUNT(*) FROM sync_generation_fences WHERE work_key = ${workKey})
        = ${evidence.generationFenceCount}
      AND EXISTS (
        SELECT 1 FROM queue_operation_attempts qoa
        WHERE qoa.operation_id = ${operationId}
          AND qoa.work_key = ${workKey}
          AND qoa.generation = ${snapshot.queueGeneration}
          AND qoa.original_requested_at = ${snapshot.queueOriginalRequestedAt}
          AND qoa.main_queue_attempts = ${snapshot.queueOperationAttempts}
      )
      AND (SELECT COUNT(*) FROM queue_operation_attempts
        WHERE operation_id = ${operationId} AND work_key = ${workKey})
        = ${evidence.queueOperationRowCount}
      AND (SELECT COUNT(*) FROM data_coverage_runs WHERE sync_run_id = ${workKey})
        = ${snapshot.coverageRunCount}
      AND (SELECT COUNT(*) FROM data_coverage_runs
        WHERE sync_run_id = ${workKey}
          AND (failed_rows <> 0
            OR status NOT IN ('complete','no_data_confirmed','revisable')))
        = ${snapshot.invalidCoverageCount}
      AND ${countGuards}
      AND NOT EXISTS (
        SELECT 1 FROM sync_locks
        WHERE owner_id = ${workKey}
          AND expires_at > ${now}
      )
      AND (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') = 1
      AND NOT EXISTS (
        SELECT 1 FROM sync_work_runs
        WHERE lifecycle_status = 'active' AND work_key <> ${workKey}
      );
    SELECT
      changes() AS recovered_rows,
      sync_run_id,
      status,
      finished_at,
      error_code,
      json_extract(details_json, '$.retryable') AS retryable,
      json_extract(details_json, '$.recoveryCauseCode') AS recovery_cause_code,
      json_extract(details_json, '$.recoveryAuditReference') AS recovery_audit_reference
    FROM sync_runs
    WHERE sync_run_id = ${workKey};
  `);
}

export function verifyWooCommerceOrphanedRunningMutation(row, input = {}) {
  const auditReference = requireAuditReference(input.auditReference);
  if (!row || typeof row !== 'object' || Array.isArray(row)
    || count(row.recovered_rows, 'recovered_rows') !== 1
    || row.sync_run_id !== WOOCOMMERCE_ORPHANED_RUNNING_WORK_KEY
    || row.status !== 'failed'
    || nullableNumber(row.finished_at) === null
    || row.error_code !== WOOCOMMERCE_ORPHANED_RUNNING_RESUME_ERROR_CODE
    || nullableBoolean(row.retryable) !== true
    || row.recovery_cause_code !== WOOCOMMERCE_ORPHANED_RUNNING_CAUSE_CODE
    || row.recovery_audit_reference !== auditReference) {
    throw recoveryError(
      'Orphaned-running recovery did not mutate exactly one guarded Sync Run',
      'WOOCOMMERCE_ORPHANED_RUNNING_MUTATION_VERIFY_FAILED',
    );
  }
  return Object.freeze({
    recoveredRows: 1,
    workKeyFingerprint: sha256(WOOCOMMERCE_ORPHANED_RUNNING_WORK_KEY),
    auditReferenceFingerprint: sha256(auditReference),
  });
}

export function verifyWooCommerceOrphanedRunningPostState(row, input = {}) {
  const expectedFingerprint = requireText(
    input.immutableFingerprint,
    'immutableFingerprint',
  );
  const auditReference = requireAuditReference(input.auditReference);
  const evidence = normalizeEvidence(row);
  const violations = validateImmutableIncident(evidence);
  const snapshot = evidence.snapshot;
  if (snapshot.syncRunStatus !== 'failed') violations.push('sync_run_not_failed');
  if (snapshot.syncRunFinishedAt === null) violations.push('sync_run_not_finished');
  if (snapshot.syncRunErrorCode !== WOOCOMMERCE_ORPHANED_RUNNING_RESUME_ERROR_CODE) {
    violations.push('sync_run_error_code_invalid');
  }
  if (snapshot.syncRunRetryable !== true) violations.push('sync_run_not_retryable');
  if (evidence.recoveryCauseCode !== WOOCOMMERCE_ORPHANED_RUNNING_CAUSE_CODE) {
    violations.push('recovery_cause_changed');
  }
  if (evidence.recoveryAuditReference !== auditReference) {
    violations.push('recovery_audit_changed');
  }
  if (snapshot.workLifecycleStatus !== 'active') violations.push('work_not_active');
  if (evidence.activeWorkCount !== 1) violations.push('active_work_count_not_one');
  if (evidence.otherActiveWorkCount !== 0) violations.push('other_active_work_present');
  if (evidence.immutableFingerprint !== expectedFingerprint) {
    violations.push('immutable_state_changed');
  }
  rejectViolations(violations, evidence, 'POST_VERIFY_FAILED');
  return Object.freeze({
    verified: true,
    operationId: WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID,
    immutableFingerprint: evidence.immutableFingerprint,
    evidence,
  });
}

function normalizeEvidence(row = {}) {
  const snapshot = normalizeWooCommerceFinalSnapshot(row);
  const detailsJson = requireJsonObjectText(
    row.sync_run_details_json,
    'sync_run_details_json',
  );
  const details = JSON.parse(detailsJson);
  const stateJson = requireJsonObjectText(row.state_json, 'state_json');
  const evidence = {
    snapshot,
    stateJson,
    syncRunStartedAt: nullableNumber(row.sync_run_started_at),
    syncRunUpdatedAt: safeInteger(row.sync_run_updated_at, 'sync_run_updated_at'),
    syncRunDetailsJson: detailsJson,
    syncRunRecordsPulled: count(row.sync_run_records_pulled, 'sync_run_records_pulled'),
    syncRunRecordsCreated: count(row.sync_run_records_created, 'sync_run_records_created'),
    syncRunRecordsUpdated: count(row.sync_run_records_updated, 'sync_run_records_updated'),
    syncRunRecordsSkipped: count(row.sync_run_records_skipped, 'sync_run_records_skipped'),
    syncRunRecordsWritten: count(row.sync_run_records_written, 'sync_run_records_written'),
    syncRunRetryCount: count(row.sync_run_retry_count, 'sync_run_retry_count'),
    workUpdatedAt: safeInteger(row.work_updated_at, 'work_updated_at'),
    terminalReason: optionalText(row.work_terminal_reason),
    abandonedAt: nullableNumber(row.work_abandoned_at),
    expiresAt: nullableNumber(row.work_expires_at),
    auditReference: optionalText(row.work_audit_reference),
    phaseCount: count(row.phase_count, 'phase_count'),
    phaseExpectedItems: count(row.phase_expected_items, 'phase_expected_items'),
    phaseProcessedItems: count(row.phase_processed_items, 'phase_processed_items'),
    phasePagesProcessed: count(row.phase_pages_processed, 'phase_pages_processed'),
    phaseChunksProcessed: count(row.phase_chunks_processed, 'phase_chunks_processed'),
    workUnitCount: count(row.work_unit_count, 'work_unit_count'),
    generationFenceCount: count(row.generation_fence_count, 'generation_fence_count'),
    fenceGeneration: nullableNumber(row.fence_generation),
    fenceRequestedAt: nullableNumber(row.fence_requested_at),
    queueOperationRowCount: count(row.queue_operation_row_count, 'queue_operation_row_count'),
    activeWorkCount: count(row.active_work_count, 'active_work_count'),
    otherActiveWorkCount: count(row.other_active_work_count, 'other_active_work_count'),
    observedAt: safeInteger(row.observed_at, 'observed_at'),
    recoveryCauseCode: optionalText(details.recoveryCauseCode),
    recoveryAuditReference: optionalText(details.recoveryAuditReference),
  };
  return Object.freeze({
    ...evidence,
    immutableFingerprint: immutableFingerprint(evidence),
  });
}

function validateImmutableIncident(evidence) {
  const snapshot = evidence.snapshot;
  const state = snapshot.state ?? {};
  const violations = [];
  if (snapshot.workCompletedAt !== null) violations.push('work_completed');
  if (snapshot.completion !== null) violations.push('completion_present');
  if (snapshot.phaseComplete) violations.push('phase_complete');
  if (snapshot.activeLockCount !== 0) violations.push('active_lock_present');
  if (snapshot.queueOperationAttempts !== 7) violations.push('queue_attempts_changed');
  if (snapshot.coverageRunCount !== 2) violations.push('coverage_count_changed');
  if (snapshot.invalidCoverageCount !== 1) violations.push('coverage_state_changed');
  if (evidence.queueOperationRowCount !== 1) violations.push('queue_identity_not_unique');
  if (evidence.phaseCount !== 1) violations.push('phase_count_changed');
  if (evidence.generationFenceCount !== 1) violations.push('fence_count_changed');
  if (evidence.terminalReason !== null) violations.push('terminal_reason_present');
  if (evidence.abandonedAt !== null) violations.push('abandoned_at_present');
  if (evidence.expiresAt !== null) violations.push('expires_at_present');
  if (evidence.auditReference !== null) violations.push('audit_reference_present');
  if (snapshot.workGeneration !== WOOCOMMERCE_ORPHANED_RUNNING_GENERATION
    || snapshot.workRequestedAt !== WOOCOMMERCE_ORPHANED_RUNNING_GENERATION
    || snapshot.queueGeneration !== WOOCOMMERCE_ORPHANED_RUNNING_GENERATION
    || snapshot.queueOriginalRequestedAt !== WOOCOMMERCE_ORPHANED_RUNNING_GENERATION
    || evidence.fenceGeneration !== WOOCOMMERCE_ORPHANED_RUNNING_GENERATION
    || evidence.fenceRequestedAt !== WOOCOMMERCE_ORPHANED_RUNNING_GENERATION) {
    violations.push('durable_identity_changed');
  }
  if (state.datasetIndex !== 1 || state.page !== 10) {
    violations.push('phase_cursor_changed');
  }
  if (!exactScope(state.scope)) violations.push('scope_changed');
  if (!exactStoreContext(state.storeContext)) violations.push('store_context_changed');
  if (!exactStateCounts(state.counts)) violations.push('state_counts_changed');
  if (!exactDatasetCounts(state.datasetCounts)) violations.push('dataset_counts_changed');
  for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (snapshot.counts[table] !== expected) {
      violations.push(`business_count_changed:${table}`);
    }
  }
  return violations;
}

function exactScope(scope = {}) {
  return scope.customerKey === 'chemistry_k'
    && scope.accountKey === 'chemistry_k'
    && scope.fullReconciliation === true
    && scope.modifiedAfter === null
    && scope.incrementalBoundary === null
    && scope.orderCreatedAfter === HISTORY_START_MS
    && scope.orderCreatedBefore === WOOCOMMERCE_ORPHANED_RUNNING_GENERATION
    && scope.reportingTimezone === 'Asia/Bangkok'
    && scope.defaultCurrency === 'THB'
    && scope.pageSize === 100
    && scope.maxNestedPages === 100
    && scope.nestedConcurrency === 3
    && scope.revisionLookbackMs === 2_592_000_000;
}

function exactStoreContext(context = {}) {
  return context.reportingTimezone === 'Asia/Bangkok'
    && context.defaultCurrency === 'THB';
}

function exactStateCounts(counts = {}) {
  return counts.pages === 10
    && counts.sourceRows === 901
    && counts.d1Rows === 4_501
    && counts.derivedRows === 1_203
    && counts.larkRows === 3_904
    && counts.failedRows === 0;
}

function exactDatasetCounts(datasets = {}) {
  return exactDataset(datasets.store, {
    pages: 1,
    sourceRows: 1,
    expectedRows: 1,
    d1Rows: 1,
    derivedRows: 0,
    larkRows: 1,
    sourceWatermark: 1785405639860,
  })
    && exactDataset(datasets.orders, {
      pages: 9,
      sourceRows: 900,
      expectedRows: 3_433,
      d1Rows: 4_500,
      derivedRows: 1_203,
      larkRows: 3_903,
      sourceWatermark: 1772037938000,
    })
    && ['products', 'categories', 'customers', 'coupons']
      .every((key) => exactDataset(datasets[key], {
        pages: 0,
        sourceRows: 0,
        expectedRows: 0,
        d1Rows: 0,
        derivedRows: 0,
        larkRows: 0,
        sourceWatermark: null,
      }));
}

function exactDataset(value = {}, expected) {
  return Object.entries(expected).every(([key, item]) => value?.[key] === item);
}

function immutableFingerprint(evidence) {
  return sha256(JSON.stringify({
    syncRunStartedAt: evidence.syncRunStartedAt,
    syncRunUpdatedAt: evidence.syncRunUpdatedAt,
    syncRunDetailsJson: evidence.syncRunDetailsJson,
    syncRunRecordsPulled: evidence.syncRunRecordsPulled,
    syncRunRecordsCreated: evidence.syncRunRecordsCreated,
    syncRunRecordsUpdated: evidence.syncRunRecordsUpdated,
    syncRunRecordsSkipped: evidence.syncRunRecordsSkipped,
    syncRunRecordsWritten: evidence.syncRunRecordsWritten,
    syncRunRetryCount: evidence.syncRunRetryCount,
    workLifecycleStatus: evidence.snapshot.workLifecycleStatus,
    workGeneration: evidence.snapshot.workGeneration,
    workRequestedAt: evidence.snapshot.workRequestedAt,
    workCompletedAt: evidence.snapshot.workCompletedAt,
    completion: evidence.snapshot.completion,
    workUpdatedAt: evidence.workUpdatedAt,
    terminalReason: evidence.terminalReason,
    abandonedAt: evidence.abandonedAt,
    expiresAt: evidence.expiresAt,
    auditReference: evidence.auditReference,
    phaseComplete: evidence.snapshot.phaseComplete,
    stateJson: evidence.stateJson,
    phaseCount: evidence.phaseCount,
    phaseExpectedItems: evidence.phaseExpectedItems,
    phaseProcessedItems: evidence.phaseProcessedItems,
    phasePagesProcessed: evidence.phasePagesProcessed,
    phaseChunksProcessed: evidence.phaseChunksProcessed,
    workUnitCount: evidence.workUnitCount,
    generationFenceCount: evidence.generationFenceCount,
    fenceGeneration: evidence.fenceGeneration,
    fenceRequestedAt: evidence.fenceRequestedAt,
    queueGeneration: evidence.snapshot.queueGeneration,
    queueOriginalRequestedAt: evidence.snapshot.queueOriginalRequestedAt,
    queueOperationAttempts: evidence.snapshot.queueOperationAttempts,
    queueOperationRowCount: evidence.queueOperationRowCount,
    coverageRunCount: evidence.snapshot.coverageRunCount,
    invalidCoverageCount: evidence.snapshot.invalidCoverageCount,
    counts: evidence.snapshot.counts,
  }));
}

function requireEligibility(value, fieldName) {
  if (!value?.eligible || !value.evidence || !value.immutableFingerprint) {
    throw recoveryError(
      `${fieldName} eligibility is required`,
      'WOOCOMMERCE_ORPHANED_RUNNING_ELIGIBILITY_REQUIRED',
      { fieldName },
    );
  }
  return value;
}

function rejectViolations(violations, evidence, suffix) {
  if (violations.length === 0) return;
  throw recoveryError(
    'WooCommerce orphaned-running state is not the approved exact incident',
    `WOOCOMMERCE_ORPHANED_RUNNING_${suffix}`,
    {
      operationIdFingerprint: sha256(WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID),
      violations: Object.freeze(violations),
      immutableFingerprint: evidence.immutableFingerprint,
    },
  );
}

function requireExactTarget(input) {
  if (input.operationId !== WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID
    || input.accountKey !== 'chemistry_k') {
    throw recoveryError(
      'Orphaned-running recovery target is invalid',
      'WOOCOMMERCE_ORPHANED_RUNNING_TARGET_INVALID',
    );
  }
}

function requireOperationId(value) {
  const text = requireText(value, 'operationId');
  if (!/^woo-final-full-[0-9a-f]{12}$/u.test(text)) {
    throw recoveryError(
      'Orphaned-running operation ID is invalid',
      'WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_INVALID',
    );
  }
  return text;
}

function requireAuditReference(value) {
  const text = requireText(value, 'auditReference');
  if (!/^woocommerce-orphan-recovery:[0-9a-f]{40,64}$/u.test(text)) {
    throw recoveryError(
      'Orphaned-running recovery audit reference is invalid',
      'WOOCOMMERCE_ORPHANED_RUNNING_AUDIT_INVALID',
    );
  }
  return text;
}

function requireJsonObjectText(value, fieldName) {
  const text = requireText(value, fieldName);
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
  } catch {
    throw recoveryError(
      `${fieldName} is not a JSON object`,
      'WOOCOMMERCE_ORPHANED_RUNNING_JSON_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw recoveryError(
      `${fieldName} is required`,
      'WOOCOMMERCE_ORPHANED_RUNNING_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function count(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw recoveryError(
      `${fieldName} is invalid`,
      'WOOCOMMERCE_ORPHANED_RUNNING_COUNT_INVALID',
      { fieldName },
    );
  }
  return number;
}

function safeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw recoveryError(
      `${fieldName} is invalid`,
      'WOOCOMMERCE_ORPHANED_RUNNING_INTEGER_INVALID',
      { fieldName },
    );
  }
  return number;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableBoolean(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value === true || value === 1 || value === '1'
    || String(value).toLowerCase() === 'true') return true;
  if (value === false || value === 0 || value === '0'
    || String(value).toLowerCase() === 'false') return false;
  return null;
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function recoveryError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'WooCommerceOrphanedRunningRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
