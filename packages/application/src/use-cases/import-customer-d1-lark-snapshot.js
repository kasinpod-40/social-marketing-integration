import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const CUSTOMER_D1_LARK_IMPORT_MODE_ENV = 'MKT_CUSTOMER_D1_LARK_IMPORT_MODE';
export const CUSTOMER_D1_LARK_IMPORT_MODE =
  'IMPORT_EXACT_CHATWOOT_WOOCOMMERCE_SNAPSHOT_20260824';
export const CUSTOMER_D1_LARK_BATCH_SIZE = 50;

const CUSTOMER_KEY = 'chemistry_k';
const CONTRACTS = Object.freeze({
  mktConversations: contract({
    source: 'chatwoot',
    snapshotId: 'customer-chatwoot-d1-20260824-3707-v1',
    table: 'chatwoot_conversation_state',
    keyField: 'conversation_key',
    totalRows: 1144,
    minKey: 'chatwoot:chemistry_k:conversation:100',
    maxKey: 'chatwoot:chemistry_k:conversation:987',
    maxUpdated: 1787532354000,
    project: projectConversation,
  }),
  mktConversationDaily: contract({
    source: 'chatwoot',
    snapshotId: 'customer-chatwoot-d1-20260824-3707-v1',
    table: 'chatwoot_conversation_daily_facts',
    keyField: 'conversation_daily_key',
    totalRows: 2092,
    minKey: 'chatwoot:chemistry_k:conversation:1002:2026-04-06',
    maxKey: 'chatwoot:chemistry_k:conversation:98:2026-08-23',
    maxUpdated: 1787532354000,
  }),
  mktAgentDaily: contract({
    source: 'chatwoot',
    snapshotId: 'customer-chatwoot-d1-20260824-3707-v1',
    table: 'chatwoot_agent_daily_facts',
    keyField: 'agent_daily_key',
    totalRows: 242,
    minKey: 'chatwoot:chemistry_k:agent:10:2026-04-08',
    maxKey: 'chatwoot:chemistry_k:agent:8:2026-08-23',
    maxUpdated: 1787532354000,
  }),
  mktInboxDaily: contract({
    source: 'chatwoot',
    snapshotId: 'customer-chatwoot-d1-20260824-3707-v1',
    table: 'chatwoot_inbox_daily_facts',
    keyField: 'inbox_daily_key',
    totalRows: 134,
    minKey: 'chatwoot:chemistry_k:inbox:12:2026-08-21',
    maxKey: 'chatwoot:chemistry_k:inbox:4:2026-08-24',
    maxUpdated: 1787532354000,
  }),
  mktConversationAccountDaily: contract({
    source: 'chatwoot',
    snapshotId: 'customer-chatwoot-d1-20260824-3707-v1',
    table: 'chatwoot_account_daily_facts',
    keyField: 'account_daily_key',
    totalRows: 95,
    minKey: 'chatwoot:chemistry_k:account:2026-04-03',
    maxKey: 'chatwoot:chemistry_k:account:2026-08-24',
    maxUpdated: 1787532354000,
  }),
  mktCommerceOrders: contract({
    source: 'woocommerce',
    snapshotId: 'customer-woocommerce-d1-20260824-18911-v1',
    table: 'commerce_order_state',
    keyField: 'order_key',
    totalRows: 8377,
    minKey: 'woocommerce:chemistry_k:195097',
    maxKey: 'woocommerce:chemistry_k:236457',
    maxUpdated: 1787567337051,
  }),
  mktCommerceProducts: contract({
    source: 'woocommerce',
    snapshotId: 'customer-woocommerce-d1-20260824-18911-v1',
    table: 'commerce_product_state',
    keyField: 'product_key',
    totalRows: 273,
    minKey: 'woocommerce:chemistry_k:137454',
    maxKey: 'woocommerce:chemistry_k:235723',
    maxUpdated: 1787337303911,
  }),
  mktCommerceCustomers: contract({
    source: 'woocommerce',
    snapshotId: 'customer-woocommerce-d1-20260824-18911-v1',
    table: 'commerce_customer_aggregates',
    keyField: 'customer_aggregate_key',
    totalRows: 6017,
    minKey: 'woocommerce:chemistry_k:registered:1878:THB',
    maxKey: 'woocommerce:chemistry_k:registered:47446:THB',
    maxUpdated: 1787567254167,
  }),
  mktCommerceDaily: contract({
    source: 'woocommerce',
    snapshotId: 'customer-woocommerce-d1-20260824-18911-v1',
    table: 'commerce_daily_sales_facts',
    keyField: 'commerce_daily_key',
    totalRows: 622,
    minKey: 'woocommerce:chemistry_k:2022-01-31:THB',
    maxKey: 'woocommerce:chemistry_k:2026-08-23:THB',
    maxUpdated: 1787567254167,
  }),
  mktCommerceProductDaily: contract({
    source: 'woocommerce',
    snapshotId: 'customer-woocommerce-d1-20260824-18911-v1',
    table: 'commerce_product_daily_facts',
    keyField: 'product_daily_key',
    totalRows: 3622,
    minKey: 'woocommerce:chemistry_k:137454:2022-02-24:THB',
    maxKey: 'woocommerce:chemistry_k:235723:2026-08-12:THB',
    maxUpdated: 1787567254167,
  }),
});

/**
 * อ่าน exact Customer-owned D1 snapshot แล้วเขียน Customer Lark ทีละ 50 rows.
 * Queue payload ไม่มี Business data และเลือกได้เฉพาะ table/batch ใน reviewed manifest นี้.
 */
export async function importCustomerD1LarkSnapshot(input = {}) {
  const body = requireObject(input.body, 'body');
  const db = requireMethods(input.db, ['prepare'], 'db');
  const repository = requireObject(input.repository, 'repository');
  const syncEngine = requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine');
  const tables = requireObject(input.tables, 'tables');
  const tableKey = requireText(body.tableKey, 'tableKey');
  const scope = CONTRACTS[tableKey];
  if (!scope) throw invalid('Customer D1 snapshot table is outside the exact allowlist', { tableKey });

  requireExact(body.snapshotId, scope.snapshotId, 'snapshotId');
  requireExactInteger(body.totalRows, scope.totalRows, 'totalRows');
  requireExactInteger(body.batchCount, scope.batchCount, 'batchCount');
  const batchIndex = boundedInteger(body.batchIndex, 'batchIndex', 0, scope.batchCount - 1);
  const expectedRows = batchIndex === scope.batchCount - 1
    ? scope.totalRows - (batchIndex * CUSTOMER_D1_LARK_BATCH_SIZE)
    : CUSTOMER_D1_LARK_BATCH_SIZE;

  const manifest = await readManifest(db, scope);
  assertManifest(manifest, scope, tableKey);
  const page = await db.prepare(`
    SELECT * FROM ${scope.table}
    WHERE account_key = ?
    ORDER BY ${scope.keyField}
    LIMIT ? OFFSET ?
  `).bind(CUSTOMER_KEY, CUSTOMER_D1_LARK_BATCH_SIZE,
    batchIndex * CUSTOMER_D1_LARK_BATCH_SIZE).all();
  const sourceRows = requireArray(page?.results, 'D1 snapshot rows');
  requireExactInteger(sourceRows.length, expectedRows, 'D1 snapshot rows.length');
  const rows = sourceRows.map((row) => scope.project(row));
  validateRows(rows, scope, tableKey);

  const tableId = requireText(tables[tableKey], `tables.${tableKey}`);
  const plan = await syncEngine.planByKey({
    repository,
    tableId,
    keyField: scope.keyField,
    rows,
  });
  if (Number(plan?.duplicateInputRows ?? 0) !== 0) {
    throw invalid('Customer D1 snapshot batch contains duplicate stable keys', { tableKey, batchIndex });
  }
  const result = await syncEngine.executePlan(plan);
  const reconciliation = normalizeResult(result, expectedRows, tableKey, batchIndex);
  return Object.freeze({
    ok: true,
    mode: 'customer_d1_exact_snapshot_import',
    operationId: body.operationId ?? null,
    sourceSummary: Object.freeze({
      source: scope.source,
      snapshotId: scope.snapshotId,
      tableKey,
      batchIndex,
      batchCount: scope.batchCount,
      totalRows: scope.totalRows,
      batchRows: expectedRows,
    }),
    reconciliation: Object.freeze([reconciliation]),
  });
}

export function listCustomerD1LarkImportContracts() {
  return CONTRACTS;
}

async function readManifest(db, scope) {
  return db.prepare(`
    SELECT COUNT(*) AS total_rows,
      MIN(${scope.keyField}) AS min_key,
      MAX(${scope.keyField}) AS max_key,
      MAX(updated_at) AS max_updated
    FROM ${scope.table}
    WHERE account_key = ?
  `).bind(CUSTOMER_KEY).first();
}

function assertManifest(observed, expected, tableKey) {
  requireObject(observed, 'D1 snapshot manifest');
  const accepted = Number(observed.total_rows) === expected.totalRows
    && observed.min_key === expected.minKey
    && observed.max_key === expected.maxKey
    && Number(observed.max_updated) === expected.maxUpdated;
  if (!accepted) {
    throw invalid('Customer D1 snapshot manifest drifted before Lark import', {
      tableKey,
      observedRows: Number(observed.total_rows),
      expectedRows: expected.totalRows,
    });
  }
}

function validateRows(rows, scope, tableKey) {
  const keys = new Set();
  for (const row of rows) {
    requireObject(row, `${tableKey} row`);
    requireExact(row.account_key, CUSTOMER_KEY, 'row.account_key');
    const stableKey = requireText(row[scope.keyField], scope.keyField);
    if (keys.has(stableKey)) throw invalid('Customer D1 snapshot repeats a stable key', { tableKey });
    keys.add(stableKey);
  }
}

function projectConversation(row) {
  return Object.freeze({
    conversation_key: row.conversation_key,
    account_key: row.account_key,
    external_conversation_id: row.external_conversation_id,
    external_inbox_id: row.external_inbox_id,
    status: row.status,
    priority: row.priority,
    external_assignee_id: row.external_assignee_id,
    external_team_id: row.external_team_id,
    source_created_at: row.source_created_at,
    source_updated_at: row.source_updated_at,
    last_activity_at: row.last_activity_at,
    message_count: row.message_count,
    incoming_message_count: row.incoming_message_count,
    outgoing_message_count: row.outgoing_message_count,
    reopen_count_delta: row.reopen_count_delta,
    first_response_seconds: row.first_response_seconds,
    resolution_seconds: row.resolution_seconds,
    reply_seconds: row.reply_seconds,
    sync_run_id: row.last_sync_run_id,
  });
}

function normalizeResult(result, expected, tableKey, batchIndex) {
  const created = nonNegativeInteger(result?.created ?? 0, 'created');
  const updated = nonNegativeInteger(result?.updated ?? 0, 'updated');
  const skipped = nonNegativeInteger(result?.skipped ?? 0, 'skipped');
  const duplicateInputRows = nonNegativeInteger(result?.duplicateInputRows ?? 0, 'duplicateInputRows');
  if (created + updated + skipped !== expected || duplicateInputRows !== 0) {
    throw invalid('Customer D1 Lark batch reconciliation is incomplete', {
      tableKey, batchIndex, expected, created, updated, skipped, duplicateInputRows,
    });
  }
  return Object.freeze({
    tableKey, batchIndex, expected, created, updated, skipped, duplicateInputRows,
  });
}

function contract(input) {
  return Object.freeze({
    ...input,
    project: input.project ?? ((row) => Object.freeze({ ...row })),
    batchCount: Math.ceil(input.totalRows / CUSTOMER_D1_LARK_BATCH_SIZE),
  });
}

function invalid(message, details = {}) {
  return permanentError(message, { code: 'CUSTOMER_D1_LARK_IMPORT_INVALID', details });
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`Customer D1 Lark import requires ${fieldName}`);
  }
  return value;
}

function requireMethods(value, methods, fieldName) {
  const object = requireObject(value, fieldName);
  for (const method of methods) {
    if (typeof object[method] !== 'function') throw invalid(`${fieldName}.${method} is required`);
  }
  return object;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw invalid(`${fieldName} must be an array`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${fieldName} is required`);
  return value.trim();
}

function requireExact(observed, expected, fieldName) {
  if (observed !== expected) throw invalid(`${fieldName} does not match the reviewed snapshot`);
}

function requireExactInteger(observed, expected, fieldName) {
  if (!Number.isSafeInteger(observed) || observed !== expected) {
    throw invalid(`${fieldName} does not match the reviewed snapshot`);
  }
}

function boundedInteger(value, fieldName, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw invalid(`${fieldName} is outside the reviewed snapshot range`);
  }
  return value;
}

function nonNegativeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${fieldName} must be non-negative`);
  return value;
}
