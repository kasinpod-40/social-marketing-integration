import {
  WOOCOMMERCE_FINAL_SOURCE_CONTRACT,
  assertMaterializedSource,
} from './woocommerce-final-source-contract.js';

const APPROVED_ORIGIN = new URL(WOOCOMMERCE_FINAL_SOURCE_CONTRACT.baseUrl).origin;
const SOURCE_FIELDS = Object.freeze([
  'WOOCOMMERCE_BASE_URL',
  'WOOCOMMERCE_API_VERSION',
  'WOOCOMMERCE_API_TIMEOUT_MS',
  'WOOCOMMERCE_DEFAULT_CURRENCY',
]);

/**
 * Materialize the exact non-secret Chemistry K WooCommerce source contract for the local
 * Provider-only diagnostic. Existing explicit values may be omitted or semantically equivalent;
 * conflicting values fail closed before any Provider request.
 */
export function materializeWooCommerceProviderDiagnosticSource(envInput = {}) {
  const env = requireObject(envInput, 'env');
  assertCompatibleOptionalSource(env);

  const materialized = Object.freeze({
    ...env,
    WOOCOMMERCE_BASE_URL: WOOCOMMERCE_FINAL_SOURCE_CONTRACT.baseUrl,
    WOOCOMMERCE_API_VERSION: WOOCOMMERCE_FINAL_SOURCE_CONTRACT.apiVersion,
    WOOCOMMERCE_API_TIMEOUT_MS: String(WOOCOMMERCE_FINAL_SOURCE_CONTRACT.timeoutMs),
    WOOCOMMERCE_DEFAULT_CURRENCY: WOOCOMMERCE_FINAL_SOURCE_CONTRACT.currency,
  });

  assertMaterializedSource(materialized);
  return materialized;
}

export function listWooCommerceProviderDiagnosticSourceFields() {
  return SOURCE_FIELDS;
}

function assertCompatibleOptionalSource(env) {
  assertCompatibleBaseUrl(env.WOOCOMMERCE_BASE_URL);
  assertOptionalExact(
    env.WOOCOMMERCE_API_VERSION,
    WOOCOMMERCE_FINAL_SOURCE_CONTRACT.apiVersion,
    'WOOCOMMERCE_API_VERSION',
  );
  assertOptionalInteger(
    env.WOOCOMMERCE_API_TIMEOUT_MS,
    WOOCOMMERCE_FINAL_SOURCE_CONTRACT.timeoutMs,
    'WOOCOMMERCE_API_TIMEOUT_MS',
  );
  assertOptionalCurrency(
    env.WOOCOMMERCE_DEFAULT_CURRENCY,
    WOOCOMMERCE_FINAL_SOURCE_CONTRACT.currency,
    'WOOCOMMERCE_DEFAULT_CURRENCY',
  );
}

function assertCompatibleBaseUrl(value) {
  if (isMissing(value)) return;

  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw sourceError(
      'Explicit WooCommerce Provider diagnostics source URL is invalid',
      'WOOCOMMERCE_PROVIDER_DIAGNOSTICS_SOURCE_CONFLICT',
      { fieldName: 'WOOCOMMERCE_BASE_URL' },
    );
  }

  if (
    url.origin !== APPROVED_ORIGIN
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
    || url.username !== ''
    || url.password !== ''
  ) {
    throw sourceError(
      'Explicit WooCommerce Provider diagnostics source conflicts with the approved final source',
      'WOOCOMMERCE_PROVIDER_DIAGNOSTICS_SOURCE_CONFLICT',
      {
        fieldName: 'WOOCOMMERCE_BASE_URL',
        expectedOrigin: APPROVED_ORIGIN,
      },
    );
  }
}

function assertOptionalExact(value, expected, fieldName) {
  if (isMissing(value)) return;
  if (String(value).trim() !== expected) {
    throw sourceError(
      `Explicit ${fieldName} conflicts with the approved WooCommerce final source contract`,
      'WOOCOMMERCE_PROVIDER_DIAGNOSTICS_SOURCE_CONFLICT',
      { fieldName, expected },
    );
  }
}

function assertOptionalInteger(value, expected, fieldName) {
  if (isMissing(value)) return;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number !== expected) {
    throw sourceError(
      `Explicit ${fieldName} conflicts with the approved WooCommerce final source contract`,
      'WOOCOMMERCE_PROVIDER_DIAGNOSTICS_SOURCE_CONFLICT',
      { fieldName, expected },
    );
  }
}

function assertOptionalCurrency(value, expected, fieldName) {
  if (isMissing(value)) return;
  if (String(value).trim().toUpperCase() !== expected) {
    throw sourceError(
      `Explicit ${fieldName} conflicts with the approved WooCommerce final source contract`,
      'WOOCOMMERCE_PROVIDER_DIAGNOSTICS_SOURCE_CONFLICT',
      { fieldName, expected },
    );
  }
}

function isMissing(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw sourceError(
      `WooCommerce Provider diagnostics requires object ${fieldName}`,
      'WOOCOMMERCE_PROVIDER_DIAGNOSTICS_SOURCE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function sourceError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceProviderDiagnosticsSourceError';
  error.code = code;
  error.details = details;
  return error;
}
