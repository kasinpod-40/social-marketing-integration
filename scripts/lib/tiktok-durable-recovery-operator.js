export const TIKTOK_DURABLE_RECOVERY_INCIDENT = Object.freeze({
  requestedAt: 1784829780000,
  operationId: 'f59b852f00634005c7ff4da51afee964',
  workKey: 'tiktok:f59b852f00634005c7ff4da51afee964',
  generation: 1784829780000,
  dlqId: 'dlq:8d1b9077657385a417cb32a0ed3114cb',
  dlqMessageId: '8d1b9077657385a417cb32a0ed3114cb',
  phase: 'tiktok_organic_history_write_v1',
  initialNextSequence: 2,
  expectedRows: 2021,
  databaseName: 'social-mkt-state-dev',
  queueName: 'social-mkt-sync-jobs',
  workerName: 'social-mkt-sync-worker',
});

export const TIKTOK_DURABLE_RECOVERY_PHASES = Object.freeze([
  'plan',
  'preflight',
  'backup',
  'migrate',
  'deploy',
  'send',
  'verify',
  'replay',
  'replay-verify',
]);

export const TIKTOK_DURABLE_RECOVERY_CONFIRMATIONS = Object.freeze({
  backup: Object.freeze({
    envName: 'CONFIRM_TIKTOK_RECOVERY_BACKUP',
    value: 'BACKUP_EXACT_TIKTOK_RECOVERY_INCIDENT',
  }),
  migrate: Object.freeze({
    envName: 'CONFIRM_TIKTOK_RECOVERY_MIGRATION',
    value: 'APPLY_0010_EXACT_TIKTOK_RECOVERY',
  }),
  deploy: Object.freeze({
    envName: 'CONFIRM_TIKTOK_RECOVERY_DEPLOY',
    value: 'DEPLOY_EXACT_TIKTOK_RECOVERY_SCHEDULES_FALSE',
  }),
  send: Object.freeze({
    envName: 'CONFIRM_TIKTOK_RECOVERY_QUEUE_SEND',
    value: 'SEND_EXACT_TIKTOK_RECOVERY_ONCE',
  }),
  replay: Object.freeze({
    envName: 'CONFIRM_TIKTOK_RECOVERY_REPLAY',
    value: 'REPLAY_EXACT_TIKTOK_RECOVERY_ONCE',
  }),
});

const EXPECTED_PENDING_MIGRATION = '0010_tiktok_bootstrap_durable_recovery.sql';
const REQUIRED_FALSE_FLAGS = Object.freeze([
  'MKT_SCHEDULE_TIKTOK_ENABLED',
  'MKT_SCHEDULE_YOUTUBE_ENABLED',
  'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
  'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
  'MKT_REPORT_D1_SHADOW_READ_ENABLED',
  'MKT_REPORT_D1_READ_ENABLED',
  'MKT_LARK_DAILY_RETENTION_ENABLED',
  'MKT_NOTIFICATION_RUNTIME_ENABLED',
  'MKT_DLQ_REDRIVE_ENABLED',
]);
const REQUIRED_TRUE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_TIKTOK_ENABLED',
  'MKT_TIME_SERIES_D1_WRITE_ENABLED',
  'MKT_TIME_SERIES_D1_BACKFILL_ENABLED',
]);

export function parseTikTokDurableRecoveryArgs(argv = []) {
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
    throw new TypeError(`Unknown TikTok recovery operator argument: ${value}`);
  }
  if (!TIKTOK_DURABLE_RECOVERY_PHASES.includes(phase)) {
    throw new TypeError(`Unsupported TikTok recovery operator phase: ${phase}`);
  }
  return Object.freeze({ phase, execute });
}

export function assertTikTokDurableRecoveryConfirmation(phase, env = {}) {
  const contract = TIKTOK_DURABLE_RECOVERY_CONFIRMATIONS[phase];
  if (!contract) return true;
  if (env[contract.envName] !== contract.value) {
    throw operatorError(
      `TikTok recovery phase ${phase} requires ${contract.envName}=${contract.value}`,
      'TIKTOK_RECOVERY_CONFIRMATION_REQUIRED',
      { phase, envName: contract.envName },
    );
  }
  return true;
}

export function assertTikTokDurableRecoveryOperatorEnv(phase, env = {}) {
  const required = ['WRANGLER_CONFIG', 'MKT_D1_DATABASE_NAME'];
  if (new Set(['send', 'replay']).has(phase)) {
    required.push('CF_ACCOUNT_ID', 'CF_QUEUE_ID', 'CLOUDFLARE_API_TOKEN');
  }
  for (const name of required) {
    if (typeof env[name] !== 'string' || env[name].trim() === '') {
      throw operatorError(`TikTok recovery operator requires ${name}`, 'TIKTOK_RECOVERY_ENV_MISSING', {
        phase,
        envName: name,
      });
    }
  }
  if (env.MKT_D1_DATABASE_NAME !== TIKTOK_DURABLE_RECOVERY_INCIDENT.databaseName) {
    throw operatorError('TikTok recovery D1 database name does not match the Integration Workspace incident', 'TIKTOK_RECOVERY_TARGET_MISMATCH', {
      expected: TIKTOK_DURABLE_RECOVERY_INCIDENT.databaseName,
      actual: env.MKT_D1_DATABASE_NAME,
    });
  }
  return Object.freeze({
    wranglerConfig: env.WRANGLER_CONFIG,
    databaseName: env.MKT_D1_DATABASE_NAME,
    accountId: optionalText(env.CF_ACCOUNT_ID),
    queueId: optionalText(env.CF_QUEUE_ID),
  });
}

export function buildTikTokDurableRecoveryJob(input = {}) {
  const recoveryReference = optionalText(input.recoveryReference)
    ?? `recovery:${TIKTOK_DURABLE_RECOVERY_INCIDENT.dlqId}:${TIKTOK_DURABLE_RECOVERY_INCIDENT.workKey}`;
  return Object.freeze({
    schemaVersion: 1,
    type: 'tiktok.creator.native.history.recover',
    trigger: 'manual_recovery',
    operationId: TIKTOK_DURABLE_RECOVERY_INCIDENT.operationId,
    workKey: TIKTOK_DURABLE_RECOVERY_INCIDENT.workKey,
    generation: TIKTOK_DURABLE_RECOVERY_INCIDENT.generation,
    originalRequestedAt: TIKTOK_DURABLE_RECOVERY_INCIDENT.requestedAt,
    requestedAt: new Date(TIKTOK_DURABLE_RECOVERY_INCIDENT.requestedAt).toISOString(),
    dlqId: TIKTOK_DURABLE_RECOVERY_INCIDENT.dlqId,
    recoveryReference,
    dryRun: false,
  });
}

export function buildTikTokDurableRecoveryEnvelope(input = {}) {
  return Object.freeze({ body: buildTikTokDurableRecoveryJob(input) });
}

export function buildCloudflareQueuePushUrl(input = {}) {
  const accountId = requireSafeIdentifier(input.accountId, 'accountId');
  const queueId = requireSafeIdentifier(input.queueId, 'queueId');
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages`;
}

export function validateTikTokRecoveryPendingMigrations(output, expected = [EXPECTED_PENDING_MIGRATION]) {
  const migrations = [...new Set(String(output ?? '').match(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu) ?? [])].sort();
  const normalizedExpected = [...expected].sort();
  if (JSON.stringify(migrations) !== JSON.stringify(normalizedExpected)) {
    throw operatorError('Pending D1 migrations are not the exact reviewed TikTok recovery set', 'TIKTOK_RECOVERY_PENDING_MIGRATIONS_MISMATCH', {
      expected: normalizedExpected,
      actual: migrations,
    });
  }
  return Object.freeze(migrations);
}

export function validateTikTokRecoveryNoPendingMigrations(output) {
  const migrations = [...new Set(String(output ?? '').match(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu) ?? [])];
  if (migrations.length > 0) {
    throw operatorError('D1 migrations remain pending after Migration 0010 apply', 'TIKTOK_RECOVERY_MIGRATIONS_STILL_PENDING', {
      migrations,
    });
  }
  return true;
}

export function validateTikTokRecoveryWranglerConfig(configText) {
  const text = String(configText ?? '');
  const values = readQuotedAssignments(text);
  assertEqual(values.get('name'), TIKTOK_DURABLE_RECOVERY_INCIDENT.workerName, 'Worker name');
  assertEqual(values.get('MKT_ENV'), 'development', 'MKT_ENV');
  assertEqual(values.get('MKT_CUSTOMER_PROFILE'), 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  assertEqual(values.get('database_name'), TIKTOK_DURABLE_RECOVERY_INCIDENT.databaseName, 'D1 database_name');
  for (const flag of REQUIRED_TRUE_FLAGS) assertEqual(values.get(flag), 'true', flag);
  for (const flag of REQUIRED_FALSE_FLAGS) assertEqual(values.get(flag), 'false', flag);

  const queues = [...text.matchAll(/"queue"\s*:\s*"([^"]+)"/gu)].map((match) => match[1]);
  if (!queues.includes(TIKTOK_DURABLE_RECOVERY_INCIDENT.queueName)) {
    throw operatorError('Wrangler config does not contain the exact Integration Workspace main Queue', 'TIKTOK_RECOVERY_CONFIG_UNSAFE', {
      expectedQueue: TIKTOK_DURABLE_RECOVERY_INCIDENT.queueName,
      queues,
    });
  }
  return Object.freeze({
    workerName: values.get('name'),
    environment: values.get('MKT_ENV'),
    profile: values.get('MKT_CUSTOMER_PROFILE'),
    databaseName: values.get('database_name'),
    queueName: TIKTOK_DURABLE_RECOVERY_INCIDENT.queueName,
    trueFlags: Object.freeze([...REQUIRED_TRUE_FLAGS]),
    falseFlags: Object.freeze([...REQUIRED_FALSE_FLAGS]),
  });
}

export function buildTikTokRecoveryPreflightSql() {
  const incident = TIKTOK_DURABLE_RECOVERY_INCIDENT;
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
      (SELECT status FROM dead_letter_jobs WHERE dlq_id='${incident.dlqId}') AS dlq_status,
      (SELECT message_id FROM dead_letter_jobs WHERE dlq_id='${incident.dlqId}') AS dlq_message_id,
      (SELECT error_code FROM dead_letter_jobs WHERE dlq_id='${incident.dlqId}') AS dlq_error_code,
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

export function buildTikTokRecoveryPostMigrationSql() {
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='queue_operation_attempts') AS queue_operation_attempts_table,
      (SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='dead_letter_operation_metadata') AS dead_letter_operation_metadata_table,
      (SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name='idx_queue_operation_attempts_work_key') AS queue_operation_attempts_index,
      (SELECT COUNT(*) FROM sqlite_schema WHERE type='index' AND name='idx_dead_letter_operation_work') AS dead_letter_operation_work_index,
      (SELECT COUNT(*) FROM organic_content_state) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations) AS organic_content_observations,
      (SELECT COUNT(*) FROM data_coverage_entities) AS data_coverage_entities;
  `);
}

export function buildTikTokRecoveryFinalSql() {
  const incident = TIKTOK_DURABLE_RECOVERY_INCIDENT;
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM organic_content_state) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations) AS organic_content_observations,
      (SELECT COUNT(*) FROM organic_content_observations WHERE observation_kind='initial') AS initial_observations,
      (SELECT COUNT(*) FROM data_coverage_entities) AS data_coverage_entities,
      (SELECT COUNT(*) FROM (SELECT content_key FROM organic_content_state GROUP BY content_key HAVING COUNT(*) > 1)) AS state_duplicate_groups,
      (SELECT COUNT(*) FROM (SELECT observation_key FROM organic_content_observations GROUP BY observation_key HAVING COUNT(*) > 1)) AS observation_duplicate_groups,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_status,
      (SELECT generation FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_generation,
      (SELECT requested_at FROM sync_work_runs WHERE work_key='${incident.workKey}') AS work_requested_at,
      (SELECT json_extract(state_json, '$.nextSequence') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS next_sequence,
      (SELECT json_extract(state_json, '$.rawRecordsCompleted') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS raw_records_completed,
      (SELECT json_extract(state_json, '$.contentRowsDurable') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS content_rows_durable,
      (SELECT json_extract(state_json, '$.observationRowsDurable') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS observation_rows_durable,
      (SELECT json_extract(state_json, '$.coverageEntitiesWritten') FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS coverage_entities_written,
      (SELECT complete FROM sync_work_phases WHERE work_key='${incident.workKey}' AND phase='${incident.phase}') AS phase_complete,
      (SELECT status FROM dead_letter_jobs WHERE dlq_id='${incident.dlqId}') AS dlq_status,
      (SELECT recovery_status FROM dead_letter_operation_metadata WHERE dlq_id='${incident.dlqId}') AS recovery_status,
      (SELECT operation_id FROM dead_letter_operation_metadata WHERE dlq_id='${incident.dlqId}') AS recovery_operation_id,
      (SELECT original_work_key FROM dead_letter_operation_metadata WHERE dlq_id='${incident.dlqId}') AS recovery_work_key,
      (SELECT status FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_status,
      (SELECT expected_entities FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_expected_entities,
      (SELECT observed_entities FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_observed_entities,
      (SELECT expected_rows FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_expected_rows,
      (SELECT observed_rows FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_observed_rows,
      (SELECT failed_rows FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_failed_rows,
      (SELECT completed_at FROM data_coverage_runs WHERE customer_key='chemistry_k' AND platform='tiktok' AND account_key='chemistry_k' AND dataset_key='organic_content_cumulative' ORDER BY created_at DESC LIMIT 1) AS coverage_completed_at;
  `);
}

export function extractWranglerD1Rows(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const rows = [];
  for (const envelope of envelopes) {
    if (envelope?.success === false) {
      throw operatorError('Wrangler D1 response reported failure', 'TIKTOK_RECOVERY_D1_RESPONSE_FAILED', {
        error: envelope?.error ?? null,
      });
    }
    const selected = envelope?.results ?? envelope?.result?.results ?? envelope?.result ?? [];
    if (Array.isArray(selected)) rows.push(...selected);
  }
  if (rows.length === 0) {
    throw operatorError('Wrangler D1 response contains no rows', 'TIKTOK_RECOVERY_D1_RESPONSE_EMPTY');
  }
  return Object.freeze(rows);
}

export function validateTikTokRecoveryPreflightRow(row, now = Date.now()) {
  const incident = TIKTOK_DURABLE_RECOVERY_INCIDENT;
  const exact = {
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
    dlq_status: 'open',
    dlq_message_id: incident.dlqMessageId,
    dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
    coverage_status: 'partial',
    coverage_expected_entities: incident.expectedRows,
    coverage_observed_entities: 1000,
    coverage_expected_rows: incident.expectedRows,
    coverage_observed_rows: 1000,
    coverage_failed_rows: 0,
    coverage_completed_at: null,
  };
  assertRowMatches(row, exact, 'preflight');
  const expiresAt = Number(row?.lock_expires_at);
  if (!Number.isSafeInteger(expiresAt) || expiresAt >= now) {
    throw operatorError('TikTok recovery lock is not proven expired', 'TIKTOK_RECOVERY_LOCK_NOT_EXPIRED', {
      expiresAt: row?.lock_expires_at ?? null,
      now,
    });
  }
  return Object.freeze({ ...row, lockExpired: true });
}

export function validateTikTokRecoveryPostMigrationRow(row) {
  assertRowMatches(row, {
    queue_operation_attempts_table: 1,
    dead_letter_operation_metadata_table: 1,
    queue_operation_attempts_index: 1,
    dead_letter_operation_work_index: 1,
    organic_content_state: 1309,
    organic_content_observations: 1000,
    data_coverage_entities: 1000,
  }, 'post_migration');
  return Object.freeze({ ...row });
}

export function validateTikTokRecoveryFinalRow(row) {
  const incident = TIKTOK_DURABLE_RECOVERY_INCIDENT;
  assertRowMatches(row, {
    organic_content_state: incident.expectedRows,
    organic_content_observations: incident.expectedRows,
    initial_observations: incident.expectedRows,
    data_coverage_entities: incident.expectedRows,
    state_duplicate_groups: 0,
    observation_duplicate_groups: 0,
    work_status: 'completed',
    work_generation: incident.generation,
    work_requested_at: incident.requestedAt,
    next_sequence: 5,
    raw_records_completed: incident.expectedRows,
    content_rows_durable: incident.expectedRows,
    observation_rows_durable: incident.expectedRows,
    coverage_entities_written: incident.expectedRows,
    phase_complete: 1,
    dlq_status: 'redriven',
    recovery_status: 'completed',
    recovery_operation_id: incident.operationId,
    recovery_work_key: incident.workKey,
    coverage_status: 'complete',
    coverage_expected_entities: incident.expectedRows,
    coverage_observed_entities: incident.expectedRows,
    coverage_expected_rows: incident.expectedRows,
    coverage_observed_rows: incident.expectedRows,
    coverage_failed_rows: 0,
  }, 'final');
  const completedAt = Number(row?.coverage_completed_at);
  if (!Number.isSafeInteger(completedAt) || completedAt <= 0) {
    throw operatorError('TikTok recovery Coverage completion timestamp is missing', 'TIKTOK_RECOVERY_FINAL_EVIDENCE_MISMATCH', {
      fieldName: 'coverage_completed_at',
      actual: row?.coverage_completed_at ?? null,
    });
  }
  return Object.freeze({ ...row });
}

export function validateTikTokRecoveryReplayRows(before, after) {
  validateTikTokRecoveryFinalRow(before);
  validateTikTokRecoveryFinalRow(after);
  const stableFields = [
    'organic_content_state',
    'organic_content_observations',
    'initial_observations',
    'data_coverage_entities',
    'state_duplicate_groups',
    'observation_duplicate_groups',
    'work_generation',
    'work_requested_at',
    'next_sequence',
    'raw_records_completed',
    'content_rows_durable',
    'observation_rows_durable',
    'coverage_entities_written',
  ];
  for (const fieldName of stableFields) {
    if (normalizeScalar(before[fieldName]) !== normalizeScalar(after[fieldName])) {
      throw operatorError('Exact TikTok recovery replay changed durable business facts', 'TIKTOK_RECOVERY_REPLAY_DRIFT', {
        fieldName,
        before: before[fieldName] ?? null,
        after: after[fieldName] ?? null,
      });
    }
  }
  return true;
}

function readQuotedAssignments(text) {
  const values = new Map();
  for (const match of text.matchAll(/"([A-Za-z0-9_]+)"\s*:\s*"([^"]*)"/gu)) {
    if (!values.has(match[1])) values.set(match[1], match[2]);
  }
  return values;
}

function assertEqual(actual, expected, fieldName) {
  if (actual !== expected) {
    throw operatorError(`Unsafe TikTok recovery Wrangler config: ${fieldName}`, 'TIKTOK_RECOVERY_CONFIG_UNSAFE', {
      fieldName,
      expected,
      actual: actual ?? null,
    });
  }
}

function assertRowMatches(row, expected, scope) {
  for (const [fieldName, expectedValue] of Object.entries(expected)) {
    if (normalizeScalar(row?.[fieldName]) !== normalizeScalar(expectedValue)) {
      throw operatorError(`TikTok recovery ${scope} evidence mismatch`, `TIKTOK_RECOVERY_${scope.toUpperCase()}_EVIDENCE_MISMATCH`, {
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

function requireSafeIdentifier(value, fieldName) {
  const text = optionalText(value);
  if (!text || !/^[A-Za-z0-9_-]{8,64}$/u.test(text)) {
    throw operatorError(`Invalid Cloudflare ${fieldName}`, 'TIKTOK_RECOVERY_CLOUDFLARE_IDENTIFIER_INVALID', {
      fieldName,
    });
  }
  return text;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokDurableRecoveryOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
