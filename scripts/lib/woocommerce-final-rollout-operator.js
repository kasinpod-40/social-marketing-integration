import { createHash } from 'node:crypto';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { createStableQueueOperationBody } from '../../packages/application/src/jobs/queue-operation.js';
import {
  WOOCOMMERCE_D1_TABLE_CONTRACTS,
  WOOCOMMERCE_LARK_TABLES,
} from '../../packages/application/src/commerce/woocommerce-commerce-model.js';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';

export const WOOCOMMERCE_FINAL_CONTRACT_VERSION = 'woocommerce_final_rollout_v1';
export const WOOCOMMERCE_FINAL_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT',
  value: 'EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT',
});
export const WOOCOMMERCE_FINAL_FLAGS = Object.freeze([
  'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
  'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
  'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
  'MKT_WOOCOMMERCE_REPORT_READ_ENABLED',
  'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED',
  'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
]);

const TABLE_BINDINGS = Object.freeze([
  tableBinding('rawCommerceStores', 'RAW_Commerce_Stores', 'raw_commerce_stores'),
  tableBinding('rawCommerceOrders', 'RAW_Commerce_Orders', 'raw_commerce_orders'),
  tableBinding('rawCommerceOrderItems', 'RAW_Commerce_Order_Items', 'raw_commerce_order_items'),
  tableBinding('rawCommerceProducts', 'RAW_Commerce_Products', 'raw_commerce_products'),
  tableBinding('rawCommerceProductVariations', 'RAW_Commerce_Product_Variations', 'raw_commerce_product_variations'),
  tableBinding('rawCommerceCategories', 'RAW_Commerce_Categories', 'raw_commerce_categories'),
  tableBinding('rawCommerceCustomers', 'RAW_Commerce_Customers', 'raw_commerce_customers'),
  tableBinding('rawCommerceCoupons', 'RAW_Commerce_Coupons', 'raw_commerce_coupons'),
  tableBinding('rawCommerceRefunds', 'RAW_Commerce_Refunds', 'raw_commerce_refunds'),
  tableBinding('mktCommerceOrders', 'MKT_Commerce_Orders', 'commerce_order_state'),
  tableBinding('mktCommerceProducts', 'MKT_Commerce_Products', 'commerce_product_state'),
  tableBinding('mktCommerceCustomers', 'MKT_Commerce_Customers', 'commerce_customer_aggregates'),
  tableBinding('mktCommerceDaily', 'MKT_Commerce_Daily', 'commerce_daily_sales_facts'),
  tableBinding('mktCommerceProductDaily', 'MKT_Commerce_Product_Daily', 'commerce_product_daily_facts'),
]);

export function parseWooCommerceFinalArgs(args = []) {
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') execute = true;
    else throw operatorError(`Unknown WooCommerce final rollout argument: ${arg}`, 'WOOCOMMERCE_FINAL_ARGUMENT_INVALID');
  }
  return Object.freeze({ execute });
}

export function assertWooCommerceFinalConfirmation(env = {}) {
  if (env[WOOCOMMERCE_FINAL_CONFIRMATION.envName] !== WOOCOMMERCE_FINAL_CONFIRMATION.value) {
    throw operatorError(
      `WooCommerce final rollout requires ${WOOCOMMERCE_FINAL_CONFIRMATION.envName}=${WOOCOMMERCE_FINAL_CONFIRMATION.value}`,
      'WOOCOMMERCE_FINAL_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function createWooCommerceLarkSchemaContract() {
  const byTableKey = new Map(WOOCOMMERCE_LARK_TABLES.map((item) => [item.tableKey, item]));
  return Object.freeze(TABLE_BINDINGS.map((binding) => {
    const lark = byTableKey.get(binding.tableKey);
    const d1 = WOOCOMMERCE_D1_TABLE_CONTRACTS[binding.d1Table];
    if (!lark || !d1 || lark.keyField !== d1.keyField) {
      throw operatorError('WooCommerce Lark/D1 schema mapping is inconsistent', 'WOOCOMMERCE_FINAL_SCHEMA_CONTRACT_INVALID', { tableKey: binding.tableKey });
    }
    const columns = [d1.keyField, ...d1.columns.filter((column) => column !== d1.keyField)];
    return Object.freeze({
      ...binding,
      envName: LARK_TABLE_ENV[binding.tableKey],
      keyField: d1.keyField,
      fields: Object.freeze(columns.map((fieldName) => Object.freeze({
        fieldName,
        type: inferLarkFieldType(fieldName, fieldName === d1.keyField),
      }))),
    });
  }));
}

export function buildWooCommerceConfigWindows(input = {}) {
  const source = requireText(input.configText, 'configText');
  const tableIds = requireObject(input.tableIds, 'tableIds');
  let safe = source;
  for (const flag of WOOCOMMERCE_FINAL_FLAGS) safe = setJsonStringValue(safe, flag, 'false');
  for (const contract of createWooCommerceLarkSchemaContract()) {
    safe = setJsonStringValue(safe, contract.envName, requireText(tableIds[contract.tableKey], contract.tableKey));
  }
  const uat = setFlags(safe, {
    MKT_CONNECTOR_WOOCOMMERCE_ENABLED: true,
    MKT_WOOCOMMERCE_D1_WRITE_ENABLED: true,
    MKT_WOOCOMMERCE_LARK_WRITE_ENABLED: true,
    MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED: true,
  });
  const scheduled = setFlags(safe, {
    MKT_CONNECTOR_WOOCOMMERCE_ENABLED: true,
    MKT_WOOCOMMERCE_D1_WRITE_ENABLED: true,
    MKT_WOOCOMMERCE_LARK_WRITE_ENABLED: true,
    MKT_SCHEDULE_WOOCOMMERCE_ENABLED: true,
  });
  return Object.freeze({
    safe,
    uat,
    scheduled,
    safeSha256: sha256(safe),
    uatSha256: sha256(uat),
    scheduledSha256: sha256(scheduled),
    safeTrueFlags: Object.freeze(readTrueFlags(safe)),
    uatTrueFlags: Object.freeze(readTrueFlags(uat)),
    scheduledTrueFlags: Object.freeze(readTrueFlags(scheduled)),
  });
}

export function buildWooCommerceFinalJob(input = {}) {
  const fullReconciliation = input.fullReconciliation === true;
  const body = {
    schemaVersion: 1,
    type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC,
    trigger: input.trigger ?? 'manual_uat',
    fullReconciliation,
  };
  if (input.modifiedAfter !== null && input.modifiedAfter !== undefined) {
    body.modifiedAfter = requireTimestamp(input.modifiedAfter, 'modifiedAfter');
  }
  return createStableQueueOperationBody(body, {
    operationId: requireOperationId(input.operationId),
    originalRequestedAt: requireTimestamp(input.requestedAt, 'requestedAt'),
  });
}

export function buildWooCommerceFinalSnapshotSql(input = {}) {
  const accountKey = sqlText(requireText(input.accountKey, 'accountKey'));
  const operationId = sqlText(requireOperationId(input.operationId));
  const workKey = sqlText(`woocommerce:${requireOperationId(input.operationId)}`);
  const syncRunId = sqlText(`woocommerce:${requireOperationId(input.operationId)}`);
  const counts = TABLE_BINDINGS.map(({ d1Table }) => (
    `(SELECT COUNT(*) FROM ${d1Table} WHERE account_key = ${accountKey}) AS ${d1Table}`
  )).join(', ');
  return compactSql(`
    SELECT
      (SELECT status FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_status,
      (SELECT finished_at FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_finished_at,
      (SELECT error_code FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_error_code,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key = ${workKey}) AS work_lifecycle_status,
      (SELECT completed_at FROM sync_work_runs WHERE work_key = ${workKey}) AS work_completed_at,
      (SELECT completion_json FROM sync_work_runs WHERE work_key = ${workKey}) AS completion_json,
      (SELECT complete FROM sync_work_phases WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1') AS phase_complete,
      (SELECT state_json FROM sync_work_phases WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1') AS state_json,
      (SELECT COUNT(*) FROM sync_locks WHERE owner_id = ${syncRunId} AND expires_at > unixepoch('now') * 1000) AS active_lock_count,
      (SELECT COUNT(*) FROM queue_operation_attempts WHERE operation_id = ${operationId} AND work_key = ${workKey}) AS queue_operation_attempts,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE sync_run_id = ${syncRunId}) AS coverage_run_count,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE sync_run_id = ${syncRunId} AND (failed_rows <> 0 OR status NOT IN ('complete','no_data_confirmed','revisable'))) AS invalid_coverage_count,
      ${counts};
  `);
}

export function buildWooCommerceWatermarkSql(accountKey) {
  const account = sqlText(requireText(accountKey, 'accountKey'));
  return compactSql(`SELECT
    (SELECT MAX(source_modified_at) FROM commerce_order_state WHERE account_key = ${account}) AS order_watermark,
    (SELECT MAX(source_modified_at) FROM commerce_product_state WHERE account_key = ${account}) AS product_watermark;`);
}

export function normalizeWooCommerceFinalSnapshot(value = {}) {
  const counts = Object.fromEntries(TABLE_BINDINGS.map(({ d1Table }) => [d1Table, count(value[d1Table])]));
  return Object.freeze({
    syncRunStatus: optionalText(value.sync_run_status),
    syncRunFinishedAt: nullableNumber(value.sync_run_finished_at),
    syncRunErrorCode: optionalText(value.sync_run_error_code),
    workLifecycleStatus: optionalText(value.work_lifecycle_status),
    workCompletedAt: nullableNumber(value.work_completed_at),
    completion: parseNullableJson(value.completion_json),
    phaseComplete: Number(value.phase_complete ?? 0) === 1,
    state: parseNullableJson(value.state_json),
    activeLockCount: count(value.active_lock_count),
    queueOperationAttempts: count(value.queue_operation_attempts),
    coverageRunCount: count(value.coverage_run_count),
    invalidCoverageCount: count(value.invalid_coverage_count),
    counts: Object.freeze(counts),
  });
}

export function classifyWooCommerceFinalCompletion(snapshotInput, options = {}) {
  const snapshot = normalizeWooCommerceFinalSnapshot(snapshotInput);
  const expectedCoverage = 6;
  const state = snapshot.state ?? {};
  const full = options.fullReconciliation === true;
  const datasets = state.datasetCounts ?? {};
  const datasetsComplete = ['store', 'orders', 'products', 'categories', 'customers', 'coupons']
    .every((key) => !full || Number(datasets[key]?.expectedRows ?? 0) === Number(datasets[key]?.sourceRows ?? -1));
  const complete = snapshot.syncRunStatus === 'success'
    && snapshot.syncRunFinishedAt !== null
    && snapshot.syncRunErrorCode === null
    && snapshot.workLifecycleStatus === 'completed'
    && snapshot.workCompletedAt !== null
    && snapshot.phaseComplete === true
    && snapshot.activeLockCount === 0
    && snapshot.coverageRunCount === expectedCoverage
    && snapshot.invalidCoverageCount === 0
    && Number(state.datasetIndex ?? -1) === 6
    && Number(state.counts?.failedRows ?? -1) === 0
    && datasetsComplete;
  return Object.freeze({ complete, snapshot, reason: complete ? 'woocommerce_complete' : 'incomplete_or_invalid' });
}

export function compareWooCommerceRerun(beforeInput, afterInput) {
  const before = normalizeWooCommerceFinalSnapshot(beforeInput);
  const after = normalizeWooCommerceFinalSnapshot(afterInput);
  if (after.queueOperationAttempts < before.queueOperationAttempts + 1) {
    throw operatorError('WooCommerce rerun Queue attempt was not observed', 'WOOCOMMERCE_FINAL_RERUN_ATTEMPT_MISSING');
  }
  for (const table of Object.keys(before.counts)) {
    if (before.counts[table] !== after.counts[table]) {
      throw operatorError('WooCommerce rerun changed Business row counts', 'WOOCOMMERCE_FINAL_RERUN_COUNT_DRIFT', { table, before: before.counts[table], after: after.counts[table] });
    }
  }
  if (after.coverageRunCount !== before.coverageRunCount || after.invalidCoverageCount !== 0) {
    throw operatorError('WooCommerce rerun changed Coverage or produced invalid Coverage', 'WOOCOMMERCE_FINAL_RERUN_COVERAGE_DRIFT');
  }
  return Object.freeze({ accepted: true, businessCountDrift: false, coverageCountDrift: false });
}

export function compareWooCommerceParity(input = {}) {
  const d1 = requireObject(input.d1Counts, 'd1Counts');
  const lark = requireObject(input.larkCounts, 'larkCounts');
  const rows = [];
  for (const binding of TABLE_BINDINGS) {
    const d1Count = count(d1[binding.d1Table]);
    const larkCount = count(lark[binding.tableKey]);
    if (d1Count !== larkCount) {
      throw operatorError('WooCommerce D1/Lark parity mismatch', 'WOOCOMMERCE_FINAL_PARITY_MISMATCH', { tableKey: binding.tableKey, d1Table: binding.d1Table, d1Count, larkCount });
    }
    rows.push(Object.freeze({ tableKey: binding.tableKey, d1Table: binding.d1Table, count: d1Count }));
  }
  return Object.freeze({ accepted: true, tableCount: rows.length, rows: Object.freeze(rows) });
}

export function safeWooCommerceFinalEvidence(value) {
  return sanitize(value);
}
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function listWooCommerceTableBindings() { return TABLE_BINDINGS; }

function tableBinding(tableKey, tableName, d1Table) { return Object.freeze({ tableKey, tableName, d1Table }); }
function inferLarkFieldType(fieldName, primary) {
  if (primary) return 1;
  return /(?:_at|_micros|_count|_quantity|_rows|_order|_decimals|_attempts)$/u.test(fieldName)
    || new Set(['quantity', 'manage_stock', 'individual_use', 'free_shipping', 'menu_order', 'product_count', 'recognized_orders', 'provisional_orders', 'cancelled_orders', 'failed_orders', 'refunded_orders']).has(fieldName)
    ? 2 : 1;
}
function setFlags(text, values) { let result = text; for (const [name, value] of Object.entries(values)) result = setJsonStringValue(result, name, value ? 'true' : 'false'); return result; }
function setJsonStringValue(text, name, value) {
  const pattern = new RegExp(`("${escapeRegExp(name)}"\\s*:\\s*)"[^"]*"`, 'u');
  if (!pattern.test(text)) throw operatorError(`Wrangler config is missing ${name}`, 'WOOCOMMERCE_FINAL_CONFIG_FIELD_MISSING', { name });
  return text.replace(pattern, `$1"${String(value).replaceAll('"', '\\"')}"`);
}
function readTrueFlags(text) { return [...text.matchAll(/"(MKT_[A-Z0-9_]+_ENABLED)"\s*:\s*"true"/gu)].map((match) => match[1]).sort(); }
function requireOperationId(value) { const text = requireText(value, 'operationId').toLowerCase(); if (!/^[a-z0-9][a-z0-9._:-]{7,127}$/u.test(text)) throw operatorError('WooCommerce operationId is invalid', 'WOOCOMMERCE_FINAL_OPERATION_ID_INVALID'); return text; }
function requireTimestamp(value, fieldName) { const number = typeof value === 'number' ? value : Date.parse(value); if (!Number.isSafeInteger(number) || number < Date.UTC(2020, 0, 1)) throw operatorError(`${fieldName} is invalid`, 'WOOCOMMERCE_FINAL_TIMESTAMP_INVALID'); return number; }
function count(value) { const number = Number(value ?? 0); if (!Number.isSafeInteger(number) || number < 0) throw operatorError('WooCommerce count is invalid', 'WOOCOMMERCE_FINAL_COUNT_INVALID'); return number; }
function nullableNumber(value) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function optionalText(value) { if (value === null || value === undefined || value === '') return null; return String(value); }
function parseNullableJson(value) { if (value === null || value === undefined || value === '') return null; if (typeof value === 'object') return value; try { return JSON.parse(String(value)); } catch { throw operatorError('WooCommerce evidence JSON is invalid', 'WOOCOMMERCE_FINAL_JSON_INVALID'); } }
function requireObject(value, fieldName) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw operatorError(`${fieldName} must be an object`, 'WOOCOMMERCE_FINAL_CONTRACT_INVALID'); return value; }
function requireText(value, fieldName) { if (typeof value !== 'string' || value.trim() === '') throw operatorError(`${fieldName} is required`, 'WOOCOMMERCE_FINAL_CONTRACT_INVALID'); return value.trim(); }
function sqlText(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function compactSql(value) { return value.replace(/\s+/gu, ' ').trim(); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:secret|token|password|authorization|consumer_key|consumer_secret)/iu.test(key)) continue;
    result[key] = sanitize(nested);
  }
  return result;
}
function operatorError(message, code, details = undefined) { const error = new Error(message); error.name = 'WooCommerceFinalRolloutError'; error.code = code; error.details = details; return error; }
