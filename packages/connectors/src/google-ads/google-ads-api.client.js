import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_API_ORIGIN = 'https://googleads.googleapis.com';
const DEFAULT_API_VERSION = 'v24';
const ACCESS_PENDING_CODES = new Set([
  'DEVELOPER_TOKEN_NOT_APPROVED',
  'DEVELOPER_TOKEN_PROHIBITED',
  'DEVELOPER_TOKEN_NOT_ON_ALLOWLIST',
]);

/** Read-only Google Ads identity/access validation; ไม่มี Campaign query และไม่มี write path */
export class GoogleAdsApiClient {
  constructor(config = {}) {
    this.developerToken = requireText(config.developerToken, 'developerToken');
    this.loginCustomerId = normalizeCustomerId(config.loginCustomerId, 'loginCustomerId');
    this.targetCustomerId = normalizeCustomerId(config.targetCustomerId, 'targetCustomerId');
    this.apiOrigin = requireHttpsOrigin(config.apiOrigin ?? DEFAULT_API_ORIGIN);
    this.apiVersion = requireVersion(config.apiVersion ?? DEFAULT_API_VERSION);
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof this.fetchImpl !== 'function') throw new TypeError('GoogleAdsApiClient requires fetch');
    this.timeoutMs = positiveInteger(config.timeoutMs ?? 30_000, 'timeoutMs');
  }

  async validateTargetCustomer(accessToken) {
    const url = new URL(
      `/${this.apiVersion}/customers/${this.targetCustomerId}/googleAds:search`,
      this.apiOrigin,
    );
    const response = await this.request(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${requireText(accessToken, 'accessToken')}`,
        'content-type': 'application/json',
        'developer-token': this.developerToken,
        'login-customer-id': this.loginCustomerId,
      },
      body: JSON.stringify({
        query: [
          'SELECT customer.id, customer.descriptive_name,',
          'customer.currency_code, customer.time_zone',
          'FROM customer LIMIT 1',
        ].join(' '),
        pageSize: 1,
      }),
    });
    const payload = await parseJson(response);
    if (!response.ok || payload?.error) throwGoogleAdsError(response.status, payload);
    const customer = payload?.results?.[0]?.customer;
    const id = normalizeCustomerId(customer?.id, 'customer.id');
    if (id !== this.targetCustomerId) {
      throw permanentError('Google Ads customer identity validation failed', {
        code: 'GOOGLE_ADS_CUSTOMER_IDENTITY_MISMATCH',
      });
    }
    return Object.freeze({
      customerId: id,
      descriptiveName: optionalText(customer?.descriptiveName),
      currencyCode: optionalText(customer?.currencyCode),
      timeZone: optionalText(customer?.timeZone),
    });
  }

  async request(url, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (cause) {
      throw transientError('Google Ads API request failed', {
        code: 'GOOGLE_ADS_API_NETWORK_ERROR',
        cause,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function throwGoogleAdsError(status, payload) {
  const errorCodes = collectErrorCodes(payload);
  if ([...errorCodes].some((code) => ACCESS_PENDING_CODES.has(code))) {
    throw permanentError('Google Ads developer access is pending', {
      code: 'GOOGLE_ADS_API_ACCESS_PENDING',
      details: { status },
    });
  }
  const retryable = status === 429 || status >= 500;
  const factory = retryable ? transientError : permanentError;
  throw factory('Google Ads API validation was rejected', {
    code: retryable ? 'GOOGLE_ADS_API_TRANSIENT_ERROR' : 'GOOGLE_ADS_API_ACCESS_REJECTED',
    details: { status },
  });
}

function collectErrorCodes(payload) {
  const output = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (
        /error(?:Code)?$/iu.test(key)
        && typeof nested === 'string'
        && /^[A-Z][A-Z0-9_]+$/u.test(nested)
      ) output.add(nested);
      visit(nested);
    }
  };
  visit(payload);
  return output;
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch (cause) {
    throw transientError('Google Ads API returned invalid JSON', {
      code: 'GOOGLE_ADS_API_INVALID_RESPONSE',
      cause,
      details: { status: response.status },
    });
  }
}

function normalizeCustomerId(value, fieldName) {
  const id = requireText(value, fieldName).replaceAll('-', '');
  if (!/^\d{10}$/u.test(id)) throw new TypeError(`${fieldName} must be a 10-digit customer ID`);
  return id;
}

function requireHttpsOrigin(value) {
  const url = new URL(requireText(value, 'apiOrigin'));
  if (url.protocol !== 'https:' || url.pathname !== '/') throw new TypeError('apiOrigin must be HTTPS');
  return url.toString();
}

function requireVersion(value) {
  const version = requireText(value, 'apiVersion');
  if (!/^v\d+$/u.test(version)) throw new TypeError('apiVersion is invalid');
  return version;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  return text || null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}
