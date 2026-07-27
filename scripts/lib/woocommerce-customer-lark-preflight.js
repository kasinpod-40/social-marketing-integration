import { createHash } from 'node:crypto';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const WOOCOMMERCE_CUSTOMER_LARK_PREFLIGHT_VERSION = 'woocommerce_customer_lark_preflight_v1';
export const WOOCOMMERCE_EXPECTED_MIGRATION = '0017_woocommerce_commerce.sql';
export const WOOCOMMERCE_PREFLIGHT_PHASES = Object.freeze([
  'plan',
  'remote-preflight',
  'provider-preflight',
  'lark-preflight',
  'summary',
]);

export const WOOCOMMERCE_PREFLIGHT_CONFIRMATIONS = Object.freeze({
  'remote-preflight': Object.freeze({
    envName: 'CONFIRM_WOOCOMMERCE_REMOTE_PREFLIGHT',
    value: 'READ_ONLY_WOOCOMMERCE_REMOTE_PREFLIGHT',
  }),
  'provider-preflight': Object.freeze({
    envName: 'CONFIRM_WOOCOMMERCE_PROVIDER_PREFLIGHT',
    value: 'GET_ONLY_WOOCOMMERCE_PROVIDER_PREFLIGHT',
  }),
  'lark-preflight': Object.freeze({
    envName: 'CONFIRM_WOOCOMMERCE_LARK_PREFLIGHT',
    value: 'READ_ONLY_WOOCOMMERCE_LARK_PREFLIGHT',
  }),
  summary: Object.freeze({
    envName: 'CONFIRM_WOOCOMMERCE_PREFLIGHT_SUMMARY',
    value: 'SUMMARIZE_WOOCOMMERCE_PREFLIGHT',
  }),
});

export const WOOCOMMERCE_D1_TABLES = Object.freeze([
  'raw_commerce_stores',
  'raw_commerce_orders',
  'raw_commerce_order_items',
  'raw_commerce_products',
  'raw_commerce_product_variations',
  'raw_commerce_categories',
  'raw_commerce_customers',
  'raw_commerce_coupons',
  'raw_commerce_refunds',
  'commerce_store_state',
  'commerce_order_state',
  'commerce_order_status_observations',
  'commerce_order_line_facts',
  'commerce_product_state',
  'commerce_customer_aggregates',
  'commerce_daily_sales_facts',
  'commerce_product_daily_facts',
]);

export const WOOCOMMERCE_D1_INDEXES = Object.freeze([
  'idx_raw_commerce_orders_modified',
  'idx_raw_commerce_orders_status',
  'idx_raw_commerce_order_items_product',
  'idx_raw_commerce_products_modified',
  'idx_commerce_order_state_date',
  'idx_commerce_order_state_modified',
  'idx_commerce_order_state_customer',
  'idx_commerce_order_status_history',
  'idx_commerce_order_line_product_date',
  'idx_commerce_product_state_modified',
  'idx_commerce_product_state_sku',
  'idx_commerce_daily_sales_range',
  'idx_commerce_product_daily_range',
]);

export const WOOCOMMERCE_LARK_KEYS = Object.freeze([
  'rawCommerceStores',
  'rawCommerceOrders',
  'rawCommerceOrderItems',
  'rawCommerceProducts',
  'rawCommerceProductVariations',
  'rawCommerceCategories',
  'rawCommerceCustomers',
  'rawCommerceCoupons',
  'rawCommerceRefunds',
  'mktCommerceOrders',
  'mktCommerceProducts',
  'mktCommerceCustomers',
  'mktCommerceDaily',
  'mktCommerceProductDaily',
]);

const EXECUTABLE_PHASES = new Set(WOOCOMMERCE_PREFLIGHT_PHASES.filter((phase) => phase !== 'plan'));

export function parseWooCommercePreflightArgs(args = []) {
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
    throw operatorError(
      `Unknown WooCommerce preflight argument: ${arg}`,
      'WOOCOMMERCE_PREFLIGHT_ARGUMENT_INVALID',
    );
  }
  if (!WOOCOMMERCE_PREFLIGHT_PHASES.includes(phase)) {
    throw operatorError(
      `Unsupported WooCommerce preflight phase: ${phase}`,
      'WOOCOMMERCE_PREFLIGHT_PHASE_INVALID',
    );
  }
  return Object.freeze({ phase, execute });
}

export function assertWooCommercePreflightConfirmation(phase, env = {}) {
  if (!EXECUTABLE_PHASES.has(phase)) return true;
  const confirmation = WOOCOMMERCE_PREFLIGHT_CONFIRMATIONS[phase];
  if (env?.[confirmation.envName] !== confirmation.value) {
    throw operatorError(
      `WooCommerce preflight requires ${confirmation.envName}=${confirmation.value}`,
      'WOOCOMMERCE_PREFLIGHT_CONFIRMATION_REQUIRED',
      { phase, envName: confirmation.envName },
    );
  }
  return true;
}

export function loadWooCommercePreflightTarget(env = {}) {
  return Object.freeze({
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
    repositoryHead: requireText(
      env.MKT_WOOCOMMERCE_ROLLOUT_REPOSITORY_HEAD,
      'MKT_WOOCOMMERCE_ROLLOUT_REPOSITORY_HEAD',
    ),
    databaseName: requireExact(
      env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME,
      'social-mkt-state-dev',
      'MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME',
    ),
    wranglerConfig: requireText(
      env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG,
      'MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG',
    ),
    workerName: requireExact(
      env.MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME,
      'social-mkt-sync-worker',
      'MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME',
    ),
  });
}

export function createWooCommercePreflightTargetFingerprint(target = {}) {
  return sha256Hex(JSON.stringify({
    contractVersion: WOOCOMMERCE_CUSTOMER_LARK_PREFLIGHT_VERSION,
    environment: requireExact(target.environment, 'development', 'environment'),
    customerProfile: requireExact(target.customerProfile, 'integration_workspace', 'customerProfile'),
    customerKey: requireExact(target.customerKey, 'chemistry_k', 'customerKey'),
    repositoryHead: requireText(target.repositoryHead, 'repositoryHead'),
    databaseName: requireExact(target.databaseName, 'social-mkt-state-dev', 'databaseName'),
    workerName: requireExact(target.workerName, 'social-mkt-sync-worker', 'workerName'),
  }));
}

export function auditWooCommerceMigrationSource(sqlText) {
  const sql = requireText(sqlText, 'migrationSql');
  const executable = sql.replace(/--[^\n]*/gu, ' ');
  const tableNames = uniqueMatches(
    executable,
    /\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)\b/giu,
  );
  const indexNames = uniqueMatches(
    executable,
    /\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)\b/giu,
  );
  const destructive = executable.match(/\b(?:DROP|DELETE|ALTER|UPDATE|INSERT|REPLACE)\b/giu) ?? [];
  const invalid = [];
  if (!sameSet(tableNames, WOOCOMMERCE_D1_TABLES)) invalid.push('table_names');
  if (!sameSet(indexNames, WOOCOMMERCE_D1_INDEXES)) invalid.push('index_names');
  if (destructive.length > 0) invalid.push('destructive_statements');
  if (invalid.length > 0) {
    throw operatorError(
      'WooCommerce Migration 0017 source audit failed',
      'WOOCOMMERCE_PREFLIGHT_MIGRATION_SOURCE_INVALID',
      {
        invalid,
        tableCount: tableNames.length,
        indexCount: indexNames.length,
        destructiveCount: destructive.length,
      },
    );
  }
  return Object.freeze({
    migration: WOOCOMMERCE_EXPECTED_MIGRATION,
    tableCount: tableNames.length,
    indexCount: indexNames.length,
    destructiveCount: 0,
    sha256: sha256Hex(sql),
  });
}

export function classifyWooCommerceMigrationState(output) {
  const pending = pendingMigrationNames(output);
  if (pending.length === 0) {
    return Object.freeze({ state: 'applied_or_no_pending', pending });
  }
  if (pending.length === 1 && pending[0] === WOOCOMMERCE_EXPECTED_MIGRATION) {
    return Object.freeze({ state: 'pending_0017_only', pending });
  }
  throw operatorError(
    'WooCommerce Remote migration state contains an unexpected pending set',
    'WOOCOMMERCE_PREFLIGHT_PENDING_MIGRATIONS_MISMATCH',
    { pending },
  );
}

export function buildWooCommerceRemotePreflightSql() {
  const tables = sqlStringList(WOOCOMMERCE_D1_TABLES);
  const indexes = sqlStringList(WOOCOMMERCE_D1_INDEXES);
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN (${tables})) AS commerce_table_count,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN (${indexes})) AS commerce_index_count,
      (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') AS active_work,
      (SELECT COUNT(*) FROM sync_locks WHERE expires_at > unixepoch('now') * 1000) AS active_locks,
      (SELECT COUNT(*) FROM dead_letter_jobs WHERE status = 'open') AS open_dlq,
      (SELECT COUNT(*) FROM system_alerts WHERE status = 'open') AS open_alerts;
  `);
}

export function buildWooCommerceCommerceReadbackSql() {
  const counts = WOOCOMMERCE_D1_TABLES
    .map((name) => `(SELECT COUNT(*) FROM ${name}) AS ${name}`)
    .join(',\n');
  return compactSql(`SELECT ${counts};`);
}

export function validateWooCommerceRemotePreflightRow(row = {}, migrationState) {
  const activeWork = nonNegativeInteger(row.active_work, 'active_work');
  const activeLocks = nonNegativeInteger(row.active_locks, 'active_locks');
  const tableCount = nonNegativeInteger(row.commerce_table_count, 'commerce_table_count');
  const indexCount = nonNegativeInteger(row.commerce_index_count, 'commerce_index_count');
  const openDlq = nonNegativeInteger(row.open_dlq, 'open_dlq');
  const openAlerts = nonNegativeInteger(row.open_alerts, 'open_alerts');
  if (activeWork !== 0 || activeLocks !== 0) {
    throw operatorError(
      'WooCommerce Remote preflight requires zero active work and locks',
      'WOOCOMMERCE_PREFLIGHT_ACTIVE_WORK_BLOCKED',
      { activeWork, activeLocks },
    );
  }
  if (migrationState?.state === 'pending_0017_only' && (tableCount !== 0 || indexCount !== 0)) {
    throw operatorError(
      'Migration 0017 is pending but WooCommerce schema already exists',
      'WOOCOMMERCE_PREFLIGHT_SCHEMA_LEDGER_DRIFT',
      { tableCount, indexCount },
    );
  }
  if (migrationState?.state === 'applied_or_no_pending'
    && (tableCount !== WOOCOMMERCE_D1_TABLES.length || indexCount !== WOOCOMMERCE_D1_INDEXES.length)) {
    throw operatorError(
      'Migration 0017 has no pending entry but WooCommerce schema is incomplete',
      'WOOCOMMERCE_PREFLIGHT_SCHEMA_INCOMPLETE',
      { tableCount, indexCount },
    );
  }
  return Object.freeze({
    activeWork,
    activeLocks,
    tableCount,
    indexCount,
    openDlq,
    openAlerts,
  });
}

export function validateWooCommerceCommerceReadbackRow(row = {}) {
  const counts = {};
  for (const table of WOOCOMMERCE_D1_TABLES) {
    counts[table] = nonNegativeInteger(row[table], table);
  }
  return Object.freeze({
    counts: Object.freeze(counts),
    totalRows: Object.values(counts).reduce((sum, value) => sum + value, 0),
  });
}

export function validateWooCommerceProviderSnapshot(input = {}) {
  const store = requireObject(input.store, 'store');
  const datasets = {};
  for (const name of ['orders', 'products', 'customers']) {
    const sample = input[name];
    if (!Array.isArray(sample?.records)) {
      throw operatorError(
        `WooCommerce provider preflight requires ${name}.records`,
        'WOOCOMMERCE_PROVIDER_PREFLIGHT_INVALID',
        { dataset: name },
      );
    }
    datasets[name] = Object.freeze({
      sampleCount: sample.records.length,
      totalRows: nullableNonNegativeInteger(sample.totalRows, `${name}.totalRows`),
      totalPages: nullableNonNegativeInteger(sample.totalPages, `${name}.totalPages`),
    });
  }
  return Object.freeze({
    store: Object.freeze({
      wcVersionPresent: hasText(store.wcVersion ?? store.wc_version),
      wpVersionPresent: hasText(store.wpVersion ?? store.wp_version),
      timezone: optionalText(store.timezone),
      currency: optionalText(store.currency),
    }),
    datasets: Object.freeze(datasets),
    providerRequestCount: 4,
  });
}

export function validateWooCommerceLarkInventory(input = {}) {
  const tableIds = requireObject(input.tableIds, 'tableIds');
  const remoteTables = Array.isArray(input.remoteTables) ? input.remoteTables : [];
  const fieldCounts = requireObject(input.fieldCounts, 'fieldCounts');
  const remoteIds = new Set(remoteTables.map((table) => normalizeRemoteTableId(table)).filter(Boolean));
  const seen = new Set();
  const missing = [];
  const emptyFields = [];
  for (const key of WOOCOMMERCE_LARK_KEYS) {
    const tableId = requireText(tableIds[key], `tableIds.${key}`);
    if (seen.has(tableId)) {
      throw operatorError(
        'WooCommerce Lark table IDs must be unique',
        'WOOCOMMERCE_LARK_PREFLIGHT_DUPLICATE_TABLE_ID',
        { tableId, key },
      );
    }
    seen.add(tableId);
    if (!remoteIds.has(tableId)) missing.push(key);
    const fieldCount = nonNegativeInteger(fieldCounts[key], `fieldCounts.${key}`);
    if (fieldCount === 0) emptyFields.push(key);
  }
  if (missing.length > 0 || emptyFields.length > 0) {
    throw operatorError(
      'WooCommerce Lark inventory is incomplete',
      'WOOCOMMERCE_LARK_PREFLIGHT_INCOMPLETE',
      { missing, emptyFields },
    );
  }
  return Object.freeze({
    tableCount: WOOCOMMERCE_LARK_KEYS.length,
    tableIdFingerprint: sha256Hex(JSON.stringify([...seen].sort())),
    allTablesPresent: true,
    allFieldsPresent: true,
  });
}

export function decideWooCommerceReadinessSummary(input = {}) {
  const remote = requireObject(input.remote, 'remote');
  const provider = requireObject(input.provider, 'provider');
  const lark = requireObject(input.lark, 'lark');
  if (remote.targetFingerprint !== provider.targetFingerprint
    || remote.targetFingerprint !== lark.targetFingerprint) {
    throw operatorError(
      'WooCommerce preflight evidence does not belong to one target',
      'WOOCOMMERCE_PREFLIGHT_EVIDENCE_TARGET_MISMATCH',
    );
  }
  const migrationState = remote.migrationState?.state;
  const decision = migrationState === 'pending_0017_only'
    ? 'READY_FOR_SEPARATE_BACKUP_AND_0017_APPLY_AUTHORIZATION'
    : 'READY_FOR_GUARDED_MANUAL_D1_LARK_BACKFILL_IMPLEMENTATION';
  return Object.freeze({
    decision,
    migrationState,
    providerPassed: provider.status === 'passed',
    larkPassed: lark.status === 'passed',
    remoteMutationCount: 0,
    larkMutationCount: 0,
    queueSendCount: 0,
  });
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pendingMigrationNames(output) {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
  return Object.freeze([...new Set(
    [...text.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)].map((match) => match[0]),
  )].sort());
}

function uniqueMatches(text, regex) {
  return [...new Set([...text.matchAll(regex)].map((match) => match[1]))].sort();
}

function sameSet(actual, expected) {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

function sqlStringList(values) {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
}

function compactSql(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function normalizeRemoteTableId(table) {
  return optionalText(table?.tableId ?? table?.table_id ?? table?.id);
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw operatorError(`${fieldName} must be an object`, 'WOOCOMMERCE_PREFLIGHT_INPUT_INVALID', { fieldName });
  }
  return value;
}

function requireExact(value, expected, fieldName) {
  const text = requireText(value, fieldName);
  if (text !== expected) {
    throw operatorError(
      `${fieldName} must equal ${expected}`,
      'WOOCOMMERCE_PREFLIGHT_TARGET_INVALID',
      { fieldName, expected },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(
      `${fieldName} is required`,
      'WOOCOMMERCE_PREFLIGHT_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function hasText(value) {
  return optionalText(value) !== null;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw operatorError(
      `${fieldName} must be a non-negative integer`,
      'WOOCOMMERCE_PREFLIGHT_INPUT_INVALID',
      { fieldName },
    );
  }
  return number;
}

function nullableNonNegativeInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return nonNegativeInteger(value, fieldName);
}

function operatorError(message, code, details = {}) {
  return permanentError(message, { code, details });
}
