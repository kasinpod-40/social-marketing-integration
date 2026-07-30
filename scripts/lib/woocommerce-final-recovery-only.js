import { createHash } from 'node:crypto';
import {
  buildWooCommerceFinalSnapshotSql,
  normalizeWooCommerceFinalSnapshot,
} from './woocommerce-final-rollout-operator.js';
import {
  WOOCOMMERCE_FINAL_FAILED_WORK_REASON,
} from './woocommerce-final-failed-work-recovery.js';

const OPERATION_ID = /^woo-final-(?:full|incremental)-[0-9a-f]{12}$/u;
const EXACT_INCIDENT_OPERATION_ID = 'woo-final-full-5b56469100a9';
const EXACT_INCIDENT_ERROR_CODE = 'WOOCOMMERCE_INVALID_JSON';
const RECOVERY_RETENTION_MS = 7 * 86_400_000;
const INCIDENT_TABLES = Object.freeze([
  Object.freeze(['raw_commerce_stores', 'sync_run_id']),
  Object.freeze(['raw_commerce_orders', 'sync_run_id']),
  Object.freeze(['raw_commerce_order_items', 'sync_run_id']),
  Object.freeze(['raw_commerce_products', 'sync_run_id']),
  Object.freeze(['raw_commerce_product_variations', 'sync_run_id']),
  Object.freeze(['raw_commerce_categories', 'sync_run_id']),
  Object.freeze(['raw_commerce_customers', 'sync_run_id']),
  Object.freeze(['raw_commerce_coupons', 'sync_run_id']),
  Object.freeze(['raw_commerce_refunds', 'sync_run_id']),
  Object.freeze(['commerce_store_state', 'last_sync_run_id']),
  Object.freeze(['commerce_order_state', 'last_sync_run_id']),
  Object.freeze(['commerce_order_status_observations', 'sync_run_id']),
  Object.freeze(['commerce_order_line_facts', 'last_sync_run_id']),
  Object.freeze(['commerce_product_state', 'last_sync_run_id']),
  Object.freeze(['commerce_customer_aggregates', 'last_sync_run_id']),
  Object.freeze(['commerce_daily_sales_facts', 'sync_run_id']),
  Object.freeze(['commerce_product_daily_facts', 'sync_run_id']),
]);

export const WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_WOOCOMMERCE_RECOVERY_ONLY',
  value: 'RECOVER_WOO_FINAL_FULL_5B56469100A9_ONLY',
});

export function parseWooCommerceFinalRecoveryOnlyArgs(args = []) {
  let execute = false;
  let operationId = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg === '--operation-id') {
      operationId = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--operation-id=')) {
      operationId = arg.slice('--operation-id='.length);
      continue;
    }
    throw recoveryOnlyError(
      `Unknown WooCommerce recovery-only argument: ${arg}`,
      'WOOCOMMERCE_RECOVERY_ONLY_ARGUMENT_INVALID',
    );
  }
  const exactOperationId = requireOperationId(operationId);
  if (exactOperationId !== EXACT_INCIDENT_OPERATION_ID) {
    throw recoveryOnlyError(
      'Recovery-only operator is pinned to the approved incident operation',
      'WOOCOMMERCE_RECOVERY_ONLY_OPERATION_NOT_APPROVED',
      { operationIdFingerprint: sha256(exactOperationId) },
    );
  }
  return Object.freeze({ execute, operationId: exactOperationId });
}

export function assertWooCommerceFinalRecoveryOnlyConfirmation(env = {}) {
  const { envName, value } = WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION;
  if (env[envName] !== value) {
    throw recoveryOnlyError(
      `WooCommerce recovery-only execution requires ${envName}=${value}`,
      'WOOCOMMERCE_RECOVERY_ONLY_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function buildWooCommerceFinalRecoveryOnlySnapshotSql(input = {}) {
  const accountKey = requireText(input.accountKey, 'accountKey');
  const operationId = requireApprovedOperationId(input.operationId);
  const syncRunId = `woocommerce:${operationId}`;
  const base = buildWooCommerceFinalSnapshotSql({
    accountKey,
    operationId,
  }).replace(/;\s*$/u, '');
  const incidentCounts = INCIDENT_TABLES.map(([table, column]) => (
    `(SELECT COUNT(*) FROM ${table} WHERE account_key = '${sqlText(accountKey)}' AND ${column} = '${syncRunId}') AS ${incidentAlias(table)}`
  )).join(', ');
  return compactSql(`SELECT base.*, ${incidentCounts} FROM (${base}) AS base;`);
}

export function buildWooCommerceFinalRecoveryOnlyMutationSql(input = {}) {
  const operationId = requireApprovedOperationId(input.operationId);
  const workKey = `woocommerce:${operationId}`;
  const auditReference = requireAuditReference(input.auditReference);
  const now = "unixepoch('now') * 1000";
  const incidentCount = INCIDENT_TABLES.map(([table, column]) => (
    `(SELECT COUNT(*) FROM ${table} WHERE account_key = sr.account_key AND ${column} = sr.sync_run_id)`
  )).join(' + ');
  return compactSql(`
    UPDATE sync_work_runs
    SET lifecycle_status = 'terminal',
        terminal_reason = COALESCE(terminal_reason, '${sqlText(WOOCOMMERCE_FINAL_FAILED_WORK_REASON)}'),
        abandoned_at = COALESCE(abandoned_at, ${now}),
        expires_at = COALESCE(expires_at, ${now} + ${RECOVERY_RETENTION_MS}),
        audit_reference = COALESCE(audit_reference, '${sqlText(auditReference)}'),
        updated_at = ${now}
    WHERE work_key = '${workKey}'
      AND lifecycle_status = 'active'
      AND EXISTS (
        SELECT 1
        FROM sync_runs sr
        WHERE sr.sync_run_id = sync_work_runs.work_key
          AND sr.status = 'failed'
          AND sr.error_code = '${EXACT_INCIDENT_ERROR_CODE}'
          AND sr.platform = 'woocommerce'
          AND sr.account_key = 'chemistry_k'
          AND NOT EXISTS (
            SELECT 1 FROM data_coverage_runs dcr
            WHERE dcr.sync_run_id = sync_work_runs.work_key
          )
          AND (${incidentCount}) = 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM sync_locks sl
        WHERE sl.owner_id = sync_work_runs.work_key
          AND sl.expires_at > ${now}
      );
    SELECT
      changes() AS recovered_rows,
      work_key,
      lifecycle_status,
      terminal_reason,
      audit_reference
    FROM sync_work_runs
    WHERE work_key = '${workKey}';
  `);
}

export function classifyWooCommerceFinalRecoveryOnlyState(row, input = {}) {
  const operationId = requireApprovedOperationId(input.operationId);
  const snapshot = normalizeWooCommerceFinalSnapshot(row);
  if (snapshot.workLifecycleStatus === 'active') {
    return Object.freeze({
      state: 'active_recovery_required',
      result: verifyWooCommerceFinalRecoveryOnlyEligibility(row, { operationId }),
    });
  }
  if (snapshot.workLifecycleStatus === 'terminal') {
    return Object.freeze({
      state: 'terminal_recovery_complete',
      result: verifyWooCommerceFinalRecoveryOnlyPostState(row, { operationId }),
    });
  }
  throw recoveryOnlyError(
    'WooCommerce invalid-JSON incident is neither active-recoverable nor terminal-recovered',
    'WOOCOMMERCE_RECOVERY_ONLY_STATE_INVALID',
    {
      operationIdFingerprint: sha256(operationId),
      workLifecycleStatus: snapshot.workLifecycleStatus,
      syncRunStatus: snapshot.syncRunStatus,
      syncRunErrorCode: snapshot.syncRunErrorCode,
    },
  );
}

export function verifyWooCommerceFinalRecoveryOnlyEligibility(row, input = {}) {
  const operationId = requireApprovedOperationId(input.operationId);
  const snapshot = normalizeWooCommerceFinalSnapshot(row);
  const incidentBusinessRows = countIncidentBusinessRows(row);
  const retainedBusinessRows = totalBusinessRows(snapshot.counts);
  const violations = [];

  if (snapshot.syncRunStatus !== 'failed') violations.push('sync_run_not_failed');
  if (snapshot.syncRunFinishedAt === null) violations.push('sync_run_not_finished');
  if (snapshot.syncRunErrorCode !== EXACT_INCIDENT_ERROR_CODE) {
    violations.push('sync_run_error_not_invalid_json');
  }
  if (snapshot.workLifecycleStatus !== 'active') violations.push('work_not_active');
  if (snapshot.workCompletedAt !== null) violations.push('work_already_completed');
  if (snapshot.completion !== null) violations.push('completion_present');
  if (snapshot.phaseComplete) violations.push('phase_complete');
  if (snapshot.activeLockCount !== 0) violations.push('active_lock_present');
  if (snapshot.queueOperationAttempts !== 1) violations.push('queue_attempt_count_not_one');
  if (snapshot.coverageRunCount !== 0) violations.push('coverage_present');
  if (snapshot.invalidCoverageCount !== 0) violations.push('invalid_coverage_present');
  if (incidentBusinessRows !== 0) violations.push('incident_business_rows_present');

  if (violations.length > 0) {
    throw recoveryOnlyError(
      'WooCommerce operation is not eligible for exact recovery-only mutation',
      'WOOCOMMERCE_RECOVERY_ONLY_PREFLIGHT_REJECTED',
      {
        operationIdFingerprint: sha256(operationId),
        violations: Object.freeze(violations),
        incidentBusinessRows,
        retainedBusinessRows,
        activeLockCount: snapshot.activeLockCount,
        queueOperationAttempts: snapshot.queueOperationAttempts,
        coverageRunCount: snapshot.coverageRunCount,
      },
    );
  }

  return Object.freeze({
    eligible: true,
    operationId,
    workKey: `woocommerce:${operationId}`,
    operationIdFingerprint: sha256(operationId),
    workKeyFingerprint: sha256(`woocommerce:${operationId}`),
    businessRows: incidentBusinessRows,
    incidentBusinessRows,
    retainedBusinessRows,
    snapshot,
  });
}

export function verifyWooCommerceFinalRecoveryOnlyPostState(row, input = {}) {
  const operationId = requireApprovedOperationId(input.operationId);
  const snapshot = normalizeWooCommerceFinalSnapshot(row);
  const incidentBusinessRows = countIncidentBusinessRows(row);
  const retainedBusinessRows = totalBusinessRows(snapshot.counts);
  const violations = [];

  if (snapshot.syncRunStatus !== 'failed') violations.push('sync_run_changed');
  if (snapshot.syncRunErrorCode !== EXACT_INCIDENT_ERROR_CODE) {
    violations.push('sync_run_error_changed');
  }
  if (snapshot.workLifecycleStatus !== 'terminal') violations.push('work_not_terminal');
  if (snapshot.workCompletedAt !== null) violations.push('work_completed_at_changed');
  if (snapshot.completion !== null) violations.push('completion_changed');
  if (snapshot.phaseComplete) violations.push('phase_changed');
  if (snapshot.activeLockCount !== 0) violations.push('active_lock_present');
  if (snapshot.queueOperationAttempts !== 1) violations.push('queue_attempt_count_changed');
  if (snapshot.coverageRunCount !== 0) violations.push('coverage_changed');
  if (snapshot.invalidCoverageCount !== 0) violations.push('invalid_coverage_changed');
  if (incidentBusinessRows !== 0) violations.push('incident_business_rows_changed');

  if (violations.length > 0) {
    throw recoveryOnlyError(
      'WooCommerce recovery-only post-verification failed',
      'WOOCOMMERCE_RECOVERY_ONLY_POST_VERIFY_FAILED',
      {
        operationIdFingerprint: sha256(operationId),
        violations: Object.freeze(violations),
        incidentBusinessRows,
        retainedBusinessRows,
      },
    );
  }

  return Object.freeze({
    verified: true,
    operationIdFingerprint: sha256(operationId),
    workKeyFingerprint: sha256(`woocommerce:${operationId}`),
    businessRows: incidentBusinessRows,
    incidentBusinessRows,
    retainedBusinessRows,
    snapshot,
  });
}

function countIncidentBusinessRows(row = {}) {
  let total = 0;
  for (const [table] of INCIDENT_TABLES) {
    const alias = incidentAlias(table);
    const value = Number(row[alias]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw recoveryOnlyError(
        'WooCommerce recovery-only incident count is invalid',
        'WOOCOMMERCE_RECOVERY_ONLY_INCIDENT_COUNT_INVALID',
        { table },
      );
    }
    total += value;
  }
  return total;
}

function totalBusinessRows(counts = {}) {
  let total = 0;
  for (const [table, value] of Object.entries(counts)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw recoveryOnlyError(
        'WooCommerce recovery-only retained business count is invalid',
        'WOOCOMMERCE_RECOVERY_ONLY_COUNT_INVALID',
        { table },
      );
    }
    total += value;
  }
  return total;
}

function incidentAlias(table) {
  return `incident_${table}`;
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function requireApprovedOperationId(value) {
  const operationId = requireOperationId(value);
  if (operationId !== EXACT_INCIDENT_OPERATION_ID) {
    throw recoveryOnlyError(
      'Recovery-only operator is pinned to the approved incident operation',
      'WOOCOMMERCE_RECOVERY_ONLY_OPERATION_NOT_APPROVED',
      { operationIdFingerprint: sha256(operationId) },
    );
  }
  return operationId;
}

function requireOperationId(value) {
  const text = requireText(value, 'operationId');
  if (!OPERATION_ID.test(text)) {
    throw recoveryOnlyError(
      'WooCommerce recovery-only operation ID is invalid',
      'WOOCOMMERCE_RECOVERY_ONLY_OPERATION_INVALID',
    );
  }
  return text;
}

function requireAuditReference(value) {
  const text = requireText(value, 'auditReference');
  if (!/^woocommerce-final-recovery:[0-9a-f]{40,64}$/u.test(text)) {
    throw recoveryOnlyError(
      'WooCommerce recovery-only audit reference is invalid',
      'WOOCOMMERCE_RECOVERY_ONLY_AUDIT_INVALID',
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw recoveryOnlyError(
      `${fieldName} is required`,
      'WOOCOMMERCE_RECOVERY_ONLY_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function sqlText(value) {
  return String(value).replaceAll("'", "''");
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function recoveryOnlyError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'WooCommerceFinalRecoveryOnlyError';
  error.code = code;
  error.details = details;
  return error;
}
