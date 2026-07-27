import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

const ALLOWED_PENDING_MIGRATIONS = new Set([
  '0017_woocommerce_commerce.sql',
  '0018_chatwoot_analytics.sql',
]);

export function classifyWooCommercePendingMigrations(output) {
  const pending = [...new Set([
    ...String(output ?? '').matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu),
  ].map((match) => match[0]))].sort();
  const unexpected = pending.filter((name) => !ALLOWED_PENDING_MIGRATIONS.has(name));
  if (unexpected.length > 0) {
    throw commandError(
      'Unexpected pending migrations block WooCommerce final rollout',
      'WOOCOMMERCE_FINAL_PENDING_MIGRATIONS_INVALID',
      { pending, unexpected },
    );
  }
  return Object.freeze({
    pending: Object.freeze(pending),
    migration0017Pending: pending.includes('0017_woocommerce_commerce.sql'),
    migration0018Pending: pending.includes('0018_chatwoot_analytics.sql'),
  });
}

export function resolveWooCommerceQueueId(output, queueName) {
  const expectedName = requireText(queueName, 'queueName');
  let parsed;
  try {
    parsed = typeof output === 'string' ? JSON.parse(output) : output;
  } catch (cause) {
    throw commandError(
      'Cloudflare Queue list returned invalid JSON',
      'WOOCOMMERCE_FINAL_QUEUE_LIST_INVALID',
      { cause: cause?.message ?? 'JSON_PARSE_FAILED' },
    );
  }
  const items = Array.isArray(parsed) ? parsed : (parsed?.result ?? parsed?.queues ?? []);
  const matches = Array.isArray(items)
    ? items.filter((item) => (item?.queue_name ?? item?.name) === expectedName)
    : [];
  const queueId = matches[0]?.queue_id ?? matches[0]?.id ?? null;
  if (matches.length !== 1 || typeof queueId !== 'string' || queueId.trim() === '') {
    throw commandError(
      'Unable to resolve exact Cloudflare Queue ID',
      'WOOCOMMERCE_FINAL_QUEUE_ID_UNRESOLVED',
      { queueName: expectedName, matchCount: matches.length },
    );
  }
  return queueId.trim();
}

export function buildWooCommerceIsolatedMigrationConfig(input = {}) {
  const source = parseJsoncObject(requireText(input.configText, 'configText'));
  const bindings = Array.isArray(source.d1_databases)
    ? source.d1_databases.filter((item) => item?.binding === 'MKT_STATE_DB')
    : [];
  if (bindings.length !== 1) {
    throw commandError(
      'Isolated Migration 0017 requires exactly one MKT_STATE_DB binding',
      'WOOCOMMERCE_FINAL_MIGRATION_CONFIG_INVALID',
      { bindingCount: bindings.length },
    );
  }
  bindings[0].migrations_dir = requireText(input.migrationsDir, 'migrationsDir');
  return `${JSON.stringify(source, null, 2)}\n`;
}

export function validateWooCommercePreMigrationState(row = {}, migrationState = {}) {
  const activeWork = nonNegativeInteger(row.active_work, 'active_work');
  const activeLocks = nonNegativeInteger(row.active_locks, 'active_locks');
  const tableCount = nonNegativeInteger(row.commerce_table_count, 'commerce_table_count');
  const indexCount = nonNegativeInteger(row.commerce_index_count, 'commerce_index_count');
  if (activeWork !== 0 || activeLocks !== 0) {
    throw commandError(
      'Active work or lock blocks isolated Migration 0017',
      'WOOCOMMERCE_FINAL_ACTIVE_WORK_BLOCKED',
      { activeWork, activeLocks },
    );
  }
  const exactSchema = tableCount === 17 && indexCount === 13;
  const emptySchema = tableCount === 0 && indexCount === 0;
  if (migrationState.migration0017Pending ? (!exactSchema && !emptySchema) : !exactSchema) {
    throw commandError(
      'Migration 0017 ledger and WooCommerce schema are inconsistent',
      'WOOCOMMERCE_FINAL_D1_SCHEMA_INCONSISTENT',
      { tableCount, indexCount, migration0017Pending: migrationState.migration0017Pending === true },
    );
  }
  return Object.freeze({ activeWork, activeLocks, tableCount, indexCount });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw commandError(`${fieldName} is required`, 'WOOCOMMERCE_FINAL_ONE_COMMAND_INPUT_REQUIRED', { fieldName });
  }
  return value.trim();
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw commandError(`${fieldName} must be a non-negative integer`, 'WOOCOMMERCE_FINAL_ONE_COMMAND_VALUE_INVALID', { fieldName });
  }
  return number;
}

function commandError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceFinalOneCommandError';
  error.code = code;
  error.details = details;
  return error;
}
