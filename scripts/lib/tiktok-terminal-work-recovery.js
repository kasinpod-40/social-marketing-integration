export const TIKTOK_TERMINAL_WORK_INCIDENT = Object.freeze({
  requestedAt: 1784829780000,
  operationId: 'f59b852f00634005c7ff4da51afee964',
  workKey: 'tiktok:f59b852f00634005c7ff4da51afee964',
  cursorKey: 'integration_workspace:tiktok:chemistry_k:organic_history_bootstrap',
  generation: 1784829780000,
  originalDlqId: 'dlq:8d1b9077657385a417cb32a0ed3114cb',
  originalDlqMessageId: '8d1b9077657385a417cb32a0ed3114cb',
  failedRecoveryDlqId: 'dlq:06f7660b796808ebca3b8cd2e7780894',
  failedRecoveryMessageId: '06f7660b796808ebca3b8cd2e7780894',
  recoveryReference: 'recovery:dlq:8d1b9077657385a417cb32a0ed3114cb:tiktok:f59b852f00634005c7ff4da51afee964',
  phase: 'tiktok_organic_history_write_v1',
  failedErrorCode: 'D1_ORGANIC_OBSERVATION_READ_FAILED',
  firstFailedRunStartedAt: 1784867235382,
  expectedMainQueueAttempts: 6,
  expectedFailedRuns: 6,
  expectedRows: 2021,
  databaseName: 'social-mkt-state-dev',
});

export const TIKTOK_TERMINAL_WORK_PHASES = Object.freeze(['plan', 'reactivate', 'resume']);

export const TIKTOK_TERMINAL_WORK_CONFIRMATIONS = Object.freeze({
  reactivate: Object.freeze({
    envName: 'CONFIRM_TIKTOK_TERMINAL_WORK_REACTIVATION',
    value: 'REACTIVATE_EXACT_TERMINAL_TIKTOK_WORK_ONLY',
  }),
  resume: Object.freeze({
    envName: 'CONFIRM_TIKTOK_TERMINAL_WORK_RESUME',
    value: 'SEND_EXACT_REACTIVATED_TIKTOK_RECOVERY_ONCE',
  }),
});

export function parseTikTokTerminalWorkArgs(argv = []) {
  let phase = 'plan';
  let execute = false;
  for (const value of argv) {
    if (value === '--execute') {
      execute = true;
      continue;
    }
    if (value.startsWith('--phase=')) {
      phase = value.slice('--phase='.length).trim();
      continue;
    }
    throw new TypeError(`Unknown TikTok terminal-work operator argument: ${value}`);
  }
  if (!TIKTOK_TERMINAL_WORK_PHASES.includes(phase)) {
    throw new TypeError(`Unsupported TikTok terminal-work operator phase: ${phase}`);
  }
  return Object.freeze({ phase, execute });
}

export function assertTikTokTerminalWorkConfirmation(phase, env = {}) {
  const contract = TIKTOK_TERMINAL_WORK_CONFIRMATIONS[phase];
  if (!contract) return true;
  if (env[contract.envName] !== contract.value) {
    throw terminalWorkError(
      `TikTok terminal-work phase ${phase} requires ${contract.envName}=${contract.value}`,
      'TIKTOK_TERMINAL_WORK_CONFIRMATION_REQUIRED',
      { phase, envName: contract.envName },
    );
  }
  return true;
}

export function assertTikTokTerminalWorkEnv(phase, env = {}) {
  const required = ['WRANGLER_CONFIG', 'MKT_D1_DATABASE_NAME'];
  if (phase === 'resume') {
    required.push('CLOUDFLARE_ACCOUNT_ID', 'CF_QUEUE_ID', 'CLOUDFLARE_API_TOKEN');
  }
  for (const name of required) {
    if (typeof env[name] !== 'string' || env[name].trim() === '') {
      throw terminalWorkError(`TikTok terminal-work operator requires ${name}`, 'TIKTOK_TERMINAL_WORK_ENV_MISSING', {
        phase,
        envName: name,
      });
    }
  }
  if (env.MKT_D1_DATABASE_NAME !== TIKTOK_TERMINAL_WORK_INCIDENT.databaseName) {
    throw terminalWorkError('TikTok terminal-work D1 target mismatch', 'TIKTOK_TERMINAL_WORK_TARGET_MISMATCH', {
      expected: TIKTOK_TERMINAL_WORK_INCIDENT.databaseName,
      actual: env.MKT_D1_DATABASE_NAME,
    });
  }
  return Object.freeze({
    wranglerConfig: env.WRANGLER_CONFIG,
    databaseName: env.MKT_D1_DATABASE_NAME,
    accountId: optionalText(env.CLOUDFLARE_ACCOUNT_ID),
    queueId: optionalText(env.CF_QUEUE_ID),
  });
}

export function buildTikTokTerminalWorkEvidenceSql() {
  const incident = TIKTOK_TERMINAL_WORK_INCIDENT;
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM organic_content_state) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations) AS organic_content_observations,
      (SELECT COUNT(*) FROM data_coverage_entities) AS data_coverage_entities,
      (SELECT cursor_key FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_cursor_key,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_status,
      (SELECT terminal_reason FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_terminal_reason,
      (SELECT audit_reference FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_audit_reference,
      (SELECT completed_at FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_completed_at,
      (SELECT generation FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_generation,
      (SELECT requested_at FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_requested_at,
      (SELECT json_extract(state_json, '$.nextSequence') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS next_sequence,
      (SELECT json_extract(state_json, '$.unitsCompleted') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS units_completed,
      (SELECT json_extract(state_json, '$.rawRecordsCompleted') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS raw_records_completed,
      (SELECT json_extract(state_json, '$.contentRowsDurable') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS content_rows_durable,
      (SELECT json_extract(state_json, '$.observationRowsDurable') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS observation_rows_durable,
      (SELECT json_extract(state_json, '$.coverageEntitiesWritten') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS coverage_entities_written,
      (SELECT complete FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS phase_complete,
      (SELECT cursor_key FROM sync_generation_fences WHERE work_key='${incident.workKey}') AS fence_cursor_key,
      (SELECT generation FROM sync_generation_fences WHERE work_key='${incident.workKey}') AS fence_generation,
      (SELECT requested_at FROM sync_generation_fences WHERE work_key='${incident.workKey}') AS fence_requested_at,
      (SELECT status FROM dead_letter_jobs WHERE dlq_id='${incident.originalDlqId}') AS original_dlq_status,
      (SELECT message_id FROM dead_letter_jobs WHERE dlq_id='${incident.originalDlqId}') AS original_dlq_message_id,
      (SELECT job_type FROM dead_letter_jobs WHERE dlq_id='${incident.originalDlqId}') AS original_dlq_job_type,
      (SELECT error_code FROM dead_letter_jobs WHERE dlq_id='${incident.originalDlqId}') AS original_dlq_error_code,
      (SELECT retry_count FROM dead_letter_jobs WHERE dlq_id='${incident.originalDlqId}') AS original_dlq_retry_count,
      (SELECT recovery_status FROM dead_letter_operation_metadata WHERE dlq_id='${incident.originalDlqId}') AS recovery_status,
      (SELECT recovery_reference FROM dead_letter_operation_metadata WHERE dlq_id='${incident.originalDlqId}') AS recovery_reference,
      (SELECT operation_id FROM dead_letter_operation_metadata WHERE dlq_id='${incident.originalDlqId}') AS recovery_operation_id,
      (SELECT original_work_key FROM dead_letter_operation_metadata WHERE dlq_id='${incident.originalDlqId}') AS recovery_work_key,
      (SELECT generation FROM dead_letter_operation_metadata WHERE dlq_id='${incident.originalDlqId}') AS recovery_generation,
      (SELECT original_requested_at FROM dead_letter_operation_metadata WHERE dlq_id='${incident.originalDlqId}') AS recovery_requested_at,
      (SELECT main_queue_attempts FROM queue_operation_attempts WHERE operation_id='${incident.operationId}') AS main_queue_attempts,
      (SELECT status FROM dead_letter_jobs WHERE dlq_id='${incident.failedRecoveryDlqId}') AS failed_recovery_dlq_status,
      (SELECT message_id FROM dead_letter_jobs WHERE dlq_id='${incident.failedRecoveryDlqId}') AS failed_recovery_message_id,
      (SELECT job_type FROM dead_letter_jobs WHERE dlq_id='${incident.failedRecoveryDlqId}') AS failed_recovery_job_type,
      (SELECT error_code FROM dead_letter_jobs WHERE dlq_id='${incident.failedRecoveryDlqId}') AS failed_recovery_error_code,
      (SELECT retry_count FROM dead_letter_jobs WHERE dlq_id='${incident.failedRecoveryDlqId}') AS failed_recovery_retry_count,
      (SELECT COUNT(*) FROM sync_runs WHERE platform='tiktok' AND sync_type='organic_history_bootstrap' AND started_at>=${incident.firstFailedRunStartedAt} AND status='failed' AND error_code='${incident.failedErrorCode}') AS matching_failed_runs,
      (SELECT MAX(retry_count) FROM sync_runs WHERE platform='tiktok' AND sync_type='organic_history_bootstrap' AND started_at>=${incident.firstFailedRunStartedAt} AND status='failed' AND error_code='${incident.failedErrorCode}') AS max_failed_retry_count,
      (SELECT expires_at FROM sync_locks WHERE lock_key='${incident.cursorKey}') AS lock_expires_at,
      (SELECT status FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_status,
      (SELECT expected_entities FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_expected_entities,
      (SELECT observed_entities FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_observed_entities,
      (SELECT expected_rows FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_expected_rows,
      (SELECT observed_rows FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_observed_rows,
      (SELECT failed_rows FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_failed_rows,
      (SELECT completed_at FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_completed_at;
  `);
}

export function buildTikTokTerminalWorkReactivationSql(now = Date.now()) {
  const incident = TIKTOK_TERMINAL_WORK_INCIDENT;
  const updatedAt = safeTimestamp(now, 'now');
  return compactSql(`
    UPDATE sync_work_runs
    SET lifecycle_status='active',
        terminal_reason=NULL,
        abandoned_at=NULL,
        expires_at=NULL,
        audit_reference=NULL,
        updated_at=${updatedAt}
    WHERE work_key='${incident.workKey}'
      AND cursor_key='${incident.cursorKey}'
      AND generation=${incident.generation}
      AND requested_at=${incident.requestedAt}
      AND lifecycle_status='terminal'
      AND terminal_reason='QUEUE_RETRY_EXHAUSTED'
      AND audit_reference='${incident.failedRecoveryDlqId}'
      AND completed_at IS NULL
      AND EXISTS (
        SELECT 1 FROM sync_work_phases
        WHERE work_key='${incident.workKey}'
          AND phase='${incident.phase}'
          AND complete=0
          AND json_extract(state_json, '$.nextSequence')=2
          AND json_extract(state_json, '$.unitsCompleted')=2
          AND json_extract(state_json, '$.rawRecordsCompleted')=1000
          AND json_extract(state_json, '$.contentRowsDurable')=1000
          AND json_extract(state_json, '$.observationRowsDurable')=1000
          AND json_extract(state_json, '$.coverageEntitiesWritten')=1000
      )
      AND EXISTS (
        SELECT 1 FROM sync_generation_fences
        WHERE cursor_key='${incident.cursorKey}'
          AND generation=${incident.generation}
          AND requested_at=${incident.requestedAt}
          AND work_key='${incident.workKey}'
      )
      AND EXISTS (
        SELECT 1 FROM dead_letter_jobs
        WHERE dlq_id='${incident.originalDlqId}'
          AND message_id='${incident.originalDlqMessageId}'
          AND job_type='tiktok.creator.native.history.bootstrap'
          AND status='open'
          AND error_code='QUEUE_RETRY_EXHAUSTED'
      )
      AND EXISTS (
        SELECT 1 FROM dead_letter_jobs
        WHERE dlq_id='${incident.failedRecoveryDlqId}'
          AND message_id='${incident.failedRecoveryMessageId}'
          AND job_type='tiktok.creator.native.history.recover'
          AND status='open'
          AND error_code='QUEUE_RETRY_EXHAUSTED'
          AND retry_count=${incident.expectedMainQueueAttempts}
      )
      AND EXISTS (
        SELECT 1 FROM dead_letter_operation_metadata
        WHERE dlq_id='${incident.originalDlqId}'
          AND operation_id='${incident.operationId}'
          AND original_work_key='${incident.workKey}'
          AND generation=${incident.generation}
          AND original_requested_at=${incident.requestedAt}
          AND recovery_status='in_progress'
          AND recovery_reference='${incident.recoveryReference}'
      )
      AND EXISTS (
        SELECT 1 FROM queue_operation_attempts
        WHERE operation_id='${incident.operationId}'
          AND work_key='${incident.workKey}'
          AND main_queue_attempts=${incident.expectedMainQueueAttempts}
      )
      AND NOT EXISTS (
        SELECT 1 FROM sync_locks
        WHERE lock_key='${incident.cursorKey}' AND expires_at>=${updatedAt}
      );
    SELECT changes() AS reactivated_rows;
  `);
}

export function validateTikTokTerminalWorkRow(row, expectedStatus = 'terminal', now = Date.now()) {
  const incident = TIKTOK_TERMINAL_WORK_INCIDENT;
  const terminal = expectedStatus === 'terminal';
  assertRowMatches(row, {
    organic_content_state: 1309,
    organic_content_observations: 1000,
    data_coverage_entities: 1000,
    work_cursor_key: incident.cursorKey,
    work_status: expectedStatus,
    work_terminal_reason: terminal ? 'QUEUE_RETRY_EXHAUSTED' : null,
    work_audit_reference: terminal ? incident.failedRecoveryDlqId : null,
    work_completed_at: null,
    work_generation: incident.generation,
    work_requested_at: incident.requestedAt,
    next_sequence: 2,
    units_completed: 2,
    raw_records_completed: 1000,
    content_rows_durable: 1000,
    observation_rows_durable: 1000,
    coverage_entities_written: 1000,
    phase_complete: 0,
    fence_cursor_key: incident.cursorKey,
    fence_generation: incident.generation,
    fence_requested_at: incident.requestedAt,
    original_dlq_status: 'open',
    original_dlq_message_id: incident.originalDlqMessageId,
    original_dlq_job_type: 'tiktok.creator.native.history.bootstrap',
    original_dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
    original_dlq_retry_count: 1,
    recovery_status: 'in_progress',
    recovery_reference: incident.recoveryReference,
    recovery_operation_id: incident.operationId,
    recovery_work_key: incident.workKey,
    recovery_generation: incident.generation,
    recovery_requested_at: incident.requestedAt,
    main_queue_attempts: incident.expectedMainQueueAttempts,
    failed_recovery_dlq_status: 'open',
    failed_recovery_message_id: incident.failedRecoveryMessageId,
    failed_recovery_job_type: 'tiktok.creator.native.history.recover',
    failed_recovery_error_code: 'QUEUE_RETRY_EXHAUSTED',
    failed_recovery_retry_count: incident.expectedMainQueueAttempts,
    matching_failed_runs: incident.expectedFailedRuns,
    max_failed_retry_count: incident.expectedMainQueueAttempts - 1,
    coverage_status: 'partial',
    coverage_expected_entities: incident.expectedRows,
    coverage_observed_entities: 0,
    coverage_expected_rows: incident.expectedRows,
    coverage_observed_rows: 0,
    coverage_failed_rows: 0,
    coverage_completed_at: null,
  });
  const expiresAt = normalizeScalar(row?.lock_expires_at);
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt >= now)) {
    throw terminalWorkError('TikTok terminal-work lock is not proven absent or expired', 'TIKTOK_TERMINAL_WORK_LOCK_ACTIVE', {
      expiresAt: row?.lock_expires_at ?? null,
      now,
    });
  }
  return Object.freeze({ ...row, lockExpiredOrAbsent: true });
}

export function validateTikTokTerminalWorkReactivationResult(rows) {
  const match = rows.find((row) => Object.hasOwn(row ?? {}, 'reactivated_rows'));
  if (normalizeScalar(match?.reactivated_rows) !== 1) {
    throw terminalWorkError('Exact TikTok terminal Work was not reactivated once', 'TIKTOK_TERMINAL_WORK_REACTIVATION_FAILED', {
      expected: 1,
      actual: match?.reactivated_rows ?? null,
    });
  }
  return Object.freeze({ reactivatedRows: 1 });
}

function assertRowMatches(row, expected) {
  for (const [fieldName, expectedValue] of Object.entries(expected)) {
    if (normalizeScalar(row?.[fieldName]) !== normalizeScalar(expectedValue)) {
      throw terminalWorkError('TikTok terminal-work evidence mismatch', 'TIKTOK_TERMINAL_WORK_EVIDENCE_MISMATCH', {
        fieldName,
        expected: expectedValue,
        actual: row?.[fieldName] ?? null,
      });
    }
  }
}

function normalizeScalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value).trim();
  if (text === '') return '';
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function safeTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`TikTok terminal-work ${fieldName} must be a non-negative safe integer`);
  }
  return number;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function terminalWorkError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokTerminalWorkRecoveryOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
