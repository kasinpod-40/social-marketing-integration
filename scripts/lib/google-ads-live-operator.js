import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const GOOGLE_ADS_LIVE_OPERATOR_PHASES = Object.freeze([
  'plan',
  'preflight',
  'backup',
  'migrate',
  'deploy',
  'connection-gate',
  'live-ready',
  'verify',
  'rerun-verify',
]);

export const GOOGLE_ADS_LIVE_OPERATOR_CONFIRMATIONS = Object.freeze({
  preflight: 'CONFIRM_GOOGLE_ADS_LIVE_PREFLIGHT',
  backup: 'CONFIRM_GOOGLE_ADS_LIVE_BACKUP',
  migrate: 'CONFIRM_GOOGLE_ADS_LIVE_MIGRATION',
  deploy: 'CONFIRM_GOOGLE_ADS_FLAGS_FALSE_DEPLOY',
  'connection-gate': 'CONFIRM_GOOGLE_ADS_CONNECTION_GATE_READ',
  'live-ready': 'CONFIRM_GOOGLE_ADS_EXTERNAL_LIVE_READY_CHECK',
  verify: 'CONFIRM_GOOGLE_ADS_LIVE_VERIFY',
  'rerun-verify': 'CONFIRM_GOOGLE_ADS_LIVE_RERUN_VERIFY',
});

export const GOOGLE_ADS_LARK_DAILY_NUMBER_FORMATTERS = Object.freeze({
  conversions: Object.freeze({ formatter: '0.0', decimalPlaces: 1 }),
  spend: Object.freeze({ formatter: '฿#,##0.00', decimalPlaces: 2 }),
  conversion_value: Object.freeze({ formatter: '฿#,##0.00', decimalPlaces: 2 }),
  ctr: Object.freeze({ formatter: '0.000', decimalPlaces: 3 }),
  cpc: Object.freeze({ formatter: '฿#,##0.00', decimalPlaces: 2 }),
  cpm: Object.freeze({ formatter: '฿#,##0.00', decimalPlaces: 2 }),
  cpa: Object.freeze({ formatter: '฿#,##0.00', decimalPlaces: 2 }),
  actual_roas: Object.freeze({ formatter: '0.0', decimalPlaces: 1 }),
});

const EXECUTABLE_PHASES = new Set(GOOGLE_ADS_LIVE_OPERATOR_PHASES.filter((phase) => phase !== 'plan'));
const REQUIRED_FALSE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_GOOGLE_ADS_ENABLED',
  'MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED',
  'MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED',
  'MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED',
  'MKT_GOOGLE_ADS_LARK_WRITE_ENABLED',
  'MKT_SCHEDULE_GOOGLE_ADS_ENABLED',
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ADWORDS_SCOPE = 'https://www.googleapis.com/auth/adwords';

export function parseGoogleAdsLiveOperatorArgs(args = []) {
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
    throw operatorError(`Unknown Google Ads live operator argument: ${arg}`, 'GOOGLE_ADS_OPERATOR_ARGUMENT_INVALID');
  }
  if (!GOOGLE_ADS_LIVE_OPERATOR_PHASES.includes(phase)) {
    throw operatorError(`Unsupported Google Ads live operator phase: ${phase}`, 'GOOGLE_ADS_OPERATOR_PHASE_INVALID');
  }
  return Object.freeze({ phase, execute });
}

export function assertGoogleAdsLiveOperatorConfirmation(phase, env = {}) {
  if (!EXECUTABLE_PHASES.has(phase)) return true;
  const envName = GOOGLE_ADS_LIVE_OPERATOR_CONFIRMATIONS[phase];
  if (env?.[envName] !== phase) {
    throw operatorError(`Google Ads live operator requires ${envName}=${phase}`, 'GOOGLE_ADS_OPERATOR_CONFIRMATION_REQUIRED', {
      phase,
      envName,
    });
  }
  return true;
}

export function loadGoogleAdsLiveOperatorTarget(env = {}) {
  const target = Object.freeze({
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
    databaseName: requireText(env.MKT_GOOGLE_ADS_LIVE_DATABASE_NAME, 'MKT_GOOGLE_ADS_LIVE_DATABASE_NAME'),
    apiWranglerConfig: requireText(
      env.MKT_GOOGLE_ADS_LIVE_API_WRANGLER_CONFIG,
      'MKT_GOOGLE_ADS_LIVE_API_WRANGLER_CONFIG',
    ),
    syncWranglerConfig: requireText(
      env.MKT_GOOGLE_ADS_LIVE_SYNC_WRANGLER_CONFIG,
      'MKT_GOOGLE_ADS_LIVE_SYNC_WRANGLER_CONFIG',
    ),
    managerCustomerId: normalizeCustomerId(
      env.MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID,
      'MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID',
    ),
    advertiserCustomerId: normalizeCustomerId(
      env.MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID,
      'MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID',
    ),
    sourceTimezone: requireExact(
      env.MKT_GOOGLE_ADS_SOURCE_TIMEZONE ?? env.DEFAULT_TIMEZONE,
      'Asia/Bangkok',
      'MKT_GOOGLE_ADS_SOURCE_TIMEZONE',
    ),
  });
  return target;
}

export function validateGoogleAdsFlagsFalseConfig(apiConfigText, syncConfigText) {
  const api = requireText(apiConfigText, 'apiConfigText');
  const sync = requireText(syncConfigText, 'syncConfigText');
  for (const [name, content] of [['api', api], ['sync', sync]]) {
    for (const flag of REQUIRED_FALSE_FLAGS) {
      if (!new RegExp(`"${flag}"\\s*:\\s*"false"`, 'u').test(content)) {
        throw operatorError(`Google Ads rollout ${name} config must keep ${flag}=false`, 'GOOGLE_ADS_OPERATOR_FLAGS_NOT_FALSE', {
          config: name,
          flag,
        });
      }
    }
    if (/"MKT_SCHEDULE_GOOGLE_ADS_ENABLED"\s*:\s*"true"/u.test(content)) {
      throw operatorError('Google Ads schedule must remain disabled', 'GOOGLE_ADS_OPERATOR_SCHEDULE_ENABLED', {
        config: name,
      });
    }
  }
  if (!/"binding"\s*:\s*"MKT_STATE_DB"/u.test(api)
    || !/"binding"\s*:\s*"MKT_SYNC_QUEUE"/u.test(api)) {
    throw operatorError('API Worker rollout config is missing D1 or Queue bindings', 'GOOGLE_ADS_OPERATOR_API_BINDINGS_INVALID');
  }
  if (!/"binding"\s*:\s*"MKT_STATE_DB"/u.test(sync)
    || !/"binding"\s*:\s*"MKT_SYNC_QUEUE"/u.test(sync)) {
    throw operatorError('Sync Worker rollout config is missing D1 or Queue bindings', 'GOOGLE_ADS_OPERATOR_SYNC_BINDINGS_INVALID');
  }
  return Object.freeze({
    flagsFalse: true,
    scheduleDisabled: true,
    apiBindings: true,
    syncBindings: true,
  });
}

export function buildGoogleAdsConnectionGateSql(target) {
  const value = normalizeTarget(target);
  return compactSql(`
    SELECT
      COUNT(*) AS script_authorized_connection_count,
      MAX(CASE WHEN c.connection_status = 'connected' THEN 1 ELSE 0 END) AS connected,
      MAX(CASE WHEN c.access_status IN ('validated', 'google_ads_api_access_pending') THEN 1 ELSE 0 END) AS script_access_allowed,
      MAX(CASE WHEN c.access_status = 'validated' THEN 1 ELSE 0 END) AS api_access_validated,
      MAX(CASE WHEN c.access_status = 'google_ads_api_access_pending' THEN 1 ELSE 0 END) AS api_access_pending,
      MAX(CASE WHEN
        REPLACE(COALESCE(c.external_account_id, ''), '-', '') = '${value.advertiserCustomerId}'
        OR json_extract(c.provider_metadata_json, '$.advertiserCustomerId') = '${value.advertiserCustomerId}'
        OR json_extract(c.provider_metadata_json, '$.approvedAdvertiserCustomerId') = '${value.advertiserCustomerId}'
      THEN 1 ELSE 0 END) AS advertiser_matches,
      MAX(CASE WHEN c.credential_reference = ec.credential_reference THEN 1 ELSE 0 END) AS active_credential_matches,
      MAX(CASE WHEN json_extract(c.provider_metadata_json, '$.managerCustomerId') = '${value.managerCustomerId}' THEN 1 ELSE 0 END) AS manager_matches,
      MAX(CASE WHEN EXISTS (
        SELECT 1
        FROM json_each(COALESCE(c.granted_scopes_json, '[]')) AS scope
        WHERE scope.value = '${ADWORDS_SCOPE}'
      ) THEN 1 ELSE 0 END) AS scope_matches
    FROM connections AS c
    JOIN encrypted_credentials AS ec
      ON ec.connection_id = c.id
     AND ec.credential_kind = 'refresh_token'
     AND ec.status = 'active'
    WHERE c.customer_key = '${value.customerKey}'
      AND c.connector_key = 'google_ads';
  `);
}

export function validateGoogleAdsConnectionGateRow(row = {}) {
  const requiredFields = [
    'script_authorized_connection_count',
    'connected',
    'script_access_allowed',
    'advertiser_matches',
    'active_credential_matches',
    'manager_matches',
    'scope_matches',
  ];
  const informationalFields = ['api_access_validated', 'api_access_pending'];
  const fields = [...requiredFields, ...informationalFields];
  const normalized = Object.fromEntries(fields.map((field) => [field, Number(row?.[field] ?? 0)]));
  if (normalized.script_authorized_connection_count !== 1
    || requiredFields.slice(1).some((field) => normalized[field] !== 1)
    || normalized.api_access_validated + normalized.api_access_pending !== 1) {
    throw operatorError('Google Ads Manager Script Customer Connection gate is not ready', 'GOOGLE_ADS_OPERATOR_CONNECTION_GATE_FAILED', normalized);
  }
  return Object.freeze(normalized);
}

export function buildGoogleAdsRunVerificationSql(runId) {
  const id = requireUuid(runId, 'runId');
  return compactSql(`
    SELECT
      run.run_id,
      run.mode,
      run.status AS transport_status,
      run.expected_chunk_count,
      run.received_chunk_count,
      run.expected_row_count,
      run.received_row_count,
      run.payload_redacted_at,
      admission.status AS admission_status,
      admission.send_attempts,
      admission.completed_at,
      admission.payload_redacted_at AS admission_payload_redacted_at,
      work.lifecycle_status AS work_lifecycle_status,
      COALESCE((SELECT COUNT(*) FROM ads_entity_state WHERE last_sync_run_id IN (
        SELECT sync_run_id FROM sync_runs WHERE platform = 'google_ads'
      )), 0) AS ads_entity_rows,
      COALESCE((SELECT COUNT(*) FROM ads_daily_facts WHERE source_revision = run.run_id), 0) AS ads_daily_rows,
      COALESCE((SELECT COUNT(*) FROM data_coverage_runs WHERE source_watermark = run.run_id), 0) AS coverage_run_rows
    FROM google_ads_delivery_runs AS run
    JOIN google_ads_live_admissions AS admission ON admission.run_id = run.run_id
    LEFT JOIN sync_work_runs AS work ON work.work_key = admission.work_key
    WHERE run.run_id = '${id}';
  `);
}

export function validateGoogleAdsRunVerificationRow(row = {}) {
  const result = Object.freeze({
    runId: optionalText(row.run_id),
    mode: optionalText(row.mode),
    transportStatus: optionalText(row.transport_status),
    expectedChunks: integer(row.expected_chunk_count, 'expected_chunk_count'),
    receivedChunks: integer(row.received_chunk_count, 'received_chunk_count'),
    expectedRows: integer(row.expected_row_count, 'expected_row_count'),
    receivedRows: integer(row.received_row_count, 'received_row_count'),
    payloadRedacted: row.payload_redacted_at !== null && row.payload_redacted_at !== undefined,
    admissionStatus: optionalText(row.admission_status),
    sendAttempts: integer(row.send_attempts, 'send_attempts'),
    admissionCompleted: row.completed_at !== null && row.completed_at !== undefined,
    admissionPayloadRedacted: row.admission_payload_redacted_at !== null
      && row.admission_payload_redacted_at !== undefined,
    workLifecycleStatus: optionalText(row.work_lifecycle_status),
    adsEntityRows: integer(row.ads_entity_rows, 'ads_entity_rows'),
    adsDailyRows: integer(row.ads_daily_rows, 'ads_daily_rows'),
    coverageRunRows: integer(row.coverage_run_rows, 'coverage_run_rows'),
  });
  if (!result.runId
    || result.mode !== 'LIVE'
    || result.expectedChunks !== result.receivedChunks
    || result.expectedRows !== result.receivedRows
    || result.admissionStatus !== 'completed'
    || result.workLifecycleStatus !== 'completed'
    || !result.payloadRedacted
    || !result.admissionPayloadRedacted
    || !result.admissionCompleted
    || result.coverageRunRows !== 6) {
    throw operatorError('Google Ads LIVE reconciliation verification failed', 'GOOGLE_ADS_OPERATOR_LIVE_VERIFY_FAILED', result);
  }
  return result;
}

export function compareGoogleAdsRerunVerification(before, after) {
  const left = validateGoogleAdsRunVerificationRow(before);
  const right = validateGoogleAdsRunVerificationRow(after);
  const stableFields = [
    'runId', 'expectedChunks', 'receivedChunks', 'expectedRows', 'receivedRows',
    'adsEntityRows', 'adsDailyRows', 'coverageRunRows',
  ];
  const changed = stableFields.filter((field) => left[field] !== right[field]);
  if (changed.length > 0) {
    throw operatorError('Google Ads exact rerun changed durable business counts', 'GOOGLE_ADS_OPERATOR_RERUN_DRIFT', {
      changed,
    });
  }
  return Object.freeze({ businessFactDrift: false, changed: Object.freeze([]) });
}

export function compareGoogleAdsLarkDailyNumber(field, actual, expected) {
  const formatter = GOOGLE_ADS_LARK_DAILY_NUMBER_FORMATTERS[field] ?? null;
  if (actual === null || expected === null) {
    return Object.freeze({
      field,
      mode: formatter ? 'lark-display' : 'canonical-exact',
      formatter: formatter?.formatter ?? null,
      decimalPlaces: formatter?.decimalPlaces ?? null,
      expectedCanonical: expected,
      expectedDisplay: expected,
      actual,
      tolerance: 0,
      matches: actual === expected,
    });
  }

  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  const finite = Number.isFinite(actualNumber) && Number.isFinite(expectedNumber);
  const expectedDisplay = finite && formatter
    ? Number(expectedNumber.toFixed(formatter.decimalPlaces))
    : expectedNumber;
  const tolerance = finite
    ? 1e-9 * Math.max(1, Math.abs(actualNumber), Math.abs(expectedDisplay))
    : 0;
  const matches = finite && Math.abs(actualNumber - expectedDisplay) <= tolerance;

  return Object.freeze({
    field,
    mode: formatter ? 'lark-display' : 'canonical-exact',
    formatter: formatter?.formatter ?? null,
    decimalPlaces: formatter?.decimalPlaces ?? null,
    expectedCanonical: expectedNumber,
    expectedDisplay,
    actual: actualNumber,
    tolerance,
    matches,
  });
}

export function requireGoogleAdsOperatorRunId(env = {}) {
  return requireUuid(env.MKT_GOOGLE_ADS_LIVE_RUN_ID, 'MKT_GOOGLE_ADS_LIVE_RUN_ID');
}

function normalizeTarget(value = {}) {
  return Object.freeze({
    customerKey: requireExact(value.customerKey, 'chemistry_k', 'customerKey'),
    managerCustomerId: normalizeCustomerId(value.managerCustomerId, 'managerCustomerId'),
    advertiserCustomerId: normalizeCustomerId(value.advertiserCustomerId, 'advertiserCustomerId'),
    sourceTimezone: requireExact(value.sourceTimezone, 'Asia/Bangkok', 'sourceTimezone'),
  });
}

function normalizeCustomerId(value, fieldName) {
  const id = requireText(value, fieldName).replaceAll('-', '');
  if (!/^\d{10}$/u.test(id)) throw operatorError(`${fieldName} must be a 10-digit customer ID`, 'GOOGLE_ADS_OPERATOR_TARGET_INVALID', { fieldName });
  return id;
}

function requireUuid(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!UUID_V4.test(text)) throw operatorError(`${fieldName} must be a UUID v4`, 'GOOGLE_ADS_OPERATOR_RUN_ID_INVALID', { fieldName });
  return text;
}

function requireExact(value, expected, fieldName) {
  const text = requireText(value, fieldName);
  if (text !== expected) throw operatorError(`${fieldName} must equal ${expected}`, 'GOOGLE_ADS_OPERATOR_TARGET_INVALID', { fieldName });
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw operatorError(`${fieldName} is required`, 'GOOGLE_ADS_OPERATOR_INPUT_INVALID', { fieldName });
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

function integer(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw operatorError(`${fieldName} must be a non-negative integer`, 'GOOGLE_ADS_OPERATOR_EVIDENCE_INVALID', { fieldName });
  return number;
}

function compactSql(value) {
  return value.trim().replaceAll(/\s+/gu, ' ');
}

function operatorError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
