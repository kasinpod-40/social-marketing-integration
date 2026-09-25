import {
  isD1RuntimeConfigKeyAllowed,
  requireD1RuntimeConfigKey,
} from '../../packages/config/src/d1-runtime-config-contract.js';
import {
  parseWranglerJsonc,
  readWranglerScalarVars,
} from './wrangler-jsonc-vars.js';

export function buildRuntimeConfigCutoverPlan(input = {}) {
  const sourceText = requireText(input.sourceText, 'sourceText');
  const vars = readWranglerScalarVars(sourceText);
  const parsed = parseWranglerJsonc(sourceText);
  const environment = requireEnvironment(vars.MKT_ENV);
  const customerKey = requireText(vars.MKT_CONNECTION_CUSTOMER_KEY, 'MKT_CONNECTION_CUSTOMER_KEY');
  const databaseName = resolveDatabaseName(parsed);
  const extraValues = normalizeExtraValues(input.extraValues);
  const values = { ...vars, ...extraValues };
  const rows = Object.entries(values)
    .filter(([key]) => isD1RuntimeConfigKeyAllowed(key))
    .map(([key, value]) => Object.freeze({
      configKey: requireD1RuntimeConfigKey(key),
      configValue: String(value),
    }))
    .sort((left, right) => left.configKey.localeCompare(right.configKey));
  if (rows.length === 0) throw new TypeError('No allowlisted runtime config values were found');

  const removableKeys = rows
    .map((row) => row.configKey)
    .filter((key) => Object.hasOwn(vars, key));
  return Object.freeze({
    environment,
    customerKey,
    databaseName,
    rows: Object.freeze(rows),
    removableKeys: Object.freeze(removableKeys),
    prunedSourceText: removeWranglerScalarVarLines(sourceText, removableKeys),
    sql: buildUpsertSql({
      environment,
      customerKey,
      rows,
      updatedAt: input.updatedAt ?? Date.now(),
    }),
  });
}

export function removeWranglerScalarVarLines(sourceText, keys = []) {
  let next = requireText(sourceText, 'sourceText');
  for (const rawKey of keys) {
    const key = requireD1RuntimeConfigKey(rawKey);
    const escaped = escapeRegExp(key);
    const pattern = new RegExp(
      `^[\\t ]*"${escaped}"\\s*:\\s*(?:"(?:\\\\.|[^"\\\\])*"|-?\\d+(?:\\.\\d+)?|true|false)\\s*,?\\s*(?://.*)?(?:\\r?\\n|$)`,
      'gmu',
    );
    const matches = [...next.matchAll(pattern)];
    if (matches.length !== 1) {
      throw new TypeError(`Expected exactly one scalar Wrangler var line for ${key}; found ${matches.length}`);
    }
    next = next.replace(pattern, '');
  }
  return next.replace(/\n{3,}/gu, '\n\n');
}

export function buildUpsertSql(input = {}) {
  const environment = requireEnvironment(input.environment);
  const customerKey = requireText(input.customerKey, 'customerKey');
  const updatedAt = requireInteger(input.updatedAt, 'updatedAt');
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (rows.length === 0) throw new TypeError('rows are required');
  const statements = rows.map((row) => {
    const key = requireD1RuntimeConfigKey(row.configKey);
    const value = String(row.configValue);
    return `INSERT INTO runtime_config (environment, customer_key, config_key, config_value, source, updated_at) VALUES (${sql(environment)}, ${sql(customerKey)}, ${sql(key)}, ${sql(value)}, 'wrangler_cutover', ${updatedAt}) ON CONFLICT(environment, customer_key, config_key) DO UPDATE SET config_value = excluded.config_value, source = excluded.source, updated_at = excluded.updated_at;`;
  });
  statements.push(`SELECT COUNT(*) AS runtime_config_rows FROM runtime_config WHERE environment = ${sql(environment)} AND customer_key = ${sql(customerKey)};`);
  return `${statements.join('\n')}\n`;
}

function resolveDatabaseName(parsed) {
  const matches = Array.isArray(parsed?.d1_databases)
    ? parsed.d1_databases.filter((entry) => entry?.binding === 'MKT_STATE_DB')
    : [];
  if (matches.length !== 1) throw new TypeError('Wrangler config must bind exactly one MKT_STATE_DB');
  return requireText(matches[0].database_name, 'MKT_STATE_DB.database_name');
}

function normalizeExtraValues(value) {
  if (value === undefined || value === null) return Object.freeze({});
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError('extraValues must be an object');
  }
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    requireD1RuntimeConfigKey(key);
    result[key] = requireText(String(raw ?? ''), key);
  }
  return Object.freeze(result);
}

function requireEnvironment(value) {
  const text = requireText(value, 'MKT_ENV');
  if (!['development', 'production'].includes(text)) throw new TypeError('MKT_ENV is invalid');
  return text;
}

function requireInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
