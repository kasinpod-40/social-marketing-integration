import { createHash } from 'node:crypto';

export const WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONTRACT_VERSION =
  'woocommerce_incremental_admission_race_recovery_v1';
export const WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONFIRMATION =
  'RECOVER_WOO_INCREMENTAL_ADMISSION_RACE_EXACT_OPERATION_ONLY';
export const WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_SOURCE_HEAD =
  'd3592b256d52bf72e4a3d9d33ab707cb5bca4961';
export const WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_ERROR_CODE =
  'WOOCOMMERCE_CONNECTOR_INVALID';

const JOB_TYPE = 'woocommerce.commerce.sync';
const COVERAGE_DATASET_COUNT = 6;

export function parseWooCommerceIncrementalAdmissionRaceRecoveryArgs(argv = []) {
  const unknown = argv.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw recoveryError(
      `Unsupported WooCommerce Incremental race recovery arguments: ${unknown.join(', ')}`,
      'WOOCOMMERCE_INCREMENTAL_RACE_ARGUMENT_INVALID',
      { arguments: unknown },
    );
  }
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertWooCommerceIncrementalAdmissionRaceRecoveryConfirmation(env = {}) {
  if (env.CONFIRM_WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY
    !== WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONFIRMATION) {
    throw recoveryError(
      'WooCommerce Incremental admission-race recovery requires the exact confirmation value',
      'WOOCOMMERCE_INCREMENTAL_RACE_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function buildWooCommerceIncrementalAdmissionRaceStateSql(input = {}) {
  const operationId = requireOperationId(input.operationId);
  const workKey = `woocommerce:${operationId}`;
  const operation = sqlText(operationId);
  const work = sqlText(workKey);
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM queue_operation_attempts
        WHERE operation_id=${operation} AND work_key=${work}) AS queue_rows,
      (SELECT COALESCE(MAX(main_queue_attempts),0) FROM queue_operation_attempts
        WHERE operation_id=${operation} AND work_key=${work}) AS queue_attempts,
      (SELECT MIN(generation) FROM queue_operation_attempts
        WHERE operation_id=${operation} AND work_key=${work}) AS queue_generation_min,
      (SELECT MAX(generation) FROM queue_operation_attempts
        WHERE operation_id=${operation} AND work_key=${work}) AS queue_generation_max,
      (SELECT MIN(original_requested_at) FROM queue_operation_attempts
        WHERE operation_id=${operation} AND work_key=${work}) AS queue_original_min,
      (SELECT MAX(original_requested_at) FROM queue_operation_attempts
        WHERE operation_id=${operation} AND work_key=${work}) AS queue_original_max,
      (SELECT COUNT(*) FROM dead_letter_operation_metadata
        WHERE operation_id=${operation} AND original_work_key=${work}) AS metadata_rows,
      (SELECT recovery_status FROM dead_letter_operation_metadata
        WHERE operation_id=${operation} AND original_work_key=${work}
        ORDER BY created_at DESC LIMIT 1) AS recovery_status,
      (SELECT generation FROM dead_letter_operation_metadata
        WHERE operation_id=${operation} AND original_work_key=${work}
        ORDER BY created_at DESC LIMIT 1) AS metadata_generation,
      (SELECT original_requested_at FROM dead_letter_operation_metadata
        WHERE operation_id=${operation} AND original_work_key=${work}
        ORDER BY created_at DESC LIMIT 1) AS metadata_original_requested_at,
      (SELECT COUNT(*) FROM dead_letter_jobs d
        JOIN dead_letter_operation_metadata m ON m.dlq_id=d.dlq_id
        WHERE m.operation_id=${operation} AND m.original_work_key=${work}) AS terminal_dlq_rows,
      (SELECT d.status FROM dead_letter_jobs d
        JOIN dead_letter_operation_metadata m ON m.dlq_id=d.dlq_id
        WHERE m.operation_id=${operation} AND m.original_work_key=${work}
        ORDER BY d.created_at DESC LIMIT 1) AS terminal_dlq_status,
      (SELECT d.error_code FROM dead_letter_jobs d
        JOIN dead_letter_operation_metadata m ON m.dlq_id=d.dlq_id
        WHERE m.operation_id=${operation} AND m.original_work_key=${work}
        ORDER BY d.created_at DESC LIMIT 1) AS terminal_error_code,
      (SELECT d.retry_count FROM dead_letter_jobs d
        JOIN dead_letter_operation_metadata m ON m.dlq_id=d.dlq_id
        WHERE m.operation_id=${operation} AND m.original_work_key=${work}
        ORDER BY d.created_at DESC LIMIT 1) AS terminal_retry_count,
      (SELECT d.job_type FROM dead_letter_jobs d
        JOIN dead_letter_operation_metadata m ON m.dlq_id=d.dlq_id
        WHERE m.operation_id=${operation} AND m.original_work_key=${work}
        ORDER BY d.created_at DESC LIMIT 1) AS terminal_job_type,
      (SELECT CASE WHEN d.message_id=q.last_main_message_id THEN 1 ELSE 0 END
        FROM dead_letter_jobs d
        JOIN dead_letter_operation_metadata m ON m.dlq_id=d.dlq_id
        JOIN queue_operation_attempts q ON q.operation_id=m.operation_id
        WHERE m.operation_id=${operation} AND m.original_work_key=${work}
        ORDER BY d.created_at DESC LIMIT 1) AS message_identity_matches,
      (SELECT COUNT(*) FROM sync_runs WHERE sync_run_id=${work}) AS sync_rows,
      (SELECT status FROM sync_runs WHERE sync_run_id=${work}) AS sync_status,
      (SELECT error_code FROM sync_runs WHERE sync_run_id=${work}) AS sync_error_code,
      (SELECT COUNT(*) FROM sync_work_runs WHERE work_key=${work}) AS work_rows,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key=${work}) AS work_lifecycle_status,
      (SELECT CASE WHEN completion_json IS NULL THEN 0 ELSE 1 END
        FROM sync_work_runs WHERE work_key=${work}) AS completion_present,
      (SELECT COUNT(*) FROM sync_work_phases WHERE work_key=${work}) AS phase_rows,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE sync_run_id=${work}) AS coverage_rows,
      (SELECT COUNT(*) FROM data_coverage_runs
        WHERE sync_run_id=${work}
          AND (failed_rows<>0 OR status NOT IN ('complete','no_data_confirmed','revisable'))
      ) AS invalid_coverage_rows,
      (SELECT COUNT(*) FROM sync_locks
        WHERE owner_id=${work} AND expires_at>unixepoch('now')*1000) AS active_locks;
  `);
}

export function normalizeWooCommerceIncrementalAdmissionRaceState(row = {}) {
  return Object.freeze({
    queueRows: count(row.queue_rows ?? row.queueRows),
    queueAttempts: count(row.queue_attempts ?? row.queueAttempts),
    queueGenerationMin: nullableTimestamp(
      row.queue_generation_min ?? row.queueGenerationMin,
    ),
    queueGenerationMax: nullableTimestamp(
      row.queue_generation_max ?? row.queueGenerationMax,
    ),
    queueOriginalMin: nullableTimestamp(row.queue_original_min ?? row.queueOriginalMin),
    queueOriginalMax: nullableTimestamp(row.queue_original_max ?? row.queueOriginalMax),
    metadataRows: count(row.metadata_rows ?? row.metadataRows),
    recoveryStatus: optionalText(row.recovery_status ?? row.recoveryStatus),
    metadataGeneration: nullableTimestamp(
      row.metadata_generation ?? row.metadataGeneration,
    ),
    metadataOriginalRequestedAt: nullableTimestamp(
      row.metadata_original_requested_at ?? row.metadataOriginalRequestedAt,
    ),
    terminalDlqRows: count(row.terminal_dlq_rows ?? row.terminalDlqRows),
    terminalDlqStatus: optionalText(row.terminal_dlq_status ?? row.terminalDlqStatus),
    terminalErrorCode: optionalText(row.terminal_error_code ?? row.terminalErrorCode),
    terminalRetryCount: count(row.terminal_retry_count ?? row.terminalRetryCount),
    terminalJobType: optionalText(row.terminal_job_type ?? row.terminalJobType),
    messageIdentityMatches: Boolean(
      row.messageIdentityMatches === true
      || Number(row.message_identity_matches ?? 0) === 1,
    ),
    syncRows: count(row.sync_rows ?? row.syncRows),
    syncStatus: optionalText(row.sync_status ?? row.syncStatus),
    syncErrorCode: optionalText(row.sync_error_code ?? row.syncErrorCode),
    workRows: count(row.work_rows ?? row.workRows),
    workLifecycleStatus: optionalText(
      row.work_lifecycle_status ?? row.workLifecycleStatus,
    ),
    completionPresent: Boolean(
      row.completionPresent === true || Number(row.completion_present ?? 0) === 1,
    ),
    phaseRows: count(row.phase_rows ?? row.phaseRows),
    coverageRows: count(row.coverage_rows ?? row.coverageRows),
    invalidCoverageRows: count(
      row.invalid_coverage_rows ?? row.invalidCoverageRows,
    ),
    activeLocks: count(row.active_locks ?? row.activeLocks),
  });
}

export function validateWooCommerceIncrementalAdmissionRaceIncident(input = {}) {
  const operationId = requireOperationId(input.operationId);
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const state = normalizeWooCommerceIncrementalAdmissionRaceState(input.state);
  const exactIdentity = state.queueGenerationMin === requestedAt
    && state.queueGenerationMax === requestedAt
    && state.queueOriginalMin === requestedAt
    && state.queueOriginalMax === requestedAt
    && state.metadataGeneration === requestedAt
    && state.metadataOriginalRequestedAt === requestedAt;
  const valid = state.queueRows === 1
    && state.queueAttempts === 1
    && state.metadataRows === 1
    && state.recoveryStatus === 'not_started'
    && state.terminalDlqRows === 1
    && state.terminalDlqStatus === 'open'
    && state.terminalErrorCode === WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_ERROR_CODE
    && state.terminalRetryCount === 1
    && state.terminalJobType === JOB_TYPE
    && state.messageIdentityMatches
    && state.syncRows === 0
    && state.workRows === 0
    && state.phaseRows === 0
    && state.coverageRows === 0
    && state.invalidCoverageRows === 0
    && state.activeLocks === 0
    && exactIdentity;
  if (!valid) {
    throw recoveryError(
      'WooCommerce Incremental admission-race incident does not match the exact recovery contract',
      'WOOCOMMERCE_INCREMENTAL_RACE_INCIDENT_INVALID',
      {
        operationId,
        queueRows: state.queueRows,
        queueAttempts: state.queueAttempts,
        metadataRows: state.metadataRows,
        recoveryStatus: state.recoveryStatus,
        terminalDlqRows: state.terminalDlqRows,
        terminalDlqStatus: state.terminalDlqStatus,
        terminalErrorCode: state.terminalErrorCode,
        terminalRetryCount: state.terminalRetryCount,
        terminalJobType: state.terminalJobType,
        messageIdentityMatches: state.messageIdentityMatches,
        syncRows: state.syncRows,
        workRows: state.workRows,
        phaseRows: state.phaseRows,
        coverageRows: state.coverageRows,
        invalidCoverageRows: state.invalidCoverageRows,
        activeLocks: state.activeLocks,
        exactIdentity,
      },
    );
  }
  return Object.freeze({ accepted: true, operationId, requestedAt, state });
}

export function validateWooCommerceIncrementalAdmissionRaceRecovered(input = {}) {
  const operationId = requireOperationId(input.operationId);
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const state = normalizeWooCommerceIncrementalAdmissionRaceState(input.state);
  const exactIdentity = state.queueGenerationMin === requestedAt
    && state.queueGenerationMax === requestedAt
    && state.queueOriginalMin === requestedAt
    && state.queueOriginalMax === requestedAt
    && state.metadataGeneration === requestedAt
    && state.metadataOriginalRequestedAt === requestedAt;
  const valid = state.queueRows === 1
    && state.queueAttempts >= 2
    && state.metadataRows === 1
    && state.recoveryStatus === 'completed'
    && state.terminalDlqRows === 1
    && state.terminalDlqStatus === 'redriven'
    && state.terminalErrorCode === WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_ERROR_CODE
    && state.terminalRetryCount === 1
    && state.terminalJobType === JOB_TYPE
    && state.messageIdentityMatches
    && state.syncRows === 1
    && state.syncStatus === 'success'
    && state.syncErrorCode === null
    && state.workRows === 1
    && state.workLifecycleStatus === 'completed'
    && state.completionPresent
    && state.phaseRows === 0
    && state.coverageRows === COVERAGE_DATASET_COUNT
    && state.invalidCoverageRows === 0
    && state.activeLocks === 0
    && exactIdentity;
  if (!valid) {
    throw recoveryError(
      'WooCommerce Incremental admission-race recovery did not reach the exact completed state',
      'WOOCOMMERCE_INCREMENTAL_RACE_RECOVERY_INCOMPLETE',
      {
        operationId,
        queueAttempts: state.queueAttempts,
        recoveryStatus: state.recoveryStatus,
        terminalDlqStatus: state.terminalDlqStatus,
        syncRows: state.syncRows,
        syncStatus: state.syncStatus,
        workRows: state.workRows,
        workLifecycleStatus: state.workLifecycleStatus,
        completionPresent: state.completionPresent,
        phaseRows: state.phaseRows,
        coverageRows: state.coverageRows,
        invalidCoverageRows: state.invalidCoverageRows,
        activeLocks: state.activeLocks,
        exactIdentity,
      },
    );
  }
  return Object.freeze({ accepted: true, operationId, requestedAt, state });
}

export function buildWooCommerceIncrementalAdmissionRaceClosureSql(input = {}) {
  const operationId = requireOperationId(input.operationId);
  const workKey = `woocommerce:${operationId}`;
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const completedAt = requireTimestamp(input.completedAt, 'completedAt');
  const recoveryReference = requireText(input.recoveryReference, 'recoveryReference');
  const operation = sqlText(operationId);
  const work = sqlText(workKey);
  const reference = sqlText(recoveryReference);
  return compactSql(`
    BEGIN IMMEDIATE;
    UPDATE dead_letter_jobs
    SET status='redriven',
        redrive_requested_at=COALESCE(redrive_requested_at,${completedAt}),
        redrive_reference=COALESCE(redrive_reference,${reference}),
        redriven_at=COALESCE(redriven_at,${completedAt}),
        updated_at=${completedAt}
    WHERE dlq_id=(
      SELECT m.dlq_id FROM dead_letter_operation_metadata m
      JOIN dead_letter_jobs d ON d.dlq_id=m.dlq_id
      WHERE m.operation_id=${operation}
        AND m.original_work_key=${work}
        AND m.generation=${requestedAt}
        AND m.original_requested_at=${requestedAt}
        AND d.status='open'
        AND d.error_code=${sqlText(WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_ERROR_CODE)}
        AND d.retry_count=1
        AND d.job_type=${sqlText(JOB_TYPE)}
      LIMIT 1
    );
    UPDATE dead_letter_operation_metadata
    SET recovery_status='completed',
        recovery_reference=COALESCE(recovery_reference,${reference}),
        recovery_started_at=COALESCE(recovery_started_at,${completedAt}),
        recovery_completed_at=COALESCE(recovery_completed_at,${completedAt}),
        audit_reference=COALESCE(audit_reference,${reference}),
        updated_at=${completedAt}
    WHERE operation_id=${operation}
      AND original_work_key=${work}
      AND generation=${requestedAt}
      AND original_requested_at=${requestedAt}
      AND recovery_status IN ('not_started','in_progress','completed');
    COMMIT;
  `);
}

export function fingerprintWooCommerceIncrementalAdmissionRaceValue(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function sanitizeWooCommerceIncrementalAdmissionRaceEvidence(value) {
  return sanitize(value);
}

function requireOperationId(value) {
  const text = requireText(value, 'operationId').toLowerCase();
  if (!/^woo-final-incremental-[0-9a-f]{12}$/u.test(text)) {
    throw recoveryError(
      'WooCommerce Incremental admission-race operation ID is invalid',
      'WOOCOMMERCE_INCREMENTAL_RACE_OPERATION_INVALID',
    );
  }
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2020, 0, 1)) {
    throw recoveryError(
      `WooCommerce Incremental admission-race ${fieldName} is invalid`,
      'WOOCOMMERCE_INCREMENTAL_RACE_TIMESTAMP_INVALID',
      { fieldName },
    );
  }
  return number;
}

function nullableTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function count(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw recoveryError(
      'WooCommerce Incremental admission-race count is invalid',
      'WOOCOMMERCE_INCREMENTAL_RACE_VALUE_INVALID',
    );
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw recoveryError(
      `WooCommerce Incremental admission-race requires ${fieldName}`,
      'WOOCOMMERCE_INCREMENTAL_RACE_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:token|secret|password|authorization|cookie|url|tableId|recordId|payload|messageId|dlqId)/iu.test(key)) {
      output[key] = '[REDACTED]';
    } else {
      output[key] = sanitize(nested);
    }
  }
  return output;
}

function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceIncrementalAdmissionRaceRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
