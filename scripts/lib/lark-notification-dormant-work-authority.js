const SHARED_COUNT_FIELDS = Object.freeze([
  'sync_runs',
  'sync_jobs',
  'coverage_runs',
  'coverage_entities',
  'organic_content_state',
  'organic_content_observations',
]);

export function validateLarkNotificationDormantWorkPreflightRow(row = {}) {
  const normalized = normalizeCountRow(row, [
    'notification_table_count',
    'notification_index_count',
    'active_work',
    'active_locks',
    ...SHARED_COUNT_FIELDS,
  ]);
  const invalid = [];
  if (normalized.notification_table_count !== 0) invalid.push('notification_table_count');
  if (normalized.notification_index_count !== 0) invalid.push('notification_index_count');
  if (normalized.active_locks !== 0) invalid.push('active_locks');
  if (invalid.length > 0) {
    throw authorityError(
      'Lark notification Remote preflight requires no existing notification schema and no active lock',
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_PREFLIGHT_FAILED',
      { invalid },
    );
  }
  return normalized;
}

export function assertLarkNotificationDormantWorkStable(current = {}, baseline = {}) {
  const now = validateLarkNotificationDormantWorkPreflightRow(current);
  const before = validateLarkNotificationDormantWorkPreflightRow(baseline);
  const invalid = [];
  if (now.active_work !== before.active_work) invalid.push('active_work');
  for (const field of SHARED_COUNT_FIELDS) {
    if (now[field] !== before[field]) invalid.push(field);
  }
  if (invalid.length > 0) {
    throw authorityError(
      'Lark notification Remote state changed after preflight',
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_REMOTE_STATE_CHANGED',
      { invalid },
    );
  }
  return now;
}

export function validateLarkNotificationDormantWorkSchemaReadbackRow(
  row = {},
  baseline = {},
  expectedIndexCount = 3,
) {
  const normalized = normalizeCountRow(row, [
    'notification_table_count',
    'notification_index_count',
    'notification_delivery_rows',
    'active_work',
    'active_locks',
    ...SHARED_COUNT_FIELDS,
  ]);
  const before = normalizeCountRow(baseline, [
    'notification_table_count',
    'notification_index_count',
    'active_work',
    'active_locks',
    ...SHARED_COUNT_FIELDS,
  ]);
  const invalid = [];
  if (normalized.notification_table_count !== 1) invalid.push('notification_table_count');
  if (normalized.notification_index_count !== expectedIndexCount) {
    invalid.push('notification_index_count');
  }
  if (normalized.notification_delivery_rows !== 0) invalid.push('notification_delivery_rows');
  if (normalized.active_locks !== 0) invalid.push('active_locks');
  if (normalized.active_work !== before.active_work) invalid.push('active_work');
  for (const field of SHARED_COUNT_FIELDS) {
    if (normalized[field] !== before[field]) invalid.push(field);
  }
  if (invalid.length > 0) {
    throw authorityError(
      'Lark notification schema read-back failed or changed retained work or Business facts',
      'LARK_NOTIFICATION_REMOTE_ROLLOUT_SCHEMA_READBACK_FAILED',
      { invalid },
    );
  }
  return normalized;
}

function normalizeCountRow(row, fields) {
  const normalized = {};
  for (const field of fields) {
    const value = Number(row?.[field]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw authorityError(
        `Lark notification Remote row requires non-negative integer ${field}`,
        'LARK_NOTIFICATION_REMOTE_ROLLOUT_D1_RESPONSE_INVALID',
        { fieldName: field },
      );
    }
    normalized[field] = value;
  }
  return Object.freeze(normalized);
}

function authorityError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationDormantWorkAuthorityError';
  error.code = code;
  error.details = details;
  return error;
}
