import {
  permanentError,
  transientError,
} from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_BASE_URL = 'https://graph.facebook.com';

/**
 * Shared Meta Graph client สำหรับ Facebook Page และ Instagram Business adapters
 * Client นี้จัดการ Auth/Error/Cursor pagination เท่านั้น ไม่ผูก Business mapping ของสองแพลตฟอร์มเข้าด้วยกัน
 */
export class MetaGraphClient {
  constructor(config = {}) {
    this.accessToken = requireText(config.accessToken, 'accessToken');
    this.apiVersion = normalizeApiVersion(config.apiVersion);
    const fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof fetchImpl !== 'function') throw new TypeError('MetaGraphClient requires fetch');
    this.fetchImpl = (...args) => fetchImpl(...args);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = positiveInteger(config.timeoutMs ?? 30_000, 'timeoutMs');
    this.maxPages = positiveInteger(config.maxPages ?? 100, 'maxPages');
    this.pageSize = positiveInteger(config.pageSize ?? 100, 'pageSize');
  }

  /** อ่าน Graph node/edge หนึ่งหน้า */
  async get(path, query = {}) {
    const safePath = normalizeGraphPath(path);
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
    let response;
    try {
      response = await this.fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    } catch (cause) {
      throw transientError(`Meta Graph network request failed: ${safePath}`, {
        code: 'META_NETWORK_ERROR',
        cause,
        details: { path: safePath },
      });
    } finally {
      clearTimeout(timeout);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw transientError(`Meta Graph returned invalid JSON: ${safePath}`, {
        code: 'META_INVALID_RESPONSE',
        cause,
        details: { path: safePath, status: response.status },
      });
    }
    if (response.ok && !payload?.error) return payload;
    throw createMetaApiError({ response, payload, path: safePath });
  }

  /**
   * เดิน Cursor pagination โดยใช้ after cursor กับ Path เดิม
   * ไม่ตาม paging.next URL โดยตรง เพื่อไม่รับ URL/Token จาก Response กลับมาเป็น Fetch target
   */
  async listEdge(path, query = {}) {
    const rows = [];
    let after = null;
    for (let page = 1; page <= this.maxPages; page += 1) {
      const payload = await this.get(path, {
        ...query,
        limit: query.limit ?? this.pageSize,
        ...(after ? { after } : {}),
      });
      const data = payload?.data;
      if (!Array.isArray(data)) {
        throw permanentError('Meta Graph edge response must contain data array', {
          code: 'META_INVALID_RESPONSE',
          details: { path: normalizeGraphPath(path) },
        });
      }
      rows.push(...data);
      if (!payload?.paging?.next) return Object.freeze(rows.map((row) => Object.freeze(row)));
      after = optionalText(payload?.paging?.cursors?.after);
      if (!after) {
        throw permanentError('Meta Graph paging.next exists without after cursor', {
          code: 'META_INVALID_PAGINATION',
          details: { path: normalizeGraphPath(path), page },
        });
      }
    }
    throw transientError('Meta Graph pagination exceeded configured maxPages', {
      code: 'META_PAGINATION_LIMIT',
      details: { path: normalizeGraphPath(path), maxPages: this.maxPages },
    });
  }
}

function createMetaApiError({ response, payload, path }) {
  const metaError = payload?.error ?? {};
  const retryable = response.status === 429 || response.status >= 500 || metaError.is_transient === true;
  const factory = retryable ? transientError : permanentError;
  return factory(`Meta Graph request failed: ${path}`, {
    code: retryable ? 'META_TRANSIENT_API_ERROR' : 'META_PERMANENT_API_ERROR',
    details: {
      path,
      status: response.status,
      graphCode: metaError.code ?? null,
      graphSubcode: metaError.error_subcode ?? null,
      traceId: optionalText(metaError.fbtrace_id),
    },
  });
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
