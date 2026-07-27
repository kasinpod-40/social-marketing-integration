import { createHash } from 'node:crypto';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const CHATWOOT_REMOTE_READINESS_CONTRACT_VERSION = 'chatwoot_remote_readiness_v1';
export const CHATWOOT_REMOTE_READINESS_PHASES = Object.freeze([
  'plan',
  'preflight',
  'backup',
  'migrate',
  'schema-readback',
]);

export const CHATWOOT_REMOTE_READINESS_CONFIRMATIONS = Object.freeze({
  preflight: Object.freeze({
    envName: 'CONFIRM_CHATWOOT_REMOTE_PREFLIGHT',
    value: 'READ_ONLY_CHATWOOT_REMOTE_PREFLIGHT',
  }),
  backup: Object.freeze({
    envName: 'CONFIRM_CHATWOOT_REMOTE_BACKUP',
    value: 'BACKUP_BEFORE_0018_CHATWOOT',
  }),
  migrate: Object.freeze({
    envName: 'CONFIRM_CHATWOOT_REMOTE_MIGRATION',
    value: 'APPLY_0018_CHATWOOT_ANALYTICS',
  }),
  'schema-readback': Object.freeze({
    envName: 'CONFIRM_CHATWOOT_SCHEMA_READBACK',
    value: 'READ_BACK_0018_CHATWOOT_SCHEMA',
  }),
});

export const CHATWOOT_REMOTE_EXPECTED_MIGRATION = '0018_chatwoot_analytics.sql';
export const CHATWOOT_REMOTE_PREVIOUS_MIGRATION = '0017_woocommerce_commerce.sql';

export const CHATWOOT_REMOTE_TABLES = Object.freeze([
  'chatwoot_account_state',
  'chatwoot_inbox_state',
  'chatwoot_contact_state',
  'chatwoot_agent_state',
  'chatwoot_team_state',
  'chatwoot_label_state',
  'chatwoot_conversation_state',
  'chatwoot_conversation_label_state',
  'chatwoot_message_analytics_state',
  'chatwoot_reporting_event_facts',
  'chatwoot_conversation_daily_facts',
  'chatwoot_agent_daily_facts',
  'chatwoot_inbox_daily_facts',
  'chatwoot_account_daily_facts',
]);

export const CHATWOOT_REMOTE_INDEXES = Object.freeze([
  'idx_chatwoot_account_state_customer',
  'idx_chatwoot_inbox_state_account',
  'idx_chatwoot_contact_state_account_activity',
  'idx_chatwoot_agent_state_account',
  'idx_chatwoot_team_state_account',
  'idx_chatwoot_label_state_account_hash',
  'idx_chatwoot_conversation_state_account_updated',
  'idx_chatwoot_conversation_state_inbox_status',
  'idx_chatwoot_conversation_label_active',
  'idx_chatwoot_message_conversation_created',
  'idx_chatwoot_reporting_event_date',
  'idx_chatwoot_conversation_daily_date',
  'idx_chatwoot_agent_daily_date',
  'idx_chatwoot_inbox_daily_date',
  'idx_chatwoot_account_daily_date',
]);

export const CHATWOOT_REMOTE_REQUIRED_FALSE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_TIKTOK_ENABLED',
  'MKT_CONNECTOR_FACEBOOK_ENABLED',
  'MKT_CONNECTOR_INSTAGRAM_ENABLED',
  'MKT_CONNECTOR_META_ADS_ENABLED',
  'MKT_META_SOURCE_READ_ENABLED',
  'MKT_META_D1_WRITE_ENABLED',
  'MKT_META_LARK_WRITE_ENABLED',
  'MKT_META_REPORT_READ_ENABLED',
  'MKT_CONNECTOR_GOOGLE_ADS_ENABLED',
  'MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED',
  'MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED',
  'MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED',
  'MKT_GOOGLE_ADS_LARK_WRITE_ENABLED',
  'MKT_CONNECTOR_YOUTUBE_ENABLED',
  'MKT_YOUTUBE_END_TO_END_ENABLED',
  'MKT_YOUTUBE_LARK_WRITE_ENABLED',
  'MKT_YOUTUBE_ANALYTICS_ENABLED',
  'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
  'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
  'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
  'MKT_WOOCOMMERCE_REPORT_READ_ENABLED',
  'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED',
  'MKT_CONNECTOR_CHATWOOT_ENABLED',
  'MKT_CHATWOOT_D1_WRITE_ENABLED',
  'MKT_CHATWOOT_LARK_WRITE_ENABLED',
  'MKT_CHATWOOT_REPORT_WRITE_ENABLED',
  'MKT_CHATWOOT_WEBHOOK_ENABLED',
  'MKT_SCHEDULE_TIKTOK_ENABLED',
  'MKT_SCHEDULE_YOUTUBE_ENABLED',
  'MKT_SCHEDULE_GOOGLE_ADS_ENABLED',
  'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
  'MKT_SCHEDULE_CHATWOOT_ENABLED',
  'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
  'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
  'MKT_DLQ_REDRIVE_ENABLED',
  'MKT_TIME_SERIES_D1_WRITE_ENABLED',
  'MKT_TIME_SERIES_D1_BACKFILL_ENABLED',
  'MKT_REPORT_D1_SHADOW_READ_ENABLED',
  'MKT_REPORT_D1_READ_ENABLED',
  'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
  'MKT_LARK_DAILY_RETENTION_ENABLED',
  'MKT_NOTIFICATION_RUNTIME_ENABLED',
  'MKT_TIKTOK_AUDIT_HTTP_ENABLED',
  'MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED',
  'MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED',
]);

const EXECUTABLE_PHASES = new Set(
  CHATWOOT_REMOTE_READINESS_PHASES.filter((phase) => phase !== 'plan'),
);

const SHARED_COUNT_FIELDS = Object.freeze([
  'sync_runs',
  'sync_jobs',
  'coverage_runs',
  'coverage_entities',
  'organic_content_state',
  'organic_content_observations',
  'open_dlq',
  'open_alerts',
]);

export function parseChatwootRemoteReadinessArgs(args = []) {
  let phase = 'plan';
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg.startsWith('--phase=')) {
      phase = arg.slice('--phase='.length);
      continue;
    }
    throw operatorError(
      `Unknown Chatwoot readiness argument: ${arg}`,
      'CHATWOOT_REMOTE_READINESS_ARGUMENT_INVALID',
    );
  }
  if (!CHATWOOT_REMOTE_READINESS_PHASES.includes(phase)) {
    throw operatorError(
      `Unsupported Chatwoot readiness phase: ${phase}`,
      'CHATWOOT_REMOTE_READINESS_PHASE_INVALID',
    );
  }
  return Object.freeze({ phase, execute });
}

export function assertChatwootRemoteReadinessConfirmation(phase, env = {}) {
  if (!EXECUTABLE_PHASES.has(phase)) return true;
  const contract = CHATWOOT_REMOTE_READINESS_CONFIRMATIONS[phase];
  if (env?.[contract.envName] !== contract.value) {
    throw operatorError(
      `Chatwoot readiness requires ${contract.envName}=${contract.value}`,
      'CHATWOOT_REMOTE_READINESS_CONFIRMATION_REQUIRED',
      { phase, envName: contract.envName },
    );
  }
  return true;
}

export function loadChatwootRemoteReadinessTarget(env = {}) {
  return Object.freeze({
    environment: requireExact(env.MKT_ENV, 'development', 'MKT_ENV'),
    customerProfile: requireExact(
      env.MKT_CUSTOMER_PROFILE,
      'integration_workspace',
      'MKT_CUSTOMER_PROFILE',
    ),
    customerKey: requireExact(
      env.MKT_CONNECTION_CUSTOMER_KEY,
      'chemistry_k',
      'MKT_CONNECTION_CUSTOMER_KEY',
    ),
    databaseName: requireExact(
      env.MKT_CHATWOOT_ROLLOUT_DATABASE_NAME,
      'social-mkt-state-dev',
      'MKT_CHATWOOT_ROLLOUT_DATABASE_NAME',
    ),
    wranglerConfig: requireText(
      env.MKT_CHATWOOT_ROLLOUT_WRANGLER_CONFIG,
      'MKT_CHATWOOT_ROLLOUT_WRANGLER_CONFIG',
    ),
  });
}

export function createChatwootRemoteTargetFingerprint(target = {}, config = {}) {
  const payload = {
    contractVersion: CHATWOOT_REMOTE_READINESS_CONTRACT_VERSION,
    environment: requireExact(target.environment, 'development', 'environment'),
    customerProfile: requireExact(
      target.customerProfile,
      'integration_workspace',
      'customerProfile',
    ),
    customerKey: requireExact(target.customerKey, 'chemistry_k', 'customerKey'),
    databaseName: requireExact(
      target.databaseName,
      'social-mkt-state-dev',
      'databaseName',
    ),
    workerName: requireExact(config.workerName, 'social-mkt-sync-worker', 'workerName'),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function validateChatwootRemoteWranglerConfig(configText) {
  const text = requireText(configText, 'configText');
  requireConfigValue(text, 'name', 'social-mkt-sync-worker');
  requireConfigValue(text, 'MKT_ENV', 'development');
  requireConfigValue(text, 'MKT_CUSTOMER_PROFILE', 'integration_workspace');
  requireConfigValue(text, 'MKT_CONNECTION_CUSTOMER_KEY', 'chemistry_k');
  requireConfigValue(text, 'database_name', 'social-mkt-state-dev');

  for (const flag of CHATWOOT_REMOTE_REQUIRED_FALSE_FLAGS) {
    requireConfigValue(text, flag, 'false');
  }
  for (const required of [
    /"binding"\s*:\s*"MKT_STATE_DB"/u,
    /"binding"\s*:\s*"MKT_SYNC_QUEUE"/u,
    /"queue"\s*:\s*"social-mkt-sync-jobs"/u,
    /"dead_letter_queue"\s*:\s*"social-mkt-sync-dlq"/u,
  ]) {
    if (!required.test(text)) {
      throw operatorError(
        'Chatwoot readiness Wrangler config is missing required Integration topology',
        'CHATWOOT_REMOTE_READINESS_CONFIG_UNSAFE',
      );
    }
  }
  if (/"CHATWOOT_API_ACCESS_TOKEN"\s*:/u.test(text)) {
    throw operatorError(
      'Chatwoot API token must not be stored in Wrangler vars',
      'CHATWOOT_REMOTE_READINESS_CONFIG_UNSAFE',
      { fieldName: 'CHATWOOT_API_ACCESS_TOKEN' },
    );
  }
  return Object.freeze({
    workerName: 'social-mkt-sync-worker',
    environment: 'development',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    databaseName: 'social-mkt-state-dev',
    allExecutionFlagsFalse: true,
    d1BindingPresent: true,
    mainQueueBindingPresent: true,
    dlqPresent: true,
  });
}

export function auditChatwootMigrationSource(sqlText) {
  const sql = requireText(sqlText, 'migrationSql');
  const executable = sql.replace(/--[^\n]*/gu, ' ');
  const tableNames = uniqueMatches(
    executable,
    /\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)\b/giu,
  );
  const indexNames = uniqueMatches(
    executable,
    /\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)\b/giu,
  );
  const destructive = executable.match(/\b(?:DROP|DELETE|ALTER|UPDATE|INSERT|REPLACE)\b/giu) ?? [];
  const invalid = [];
  if (!sameSet(tableNames, CHATWOOT_REMOTE_TABLES)) invalid.push('table_names');
  if (!sameSet(indexNames, CHATWOOT_REMOTE_INDEXES)) invalid.push('index_names');
  if (destructive.length > 0) invalid.push('destructive_statements');
  if (invalid.length > 0) {
    throw operatorError(
      'Chatwoot Migration 0018 source audit failed',
      'CHATWOOT_REMOTE_READINESS_MIGRATION_SOURCE_INVALID',
      {
        invalid,
        tableCount: tableNames.length,
        indexCount: indexNames.length,
        destructiveCount: destructive.length,
      },
    );
  }
  return Object.freeze({
    migration: CHATWOOT_REMOTE_EXPECTED_MIGRATION,
    tableCount: tableNames.length,
    indexCount: indexNames.length,
    destructiveCount: 0,
    sha256: sha256Hex(sql),
  });
}

export function validateChatwootPendingMigrations(output) {
  const pending = pendingMigrationNames(output);
  if (pending.length !== 1 || pending[0] !== CHATWOOT_REMOTE_EXPECTED_MIGRATION) {
    throw operatorError(
      `Expected only pending Migration ${CHATWOOT_REMOTE_EXPECTED_MIGRATION}`,
      'CHATWOOT_REMOTE_READINESS_PENDING_MIGRATIONS_MISMATCH',
      { pending },
    );
  }
  return Object.freeze(pending);
}

export function validateChatwootNoPendingMigrations(output) {
  const pending = pendingMigrationNames(output);
  if (pending.length !== 0) {
    throw operatorError(
      'Chatwoot readiness still has pending migrations',
      'CHATWOOT_REMOTE_READINESS_PENDING_MIGRATIONS_REMAIN',
      { pending },
    );
  }
  return true;
}

export function buildChatwootRemotePreflightSql() {
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'chatwoot_%') AS chatwoot_table_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_chatwoot_%') AS chatwoot_index_count,
      (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') AS active_work,
      (SELECT COUNT(*) FROM sync_locks
        WHERE expires_at > unixepoch('now') * 1000) AS active_locks,
      (SELECT COUNT(*) FROM dead_letter_jobs WHERE status = 'open') AS open_dlq,
      (SELECT COUNT(*) FROM system_alerts WHERE status = 'open') AS open_alerts,
      (SELECT COUNT(*) FROM sync_runs) AS sync_runs,
      (SELECT COUNT(*) FROM sync_jobs) AS sync_jobs,
      (SELECT COUNT(*) FROM data_coverage_runs) AS coverage_runs,
      (SELECT COUNT(*) FROM data_coverage_entities) AS coverage_entities,
      (SELECT COUNT(*) FROM organic_content_state) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations) AS organic_content_observations;
  `);
}

export function buildChatwootRemoteSchemaReadbackSql() {
  const rowCounts = CHATWOOT_REMOTE_TABLES
    .map((name) => `(SELECT COUNT(*) FROM ${name}) AS ${name}_rows`)
    .join(', ');
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'chatwoot_%') AS chatwoot_table_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_chatwoot_%') AS chatwoot_index_count,
      ${rowCounts},
      (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') AS active_work,
      (SELECT COUNT(*) FROM sync_locks
        WHERE expires_at > unixepoch('now') * 1000) AS active_locks,
      (SELECT COUNT(*) FROM dead_letter_jobs WHERE status = 'open') AS open_dlq,
      (SELECT COUNT(*) FROM system_alerts WHERE status = 'open') AS open_alerts,
      (SELECT COUNT(*) FROM sync_runs) AS sync_runs,
      (SELECT COUNT(*) FROM sync_jobs) AS sync_jobs,
      (SELECT COUNT(*) FROM data_coverage_runs) AS coverage_runs,
      (SELECT COUNT(*) FROM data_coverage_entities) AS coverage_entities,
      (SELECT COUNT(*) FROM organic_content_state) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations) AS organic_content_observations;
  `);
}

export function validateChatwootRemotePreflightRow(row = {}) {
  const result = normalizeCountRow(row, [
    'chatwoot_table_count',
    'chatwoot_index_count',
    'active_work',
    'active_locks',
    ...SHARED_COUNT_FIELDS,
  ]);
  const invalid = [];
  for (const field of [
    'chatwoot_table_count',
    'chatwoot_index_count',
    'active_work',
    'active_locks',
  ]) {
    if (result[field] !== 0) invalid.push(field);
  }
  if (invalid.length > 0) {
    throw operatorError(
      'Chatwoot Remote preflight is not safe to continue',
      'CHATWOOT_REMOTE_READINESS_PREFLIGHT_FAILED',
      { invalid, result },
    );
  }
  return result;
}

export function validateChatwootRemoteSchemaReadbackRow(row = {}, preflight = {}) {
  const fields = [
    'chatwoot_table_count',
    'chatwoot_index_count',
    ...CHATWOOT_REMOTE_TABLES.map((name) => `${name}_rows`),
    'active_work',
    'active_locks',
    ...SHARED_COUNT_FIELDS,
  ];
  const result = normalizeCountRow(row, fields);
  const before = normalizeCountRow(preflight, [
    'chatwoot_table_count',
    'chatwoot_index_count',
    'active_work',
    'active_locks',
    ...SHARED_COUNT_FIELDS,
  ]);
  const invalid = [];
  if (result.chatwoot_table_count !== CHATWOOT_REMOTE_TABLES.length) {
    invalid.push('chatwoot_table_count');
  }
  if (result.chatwoot_index_count !== CHATWOOT_REMOTE_INDEXES.length) {
    invalid.push('chatwoot_index_count');
  }
  for (const table of CHATWOOT_REMOTE_TABLES) {
    if (result[`${table}_rows`] !== 0) invalid.push(`${table}_rows`);
  }
  for (const field of ['active_work', 'active_locks']) {
    if (result[field] !== 0) invalid.push(field);
  }
  for (const field of SHARED_COUNT_FIELDS) {
    if (result[field] !== before[field]) invalid.push(`${field}_drift`);
  }
  if (invalid.length > 0) {
    throw operatorError(
      'Chatwoot Migration 0018 schema read-back failed',
      'CHATWOOT_REMOTE_READINESS_SCHEMA_READBACK_FAILED',
      { invalid, before, result },
    );
  }
  return result;
}

export function extractChatwootWranglerD1Rows(output) {
  let parsed;
  try {
    parsed = JSON.parse(requireText(output, 'output'));
  } catch {
    throw operatorError(
      'Wrangler D1 output is not valid JSON',
      'CHATWOOT_REMOTE_READINESS_D1_RESPONSE_INVALID',
    );
  }
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const rows = envelopes.flatMap((item) => item?.results ?? item?.result?.results ?? []);
  if (rows.length === 0) {
    throw operatorError(
      'Wrangler D1 response returned no rows',
      'CHATWOOT_REMOTE_READINESS_D1_RESPONSE_EMPTY',
    );
  }
  return rows;
}

export function validateChatwootBackupEvidence(evidence = {}, contents) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents ?? '');
  const expectedSha256 = sha256Hex(bytes);
  const valid = evidence.phase === 'backup'
    && evidence.status === 'passed'
    && Number.isSafeInteger(evidence.sizeBytes)
    && evidence.sizeBytes > 0
    && evidence.sizeBytes === bytes.byteLength
    && evidence.sha256 === expectedSha256
    && evidence.migration === CHATWOOT_REMOTE_EXPECTED_MIGRATION
    && typeof evidence.targetFingerprint === 'string'
    && /^[0-9a-f]{64}$/u.test(evidence.targetFingerprint);
  if (!valid) {
    throw operatorError(
      'Chatwoot backup evidence is missing or checksum-invalid',
      'CHATWOOT_REMOTE_READINESS_BACKUP_INVALID',
    );
  }
  return evidence;
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pendingMigrationNames(output) {
  const text = requireText(output, 'migrationOutput');
  return [...new Set(text.match(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu) ?? [])].sort();
}

function normalizeCountRow(row, fields) {
  const result = {};
  for (const field of fields) result[field] = nonNegativeInteger(row?.[field], field);
  return Object.freeze(result);
}

function uniqueMatches(text, pattern) {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1]))].sort();
}

function sameSet(left, right) {
  return left.length === right.length
    && left.every((value) => right.includes(value));
}

function requireConfigValue(text, name, expected) {
  const escapedName = escapeRegExp(name);
  const escapedValue = escapeRegExp(expected);
  const patterns = name === 'name' || name === 'database_name'
    ? [new RegExp(`"${escapedName}"\\s*:\\s*"${escapedValue}"`, 'u')]
    : [
      new RegExp(`"${escapedName}"\\s*:\\s*"${escapedValue}"`, 'u'),
      new RegExp(`'${escapedName}'\\s*:\\s*'${escapedValue}'`, 'u'),
    ];
  if (!patterns.some((pattern) => pattern.test(text))) {
    throw operatorError(
      `Chatwoot readiness config must set ${name}=${expected}`,
      'CHATWOOT_REMOTE_READINESS_CONFIG_UNSAFE',
      { name, expected },
    );
  }
}

function compactSql(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function requireExact(value, expected, fieldName) {
  const text = requireText(value, fieldName);
  if (text !== expected) {
    throw operatorError(
      `${fieldName} must be ${expected}`,
      'CHATWOOT_REMOTE_READINESS_TARGET_INVALID',
      { fieldName, expected },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(
      `${fieldName} is required`,
      'CHATWOOT_REMOTE_READINESS_VALUE_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw operatorError(
      `${fieldName} must be a non-negative integer`,
      'CHATWOOT_REMOTE_READINESS_VALUE_INVALID',
      { fieldName },
    );
  }
  return number;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function operatorError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
