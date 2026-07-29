import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

const ALLOWED_PENDING_MIGRATIONS = new Set([
  '0017_woocommerce_commerce.sql',
  '0018_chatwoot_analytics.sql',
]);
const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/iu;

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
  const parsed = parseJsonValue(
    output,
    'Cloudflare Queue list returned invalid JSON',
    'WOOCOMMERCE_FINAL_QUEUE_LIST_INVALID',
  );
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

export function resolveCloudflareAccountId(input = {}) {
  const explicit = optionalText(input.explicitAccountId);
  if (explicit) return requireAccountId(explicit, 'CLOUDFLARE_ACCOUNT_ID');

  const config = parseJsoncObject(requireText(input.configText, 'configText'));
  const configured = optionalText(config.account_id);
  if (configured) return requireAccountId(configured, 'wrangler.account_id');

  const parsed = parseJsonValue(
    input.whoamiOutput,
    'Wrangler whoami returned invalid JSON',
    'WOOCOMMERCE_FINAL_WHOAMI_JSON_INVALID',
  );
  const accounts = collectCloudflareAccounts(parsed);
  const preferred = optionalText(input.preferredAccount);
  if (preferred) {
    const preferredMatches = accounts.filter((account) => (
      account.id === preferred || account.name === preferred
    ));
    if (preferredMatches.length === 1) return preferredMatches[0].id;
    throw commandError(
      'Preferred Cloudflare account was not resolved exactly once',
      'WOOCOMMERCE_FINAL_ACCOUNT_PREFERENCE_INVALID',
      { preferredAccount: preferred, matchCount: preferredMatches.length, accountCount: accounts.length },
    );
  }
  if (accounts.length === 1) return accounts[0].id;
  throw commandError(
    accounts.length === 0
      ? 'Wrangler authentication returned no Cloudflare account membership'
      : 'Wrangler authentication has multiple Cloudflare accounts; set CLOUDFLARE_ACCOUNT_ID explicitly',
    accounts.length === 0
      ? 'WOOCOMMERCE_FINAL_ACCOUNT_UNRESOLVED'
      : 'WOOCOMMERCE_FINAL_ACCOUNT_AMBIGUOUS',
    { accountCount: accounts.length },
  );
}

export function resolveCloudflareBearerAuth(input = {}) {
  const explicit = optionalText(input.explicitApiToken);
  if (explicit) {
    return Object.freeze({
      type: 'api_token',
      source: 'environment',
      token: explicit,
    });
  }
  const parsed = parseJsonValue(
    input.authOutput,
    'Wrangler auth token returned invalid JSON',
    'WOOCOMMERCE_FINAL_AUTH_JSON_INVALID',
  );
  const type = optionalText(parsed?.type);
  if (!['api_token', 'oauth'].includes(type)) {
    throw commandError(
      'WooCommerce Queue REST submission requires Wrangler API-token or OAuth bearer authentication',
      'WOOCOMMERCE_FINAL_AUTH_TYPE_UNSUPPORTED',
      { authType: type ?? 'unknown' },
    );
  }
  const token = optionalText(parsed?.token);
  if (!token) {
    throw commandError(
      'Wrangler authentication returned no bearer token',
      'WOOCOMMERCE_FINAL_AUTH_TOKEN_UNRESOLVED',
      { authType: type },
    );
  }
  return Object.freeze({
    type,
    source: 'wrangler_auth_session',
    token,
  });
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

export function validateWooCommercePreMigrationState(
  row = {},
  migrationState = {},
  options = {},
) {
  const activeWork = nonNegativeInteger(row.active_work, 'active_work');
  const activeLocks = nonNegativeInteger(row.active_locks, 'active_locks');
  const tableCount = nonNegativeInteger(row.commerce_table_count, 'commerce_table_count');
  const indexCount = nonNegativeInteger(row.commerce_index_count, 'commerce_index_count');
  const resumeOperationId = optionalText(options.resumeOperationId);
  const pinnedActiveWork = nonNegativeInteger(
    row.pinned_active_work ?? 0,
    'pinned_active_work',
  );
  const otherActiveWork = nonNegativeInteger(
    row.other_active_work ?? activeWork,
    'other_active_work',
  );
  const activeStateValid = resumeOperationId
    ? activeWork === 1 && pinnedActiveWork === 1 && otherActiveWork === 0
    : activeWork === 0;
  if (!activeStateValid || activeLocks !== 0
    || (resumeOperationId && migrationState.migration0017Pending === true)) {
    throw commandError(
      'Active work or lock blocks isolated Migration 0017',
      'WOOCOMMERCE_FINAL_ACTIVE_WORK_BLOCKED',
      {
        activeWork,
        activeLocks,
        pinnedActiveWork,
        otherActiveWork,
        exactContinuation: resumeOperationId !== null,
        migration0017Pending: migrationState.migration0017Pending === true,
      },
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
  return Object.freeze({
    activeWork,
    activeLocks,
    pinnedActiveWork,
    otherActiveWork,
    tableCount,
    indexCount,
  });
}

function collectCloudflareAccounts(value) {
  const byId = new Map();
  visit(value, []);
  return Object.freeze([...byId.values()].sort((left, right) => left.id.localeCompare(right.id)));

  function visit(nested, path) {
    if (Array.isArray(nested)) {
      nested.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }
    if (!nested || typeof nested !== 'object') return;

    const pathText = path.join('.');
    const accountContext = /(?:^|\.)(?:account|accounts|memberships?)(?:\.|$)/iu.test(pathText);
    const directId = optionalText(nested.account_id ?? nested.accountId);
    const contextualId = accountContext ? optionalText(nested.id) : null;
    const id = directId ?? contextualId;
    if (id && CLOUDFLARE_ACCOUNT_ID_PATTERN.test(id)) {
      byId.set(id, Object.freeze({
        id,
        name: optionalText(nested.account_name ?? nested.accountName ?? nested.name),
      }));
    }
    for (const [key, child] of Object.entries(nested)) {
      visit(child, [...path, key]);
    }
  }
}

function parseJsonValue(value, message, code) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(requireText(value, 'jsonOutput'));
  } catch (cause) {
    throw commandError(message, code, { cause: cause?.message ?? 'JSON_PARSE_FAILED' });
  }
}

function requireAccountId(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!CLOUDFLARE_ACCOUNT_ID_PATTERN.test(text)) {
    throw commandError(
      `${fieldName} must be a 32-character Cloudflare Account ID`,
      'WOOCOMMERCE_FINAL_ACCOUNT_ID_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw commandError(`${fieldName} is required`, 'WOOCOMMERCE_FINAL_ONE_COMMAND_INPUT_REQUIRED', { fieldName });
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
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
