import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';
import {
  CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
  CHATWOOT_FINAL_UAT_TABLES,
  sha256,
  stableJson,
} from './chatwoot-final-30d-daily-uat.js';

export const CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONTRACT_VERSION =
  'chatwoot_final_source_config_recovery_v1';
export const CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY',
  value: 'RECOVER_CHATWOOT_SOURCE_CONFIG_AND_COMPLETE_UAT',
});
export const CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_SUCCESS_MARKER =
  'CHATWOOT_SOURCE_CONFIG_RECOVERY_COMPLETED_SAFE';

export const CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT = Object.freeze({
  repositoryHead: 'f93dcca29c5770b74a3dc6e41f2aac3489ebc8d1',
  operationId: 'chatwoot-initial-30d-1785526770359-f93dcca29c57',
  workKey: 'chatwoot:chemistry_k:chatwoot-initial-30d-1785526770359-f93dcca29c57',
  syncRunId: 'chatwoot:chemistry_k:chatwoot-initial-30d-1785526770359-f93dcca29c57',
  requestedAt: 1785526770359,
  generation: 1785526770359,
  messageId: '712733dca2f55d0f39698d87d33b3d56',
  dlqId: 'terminal:712733dca2f55d0f39698d87d33b3d56',
  alertId: 'alert:terminal:712733dca2f55d0f39698d87d33b3d56',
  jobType: 'chatwoot.conversations.sync',
  errorCode: 'CHATWOOT_RUNTIME_CONFIG_INVALID',
  errorMessage: 'CHATWOOT_BASE_URL is required',
});

export function assertChatwootFinalSourceConfigRecoveryConfirmation(env = {}) {
  const contract = CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONFIRMATION;
  if (env?.[contract.envName] !== contract.value) {
    throw recoveryError(
      `Chatwoot source-config recovery requires ${contract.envName}=${contract.value}`,
      'CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_CONFIRMATION_REQUIRED',
      { envName: contract.envName },
    );
  }
  return true;
}

export function resolveChatwootFinalSourceIdentity(env = {}) {
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  const baseUrl = requireHttpsOrigin(env.CHATWOOT_BASE_URL);
  const accountId = requirePositiveIntegerText(env.CHATWOOT_ACCOUNT_ID, 'CHATWOOT_ACCOUNT_ID');
  const identity = Object.freeze({ baseUrl, accountId });
  return Object.freeze({
    ...identity,
    fingerprint: sha256(stableJson(identity)),
  });
}

export function materializeChatwootFinalSourceConfig(sourceText, identity = {}) {
  const config = parseJsoncObject(sourceText);
  config.vars ??= {};
  requireExact(config.vars.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(config.vars.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(config.vars.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  const resolved = resolveChatwootFinalSourceIdentity({
    MKT_ENV: config.vars.MKT_ENV,
    MKT_CUSTOMER_PROFILE: config.vars.MKT_CUSTOMER_PROFILE,
    MKT_CONNECTION_CUSTOMER_KEY: config.vars.MKT_CONNECTION_CUSTOMER_KEY,
    CHATWOOT_BASE_URL: identity.baseUrl,
    CHATWOOT_ACCOUNT_ID: identity.accountId,
  });
  config.vars.CHATWOOT_BASE_URL = resolved.baseUrl;
  config.vars.CHATWOOT_ACCOUNT_ID = resolved.accountId;

  const text = `${JSON.stringify(config, null, 2)}\n`;
  return Object.freeze({
    text,
    sourceIdentityFingerprint: resolved.fingerprint,
    materializedFields: Object.freeze([
      'CHATWOOT_BASE_URL',
      'CHATWOOT_ACCOUNT_ID',
    ]),
    secretValuesMaterialized: 0,
  });
}

export function buildChatwootFinalSourceIncidentSql() {
  const incident = CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT;
  const operation = sqlText(incident.operationId);
  const work = sqlText(incident.workKey);
  const syncRun = sqlText(incident.syncRunId);
  const dlq = sqlText(incident.dlqId);
  const alert = sqlText(incident.alertId);
  const message = sqlText(incident.messageId);
  const businessCounts = [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((spec) => spec.d1Table))]
    .map((tableName) => `(SELECT COUNT(*) FROM ${tableName} WHERE account_key='chemistry_k') AS ${tableName}`)
    .join(', ');
  const unitLower = sqlText(`${incident.syncRunId}:unit:`);
  const unitUpper = sqlText(`${incident.syncRunId}:unit;`);

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
        WHERE operation_id=${operation} AND work_key=${work}) AS queue_requested_min,
      (SELECT MAX(original_requested_at) FROM queue_operation_attempts
        WHERE operation_id=${operation} AND work_key=${work}) AS queue_requested_max,
      (SELECT last_main_message_id FROM queue_operation_attempts
        WHERE operation_id=${operation} AND work_key=${work}) AS queue_message_id,
      (SELECT COUNT(*) FROM dead_letter_operation_metadata
        WHERE dlq_id=${dlq} AND operation_id=${operation} AND original_work_key=${work}) AS metadata_rows,
      (SELECT recovery_status FROM dead_letter_operation_metadata WHERE dlq_id=${dlq}) AS recovery_status,
      (SELECT recovery_reference FROM dead_letter_operation_metadata WHERE dlq_id=${dlq}) AS recovery_reference,
      (SELECT audit_reference FROM dead_letter_operation_metadata WHERE dlq_id=${dlq}) AS audit_reference,
      (SELECT generation FROM dead_letter_operation_metadata WHERE dlq_id=${dlq}) AS metadata_generation,
      (SELECT original_requested_at FROM dead_letter_operation_metadata WHERE dlq_id=${dlq}) AS metadata_requested_at,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE dlq_id=${dlq} AND message_id=${message}) AS terminal_rows,
      (SELECT status FROM dead_letter_jobs WHERE dlq_id=${dlq}) AS terminal_status,
      (SELECT error_code FROM dead_letter_jobs WHERE dlq_id=${dlq}) AS terminal_error_code,
      (SELECT error_message FROM dead_letter_jobs WHERE dlq_id=${dlq}) AS terminal_error_message,
      (SELECT retry_count FROM dead_letter_jobs WHERE dlq_id=${dlq}) AS terminal_retry_count,
      (SELECT job_type FROM dead_letter_jobs WHERE dlq_id=${dlq}) AS terminal_job_type,
      (SELECT COUNT(*) FROM system_alerts WHERE alert_id=${alert}) AS alert_rows,
      (SELECT status FROM system_alerts WHERE alert_id=${alert}) AS alert_status,
      (SELECT alert_type FROM system_alerts WHERE alert_id=${alert}) AS alert_type,
      (SELECT severity FROM system_alerts WHERE alert_id=${alert}) AS alert_severity,
      (SELECT platform FROM system_alerts WHERE alert_id=${alert}) AS alert_platform,
      (SELECT error_code FROM system_alerts WHERE alert_id=${alert}) AS alert_error_code,
      (SELECT COUNT(*) FROM sync_runs
        WHERE sync_run_id=${syncRun}
          OR (sync_run_id>=${unitLower} AND sync_run_id<${unitUpper})) AS sync_rows,
      (SELECT COUNT(*) FROM sync_work_runs WHERE work_key=${work}) AS work_rows,
      (SELECT COUNT(*) FROM sync_work_phases WHERE work_key=${work}) AS phase_rows,
      (SELECT COUNT(*) FROM data_coverage_runs
        WHERE sync_run_id=${syncRun}
          OR (sync_run_id>=${unitLower} AND sync_run_id<${unitUpper})) AS coverage_rows,
      (SELECT COUNT(*) FROM sync_locks
        WHERE lock_key>='integration_workspace:chatwoot:chemistry_k:'
          AND lock_key<'integration_workspace:chatwoot:chemistry_k;'
          AND expires_at>unixepoch('now')*1000) AS active_locks,
      ${businessCounts};
  `);
}

export function normalizeChatwootFinalSourceIncident(row = {}) {
  const businessCounts = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((spec) => spec.d1Table))]
      .map((tableName) => [tableName, count(row[tableName], tableName)]),
  );
  return deepFreeze({
    queueRows: count(row.queue_rows, 'queue_rows'),
    queueAttempts: count(row.queue_attempts, 'queue_attempts'),
    queueGenerationMin: nullableTimestamp(row.queue_generation_min),
    queueGenerationMax: nullableTimestamp(row.queue_generation_max),
    queueRequestedMin: nullableTimestamp(row.queue_requested_min),
    queueRequestedMax: nullableTimestamp(row.queue_requested_max),
    queueMessageId: optionalText(row.queue_message_id),
    metadataRows: count(row.metadata_rows, 'metadata_rows'),
    recoveryStatus: optionalText(row.recovery_status),
    recoveryReference: optionalText(row.recovery_reference),
    auditReference: optionalText(row.audit_reference),
    metadataGeneration: nullableTimestamp(row.metadata_generation),
    metadataRequestedAt: nullableTimestamp(row.metadata_requested_at),
    terminalRows: count(row.terminal_rows, 'terminal_rows'),
    terminalStatus: optionalText(row.terminal_status),
    terminalErrorCode: optionalText(row.terminal_error_code),
    terminalErrorMessage: optionalText(row.terminal_error_message),
    terminalRetryCount: count(row.terminal_retry_count, 'terminal_retry_count'),
    terminalJobType: optionalText(row.terminal_job_type),
    alertRows: count(row.alert_rows, 'alert_rows'),
    alertStatus: optionalText(row.alert_status),
    alertType: optionalText(row.alert_type),
    alertSeverity: optionalText(row.alert_severity),
    alertPlatform: optionalText(row.alert_platform),
    alertErrorCode: optionalText(row.alert_error_code),
    syncRows: count(row.sync_rows, 'sync_rows'),
    workRows: count(row.work_rows, 'work_rows'),
    phaseRows: count(row.phase_rows, 'phase_rows'),
    coverageRows: count(row.coverage_rows, 'coverage_rows'),
    activeLocks: count(row.active_locks, 'active_locks'),
    businessCounts,
    totalBusinessRows: Object.values(businessCounts).reduce((sum, value) => sum + value, 0),
  });
}

export function assertChatwootFinalSourceIncidentOpen(row = {}) {
  const state = normalizeChatwootFinalSourceIncident(row);
  const exactIdentity = hasExactIncidentIdentity(state);
  const incident = CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT;
  const accepted = hasExactImmutableFailure(state)
    && state.recoveryStatus === 'not_started'
    && state.recoveryReference === null
    && state.auditReference === null
    && state.terminalStatus === 'open'
    && state.alertStatus === 'open'
    && exactIdentity;
  if (!accepted) {
    throw recoveryError(
      'Retained Chatwoot source-config incident differs from the exact recovery contract',
      'CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT_INVALID',
      incidentSummary(state, exactIdentity),
    );
  }
  return Object.freeze({ accepted: true, incident, state });
}

export function assertChatwootFinalSourceIncidentClosable(row = {}, input = {}) {
  const state = normalizeChatwootFinalSourceIncident(row);
  const reference = requireReference(input.recoveryReference);
  const exactIdentity = hasExactIncidentIdentity(state);
  const referenceSafe = [null, reference].includes(state.recoveryReference)
    && [null, reference].includes(state.auditReference);
  const accepted = hasExactImmutableFailure(state)
    && ['open', 'resolved'].includes(state.terminalStatus)
    && ['not_started', 'in_progress', 'completed'].includes(state.recoveryStatus)
    && ['open', 'acknowledged', 'resolved'].includes(state.alertStatus)
    && referenceSafe
    && exactIdentity;
  if (!accepted) {
    throw recoveryError(
      'Retained Chatwoot source-config incident is not safely resumable for closure',
      'CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT_INVALID',
      incidentSummary(state, exactIdentity),
    );
  }
  return Object.freeze({ accepted: true, reference, state });
}

export function buildChatwootFinalSourceIncidentClosureSql(input = {}) {
  const incident = CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT;
  const completedAt = requireTimestamp(input.completedAt, 'completedAt');
  const reference = requireReference(input.recoveryReference);
  const operation = sqlText(incident.operationId);
  const work = sqlText(incident.workKey);
  const dlq = sqlText(incident.dlqId);
  const alert = sqlText(incident.alertId);
  const message = sqlText(incident.messageId);
  const recoveryReference = sqlText(reference);
  const errorCode = sqlText(incident.errorCode);
  const errorMessage = sqlText(incident.errorMessage);
  const jobType = sqlText(incident.jobType);

  return compactSql(`
    UPDATE dead_letter_jobs
    SET status='resolved', updated_at=${completedAt}
    WHERE dlq_id=${dlq}
      AND message_id=${message}
      AND job_type=${jobType}
      AND error_code=${errorCode}
      AND error_message=${errorMessage}
      AND retry_count=1
      AND status IN ('open','resolved');
    SELECT changes() AS dead_letter_rows;

    UPDATE dead_letter_operation_metadata
    SET recovery_status='completed',
        recovery_reference=COALESCE(recovery_reference,${recoveryReference}),
        recovery_started_at=COALESCE(recovery_started_at,${completedAt}),
        recovery_completed_at=COALESCE(recovery_completed_at,${completedAt}),
        audit_reference=COALESCE(audit_reference,${recoveryReference}),
        updated_at=${completedAt}
    WHERE dlq_id=${dlq}
      AND operation_id=${operation}
      AND original_work_key=${work}
      AND generation=${incident.generation}
      AND original_requested_at=${incident.requestedAt}
      AND recovery_status IN ('not_started','in_progress','completed')
      AND (recovery_reference IS NULL OR recovery_reference=${recoveryReference})
      AND (audit_reference IS NULL OR audit_reference=${recoveryReference});
    SELECT changes() AS metadata_rows;

    UPDATE system_alerts
    SET status='resolved', updated_at=${completedAt}
    WHERE alert_id=${alert}
      AND platform='chatwoot'
      AND alert_type='queue_permanent_failure'
      AND error_code=${errorCode}
      AND status IN ('open','acknowledged','resolved');
    SELECT changes() AS alert_rows;
  `);
}

export function validateChatwootFinalSourceIncidentClosureResults(rows = []) {
  if (!Array.isArray(rows) || rows.length !== 3) {
    throw recoveryError(
      'Chatwoot source-config closure returned an unexpected result count',
      'CHATWOOT_FINAL_SOURCE_CONFIG_CLOSURE_RESULT_INVALID',
      { rowCount: Array.isArray(rows) ? rows.length : null },
    );
  }
  const counts = [
    Number(rows[0]?.dead_letter_rows),
    Number(rows[1]?.metadata_rows),
    Number(rows[2]?.alert_rows),
  ];
  if (counts.some((value) => value !== 1)) {
    throw recoveryError(
      'Chatwoot source-config closure did not update every exact incident record',
      'CHATWOOT_FINAL_SOURCE_CONFIG_CLOSURE_RESULT_INVALID',
      { counts },
    );
  }
  return Object.freeze({ statementCount: counts.length, updatedRows: 3 });
}

export function assertChatwootFinalSourceIncidentResolved(row = {}, input = {}) {
  const state = normalizeChatwootFinalSourceIncident(row);
  const reference = requireReference(input.recoveryReference);
  const exactIdentity = hasExactIncidentIdentity(state);
  const accepted = hasExactImmutableFailure(state)
    && state.recoveryStatus === 'completed'
    && state.recoveryReference === reference
    && state.auditReference === reference
    && state.terminalStatus === 'resolved'
    && state.alertStatus === 'resolved'
    && exactIdentity;
  if (!accepted) {
    throw recoveryError(
      'Retained Chatwoot source-config incident did not reach exact resolved state',
      'CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT_CLOSURE_INVALID',
      incidentSummary(state, exactIdentity),
    );
  }
  return Object.freeze({ accepted: true, reference, state });
}

export function assertChatwootFinalSourceRecoverySummary(summary = {}) {
  const accepted = summary?.ok === true
    && summary?.marker === CHATWOOT_FINAL_UAT_SUCCESS_MARKER
    && summary?.initial30DayVerified === true
    && summary?.initialReplayVerified === true
    && summary?.daily3DayVerified === true
    && summary?.dailyReplayVerified === true
    && summary?.restoredAllFlagsFalse === true
    && summary?.scheduleEnabled === false
    && summary?.webhookEnabled === false
    && summary?.production === false;
  if (!accepted) {
    throw recoveryError(
      'Chatwoot Final UAT summary is not accepted for incident closure',
      'CHATWOOT_FINAL_SOURCE_CONFIG_UAT_SUMMARY_INVALID',
    );
  }
  return true;
}

export function fingerprintChatwootFinalSourceRecovery(value) {
  return sha256(stableJson(value));
}

function hasExactIncidentIdentity(state) {
  const incident = CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT;
  return state.queueGenerationMin === incident.generation
    && state.queueGenerationMax === incident.generation
    && state.queueRequestedMin === incident.requestedAt
    && state.queueRequestedMax === incident.requestedAt
    && state.metadataGeneration === incident.generation
    && state.metadataRequestedAt === incident.requestedAt
    && state.queueMessageId === incident.messageId;
}

function hasExactImmutableFailure(state) {
  const incident = CHATWOOT_FINAL_SOURCE_CONFIG_INCIDENT;
  return state.queueRows === 1
    && state.queueAttempts === 1
    && state.metadataRows === 1
    && state.terminalRows === 1
    && state.terminalErrorCode === incident.errorCode
    && state.terminalErrorMessage === incident.errorMessage
    && state.terminalRetryCount === 1
    && state.terminalJobType === incident.jobType
    && state.alertRows === 1
    && state.alertType === 'queue_permanent_failure'
    && state.alertSeverity === 'critical'
    && state.alertPlatform === 'chatwoot'
    && state.alertErrorCode === incident.errorCode
    && state.syncRows === 0
    && state.workRows === 0
    && state.phaseRows === 0
    && state.coverageRows === 0
    && state.activeLocks === 0;
}

function incidentSummary(state, exactIdentity) {
  return {
    queueRows: state.queueRows,
    queueAttempts: state.queueAttempts,
    metadataRows: state.metadataRows,
    recoveryStatus: state.recoveryStatus,
    terminalRows: state.terminalRows,
    terminalStatus: state.terminalStatus,
    terminalErrorCode: state.terminalErrorCode,
    alertRows: state.alertRows,
    alertStatus: state.alertStatus,
    syncRows: state.syncRows,
    workRows: state.workRows,
    phaseRows: state.phaseRows,
    coverageRows: state.coverageRows,
    activeLocks: state.activeLocks,
    totalBusinessRows: state.totalBusinessRows,
    exactIdentity,
  };
}

function requireHttpsOrigin(value) {
  const text = requireText(value, 'CHATWOOT_BASE_URL');
  if (/replace-with|\.example(?:\/|$)/iu.test(text)) {
    throw recoveryError(
      'CHATWOOT_BASE_URL must not be a placeholder',
      'CHATWOOT_FINAL_SOURCE_CONFIG_INVALID',
      { fieldName: 'CHATWOOT_BASE_URL' },
    );
  }
  let url;
  try {
    url = new URL(text);
  } catch (cause) {
    throw recoveryError(
      'CHATWOOT_BASE_URL must be a valid HTTPS origin',
      'CHATWOOT_FINAL_SOURCE_CONFIG_INVALID',
      { fieldName: 'CHATWOOT_BASE_URL', cause: cause?.message ?? 'URL_PARSE_FAILED' },
    );
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !['', '/'].includes(url.pathname)) {
    throw recoveryError(
      'CHATWOOT_BASE_URL must be a credential-free HTTPS origin',
      'CHATWOOT_FINAL_SOURCE_CONFIG_INVALID',
      { fieldName: 'CHATWOOT_BASE_URL' },
    );
  }
  return url.origin;
}

function requirePositiveIntegerText(value, fieldName) {
  const text = requireText(value, fieldName);
  if (/replace-with/iu.test(text)) {
    throw recoveryError(
      `${fieldName} must not be a placeholder`,
      'CHATWOOT_FINAL_SOURCE_CONFIG_INVALID',
      { fieldName },
    );
  }
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw recoveryError(
      `${fieldName} must be a positive integer`,
      'CHATWOOT_FINAL_SOURCE_CONFIG_INVALID',
      { fieldName },
    );
  }
  return String(number);
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw recoveryError(
      `${fieldName} must equal ${expected}`,
      'CHATWOOT_FINAL_SOURCE_CONFIG_TARGET_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireReference(value) {
  const text = requireText(value, 'recoveryReference');
  if (!/^chatwoot-source-config-recovery:[0-9a-f]{40}$/u.test(text)) {
    throw recoveryError(
      'recoveryReference is invalid',
      'CHATWOOT_FINAL_SOURCE_CONFIG_RECOVERY_REFERENCE_INVALID',
    );
  }
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw recoveryError(
      `${fieldName} must be a positive timestamp`,
      'CHATWOOT_FINAL_SOURCE_CONFIG_VALUE_INVALID',
      { fieldName },
    );
  }
  return number;
}

function count(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw recoveryError(
      `${fieldName} must be a non-negative integer`,
      'CHATWOOT_FINAL_SOURCE_CONFIG_D1_SHAPE_INVALID',
      { fieldName },
    );
  }
  return number;
}

function nullableTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireTimestamp(value, 'timestamp');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw recoveryError(
      `${fieldName} is required`,
      'CHATWOOT_FINAL_SOURCE_CONFIG_VALUE_REQUIRED',
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
  return value.replace(/\s+/gu, ' ').trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootFinalSourceConfigRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
