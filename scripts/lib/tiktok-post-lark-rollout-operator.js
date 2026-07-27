import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const TIKTOK_POST_LARK_ROLLOUT_PHASES = Object.freeze([
  'plan',
  'preflight',
  'backup',
  'migrate',
  'deploy-safe',
  'enable-audit',
  'audit',
  'disable-audit',
]);

export const TIKTOK_POST_LARK_ROLLOUT_CONFIRMATIONS = Object.freeze({
  preflight: Object.freeze({
    envName: 'CONFIRM_TIKTOK_POST_LARK_PREFLIGHT',
    value: 'READ_ONLY_TIKTOK_POST_LARK_PREFLIGHT',
  }),
  backup: Object.freeze({
    envName: 'CONFIRM_TIKTOK_POST_LARK_BACKUP',
    value: 'BACKUP_BEFORE_0016_TIKTOK_POST_LARK',
  }),
  migrate: Object.freeze({
    envName: 'CONFIRM_TIKTOK_POST_LARK_MIGRATION',
    value: 'APPLY_0016_TIKTOK_POST_LARK',
  }),
  'deploy-safe': Object.freeze({
    envName: 'CONFIRM_TIKTOK_POST_LARK_SAFE_DEPLOY',
    value: 'DEPLOY_TIKTOK_POST_LARK_ALL_FLAGS_FALSE',
  }),
  'enable-audit': Object.freeze({
    envName: 'CONFIRM_TIKTOK_POST_LARK_AUDIT_ENABLE',
    value: 'ENABLE_TIKTOK_POST_LARK_AUDIT_ONLY',
  }),
  audit: Object.freeze({
    envName: 'CONFIRM_TIKTOK_POST_LARK_AUDIT_READ',
    value: 'READ_TIKTOK_POST_LARK_AUDIT_ONCE',
  }),
  'disable-audit': Object.freeze({
    envName: 'CONFIRM_TIKTOK_POST_LARK_AUDIT_DISABLE',
    value: 'DISABLE_TIKTOK_POST_LARK_AUDIT',
  }),
});

const EXECUTABLE_PHASES = new Set(
  TIKTOK_POST_LARK_ROLLOUT_PHASES.filter((phase) => phase !== 'plan'),
);

const REQUIRED_FALSE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_TIKTOK_ENABLED',
  'MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED',
  'MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED',
  'MKT_TIME_SERIES_D1_WRITE_ENABLED',
  'MKT_TIME_SERIES_D1_BACKFILL_ENABLED',
  'MKT_REPORT_D1_SHADOW_READ_ENABLED',
  'MKT_REPORT_D1_READ_ENABLED',
  'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
  'MKT_SCHEDULE_TIKTOK_ENABLED',
  'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
  'MKT_LARK_DAILY_RETENTION_ENABLED',
  'MKT_DLQ_REDRIVE_ENABLED',
  'MKT_CONNECTOR_GOOGLE_ADS_ENABLED',
  'MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED',
  'MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED',
  'MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED',
  'MKT_GOOGLE_ADS_LARK_WRITE_ENABLED',
  'MKT_SCHEDULE_GOOGLE_ADS_ENABLED',
]);

const EXPECTED_MIGRATION = '0016_tiktok_post_lark_pipeline.sql';

export function parseTikTokPostLarkRolloutArgs(args = []) {
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
      `Unknown TikTok post-Lark rollout argument: ${arg}`,
      'TIKTOK_POST_LARK_ROLLOUT_ARGUMENT_INVALID',
    );
  }
  if (!TIKTOK_POST_LARK_ROLLOUT_PHASES.includes(phase)) {
    throw operatorError(
      `Unsupported TikTok post-Lark rollout phase: ${phase}`,
      'TIKTOK_POST_LARK_ROLLOUT_PHASE_INVALID',
    );
  }
  return Object.freeze({ phase, execute });
}

export function assertTikTokPostLarkRolloutConfirmation(phase, env = {}) {
  if (!EXECUTABLE_PHASES.has(phase)) return true;
  const contract = TIKTOK_POST_LARK_ROLLOUT_CONFIRMATIONS[phase];
  if (env?.[contract.envName] !== contract.value) {
    throw operatorError(
      `TikTok post-Lark rollout requires ${contract.envName}=${contract.value}`,
      'TIKTOK_POST_LARK_ROLLOUT_CONFIRMATION_REQUIRED',
      { phase, envName: contract.envName },
    );
  }
  return true;
}

export function loadTikTokPostLarkRolloutTarget(env = {}, phase = 'plan') {
  const target = {
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
    sourceHandle: requireExact(
      env.TIKTOK_SOURCE_HANDLE,
      'chemistry_k',
      'TIKTOK_SOURCE_HANDLE',
    ),
    databaseName: requireExact(
      env.MKT_TIKTOK_ROLLOUT_DATABASE_NAME,
      'social-mkt-state-dev',
      'MKT_TIKTOK_ROLLOUT_DATABASE_NAME',
    ),
    safeWranglerConfig: requireText(
      env.MKT_TIKTOK_ROLLOUT_SAFE_WRANGLER_CONFIG,
      'MKT_TIKTOK_ROLLOUT_SAFE_WRANGLER_CONFIG',
    ),
    auditWranglerConfig: requireText(
      env.MKT_TIKTOK_ROLLOUT_AUDIT_WRANGLER_CONFIG,
      'MKT_TIKTOK_ROLLOUT_AUDIT_WRANGLER_CONFIG',
    ),
    workerOrigin: requireHttpsOrigin(
      env.MKT_TIKTOK_ROLLOUT_WORKER_ORIGIN,
      'MKT_TIKTOK_ROLLOUT_WORKER_ORIGIN',
    ),
    operatorToken: phase === 'audit'
      ? requireSecret(env.MKT_CONNECTION_OPERATOR_TOKEN, 'MKT_CONNECTION_OPERATOR_TOKEN')
      : null,
  };
  return Object.freeze(target);
}

export function validateTikTokPostLarkWranglerConfig(configText, options = {}) {
  const text = requireText(configText, 'configText');
  const auditEnabled = options.auditEnabled === true;
  requireConfigValue(text, 'name', 'social-mkt-sync-worker');
  requireConfigValue(text, 'MKT_ENV', 'development');
  requireConfigValue(text, 'MKT_CUSTOMER_PROFILE', 'integration_workspace');
  requireConfigValue(text, 'MKT_CONNECTION_CUSTOMER_KEY', 'chemistry_k');
  requireConfigValue(text, 'TIKTOK_SOURCE_HANDLE', 'chemistry_k');
  requireConfigValue(text, 'database_name', 'social-mkt-state-dev');
  requireConfigValue(text, 'MKT_TIKTOK_AUDIT_HTTP_ENABLED', auditEnabled ? 'true' : 'false');

  for (const flag of REQUIRED_FALSE_FLAGS) {
    requireConfigValue(text, flag, 'false');
  }

  if (!/"binding"\s*:\s*"MKT_STATE_DB"/u.test(text)) {
    throw operatorError(
      'TikTok post-Lark rollout config is missing MKT_STATE_DB',
      'TIKTOK_POST_LARK_ROLLOUT_CONFIG_UNSAFE',
      { binding: 'MKT_STATE_DB' },
    );
  }
  if (!/"queue"\s*:\s*"social-mkt-sync-jobs"/u.test(text)) {
    throw operatorError(
      'TikTok post-Lark rollout config is missing the Integration Workspace main Queue',
      'TIKTOK_POST_LARK_ROLLOUT_CONFIG_UNSAFE',
      { queue: 'social-mkt-sync-jobs' },
    );
  }
  if (!/"binding"\s*:\s*"MKT_SYNC_QUEUE"/u.test(text)) {
    throw operatorError(
      'TikTok post-Lark rollout config is missing MKT_SYNC_QUEUE',
      'TIKTOK_POST_LARK_ROLLOUT_CONFIG_UNSAFE',
      { binding: 'MKT_SYNC_QUEUE' },
    );
  }

  return Object.freeze({
    workerName: 'social-mkt-sync-worker',
    environment: 'development',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    auditEnabled,
    businessFlagsFalse: true,
    schedulesDisabled: true,
    d1BindingPresent: true,
    queueBindingPresent: true,
  });
}

export function validateTikTokPostLarkPendingMigrations(output) {
  const pending = pendingMigrationNames(output);
  if (pending.length !== 1 || pending[0] !== EXPECTED_MIGRATION) {
    throw operatorError(
      `Expected only pending Migration ${EXPECTED_MIGRATION}`,
      'TIKTOK_POST_LARK_ROLLOUT_PENDING_MIGRATIONS_MISMATCH',
      { pending },
    );
  }
  return Object.freeze(pending);
}

export function validateTikTokPostLarkNoPendingMigrations(output) {
  const pending = pendingMigrationNames(output);
  if (pending.length !== 0) {
    throw operatorError(
      'TikTok post-Lark rollout still has pending migrations',
      'TIKTOK_POST_LARK_ROLLOUT_PENDING_MIGRATIONS_REMAIN',
      { pending },
    );
  }
  return true;
}

export function buildTikTokPostLarkPreflightSql() {
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'tiktok_source_admissions') AS admission_table_present,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_tiktok_source_admissions_account_status') AS admission_account_index_present,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_tiktok_source_admissions_watermark') AS admission_watermark_index_present,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_tiktok_source_admissions_completed') AS admission_completed_index_present,
      (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') AS active_work,
      (SELECT COUNT(*) FROM sync_locks WHERE expires_at > unixepoch('now') * 1000) AS active_locks,
      (SELECT COUNT(*) FROM dead_letter_jobs WHERE status = 'open') AS open_dlq,
      (SELECT COUNT(*) FROM system_alerts WHERE status = 'open') AS open_alerts,
      (SELECT COUNT(*) FROM organic_content_state) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations) AS organic_content_observations,
      (SELECT COUNT(*) FROM data_coverage_entities) AS coverage_entities,
      (SELECT COUNT(*) FROM (
        SELECT content_key FROM organic_content_state GROUP BY content_key HAVING COUNT(*) > 1
      )) AS state_duplicate_groups,
      (SELECT COUNT(*) FROM (
        SELECT observation_key FROM organic_content_observations GROUP BY observation_key HAVING COUNT(*) > 1
      )) AS observation_duplicate_groups;
  `);
}

export function buildTikTokPostLarkPostMigrationSql() {
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'tiktok_source_admissions') AS admission_table_present,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_tiktok_source_admissions_account_status') AS admission_account_index_present,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_tiktok_source_admissions_watermark') AS admission_watermark_index_present,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_tiktok_source_admissions_completed') AS admission_completed_index_present,
      (SELECT COUNT(*) FROM tiktok_source_admissions) AS admission_rows,
      (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') AS active_work,
      (SELECT COUNT(*) FROM sync_locks WHERE expires_at > unixepoch('now') * 1000) AS active_locks,
      (SELECT COUNT(*) FROM organic_content_state) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations) AS organic_content_observations,
      (SELECT COUNT(*) FROM data_coverage_entities) AS coverage_entities,
      (SELECT COUNT(*) FROM (
        SELECT content_key FROM organic_content_state GROUP BY content_key HAVING COUNT(*) > 1
      )) AS state_duplicate_groups,
      (SELECT COUNT(*) FROM (
        SELECT observation_key FROM organic_content_observations GROUP BY observation_key HAVING COUNT(*) > 1
      )) AS observation_duplicate_groups;
  `);
}

export function validateTikTokPostLarkPreflightRow(row = {}) {
  const result = normalizeCountRow(row, [
    'admission_table_present',
    'admission_account_index_present',
    'admission_watermark_index_present',
    'admission_completed_index_present',
    'active_work',
    'active_locks',
    'open_dlq',
    'open_alerts',
    'organic_content_state',
    'organic_content_observations',
    'coverage_entities',
    'state_duplicate_groups',
    'observation_duplicate_groups',
  ]);
  const invalid = [];
  for (const name of [
    'admission_table_present',
    'admission_account_index_present',
    'admission_watermark_index_present',
    'admission_completed_index_present',
    'active_work',
    'active_locks',
    'state_duplicate_groups',
    'observation_duplicate_groups',
  ]) {
    if (result[name] !== 0) invalid.push(name);
  }
  if (invalid.length > 0) {
    throw operatorError(
      'TikTok post-Lark Remote preflight is not safe to continue',
      'TIKTOK_POST_LARK_ROLLOUT_PREFLIGHT_FAILED',
      { invalid, result },
    );
  }
  return result;
}

export function validateTikTokPostLarkPostMigrationRow(row = {}, preflight = {}) {
  const result = normalizeCountRow(row, [
    'admission_table_present',
    'admission_account_index_present',
    'admission_watermark_index_present',
    'admission_completed_index_present',
    'admission_rows',
    'active_work',
    'active_locks',
    'organic_content_state',
    'organic_content_observations',
    'coverage_entities',
    'state_duplicate_groups',
    'observation_duplicate_groups',
  ]);
  const before = validateTikTokPostLarkPreflightRow(preflight);
  const invalid = [];
  for (const name of [
    'admission_table_present',
    'admission_account_index_present',
    'admission_watermark_index_present',
    'admission_completed_index_present',
  ]) {
    if (result[name] !== 1) invalid.push(name);
  }
  for (const name of [
    'admission_rows',
    'active_work',
    'active_locks',
    'state_duplicate_groups',
    'observation_duplicate_groups',
  ]) {
    if (result[name] !== 0) invalid.push(name);
  }
  for (const name of [
    'organic_content_state',
    'organic_content_observations',
    'coverage_entities',
  ]) {
    if (result[name] !== before[name]) invalid.push(`${name}_drift`);
  }
  if (invalid.length > 0) {
    throw operatorError(
      'TikTok post-Lark post-migration verification failed',
      'TIKTOK_POST_LARK_ROLLOUT_POST_MIGRATION_FAILED',
      { invalid, before, result },
    );
  }
  return result;
}

export function extractWranglerD1Rows(output) {
  let parsed;
  try {
    parsed = JSON.parse(requireText(output, 'output'));
  } catch (cause) {
    throw operatorError(
      'Wrangler D1 output is not valid JSON',
      'TIKTOK_POST_LARK_ROLLOUT_D1_RESPONSE_INVALID',
      { cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const rows = envelopes.flatMap((item) => item?.results ?? item?.result?.results ?? []);
  if (rows.length === 0) {
    throw operatorError(
      'Wrangler D1 response returned no rows',
      'TIKTOK_POST_LARK_ROLLOUT_D1_RESPONSE_EMPTY',
    );
  }
  return rows;
}

export function validateTikTokPostLarkAuditResponse(body = {}, target = {}) {
  const audit = body?.audit;
  const expected = {
    customerKey: requireExact(target.customerKey, 'chemistry_k', 'customerKey'),
    accountKey: requireExact(target.accountKey ?? target.customerKey, 'chemistry_k', 'accountKey'),
    sourceHandle: requireExact(target.sourceHandle, 'chemistry_k', 'sourceHandle'),
  };
  const result = Object.freeze({
    ok: body?.ok === true,
    mode: optionalText(audit?.mode),
    platform: optionalText(audit?.platform),
    customerKey: optionalText(audit?.customerKey),
    accountKey: optionalText(audit?.accountKey),
    sourceHandle: optionalText(audit?.sourceHandle),
    rawRecordCount: integer(audit?.raw?.recordCount, 'audit.raw.recordCount'),
    sourceWatermark: requireText(audit?.raw?.sourceWatermark, 'audit.raw.sourceWatermark'),
    readyForManualProcessing: audit?.readyForManualProcessing === true,
    issueCount: Array.isArray(audit?.issues) ? audit.issues.length : -1,
    issues: Array.isArray(audit?.issues) ? audit.issues : [],
  });
  if (!result.ok
    || result.mode !== 'read_only'
    || result.platform !== 'tiktok'
    || result.customerKey !== expected.customerKey
    || result.accountKey !== expected.accountKey
    || result.sourceHandle !== expected.sourceHandle
    || result.issueCount < 0) {
    throw operatorError(
      'TikTok post-Lark audit response contract failed',
      'TIKTOK_POST_LARK_ROLLOUT_AUDIT_RESPONSE_INVALID',
      result,
    );
  }
  return result;
}

export function validateTikTokPostLarkRouteStatus(status, expected) {
  const actual = Number(status);
  if (!Number.isInteger(actual) || actual !== expected) {
    throw operatorError(
      `TikTok post-Lark route expected HTTP ${expected} but received ${status}`,
      'TIKTOK_POST_LARK_ROLLOUT_ROUTE_STATUS_INVALID',
      { expected, actual: status },
    );
  }
  return true;
}

function pendingMigrationNames(output) {
  const text = requireText(output, 'migrationOutput');
  return [...new Set(text.match(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu) ?? [])].sort();
}

function normalizeCountRow(row, fields) {
  const result = {};
  for (const field of fields) result[field] = integer(row?.[field], field);
  return Object.freeze(result);
}

function requireConfigValue(text, name, expected) {
  const escapedName = escapeRegExp(name);
  const escapedValue = escapeRegExp(expected);
  const patterns = name === 'name'
    ? [new RegExp(`"${escapedName}"\\s*:\\s*"${escapedValue}"`, 'u')]
    : [
      new RegExp(`"${escapedName}"\\s*:\\s*"${escapedValue}"`, 'u'),
      new RegExp(`'${escapedName}'\\s*:\\s*'${escapedValue}'`, 'u'),
    ];
  if (!patterns.some((pattern) => pattern.test(text))) {
    throw operatorError(
      `TikTok post-Lark rollout config must set ${name}=${expected}`,
      'TIKTOK_POST_LARK_ROLLOUT_CONFIG_UNSAFE',
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
      'TIKTOK_POST_LARK_ROLLOUT_TARGET_INVALID',
      { fieldName, expected },
    );
  }
  return text;
}

function requireHttpsOrigin(value, fieldName) {
  const url = new URL(requireText(value, fieldName));
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw operatorError(
      `${fieldName} must be an HTTPS origin`,
      'TIKTOK_POST_LARK_ROLLOUT_TARGET_INVALID',
      { fieldName },
    );
  }
  return url.toString().replace(/\/$/u, '');
}

function requireSecret(value, fieldName) {
  const text = requireText(value, fieldName);
  if (/^(?:replace-with-|example|changeme)/iu.test(text)) {
    throw operatorError(
      `${fieldName} must be provided through the local secret environment`,
      'TIKTOK_POST_LARK_ROLLOUT_SECRET_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(
      `${fieldName} is required`,
      'TIKTOK_POST_LARK_ROLLOUT_VALUE_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function integer(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw operatorError(
      `${fieldName} must be a non-negative integer`,
      'TIKTOK_POST_LARK_ROLLOUT_VALUE_INVALID',
      { fieldName, value },
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
