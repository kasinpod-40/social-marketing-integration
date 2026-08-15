export const MKT_CONTENT_DAILY_RETENTION_VERSION = 'mkt-content-daily-retention-preview-v2';
export const MKT_CONTENT_DAILY_RETENTION_DAYS = 30;
export const MKT_CONTENT_DAILY_MAX_RETAINED_RECORDS = 10000;

export function planMktContentDailyRetention(input = {}) {
  const records = requireArray(input.records, 'records');
  const requestedRetentionDays = positiveInteger(input.retentionDays ?? MKT_CONTENT_DAILY_RETENTION_DAYS, 'retentionDays');
  const maxRetainedRecords = positiveInteger(
    input.maxRetainedRecords ?? MKT_CONTENT_DAILY_MAX_RETAINED_RECORDS,
    'maxRetainedRecords',
  );
  const normalized = records.map(normalizeRecord);
  const stableKeys = new Set();
  for (const row of normalized) {
    if (!row.managed) continue;
    if (stableKeys.has(row.stableKey)) throw retentionError(
      'MKT_Content_Daily contains a duplicate stable key',
      'MKT_CONTENT_DAILY_RETENTION_DUPLICATE_KEY',
    );
    stableKeys.add(row.stableKey);
  }
  const managed = normalized.filter((row) => row.managed);
  const maxMetricDate = managed.reduce((max, row) => Math.max(max, row.metricDate), 0);
  const latestByContent = new Map();
  for (const row of managed) {
    const current = latestByContent.get(row.contentIdentity);
    if (!current || compareLatest(current, row) < 0) latestByContent.set(row.contentIdentity, row);
  }
  let effectiveRetentionDays = requestedRetentionDays;
  let selection = selectRows(normalized, latestByContent, maxMetricDate, effectiveRetentionDays);
  while (effectiveRetentionDays > 1 && selection.retained.length > maxRetainedRecords) {
    effectiveRetentionDays -= 1;
    selection = selectRows(normalized, latestByContent, maxMetricDate, effectiveRetentionDays);
  }
  if (selection.retained.length > maxRetainedRecords) {
    throw retentionError(
      'Latest-per-content and unmanaged rows exceed the reviewed retention bound',
      'MKT_CONTENT_DAILY_RETENTION_BOUND_UNSATISFIABLE',
    );
  }
  const { retained, deletes, cutoffMetricDate } = selection;
  return Object.freeze({
    contractVersion: MKT_CONTENT_DAILY_RETENTION_VERSION,
    requestedRetentionDays,
    effectiveRetentionDays,
    maxRetainedRecords,
    recordCount: records.length,
    managedRecordCount: managed.length,
    unmanagedPreservedCount: normalized.length - managed.length,
    contentIdentityCount: latestByContent.size,
    maxMetricDate,
    cutoffMetricDate,
    retainedCount: retained.length,
    deleteCandidateCount: deletes.length,
    retained: Object.freeze(retained),
    deletes: Object.freeze(deletes),
  });
}

function selectRows(normalized, latestByContent, maxMetricDate, retentionDays) {
  const cutoffMetricDate = maxMetricDate === 0
    ? 0
    : startOfBangkokDay(maxMetricDate) - ((retentionDays - 1) * 86_400_000);
  const retained = [];
  const deletes = [];
  for (const row of normalized) {
    if (!row.managed) {
      retained.push({ ...row, reason: row.reason });
      continue;
    }
    const latest = latestByContent.get(row.contentIdentity);
    if (row.metricDate >= cutoffMetricDate) retained.push({ ...row, reason: 'within_bounded_completed_days' });
    else if (latest?.recordId === row.recordId) retained.push({ ...row, reason: 'latest_for_content' });
    else deletes.push({ recordId: row.recordId, stableKey: row.stableKey, metricDate: row.metricDate });
  }
  return Object.freeze({ retained: Object.freeze(retained), deletes: Object.freeze(deletes), cutoffMetricDate });
}

function normalizeRecord(record) {
  const recordId = optionalText(record?.recordId ?? record?.record_id);
  if (!recordId) return unmanaged(record, 'missing_record_id');
  const fields = record?.fields && typeof record.fields === 'object' ? record.fields : {};
  const stableKey = readText(fields.content_daily_key);
  const platform = readText(fields.platform);
  const accountId = readText(fields.account_id);
  const externalContentId = readText(fields.external_content_id);
  const metricDate = readEpoch(fields.metric_date);
  if (!stableKey || !platform || !accountId || !externalContentId || !metricDate) {
    return Object.freeze({
      managed: false, recordId, stableKey, metricDate, contentIdentity: null,
      reason: 'missing_exact_identity_or_metric_date',
    });
  }
  return Object.freeze({
    managed: true,
    recordId,
    stableKey,
    metricDate,
    contentIdentity: `${platform}\u0000${accountId}\u0000${externalContentId}`,
  });
}

function unmanaged(record, reason) {
  return Object.freeze({
    managed: false,
    recordId: optionalText(record?.recordId ?? record?.record_id),
    stableKey: null,
    metricDate: null,
    contentIdentity: null,
    reason,
  });
}

function compareLatest(left, right) {
  if (left.metricDate !== right.metricDate) return left.metricDate - right.metricDate;
  return left.recordId.localeCompare(right.recordId);
}

function startOfBangkokDay(epoch) {
  const shifted = new Date(epoch + (7 * 3_600_000));
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - (7 * 3_600_000);
}

function readText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value) && value.length === 1) return readText(value[0]);
  if (value && typeof value === 'object') return readText(value.text ?? value.name ?? value.value);
  return null;
}

function readEpoch(value) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return Math.trunc(number);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function retentionError(message, code) {
  const error = new Error(message); error.code = code; return error;
}
