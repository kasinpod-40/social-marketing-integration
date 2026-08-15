export const MKT_CONTENT_DAILY_RETENTION_VERSION = 'mkt-content-daily-retention-v3';
export const MKT_CONTENT_DAILY_RETENTION_DAYS = 30;
export const MKT_CONTENT_DAILY_MAX_RETAINED_RECORDS = 10000;

/**
 * Bounded compatibility-cache sweep. D1 remains historical authority; this path mutates only exact
 * Lark Record IDs selected by the reviewed planner and refuses to run beside an active sync lock.
 */
export async function runMktContentDailyRetention(input = {}) {
  const client = requireRetentionClient(input.client);
  const db = requireRetentionDb(input.db);
  const tableId = requiredText(input.tableId, 'tableId');
  const deferredPlatforms = input.deferredPlatforms ?? [];
  await assertNoActiveSyncLocks(db, input.now?.() ?? Date.now());
  const records = await client.listRecords({ tableId, includeRecordMetadata: false });
  const plan = planMktContentDailyRetention({
    records,
    deferredPlatforms,
    retentionDays: input.retentionDays,
    maxRetainedRecords: input.maxRetainedRecords,
  });
  const deferred = new Set(plan.deferredPlatforms);
  if (plan.deletes.some((row) => deferred.has(row.platform))) {
    throw retentionError(
      'Retention plan contains a deferred platform row',
      'MKT_CONTENT_DAILY_RETENTION_PROTECTED_DELETE',
    );
  }
  let deleted = 0;
  if (plan.deletes.length > 0) {
    const result = await client.batchDeleteRecords({
      tableId,
      recordIds: plan.deletes.map((row) => row.recordId),
      beforeChunk: () => assertNoActiveSyncLocks(db, input.now?.() ?? Date.now()),
    });
    deleted = Number(result?.deleted ?? 0);
    if (deleted !== plan.deleteCandidateCount) throw retentionError(
      'Retention delete count did not match the exact plan',
      'MKT_CONTENT_DAILY_RETENTION_DELETE_COUNT_MISMATCH',
    );
  }
  const after = await client.listRecords({ tableId, includeRecordMetadata: false });
  const afterIds = new Set(after.map((record) => optionalText(record?.recordId ?? record?.record_id)));
  if (after.length !== plan.retainedCount
    || plan.deletes.some((row) => afterIds.has(row.recordId))
    || plan.retained.some((row) => !afterIds.has(row.recordId))) {
    throw retentionError(
      'Retention readback did not converge to the exact retained identity set',
      'MKT_CONTENT_DAILY_RETENTION_READBACK_FAILED',
    );
  }
  return Object.freeze({
    status: 'completed',
    contractVersion: plan.contractVersion,
    recordsBefore: plan.recordCount,
    recordsAfter: after.length,
    retained: plan.retainedCount,
    deleted,
    effectiveRetentionDays: plan.effectiveRetentionDays,
    deferredPlatforms: plan.deferredPlatforms,
    d1Mutations: 0,
    recordCreates: 0,
    recordUpdates: 0,
  });
}

export function planMktContentDailyRetention(input = {}) {
  const records = requireArray(input.records, 'records');
  const requestedRetentionDays = positiveInteger(input.retentionDays ?? MKT_CONTENT_DAILY_RETENTION_DAYS, 'retentionDays');
  const maxRetainedRecords = positiveInteger(
    input.maxRetainedRecords ?? MKT_CONTENT_DAILY_MAX_RETAINED_RECORDS,
    'maxRetainedRecords',
  );
  const deferredPlatforms = normalizeDeferredPlatforms(input.deferredPlatforms ?? []);
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
  let selection = selectRows(
    normalized, latestByContent, maxMetricDate, effectiveRetentionDays, deferredPlatforms,
  );
  while (effectiveRetentionDays > 1 && selection.retained.length > maxRetainedRecords) {
    effectiveRetentionDays -= 1;
    selection = selectRows(
      normalized, latestByContent, maxMetricDate, effectiveRetentionDays, deferredPlatforms,
    );
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
    deferredPlatforms: Object.freeze([...deferredPlatforms].sort()),
    deferredPlatformPreservedCount: retained.filter((row) => row.reason === 'deferred_platform').length,
    contentIdentityCount: latestByContent.size,
    maxMetricDate,
    cutoffMetricDate,
    retainedCount: retained.length,
    deleteCandidateCount: deletes.length,
    retained: Object.freeze(retained),
    deletes: Object.freeze(deletes),
  });
}

function selectRows(normalized, latestByContent, maxMetricDate, retentionDays, deferredPlatforms) {
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
    if (deferredPlatforms.has(row.platform)) retained.push({ ...row, reason: 'deferred_platform' });
    else if (row.metricDate >= cutoffMetricDate) retained.push({ ...row, reason: 'within_bounded_completed_days' });
    else if (latest?.recordId === row.recordId) retained.push({ ...row, reason: 'latest_for_content' });
    else deletes.push({
      recordId: row.recordId,
      stableKey: row.stableKey,
      platform: row.platform,
      accountId: row.accountId,
      externalContentId: row.externalContentId,
      metricDate: row.metricDate,
    });
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
    platform: platform.toLowerCase(),
    accountId,
    externalContentId,
    metricDate,
    contentIdentity: `${platform.toLowerCase()}\u0000${accountId}\u0000${externalContentId}`,
  });
}

function unmanaged(record, reason) {
  return Object.freeze({
    managed: false,
    recordId: optionalText(record?.recordId ?? record?.record_id),
    stableKey: null,
    platform: null,
    accountId: null,
    externalContentId: null,
    metricDate: null,
    contentIdentity: null,
    reason,
  });
}

function normalizeDeferredPlatforms(values) {
  if (!Array.isArray(values)) throw new TypeError('deferredPlatforms must be an array');
  const normalized = values.map((value) => {
    const platform = optionalText(value)?.toLowerCase();
    if (!platform) throw new TypeError('deferredPlatforms must contain non-empty strings');
    return platform;
  });
  return new Set(normalized);
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

async function assertNoActiveSyncLocks(db, now) {
  const result = await db.prepare(
    'SELECT COUNT(*) AS active_locks FROM sync_locks WHERE expires_at > ?',
  ).bind(Number(now)).first();
  if (Number(result?.active_locks ?? 0) > 0) throw retentionError(
    'MKT_Content_Daily retention is blocked by an active sync lock',
    'MKT_CONTENT_DAILY_RETENTION_ACTIVE_LOCK',
  );
}

function requireRetentionClient(value) {
  if (!value || typeof value.listRecords !== 'function' || typeof value.batchDeleteRecords !== 'function') {
    throw new TypeError('MKT_Content_Daily retention requires a Lark client');
  }
  return value;
}

function requireRetentionDb(value) {
  if (!value || typeof value.prepare !== 'function') {
    throw new TypeError('MKT_Content_Daily retention requires D1');
  }
  return value;
}

function requiredText(value, fieldName) {
  const result = optionalText(value);
  if (!result) throw new TypeError(`${fieldName} is required`);
  return result;
}
