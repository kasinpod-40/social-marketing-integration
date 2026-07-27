import { WOOCOMMERCE_LARK_TABLES } from '../../application/src/commerce/woocommerce-commerce-model.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

const DEFAULT_API_VERSION = 'wc/v3';
const DEFAULT_REPORTING_TIMEZONE = 'Asia/Bangkok';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OVERLAP_SECONDS = 300;
const DEFAULT_MAX_PAGES_PER_INVOCATION = 2;
const DEFAULT_MAX_NESTED_PAGES = 100;
const DEFAULT_NESTED_CONCURRENCY = 3;
const DEFAULT_REVISION_LOOKBACK_DAYS = 30;

export const WOOCOMMERCE_LARK_TABLE_KEYS = Object.freeze(
  WOOCOMMERCE_LARK_TABLES.map((entry) => entry.tableKey),
);

/**
 * อ่าน WooCommerce runtime แบบ fail-closed โดยทุก Execution gate เป็น false เมื่อไม่กำหนด.
 * Consumer Key/Secret จะถูกบังคับเฉพาะเมื่อ Connector gate เปิด เพื่อให้ Safe deploy ไม่อ่าน Secret.
 */
export function readWooCommerceRuntimeConfig(env = {}) {
  const flags = Object.freeze({
    connector: readBoolean(env.MKT_CONNECTOR_WOOCOMMERCE_ENABLED, 'MKT_CONNECTOR_WOOCOMMERCE_ENABLED', false),
    d1Write: readBoolean(env.MKT_WOOCOMMERCE_D1_WRITE_ENABLED, 'MKT_WOOCOMMERCE_D1_WRITE_ENABLED', false),
    larkWrite: readBoolean(env.MKT_WOOCOMMERCE_LARK_WRITE_ENABLED, 'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED', false),
    reportRead: readBoolean(env.MKT_WOOCOMMERCE_REPORT_READ_ENABLED, 'MKT_WOOCOMMERCE_REPORT_READ_ENABLED', false),
    fullReconciliation: readBoolean(
      env.MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED,
      'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED',
      false,
    ),
    schedule: readBoolean(env.MKT_SCHEDULE_WOOCOMMERCE_ENABLED, 'MKT_SCHEDULE_WOOCOMMERCE_ENABLED', false),
  });

  const source = flags.connector
    ? Object.freeze({
      baseUrl: requireHttpsUrl(env.WOOCOMMERCE_BASE_URL, 'WOOCOMMERCE_BASE_URL'),
      consumerKey: requireConsumerKey(env.WOOCOMMERCE_CONSUMER_KEY),
      consumerSecret: requireText(env.WOOCOMMERCE_CONSUMER_SECRET, 'WOOCOMMERCE_CONSUMER_SECRET'),
      apiVersion: readApiVersion(env.WOOCOMMERCE_API_VERSION),
      timeoutMs: readInteger(env.WOOCOMMERCE_API_TIMEOUT_MS, 'WOOCOMMERCE_API_TIMEOUT_MS', 1_000, 120_000, DEFAULT_TIMEOUT_MS),
    })
    : null;

  return Object.freeze({
    flags,
    source,
    reportingTimezone: optionalText(env.DEFAULT_TIMEZONE) ?? DEFAULT_REPORTING_TIMEZONE,
    defaultCurrency: readCurrency(env.WOOCOMMERCE_DEFAULT_CURRENCY),
    limits: Object.freeze({
      pageSize: readInteger(env.WOOCOMMERCE_PAGE_SIZE, 'WOOCOMMERCE_PAGE_SIZE', 1, 100, DEFAULT_PAGE_SIZE),
      overlapSeconds: readInteger(
        env.WOOCOMMERCE_INCREMENTAL_OVERLAP_SECONDS,
        'WOOCOMMERCE_INCREMENTAL_OVERLAP_SECONDS',
        0,
        86_400,
        DEFAULT_OVERLAP_SECONDS,
      ),
      maxPagesPerInvocation: readInteger(
        env.WOOCOMMERCE_MAX_PAGES_PER_INVOCATION,
        'WOOCOMMERCE_MAX_PAGES_PER_INVOCATION',
        1,
        20,
        DEFAULT_MAX_PAGES_PER_INVOCATION,
      ),
      maxNestedPages: readInteger(
        env.WOOCOMMERCE_MAX_NESTED_PAGES,
        'WOOCOMMERCE_MAX_NESTED_PAGES',
        1,
        1_000,
        DEFAULT_MAX_NESTED_PAGES,
      ),
      nestedConcurrency: readInteger(
        env.WOOCOMMERCE_NESTED_CONCURRENCY,
        'WOOCOMMERCE_NESTED_CONCURRENCY',
        1,
        10,
        DEFAULT_NESTED_CONCURRENCY,
      ),
      revisionLookbackDays: readInteger(
        env.WOOCOMMERCE_REVISION_LOOKBACK_DAYS,
        'WOOCOMMERCE_REVISION_LOOKBACK_DAYS',
        1,
        365,
        DEFAULT_REVISION_LOOKBACK_DAYS,
      ),
    }),
  });
}

function readBoolean(value, fieldName, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw configError(`${fieldName} must be true or false`, fieldName);
}

function readInteger(value, fieldName, minimum, maximum, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw configError(`${fieldName} must be an integer from ${minimum} to ${maximum}`, fieldName);
  }
  return number;
}

function readApiVersion(value) {
  const text = optionalText(value) ?? DEFAULT_API_VERSION;
  if (!/^wc\/v\d+$/u.test(text)) {
    throw configError('WOOCOMMERCE_API_VERSION must look like wc/v3', 'WOOCOMMERCE_API_VERSION');
  }
  return text;
}

function readCurrency(value) {
  const text = optionalText(value);
  if (text === null) return null;
  const currency = text.toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) {
    throw configError('WOOCOMMERCE_DEFAULT_CURRENCY must be an ISO 4217 code', 'WOOCOMMERCE_DEFAULT_CURRENCY');
  }
  return currency;
}

function requireHttpsUrl(value, fieldName) {
  const text = requireText(value, fieldName);
  let url;
  try {
    url = new URL(text);
  } catch (cause) {
    throw permanentError(`${fieldName} must be a valid HTTPS URL`, {
      code: 'WOOCOMMERCE_RUNTIME_CONFIG_INVALID',
      cause,
      details: { fieldName },
    });
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw configError(`${fieldName} must be a credential-free HTTPS origin`, fieldName);
  }
  return url.toString().replace(/\/+$/u, '');
}

function requireConsumerKey(value) {
  const text = requireText(value, 'WOOCOMMERCE_CONSUMER_KEY');
  if (!/^ck_[A-Za-z0-9]+$/u.test(text)) {
    throw configError('WOOCOMMERCE_CONSUMER_KEY has an invalid format', 'WOOCOMMERCE_CONSUMER_KEY');
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw configError(`${fieldName} is required`, fieldName);
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function configError(message, fieldName) {
  return permanentError(message, {
    code: 'WOOCOMMERCE_RUNTIME_CONFIG_INVALID',
    details: { fieldName },
  });
}
