import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../../shared/src/date/date-time.js';

export const CUSTOMER_TIKTOK_LARK_IMPORT_MODE_ENV = 'MKT_CUSTOMER_TIKTOK_LARK_IMPORT_MODE';
export const CUSTOMER_TIKTOK_LARK_IMPORT_MODE = 'IMPORT_EXACT_TIKTOK_20260827_DEV_SNAPSHOT';
export const CUSTOMER_TIKTOK_LARK_SNAPSHOT_ID = 'tiktok-chemistry_k-20260827-2053-v1';
export const CUSTOMER_TIKTOK_LARK_BATCH_SIZE = 50;
export const CUSTOMER_TIKTOK_LARK_FINGERPRINTS_ENV =
  'MKT_CUSTOMER_TIKTOK_LARK_BATCH_FINGERPRINTS_JSON';

const METRIC_DATE = '2026-08-27';
const ACCOUNT_KEY = 'chemistry_k';
const CONTENT_KEY_PREFIX = 'tiktok:chemistry_k:';
const DAILY_KEY_PATTERN = /^tiktok:chemistry_k:([^:]+):2026-08-27$/u;
const CONTRACTS = Object.freeze({
  mktContent: contract({
    keyField: 'content_key',
    totalRows: 2,
    allowedFields: [
      'content_key', 'platform', 'account_id', 'external_content_id', 'content_type',
      'published_at', 'caption', 'content_url', 'thumbnail_url', 'duration_seconds',
    ],
  }),
  mktContentDaily: contract({
    keyField: 'content_daily_key',
    totalRows: 2_053,
    allowedFields: [
      'content_daily_key', 'platform', 'account_id', 'external_content_id', 'metric_date',
      'views', 'likes', 'comments', 'shares', 'unique_viewers', 'avg_watch_time_seconds',
      'total_watch_time_seconds', 'completion_rate',
    ],
  }),
  mktAccounts: contract({
    keyField: 'account_key',
    totalRows: 1,
    allowedFields: ['account_key', 'last_sync_at'],
  }),
});

export async function importCustomerTikTokLarkSnapshot(input = {}) {
  const body = requireObject(input.body, 'body');
  const repository = requireObject(input.repository, 'repository');
  const syncEngine = requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine');
  const tables = requireObject(input.tables, 'tables');
  const fingerprints = requireObject(input.allowedFingerprints, 'allowedFingerprints');
  requireExact(body.snapshotId, CUSTOMER_TIKTOK_LARK_SNAPSHOT_ID, 'snapshotId');
  const tableKey = requireText(body.tableKey, 'tableKey');
  const scope = CONTRACTS[tableKey];
  if (!scope) throw invalid('Customer TikTok snapshot table is outside the exact allowlist', { tableKey });
  requireExactInteger(body.totalRows, scope.totalRows, 'totalRows');
  requireExactInteger(body.batchCount, scope.batchCount, 'batchCount');
  const batchIndex = boundedInteger(body.batchIndex, 'batchIndex', 0, scope.batchCount - 1);
  const rows = requireArray(body.rows, 'rows');
  const expectedRows = batchIndex === scope.batchCount - 1
    ? scope.totalRows - (batchIndex * CUSTOMER_TIKTOK_LARK_BATCH_SIZE)
    : CUSTOMER_TIKTOK_LARK_BATCH_SIZE;
  requireExactInteger(rows.length, expectedRows, 'rows.length');
  if (JSON.stringify(rows).length > 64 * 1024) throw invalid('Customer TikTok snapshot batch exceeds payload ceiling');
  validateRows(rows, scope, tableKey);

  const allowed = requireArray(fingerprints[tableKey], `allowedFingerprints.${tableKey}`);
  requireExactInteger(allowed.length, scope.batchCount, 'allowed fingerprint count');
  const expectedFingerprint = requireText(allowed[batchIndex], 'expectedFingerprint');
  requireExact(body.batchFingerprint, expectedFingerprint, 'batchFingerprint');
  requireExact(await (input.createFingerprint ?? createStableFingerprint)(rows), expectedFingerprint,
    'observedFingerprint');

  const plan = await syncEngine.planByKey({
    repository,
    tableId: requireText(tables[tableKey], `tables.${tableKey}`),
    keyField: scope.keyField,
    rows,
  });
  if (Number(plan?.duplicateInputRows ?? 0) !== 0) throw invalid('Customer TikTok snapshot repeats a stable key');
  if (Number(plan?.updateRows?.length ?? 0) > 0 && tableKey !== 'mktAccounts') {
    throw invalid('Customer TikTok snapshot would overwrite an existing Business row', { tableKey, batchIndex });
  }
  const result = await syncEngine.executePlan(plan);
  const reconciliation = normalizeResult(result, expectedRows, tableKey, batchIndex);
  return Object.freeze({
    ok: true,
    mode: 'customer_tiktok_exact_snapshot_import',
    operationId: body.operationId ?? null,
    sourceSummary: Object.freeze({
      snapshotId: CUSTOMER_TIKTOK_LARK_SNAPSHOT_ID,
      metricDate: METRIC_DATE,
      tableKey,
      batchIndex,
      batchCount: scope.batchCount,
      totalRows: scope.totalRows,
      batchRows: expectedRows,
      batchFingerprint: expectedFingerprint,
    }),
    reconciliation: Object.freeze([reconciliation]),
  });
}

export function listCustomerTikTokLarkImportContracts() { return CONTRACTS; }

function validateRows(rows, scope, tableKey) {
  const allowed = new Set(scope.allowedFields);
  const keys = new Set();
  const expectedDate = dateOnlyInTimeZoneToEpochMilliseconds(METRIC_DATE, 'Asia/Bangkok', {
    label: 'Customer TikTok metric date',
  });
  for (const row of rows) {
    requireObject(row, `${tableKey} row`);
    for (const field of Object.keys(row)) {
      if (!allowed.has(field)) throw invalid('Customer TikTok row contains a field outside the allowlist', { tableKey, field });
    }
    const key = requireText(row[scope.keyField], scope.keyField);
    if (keys.has(key)) throw invalid('Customer TikTok batch repeats a stable key', { tableKey });
    keys.add(key);
    if (tableKey === 'mktAccounts') {
      requireExact(key, 'tiktok:chemistry_k', 'account_key');
      requireExact(row.last_sync_at, expectedDate, 'last_sync_at');
      continue;
    }
    requireExact(row.platform, 'tiktok', 'platform');
    requireExact(row.account_id, ACCOUNT_KEY, 'account_id');
    const externalId = requireText(row.external_content_id, 'external_content_id');
    if (tableKey === 'mktContent') requireExact(key, `${CONTENT_KEY_PREFIX}${externalId}`, 'content_key');
    else {
      const match = DAILY_KEY_PATTERN.exec(key);
      if (!match) throw invalid('Customer TikTok Daily stable key is invalid');
      requireExact(match[1], externalId, 'external_content_id');
      requireExact(row.metric_date, expectedDate, 'metric_date');
    }
  }
}

function contract(input) {
  return Object.freeze({
    ...input,
    allowedFields: Object.freeze(input.allowedFields),
    batchCount: Math.ceil(input.totalRows / CUSTOMER_TIKTOK_LARK_BATCH_SIZE),
  });
}

function normalizeResult(result, expected, tableKey, batchIndex) {
  const created = nonNegativeInteger(result?.created ?? 0, 'created');
  const updated = nonNegativeInteger(result?.updated ?? 0, 'updated');
  const skipped = nonNegativeInteger(result?.skipped ?? 0, 'skipped');
  const duplicateInputRows = nonNegativeInteger(result?.duplicateInputRows ?? 0, 'duplicateInputRows');
  if (created + updated + skipped !== expected || duplicateInputRows !== 0) {
    throw invalid('Customer TikTok Lark reconciliation is incomplete', {
      tableKey, batchIndex, expected, created, updated, skipped, duplicateInputRows,
    });
  }
  return Object.freeze({ tableKey, batchIndex, expected, created, updated, skipped, duplicateInputRows });
}

function invalid(message, details = {}) {
  return permanentError(message, { code: 'CUSTOMER_TIKTOK_LARK_IMPORT_INVALID', details });
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${fieldName} is required`);
  return value;
}
function requireMethods(value, methods, fieldName) {
  const object = requireObject(value, fieldName);
  for (const method of methods) if (typeof object[method] !== 'function') throw invalid(`${fieldName}.${method} is required`);
  return object;
}
function requireArray(value, fieldName) { if (!Array.isArray(value)) throw invalid(`${fieldName} must be an array`); return value; }
function requireText(value, fieldName) { if (typeof value !== 'string' || value.trim() === '') throw invalid(`${fieldName} is required`); return value.trim(); }
function requireExact(observed, expected, fieldName) { if (observed !== expected) throw invalid(`${fieldName} does not match the sealed snapshot`); }
function requireExactInteger(observed, expected, fieldName) { if (!Number.isSafeInteger(observed) || observed !== expected) throw invalid(`${fieldName} does not match the sealed snapshot`); }
function boundedInteger(value, fieldName, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) throw invalid(`${fieldName} is outside the sealed snapshot`); return value; }
function nonNegativeInteger(value, fieldName) { if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${fieldName} must be non-negative`); return value; }
