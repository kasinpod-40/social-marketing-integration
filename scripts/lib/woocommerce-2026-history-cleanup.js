export const WOOCOMMERCE_2026_HISTORY_START = Date.parse(
  '2026-01-01T00:00:00.000Z',
);
export const WOOCOMMERCE_2026_HISTORY_DATE = '2026-01-01';
export const WOOCOMMERCE_2026_CLEANUP_CONFIRMATION =
  'DELETE_WOOCOMMERCE_PRE_2026_ONLY';
export const WOOCOMMERCE_REPLACED_OPERATION_ID =
  'woo-final-full-e2372e56d52d';
const REPLACED_WORK_KEY = `woocommerce:${WOOCOMMERCE_REPLACED_OPERATION_ID}`;
const REPLACED_GENERATION = 1785358748292;

export const WOOCOMMERCE_2026_CLEANUP_TABLES = Object.freeze([
  table('rawCommerceOrderItems', 'raw_commerce_order_items', 'raw_order_item_key', `
    account_key = 'chemistry_k' AND raw_order_key IN (
      SELECT raw_order_key FROM raw_commerce_orders
      WHERE account_key = 'chemistry_k'
        AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START}
    )`),
  table('rawCommerceRefunds', 'raw_commerce_refunds', 'raw_refund_key', `
    account_key = 'chemistry_k' AND raw_order_key IN (
      SELECT raw_order_key FROM raw_commerce_orders
      WHERE account_key = 'chemistry_k'
        AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START}
    )`),
  table('rawCommerceOrders', 'raw_commerce_orders', 'raw_order_key', `
    account_key = 'chemistry_k'
      AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START}`),
  table('mktCommerceOrders', 'commerce_order_state', 'order_key', `
    account_key = 'chemistry_k'
      AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START}`),
  table('mktCommerceCustomers', 'commerce_customer_aggregates', 'customer_aggregate_key', `
    account_key = 'chemistry_k'`),
  table('mktCommerceDaily', 'commerce_daily_sales_facts', 'commerce_daily_key', `
    account_key = 'chemistry_k'
      AND metric_date < '${WOOCOMMERCE_2026_HISTORY_DATE}'`),
  table('mktCommerceProductDaily', 'commerce_product_daily_facts', 'product_daily_key', `
    account_key = 'chemistry_k'
      AND metric_date < '${WOOCOMMERCE_2026_HISTORY_DATE}'`),
]);

export function assertWooCommerce2026CleanupConfirmation(env = {}) {
  if (env.CONFIRM_WOOCOMMERCE_2026_HISTORY_CLEANUP
    !== WOOCOMMERCE_2026_CLEANUP_CONFIRMATION) {
    throw cleanupError(
      'WooCommerce 2026 cleanup confirmation is required',
      'WOOCOMMERCE_2026_CLEANUP_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function buildWooCommerce2026CleanupKeysSql(contract) {
  const selected = requireContract(contract);
  return compactSql(`
    SELECT ${selected.keyField} AS stable_key
    FROM ${selected.d1Table}
    WHERE ${selected.where}
    ORDER BY ${selected.keyField};
  `);
}

export function buildWooCommerce2026CleanupVerifySql() {
  return compactSql(`SELECT
    (SELECT COUNT(*) FROM raw_commerce_orders
      WHERE account_key='chemistry_k'
        AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START}) AS old_raw_orders,
    (SELECT COUNT(*) FROM commerce_order_state
      WHERE account_key='chemistry_k'
        AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START}) AS old_order_state,
    (SELECT COUNT(*) FROM commerce_daily_sales_facts
      WHERE account_key='chemistry_k'
        AND metric_date < '${WOOCOMMERCE_2026_HISTORY_DATE}') AS old_daily,
    (SELECT COUNT(*) FROM commerce_product_daily_facts
      WHERE account_key='chemistry_k'
        AND metric_date < '${WOOCOMMERCE_2026_HISTORY_DATE}') AS old_product_daily,
    (SELECT COUNT(*) FROM sync_locks
      WHERE owner_id LIKE 'woocommerce:%'
        AND expires_at > unixepoch('now') * 1000) AS active_woocommerce_locks,
    (SELECT lifecycle_status FROM sync_work_runs
      WHERE work_key='${REPLACED_WORK_KEY}') AS replaced_work_status,
    (SELECT status FROM sync_runs
      WHERE sync_run_id='${REPLACED_WORK_KEY}') AS replaced_sync_status,
    (SELECT error_code FROM sync_runs
      WHERE sync_run_id='${REPLACED_WORK_KEY}') AS replaced_sync_error_code;`);
}

export function buildWooCommerce2026CleanupDeleteSql() {
  return compactSql(`
    BEGIN;
    DELETE FROM raw_commerce_order_items
      WHERE account_key='chemistry_k' AND raw_order_key IN (
        SELECT raw_order_key FROM raw_commerce_orders
        WHERE account_key='chemistry_k'
          AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START});
    DELETE FROM raw_commerce_refunds
      WHERE account_key='chemistry_k' AND raw_order_key IN (
        SELECT raw_order_key FROM raw_commerce_orders
        WHERE account_key='chemistry_k'
          AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START});
    DELETE FROM commerce_order_status_observations
      WHERE account_key='chemistry_k' AND order_key IN (
        SELECT order_key FROM commerce_order_state
        WHERE account_key='chemistry_k'
          AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START});
    DELETE FROM commerce_order_line_facts
      WHERE account_key='chemistry_k' AND order_key IN (
        SELECT order_key FROM commerce_order_state
        WHERE account_key='chemistry_k'
          AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START});
    DELETE FROM commerce_product_daily_facts
      WHERE account_key='chemistry_k'
        AND metric_date < '${WOOCOMMERCE_2026_HISTORY_DATE}';
    DELETE FROM commerce_daily_sales_facts
      WHERE account_key='chemistry_k'
        AND metric_date < '${WOOCOMMERCE_2026_HISTORY_DATE}';
    DELETE FROM commerce_customer_aggregates
      WHERE account_key='chemistry_k';
    DELETE FROM commerce_order_state
      WHERE account_key='chemistry_k'
        AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START};
    DELETE FROM raw_commerce_orders
      WHERE account_key='chemistry_k'
        AND source_created_at < ${WOOCOMMERCE_2026_HISTORY_START};
    UPDATE sync_runs
      SET status='failed',
          finished_at=unixepoch('now') * 1000,
          error_code='WOOCOMMERCE_HISTORY_SCOPE_REPLACED',
          error_message='Replaced by user-approved 2026-only history scope',
          details_json='{"retryable":false,"replacementScope":"2026_only"}',
          updated_at=unixepoch('now') * 1000
      WHERE sync_run_id='${REPLACED_WORK_KEY}'
        AND status='running'
        AND NOT EXISTS (
          SELECT 1 FROM sync_locks
          WHERE owner_id='${REPLACED_WORK_KEY}'
            AND expires_at > unixepoch('now') * 1000);
    UPDATE sync_work_runs
      SET lifecycle_status='terminal',
          terminal_reason='woocommerce_history_scope_replaced',
          abandoned_at=unixepoch('now') * 1000,
          expires_at=unixepoch('now') * 1000,
          audit_reference='woocommerce-history-scope:2026-only',
          updated_at=unixepoch('now') * 1000
      WHERE work_key='${REPLACED_WORK_KEY}'
        AND generation=${REPLACED_GENERATION}
        AND requested_at=${REPLACED_GENERATION}
        AND lifecycle_status='active'
        AND completed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM sync_locks
          WHERE owner_id='${REPLACED_WORK_KEY}'
            AND expires_at > unixepoch('now') * 1000);
    COMMIT;
  `);
}

export function validateWooCommerce2026CleanupKeys(rows, contract) {
  const selected = requireContract(contract);
  const keys = rows.map((row) => String(row?.stable_key ?? '').trim());
  if (keys.some((key) => key === '') || new Set(keys).size !== keys.length) {
    throw cleanupError(
      'WooCommerce cleanup D1 Stable keys are invalid or duplicated',
      'WOOCOMMERCE_2026_CLEANUP_KEYS_INVALID',
      { tableKey: selected.tableKey },
    );
  }
  return Object.freeze(keys);
}

export function selectWooCommerce2026CleanupLarkRecords(
  records,
  contract,
  context = {},
) {
  const selected = requireContract(contract);
  const source = Array.isArray(records) ? records : [];
  const oldOrderKeys = context.oldOrderKeys instanceof Set
    ? context.oldOrderKeys
    : new Set(context.oldOrderKeys ?? []);
  return Object.freeze(source.filter((record) => {
    const fields = record?.fields ?? {};
    if (textField(fields.account_key) !== 'chemistry_k') return false;
    if (selected.tableKey === 'rawCommerceOrderItems'
      || selected.tableKey === 'rawCommerceRefunds') {
      return oldOrderKeys.has(textField(fields.raw_order_key));
    }
    if (selected.tableKey === 'rawCommerceOrders'
      || selected.tableKey === 'mktCommerceOrders') {
      return numberField(fields.source_created_at) < WOOCOMMERCE_2026_HISTORY_START;
    }
    if (selected.tableKey === 'mktCommerceCustomers') return true;
    if (selected.tableKey === 'mktCommerceDaily'
      || selected.tableKey === 'mktCommerceProductDaily') {
      const date = textField(fields.metric_date);
      return /^\d{4}-\d{2}-\d{2}$/u.test(date)
        && date < WOOCOMMERCE_2026_HISTORY_DATE;
    }
    return false;
  }));
}

export function summarizeWooCommerce2026CleanupParity(
  d1Keys,
  larkKeys,
  contract,
) {
  const selected = requireContract(contract);
  const d1 = uniqueCleanupKeys(d1Keys, selected.tableKey, 'D1');
  const lark = uniqueCleanupKeys(larkKeys, selected.tableKey, 'Lark');
  const d1Set = new Set(d1);
  const larkSet = new Set(lark);
  let matchedCount = 0;
  for (const key of d1Set) if (larkSet.has(key)) matchedCount += 1;
  return Object.freeze({
    tableKey: selected.tableKey,
    d1Count: d1.length,
    larkCount: lark.length,
    matchedCount,
    d1OnlyCount: d1.length - matchedCount,
    larkOnlyCount: lark.length - matchedCount,
    exact: d1.length === matchedCount && lark.length === matchedCount,
  });
}

export function validateWooCommerce2026CleanupFinal(row = {}) {
  const fields = [
    'old_raw_orders',
    'old_order_state',
    'old_daily',
    'old_product_daily',
    'active_woocommerce_locks',
  ];
  if (fields.some((field) => Number(row[field] ?? -1) !== 0)) {
    throw cleanupError(
      'WooCommerce pre-2026 D1 rows or active locks remain after cleanup',
      'WOOCOMMERCE_2026_CLEANUP_VERIFY_FAILED',
      Object.fromEntries(fields.map((field) => [field, Number(row[field] ?? -1)])),
    );
  }
  if (row.replaced_work_status !== 'terminal'
    || row.replaced_sync_status !== 'failed'
    || row.replaced_sync_error_code !== 'WOOCOMMERCE_HISTORY_SCOPE_REPLACED') {
    throw cleanupError(
      'Replaced WooCommerce Full-history operation was not terminalized exactly',
      'WOOCOMMERCE_2026_CLEANUP_OPERATION_CLOSE_FAILED',
      {
        workStatus: row.replaced_work_status ?? null,
        syncStatus: row.replaced_sync_status ?? null,
        syncErrorCode: row.replaced_sync_error_code ?? null,
      },
    );
  }
  return true;
}

function table(tableKey, d1Table, keyField, where) {
  return Object.freeze({ tableKey, d1Table, keyField, where: compactSql(where) });
}

function requireContract(value) {
  if (!WOOCOMMERCE_2026_CLEANUP_TABLES.includes(value)) {
    throw cleanupError(
      'WooCommerce cleanup table is outside the exact allowlist',
      'WOOCOMMERCE_2026_CLEANUP_TABLE_INVALID',
    );
  }
  return value;
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function textField(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.length === 1) {
    return textField(value[0]?.text ?? value[0]);
  }
  return '';
}

function numberField(value) {
  const number = Number(textField(value) || value);
  return Number.isFinite(number) ? number : Number.POSITIVE_INFINITY;
}

function uniqueCleanupKeys(values, tableKey, source) {
  if (!Array.isArray(values)) {
    throw cleanupError(
      `WooCommerce cleanup ${source} Stable keys are invalid`,
      'WOOCOMMERCE_2026_CLEANUP_KEYS_INVALID',
      { tableKey, source },
    );
  }
  const keys = values.map((value) => String(value ?? '').trim());
  if (keys.some((key) => key === '') || new Set(keys).size !== keys.length) {
    throw cleanupError(
      `WooCommerce cleanup ${source} Stable keys are invalid or duplicated`,
      'WOOCOMMERCE_2026_CLEANUP_KEYS_INVALID',
      { tableKey, source },
    );
  }
  return keys;
}

function cleanupError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'WooCommerce2026CleanupError';
  error.code = code;
  error.details = details;
  return error;
}
