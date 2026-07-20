import {
  permanentError,
  transientError,
} from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_USAGE_THROTTLE_THRESHOLD = 90;
const DEFAULT_USAGE_THROTTLE_DELAY_MS = 1_000;
const META_RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const USAGE_HEADER_NAMES = Object.freeze([
  'x-app-usage',
  'x-page-usage',
  'x-ad-account-usage',
  'x-business-use-case-usage',
]);

/**
 * Shared Meta Graph transport สำหรับ Facebook Page, Instagram Professional และ Meta Ads
 *
 * Client รับผิดชอบเฉพาะ Transport/Auth/Error/Rate budget และ Cursor contract:
 * - Token ส่งผ่าน Authorization header เท่านั้น
 * - `getPage()` อ่านหนึ่งหน้าเพื่อให้ Application persist cursor/unit แบบ Durable ได้
 * - `listEdge()` เป็น compatibility helper สำหรับ bounded small collections เท่านั้น
 * - Timeout ครอบทั้ง Fetch, Response headers และการอ่าน Response body
 * - Retry เฉพาะ Error ชั่วคราวพร้อม bounded exponential backoff
 */
export class MetaGraphClient {
  constructor(config = {}) {
    this.accessToken = requireText(config.accessToken, 'accessToken');
    this.apiVersion = normalizeApiVersion(config.apiVersion);
    const fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof fetchImpl !== 'function') throw new TypeError('MetaGraphClient requires fetch');
    this.fetchImpl = (...args) => fetchImpl(...args);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = positiveInteger(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
    this.maxPages = positiveInteger(config.maxPages ?? DEFAULT_MAX_PAGES, 'maxPages');
    this.pageSize = positiveInteger(config.pageSize ?? DEFAULT_PAGE_SIZE, 'pageSize');
    this.maxAttempts = positiveInteger(config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 'maxAttempts');
    this.retryBaseDelayMs = positiveInteger(
      config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      'retryBaseDelayMs',
    );
    this.maxRetryDelayMs = positiveInteger(
      config.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
      'maxRetryDelayMs',
    );
    this.usageThrottleThreshold = boundedPercentage(
      config.usageThrottleThreshold ?? DEFAULT_USAGE_THROTTLE_THRESHOLD,
      'usageThrottleThreshold',
    );
    this.usageThrottleDelayMs = nonNegativeInteger(
      config.usageThrottleDelayMs ?? DEFAULT_USAGE_THROTTLE_DELAY_MS,
      'usageThrottleDelayMs',
    );
    this.sleep = typeof config.sleepImpl === 'function' ? config.sleepImpl : sleep;
    this.random = typeof config.randomImpl === 'function' ? config.randomImpl : Math.random;
    this.onRequest = typeof config.onRequest === 'function' ? config.onRequest : () => undefined;
  }

  /** อ่าน Graph node/edge request หนึ่งครั้งพร้อม Retry ที่จำแนกแล้ว */
  async get(path, query = {}) {
    const safePath = normalizeGraphPath(path);
    const url = buildGraphUrl({
      baseUrl: this.baseUrl,
      apiVersion: this.apiVersion,
      path: safePath,
      query,
    });

    let lastError = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      this.onRequest({
        stage: 'meta_request_start',
        path: safePath,
        attempt,
        maxAttempts: this.maxAttempts,
      });

      try {
        const { response, text } = await this.fetchWithTimeout(url, safePath);
        const payload = parseJsonPayload(text, response.status, safePath);
        const usage = summarizeUsageHeaders(response.headers);

        this.onRequest({
          stage: 'meta_request_response',
          path: safePath,
          attempt,
          status: response.status,
          usage,
        });

        if (!response.ok || payload?.error) {
          throw createMetaApiError({ response, payload, path: safePath, usage });
        }

        await this.applyUsageThrottle({ path: safePath, usage });
        this.onRequest({
          stage: 'meta_request_success',
          path: safePath,
          attempt,
          status: response.status,
          usage,
        });
        return payload;
      } catch (cause) {
        const error = normalizeMetaRequestError(cause, safePath);
        lastError = error;
        if (!error.retryable || attempt === this.maxAttempts) {
          this.onRequest({
            stage: 'meta_request_failed',
            path: safePath,
            attempt,
            status: error.details?.status ?? null,
            graphCode: error.details?.graphCode ?? null,
            retryable: error.retryable,
            error: error.message,
          });
          throw error;
        }

        const delayMs = calculateRetryDelay({
          attempt,
          baseDelayMs: this.retryBaseDelayMs,
          maxDelayMs: this.maxRetryDelayMs,
          retryAfterMs: error.details?.retryAfterMs,
          random: this.random,
        });
        this.onRequest({
          stage: 'meta_request_retry',
          path: safePath,
          attempt,
          delayMs,
          status: error.details?.status ?? null,
          graphCode: error.details?.graphCode ?? null,
        });
        await this.sleep(delayMs);
      }
    }

    throw lastError ?? transientError('Meta Graph request failed', { code: 'META_NETWORK_ERROR' });
  }

  /**
   * อ่าน Edge หนึ่งหน้าและคืน Cursor ที่ตรวจแล้ว
   * Application ต้อง Persist `nextCursor` หลัง Staging/Business write สำเร็จตาม Durable contract
   */
  async getPage(path, query = {}, options = {}) {
    const safePath = normalizeGraphPath(path);
    const after = optionalText(options.after ?? query.after);
    const pageSize = positiveInteger(options.pageSize ?? query.limit ?? this.pageSize, 'pageSize');
    const visitedCursors = new Set(normalizeCursorList(options.visitedCursors));
    const payload = await this.get(safePath, {
      ...query,
      limit: pageSize,
      ...(after ? { after } : {}),
    });
    const data = payload?.data;
    if (!Array.isArray(data)) {
      throw permanentError('Meta Graph edge response must contain data array', {
        code: 'META_INVALID_RESPONSE',
        details: { path: safePath },
      });
    }

    const hasMore = Boolean(payload?.paging?.next);
    const nextCursor = optionalText(payload?.paging?.cursors?.after);
    if (hasMore && !nextCursor) {
      throw permanentError('Meta Graph paging.next exists without after cursor', {
        code: 'META_INVALID_PAGINATION',
        details: { path: safePath },
      });
    }
    if (nextCursor && (nextCursor === after || visitedCursors.has(nextCursor))) {
      throw permanentError('Meta Graph pagination returned a repeated cursor', {
        code: 'META_INVALID_PAGINATION',
        details: { path: safePath },
      });
    }

    return Object.freeze({
      rows: Object.freeze(data.map((row) => Object.freeze(row))),
      hasMore,
      nextCursor: hasMore ? nextCursor : null,
    });
  }

  /**
   * Compatibility helper สำหรับ Collection ขนาดเล็กที่มีขอบเขตชัดเจน
   * Full backfill/large-account runtime ต้องใช้ `getPage()` + Durable staging เท่านั้น
   */
  async listEdge(path, query = {}) {
    const safePath = normalizeGraphPath(path);
    const rows = [];
    const visitedCursors = new Set();
    let after = null;

    for (let page = 1; page <= this.maxPages; page += 1) {
      const result = await this.getPage(safePath, query, { after, visitedCursors });
      rows.push(...result.rows);
      if (after) visitedCursors.add(after);
      if (!result.hasMore) return Object.freeze(rows);
      after = result.nextCursor;
    }

    throw permanentError('Meta Graph pagination exceeded configured maxPages', {
      code: 'META_PAGINATION_LIMIT',
      details: { path: safePath, maxPages: this.maxPages },
    });
  }

  /** Timeout ครอบ Fetch และ Response body; Token ไม่ถูกใส่ใน URL หรือ Error */
  async fetchWithTimeout(url, safePath) {
    const controller = new AbortController();
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(transientError(`Meta Graph request timed out: ${safePath}`, {
          code: 'META_REQUEST_TIMEOUT',
          details: { path: safePath, timeoutMs: this.timeoutMs },
        }));
      }, this.timeoutMs);
    });
    const requestPromise = (async () => {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: new Headers({
          accept: 'application/json',
          authorization: `Bearer ${this.accessToken}`,
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      return Object.freeze({ response, text });
    })();

    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } catch (cause) {
      if (cause?.code === 'META_REQUEST_TIMEOUT') throw cause;
      if (controller.signal.aborted || cause?.name === 'AbortError') {
        throw transientError(`Meta Graph request timed out: ${safePath}`, {
          code: 'META_REQUEST_TIMEOUT',
          cause,
          details: { path: safePath, timeoutMs: this.timeoutMs },
        });
      }
      throw transientError(`Meta Graph network request failed: ${safePath}`, {
        code: 'META_NETWORK_ERROR',
        cause,
        details: { path: safePath },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** หน่วงแบบ Bounded เมื่อ Usage headers เข้าใกล้ Budget โดยไม่ Persist raw headers/account IDs */
  async applyUsageThrottle({ path, usage }) {
    if (usage.maxPercent < this.usageThrottleThreshold || this.usageThrottleDelayMs === 0) return;
    this.onRequest({
      stage: 'meta_usage_throttle',
      path,
      maxPercent: usage.maxPercent,
      delayMs: this.usageThrottleDelayMs,
    });
    await this.sleep(this.usageThrottleDelayMs);
  }
}

function buildGraphUrl({ baseUrl, apiVersion, path, query }) {
  const url = new URL(`${baseUrl}/${apiVersion}/${path}`);
  for (const [key, value] of Object.entries(requirePlainObject(query, 'query'))) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

function parseJsonPayload(text, status, path) {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw transientError(`Meta Graph returned invalid JSON: ${path}`, {
      code: 'META_INVALID_RESPONSE',
      cause,
      details: { path, status },
    });
  }
}

function createMetaApiError({ response, payload, path, usage }) {
  const metaError = payload?.error ?? {};
  const graphCode = Number(metaError.code);
  const retryable = response.status === 429
    || response.status >= 500
    || metaError.is_transient === true
    || META_RATE_LIMIT_CODES.has(graphCode);
  const factory = retryable ? transientError : permanentError;
  return factory(`Meta Graph request failed: ${path}`, {
    code: retryable ? 'META_TRANSIENT_API_ERROR' : 'META_PERMANENT_API_ERROR',
    details: {
      path,
      status: response.status,
      graphCode: Number.isFinite(graphCode) ? graphCode : null,
      graphSubcode: metaError.error_subcode ?? null,
      traceId: optionalText(metaError.fbtrace_id),
      retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      usage,
    },
  });
}

function normalizeMetaRequestError(error, path) {
  if (error?.retryable === true || error?.retryable === false) return error;
  return transientError(`Meta Graph network request failed: ${path}`, {
    code: 'META_NETWORK_ERROR',
    cause: error,
    details: { path },
  });
}

function summarizeUsageHeaders(headers) {
  const maxima = {
    callCount: 0,
    totalCpuTime: 0,
    totalTime: 0,
    estimatedTimeToRegainAccess: 0,
  };
  for (const headerName of USAGE_HEADER_NAMES) {
    const value = headers.get(headerName);
    if (!value) continue;
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    collectUsageNumbers(parsed, maxima);
  }
  return Object.freeze({
    ...maxima,
    maxPercent: Math.max(maxima.callCount, maxima.totalCpuTime, maxima.totalTime),
  });
}

function collectUsageNumbers(value, maxima) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const child of value) collectUsageNumbers(child, maxima);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[^A-Za-z0-9]/gu, '').toLowerCase();
    const number = Number(child);
    if (Number.isFinite(number) && number >= 0) {
      if (normalizedKey === 'callcount') maxima.callCount = Math.max(maxima.callCount, number);
      if (normalizedKey === 'totalcputime') maxima.totalCpuTime = Math.max(maxima.totalCpuTime, number);
      if (normalizedKey === 'totaltime') maxima.totalTime = Math.max(maxima.totalTime, number);
      if (normalizedKey === 'estimatedtimetoregainaccess') {
        maxima.estimatedTimeToRegainAccess = Math.max(maxima.estimatedTimeToRegainAccess, number);
      }
    }
    collectUsageNumbers(child, maxima);
  }
}

function calculateRetryDelay({ attempt, baseDelayMs, maxDelayMs, retryAfterMs, random }) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(exponential * 0.25 * normalizeRandom(random()));
  return Math.max(nonNegativeInteger(retryAfterMs ?? 0, 'retryAfterMs'), exponential + jitter);
}

function parseRetryAfterMs(value) {
  const text = optionalText(value);
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const instant = Date.parse(text);
  return Number.isFinite(instant) ? Math.max(0, instant - Date.now()) : null;
}

function normalizeCursorList(value) {
  if (value === null || value === undefined) return [];
  if (value instanceof Set) return [...value].map((cursor) => requireText(cursor, 'visitedCursor'));
  if (!Array.isArray(value)) throw new TypeError('visitedCursors must be an array or Set');
  return value.map((cursor) => requireText(cursor, 'visitedCursor'));
}

function normalizeGraphPath(value) {
  const text = requireText(value, 'path').replace(/^\/+|\/+$/gu, '');
  if (text.includes('..') || text.includes('?') || text.includes('#')) {
    throw new TypeError('Meta Graph path must not contain traversal or query fragments');
  }
  return text;
}

function normalizeApiVersion(value) {
  const text = requireText(value, 'apiVersion').toLowerCase();
  if (!/^v\d+\.\d+$/u.test(text)) throw new TypeError('Meta apiVersion must use vNN.N format');
  return text;
}

function normalizeBaseUrl(value) {
  const url = new URL(requireText(value, 'baseUrl'));
  const secure = url.protocol === 'https:';
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (!secure && !localHttp) throw new TypeError('Meta base URL must use HTTPS except local test hosts');
  return url.toString().replace(/\/$/u, '');
}

function requirePlainObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`MetaGraphClient requires object ${fieldName}`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`MetaGraphClient requires ${fieldName}`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a non-negative integer`);
  return number;
}

function boundedPercentage(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new TypeError(`${fieldName} must be between 0 and 100`);
  }
  return number;
}

function normalizeRandom(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
