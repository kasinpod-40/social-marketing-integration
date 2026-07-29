import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_API_VERSION = 'wc/v3';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PAGE_SIZE = 100;
const NETWORK_DIAGNOSTIC_TEXT_LIMIT = 500;
const RESPONSE_HEADER_TEXT_LIMIT = 200;
const ALLOWED_COLLECTIONS = new Set([
  'orders',
  'products',
  'products/categories',
  'customers',
  'coupons',
  'system_status',
]);

/**
 * Read-only WooCommerce REST API client.
 * Credentials are sent only through the Authorization header and never appear in URLs.
 */
export class WooCommerceRestClient {
  constructor(input = {}) {
    this.baseUrl = normalizeBaseUrl(input.baseUrl);
    this.consumerKey = requireSecret(input.consumerKey, 'consumerKey');
    this.consumerSecret = requireSecret(input.consumerSecret, 'consumerSecret');
    this.apiVersion = normalizeApiVersion(input.apiVersion ?? DEFAULT_API_VERSION);
    this.pageSize = boundedInteger(input.pageSize ?? DEFAULT_PAGE_SIZE, 'pageSize', 1, MAX_PAGE_SIZE);
    this.timeoutMs = boundedInteger(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs', 1_000, 120_000);
    this.fetchImpl = requireFetch(input.fetchImpl ?? globalThis.fetch);
    this.authorization = createBasicAuthorization(this.consumerKey, this.consumerSecret);
  }

  async getStoreIdentity() {
    const payload = await this.#requestJson('system_status');
    const environment = isPlainObject(payload?.environment) ? payload.environment : {};
    const settings = isPlainObject(payload?.settings) ? payload.settings : {};
    return Object.freeze({
      homeUrl: nullableText(environment.home_url),
      siteUrl: nullableText(environment.site_url),
      wcVersion: nullableText(environment.version),
      wpVersion: nullableText(environment.wp_version),
      timezone: nullableText(settings.timezone),
      currency: nullableText(settings.currency),
      currencyPosition: nullableText(settings.currency_position),
      decimalSeparator: nullableText(settings.decimal_separator),
      thousandSeparator: nullableText(settings.thousand_separator),
      numberOfDecimals: nullableInteger(settings.number_of_decimals),
    });
  }

  async listPage(resource, query = {}) {
    const normalizedResource = normalizeCollectionResource(resource);
    const page = boundedInteger(query.page ?? 1, 'page', 1, 1_000_000);
    const perPage = boundedInteger(query.perPage ?? this.pageSize, 'perPage', 1, MAX_PAGE_SIZE);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('per_page', String(perPage));

    for (const [key, value] of Object.entries(query.params ?? {})) {
      appendQueryParam(params, key, value);
    }

    const response = await this.#request(normalizedResource, { params });
    const records = await parseJsonResponse(response, normalizedResource);
    if (!Array.isArray(records)) {
      throw permanentError('WooCommerce collection response must be an array', {
        code: 'WOOCOMMERCE_SOURCE_CONTRACT_INVALID',
        details: { resource: normalizedResource, page },
      });
    }

    const totalRows = readHeaderInteger(response.headers, 'x-wp-total', records.length);
    const totalPages = readHeaderInteger(
      response.headers,
      'x-wp-totalpages',
      records.length < perPage ? page : page + 1,
    );
    if (page > totalPages && records.length > 0) {
      throw permanentError('WooCommerce pagination headers are inconsistent', {
        code: 'WOOCOMMERCE_PAGINATION_INVALID',
        details: { resource: normalizedResource, page, totalPages, rows: records.length },
      });
    }

    return Object.freeze({
      resource: normalizedResource,
      page,
      perPage,
      totalRows,
      totalPages,
      nextPage: page < totalPages ? page + 1 : null,
      records: Object.freeze(records.map((record) => freezeJson(record))),
      sourceWatermark: latestModifiedTimestamp(records),
    });
  }

  async listOrderRefunds(orderId, query = {}) {
    const id = positiveInteger(orderId, 'orderId');
    return this.#listNestedCollection(`orders/${id}/refunds`, query);
  }

  async listProductVariations(productId, query = {}) {
    const id = positiveInteger(productId, 'productId');
    return this.#listNestedCollection(`products/${id}/variations`, query);
  }

  async *iterateCollection(resource, query = {}) {
    let page = boundedInteger(query.page ?? 1, 'page', 1, 1_000_000);
    const maxPages = boundedInteger(query.maxPages ?? 10_000, 'maxPages', 1, 10_000);
    let pagesRead = 0;
    while (pagesRead < maxPages) {
      const result = await this.listPage(resource, { ...query, page });
      yield result;
      pagesRead += 1;
      if (result.nextPage === null) return;
      page = result.nextPage;
    }
    throw transientError('WooCommerce pagination exceeded the configured bound', {
      code: 'WOOCOMMERCE_PAGINATION_BOUND_EXCEEDED',
      details: { resource: normalizeCollectionResource(resource), maxPages },
    });
  }

  async #listNestedCollection(resource, query) {
    const page = boundedInteger(query.page ?? 1, 'page', 1, 1_000_000);
    const perPage = boundedInteger(query.perPage ?? this.pageSize, 'perPage', 1, MAX_PAGE_SIZE);
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    for (const [key, value] of Object.entries(query.params ?? {})) appendQueryParam(params, key, value);
    const response = await this.#request(resource, { params });
    const records = await parseJsonResponse(response, resource);
    if (!Array.isArray(records)) {
      throw permanentError('WooCommerce nested collection response must be an array', {
        code: 'WOOCOMMERCE_SOURCE_CONTRACT_INVALID',
        details: { resource, page },
      });
    }
    const totalRows = readHeaderInteger(response.headers, 'x-wp-total', records.length);
    const totalPages = readHeaderInteger(response.headers, 'x-wp-totalpages', records.length < perPage ? page : page + 1);
    return Object.freeze({
      resource,
      page,
      perPage,
      totalRows,
      totalPages,
      nextPage: page < totalPages ? page + 1 : null,
      records: Object.freeze(records.map((record) => freezeJson(record))),
      sourceWatermark: latestModifiedTimestamp(records),
    });
  }

  async #requestJson(resource) {
    const response = await this.#request(resource);
    return parseJsonResponse(response, resource);
  }

  async #request(resource, options = {}) {
    const url = buildApiUrl(this.baseUrl, this.apiVersion, resource, options.params);
    const startedAt = Date.now();
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: this.authorization,
          'User-Agent': 'social-marketing-integration/woocommerce-readonly',
        },
        signal: createTimeoutSignal(this.timeoutMs),
      });
    } catch (cause) {
      throw transientError('WooCommerce request failed before receiving a response', {
        code: 'WOOCOMMERCE_NETWORK_ERROR',
        cause,
        details: {
          resource,
          timeoutMs: this.timeoutMs,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          networkCause: describeNetworkCause(cause),
        },
      });
    }

    if (response.ok) return response;
    const providerError = await readProviderError(response);
    const details = {
      resource,
      status: response.status,
      providerCode: providerError.code,
      retryAfterSeconds: readRetryAfterSeconds(response.headers),
    };
    if (response.status === 401 || response.status === 403) {
      throw permanentError('WooCommerce authentication or permission was rejected', {
        code: 'WOOCOMMERCE_AUTHORIZATION_FAILED',
        details,
      });
    }
    if (response.status === 404) {
      throw permanentError('WooCommerce REST endpoint was not found', {
        code: 'WOOCOMMERCE_ENDPOINT_NOT_FOUND',
        details,
      });
    }
    if ([408, 425, 429].includes(response.status) || response.status >= 500) {
      throw transientError('WooCommerce REST API returned a retryable response', {
        code: response.status === 429 ? 'WOOCOMMERCE_RATE_LIMITED' : 'WOOCOMMERCE_UPSTREAM_TRANSIENT',
        details,
      });
    }
    throw permanentError('WooCommerce REST API rejected the request', {
      code: 'WOOCOMMERCE_REQUEST_REJECTED',
      details,
    });
  }
}

function normalizeBaseUrl(value) {
  const text = requireText(value, 'baseUrl');
  let url;
  try { url = new URL(text); } catch (cause) {
    throw permanentError('WooCommerce baseUrl must be a valid URL', {
      code: 'WOOCOMMERCE_CONFIG_INVALID', cause,
    });
  }
  if (url.protocol !== 'https:') {
    throw permanentError('WooCommerce REST API requires HTTPS', {
      code: 'WOOCOMMERCE_HTTPS_REQUIRED',
    });
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/u, '');
}

function normalizeApiVersion(value) {
  const text = requireText(value, 'apiVersion').replace(/^\/+|\/+$/gu, '');
  if (!/^wc\/v\d+$/u.test(text)) {
    throw permanentError('WooCommerce apiVersion must look like wc/v3', {
      code: 'WOOCOMMERCE_CONFIG_INVALID',
    });
  }
  return text;
}

function normalizeCollectionResource(value) {
  const text = requireText(value, 'resource').replace(/^\/+|\/+$/gu, '');
  if (!ALLOWED_COLLECTIONS.has(text)) {
    throw permanentError('WooCommerce collection is not allowlisted', {
      code: 'WOOCOMMERCE_RESOURCE_NOT_ALLOWED',
      details: { resource: text },
    });
  }
  return text;
}

function buildApiUrl(baseUrl, apiVersion, resource, params) {
  const safeResource = requireText(resource, 'resource').replace(/^\/+|\/+$/gu, '');
  if (!/^(?:orders\/\d+\/refunds|products\/\d+\/variations|[a-z_]+(?:\/[a-z_]+)?)$/u.test(safeResource)) {
    throw permanentError('WooCommerce resource path is invalid', {
      code: 'WOOCOMMERCE_RESOURCE_NOT_ALLOWED',
    });
  }
  const url = new URL(`${baseUrl}/wp-json/${apiVersion}/${safeResource}`);
  if (params) url.search = params.toString();
  return url.toString();
}

function appendQueryParam(params, key, value) {
  const normalizedKey = requireText(key, 'query key');
  if (!/^[a-z_]+$/u.test(normalizedKey)) {
    throw permanentError('WooCommerce query parameter is invalid', {
      code: 'WOOCOMMERCE_QUERY_INVALID',
      details: { fieldName: normalizedKey },
    });
  }
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value)) {
    params.set(normalizedKey, value.map((item) => String(item)).join(','));
    return;
  }
  if (typeof value === 'boolean') {
    params.set(normalizedKey, value ? 'true' : 'false');
    return;
  }
  params.set(normalizedKey, String(value));
}

function createBasicAuthorization(consumerKey, consumerSecret) {
  const bytes = new TextEncoder().encode(`${consumerKey}:${consumerSecret}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof globalThis.btoa !== 'function') {
    throw permanentError('Base64 encoder is unavailable for WooCommerce Basic Auth', {
      code: 'WOOCOMMERCE_AUTH_RUNTIME_UNAVAILABLE',
    });
  }
  return `Basic ${globalThis.btoa(binary)}`;
}

async function parseJsonResponse(response, resource) {
  if (response.status === 204) return [];
  let body;
  try {
    body = await response.text();
  } catch (cause) {
    throw transientError('WooCommerce response body could not be read', {
      code: 'WOOCOMMERCE_RESPONSE_READ_FAILED',
      cause,
      details: responseMetadata(response, resource),
    });
  }
  const bomRemoved = body.charCodeAt(0) === 0xfeff;
  const normalizedBody = bomRemoved ? body.slice(1) : body;
  try {
    return JSON.parse(normalizedBody);
  } catch {
    throw permanentError('WooCommerce returned invalid JSON', {
      code: 'WOOCOMMERCE_INVALID_JSON',
      details: await describeInvalidJsonResponse(response, resource, body, bomRemoved),
    });
  }
}

async function describeInvalidJsonResponse(response, resource, body, bomRemoved) {
  const bytes = new TextEncoder().encode(body);
  return Object.freeze({
    ...responseMetadata(response, resource),
    bodyByteLength: bytes.byteLength,
    bodySha256: await sha256Hex(bytes),
    bodyShape: classifyResponseBody(body, bomRemoved),
    bomRemoved,
  });
}

function responseMetadata(response, resource) {
  return Object.freeze({
    resource,
    responseStatus: Number.isSafeInteger(response?.status) ? response.status : null,
    contentType: readBoundedHeader(response?.headers, 'content-type'),
    contentEncoding: readBoundedHeader(response?.headers, 'content-encoding'),
    contentLengthHeader: readOptionalHeaderInteger(response?.headers, 'content-length'),
  });
}

function classifyResponseBody(body, bomRemoved) {
  const normalized = bomRemoved ? body.slice(1) : body;
  const trimmed = normalized.trimStart();
  if (trimmed === '') return 'empty';
  if (trimmed.startsWith('<')) return 'html_or_xml';
  if (trimmed.startsWith('{')) return 'json_object_like';
  if (trimmed.startsWith('[')) return 'json_array_like';
  return 'other';
}

async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') return null;
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readBoundedHeader(headers, name) {
  const raw = headers?.get?.(name);
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text === '' ? null : text.slice(0, RESPONSE_HEADER_TEXT_LIMIT);
}

function readOptionalHeaderInteger(headers, name) {
  const raw = headers?.get?.(name);
  if (raw === null || raw === undefined || raw === '') return null;
  if (!/^\d+$/u.test(String(raw).trim())) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

async function readProviderError(response) {
  try {
    const body = await response.clone().json();
    return Object.freeze({ code: nullableText(body?.code), message: nullableText(body?.message) });
  } catch {
    return Object.freeze({ code: null, message: null });
  }
}

function readHeaderInteger(headers, name, fallback) {
  const raw = headers?.get?.(name);
  if (raw === null || raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw permanentError('WooCommerce pagination header is invalid', {
      code: 'WOOCOMMERCE_PAGINATION_INVALID',
      details: { header: name },
    });
  }
  return value;
}

function readRetryAfterSeconds(headers) {
  const raw = headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isSafeInteger(seconds) && seconds >= 0) return seconds;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)) : null;
}

function latestModifiedTimestamp(records) {
  let latest = null;
  for (const record of records) {
    const value = record?.date_modified_gmt ?? record?.date_modified ?? record?.date_created_gmt ?? null;
    const timestamp = typeof value === 'string' ? Date.parse(ensureUtc(value)) : Number.NaN;
    if (Number.isFinite(timestamp) && (latest === null || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

function ensureUtc(value) {
  return /(?:Z|[+-]\d\d:\d\d)$/u.test(value) ? value : `${value}Z`;
}

function createTimeoutSignal(timeoutMs) {
  return typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
}

function describeNetworkCause(cause) {
  const nested = cause && typeof cause === 'object' ? cause.cause : null;
  return Object.freeze({
    name: diagnosticText(cause?.name) ?? 'Error',
    message: diagnosticText(cause?.message ?? cause),
    code: diagnosticText(cause?.code),
    nestedName: diagnosticText(nested?.name),
    nestedMessage: diagnosticText(nested?.message),
    nestedCode: diagnosticText(nested?.code),
  });
}

function diagnosticText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text.slice(0, NETWORK_DIAGNOSTIC_TEXT_LIMIT);
}

function freezeJson(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => freezeJson(item)));
  if (isPlainObject(value)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, freezeJson(nested)])));
  }
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nullableText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function nullableInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function requireFetch(value) {
  if (typeof value !== 'function') {
    throw permanentError('WooCommerce fetch implementation is unavailable', {
      code: 'WOOCOMMERCE_CONFIG_INVALID',
    });
  }
  return value;
}

function requireSecret(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^ck_/u.test(text) && fieldName === 'consumerKey') {
    throw permanentError('WooCommerce consumerKey format is invalid', {
      code: 'WOOCOMMERCE_CONFIG_INVALID', details: { fieldName },
    });
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`WooCommerce requires ${fieldName}`, {
      code: 'WOOCOMMERCE_CONFIG_INVALID', details: { fieldName },
    });
  }
  return value.trim();
}

function boundedInteger(value, fieldName, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw permanentError(`WooCommerce ${fieldName} must be an integer from ${min} to ${max}`, {
      code: 'WOOCOMMERCE_CONFIG_INVALID', details: { fieldName },
    });
  }
  return number;
}

function positiveInteger(value, fieldName) {
  return boundedInteger(value, fieldName, 1, Number.MAX_SAFE_INTEGER);
}
