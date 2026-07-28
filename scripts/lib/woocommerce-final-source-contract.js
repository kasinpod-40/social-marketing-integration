import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

export const WOOCOMMERCE_FINAL_SOURCE_CONTRACT = Object.freeze({
  baseUrl: 'https://chemistryk.online',
  hostname: 'chemistryk.online',
  apiVersion: 'wc/v3',
  timeoutMs: 45_000,
  currency: 'THB',
});

const SECRET_NAMES = new Set([
  'WOOCOMMERCE_CONSUMER_KEY',
  'WOOCOMMERCE_CONSUMER_SECRET',
]);

/**
 * สร้าง config ชั่วคราวสำหรับ Final rollout โดยผูก Source identity จริงแบบ non-secret
 * และ rebase path ให้ใช้ได้แม้ไฟล์ generated อยู่ใต้ outputs/.
 */
export function buildWooCommerceFinalSourceConfig(sourceText, input = {}) {
  const repositoryRoot = requireText(input.repositoryRoot, 'repositoryRoot');
  const sourceConfigPath = requireText(input.sourceConfigPath, 'sourceConfigPath');
  const source = parseJsoncObject(sourceText);
  const vars = requireObject(source.vars, 'vars');

  requireExact(vars.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(vars.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(vars.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  const leakedSecrets = [...SECRET_NAMES].filter((name) => (
    vars[name] !== undefined && String(vars[name]).trim() !== ''
  ));
  if (leakedSecrets.length > 0) {
    throw contractError(
      'WooCommerce credentials must not be stored in Wrangler vars',
      'WOOCOMMERCE_FINAL_SOURCE_SECRET_VALUE_BLOCKED',
      { secretVarNames: leakedSecrets.sort() },
    );
  }

  const config = structuredClone(source);
  const nextVars = structuredClone(vars);
  nextVars.WOOCOMMERCE_BASE_URL = WOOCOMMERCE_FINAL_SOURCE_CONTRACT.baseUrl;
  nextVars.WOOCOMMERCE_API_VERSION = WOOCOMMERCE_FINAL_SOURCE_CONTRACT.apiVersion;
  nextVars.WOOCOMMERCE_API_TIMEOUT_MS = String(WOOCOMMERCE_FINAL_SOURCE_CONTRACT.timeoutMs);
  nextVars.WOOCOMMERCE_DEFAULT_CURRENCY = WOOCOMMERCE_FINAL_SOURCE_CONTRACT.currency;
  config.vars = nextVars;

  const configDirectory = dirname(resolve(repositoryRoot, sourceConfigPath));
  config.main = rebasePath(config.main, configDirectory, 'main');
  if (Array.isArray(config.d1_databases)) {
    config.d1_databases = config.d1_databases.map((database) => {
      if (!database || typeof database !== 'object' || Array.isArray(database)) return database;
      const copy = { ...database };
      if (copy.migrations_dir !== undefined) {
        copy.migrations_dir = rebasePath(copy.migrations_dir, configDirectory, 'migrations_dir');
      }
      return copy;
    });
  }
  delete config.$schema;

  const text = `${JSON.stringify(config, null, 2)}\n`;
  const checked = parseJsoncObject(text);
  assertMaterializedSource(checked.vars);

  return Object.freeze({
    text,
    sha256: sha256(text),
    hostname: WOOCOMMERCE_FINAL_SOURCE_CONTRACT.hostname,
    apiVersion: WOOCOMMERCE_FINAL_SOURCE_CONTRACT.apiVersion,
    timeoutMs: WOOCOMMERCE_FINAL_SOURCE_CONTRACT.timeoutMs,
    currency: WOOCOMMERCE_FINAL_SOURCE_CONTRACT.currency,
    secretValuesCopied: 0,
  });
}

export function assertMaterializedSource(varsInput) {
  const vars = requireObject(varsInput, 'vars');
  let url;
  try {
    url = new URL(requireText(vars.WOOCOMMERCE_BASE_URL, 'WOOCOMMERCE_BASE_URL'));
  } catch (cause) {
    throw contractError(
      'WooCommerce final source URL is invalid',
      'WOOCOMMERCE_FINAL_SOURCE_CONTRACT_INVALID',
      { fieldName: 'WOOCOMMERCE_BASE_URL', cause: cause?.message ?? 'URL_INVALID' },
    );
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== WOOCOMMERCE_FINAL_SOURCE_CONTRACT.hostname
    || url.pathname !== '/'
    || url.search
    || url.hash
    || url.username
    || url.password
  ) {
    throw contractError(
      'WooCommerce final source must be the exact Chemistry K HTTPS origin',
      'WOOCOMMERCE_FINAL_SOURCE_CONTRACT_INVALID',
      { fieldName: 'WOOCOMMERCE_BASE_URL', expectedHostname: WOOCOMMERCE_FINAL_SOURCE_CONTRACT.hostname },
    );
  }
  requireExact(vars.WOOCOMMERCE_API_VERSION, WOOCOMMERCE_FINAL_SOURCE_CONTRACT.apiVersion, 'WOOCOMMERCE_API_VERSION');
  requireExact(String(vars.WOOCOMMERCE_API_TIMEOUT_MS), String(WOOCOMMERCE_FINAL_SOURCE_CONTRACT.timeoutMs), 'WOOCOMMERCE_API_TIMEOUT_MS');
  requireExact(vars.WOOCOMMERCE_DEFAULT_CURRENCY, WOOCOMMERCE_FINAL_SOURCE_CONTRACT.currency, 'WOOCOMMERCE_DEFAULT_CURRENCY');
  return true;
}

function rebasePath(value, baseDirectory, fieldName) {
  const text = requireText(value, fieldName);
  return isAbsolute(text) ? text : resolve(baseDirectory, text);
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(
      `WooCommerce final source requires object ${fieldName}`,
      'WOOCOMMERCE_FINAL_SOURCE_CONFIG_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw contractError(
      `WooCommerce final source ${fieldName} is required`,
      'WOOCOMMERCE_FINAL_SOURCE_CONFIG_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw contractError(
      `WooCommerce final source requires ${fieldName}=${expected}`,
      'WOOCOMMERCE_FINAL_SOURCE_CONTRACT_INVALID',
      { fieldName, expected },
    );
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function contractError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceFinalSourceContractError';
  error.code = code;
  error.details = details;
  return error;
}
