import {
  permanentError,
  transientError,
} from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Shared Meta Graph client สำหรับ Facebook Page, Instagram Business และ Meta Ads adapters
 *
 * Client นี้รับผิดชอบเฉพาะ Transport contract:
 * - Bearer authentication โดยไม่ใส่ Token ใน URL
 * - Single-page cursor reads สำหรับ Durable staging
 * - Cursor guards โดยไม่ตาม paging.next URL จาก Response
 * - Timeout ครอบทั้ง Fetch และการอ่าน Response body
 * - Retry แบบมีขอบเขตสำหรับ 429, 5xx, Network และ Meta transient errors
 * - Usage metadata สำหรับให้ Runtime ตัดสินใจ throttle เพิ่มเติม
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
    this.maxResponseBytes = positiveInteger(
      config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      'maxResponseBytes',
    );
    this.retryBaseDelayMs = positiveInteger(
      config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      'retryBaseDelayMs',
    );
    this.maxRetryDelayMs = positiveInteger(
      config.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
      'maxRetryDelayMs',
    );
    this.sleep = typeof config.sleepImpl === 'function' ? config.sleepImpl : sleep;
    this.random = typeof config.randomImpl === 'function' ? config.randomImpl : Math.random;
    this.onRequest = typeof config.onRequest === 'function' ? config.onRequest : () => undefined;
  }

  /** อ่าน Graph node/edge หนึ่งคำขอ พร้อม Retry เฉพาะ Error ที่ทำซ้ำได้ปลอดภัย */
  async get(path, query = {}, options = {}) {
    const safePath = normalizeGraphPath(path);
    const operation = normalizeOperationName(options.operationName);
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      this.onRequest({
        stage: 'meta_request_start',
        operation,
        attempt,
        maxAttempts: this.maxAttempts,
      });
      try {
        const result = await this.#requestOnce(safePath, query, operation);
        this.onRequest({
          stage: 'meta_request_success',
          operation,
          attempt,
          status: result.status,
          usage: result.usage,
        });
        return result.payload;
      } catch (error) {
        lastError = error;
        if (error?.retryable !== true || attempt === this.maxAttempts) {
          this.onRequest({
            stage: 'meta_request_failed',
            operation,
            attempt,
            retryable: error?.retryable === true,
            code: error?.code ?? null,
            status: error?.details?.status ?? null,
          });
          throw error;
        }

        const delayMs = calculateRetryDelay({
          attempt,
          baseDelayMs: this.retryBaseDelayMs,
          maxDelayMs: this.maxRetryDelayMs,
          retryAfter: error?.details?.retryAfter,
          random: this.random,
        });
        this.onRequest({
          stage: 'meta_request_retry',
          operation,
          attempt,
          delayMs,
          code: error?.code ?? null,
          status: error?.details?.status ?? null,
        });
        await this.sleep(delayMs);
      }
    }

    throw lastError ?? transientError('Meta Graph request failed', { code: 'META_REQUEST_FAILED' });
  }

  /**
   * อ่าน Edge เพียงหนึ่งหน้าเพื่อให้ Application persist cursor/page unit ลง Durable store ได้
   * ห้ามส่ง cursor ที่เคยผ่านแล้วใน visitedCursors เพราะจะถือว่า Contract ผิดทันที
   */
  async getPage(path, query = {}, options = {}) {
    const after = optionalText(options.after);
    const operation = normalizeOperationName(options.operationName);
    const visitedCursors = new Set(normalizeCursorList(options.visitedCursors));
    if (after && visitedCursors.has(after)) {
      throw permanentError('Meta Graph pagination received an already visited cursor', {
        code: 'META_CURSOR_REPEATED',
        details: { operation },
      });
    }

    const payload = await this.get(path, {
      ...query,
      limit: query.limit ?? this.pageSize,
      ...(after ? { after } : {}),
    }, { operationName: operation });
    const data = payload?.data;
    if (!Array.isArray(data)) {
      throw permanentError('Meta Graph edge response must contain data array', {
        code: 'META_INVALID_RESPONSE',
        details: { operation },
      });
    }

    const hasMore = Boolean(payload?.paging?.next);
    const nextCursor = optionalText(payload?.paging?.cursors?.after);
    if (hasMore && !nextCursor) {
      throw permanentError('Meta Graph paging.next exists without after cursor', {
        code: 'META_CURSOR_MISSING',
        details: { operation },
      });
    }
    if (nextCursor && (nextCursor === after || visitedCursors.has(nextCursor))) {
      throw permanentError('Meta Graph pagination repeated an after cursor', {
        code: 'META_CURSOR_REPEATED',
        details: { operation },
      });
    }

    return Object.freeze({
      rows: Object.freeze(data.map((row) => Object.freeze(row))),
      hasMore,
      nextCursor: hasMore ? nextCursor : null,
    });
  }

  /** Compatibility helper สำหรับชุดข้อมูลเล็กเท่านั้น; Runtime ขนาดใหญ่ต้องใช้ getPage + Durable staging */
  async listEdge(path, query = {}, options = {}) {
    const rows = [];
    const visitedCursors = new Set();
    const operation = normalizeOperationName(options.operationName);
    let after = null;

    for (let page = 1; page <= this.maxPages; page += 1) {
      const result = await this.getPage(path, query, {
        after,
        visitedCursors: [...visitedCursors],
        operationName: operation,
      });
      rows.push(...result.rows);
      if (!result.hasMore) return Object.freeze(rows);
      if (after) visitedCursors.add(after);
      after = result.nextCursor;
    }

    throw permanentError('Meta Graph pagination exceeded configured maxPages', {
      code: 'META_PAGINATION_LIMIT',
      details: { operation, maxPages: this.maxPages },
    });
  }

  async #requestOnce(safePath, query, operation) {
    const url = new URL(`${this.baseUrl}/${this.apiVersion}/${safePath}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const headers = new Headers({
      accept: 'application/json',
      authorization: `Bearer ${this.accessToken}`,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
      const text = await readBoundedResponseText(response, this.maxResponseBytes);
      const payload = parseJsonPayload(text, operation, response.status);
      const usage = readUsageHeaders(response.headers);
      if (response.ok && !payload?.error) {
        return Object.freeze({ payload, status: response.status, usage });
      }
      throw createMetaApiError({ response, payload, operation });
    } catch (cause) {
      if (controller.signal.aborted || cause?.name === 'AbortError') {
        throw transientError(`Meta Graph request timed out: ${operation}`, {
          code: 'META_REQUEST_TIMEOUT',
          cause,
          details: { operation, timeoutMs: this.timeoutMs },
        });
      }
      if (cause?.code) throw cause;
      throw transientError(`Meta Graph network request failed: ${operation}`, {
        code: 'META_NETWORK_ERROR',
        cause,
        details: { operation },
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** อ่าน Response body แบบมีเพดานเพื่อไม่ให้ Provider response กิน Worker memory ไม่จำกัด */
async function readBoundedResponseText(response, maxResponseBytes) {
  if (!response?.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxResponseBytes) {
      throw responseTooLarge(maxResponseBytes);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        try {
          await reader.cancel('Meta response exceeded configured byte limit');
        } catch {
          // การยกเลิก Stream เป็น best effort; ต้องรักษาเหตุผลหลักว่า Body เกินเพดาน
        }
        throw responseTooLarge(maxResponseBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function responseTooLarge(maxResponseBytes) {
  return permanentError('Meta Graph response exceeded the configured byte limit', {
    code: 'META_RESPONSE_TOO_LARGE',
    details: { maxResponseBytes },
  });
}

function createMetaApiError({ response, payload, operation }) {
  const metaError = payload?.error ?? {};
  const retryable = response.status === 429
    || response.status >= 500
    || metaError.is_transient === true
    || isMetaAdsBusinessUseCaseRateLimit(metaError);
  const factory = retryable ? transientError : permanentError;
  return factory(`Meta Graph request failed: ${operation}`, {
    code: retryable ? 'META_TRANSIENT_API_ERROR' : 'META_PERMANENT_API_ERROR',
    details: {
      operation,
      status: response.status,
      graphCode: metaError.code ?? null,
      graphSubcode: metaError.error_subcode ?? null,
      traceId: optionalText(metaError.fbtrace_id),
      retryAfter: readRetryAfter(response.headers),
      providerReason: classifyMetaErrorReason(metaError.message),
    },
  });
}

/** Meta returns this temporary Ads BUC throttle as HTTP 400 without is_transient. */
export function isMetaAdsBusinessUseCaseRateLimit(error) {
  const details = error?.details ?? error;
  return Number(details?.graphCode ?? details?.code) === 80004
    && Number(details?.graphSubcode ?? details?.error_subcode) === 2446079;
}

function parseJsonPayload(text, operation, status) {
  try {
    return text === '' ? {} : JSON.parse(text);
  } catch (cause) {
    throw transientError(`Meta Graph returned invalid JSON: ${operation}`, {
      code: 'META_INVALID_RESPONSE',
      cause,
      details: { operation, status },
    });
  }
}

function readUsageHeaders(headers) {
  return Object.freeze({
    appUsage: parseOptionalJsonHeader(headers.get('x-app-usage')),
    pageUsage: parseOptionalJsonHeader(headers.get('x-page-usage')),
    adAccountUsage: parseOptionalJsonHeader(headers.get('x-ad-account-usage')),
    businessUseCaseUsage: parseOptionalJsonHeader(headers.get('x-business-use-case-usage')),
  });
}

function parseOptionalJsonHeader(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? Object.freeze(parsed) : null;
  } catch {
    return null;
  }
}

function readRetryAfter(headers) {
  const value = headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.trunc(seconds * 1000);
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? Math.max(0, instant - Date.now()) : null;
}

function calculateRetryDelay({ attempt, baseDelayMs, maxDelayMs, retryAfter, random }) {
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(maxDelayMs, retryAfter);
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(exponential * 0.2 * random());
  return Math.min(maxDelayMs, exponential + jitter);
}

function normalizeCursorList(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('visitedCursors must be an array');
  return value.map((cursor) => requireText(cursor, 'visitedCursor'));
}

function classifyMetaErrorReason(value) {
  const message = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (message === 'api access blocked.') return 'api_access_blocked';
  return null;
}

function normalizeGraphPath(value) {
  const text = requireText(value, 'path').replace(/^\/+|\/+$/gu, '');
  if (text.includes('..') || text.includes('?') || text.includes('#')) {
    throw new TypeError('Meta Graph path must not contain traversal or query fragments');
  }
  return text;
}

function normalizeOperationName(value) {
  const operation = value === null || value === undefined || value === ''
    ? 'meta.graph.request'
    : requireText(value, 'operationName');
  if (operation.length > 100 || !/^[a-z][a-z0-9._-]*$/u.test(operation)) {
    throw new TypeError('Meta operationName must be a bounded static identifier');
  }
  return operation;
}

function normalizeApiVersion(value) {
  const text = requireText(value, 'apiVersion').toLowerCase();
  if (!/^v\d+\.\d+$/u.test(text)) throw new TypeError('Meta apiVersion must use vNN.N format');
  return text;
}

function normalizeBaseUrl(value) {
  const url = new URL(requireText(value, 'baseUrl'));
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new TypeError('Meta base URL must use HTTPS');
  }
  return url.toString().replace(/\/$/u, '');
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
