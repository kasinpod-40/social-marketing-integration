import { createHash } from 'node:crypto';
import {
  buildWooCommerceFinalSnapshotSql,
  normalizeWooCommerceFinalSnapshot,
} from './woocommerce-final-rollout-operator.js';

const OPERATION_ID = /^woo-final-(?:full|incremental)-[0-9a-f]{12}$/u;
const ORIGINAL_INCIDENT_OPERATION_ID = 'woo-final-full-e486b03cfe8d';
const INVALID_JSON_INCIDENT_OPERATION_ID = 'woo-final-full-6f43ac8ee857';

const APPROVED_INCIDENTS = Object.freeze({
  [ORIGINAL_INCIDENT_OPERATION_ID]: Object.freeze({
    operationId: ORIGINAL_INCIDENT_OPERATION_ID,
    expectedErrorCode: 'WOOCOMMERCE_NETWORK_ERROR',
    confirmation: Object.freeze({
      envName: 'CONFIRM_WOOCOMMERCE_RECOVERY_ONLY',
      value: 'RECOVER_WOO_FINAL_FULL_E486B03CFE8D_ONLY',
    }),
    nextAction: 'run_read_only_inspector_then_authorize_guarded_final_rollout',
  }),
  [INVALID_JSON_INCIDENT_OPERATION_ID]: Object.freeze({
    operationId: INVALID_JSON_INCIDENT_OPERATION_ID,
    expectedErrorCode: 'WOOCOMMERCE_INVALID_JSON',
    confirmation: Object.freeze({
      envName: 'CONFIRM_WOOCOMMERCE_RECOVERY_ONLY',
      value: 'RECOVER_WOO_FINAL_FULL_6F43AC8EE857_ONLY',
    }),
    nextAction: 'run_read_only_inspector_then_separately_authorize_provider_response_diagnostics',
  }),
});

// Backward-compatible export for the original exact incident. New callers should resolve by operation.
export const WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION =
  APPROVED_INCIDENTS[ORIGINAL_INCIDENT_OPERATION_ID].confirmation;

export function resolveWooCommerceFinalRecoveryOnlyIncident(operationId) {
  const exactOperationId = requireOperationId(operationId);
  const incident = APPROVED_INCIDENTS[exactOperationId];
  if (!incident) {
    throw recoveryOnlyError(
      'Recovery-only operator is pinned to an approved incident operation',
      'WOOCOMMERCE_RECOVERY_ONLY_OPERATION_NOT_APPROVED',
      { operationIdFingerprint: sha256(exactOperationId) },
    );
  }
  return incident;
}

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
  const incident = resolveWooCommerceFinalRecoveryOnlyIncident(operationId);
  return Object.freeze({ execute, operationId: incident.operationId });
}

export function assertWooCommerceFinalRecoveryOnlyConfirmation(env = {}, input = {}) {
  const operationId = input.operationId ?? ORIGINAL_INCIDENT_OPERATION_ID;
  const incident = resolveWooCommerceFinalRecoveryOnlyIncident(operationId);
  const { envName, value } = incident.confirmation;
  if (env[envName] !== value) {
    throw recoveryOnlyError(
      `WooCommerce recovery-only execution requires ${envName}=${value}`,
      'WOOCOMMERCE_RECOVERY_ONLY_CONFIRMATION_REQUIRED',
      { operationIdFingerprint: sha256(incident.operationId) },
    );
  }
  return true;
}

export function buildWooCommerceFinalRecoveryOnlySnapshotSql(input = {}) {
  return buildWooCommerceFinalSnapshotSql({
    accountKey: requireText(input.accountKey, 'accountKey'),
    operationId: requireOperationId(input.operationId),
  });
}

export function verifyWooCommerceFinalRecoveryOnlyEligibility(row, input = {}) {
  const incident = resolveWooCommerceFinalRecoveryOnlyIncident(input.operationId);
  const operationId = incident.operationId;
  const snapshot = normalizeWooCommerceFinalSnapshot(row);
  const businessRows = totalBusinessRows(snapshot.counts);
  const violations = [];

  if (snapshot.syncRunStatus !== 'failed') violations.push('sync_run_not_failed');
  if (snapshot.syncRunFinishedAt === null) violations.push('sync_run_not_finished');
  if (snapshot.syncRunErrorCode !== incident.expectedErrorCode) {
    violations.push('sync_run_error_mismatch');
  }
  if (snapshot.workLifecycleStatus !== 'active') violations.push('work_not_active');
  if (snapshot.workCompletedAt !== null) violations.push('work_already_completed');
  if (snapshot.completion !== null) violations.push('completion_present');
  if (snapshot.phaseComplete) violations.push('phase_complete');
  if (snapshot.activeLockCount !== 0) violations.push('active_lock_present');
  if (snapshot.queueOperationAttempts !== 1) violations.push('queue_attempt_count_not_one');
  if (snapshot.coverageRunCount !== 0) violations.push('coverage_present');
  if (snapshot.invalidCoverageCount !== 0) violations.push('invalid_coverage_present');
  if (businessRows !== 0) violations.push('business_rows_present');

  if (violations.length > 0) {
    throw recoveryOnlyError(
      'WooCommerce operation is not eligible for exact recovery-only mutation',
      'WOOCOMMERCE_RECOVERY_ONLY_PREFLIGHT_REJECTED',
      {
        operationIdFingerprint: sha256(operationId),
        expectedErrorCode: incident.expectedErrorCode,
        observedErrorCode: snapshot.syncRunErrorCode,
        violations: Object.freeze(violations),
        businessRows,
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
    expectedErrorCode: incident.expectedErrorCode,
    nextAction: incident.nextAction,
    businessRows,
    snapshot,
  });
}

export function verifyWooCommerceFinalRecoveryOnlyPostState(row, input = {}) {
  const incident = resolveWooCommerceFinalRecoveryOnlyIncident(input.operationId);
  const operationId = incident.operationId;
  const snapshot = normalizeWooCommerceFinalSnapshot(row);
  const businessRows = totalBusinessRows(snapshot.counts);
  const violations = [];

  if (snapshot.syncRunStatus !== 'failed') violations.push('sync_run_changed');
  if (snapshot.syncRunErrorCode !== incident.expectedErrorCode) {
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
  if (businessRows !== 0) violations.push('business_rows_changed');

  if (violations.length > 0) {
    throw recoveryOnlyError(
      'WooCommerce recovery-only post-verification failed',
      'WOOCOMMERCE_RECOVERY_ONLY_POST_VERIFY_FAILED',
      {
        operationIdFingerprint: sha256(operationId),
        expectedErrorCode: incident.expectedErrorCode,
        observedErrorCode: snapshot.syncRunErrorCode,
        violations: Object.freeze(violations),
        businessRows,
      },
    );
  }

  return Object.freeze({
    verified: true,
    operationIdFingerprint: sha256(operationId),
    workKeyFingerprint: sha256(`woocommerce:${operationId}`),
    expectedErrorCode: incident.expectedErrorCode,
    nextAction: incident.nextAction,
    businessRows,
    snapshot,
  });
}

function totalBusinessRows(counts = {}) {
  let total = 0;
  for (const [table, value] of Object.entries(counts)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw recoveryOnlyError(
        'WooCommerce recovery-only business count is invalid',
        'WOOCOMMERCE_RECOVERY_ONLY_COUNT_INVALID',
        { table },
      );
    }
    total += value;
  }
  return total;
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
