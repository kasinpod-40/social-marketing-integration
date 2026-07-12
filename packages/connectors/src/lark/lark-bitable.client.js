import {
  permanentError,
  RuntimeError,
  transientError,
  writeProgressError,
} from '../../../shared/src/errors/runtime-error.js';

const LARK_OPEN_API_BASE_URL = 'https://open.larksuite.com';
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 150;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PAGES = 1_000;
const DEFAULT_MAX_FILTER_CONDITIONS = 50;
const TOKEN_SAFETY_WINDOW_MS = 60_000;
const MAX_REMOTE_ERROR_MESSAGE_LENGTH = 500;
const INVALID_TENANT_ACCESS_TOKEN_CODE = 99991663;

/**
 * Client สำหรับ Lark Base ฝั่ง Server/Worker
 *
 * ความรับผิดชอบ:
 * - ขอและ Cache tenant_access_token
 * - จำกัดอัตราคำขอแบบ Queue เดียวเพื่อไม่ยิงพร้อมกันเกินจำเป็น
 * - Pagination ที่ตรวจ has_more, page_token ซ้ำ และจำนวนหน้าสูงสุด
 * - Search Records แบบกรอง Stable Key เพื่อลด Full table scan
 * - Batch Create/Update พร้อมตรวจจำนวน Record ที่ตอบกลับ
 * - Retry เฉพาะ Error ชั่วคราว พร้อม Exponential backoff + jitter
 */
export class LarkBitableClient {
  /**
   * @param {Object} config การตั้งค่า Client
   * @param {string} config.appId Lark App ID
   * @param {string} config.appSecret Lark App Secret
   * @param {string} config.appToken Lark Base App Token
   * @param {typeof fetch} [config.fetchImpl] Fetch implementation สำหรับ Runtime/Test
   * @param {string} [config.baseUrl] Base URL ของ Lark Open API
   */
  constructor(config) {
    this.appId = requireText(config?.appId, 'appId');
    this.appSecret = requireText(config?.appSecret, 'appSecret');
    this.appToken = requireText(config?.appToken, 'appToken');

    // Global fetch ของ Cloudflare Workers ต้องถูกเรียกด้วย Runtime context ที่ถูกต้อง
    // ส่วน Fetch ที่ Inject เพื่อทดสอบต้องถูกเรียกเป็นฟังก์ชันปกติ ไม่รับ Client instance เป็น this
    const fetchImpl = config?.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('Lark Bitable client requires a Fetch implementation');
    }
    this.fetchImpl = (...args) => fetchImpl(...args);

    this.baseUrl = normalizeBaseUrl(config?.baseUrl ?? LARK_OPEN_API_BASE_URL);
    this.maxAttempts = positiveInteger(config?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 'maxAttempts');
    this.retryBaseDelayMs = positiveInteger(
      config?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      'retryBaseDelayMs',
    );
    this.maxRetryDelayMs = positiveInteger(
      config?.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
      'maxRetryDelayMs',
    );
    this.minRequestIntervalMs = nonNegativeInteger(
      config?.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS,
      'minRequestIntervalMs',
    );
    this.requestTimeoutMs = positiveInteger(
      config?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      'requestTimeoutMs',
    );
    this.maxPages = positiveInteger(config?.maxPages ?? DEFAULT_MAX_PAGES, 'maxPages');
    this.maxFilterConditions = boundedPositiveInteger(
      config?.maxFilterConditions ?? DEFAULT_MAX_FILTER_CONDITIONS,
      'maxFilterConditions',
      DEFAULT_MAX_FILTER_CONDITIONS,
    );
    this.sleep = config?.sleepImpl ?? sleep;
    this.random = config?.randomImpl ?? Math.random;
    this.onRequest = typeof config?.onRequest === 'function' ? config.onRequest : () => undefined;

    this.tokenCache = null;
    this.tokenRequest = null;
    this.requestQueue = Promise.resolve();
    this.lastRequestStartedAt = 0;
  }

  /**
   * คืน tenant_access_token จาก Cache หรือขอใหม่เมื่อหมดอายุ
   * Promise ของคำขอ Token ถูกแชร์เพื่อป้องกันหลายงานยิงขอ Token พร้อมกัน
   */
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
        if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
          throw permanentError('Lark tenant_access_token response contains invalid expire value', {
            code: 'LARK_INVALID_TOKEN_RESPONSE',
          });
        }
        // ไม่บังคับ Cache ขั้นต่ำ 60 วินาที เพราะ Token อายุสั้นกว่านั้นอาจหมดอายุก่อน Cache
        const ttlMs = Math.max(1_000, expiresInSeconds * 1000 - TOKEN_SAFETY_WINDOW_MS);
        this.tokenCache = Object.freeze({ token, expiresAt: Date.now() + ttlMs });
        return token;
      }).finally(() => {
        this.tokenRequest = null;
      });
    }

    return this.tokenRequest;
  }

  /**
   * ล้าง Token เฉพาะเมื่อ Cache ยังเป็น Token ที่ถูก Lark ปฏิเสธ
   * การเทียบค่าก่อนล้างป้องกัน Request เก่าลบ Token ใหม่ที่ Request อื่น Refresh สำเร็จแล้ว
   */
  invalidateTenantAccessToken(token) {
    if (this.tokenCache?.token === token) this.tokenCache = null;
  }

  /**
   * ส่งคำขอ Bitable โดย Refresh tenant_access_token หนึ่งครั้งเมื่อ Lark แจ้งว่า Token ใช้ไม่ได้
   * การ Refresh นี้แยกจาก Retry ทั่วไป เพราะ Auth failure ยืนยันว่า Lark ยังไม่รับคำสั่งเขียน
   */
  async requestBitableJson(path, options = {}) {
    const token = await this.getTenantAccessToken();

    try {
      return await this.requestJson(path, { ...options, token });
    } catch (error) {
      if (!isInvalidTenantAccessTokenError(error)) throw error;

      this.invalidateTenantAccessToken(token);
      this.onRequest({
        stage: 'lark_token_invalidated',
        path: sanitizeLarkPath(path),
        status: error.details?.status,
        code: error.details?.larkCode,
      });

      const refreshedToken = await this.getTenantAccessToken();
      return this.requestJson(path, { ...options, token: refreshedToken });
    }
  }

  /** อ่าน Field metadata ทั้งตารางด้วย Pagination guard กลาง */
  async listFields(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    return this.paginateCollection({
      resource: 'fields',
      tableId,
      pageSize: DEFAULT_PAGE_SIZE,
      requestPage: ({ pageToken, pageSize }) => {
        const params = buildPageParams(pageToken, pageSize);
        return this.requestBitableJson(
          `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/fields?${params.toString()}`,
          { method: 'GET' },
        );
      },
      normalizeItem: normalizeField,
    });
  }

  /**
   * อ่าน Record ทั้งตาราง ใช้เฉพาะ Flow ที่จำเป็นต้อง Traverse ทั้งหมด
   * สำหรับ Upsert ด้วย Stable Key ให้ใช้ searchRecordsByFieldValues แทน
   */
  async listRecords(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const pageSize = boundedPositiveInteger(input?.pageSize ?? DEFAULT_PAGE_SIZE, 'pageSize', DEFAULT_PAGE_SIZE);
    const includeRecordMetadata = input?.includeRecordMetadata !== false;
    return this.paginateCollection({
      resource: 'records',
      tableId,
      pageSize,
      requestPage: ({ pageToken, pageSize: currentPageSize }) => {
        const params = buildPageParams(pageToken, currentPageSize);
        if (includeRecordMetadata) params.set('last_modified_time', 'true');
        return this.requestBitableJson(
          `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records?${params.toString()}`,
          { method: 'GET' },
        );
      },
      normalizeItem: toRecordShape,
    });
  }

  /**
   * ค้นหา Record ด้วย OR filter ของ Field เดียวหลายค่า
   * แบ่ง Conditions เป็น Chunk เพื่อไม่ให้ Request body ใหญ่เกินไป และรวมผลด้วย record_id
   */
  async searchRecordsByFieldValues(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const fieldName = requireText(input?.fieldName, 'fieldName');
    const values = normalizeUniqueTexts(input?.values, 'values');
    const pageSize = boundedPositiveInteger(input?.pageSize ?? DEFAULT_PAGE_SIZE, 'pageSize', DEFAULT_PAGE_SIZE);
    if (values.length === 0) return Object.freeze([]);

    const byRecordId = new Map();
    const valueChunks = chunkArray(values, this.maxFilterConditions);

    for (let chunkIndex = 0; chunkIndex < valueChunks.length; chunkIndex += 1) {
      const chunk = valueChunks[chunkIndex];
      this.onRequest({
        stage: 'lark_search_chunk_start',
        tableId,
        fieldName,
        chunk: chunkIndex + 1,
        chunks: valueChunks.length,
        values: chunk.length,
      });

      const records = await this.paginateCollection({
        resource: 'search_records',
        tableId,
        pageSize,
        requestPage: ({ pageToken, pageSize: currentPageSize }) => {
          const params = buildPageParams(pageToken, currentPageSize);
          return this.requestBitableJson(
            `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records/search?${params.toString()}`,
            {
              method: 'POST',
              body: {
                filter: {
                  conjunction: 'or',
                  conditions: chunk.map((value) => ({
                    field_name: fieldName,
                    operator: 'is',
                    value: [value],
                  })),
                },
              },
            },
          );
        },
        normalizeItem: toRecordShape,
      });

      for (const record of records) {
        const recordId = requireText(record.recordId, 'recordId');
        byRecordId.set(recordId, record);
      }

      this.onRequest({
        stage: 'lark_search_chunk_complete',
        tableId,
        fieldName,
        chunk: chunkIndex + 1,
        chunks: valueChunks.length,
        rows: records.length,
      });
    }

    return Object.freeze([...byRecordId.values()]);
  }

  /**
   * Pagination กลางสำหรับ Fields, List Records และ Search Records
   */
  async paginateCollection(input) {
    const resource = requireText(input?.resource, 'resource');
    const tableId = requireText(input?.tableId, 'tableId');
    const pageSize = positiveInteger(input?.pageSize, 'pageSize');
    if (typeof input?.requestPage !== 'function') throw new TypeError('Lark paginator requires requestPage');
    if (typeof input?.normalizeItem !== 'function') throw new TypeError('Lark paginator requires normalizeItem');

    const items = [];
    const seenPageTokens = new Set();
    let pageToken = null;

    for (let page = 1; page <= this.maxPages; page += 1) {
      const response = await input.requestPage({ pageToken, pageSize });
      const pageItems = response?.data?.items ?? [];
      if (!Array.isArray(pageItems)) {
        throw permanentError(
          `Lark ${resource} pagination returned invalid items for table ${tableId} on page ${page}`,
          { code: 'LARK_INVALID_PAGINATION' },
        );
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
        this.onRequest({
          stage: 'lark_pagination_complete',
          resource,
          tableId,
          pages: page,
          totalRows: items.length,
        });
        return Object.freeze(items);
      }

      if (!nextPageToken) {
        throw this.paginationError({
          resource,
          tableId,
          page,
          totalRows: items.length,
          message: `Lark ${resource} pagination returned has_more=true without page_token for table ${tableId} on page ${page}`,
        });
      }

      if (nextPageToken === pageToken || seenPageTokens.has(nextPageToken)) {
        throw this.paginationError({
          resource,
          tableId,
          page,
          totalRows: items.length,
          message: `Lark ${resource} pagination repeated page_token for table ${tableId} on page ${page}: ${nextPageToken}`,
        });
      }

      seenPageTokens.add(nextPageToken);
      pageToken = nextPageToken;
    }

    throw this.paginationError({
      resource,
      tableId,
      page: this.maxPages,
      totalRows: items.length,
      message: `Lark ${resource} pagination exceeded ${this.maxPages} pages for table ${tableId}`,
    });
  }

  /** สร้าง Error Pagination พร้อมส่ง Trace Event ก่อนโยนออก */
  paginationError(input) {
    const error = permanentError(input.message, { code: 'LARK_INVALID_PAGINATION' });
    this.onRequest({
      stage: 'lark_pagination_failed',
      resource: input.resource,
      tableId: input.tableId,
      page: input.page,
      totalRows: input.totalRows,
      error: error.message,
    });
    return error;
  }

  /** Batch Create แบบเรียง Chunk และรายงานจำนวนที่ยืนยันได้เมื่อเกิด Partial/Unknown write */
  async batchCreateRecords(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const records = requireArray(input?.records, 'records');
    const beforeChunk = typeof input?.beforeChunk === 'function' ? input.beforeChunk : async () => undefined;
    if (records.length === 0) return Object.freeze({ created: 0 });

    let created = 0;
    const chunks = chunkArray(records, DEFAULT_BATCH_SIZE);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      let requestStarted = false;

      try {
        // Guard อยู่ใน Failure boundary เพื่อรักษา Progress ของ Chunk ก่อนหน้าเมื่อ Lease หลุด
        await beforeChunk({
          operation: 'create', tableId,
          chunk: chunkIndex + 1, chunks: chunks.length, rows: chunk.length,
        });
        this.onRequest({
          stage: 'lark_batch_start', operation: 'create', tableId,
          chunk: chunkIndex + 1, chunks: chunks.length, rows: chunk.length,
        });
        requestStarted = true;
        const response = await this.requestBitableJson(
          `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_create`,
          {
            method: 'POST',
            body: { records: chunk.map((fields) => ({ fields: requireObject(fields, 'fields') })) },
            retryMode: 'rate_limit_only',
          },
        );
        created += readBatchResponseCount(response, chunk.length, 'create', tableId);
      } catch (cause) {
        const ambiguousCurrentChunk = requestStarted && isAmbiguousWriteError(cause);
        if (created === 0 && !ambiguousCurrentChunk) throw cause;
        throw buildBatchWriteProgressError({
          cause, operation: 'create', tableId, completedRows: created,
          chunkIndex, chunks, ambiguousCurrentChunk,
        });
      }

      this.onRequest({
        stage: 'lark_batch_complete', operation: 'create', tableId,
        chunk: chunkIndex + 1, chunks: chunks.length, rows: chunk.length,
      });
    }

    return Object.freeze({ created });
  }

  /** Batch Update แบบเรียง Chunk พร้อม Progress metadata เมื่อบาง Chunk สำเร็จแล้ว */
  async batchUpdateRecords(input) {
    const tableId = requireText(input?.tableId, 'tableId');
    const records = requireArray(input?.records, 'records');
    const beforeChunk = typeof input?.beforeChunk === 'function' ? input.beforeChunk : async () => undefined;
    if (records.length === 0) return Object.freeze({ updated: 0 });

    let updated = 0;
    const chunks = chunkArray(records, DEFAULT_BATCH_SIZE);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      let requestStarted = false;

      try {
        await beforeChunk({
          operation: 'update', tableId,
          chunk: chunkIndex + 1, chunks: chunks.length, rows: chunk.length,
        });
        this.onRequest({
          stage: 'lark_batch_start', operation: 'update', tableId,
          chunk: chunkIndex + 1, chunks: chunks.length, rows: chunk.length,
        });
        requestStarted = true;
        const response = await this.requestBitableJson(
          `/open-apis/bitable/v1/apps/${encodeURIComponent(this.appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_update`,
          {
            method: 'POST',
            body: {
              records: chunk.map((record) => ({
                record_id: requireText(record?.recordId, 'recordId'),
                fields: requireObject(record?.fields, 'fields'),
              })),
            },
          },
        );
        updated += readBatchResponseCount(response, chunk.length, 'update', tableId);
      } catch (cause) {
        const ambiguousCurrentChunk = requestStarted && isAmbiguousWriteError(cause);
        if (updated === 0 && !ambiguousCurrentChunk) throw cause;
        throw buildBatchWriteProgressError({
          cause, operation: 'update', tableId, completedRows: updated,
          chunkIndex, chunks, ambiguousCurrentChunk,
        });
      }

      this.onRequest({
        stage: 'lark_batch_complete', operation: 'update', tableId,
        chunk: chunkIndex + 1, chunks: chunks.length, rows: chunk.length,
      });
    }

    return Object.freeze({ updated });
  }

  /**
   * จัดคิว Request ทุกคำขอใน Client instance และเว้นระยะขั้นต่ำระหว่างจุดเริ่ม Request
   */
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

    this.requestQueue = scheduled.catch(() => undefined);
    return scheduled;
  }

  /**
   * ส่ง HTTP Request, Parse JSON, จำแนก Error และ Retry เฉพาะเหตุการณ์ชั่วคราว
   */
  async requestJson(path, options = {}) {
    const safePath = sanitizeLarkPath(path);
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const attemptStartedAt = Date.now();
      this.onRequest({
        stage: 'lark_request_start',
        method: options.method ?? 'GET',
        path: safePath,
        attempt,
        maxAttempts: this.maxAttempts,
      });

      try {
        // Timeout ครอบทั้งการรับ Header และอ่าน Response body ไม่ใช่เฉพาะช่วงรอ Header
        const { response, text } = await this.scheduleRequest(() => this.fetchWithTimeout(path, options, safePath));
        const payload = parseJsonPayload(text, response.status, safePath);
        const elapsedMs = Date.now() - attemptStartedAt;

        this.onRequest({
          stage: 'lark_request_response',
          method: options.method ?? 'GET',
          path: safePath,
          attempt,
          status: response.status,
          elapsedMs,
        });

        if (!response.ok || payload?.code !== 0) {
          throw createLarkResponseError({ response, payload, text, path });
        }

        this.onRequest({
          stage: 'lark_request_success',
          method: options.method ?? 'GET',
          path: safePath,
          attempt,
          status: response.status,
          elapsedMs,
        });
        return payload;
      } catch (error) {
        const normalizedError = normalizeRequestError(error, safePath, this.requestTimeoutMs);
        lastError = normalizedError;
        const elapsedMs = Date.now() - attemptStartedAt;

        // Request เขียนแบบ Create ต้องไม่ Retry ภายในคำขอเมื่อผลลัพธ์กำกวม
        // ให้ Queue/ผู้เรียกเริ่ม Job ใหม่และค้น Stable Key ก่อน เพื่อรักษา Idempotency
        const retryWithinRequest = normalizedError.retryable
          && shouldRetryWithinRequest(normalizedError, options.retryMode ?? 'all_transient');

        if (!retryWithinRequest || attempt === this.maxAttempts) {
          this.onRequest({
            stage: 'lark_request_failed',
            method: options.method ?? 'GET',
            path: safePath,
            attempt,
            status: normalizedError.details?.status,
            code: normalizedError.details?.larkCode,
            elapsedMs,
            retryable: normalizedError.retryable,
            error: normalizedError.message,
          });
          throw normalizedError;
        }

        const delayMs = retryDelayMs({
          attempt,
          baseDelayMs: this.retryBaseDelayMs,
          maxDelayMs: this.maxRetryDelayMs,
          retryAfter: normalizedError.details?.retryAfter,
          random: this.random,
        });
        this.onRequest({
          stage: 'lark_request_retry',
          method: options.method ?? 'GET',
          path: safePath,
          attempt,
          status: normalizedError.details?.status,
          code: normalizedError.details?.larkCode,
          delayMs,
          elapsedMs,
          error: normalizedError.message,
        });
        await this.sleep(delayMs);
      }
    }

    throw lastError ?? transientError('Lark request failed', { code: 'LARK_REQUEST_FAILED' });
  }

  /** ส่ง Fetch พร้อม AbortController และแปลง Timeout เป็น Error ชั่วคราว */
  async fetchWithTimeout(path, options, safePath = sanitizeLarkPath(path)) {
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
    if (options?.token) headers.set('Authorization', `Bearer ${options.token}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options?.method ?? 'GET',
        headers,
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const text = await response.text();
      return Object.freeze({ response, text });
    } catch (error) {
      if (controller.signal.aborted) {
        throw transientError(
          `Lark request timed out after ${this.requestTimeoutMs}ms: ${safePath}`,
          { code: 'LARK_REQUEST_TIMEOUT', cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * สร้าง Client จาก Environment และเปิดให้ปรับค่าด้าน Performance โดยไม่แก้ Source code
 */
export function createLarkBitableClientFromEnv(env, options = {}) {
  return new LarkBitableClient({
    appId: env?.LARK_APP_ID,
    appSecret: env?.LARK_APP_SECRET,
    appToken: env?.LARK_APP_TOKEN ?? env?.LARK_BASE_APP_TOKEN,
    maxAttempts: readOptionalInteger(env?.LARK_MAX_ATTEMPTS),
    retryBaseDelayMs: readOptionalInteger(env?.LARK_RETRY_BASE_DELAY_MS),
    maxRetryDelayMs: readOptionalInteger(env?.LARK_MAX_RETRY_DELAY_MS),
    minRequestIntervalMs: readOptionalInteger(env?.LARK_MIN_REQUEST_INTERVAL_MS, { allowZero: true }),
    requestTimeoutMs: readOptionalInteger(env?.LARK_REQUEST_TIMEOUT_MS),
    maxPages: readOptionalInteger(env?.LARK_MAX_PAGES),
    maxFilterConditions: readOptionalInteger(env?.LARK_MAX_FILTER_CONDITIONS),
    fetchImpl: options?.fetchImpl,
    baseUrl: options?.baseUrl,
    sleepImpl: options?.sleepImpl,
    randomImpl: options?.randomImpl,
    onRequest: options?.onRequest,
  });
}


/** ตรวจ Error ที่บอกว่า tenant_access_token ถูกปฏิเสธและควรขอ Token ใหม่หนึ่งครั้ง */
function isInvalidTenantAccessTokenError(error) {
  return error instanceof RuntimeError
    && (error.details?.status === 401 || error.details?.larkCode === INVALID_TENANT_ACCESS_TOKEN_CODE);
}

/**
 * ตัดสินว่า Error ชั่วคราวควร Retry ภายใน HTTP request เดิมหรือไม่
 * - all_transient: ใช้กับ Read/Update/Token ที่ทำซ้ำได้ปลอดภัย
 * - rate_limit_only: ใช้กับ Create ให้ Retry เฉพาะกรณี Lark ตอบชัดว่า Rate limit และยังไม่ประมวลผล
 */
function shouldRetryWithinRequest(error, retryMode) {
  if (retryMode === 'all_transient') return true;
  if (retryMode === 'rate_limit_only') {
    return error?.details?.status === 429 || error?.details?.larkCode === 1254290;
  }
  if (retryMode === 'none') return false;
  throw new TypeError(`Unsupported Lark retryMode: ${retryMode}`);
}

/** Normalize Field metadata ให้ใช้ชื่อ Property เดียวทั้งระบบ */
function normalizeField(field) {
  return Object.freeze({
    fieldId: field?.field_id ?? field?.fieldId ?? null,
    fieldName: field?.field_name ?? field?.fieldName ?? field?.name ?? null,
    type: field?.type,
    property: field?.property ?? null,
  });
}

/** Normalize Record จาก Lark พร้อม Metadata ที่ใช้ทำ Incremental checkpoint */
function toRecordShape(record) {
  return Object.freeze({
    recordId: record?.record_id ?? record?.recordId ?? null,
    fields: Object.freeze(record?.fields ?? {}),
    createdTime: normalizeRecordTimestamp(record?.created_time ?? record?.createdTime),
    lastModifiedTime: normalizeRecordTimestamp(
      record?.last_modified_time ?? record?.lastModifiedTime,
    ),
    lastModifiedBy: record?.last_modified_by ?? record?.lastModifiedBy ?? null,
  });
}

/** รองรับ Epoch seconds/milliseconds และ ISO date จาก Lark โดยคืน Epoch milliseconds */
function normalizeRecordTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/u.test(value.trim())
      ? Number(value.trim())
      : Number.NaN);

  if (Number.isFinite(numeric)) {
    const milliseconds = Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric;
    return Number.isSafeInteger(Math.trunc(milliseconds)) ? Math.trunc(milliseconds) : null;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** สร้าง Query parameter สำหรับ Pagination */
function buildPageParams(pageToken, pageSize) {
  const params = new URLSearchParams({ page_size: String(pageSize) });
  if (pageToken) params.set('page_token', pageToken);
  return params;
}

/** Parse JSON และจำแนก Response ที่ไม่ใช่ JSON ว่า Retry ได้เฉพาะ 429/5xx */
function parseJsonPayload(text, status, path) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (cause) {
    const retryable = status === 429 || status >= 500;
    const factory = retryable ? transientError : permanentError;
    throw factory(`Lark returned invalid JSON for ${path}`, {
      code: 'LARK_INVALID_JSON',
      cause,
      details: { status },
    });
  }
}

/** สร้าง Error จาก HTTP status หรือ Lark API code */
function createLarkResponseError(input) {
  const status = input.response.status;
  const larkCode = input.payload?.code;
  const retryable = status === 429 || status >= 500 || larkCode === 1254290;
  const remoteMessage = safeRemoteMessage(input.payload?.msg ?? input.text ?? 'Unknown error');
  const message = !input.response.ok
    ? `Lark HTTP ${status}: ${remoteMessage}`
    : `Lark API error ${larkCode}: ${remoteMessage}`;
  const factory = retryable ? transientError : permanentError;

  return factory(message, {
    code: retryable ? 'LARK_TRANSIENT_API_ERROR' : 'LARK_PERMANENT_API_ERROR',
    details: {
      status,
      larkCode,
      retryAfter: input.response.headers.get('retry-after'),
    },
  });
}

/** แปลง Fetch/Network error ทั่วไปให้เป็น RuntimeError ที่ Worker จัดการได้ */
function normalizeRequestError(error, safePath, timeoutMs) {
  if (error instanceof RuntimeError) return error;
  if (error?.name === 'AbortError') {
    return transientError(`Lark request timed out after ${timeoutMs}ms: ${safePath}`, {
      code: 'LARK_REQUEST_TIMEOUT',
      cause: error,
    });
  }
  if (error instanceof TypeError) {
    return transientError(`Lark network request failed: ${safePath}`, {
      code: 'LARK_NETWORK_ERROR',
      cause: error,
    });
  }

  return permanentError(`Unexpected Lark client error while requesting ${safePath}`, {
    code: 'LARK_CLIENT_PROGRAMMING_ERROR',
    cause: error,
  });
}

/** ตรวจจำนวน Record ใน Batch response ให้ตรงกับจำนวนที่ส่ง */
function readBatchResponseCount(response, expectedCount, operation, tableId) {
  const records = response?.data?.records;
  if (!Array.isArray(records)) {
    throw transientError(
      `Lark batch ${operation} response omitted records for table ${tableId}`,
      { code: 'LARK_INCOMPLETE_BATCH_RESPONSE' },
    );
  }
  if (records.length !== expectedCount) {
    throw transientError(
      `Lark batch ${operation} response count mismatch for table ${tableId}: expected ${expectedCount}, received ${records.length}`,
      { code: 'LARK_INCOMPLETE_BATCH_RESPONSE' },
    );
  }
  return records.length;
}

/** คำนวณ Backoff โดยรองรับ Retry-After ทั้งวินาทีและ HTTP date พร้อมเพดานสูงสุด */
function retryDelayMs(input) {
  const retryAfterMs = parseRetryAfter(input.retryAfter);
  if (retryAfterMs !== null) return Math.min(input.maxDelayMs, retryAfterMs);

  const exponential = input.baseDelayMs * (2 ** (input.attempt - 1));
  const jitter = Math.floor(exponential * 0.25 * input.random());
  return Math.min(input.maxDelayMs, exponential + jitter);
}

/** Parse Retry-After เป็น Milliseconds */
function parseRetryAfter(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);

  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
}

/** แบ่ง Array เป็น Chunk ขนาดคงที่ */
function buildBatchWriteProgressError(input) {
  const totalRows = input.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const writeOutcome = input.completedRows > 0 ? 'partial' : 'unknown';
  const causeMessage = input.cause instanceof Error ? input.cause.message : String(input.cause);
  return writeProgressError(
    input.completedRows > 0
      ? `Lark batch ${input.operation} partially completed for table ${input.tableId}: ${causeMessage}`
      : `Lark batch ${input.operation} outcome is unknown for table ${input.tableId}: ${causeMessage}`,
    {
      code: input.completedRows > 0 ? 'LARK_BATCH_PARTIAL_WRITE' : 'LARK_BATCH_WRITE_UNKNOWN',
      retryable: input.cause?.retryable === true,
      cause: input.cause,
      details: {
        causeCode: input.cause?.code ?? null,
        causeMessage: input.cause instanceof Error ? input.cause.message : String(input.cause),
        currentChunkMayHaveWritten: input.ambiguousCurrentChunk === true,
      },
      writeProgress: {
        operation: input.operation,
        tableId: input.tableId,
        writeOutcome,
        confirmedRows: input.completedRows,
        completedChunks: input.chunkIndex,
        failedChunk: input.chunkIndex + 1,
        totalChunks: input.chunks.length,
        totalRows,
        remainingRows: Math.max(0, totalRows - input.completedRows),
      },
    },
  );
}

function isAmbiguousWriteError(error) {
  if (!error || typeof error !== 'object') return false;
  const status = Number(error.details?.status);
  const larkCode = Number(error.details?.larkCode);
  // 429 และ Lark 1254290 เป็น Explicit rate-limit rejection จึงยืนยันได้ว่า Chunk ยังไม่ถูกเขียน
  if (status === 429 || larkCode === 1254290) return false;
  if (Number.isInteger(status) && status >= 400 && status < 500) return false;
  return error.retryable === true;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Normalize รายการข้อความและตัดค่าซ้ำ */
function normalizeUniqueTexts(value, fieldName) {
  const items = requireArray(value, fieldName).map((item) => requireText(item, `${fieldName} item`));
  return Object.freeze([...new Set(items)]);
}

/** Mask App token จาก Path ก่อนส่งเข้า Log */
function sanitizeLarkPath(path) {
  return String(path).replace(/(\/apps\/)[^/]+(\/tables\/)/u, '$1***$2');
}

/** จำกัดข้อความจาก API ภายนอกเพื่อไม่ให้ Log ใหญ่ผิดปกติหรือมี Object ถูกแปลงแบบกำกวม */
function safeRemoteMessage(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? 'Unknown error');
  return String(text).slice(0, MAX_REMOTE_ERROR_MESSAGE_LENGTH);
}

/** ลบ Slash ท้าย Base URL เพื่อป้องกัน URL ซ้อน */
function normalizeBaseUrl(value) {
  return requireText(value, 'baseUrl').replace(/\/+$/u, '');
}

/** Promise sleep ที่ Inject ได้ในการทดสอบ */
function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** บังคับข้อความที่ไม่ว่าง */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Lark Bitable client requires ${fieldName}`);
  }
  return value.trim();
}

/** อ่านข้อความ Optional */
function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** บังคับ Array */
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`Lark Bitable client requires array ${fieldName}`);
  }
  return value;
}

/** บังคับ Plain Object */
function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Lark Bitable client requires object ${fieldName}`);
  }
  return value;
}

/** บังคับจำนวนเต็มบวก */
function positiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`Lark Bitable client requires positive integer ${fieldName}`);
  }
  return value;
}


/** บังคับจำนวนเต็มบวกพร้อมเพดานตามข้อจำกัด API */
function boundedPositiveInteger(value, fieldName, maximum) {
  const number = positiveInteger(value, fieldName);
  if (number > maximum) {
    throw new RangeError(`Lark Bitable client requires ${fieldName} <= ${maximum}`);
  }
  return number;
}

/** บังคับจำนวนเต็มศูนย์ขึ้นไป */
function nonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`Lark Bitable client requires non-negative integer ${fieldName}`);
  }
  return value;
}

/** อ่าน Integer จาก Environment โดยคืน undefined เมื่อไม่ได้กำหนด */
function readOptionalInteger(value, options = {}) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || (options.allowZero ? number < 0 : number <= 0)) {
    throw new TypeError('Lark numeric environment values must be valid integers');
  }
  return number;
}
