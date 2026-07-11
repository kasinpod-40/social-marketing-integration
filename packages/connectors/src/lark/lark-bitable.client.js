const LARK_OPEN_API_BASE_URL = 'https://open.larksuite.com';
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 150;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PAGES = 1_000;
const TOKEN_SAFETY_WINDOW_MS = 60_000;

/**
 * Minimal Lark Base client for server-side Workers usage.
 * The client is intentionally small: token fetch, guarded paginated reads, and batch create/update.
 */
export class LarkBitableClient {
  /**
   * @param {Object} config
   * @param {string} config.appId
   * @param {string} config.appSecret
   * @param {string} config.appToken Lark Base app token.
   * @param {typeof fetch} [config.fetchImpl]
   * @param {string} [config.baseUrl]
   */
  constructor(config) {
    this.appId = requireText(config?.appId, 'appId');
    this.appSecret = requireText(config?.appSecret, 'appSecret');
    this.appToken = requireText(config?.appToken, 'appToken');
    this.fetchImpl = config?.fetchImpl ?? fetch;
    this.baseUrl = config?.baseUrl ?? LARK_OPEN_API_BASE_URL;
    this.maxAttempts = positiveInteger(config?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 'maxAttempts');
    this.retryBaseDelayMs = positiveInteger(config?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS, 'retryBaseDelayMs');
    this.minRequestIntervalMs = nonNegativeInteger(config?.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS, 'minRequestIntervalMs');
    this.requestTimeoutMs = positiveInteger(config?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs');
    this.maxPages = positiveInteger(config?.maxPages ?? DEFAULT_MAX_PAGES, 'maxPages');
    this.sleep = config?.sleepImpl ?? sleep;
    this.random = config?.randomImpl ?? Math.random;
    this.tokenCache = null;
    this.tokenRequest = null;
    this.requestQueue = Promise.resolve();
    this.lastRequestStartedAt = 0;
    this.onRequest = typeof config?.onRequest === 'function' ? config.onRequest : () => undefined;
  }

  async getTenantAccessToken() {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }

    if (!this.tokenRequest) {
      this.tokenRequest = this.requestJson('/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        body: {
          app_id: this.appId,
          app_secret: this.appSecret,
        },
        auth: false,
      }).then((response) => {
        const token = requireText(response?.tenant_access_token, 'tenant_access_token');
        const expiresInSeconds = Number(response?.expire ?? 7200);
        const ttlMs = Math.max(60_000, expiresInSeconds * 1000 - TOKEN_SAFETY_WINDOW_MS);
        this.tokenCache = { token, expiresAt: Date.now() + ttlMs };
        return token;
      }).finally(() => {
        this.tokenRequest = null;
      });
    }

    return this.tokenRequest;
  }

  async listFields(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const token = await this.getTenantAccessToken();

    return this.paginateCollection({
      resource: 'fields',
      tableId,
      token,
      pageSize: DEFAULT_PAGE_SIZE,
      buildPath: (params) => `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/fields?${params.toString()}`,
      normalizeItem: (field) => Object.freeze({
        fieldId: field?.field_id ?? field?.fieldId ?? null,
        fieldName: field?.field_name ?? field?.fieldName ?? field?.name ?? null,
        type: field?.type,
        property: field?.property ?? null,
      }),
    });
  }

  async listRecords(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const pageSize = positiveInteger(input?.pageSize ?? DEFAULT_PAGE_SIZE, 'pageSize');
    const token = await this.getTenantAccessToken();

    return this.paginateCollection({
      resource: 'records',
      tableId,
      token,
      pageSize,
      buildPath: (params) => `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records?${params.toString()}`,
      normalizeItem: toRecordShape,
    });
  }

  async paginateCollection(input) {
    const resource = requireText(input?.resource, 'resource');
    const tableId = requireText(input?.tableId, 'tableId');
    const token = requireText(input?.token, 'token');
    const pageSize = positiveInteger(input?.pageSize, 'pageSize');
    if (typeof input?.buildPath !== 'function') throw new TypeError('Lark paginator requires buildPath');
    if (typeof input?.normalizeItem !== 'function') throw new TypeError('Lark paginator requires normalizeItem');

    const items = [];
    const seenPageTokens = new Set();
    let pageToken = null;

    for (let page = 1; page <= this.maxPages; page += 1) {
      const params = new URLSearchParams({ page_size: String(pageSize) });
      if (pageToken) params.set('page_token', pageToken);

      const response = await this.requestJson(input.buildPath(params), { method: 'GET', token });
      const pageItems = response?.data?.items ?? [];
      if (!Array.isArray(pageItems)) {
        throw new Error(`Lark ${resource} pagination returned invalid items for table ${tableId} on page ${page}`);
      }

      items.push(...pageItems.map(input.normalizeItem));
      const hasMore = response?.data?.has_more === true;
      const nextPageToken = normalizeOptionalText(response?.data?.page_token);
      this.onRequest({
        stage: 'lark_page_loaded',
        resource,
        tableId,
        page,
        rows: pageItems.length,
        totalRows: items.length,
        hasMore,
      });

      if (!hasMore) {
        this.onRequest({ stage: 'lark_pagination_complete', resource, tableId, pages: page, totalRows: items.length });
        return items;
      }
      if (!nextPageToken) {
        const error = new Error(`Lark ${resource} pagination returned has_more=true without page_token for table ${tableId} on page ${page}`);
        this.onRequest({ stage: 'lark_pagination_failed', resource, tableId, page, totalRows: items.length, error: error.message });
        throw error;
      }
      if (nextPageToken === pageToken || seenPageTokens.has(nextPageToken)) {
        const error = new Error(`Lark ${resource} pagination repeated page_token for table ${tableId} on page ${page}: ${nextPageToken}`);
        this.onRequest({ stage: 'lark_pagination_failed', resource, tableId, page, totalRows: items.length, error: error.message });
        throw error;
      }

      seenPageTokens.add(nextPageToken);
      pageToken = nextPageToken;
    }

    const error = new Error(`Lark ${resource} pagination exceeded ${this.maxPages} pages for table ${tableId}`);
    this.onRequest({ stage: 'lark_pagination_failed', resource, tableId, page: this.maxPages, totalRows: items.length, error: error.message });
    throw error;
  }

  async batchCreateRecords(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const records = requireArray(input?.records, 'records');
    if (records.length === 0) {
      return { created: 0 };
    }

    const token = await this.getTenantAccessToken();
    let created = 0;

    const chunks = chunkArray(records, DEFAULT_BATCH_SIZE);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      this.onRequest({ stage: 'lark_batch_start', operation: 'create', tableId, chunk: chunkIndex + 1, chunks: chunks.length, rows: chunk.length });
      const response = await this.requestJson(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_create`,
        {
          method: 'POST',
          token,
          body: {
            records: chunk.map((fields) => ({ fields })),
          },
        },
      );

      created += response?.data?.records?.length ?? chunk.length;
      this.onRequest({ stage: 'lark_batch_complete', operation: 'create', tableId, chunk: chunkIndex + 1, chunks: chunks.length, rows: chunk.length });
    }

    return { created };
  }

  async batchUpdateRecords(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const records = requireArray(input?.records, 'records');
    if (records.length === 0) {
      return { updated: 0 };
    }

    const token = await this.getTenantAccessToken();
    let updated = 0;

    const chunks = chunkArray(records, DEFAULT_BATCH_SIZE);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      this.onRequest({ stage: 'lark_batch_start', operation: 'update', tableId, chunk: chunkIndex + 1, chunks: chunks.length, rows: chunk.length });
      const response = await this.requestJson(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_update`,
        {
          method: 'POST',
          token,
          body: {
            records: chunk.map((record) => ({
              record_id: requireText(record?.recordId, 'recordId'),
              fields: requireObject(record?.fields, 'fields'),
            })),
          },
        },
      );

      updated += response?.data?.records?.length ?? chunk.length;
      this.onRequest({ stage: 'lark_batch_complete', operation: 'update', tableId, chunk: chunkIndex + 1, chunks: chunks.length, rows: chunk.length });
    }

    return { updated };
  }

  async scheduleRequest(operation) {
    if (typeof operation !== 'function') {
      throw new TypeError('Lark Bitable client requires request operation');
    }

    const scheduled = this.requestQueue.then(async () => {
      const elapsed = Date.now() - this.lastRequestStartedAt;
      const waitMs = Math.max(0, this.minRequestIntervalMs - elapsed);
      if (waitMs > 0) await this.sleep(waitMs);
      this.lastRequestStartedAt = Date.now();
      return operation();
    });

    // Keep the queue alive after a failed request so later calls are not blocked.
    this.requestQueue = scheduled.catch(() => undefined);
    return scheduled;
  }

  async requestJson(path, options) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const attemptStartedAt = Date.now();
      this.onRequest({ stage: 'lark_request_start', method: options?.method ?? 'GET', path: sanitizeLarkPath(path), attempt, maxAttempts: this.maxAttempts });
      const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
      if (options?.token) {
        headers.set('Authorization', `Bearer ${options.token}`);
      }

      try {
        const response = await this.scheduleRequest(async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
          try {
            return await this.fetchImpl(`${this.baseUrl}${path}`, {
              method: options?.method ?? 'GET',
              headers,
              body: options?.body === undefined ? undefined : JSON.stringify(options.body),
              signal: controller.signal,
            });
          } catch (error) {
            if (controller.signal.aborted) {
              const timeoutError = new Error(`Lark request timed out after ${this.requestTimeoutMs}ms: ${path}`);
              timeoutError.name = 'LarkRequestTimeoutError';
              timeoutError.cause = error;
              throw timeoutError;
            }
            throw error;
          } finally {
            clearTimeout(timeout);
          }
        });

        const text = await response.text();
        this.onRequest({ stage: 'lark_request_response', method: options?.method ?? 'GET', path: sanitizeLarkPath(path), attempt, status: response.status, elapsedMs: Date.now() - attemptStartedAt });
        const payload = text ? JSON.parse(text) : {};
        const retryable = response.status === 429 || response.status >= 500 || payload?.code === 1254290;

        if (!response.ok || payload?.code !== 0) {
          const message = !response.ok
            ? `Lark HTTP ${response.status}: ${payload?.msg ?? text}`
            : `Lark API error ${payload?.code}: ${payload?.msg ?? 'Unknown error'}`;
          const error = new Error(message);
          error.status = response.status;
          error.code = payload?.code;

          if (!retryable || attempt === this.maxAttempts) {
            this.onRequest({ stage: 'lark_request_failed', method: options?.method ?? 'GET', path: sanitizeLarkPath(path), attempt, status: response.status, code: payload?.code, elapsedMs: Date.now() - attemptStartedAt, error: message });
            throw error;
          }

          lastError = error;
          const delayMs = retryDelayMs({
            attempt,
            baseDelayMs: this.retryBaseDelayMs,
            retryAfter: response.headers.get('retry-after'),
            random: this.random,
          });
          this.onRequest({ stage: 'lark_request_retry', method: options?.method ?? 'GET', path: sanitizeLarkPath(path), attempt, status: response.status, code: payload?.code, delayMs, error: message });
          await this.sleep(delayMs);
          continue;
        }

        this.onRequest({ stage: 'lark_request_success', method: options?.method ?? 'GET', path: sanitizeLarkPath(path), attempt, status: response.status, elapsedMs: Date.now() - attemptStartedAt });
        return payload;
      } catch (error) {
        const retryableNetworkError = error?.status === undefined && error?.code === undefined;
        if (!retryableNetworkError || attempt === this.maxAttempts) {
          this.onRequest({ stage: 'lark_request_failed', method: options?.method ?? 'GET', path: sanitizeLarkPath(path), attempt, elapsedMs: Date.now() - attemptStartedAt, error: error?.message ?? String(error) });
          throw error;
        }

        lastError = error;
        const delayMs = retryDelayMs({
          attempt,
          baseDelayMs: this.retryBaseDelayMs,
          random: this.random,
        });
        this.onRequest({ stage: 'lark_request_retry', method: options?.method ?? 'GET', path: sanitizeLarkPath(path), attempt, delayMs, error: error?.message ?? String(error), elapsedMs: Date.now() - attemptStartedAt });
        await this.sleep(delayMs);
      }
    }

    throw lastError ?? new Error('Lark request failed');
  }
}

export function createLarkBitableClientFromEnv(env, options = {}) {
  return new LarkBitableClient({
    appId: env?.LARK_APP_ID,
    appSecret: env?.LARK_APP_SECRET,
    appToken: env?.LARK_APP_TOKEN ?? env?.LARK_BASE_APP_TOKEN,
    onRequest: options?.onRequest,
  });
}

function toRecordShape(record) {
  return Object.freeze({
    recordId: record?.record_id ?? record?.recordId ?? null,
    fields: Object.freeze(record?.fields ?? {}),
  });
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Lark Bitable client requires ${fieldName}`);
  }

  return value.trim();
}

function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`Lark Bitable client requires array ${fieldName}`);
  }

  return value;
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Lark Bitable client requires object ${fieldName}`);
  }

  return value;
}



function sanitizeLarkPath(path) {
  return String(path).replace(/(\/apps\/)[^/]+(\/tables\/)/, '$1***$2');
}

function retryDelayMs(input) {
  const retryAfterSeconds = Number(input?.retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.ceil(retryAfterSeconds * 1000);
  }

  const exponential = input.baseDelayMs * (2 ** (input.attempt - 1));
  const jitter = Math.floor(exponential * 0.25 * input.random());
  return exponential + jitter;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`Lark Bitable client requires positive integer ${fieldName}`);
  }

  return value;
}

function nonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`Lark Bitable client requires non-negative integer ${fieldName}`);
  }

  return value;
}
