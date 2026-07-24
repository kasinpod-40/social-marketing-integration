export const TIKTOK_RECOVERY_BIND_HOTFIX_MERGE = '9ada02baf6059b6d9efc1aab2b96a4ff3b0bdfa4';

export const TIKTOK_RECOVERY_BIND_FAILURE = Object.freeze({
  requestedAt: 1784829780000,
  operationId: 'f59b852f00634005c7ff4da51afee964',
  workKey: 'tiktok:f59b852f00634005c7ff4da51afee964',
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

export const TIKTOK_RECOVERY_BIND_HOTFIX_PHASES = Object.freeze(['plan', 'deploy', 'resume']);

export const TIKTOK_RECOVERY_BIND_HOTFIX_CONFIRMATIONS = Object.freeze({
  deploy: Object.freeze({
    envName: 'CONFIRM_TIKTOK_RECOVERY_HOTFIX_DEPLOY',
    value: 'DEPLOY_D1_BIND_LIMIT_HOTFIX_SCHEDULES_FALSE',
  }),
  resume: Object.freeze({
    envName: 'CONFIRM_TIKTOK_RECOVERY_RESUME',
    value: 'RESUME_EXACT_TIKTOK_RECOVERY_AFTER_D1_BIND_FIX',
  }),
});

export function parseTikTokRecoveryBindHotfixArgs(argv = []) {
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
    throw new TypeError(`Unknown TikTok bind-hotfix operator argument: ${value}`);
  }
  if (!TIKTOK_RECOVERY_BIND_HOTFIX_PHASES.includes(phase)) {
    throw new TypeError(`Unsupported TikTok bind-hotfix operator phase: ${phase}`);
  }
  return Object.freeze({ phase, execute });
}

export function assertTikTokRecoveryBindHotfixConfirmation(phase, env = {}) {
  const contract = TIKTOK_RECOVERY_BIND_HOTFIX_CONFIRMATIONS[phase];
  if (!contract) return true;
  if (env[contract.envName] !== contract.value) {
    throw hotfixError(
      `TikTok bind-hotfix phase ${phase} requires ${contract.envName}=${contract.value}`,
      'TIKTOK_RECOVERY_BIND_HOTFIX_CONFIRMATION_REQUIRED',
      { phase, envName: contract.envName },
    );
  }
  return true;
}

export function assertTikTokRecoveryBindHotfixEnv(phase, env = {}) {
  const required = ['WRANGLER_CONFIG', 'MKT_D1_DATABASE_NAME'];
  if (phase === 'resume') {
    required.push('CLOUDFLARE_ACCOUNT_ID', 'CF_QUEUE_ID', 'CLOUDFLARE_API_TOKEN');
  }
  for (const name of required) {
    if (typeof env[name] !== 'string' || env[name].trim() === '') {
      throw hotfixError(`TikTok bind-hotfix operator requires ${name}`, 'TIKTOK_RECOVERY_BIND_HOTFIX_ENV_MISSING', {
        phase,
        envName: name,
      });
    }
  }
  if (env.MKT_D1_DATABASE_NAME !== TIKTOK_RECOVERY_BIND_FAILURE.databaseName) {
    throw hotfixError('TikTok bind-hotfix D1 target mismatch', 'TIKTOK_RECOVERY_BIND_HOTFIX_TARGET_MISMATCH', {
      expected: TIKTOK_RECOVERY_BIND_FAILURE.databaseName,
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

export function buildTikTokRecoveryBindResumeSql() {
  const incident = TIKTOK_RECOVERY_BIND_FAILURE;
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM organic_content_state) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations) AS organic_content_observations,
      (SELECT COUNT(*) FROM data_coverage_entities) AS data_coverage_entities,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_status,
      (SELECT generation FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_generation,
      (SELECT requested_at FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_requested_at,
      (SELECT json_extract(state_json, '$.nextSequence') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS next_sequence,
      (SELECT json_extract(state_json, '$.unitsCompleted') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS units_completed,
      (SELECT json_extract(state_json, '$.rawRecordsCompleted') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS raw_records_completed,
      (SELECT json_extract(state_json, '$.contentRowsDurable') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS content_rows_durable,
      (SELECT json_extract(state_json, '$.observationRowsDurable') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS observation_rows_durable,
      (SELECT json_extract(state_json, '$.coverageEntitiesWritten') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS coverage_entities_written,
      (SELECT complete FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS phase_complete,
      (SELECT status FROM dead_letter_jobs WHERE dlq_id='${incident.originalDlqId}') AS original_dlq_status,
      (SELECT message_id FROM dead_letter_jobs WHERE dlq_id='${incident.originalDlqId}') AS original_dlq_message_id,
      (SELECT error_code FROM dead_letter_jobs WHERE dlq_id='${incident.originalDlqId}') AS original_dlq_error_code,
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
      (SELECT expires_at FROM sync_locks WHERE lock_key=(SELECT cursor_key FROM sync_work_runs WHERE work_key='${incident.workKey}')) AS lock_expires_at,
      (SELECT status FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_status,
      (SELECT expected_entities FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_expected_entities,
      (SELECT observed_entities FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_observed_entities,
      (SELECT expected_rows FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_expected_rows,
      (SELECT observed_rows FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_observed_rows,
      (SELECT failed_rows FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_failed_rows,
      (SELECT completed_at FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_completed_at;
  `);
}

export function validateTikTokRecoveryBindResumeRow(row, now = Date.now()) {
  const incident = TIKTOK_RECOVERY_BIND_FAILURE;
  assertRowMatches(row, {
    organic_content_state: 1309,
    organic_content_observations: 1000,
    data_coverage_entities: 1000,
    work_status: 'active',
    work_generation: incident.generation,
    work_requested_at: incident.requestedAt,
    next_sequence: 2,
    units_completed: 2,
    raw_records_completed: 1000,
    content_rows_durable: 1000,
    observation_rows_durable: 1000,
    coverage_entities_written: 1000,
    phase_complete: 0,
    original_dlq_status: 'open',
    original_dlq_message_id: incident.originalDlqMessageId,
    original_dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
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
    throw hotfixError('TikTok recovery resume lock is not proven absent or expired', 'TIKTOK_RECOVERY_BIND_HOTFIX_LOCK_ACTIVE', {
      expiresAt: row?.lock_expires_at ?? null,
      now,
    });
  }
  return Object.freeze({ ...row, lockExpiredOrAbsent: true });
}

function assertRowMatches(row, expected) {
  for (const [fieldName, expectedValue] of Object.entries(expected)) {
    if (normalizeScalar(row?.[fieldName]) !== normalizeScalar(expectedValue)) {
      throw hotfixError('TikTok recovery resume evidence mismatch', 'TIKTOK_RECOVERY_BIND_HOTFIX_EVIDENCE_MISMATCH', {
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

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hotfixError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokRecoveryBindHotfixOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
