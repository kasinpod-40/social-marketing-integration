import { createHash } from 'node:crypto';

import {
  JOB_SCHEMA_VERSIONS,
  JOB_TRIGGERS,
  JOB_TYPES,
} from '../../packages/application/src/jobs/job-catalog.js';
import {
  createStableQueueOperationBody,
} from '../../packages/application/src/jobs/queue-operation.js';
import {
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../../packages/config/src/lark-notification-runtime-config.js';

export const LARK_NOTIFICATION_REMOTE_ROLLOUT_CONTRACT_VERSION =
  'lark_notification_remote_rollout_v1';

export const LARK_NOTIFICATION_REMOTE_ROLLOUT_PHASES = Object.freeze([
  'plan',
  'preflight',
  'backup',
  'migrate',
  'schema-readback',
]);

export const LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIRMATIONS = Object.freeze({
  preflight: Object.freeze({
    envName: 'CONFIRM_LARK_NOTIFICATION_REMOTE_PREFLIGHT',
    value: 'READ_ONLY_LARK_NOTIFICATION_REMOTE_PREFLIGHT',
  }),
  backup: Object.freeze({
    envName: 'CONFIRM_LARK_NOTIFICATION_REMOTE_BACKUP',
    value: 'BACKUP_BEFORE_0019_LARK_NOTIFICATION',
  }),
  migrate: Object.freeze({
    envName: 'CONFIRM_LARK_NOTIFICATION_REMOTE_MIGRATION',
    value: 'APPLY_0019_LARK_NOTIFICATION_DELIVERY',
  }),
  'schema-readback': Object.freeze({
    envName: 'CONFIRM_LARK_NOTIFICATION_SCHEMA_READBACK',
    value: 'READ_BACK_0019_LARK_NOTIFICATION_SCHEMA',
  }),
});

export const LARK_NOTIFICATION_REMOTE_EXPECTED_MIGRATION =
  '0019_lark_notification_delivery.sql';

export const LARK_NOTIFICATION_REMOTE_TABLE = 'lark_notification_deliveries';

export const LARK_NOTIFICATION_REMOTE_INDEXES = Object.freeze([
  'idx_lark_notification_delivery_status_lease',
  'idx_lark_notification_delivery_ai_run',
  'idx_lark_notification_delivery_mirror',
]);

export const LARK_NOTIFICATION_REMOTE_REQUIRED_FALSE_FLAGS = Object.freeze([
  'MKT_NOTIFICATION_RUNTIME_ENABLED',
  'MKT_NOTIFICATION_LARK_SEND_ENABLED',
  'MKT_NOTIFICATION_LARK_MIRROR_ENABLED',
]);

export const LARK_NOTIFICATION_REMOTE_REQUIRED_TABLE_MAPPINGS = Object.freeze([
  'LARK_TABLE_MKT_AI_REPORT_RUNS',
  'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  'LARK_TABLE_MKT_REPORT_SETTINGS',
  'LARK_TABLE_MKT_NOTIFICATION_LOG',
]);

const EXECUTABLE_PHASES = new Set(
  LARK_NOTIFICATION_REMOTE_ROLLOUT_PHASES.filter((phase) => phase !== 'plan'),
);

const SHARED_COUNT_FIELDS = Object.freeze([
  'sync_runs',
  'sync_jobs',
  'coverage_runs',
  'coverage_entities',
  'organic_content_state',
  'organic_content_observations',
]);

export function parseLarkNotificationRemoteRolloutArgs(args = []) {
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
      `Unknown Lark notification rollout argument: ${arg}`,
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_ARGUMENT_INVALID',
    );
  }
  if (!LARK_NOTIFICATION_REMOTE_ROLLOUT_PHASES.includes(phase)) {
    throw operatorError(
      `Unsupported Lark notification rollout phase: ${phase}`,
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_PHASE_INVALID',
    );
  }
  return Object.freeze({ phase, execute });
}

export function assertLarkNotificationRemoteRolloutConfirmation(phase, env = {}) {
  if (!EXECUTABLE_PHASES.has(phase)) return true;
  const contract = LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIRMATIONS[phase];
  if (env?.[contract.envName] !== contract.value) {
    throw operatorError(
      `Lark notification rollout requires ${contract.envName}=${contract.value}`,
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIRMATION_REQUIRED',
      { phase, envName: contract.envName },
    );
  }
  return true;
}

export function loadLarkNotificationRemoteRolloutTarget(env = {}) {
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
      env.MKT_NOTIFICATION_ROLLOUT_DATABASE_NAME,
      'social-mkt-state-dev',
      'MKT_NOTIFICATION_ROLLOUT_DATABASE_NAME',
    ),
    wranglerConfig: requireText(
      env.MKT_NOTIFICATION_ROLLOUT_WRANGLER_CONFIG,
      'MKT_NOTIFICATION_ROLLOUT_WRANGLER_CONFIG',
    ),
  });
}

export function createLarkNotificationRemoteTargetFingerprint(target = {}, config = {}) {
  const payload = {
    contractVersion: LARK_NOTIFICATION_REMOTE_ROLLOUT_CONTRACT_VERSION,
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
    destinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  };
  return sha256Hex(JSON.stringify(payload));
}

export function validateLarkNotificationRemoteWranglerConfig(configText) {
  const text = requireText(configText, 'configText');
  requireConfigValue(text, 'name', 'social-mkt-sync-worker');
  requireConfigValue(text, 'MKT_ENV', 'development');
  requireConfigValue(text, 'MKT_CUSTOMER_PROFILE', 'integration_workspace');
  requireConfigValue(text, 'MKT_CONNECTION_CUSTOMER_KEY', 'chemistry_k');
  requireConfigValue(text, 'database_name', 'social-mkt-state-dev');

  for (const flag of LARK_NOTIFICATION_REMOTE_REQUIRED_FALSE_FLAGS) {
    requireConfigValue(text, flag, 'false');
  }
  for (const mapping of LARK_NOTIFICATION_REMOTE_REQUIRED_TABLE_MAPPINGS) {
    requireNonEmptyConfigValue(text, mapping);
  }
  for (const required of [
    /"binding"\s*:\s*"MKT_STATE_DB"/u,
    /"binding"\s*:\s*"MKT_SYNC_QUEUE"/u,
    /"queue"\s*:\s*"social-mkt-sync-jobs"/u,
    /"dead_letter_queue"\s*:\s*"social-mkt-sync-dlq"/u,
  ]) {
    if (!required.test(text)) {
      throw operatorError(
        'Lark notification rollout config is missing required Integration topology',
        'LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIG_UNSAFE',
      );
    }
  }

  return Object.freeze({
    workerName: 'social-mkt-sync-worker',
    environment: 'development',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    databaseName: 'social-mkt-state-dev',
    notificationFlagsAllFalse: true,
    requiredTableMappingsPresent: true,
    d1BindingPresent: true,
    mainQueueBindingPresent: true,
    dlqPresent: true,
  });
}

export function auditLarkNotificationMigrationSource(sqlText) {
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
  if (tableNames.length !== 1 || tableNames[0] !== LARK_NOTIFICATION_REMOTE_TABLE) {
    invalid.push('table_names');
  }
  if (!sameSet(indexNames, LARK_NOTIFICATION_REMOTE_INDEXES)) invalid.push('index_names');
  if (destructive.length > 0) invalid.push('destructive_statements');
  if (!/notification_attempt_key\s+TEXT\s+PRIMARY\s+KEY/iu.test(executable)) {
    invalid.push('atomic_primary_key');
  }
  if (!/blocked_unknown/iu.test(executable)) invalid.push('unknown_outcome_status');
  if (invalid.length > 0) {
    throw operatorError(
      'Lark notification Migration 0019 source audit failed',
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_MIGRATION_SOURCE_INVALID',
      {
        invalid,
        tableCount: tableNames.length,
        indexCount: indexNames.length,
        destructiveCount: destructive.length,
      },
    );
  }
  return Object.freeze({
    migration: LARK_NOTIFICATION_REMOTE_EXPECTED_MIGRATION,
    tableCount: 1,
    indexCount: LARK_NOTIFICATION_REMOTE_INDEXES.length,
    destructiveCount: 0,
    sha256: sha256Hex(sql),
  });
}

export function validateLarkNotificationPendingMigrations(output) {
  const pending = pendingMigrationNames(output);
  if (pending.length !== 1
    || pending[0] !== LARK_NOTIFICATION_REMOTE_EXPECTED_MIGRATION) {
    throw operatorError(
      `Expected only pending Migration ${LARK_NOTIFICATION_REMOTE_EXPECTED_MIGRATION}`,
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_PENDING_MIGRATIONS_MISMATCH',
      { pending },
    );
  }
  return Object.freeze(pending);
}

export function validateLarkNotificationNoPendingMigrations(output) {
  const pending = pendingMigrationNames(output);
  if (pending.length !== 0) {
    throw operatorError(
      'Lark notification rollout still has pending migrations',
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_PENDING_MIGRATIONS_REMAIN',
      { pending },
    );
  }
  return true;
}

export function buildLarkNotificationRemotePreflightSql() {
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'table' AND name = '${LARK_NOTIFICATION_REMOTE_TABLE}')
        AS notification_table_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_lark_notification_delivery_%')
        AS notification_index_count,
      (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') AS active_work,
      (SELECT COUNT(*) FROM sync_locks
        WHERE expires_at > unixepoch('now') * 1000) AS active_locks,
      (SELECT COUNT(*) FROM sync_runs) AS sync_runs,
      (SELECT COUNT(*) FROM sync_jobs) AS sync_jobs,
      (SELECT COUNT(*) FROM data_coverage_runs) AS coverage_runs,
      (SELECT COUNT(*) FROM data_coverage_entities) AS coverage_entities,
      (SELECT COUNT(*) FROM organic_content_state) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations) AS organic_content_observations;
  `);
}

export function buildLarkNotificationRemoteSchemaReadbackSql() {
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'table' AND name = '${LARK_NOTIFICATION_REMOTE_TABLE}')
        AS notification_table_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_lark_notification_delivery_%')
        AS notification_index_count,
      (SELECT COUNT(*) FROM ${LARK_NOTIFICATION_REMOTE_TABLE}) AS notification_delivery_rows,
      (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') AS active_work,
      (SELECT COUNT(*) FROM sync_locks
        WHERE expires_at > unixepoch('now') * 1000) AS active_locks,
      (SELECT COUNT(*) FROM sync_runs) AS sync_runs,
      (SELECT COUNT(*) FROM sync_jobs) AS sync_jobs,
      (SELECT COUNT(*) FROM data_coverage_runs) AS coverage_runs,
      (SELECT COUNT(*) FROM data_coverage_entities) AS coverage_entities,
      (SELECT COUNT(*) FROM organic_content_state) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations) AS organic_content_observations;
  `);
}

export function validateLarkNotificationRemotePreflightRow(row = {}) {
  const normalized = normalizeCountRow(row, [
    'notification_table_count',
    'notification_index_count',
    'active_work',
    'active_locks',
    ...SHARED_COUNT_FIELDS,
  ]);
  const invalid = [];
  for (const field of [
    'notification_table_count',
    'notification_index_count',
    'active_work',
    'active_locks',
  ]) {
    if (normalized[field] !== 0) invalid.push(field);
  }
  if (invalid.length > 0) {
    throw operatorError(
      'Lark notification Remote preflight requires no existing schema, active work or active lock',
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_PREFLIGHT_FAILED',
      { invalid },
    );
  }
  return normalized;
}

export function validateLarkNotificationRemoteSchemaReadbackRow(row = {}, before = {}) {
  const normalized = normalizeCountRow(row, [
    'notification_table_count',
    'notification_index_count',
    'notification_delivery_rows',
    'active_work',
    'active_locks',
    ...SHARED_COUNT_FIELDS,
  ]);
  const baseline = normalizeCountRow(before, [
    'notification_table_count',
    'notification_index_count',
    'active_work',
    'active_locks',
    ...SHARED_COUNT_FIELDS,
  ]);
  const invalid = [];
  if (normalized.notification_table_count !== 1) invalid.push('notification_table_count');
  if (normalized.notification_index_count !== LARK_NOTIFICATION_REMOTE_INDEXES.length) {
    invalid.push('notification_index_count');
  }
  if (normalized.notification_delivery_rows !== 0) invalid.push('notification_delivery_rows');
  if (normalized.active_work !== 0) invalid.push('active_work');
  if (normalized.active_locks !== 0) invalid.push('active_locks');
  for (const field of SHARED_COUNT_FIELDS) {
    if (normalized[field] !== baseline[field]) invalid.push(field);
  }
  if (invalid.length > 0) {
    throw operatorError(
      'Lark notification schema read-back failed or changed existing Business facts',
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_SCHEMA_READBACK_FAILED',
      { invalid },
    );
  }
  return normalized;
}

export function extractLarkNotificationWranglerD1Rows(output) {
  let parsed;
  try {
    parsed = JSON.parse(requireText(output, 'wranglerD1Output'));
  } catch {
    throw operatorError(
      'Wrangler D1 output is not valid JSON',
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_D1_RESPONSE_INVALID',
    );
  }
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const rows = envelopes.flatMap((entry) => {
    if (entry?.success === false) {
      throw operatorError(
        'Wrangler D1 response reported failure',
        'LARK_NOTIFICATION_REMOTE_ROLLOUT_D1_RESPONSE_INVALID',
      );
    }
    if (Array.isArray(entry?.results)) return entry.results;
    if (Array.isArray(entry?.result?.results)) return entry.result.results;
    return [];
  });
  if (rows.length === 0) {
    throw operatorError(
      'Wrangler D1 response has no rows',
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_D1_RESPONSE_EMPTY',
    );
  }
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

export function validateLarkNotificationBackupEvidence(evidence = {}, contents) {
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents ?? '');
  const invalid = [];
  if (evidence?.phase !== 'backup' || evidence?.status !== 'passed') invalid.push('status');
  if (evidence?.migration !== LARK_NOTIFICATION_REMOTE_EXPECTED_MIGRATION) {
    invalid.push('migration');
  }
  if (!/^[0-9a-f]{64}$/u.test(evidence?.targetFingerprint ?? '')) {
    invalid.push('targetFingerprint');
  }
  if (buffer.byteLength <= 0 || evidence?.sizeBytes !== buffer.byteLength) invalid.push('sizeBytes');
  if (evidence?.sha256 !== sha256Hex(buffer)) invalid.push('sha256');
  if (invalid.length > 0) {
    throw operatorError(
      'Lark notification backup evidence is invalid',
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_BACKUP_INVALID',
      { invalid },
    );
  }
  return evidence;
}

export function buildLarkNotificationControlledUatJob(input = {}) {
  const aiRunKey = requireText(input.aiRunKey, 'aiRunKey');
  const operationId = requireText(input.operationId, 'operationId');
  const requestedAt = normalizeTimestamp(input.requestedAt, 'requestedAt');
  return createStableQueueOperationBody({
    type: JOB_TYPES.LARK_NOTIFICATION_SEND,
    schemaVersion: JOB_SCHEMA_VERSIONS.LARK_NOTIFICATION_RUNTIME,
    trigger: JOB_TRIGGERS.LARK_NOTIFICATION_CONTROLLED_UAT,
    aiRunKey,
  }, {
    operationId,
    originalRequestedAt: requestedAt,
  });
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pendingMigrationNames(output) {
  const text = String(output ?? '');
  if (/No migrations to apply/iu.test(text)) return [];
  return [...new Set(text.match(/\b\d{4}_[A-Za-z0-9_-]+\.sql\b/gu) ?? [])];
}

function requireConfigValue(text, key, expected) {
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"${escapeRegExp(expected)}"`, 'u');
  if (!pattern.test(text)) {
    throw operatorError(
      `Lark notification rollout requires ${key}=${expected}`,
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIG_UNSAFE',
      { fieldName: key },
    );
  }
}

function requireNonEmptyConfigValue(text, key) {
  const pattern = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"([^"\\s]+)"`, 'u');
  const match = pattern.exec(text);
  if (!match || /^replace-|^<|^todo$/iu.test(match[1])) {
    throw operatorError(
      `Lark notification rollout requires configured ${key}`,
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_CONFIG_UNSAFE',
      { fieldName: key },
    );
  }
}

function normalizeCountRow(row, fields) {
  const normalized = {};
  for (const field of fields) {
    const value = Number(row?.[field]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw operatorError(
        `Lark notification Remote row requires non-negative integer ${field}`,
        'LARK_NOTIFICATION_REMOTE_ROLLOUT_D1_RESPONSE_INVALID',
        { fieldName: field },
      );
    }
    normalized[field] = value;
  }
  return Object.freeze(normalized);
}

function compactSql(sql) {
  return sql.replace(/\s+/gu, ' ').trim();
}

function uniqueMatches(text, pattern) {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1]))].sort();
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function requireExact(value, expected, fieldName) {
  const text = requireText(value, fieldName);
  if (text !== expected) {
    throw operatorError(
      `${fieldName} must equal ${expected}`,
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_TARGET_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_TARGET_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function normalizeTimestamp(value, fieldName) {
  const number = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw operatorError(
      `${fieldName} must be a valid timestamp`,
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_UAT_JOB_INVALID',
      { fieldName },
    );
  }
  return number;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationRemoteRolloutError';
  error.code = code;
  error.details = details;
  return error;
}
