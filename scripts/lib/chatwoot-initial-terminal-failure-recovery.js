import { createHash } from 'node:crypto';

import {
  CHATWOOT_FINAL_UAT_TABLES,
  buildChatwootFinalUatJob,
  stableJson,
} from './chatwoot-final-30d-daily-uat.js';

export const CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONTRACT_VERSION =
  'chatwoot_initial_terminal_failure_inspector_v1';
export const CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_CHATWOOT_INITIAL_FAILURE_INSPECTOR',
  value: 'INSPECT_CHATWOOT_INITIAL_FAILURE_READ_ONLY',
});
export const CHATWOOT_INITIAL_FAILURE_INSPECTED_MARKER =
  'CHATWOOT_INITIAL_TERMINAL_FAILURE_INSPECTED_SAFE';
export const CHATWOOT_INITIAL_FAILURE_RECOVERY_CONTRACT_VERSION =
  'chatwoot_initial_terminal_failure_recovery_v1';
export const CHATWOOT_INITIAL_FAILURE_RECOVERY_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_CHATWOOT_INITIAL_FAILURE_RECOVERY',
  value: 'RECOVER_EXACT_CHATWOOT_INITIAL_TO_LARK_PARITY',
});
export const CHATWOOT_INITIAL_RECOVERY_BOUNDARIES = Object.freeze({
  original: 'source_config_terminal_v1',
  fractionalTimestamp: 'fractional_timestamp_terminal_v1',
  safeRestoreRace: 'fractional_timestamp_safe_restore_race_v1',
});

const SHA = /^[0-9a-f]{40}$/u;
const OPERATION_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/u;
const SENSITIVE_KEY = /token|secret|authorization|password|cookie|email|phone|name|content|payload|body|url/iu;

export function assertChatwootInitialFailureInspectorConfirmation(env = {}) {
  const contract = CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONFIRMATION;
  if (env?.[contract.envName] !== contract.value) {
    throw incidentError(
      `Chatwoot inspector requires ${contract.envName}=${contract.value}`,
      'CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assertChatwootInitialFailureRecoveryConfirmation(env = {}) {
  const contract = CHATWOOT_INITIAL_FAILURE_RECOVERY_CONFIRMATION;
  if (env?.[contract.envName] !== contract.value) {
    throw incidentError(
      `Chatwoot recovery requires ${contract.envName}=${contract.value}`,
      'CHATWOOT_INITIAL_FAILURE_RECOVERY_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function buildChatwootInitialRecoveryContinuationJob(identity = {}) {
  const operation = validateIdentity(identity, 'initial');
  if (operation.mode !== 'initial') {
    throw incidentError('Recovery target must be Initial UAT', 'CHATWOOT_INITIAL_FAILURE_SESSION_INVALID');
  }
  const body = buildChatwootFinalUatJob(operation);
  return Object.freeze({
    ...body,
    continuationSequence: 0,
    recoveryContractVersion: CHATWOOT_INITIAL_FAILURE_RECOVERY_CONTRACT_VERSION,
    recoveryKind: 'exact_existing_work_continuation',
  });
}

export function buildChatwootInitialFailureReactivationSql(inspection = {}) {
  const boundary = classifyChatwootInitialRecoveryBoundary(inspection);
  if (inspection.workLifecycle !== 'terminal') {
    throw incidentError('Terminal boundary is required for reactivation', 'CHATWOOT_INITIAL_FAILURE_REACTIVATION_BLOCKED');
  }
  const operation = inspection.operation;
  const counts = Object.entries(inspection.businessCounts).map(([table, value]) => (
    `(SELECT COUNT(*) FROM ${table} WHERE account_key='chemistry_k')=${count(value, table)}`
  )).join(' AND ');
  const originalGuard = `
      AND NOT EXISTS (SELECT 1 FROM sync_work_phases WHERE work_key=${sqlText(operation.workKey)})
      AND EXISTS (SELECT 1 FROM queue_operation_attempts WHERE operation_id=${sqlText(operation.operationId)} AND work_key=${sqlText(operation.workKey)} AND generation=${operation.generation} AND original_requested_at=${operation.originalRequestedAt} AND main_queue_attempts=2)
      AND EXISTS (SELECT 1 FROM sync_runs WHERE sync_run_id=${sqlText(`${operation.syncRunId}:unit:0`)} AND status='running' AND error_code IS NULL)
      AND EXISTS (SELECT 1 FROM dead_letter_operation_metadata m JOIN dead_letter_jobs j ON j.dlq_id=m.dlq_id WHERE m.operation_id=${sqlText(operation.operationId)} AND m.main_queue_attempts=2 AND m.recovery_status='not_started' AND j.status='open' AND j.error_code='CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID')
      AND EXISTS (SELECT 1 FROM system_alerts WHERE platform='chatwoot' AND status='open' AND error_code='CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID' AND json_extract(details_json,'$.operationId')=${sqlText(operation.operationId)})`;
  const fractionalTimestampGuard = `
      AND (SELECT COUNT(*) FROM sync_work_phases WHERE work_key=${sqlText(operation.workKey)})=1
      AND EXISTS (SELECT 1 FROM sync_work_phases WHERE work_key=${sqlText(operation.workKey)} AND phase='chatwoot_runtime_30d_daily_v1' AND json_extract(state_json,'$.stage')='conversations' AND json_extract(state_json,'$.nextSequence')=1)
      AND EXISTS (SELECT 1 FROM queue_operation_attempts WHERE operation_id=${sqlText(operation.operationId)} AND work_key=${sqlText(operation.workKey)} AND generation=${operation.generation} AND original_requested_at=${operation.originalRequestedAt} AND main_queue_attempts=4)
      AND (SELECT COUNT(*) FROM sync_runs WHERE sync_run_id>=${sqlText(`${operation.syncRunId}:unit:`)} AND sync_run_id<${sqlText(`${operation.syncRunId}:unit;`)})=2
      AND EXISTS (SELECT 1 FROM sync_runs WHERE sync_run_id=${sqlText(`${operation.syncRunId}:unit:0`)} AND status='success' AND error_code IS NULL)
      AND EXISTS (SELECT 1 FROM sync_runs WHERE sync_run_id=${sqlText(`${operation.syncRunId}:unit:1`)} AND status='failed' AND error_code='UNHANDLED_SYNC_ERROR' AND error_message='conversation.updated_at must fit a safe integer' AND records_written=0)
      AND (SELECT COUNT(*) FROM dead_letter_operation_metadata WHERE operation_id=${sqlText(operation.operationId)})=2
      AND EXISTS (SELECT 1 FROM dead_letter_operation_metadata m JOIN dead_letter_jobs j ON j.dlq_id=m.dlq_id WHERE m.operation_id=${sqlText(operation.operationId)} AND m.main_queue_attempts=2 AND m.recovery_status='not_started' AND j.status='open' AND j.error_code='CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID')
      AND EXISTS (SELECT 1 FROM dead_letter_operation_metadata m JOIN dead_letter_jobs j ON j.dlq_id=m.dlq_id WHERE m.operation_id=${sqlText(operation.operationId)} AND m.main_queue_attempts=4 AND m.recovery_status='not_started' AND j.status='open' AND j.error_code='PERMANENT_QUEUE_FAILURE' AND j.error_message='conversation.updated_at must fit a safe integer')
      AND (SELECT COUNT(*) FROM system_alerts WHERE platform='chatwoot' AND status='open' AND (json_extract(details_json,'$.operationId')=${sqlText(operation.operationId)} OR sync_run_id=${sqlText(`${operation.syncRunId}:unit:1`)}))=3`;
  const safeRestoreRaceGuard = `
      AND (SELECT COUNT(*) FROM sync_work_phases WHERE work_key=${sqlText(operation.workKey)})=1
      AND EXISTS (SELECT 1 FROM sync_work_phases WHERE work_key=${sqlText(operation.workKey)} AND phase='chatwoot_runtime_30d_daily_v1' AND json_extract(state_json,'$.stage')='conversations' AND json_extract(state_json,'$.nextSequence')=1)
      AND EXISTS (SELECT 1 FROM queue_operation_attempts WHERE operation_id=${sqlText(operation.operationId)} AND work_key=${sqlText(operation.workKey)} AND generation=${operation.generation} AND original_requested_at=${operation.originalRequestedAt} AND main_queue_attempts=5)
      AND (SELECT COUNT(*) FROM sync_runs WHERE sync_run_id>=${sqlText(`${operation.syncRunId}:unit:`)} AND sync_run_id<${sqlText(`${operation.syncRunId}:unit;`)})=2
      AND EXISTS (SELECT 1 FROM sync_runs WHERE sync_run_id=${sqlText(`${operation.syncRunId}:unit:0`)} AND status='success' AND error_code IS NULL)
      AND EXISTS (SELECT 1 FROM sync_runs WHERE sync_run_id=${sqlText(`${operation.syncRunId}:unit:1`)} AND status='failed' AND error_code='UNHANDLED_SYNC_ERROR' AND error_message='conversation.updated_at must fit a safe integer' AND records_written=0)
      AND (SELECT COUNT(*) FROM dead_letter_operation_metadata WHERE operation_id=${sqlText(operation.operationId)})=3
      AND EXISTS (SELECT 1 FROM dead_letter_operation_metadata m JOIN dead_letter_jobs j ON j.dlq_id=m.dlq_id WHERE m.operation_id=${sqlText(operation.operationId)} AND m.main_queue_attempts=2 AND m.recovery_status='not_started' AND j.status='open' AND j.error_code='CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID')
      AND EXISTS (SELECT 1 FROM dead_letter_operation_metadata m JOIN dead_letter_jobs j ON j.dlq_id=m.dlq_id WHERE m.operation_id=${sqlText(operation.operationId)} AND m.main_queue_attempts=4 AND m.recovery_status='not_started' AND j.status='open' AND j.error_code='PERMANENT_QUEUE_FAILURE' AND j.error_message='conversation.updated_at must fit a safe integer')
      AND EXISTS (SELECT 1 FROM dead_letter_operation_metadata m JOIN dead_letter_jobs j ON j.dlq_id=m.dlq_id WHERE m.operation_id=${sqlText(operation.operationId)} AND m.main_queue_attempts=5 AND m.recovery_status='not_started' AND j.status='open' AND j.error_code='CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID')
      AND (SELECT COUNT(*) FROM system_alerts WHERE platform='chatwoot' AND status='open' AND (json_extract(details_json,'$.operationId')=${sqlText(operation.operationId)} OR sync_run_id=${sqlText(`${operation.syncRunId}:unit:1`)}))=4`;
  const incidentGuard = boundary === CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.safeRestoreRace
    ? safeRestoreRaceGuard
    : boundary === CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.fractionalTimestamp
      ? fractionalTimestampGuard
      : originalGuard;
  return compactSql(`
    UPDATE sync_work_runs
    SET lifecycle_status='active', terminal_reason=NULL, abandoned_at=NULL,
        expires_at=NULL, audit_reference=NULL, updated_at=unixepoch('now')*1000
    WHERE work_key=${sqlText(operation.workKey)}
      AND lifecycle_status='terminal'
      AND terminal_reason='QUEUE_PERMANENT_FAILURE'
      AND abandoned_at=${inspection.abandonedAt}
      AND audit_reference=${sqlText(inspection.auditReference)}
      AND generation=${operation.generation}
      AND requested_at=${operation.originalRequestedAt}
      AND completed_at IS NULL AND completion_json IS NULL
      ${incidentGuard}
      AND NOT EXISTS (SELECT 1 FROM sync_locks WHERE lock_key>='integration_workspace:chatwoot:chemistry_k:' AND lock_key<'integration_workspace:chatwoot:chemistry_k;' AND expires_at>unixepoch('now')*1000)
      AND NOT EXISTS (SELECT 1 FROM sync_work_runs WHERE work_type='chatwoot.conversations.sync' AND lifecycle_status='active')
      AND ${counts};
    SELECT changes() AS reactivated_rows;
  `);
}

export function buildChatwootCurrentIncidentClosureSql(identity = {}, input = {}) {
  const operation = validateIdentity(identity, 'initial');
  const reference = requireText(input.recoveryReference, 'recoveryReference');
  const completedAt = positiveInteger(input.completedAt, 'completedAt');
  const operationId = sqlText(operation.operationId);
  const referenceSql = sqlText(reference);
  return compactSql(`
    UPDATE dead_letter_jobs SET status='resolved', updated_at=${completedAt}
    WHERE dlq_id IN (SELECT dlq_id FROM dead_letter_operation_metadata WHERE operation_id=${operationId})
      AND status='open' AND (
        error_code='CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID'
        OR (error_code='PERMANENT_QUEUE_FAILURE' AND error_message='conversation.updated_at must fit a safe integer')
      );
    SELECT changes() AS current_terminal_rows;
    UPDATE dead_letter_operation_metadata
    SET recovery_status='completed', recovery_reference=${referenceSql}, recovery_started_at=COALESCE(recovery_started_at,${completedAt}), recovery_completed_at=${completedAt}, audit_reference=${referenceSql}, updated_at=${completedAt}
    WHERE operation_id=${operationId} AND main_queue_attempts IN (2,4,5) AND recovery_status='not_started';
    SELECT changes() AS current_metadata_rows;
    UPDATE system_alerts SET status='resolved', updated_at=${completedAt}
    WHERE platform='chatwoot' AND status='open' AND (
      (json_extract(details_json,'$.operationId')=${operationId} AND error_code IN ('CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID','PERMANENT_QUEUE_FAILURE'))
      OR (sync_run_id=${sqlText(`${operation.syncRunId}:unit:1`)} AND error_code='UNHANDLED_SYNC_ERROR' AND message=${sqlText(`รอบ Sync ล้มเหลว\nsync_run_id=${operation.syncRunId}:unit:1\nerror=conversation.updated_at must fit a safe integer`)})
    );
    SELECT changes() AS current_alert_rows;
  `);
}

export function selectLatestIncompleteChatwootSession(candidates = []) {
  const retained = listIncompleteChatwootSessions(candidates);
  if (retained.length === 0) {
    throw incidentError(
      'No incomplete admitted Chatwoot Final UAT session was found',
      'CHATWOOT_INITIAL_FAILURE_SESSION_MISSING',
    );
  }
  const latestCreatedAt = retained[0].session.createdAt;
  const latest = retained.filter((candidate) => candidate.session.createdAt === latestCreatedAt);
  const identities = new Map();
  for (const candidate of latest) {
    const fingerprint = candidate.session.sessionFingerprint;
    const current = identities.get(fingerprint);
    if (!current || isCanonicalRetainedSessionPath(candidate)) identities.set(fingerprint, candidate);
  }
  if (identities.size !== 1) {
    throw incidentError(
      'Latest incomplete Chatwoot Final UAT session is ambiguous',
      'CHATWOOT_INITIAL_FAILURE_SESSION_AMBIGUOUS',
      { candidateCount: identities.size },
    );
  }
  return [...identities.values()][0];
}

function isCanonicalRetainedSessionPath(candidate) {
  const suffix = `/${candidate.session.repositoryHead}/session.json`;
  return candidate.path.replaceAll('\\', '/').endsWith(suffix);
}

export function listIncompleteChatwootSessions(candidates = []) {
  return Object.freeze(candidates
    .filter((candidate) => candidate?.hasInitialSendAttempt === true
      && candidate?.hasAcceptedSummary !== true
      && candidate?.remoteAdmitted !== false)
    .map((candidate) => Object.freeze({
      path: requireText(candidate.path, 'candidate.path'),
      session: validateRetainedSession(candidate.session),
    }))
    .sort((left, right) => right.session.createdAt - left.session.createdAt));
}

export function buildChatwootInitialFailureCandidateSql(candidates = []) {
  const sessions = listIncompleteChatwootSessions(candidates);
  if (sessions.length === 0) {
    throw incidentError('No retained candidate can be inspected', 'CHATWOOT_INITIAL_FAILURE_SESSION_MISSING');
  }
  const clauses = sessions.map(({ session }) => {
    const operation = session.initial;
    return `(q.operation_id=${sqlText(operation.operationId)} AND q.work_key=${sqlText(operation.workKey)} AND q.generation=${operation.generation} AND q.original_requested_at=${operation.originalRequestedAt})`;
  }).join(' OR ');
  return compactSql(`
    SELECT
      q.operation_id,
      q.work_key,
      q.generation,
      q.original_requested_at,
      q.main_queue_attempts,
      w.lifecycle_status,
      (SELECT COUNT(*) FROM sync_runs r WHERE r.sync_run_id>=w.work_key||':unit:' AND r.sync_run_id<w.work_key||':unit;') AS unit_sync_runs
    FROM queue_operation_attempts q
    JOIN sync_work_runs w ON w.work_key=q.work_key
    WHERE ${clauses}
    ORDER BY q.original_requested_at DESC;
  `);
}

export function isChatwootInitialFailureCandidateAdmitted(row = {}) {
  if (!['active', 'terminal'].includes(row.lifecycle_status)) return false;
  const attempts = Number(row.main_queue_attempts);
  const unitRuns = Number(row.unit_sync_runs);
  return ([1, 2].includes(attempts) && unitRuns === 1)
    || ([4, 5].includes(attempts) && unitRuns === 2);
}

export function validateRetainedSession(session = {}) {
  const repositoryHead = requirePattern(session.repositoryHead, SHA, 'repositoryHead');
  const createdAt = positiveInteger(session.createdAt, 'createdAt');
  const initial = validateIdentity(session.initial, 'initial');
  validateIdentity(session.daily, 'daily');
  if (initial.mode !== 'initial') {
    throw incidentError('Retained operation is not Initial UAT', 'CHATWOOT_INITIAL_FAILURE_SESSION_INVALID');
  }
  const fingerprintSource = {
    contractVersion: requireText(session.contractVersion, 'contractVersion'),
    repositoryHead,
    createdAt,
    initial: session.initial,
    daily: session.daily,
  };
  if (session.sessionFingerprint !== sha256(stableJson(fingerprintSource))) {
    throw incidentError(
      'Retained Chatwoot session fingerprint is invalid',
      'CHATWOOT_INITIAL_FAILURE_SESSION_INVALID',
    );
  }
  return Object.freeze({ ...session, repositoryHead, createdAt, initial });
}

export function buildChatwootInitialFailureInspectorSql(identity = {}) {
  const operation = validateIdentity(identity, 'initial');
  const operationId = sqlText(operation.operationId);
  const workKey = sqlText(operation.workKey);
  const syncRunLower = sqlText(`${operation.syncRunId}:unit:`);
  const syncRunUpper = sqlText(`${operation.syncRunId}:unit;`);
  const businessCounts = [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((table) => table.d1Table))]
    .map((table) => `(SELECT COUNT(*) FROM ${table} WHERE account_key='chemistry_k') AS ${table}`)
    .join(', ');
  return compactSql(`
    SELECT
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key=${workKey}) AS work_lifecycle_status,
      (SELECT terminal_reason FROM sync_work_runs WHERE work_key=${workKey}) AS work_terminal_reason,
      (SELECT abandoned_at FROM sync_work_runs WHERE work_key=${workKey}) AS work_abandoned_at,
      (SELECT audit_reference FROM sync_work_runs WHERE work_key=${workKey}) AS work_audit_reference,
      (SELECT generation FROM sync_work_runs WHERE work_key=${workKey}) AS work_generation,
      (SELECT requested_at FROM sync_work_runs WHERE work_key=${workKey}) AS work_requested_at,
      (SELECT COUNT(*) FROM sync_work_runs WHERE work_type='chatwoot.conversations.sync' AND lifecycle_status='active') AS active_chatwoot_work,
      (SELECT COUNT(*) FROM sync_work_phases WHERE work_key=${workKey}) AS phase_rows,
      (SELECT json_extract(state_json,'$.stage') FROM sync_work_phases WHERE work_key=${workKey} AND phase='chatwoot_runtime_30d_daily_v1') AS durable_stage,
      COALESCE((SELECT json_extract(state_json,'$.nextSequence') FROM sync_work_phases WHERE work_key=${workKey} AND phase='chatwoot_runtime_30d_daily_v1'),0) AS next_sequence,
      (SELECT COUNT(*) FROM sync_locks WHERE lock_key>='integration_workspace:chatwoot:chemistry_k:' AND lock_key<'integration_workspace:chatwoot:chemistry_k;' AND expires_at>unixepoch('now')*1000) AS active_lock_count,
      (SELECT COUNT(*) FROM queue_operation_attempts WHERE operation_id=${operationId} AND work_key=${workKey} AND generation=${operation.generation} AND original_requested_at=${operation.originalRequestedAt}) AS queue_operation_rows,
      COALESCE((SELECT main_queue_attempts FROM queue_operation_attempts WHERE operation_id=${operationId} AND work_key=${workKey}),0) AS main_queue_attempts,
      (SELECT COUNT(*) FROM sync_runs WHERE sync_run_id>=${syncRunLower} AND sync_run_id<${syncRunUpper}) AS unit_sync_runs,
      (SELECT COUNT(*) FROM sync_runs WHERE sync_run_id>=${syncRunLower} AND sync_run_id<${syncRunUpper} AND status IN ('failed','partial_success')) AS failed_unit_sync_runs,
      (SELECT sync_run_id FROM sync_runs WHERE sync_run_id>=${syncRunLower} AND sync_run_id<${syncRunUpper} ORDER BY updated_at DESC LIMIT 1) AS failed_sync_run_id,
      (SELECT status FROM sync_runs WHERE sync_run_id>=${syncRunLower} AND sync_run_id<${syncRunUpper} ORDER BY updated_at DESC LIMIT 1) AS unit_sync_run_status,
      (SELECT error_code FROM sync_runs WHERE sync_run_id>=${syncRunLower} AND sync_run_id<${syncRunUpper} ORDER BY updated_at DESC LIMIT 1) AS failed_error_code,
      (SELECT error_message FROM sync_runs WHERE sync_run_id>=${syncRunLower} AND sync_run_id<${syncRunUpper} ORDER BY updated_at DESC LIMIT 1) AS failed_error_message,
      (SELECT details_json FROM sync_runs WHERE sync_run_id>=${syncRunLower} AND sync_run_id<${syncRunUpper} ORDER BY updated_at DESC LIMIT 1) AS failed_details_json,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE sync_run_id>=${syncRunLower} AND sync_run_id<${syncRunUpper}) AS coverage_runs,
      (SELECT COALESCE(SUM(failed_rows),0) FROM data_coverage_runs WHERE sync_run_id>=${syncRunLower} AND sync_run_id<${syncRunUpper}) AS failed_coverage_rows,
      (SELECT COUNT(*) FROM dead_letter_operation_metadata WHERE operation_id=${operationId}) AS current_dlq_records,
      (SELECT j.error_code FROM dead_letter_operation_metadata m JOIN dead_letter_jobs j ON j.dlq_id=m.dlq_id WHERE m.operation_id=${operationId} AND j.status='open' ORDER BY j.created_at DESC LIMIT 1) AS current_dlq_error_code,
      (SELECT j.error_message FROM dead_letter_operation_metadata m JOIN dead_letter_jobs j ON j.dlq_id=m.dlq_id WHERE m.operation_id=${operationId} AND j.status='open' ORDER BY j.created_at DESC LIMIT 1) AS current_dlq_error_message,
      (SELECT COUNT(*) FROM system_alerts WHERE platform='chatwoot' AND status='open' AND (json_extract(details_json,'$.operationId')=${operationId} OR (sync_run_id>=${syncRunLower} AND sync_run_id<${syncRunUpper}))) AS current_open_alerts,
      ${businessCounts};
  `);
}

export function normalizeChatwootInitialFailureInspection(row = {}, identity = {}) {
  const operation = validateIdentity(identity, 'initial');
  const businessCounts = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((table) => table.d1Table))]
      .map((table) => [table, count(row[table], table)]),
  );
  const result = Object.freeze({
    operation,
    workLifecycle: optionalText(row.work_lifecycle_status),
    terminalReason: optionalText(row.work_terminal_reason),
    abandonedAt: nullablePositiveInteger(row.work_abandoned_at, 'work_abandoned_at'),
    auditReference: optionalText(row.work_audit_reference),
    workGeneration: positiveInteger(row.work_generation, 'work_generation'),
    workRequestedAt: positiveInteger(row.work_requested_at, 'work_requested_at'),
    activeChatwootWork: count(row.active_chatwoot_work, 'active_chatwoot_work'),
    phaseRows: count(row.phase_rows, 'phase_rows'),
    durableStage: optionalText(row.durable_stage),
    nextSequence: count(row.next_sequence, 'next_sequence'),
    activeLockCount: count(row.active_lock_count, 'active_lock_count'),
    queueOperationRows: count(row.queue_operation_rows, 'queue_operation_rows'),
    mainQueueAttempts: count(row.main_queue_attempts, 'main_queue_attempts'),
    unitSyncRuns: count(row.unit_sync_runs, 'unit_sync_runs'),
    failedUnitSyncRuns: count(row.failed_unit_sync_runs, 'failed_unit_sync_runs'),
    failedSyncRunId: requireText(row.failed_sync_run_id, 'failed_sync_run_id'),
    unitSyncRunStatus: requireText(row.unit_sync_run_status, 'unit_sync_run_status'),
    errorCode: requireText(row.current_dlq_error_code ?? row.failed_error_code, 'error_code'),
    errorMessage: sanitizeFailureText(row.current_dlq_error_message ?? row.failed_error_message),
    details: sanitizeFailureDetails(row.failed_details_json),
    coverageRuns: count(row.coverage_runs, 'coverage_runs'),
    failedCoverageRows: count(row.failed_coverage_rows, 'failed_coverage_rows'),
    currentDlqRecords: count(row.current_dlq_records, 'current_dlq_records'),
    currentOpenAlerts: count(row.current_open_alerts, 'current_open_alerts'),
    businessCounts: Object.freeze(businessCounts),
  });
  assertExactIncidentIdentity(result);
  return result;
}

export function assertExactIncidentIdentity(inspection = {}) {
  classifyChatwootInitialRecoveryBoundary(inspection);
  return true;
}

export function classifyChatwootInitialRecoveryBoundary(inspection = {}) {
  const operation = validateIdentity(inspection.operation, 'initial');
  const problems = [];
  if (inspection.workGeneration !== operation.generation) problems.push('generation_drift');
  if (inspection.workRequestedAt !== operation.originalRequestedAt) problems.push('requested_at_drift');
  if (inspection.activeLockCount !== 0) problems.push('active_lock');
  if (inspection.queueOperationRows !== 1) problems.push('queue_identity');
  if (!inspection.failedSyncRunId.startsWith(`${operation.syncRunId}:unit:`)) problems.push('sync_run_identity');
  if (inspection.failedCoverageRows !== 0) problems.push('failed_coverage');
  const originalBoundary = inspection.workLifecycle === 'active'
    && inspection.activeChatwootWork === 1
    && inspection.mainQueueAttempts === 1
    && inspection.failedUnitSyncRuns === 1
    && inspection.currentDlqRecords === 0
    && inspection.currentOpenAlerts === 0;
  const terminalBoundary = inspection.workLifecycle === 'terminal'
    && inspection.activeChatwootWork === 0
    && inspection.mainQueueAttempts === 2
    && inspection.unitSyncRunStatus === 'running'
    && inspection.failedUnitSyncRuns === 0
    && inspection.terminalReason === 'QUEUE_PERMANENT_FAILURE'
    && inspection.abandonedAt !== null
    && inspection.auditReference?.startsWith('terminal:')
    && inspection.currentDlqRecords === 1
    && inspection.currentOpenAlerts === 1
    && inspection.errorCode === 'CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID';
  const reactivatedBoundary = inspection.workLifecycle === 'active'
    && inspection.activeChatwootWork === 1
    && inspection.mainQueueAttempts === 2
    && inspection.unitSyncRunStatus === 'running'
    && inspection.failedUnitSyncRuns === 0
    && inspection.terminalReason === null
    && inspection.abandonedAt === null
    && inspection.auditReference === null
    && inspection.currentDlqRecords === 1
    && inspection.currentOpenAlerts === 1
    && inspection.errorCode === 'CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID';
  const fractionalTimestampBoundary = inspection.workLifecycle === 'terminal'
    && inspection.activeChatwootWork === 0
    && inspection.mainQueueAttempts === 4
    && inspection.unitSyncRuns === 2
    && inspection.unitSyncRunStatus === 'failed'
    && inspection.failedUnitSyncRuns === 1
    && inspection.phaseRows === 1
    && inspection.durableStage === 'conversations'
    && inspection.nextSequence === 1
    && inspection.terminalReason === 'QUEUE_PERMANENT_FAILURE'
    && inspection.abandonedAt !== null
    && inspection.auditReference?.startsWith('terminal:')
    && inspection.currentDlqRecords === 2
    && inspection.currentOpenAlerts === 3
    && inspection.errorCode === 'PERMANENT_QUEUE_FAILURE'
    && inspection.errorMessage === 'conversation.updated_at must fit a safe integer';
  const fractionalTimestampReactivated = inspection.workLifecycle === 'active'
    && inspection.activeChatwootWork === 1
    && inspection.mainQueueAttempts === 4
    && inspection.unitSyncRuns === 2
    && inspection.unitSyncRunStatus === 'failed'
    && inspection.failedUnitSyncRuns === 1
    && inspection.phaseRows === 1
    && inspection.durableStage === 'conversations'
    && inspection.nextSequence === 1
    && inspection.terminalReason === null
    && inspection.abandonedAt === null
    && inspection.auditReference === null
    && inspection.currentDlqRecords === 2
    && inspection.currentOpenAlerts === 3
    && inspection.errorCode === 'PERMANENT_QUEUE_FAILURE'
    && inspection.errorMessage === 'conversation.updated_at must fit a safe integer';
  const safeRestoreRaceBoundary = inspection.workLifecycle === 'terminal'
    && inspection.activeChatwootWork === 0
    && inspection.mainQueueAttempts === 5
    && inspection.unitSyncRuns === 2
    && inspection.unitSyncRunStatus === 'failed'
    && inspection.failedUnitSyncRuns === 1
    && inspection.phaseRows === 1
    && inspection.durableStage === 'conversations'
    && inspection.nextSequence === 1
    && inspection.terminalReason === 'QUEUE_PERMANENT_FAILURE'
    && inspection.abandonedAt !== null
    && inspection.auditReference?.startsWith('terminal:')
    && inspection.currentDlqRecords === 3
    && inspection.currentOpenAlerts === 4
    && inspection.errorCode === 'CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID'
    && inspection.errorMessage === 'Chatwoot connector is disabled or outside the protected UAT runtime';
  const safeRestoreRaceReactivated = inspection.workLifecycle === 'active'
    && inspection.activeChatwootWork === 1
    && inspection.mainQueueAttempts === 5
    && inspection.unitSyncRuns === 2
    && inspection.unitSyncRunStatus === 'failed'
    && inspection.failedUnitSyncRuns === 1
    && inspection.phaseRows === 1
    && inspection.durableStage === 'conversations'
    && inspection.nextSequence === 1
    && inspection.terminalReason === null
    && inspection.abandonedAt === null
    && inspection.auditReference === null
    && inspection.currentDlqRecords === 3
    && inspection.currentOpenAlerts === 4
    && inspection.errorCode === 'CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID'
    && inspection.errorMessage === 'Chatwoot connector is disabled or outside the protected UAT runtime';
  const original = originalBoundary || terminalBoundary || reactivatedBoundary;
  const fractional = fractionalTimestampBoundary || fractionalTimestampReactivated;
  const race = safeRestoreRaceBoundary || safeRestoreRaceReactivated;
  if (original && (inspection.unitSyncRuns !== 1 || inspection.phaseRows !== 0
      || inspection.durableStage !== null || inspection.nextSequence !== 0)) {
    problems.push('original_durable_boundary');
  }
  if (!original && !fractional && !race) problems.push('incident_boundary');
  if (problems.length > 0) {
    throw incidentError(
      'Current Chatwoot Initial failure no longer matches the recoverable exact boundary',
      'CHATWOOT_INITIAL_FAILURE_BOUNDARY_DRIFT',
      { problems },
    );
  }
  if (race) return CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.safeRestoreRace;
  if (fractional) return CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.fractionalTimestamp;
  return CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.original;
}

export function sanitizeFailureDetails(value) {
  let parsed = {};
  try { parsed = JSON.parse(String(value ?? '{}')); } catch { parsed = { parseStatus: 'invalid_json' }; }
  return deepSanitize(parsed, 0);
}

export function sanitizeFailureText(value) {
  return String(value ?? '')
    .replaceAll(/https?:\/\/\S+/giu, '[url]')
    .replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email]')
    .replaceAll(/[A-Za-z0-9_-]{32,}/gu, '[redacted]')
    .slice(0, 500);
}

function deepSanitize(value, depth) {
  if (depth > 4) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return Object.freeze(value.slice(0, 25).map((item) => deepSanitize(item, depth + 1)));
  if (typeof value !== 'object') return typeof value === 'string' ? sanitizeFailureText(value) : value;
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .slice(0, 50)
    .map(([key, nested]) => [key, deepSanitize(nested, depth + 1)])));
}

function validateIdentity(value = {}, fieldName) {
  const operationId = requirePattern(value.operationId, OPERATION_ID, `${fieldName}.operationId`);
  const originalRequestedAt = positiveInteger(value.originalRequestedAt, `${fieldName}.originalRequestedAt`);
  const generation = positiveInteger(value.generation, `${fieldName}.generation`);
  const workKey = requireText(value.workKey, `${fieldName}.workKey`);
  const syncRunId = requireText(value.syncRunId, `${fieldName}.syncRunId`);
  if (workKey !== `chatwoot:chemistry_k:${operationId}` || syncRunId !== workKey
      || generation !== originalRequestedAt) {
    throw incidentError('Retained Chatwoot identity is inconsistent', 'CHATWOOT_INITIAL_FAILURE_SESSION_INVALID');
  }
  return Object.freeze({
    mode: requireText(value.mode, `${fieldName}.mode`),
    operationId,
    workKey,
    syncRunId,
    originalRequestedAt,
    generation,
  });
}

function compactSql(value) { return String(value).replace(/\s+/gu, ' ').trim(); }
function sqlText(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function requirePattern(value, pattern, fieldName) {
  const text = requireText(value, fieldName);
  if (!pattern.test(text)) throw incidentError(`${fieldName} is invalid`, 'CHATWOOT_INITIAL_FAILURE_SESSION_INVALID');
  return text;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw incidentError(`${fieldName} is required`, 'CHATWOOT_INITIAL_FAILURE_VALUE_INVALID');
  }
  return value.trim();
}
function optionalText(value) { return value === null || value === undefined || value === '' ? null : String(value); }
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw incidentError(`${fieldName} is invalid`, 'CHATWOOT_INITIAL_FAILURE_VALUE_INVALID');
  return number;
}
function nullablePositiveInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return positiveInteger(value, fieldName);
}
function count(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw incidentError(`${fieldName} is invalid`, 'CHATWOOT_INITIAL_FAILURE_VALUE_INVALID');
  return number;
}
function incidentError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootInitialTerminalFailureRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
