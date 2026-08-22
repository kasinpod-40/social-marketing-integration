export const TIKTOK_PRODUCTION_RECOVERY = Object.freeze({
  reviewedMain: '673431ad618a077f039a3844355ef36ff9a231ba',
  workerName: 'social-mkt-sync-worker',
  customerProfile: 'chemistry_k',
  jobType: 'tiktok.creator.native.sync',
  redriveType: 'system.dead-letter.redrive',
  trigger: 'production_connector_uat',
  metricDate: '2026-08-22',
  retainedDlqHint: 'f7081',
});

const REQUIRED_DARK_FLAGS = Object.freeze([
  'MKT_CONNECTOR_TIKTOK_ENABLED',
  'MKT_PRODUCTION_CONNECTOR_UAT_ENABLED',
  'MKT_DLQ_REDRIVE_ENABLED',
  'MKT_SCHEDULE_TIKTOK_ENABLED',
  'MKT_NOTIFICATION_RUNTIME_ENABLED',
]);

export function readJsoncScalar(text, name) {
  const escaped = escapeRegExp(name);
  const expression = new RegExp(`(?:"${escaped}"|\\b${escaped}\\b)\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|true|false|null|-?\\d+(?:\\.\\d+)?)`, 'u');
  const match = String(text ?? '').match(expression);
  if (!match) return null;
  const token = match[1];
  if (token.startsWith('"')) return JSON.parse(token);
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token === 'null') return null;
  return Number(token);
}

export function assertDarkProductionConfig(text) {
  assertEqual(readJsoncScalar(text, 'name'), TIKTOK_PRODUCTION_RECOVERY.workerName, 'Worker name');
  assertEqual(readJsoncScalar(text, 'MKT_ENV'), 'production', 'MKT_ENV');
  assertEqual(readJsoncScalar(text, 'MKT_CUSTOMER_PROFILE'), TIKTOK_PRODUCTION_RECOVERY.customerProfile, 'MKT_CUSTOMER_PROFILE');
  for (const name of REQUIRED_DARK_FLAGS) assertFalse(readJsoncScalar(text, name), name);
  return true;
}

export function buildRecoveryConfigText(darkConfigText) {
  assertDarkProductionConfig(darkConfigText);
  let next = String(darkConfigText);
  next = replaceJsoncScalar(next, 'MKT_CONNECTOR_TIKTOK_ENABLED', 'true');
  next = replaceJsoncScalar(next, 'MKT_PRODUCTION_CONNECTOR_UAT_ENABLED', 'true');
  next = replaceJsoncScalar(next, 'MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR', 'tiktok');
  next = replaceJsoncScalar(next, 'MKT_DLQ_REDRIVE_ENABLED', 'true');

  assertEqual(readJsoncScalar(next, 'MKT_CONNECTOR_TIKTOK_ENABLED'), 'true', 'MKT_CONNECTOR_TIKTOK_ENABLED');
  assertEqual(readJsoncScalar(next, 'MKT_PRODUCTION_CONNECTOR_UAT_ENABLED'), 'true', 'MKT_PRODUCTION_CONNECTOR_UAT_ENABLED');
  assertEqual(readJsoncScalar(next, 'MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR'), 'tiktok', 'MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR');
  assertEqual(readJsoncScalar(next, 'MKT_DLQ_REDRIVE_ENABLED'), 'true', 'MKT_DLQ_REDRIVE_ENABLED');
  assertFalse(readJsoncScalar(next, 'MKT_SCHEDULE_TIKTOK_ENABLED'), 'MKT_SCHEDULE_TIKTOK_ENABLED');
  assertFalse(readJsoncScalar(next, 'MKT_NOTIFICATION_RUNTIME_ENABLED'), 'MKT_NOTIFICATION_RUNTIME_ENABLED');
  return next;
}

export function validateRetainedDlqRow(row) {
  const payload = parsePayload(row?.payload_json);
  assertEqual(row?.job_type, TIKTOK_PRODUCTION_RECOVERY.jobType, 'dead-letter job type');
  assertEqual(row?.status, 'open', 'dead-letter status');
  assertEqual(payload?.type, TIKTOK_PRODUCTION_RECOVERY.jobType, 'payload type');
  assertEqual(payload?.trigger, TIKTOK_PRODUCTION_RECOVERY.trigger, 'payload trigger');
  assertEqual(payload?.metricDate, TIKTOK_PRODUCTION_RECOVERY.metricDate, 'payload metricDate');

  const dlqId = requireText(row?.dlq_id, 'dlq_id');
  const messageId = String(row?.message_id ?? '');
  if (!dlqId.includes(TIKTOK_PRODUCTION_RECOVERY.retainedDlqHint)
    && !messageId.includes(TIKTOK_PRODUCTION_RECOVERY.retainedDlqHint)) {
    throw contractError('Retained TikTok DLQ does not match terminal:f7081... evidence', 'TIKTOK_PRODUCTION_UAT_DLQ_HINT_MISMATCH', {
      dlqId,
      messageId,
    });
  }
  return Object.freeze({ row: { ...row }, payload: Object.freeze({ ...payload }), dlqId });
}

export function buildRedriveEnvelope(dlqId) {
  return Object.freeze({
    body: Object.freeze({
      schemaVersion: 1,
      type: TIKTOK_PRODUCTION_RECOVERY.redriveType,
      dlqId: requireText(dlqId, 'dlqId'),
    }),
  });
}

export function buildIdempotencyEnvelope(originalPayload, requestedAt = Date.now()) {
  const original = parsePayload(originalPayload);
  assertEqual(original?.type, TIKTOK_PRODUCTION_RECOVERY.jobType, 'idempotency payload type');
  assertEqual(original?.trigger, TIKTOK_PRODUCTION_RECOVERY.trigger, 'idempotency payload trigger');
  assertEqual(original?.metricDate, TIKTOK_PRODUCTION_RECOVERY.metricDate, 'idempotency payload metricDate');
  const timestamp = Number(requestedAt);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw contractError('requestedAt must be a non-negative safe integer', 'TIKTOK_PRODUCTION_RECOVERY_TIMESTAMP_INVALID', { requestedAt });
  }
  const body = { ...original };
  delete body.redriveOfDlqId;
  delete body.redriveReference;
  body.schemaVersion = Number(original.schemaVersion ?? 1);
  body.requestedAt = new Date(timestamp).toISOString();
  return Object.freeze({ body: Object.freeze(body) });
}

export function validateSuccessfulSyncRun(row, options = {}) {
  if (!row) throw contractError('Expected a TikTok sync run row', 'TIKTOK_PRODUCTION_SYNC_RUN_MISSING');
  assertEqual(row.customer_profile, TIKTOK_PRODUCTION_RECOVERY.customerProfile, 'sync customer_profile');
  assertEqual(row.platform, 'tiktok', 'sync platform');
  assertEqual(row.sync_type, 'native_import', 'sync sync_type');
  assertEqual(row.status, 'success', 'sync status');
  if (row.error_code != null && String(row.error_code).trim() !== '') {
    throw contractError('Successful TikTok run must not retain an error code', 'TIKTOK_PRODUCTION_SYNC_RUN_ERROR', { errorCode: row.error_code });
  }
  if (options.idempotency === true) {
    for (const field of ['records_created', 'records_updated', 'records_written']) {
      if (Number(row[field] ?? 0) !== 0) {
        throw contractError('Idempotency rerun produced a business write', 'TIKTOK_PRODUCTION_IDEMPOTENCY_WRITE_DETECTED', {
          field,
          value: Number(row[field] ?? 0),
          syncRunId: row.sync_run_id ?? null,
        });
      }
    }
  }
  return Object.freeze({ ...row });
}

export function extractD1Rows(output) {
  const value = parseJson(output, 'wrangler d1 --json output');
  const blocks = Array.isArray(value) ? value : [value];
  const rows = [];
  for (const block of blocks) {
    if (Array.isArray(block?.results)) rows.push(...block.results);
    if (Array.isArray(block?.result)) {
      for (const nested of block.result) {
        if (Array.isArray(nested?.results)) rows.push(...nested.results);
      }
    }
  }
  return rows;
}

function replaceJsoncScalar(text, name, value) {
  const escaped = escapeRegExp(name);
  const expression = new RegExp(`((?:"${escaped}"|\\b${escaped}\\b)\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|true|false|null|-?\\d+(?:\\.\\d+)?)`, 'gu');
  const matches = [...String(text).matchAll(expression)];
  if (matches.length !== 1) {
    throw contractError(`Expected exactly one ${name} assignment`, 'TIKTOK_PRODUCTION_RECOVERY_CONFIG_CARDINALITY_MISMATCH', {
      name,
      count: matches.length,
    });
  }
  const replacement = JSON.stringify(String(value));
  return String(text).replace(expression, `$1${replacement}`);
}

function parsePayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const payload = value.body && typeof value.body === 'object' && !Array.isArray(value.body)
      ? value.body
      : value;
    return { ...payload };
  }
  const parsed = parseJson(value, 'dead-letter payload');
  const payload = parsed?.body && typeof parsed.body === 'object' && !Array.isArray(parsed.body)
    ? parsed.body
    : parsed;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw contractError('Dead-letter payload must be an object', 'TIKTOK_PRODUCTION_RECOVERY_PAYLOAD_INVALID');
  }
  return { ...payload };
}

function parseJson(value, fieldName) {
  try {
    return JSON.parse(String(value ?? ''));
  } catch (cause) {
    throw contractError(`${fieldName} is not valid JSON`, 'TIKTOK_PRODUCTION_RECOVERY_JSON_INVALID', {
      fieldName,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function assertFalse(value, label) {
  if (!(value === false || value === 'false')) {
    throw contractError(`${label} must be false`, 'TIKTOK_PRODUCTION_NOT_DARK', { label, value });
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw contractError(`${label} mismatch`, 'TIKTOK_PRODUCTION_RECOVERY_CONTRACT_MISMATCH', { label, expected, actual });
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw contractError(`${fieldName} is required`, 'TIKTOK_PRODUCTION_RECOVERY_CONTRACT_MISMATCH', { fieldName, value });
  }
  return value.trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function contractError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokProductionUatRecoveryContractError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
