import { createHash } from 'node:crypto';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { createStableQueueOperationBody } from '../../packages/application/src/jobs/queue-operation.js';
import {
  WOOCOMMERCE_D1_TABLE_CONTRACTS,
  WOOCOMMERCE_LARK_TABLES,
} from '../../packages/application/src/commerce/woocommerce-commerce-model.js';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

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
export const WOOCOMMERCE_ORDER_STATUS_OPTIONS = Object.freeze([
  'pending',
  'processing',
  'on-hold',
  'completed',
  'cancelled',
  'refunded',
  'failed',
  'trash',
  'unknown',
]);

const ENABLED_FLAG = /^MKT_[A-Z0-9_]+_ENABLED$/u;
const EXACT_RESUME_ERROR_CODES = new Set([
  'WOOCOMMERCE_D1_READ_FAILED',
  'LARK_PREFLIGHT_FAILED',
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
      fields: Object.freeze(columns.map((fieldName) => createLarkFieldContract(
        binding,
        fieldName,
        fieldName === d1.keyField,
      ))),
    });
  }));
}

export function buildWooCommerceLarkSelectOptionRepair(input = {}) {
  const contractField = requireObject(input.contractField, 'contractField');
  const liveField = requireObject(input.liveField, 'liveField');
  const contractOptions = normalizeSelectOptions(contractField.property?.options);
  if (contractOptions.length === 0) return null;

  const liveType = Number(liveField.type);
  const contractType = Number(contractField.type);
  if (liveType === 1) {
    // Existing Text fields already accept extensible WooCommerce status values.
    // Do not perform an in-place type conversion on populated tenant data.
    return null;
  }
  if (liveType !== contractType || contractType !== 3) {
    throw operatorError(
      'WooCommerce Lark Select field type is incompatible with the additive contract',
      'WOOCOMMERCE_FINAL_LARK_SELECT_TYPE_INVALID',
      {
        fieldName: contractField.fieldName,
        expectedType: contractType,
        observedType: liveType,
      },
    );
  }

  const liveOptions = normalizeSelectOptions(liveField.property?.options);
  const liveNames = new Set(liveOptions.map((option) => option.name));
  const missing = contractOptions.filter((option) => !liveNames.has(option.name));
  if (missing.length === 0) return null;

  const merged = [
    ...liveOptions,
    ...missing.map((option, index) => Object.freeze({
      name: option.name,
      color: option.color ?? (liveOptions.length + index) % 8,
    })),
  ];
  return Object.freeze({
    fieldId: requireText(liveField.fieldId, 'liveField.fieldId'),
    field: Object.freeze({
      fieldName: requireText(liveField.fieldName, 'liveField.fieldName'),
      type: liveType,
      ...(optionalText(liveField.uiType) ? { uiType: liveField.uiType.trim() } : {}),
      ...(optionalText(liveField.description)
        ? { description: liveField.description.trim() }
        : {}),
      property: Object.freeze({
        ...(liveField.property && typeof liveField.property === 'object'
          && !Array.isArray(liveField.property)
          ? structuredClone(liveField.property)
          : {}),
        options: Object.freeze(merged),
      }),
    }),
    addedOptionNames: Object.freeze(missing.map((option) => option.name)),
    existingOptionNames: Object.freeze(liveOptions.map((option) => option.name)),
  });
}

export function verifyWooCommerceLarkSelectOptionRepair(input = {}) {
  const beforeField = requireObject(input.beforeField, 'beforeField');
  const afterField = requireObject(input.afterField, 'afterField');
  const repair = requireObject(input.repair, 'repair');
  const beforeNames = normalizeSelectOptions(beforeField.property?.options)
    .map((option) => option.name);
  const beforeOptions = normalizeSelectOptions(beforeField.property?.options);
  const afterOptions = normalizeSelectOptions(afterField.property?.options);
  const afterNames = afterOptions.map((option) => option.name);
  const afterSet = new Set(afterNames);
  const afterByName = new Map(afterOptions.map((option) => [option.name, option]));
  const requiredNames = [
    ...beforeNames,
    ...repair.addedOptionNames,
  ];
  const accepted = afterField.fieldId === beforeField.fieldId
    && Number(afterField.type) === Number(beforeField.type)
    && afterNames.length >= beforeNames.length
    && requiredNames.every((name) => afterSet.has(name))
    && beforeOptions.every((option) => (
      !option.id || afterByName.get(option.name)?.id === option.id
    ));
  if (!accepted) {
    throw operatorError(
      'WooCommerce Lark Select option repair did not converge',
      'WOOCOMMERCE_FINAL_LARK_SELECT_REPAIR_VERIFY_FAILED',
      {
        fieldName: beforeField.fieldName,
        beforeOptionCount: beforeNames.length,
        afterOptionCount: afterNames.length,
        expectedAddedOptionCount: repair.addedOptionNames.length,
      },
    );
  }
  return Object.freeze({
    accepted: true,
    fieldIdPreserved: true,
    existingOptionIdsPreserved: true,
    existingOptionsPreserved: true,
    addedOptionCount: repair.addedOptionNames.length,
  });
}

export function buildWooCommerceConfigWindows(input = {}) {
  const source = parseWooCommerceConfig(input.configText);
  const tableIds = requireObject(input.tableIds, 'tableIds');
  const safeConfig = structuredClone(source);
  const safeVars = structuredClone(requireObject(source.vars, 'vars'));

  for (const flag of WOOCOMMERCE_FINAL_FLAGS) safeVars[flag] = 'false';
  for (const contract of createWooCommerceLarkSchemaContract()) {
    safeVars[contract.envName] = requireText(tableIds[contract.tableKey], contract.tableKey);
  }
  safeConfig.vars = safeVars;

  const safe = serializeConfig(safeConfig);
  const uat = setFlags(safe, {
    MKT_CONNECTOR_WOOCOMMERCE_ENABLED: true,
    MKT_WOOCOMMERCE_D1_WRITE_ENABLED: true,
    MKT_WOOCOMMERCE_LARK_WRITE_ENABLED: true,
    MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED: true,
  });
  const closeout = safe;
  return Object.freeze({
    safe,
    uat,
    closeout,
    safeSha256: sha256(safe),
    uatSha256: sha256(uat),
    closeoutSha256: sha256(closeout),
    safeTrueFlags: Object.freeze(readTrueFlags(safe)),
    uatTrueFlags: Object.freeze(readTrueFlags(uat)),
    closeoutTrueFlags: Object.freeze(readTrueFlags(closeout)),
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
      (SELECT json_extract(details_json, '$.retryable') FROM sync_runs WHERE sync_run_id = ${syncRunId}) AS sync_run_retryable,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key = ${workKey}) AS work_lifecycle_status,
      (SELECT generation FROM sync_work_runs WHERE work_key = ${workKey}) AS work_generation,
      (SELECT requested_at FROM sync_work_runs WHERE work_key = ${workKey}) AS work_requested_at,
      (SELECT completed_at FROM sync_work_runs WHERE work_key = ${workKey}) AS work_completed_at,
      (SELECT completion_json FROM sync_work_runs WHERE work_key = ${workKey}) AS completion_json,
      (SELECT complete FROM sync_work_phases WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1') AS phase_complete,
      (SELECT state_json FROM sync_work_phases WHERE work_key = ${workKey} AND phase = 'woocommerce_commerce_pages_v1') AS state_json,
      (SELECT COUNT(*) FROM sync_locks WHERE owner_id = ${syncRunId} AND expires_at > unixepoch('now') * 1000) AS active_lock_count,
      (SELECT generation FROM queue_operation_attempts WHERE operation_id = ${operationId} AND work_key = ${workKey}) AS queue_generation,
      (SELECT original_requested_at FROM queue_operation_attempts WHERE operation_id = ${operationId} AND work_key = ${workKey}) AS queue_original_requested_at,
      (SELECT COALESCE(MAX(main_queue_attempts), 0) FROM queue_operation_attempts WHERE operation_id = ${operationId} AND work_key = ${workKey}) AS queue_operation_attempts,
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
  const counts = Object.fromEntries(TABLE_BINDINGS.map(({ d1Table }) => [
    d1Table,
    count(value[d1Table] ?? value.counts?.[d1Table]),
  ]));
  return Object.freeze({
    syncRunStatus: optionalText(value.sync_run_status ?? value.syncRunStatus),
    syncRunFinishedAt: nullableNumber(
      value.sync_run_finished_at ?? value.syncRunFinishedAt,
    ),
    syncRunErrorCode: optionalText(
      value.sync_run_error_code ?? value.syncRunErrorCode,
    ),
    syncRunRetryable: nullableBoolean(
      value.sync_run_retryable ?? value.syncRunRetryable,
    ),
    workLifecycleStatus: optionalText(
      value.work_lifecycle_status ?? value.workLifecycleStatus,
    ),
    workGeneration: nullableNumber(value.work_generation ?? value.workGeneration),
    workRequestedAt: nullableNumber(value.work_requested_at ?? value.workRequestedAt),
    workCompletedAt: nullableNumber(value.work_completed_at ?? value.workCompletedAt),
    completion: parseNullableJson(value.completion_json ?? value.completion),
    phaseComplete: value.phaseComplete === true
      || Number(value.phase_complete ?? 0) === 1,
    state: parseNullableJson(value.state_json ?? value.state),
    activeLockCount: count(value.active_lock_count ?? value.activeLockCount),
    queueGeneration: nullableNumber(value.queue_generation ?? value.queueGeneration),
    queueOriginalRequestedAt: nullableNumber(
      value.queue_original_requested_at ?? value.queueOriginalRequestedAt,
    ),
    queueOperationAttempts: count(
      value.queue_operation_attempts ?? value.queueOperationAttempts,
    ),
    coverageRunCount: count(value.coverage_run_count ?? value.coverageRunCount),
    invalidCoverageCount: count(
      value.invalid_coverage_count ?? value.invalidCoverageCount,
    ),
    counts: Object.freeze(counts),
  });
}

export function isWooCommerceExactContinuationSnapshotEmpty(value = {}) {
  const snapshot = normalizeWooCommerceFinalSnapshot(value);
  return snapshot.syncRunStatus === null
    && snapshot.syncRunFinishedAt === null
    && snapshot.syncRunErrorCode === null
    && snapshot.syncRunRetryable === null
    && snapshot.workLifecycleStatus === null
    && snapshot.workGeneration === null
    && snapshot.workRequestedAt === null
    && snapshot.workCompletedAt === null
    && snapshot.completion === null
    && snapshot.phaseComplete === false
    && snapshot.state === null
    && snapshot.activeLockCount === 0
    && snapshot.queueGeneration === null
    && snapshot.queueOriginalRequestedAt === null
    && snapshot.queueOperationAttempts === 0
    && snapshot.coverageRunCount === 0
    && snapshot.invalidCoverageCount === 0
    && Object.values(snapshot.counts).every((rowCount) => rowCount === 0);
}

export function selectWooCommerceFullOperation(input = {}) {
  const resumeOperationId = optionalText(input.resumeOperationId);
  if (!resumeOperationId) return null;
  const operationId = requireOperationId(resumeOperationId);
  const snapshot = normalizeWooCommerceFinalSnapshot(input.snapshot);
  const requestedAt = snapshot.queueOriginalRequestedAt === null
    ? null
    : requireTimestamp(snapshot.queueOriginalRequestedAt, 'queueOriginalRequestedAt');
  const generationsAgree = requestedAt !== null
    && snapshot.queueGeneration === requestedAt
    && snapshot.workGeneration === requestedAt
    && snapshot.workRequestedAt === requestedAt;
  const partialRows = Object.values(snapshot.counts).reduce((sum, value) => sum + value, 0);
  if (snapshot.syncRunStatus !== 'failed'
    || !EXACT_RESUME_ERROR_CODES.has(snapshot.syncRunErrorCode)
    || snapshot.workLifecycleStatus !== 'active'
    || snapshot.workCompletedAt !== null
    || snapshot.phaseComplete
    || snapshot.activeLockCount !== 0
    || snapshot.queueOperationAttempts < 1
    || partialRows < 1
    || !generationsAgree) {
    throw operatorError(
      'WooCommerce exact continuation preflight rejected the durable operation',
      'WOOCOMMERCE_FINAL_EXACT_CONTINUATION_INVALID',
      {
        operationId,
        syncRunStatus: snapshot.syncRunStatus,
        syncRunErrorCode: snapshot.syncRunErrorCode,
        workLifecycleStatus: snapshot.workLifecycleStatus,
        phaseComplete: snapshot.phaseComplete,
        activeLockCount: snapshot.activeLockCount,
        queueOperationAttempts: snapshot.queueOperationAttempts,
        partialRows,
        generationsAgree,
      },
    );
  }
  return Object.freeze({
    operationId,
    requestedAt,
    resumedExactOperation: true,
    priorQueueAttempts: snapshot.queueOperationAttempts,
  });
}

export function classifyWooCommerceFinalCompletion(snapshotInput, options = {}) {
  const snapshot = normalizeWooCommerceFinalSnapshot(snapshotInput);
  const expectedCoverage = 6;
  const state = snapshot.state ?? {};
  const full = options.fullReconciliation === true;
  const minimumQueueAttempts = count(options.minimumQueueAttempts ?? 0);
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
  const terminalFailure = snapshot.syncRunStatus === 'failed'
    && snapshot.syncRunFinishedAt !== null
    && snapshot.syncRunErrorCode !== null
    && snapshot.syncRunRetryable === false
    && snapshot.activeLockCount === 0
    && snapshot.queueOperationAttempts >= minimumQueueAttempts;
  return Object.freeze({
    complete,
    terminalFailure,
    snapshot,
    reason: complete
      ? 'woocommerce_complete'
      : (terminalFailure ? 'woocommerce_terminal_failure' : 'incomplete_or_invalid'),
  });
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
function createLarkFieldContract(binding, fieldName, primary) {
  if (binding.tableKey === 'mktCommerceOrders' && fieldName === 'status') {
    return Object.freeze({
      fieldName,
      type: 3,
      uiType: 'SingleSelect',
      property: Object.freeze({
        options: Object.freeze(WOOCOMMERCE_ORDER_STATUS_OPTIONS.map(
          (name, index) => Object.freeze({ name, color: index % 8 }),
        )),
      }),
    });
  }
  const type = primary
    ? 1
    : (/(?:_at|_micros|_count|_quantity|_rows|_order|_decimals|_attempts)$/u.test(fieldName)
    || new Set(['quantity', 'manage_stock', 'individual_use', 'free_shipping', 'menu_order', 'product_count', 'recognized_orders', 'provisional_orders', 'cancelled_orders', 'failed_orders', 'refunded_orders']).has(fieldName)
      ? 2 : 1);
  return Object.freeze({ fieldName, type });
}
function normalizeSelectOptions(value) {
  if (!Array.isArray(value)) return [];
  const names = new Set();
  const options = [];
  for (const item of value) {
    const name = optionalText(item?.name);
    if (!name || names.has(name)) continue;
    names.add(name);
    const color = Number(item?.color);
    options.push(Object.freeze({
      name,
      ...(optionalText(item?.id) ? { id: optionalText(item.id) } : {}),
      ...(Number.isSafeInteger(color) && color >= 0 ? { color } : {}),
    }));
  }
  return options;
}
function parseWooCommerceConfig(text) {
  try {
    return parseJsoncObject(requireText(text, 'configText'));
  } catch (cause) {
    throw operatorError(
      'WooCommerce Wrangler config is not valid JSONC',
      'WOOCOMMERCE_FINAL_CONFIG_INVALID',
      { cause: cause?.message ?? 'JSON_PARSE_FAILED' },
    );
  }
}
function serializeConfig(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function setFlags(text, values) {
  const config = structuredClone(parseWooCommerceConfig(text));
  const vars = structuredClone(requireObject(config.vars, 'vars'));
  for (const [name, value] of Object.entries(values)) vars[name] = value ? 'true' : 'false';
  config.vars = vars;
  return serializeConfig(config);
}
function readTrueFlags(text) {
  const vars = requireObject(parseWooCommerceConfig(text).vars, 'vars');
  return Object.entries(vars)
    .filter(([name, value]) => ENABLED_FLAG.test(name) && String(value).trim().toLowerCase() === 'true')
    .map(([name]) => name)
    .sort();
}
function requireOperationId(value) { const text = requireText(value, 'operationId').toLowerCase(); if (!/^[a-z0-9][a-z0-9._:-]{7,127}$/u.test(text)) throw operatorError('WooCommerce operationId is invalid', 'WOOCOMMERCE_FINAL_OPERATION_ID_INVALID'); return text; }
function requireTimestamp(value, fieldName) { const number = typeof value === 'number' ? value : Date.parse(value); if (!Number.isSafeInteger(number) || number < Date.UTC(2020, 0, 1)) throw operatorError(`${fieldName} is invalid`, 'WOOCOMMERCE_FINAL_TIMESTAMP_INVALID'); return number; }
function count(value) { const number = Number(value ?? 0); if (!Number.isSafeInteger(number) || number < 0) throw operatorError('WooCommerce count is invalid', 'WOOCOMMERCE_FINAL_COUNT_INVALID'); return number; }
function nullableNumber(value) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function nullableBoolean(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  return null;
}
function optionalText(value) { if (value === null || value === undefined || value === '') return null; return String(value); }
function parseNullableJson(value) { if (value === null || value === undefined || value === '') return null; if (typeof value === 'object') return value; try { return JSON.parse(String(value)); } catch { throw operatorError('WooCommerce evidence JSON is invalid', 'WOOCOMMERCE_FINAL_JSON_INVALID'); } }
function requireObject(value, fieldName) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw operatorError(`${fieldName} must be an object`, 'WOOCOMMERCE_FINAL_CONTRACT_INVALID'); return value; }
function requireText(value, fieldName) { if (typeof value !== 'string' || value.trim() === '') throw operatorError(`${fieldName} is required`, 'WOOCOMMERCE_FINAL_CONTRACT_INVALID'); return value.trim(); }
function sqlText(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function compactSql(value) { return value.replace(/\s+/gu, ' ').trim(); }
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
