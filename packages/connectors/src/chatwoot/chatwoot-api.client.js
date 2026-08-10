import {
  permanentError,
  transientError,
} from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_ROWS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const MESSAGE_AFTER_PAGE_SIZE = 100;
const MESSAGE_BEFORE_PAGE_SIZE = 20;

/** GET-only Chatwoot Application API client with bounded transport and pagination. */
export class ChatwootApiClient {
  constructor(config = {}) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl, config.allowInsecureLocal === true);
    this.accountId = requirePositiveId(config.accountId, 'accountId');
    this.accessToken = requireText(config.accessToken, 'accessToken');
    const fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof fetchImpl !== 'function') throw new TypeError('ChatwootApiClient requires fetch');
    this.fetchImpl = (...args) => fetchImpl(...args);
    this.timeoutMs = positiveInteger(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
    this.maxAttempts = boundedInteger(config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 'maxAttempts', 1, 10);
    this.maxPages = boundedInteger(config.maxPages ?? DEFAULT_MAX_PAGES, 'maxPages', 1, 1_000);
    this.maxRows = boundedInteger(config.maxRows ?? DEFAULT_MAX_ROWS, 'maxRows', 1, 100_000);
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

  async listInboxes() {
    const payload = await this.get(this.#accountPath('inboxes'), {}, { operationName: 'list_inboxes' });
    return freezeRows(readArrayPayload(payload, 'payload', 'list_inboxes'));
  }

  async listAgents() {
    const payload = await this.get(this.#accountPath('agents'), {}, { operationName: 'list_agents' });
    return freezeRows(requireArray(payload, 'list_agents response'));
  }

  async listTeams() {
    const payload = await this.get(this.#accountPath('teams'), {}, { operationName: 'list_teams' });
    return freezeRows(requireArray(payload, 'list_teams response'));
  }

  async listLabels() {
    const payload = await this.get(this.#accountPath('labels'), {}, { operationName: 'list_labels' });
    return freezeRows(readArrayPayload(payload, 'payload', 'list_labels'));
  }

  async listConversationsPage(input = {}) {
    const page = boundedInteger(input.page ?? 1, 'page', 1, this.maxPages);
    const payload = await this.get(this.#accountPath('conversations'), {
      page,
      status: input.status ?? 'all',
      assignee_type: input.assigneeType ?? 'all',
      ...(input.inboxId ? { inbox_id: requirePositiveId(input.inboxId, 'inboxId') } : {}),
      ...(input.teamId ? { team_id: requirePositiveId(input.teamId, 'teamId') } : {}),
    }, { operationName: 'list_conversations' });
    const data = requireObject(payload?.data, 'list_conversations.data');
    const rows = requireArray(data.payload, 'list_conversations.data.payload');
    const totalCount = nullableNonNegativeInteger(data?.meta?.all_count, 'list_conversations.meta.all_count');
    return freezePage({ page, rows, totalCount, hasMore: rows.length > 0 });
  }

  async getConversation(conversationId) {
    const id = requirePositiveId(conversationId, 'conversationId');
    const payload = await this.get(
      this.#accountPath(`conversations/${id}`),
      {},
      { operationName: 'get_conversation' },
    );
    return Object.freeze({ ...requireObject(payload, 'get_conversation response') });
  }

  async listContactsPage(input = {}) {
    const page = boundedInteger(input.page ?? 1, 'page', 1, this.maxPages);
    const payload = await this.get(this.#accountPath('contacts'), {
      page,
      sort: input.sort ?? '-last_activity_at',
    }, { operationName: 'list_contacts' });
    const rows = requireArray(payload?.payload, 'list_contacts.payload');
    const totalCount = nullableNonNegativeInteger(payload?.meta?.count, 'list_contacts.meta.count');
    return freezePage({ page, rows, totalCount, hasMore: rows.length > 0 });
  }

  async listAccountReportingEventsPage(input = {}) {
    const page = boundedInteger(input.page ?? 1, 'page', 1, this.maxPages);
    const payload = await this.get(this.#accountPath('reporting_events'), {
      page,
      ...(input.since !== null && input.since !== undefined
        ? { since: timestampSeconds(input.since, 'since') }
        : {}),
      ...(input.until !== null && input.until !== undefined
        ? { until: timestampSeconds(input.until, 'until') }
        : {}),
      ...(input.inboxId ? { inbox_id: requirePositiveId(input.inboxId, 'inboxId') } : {}),
      ...(input.userId ? { user_id: requirePositiveId(input.userId, 'userId') } : {}),
      ...(input.name ? { name: requireText(input.name, 'name') } : {}),
    }, { operationName: 'list_reporting_events' });
    const rows = requireArray(payload?.payload, 'list_reporting_events.payload');
    const totalPages = nullablePositiveInteger(
      payload?.meta?.total_pages,
      'list_reporting_events.meta.total_pages',
    );
    const currentPage = nullablePositiveInteger(
      payload?.meta?.current_page,
      'list_reporting_events.meta.current_page',
    );
    if (currentPage !== null && currentPage !== page) {
      throw permanentError('Chatwoot reporting events returned a mismatched page', {
        code: 'CHATWOOT_PAGE_CONTRACT_INVALID',
        details: { operation: 'list_reporting_events', page, currentPage },
      });
    }
    if (totalPages !== null && page > totalPages) {
      throw permanentError('Chatwoot reporting events page exceeds declared total pages', {
        code: 'CHATWOOT_PAGE_CONTRACT_INVALID',
        details: { operation: 'list_reporting_events', page, totalPages },
      });
    }
    const totalCount = nullableNonNegativeInteger(payload?.meta?.count, 'list_reporting_events.meta.count');
    return freezePage({
      page,
      rows,
      totalCount,
      totalPages,
      hasMore: totalPages === null ? rows.length > 0 : page < totalPages,
    });
  }

  async listConversationLabels(conversationId) {
    const id = requirePositiveId(conversationId, 'conversationId');
    const payload = await this.get(
      this.#accountPath(`conversations/${id}/labels`),
      {},
      { operationName: 'list_conversation_labels' },
    );
    return Object.freeze(requireArray(payload?.payload, 'list_conversation_labels.payload')
      .map((value) => requireText(value, 'conversation label')));
  }

  async listConversationReportingEvents(conversationId) {
    const id = requirePositiveId(conversationId, 'conversationId');
    const payload = await this.get(
      this.#accountPath(`conversations/${id}/reporting_events`),
      {},
      { operationName: 'list_conversation_reporting_events' },
    );
    return freezeRows(requireArray(payload, 'list_conversation_reporting_events response'));
  }

  async listMessagesPage(input = {}) {
    const conversationId = requirePositiveId(input.conversationId, 'conversationId');
    const after = optionalPositiveId(input.after, 'after');
    const before = optionalPositiveId(input.before, 'before');
    if (after !== null && before !== null) {
      throw new TypeError('Chatwoot message request cannot use after and before together');
    }
    const mode = after !== null ? 'after' : 'before';
    const payload = await this.get(
      this.#accountPath(`conversations/${conversationId}/messages`),
      after !== null ? { after } : before !== null ? { before } : {},
      { operationName: 'list_messages' },
    );
    const rows = [...requireArray(payload?.payload, 'list_messages.payload')]
      .sort((left, right) => Number(requirePositiveId(left?.id, 'message.id'))
        - Number(requirePositiveId(right?.id, 'message.id')));
    const messageIds = rows.map((row) => Number(requirePositiveId(row?.id, 'message.id')));
    assertStrictlyIncreasing(messageIds, after === null ? null : Number(after));
    if (before !== null && messageIds.some((value) => value >= Number(before))) {
      throw permanentError('Chatwoot before pagination returned an out-of-range message', {
        code: 'CHATWOOT_MESSAGE_CURSOR_REPEATED',
        details: { before },
      });
    }
    const nextAfter = messageIds.length > 0 ? String(messageIds.at(-1)) : null;
    const nextBefore = messageIds.length > 0 ? String(messageIds[0]) : null;
    const pageSize = mode === 'after' ? MESSAGE_AFTER_PAGE_SIZE : MESSAGE_BEFORE_PAGE_SIZE;
    return Object.freeze({
      rows: freezeRows(rows),
      mode,
      nextAfter,
      nextBefore,
      hasMore: rows.length >= pageSize,
      labels: Object.freeze(requireArray(payload?.meta?.labels ?? [], 'list_messages.meta.labels')
        .map((value) => requireText(value, 'message meta label'))),
    });
  }

  async collectPages(readPage, options = {}) {
    if (typeof readPage !== 'function') throw new TypeError('collectPages requires readPage');
    const maxPages = boundedInteger(options.maxPages ?? this.maxPages, 'maxPages', 1, this.maxPages);
    const maxRows = boundedInteger(options.maxRows ?? this.maxRows, 'maxRows', 1, this.maxRows);
    const rows = [];
    let declaredTotal = null;

    for (let page = 1; page <= maxPages; page += 1) {
      const result = requireObject(await readPage(page), 'page result');
      const pageRows = requireArray(result.rows, 'page result rows');
      if (result.page !== undefined && Number(result.page) !== page) {
        throw permanentError('Chatwoot pagination returned a mismatched page', {
          code: 'CHATWOOT_PAGE_CONTRACT_INVALID',
          details: { page, returnedPage: result.page },
        });
      }
      if (result.totalCount !== null && result.totalCount !== undefined) {
        const total = nonNegativeInteger(result.totalCount, 'page totalCount');
        if (declaredTotal !== null && total !== declaredTotal) {
          throw permanentError('Chatwoot pagination total changed during one read', {
            code: 'CHATWOOT_PAGE_TOTAL_CHANGED',
            details: { page, previousTotal: declaredTotal, total },
          });
        }
        declaredTotal = total;
      }
      if (rows.length + pageRows.length > maxRows) {
        throw permanentError('Chatwoot pagination exceeded configured row limit', {
          code: 'CHATWOOT_ROW_LIMIT_EXCEEDED',
          details: { page, maxRows },
        });
      }
      rows.push(...pageRows);
      const exhaustedByTotal = declaredTotal !== null && rows.length >= declaredTotal;
      if (pageRows.length === 0 || result.hasMore === false || exhaustedByTotal) {
        if (declaredTotal !== null && rows.length < declaredTotal && result.hasMore === false) {
          throw permanentError('Chatwoot pagination stopped before declared total was observed', {
            code: 'CHATWOOT_PAGE_INCOMPLETE',
            details: { observedRows: rows.length, declaredTotal },
          });
        }
        return Object.freeze({
          rows: freezeRows(rows),
          pagesProcessed: page,
          declaredTotal,
          complete: true,
        });
      }
    }

    throw permanentError('Chatwoot pagination exceeded configured maxPages', {
      code: 'CHATWOOT_PAGINATION_LIMIT',
      details: { maxPages },
    });
  }

  async get(path, query = {}, options = {}) {
    const safePath = normalizePath(path);
    const operation = normalizeOperationName(options.operationName);
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      this.onRequest({ stage: 'chatwoot_request_start', operation, attempt, maxAttempts: this.maxAttempts });
      try {
        const result = await this.#requestOnce(safePath, query, operation);
        this.onRequest({ stage: 'chatwoot_request_success', operation, attempt, status: result.status });
        return result.payload;
      } catch (error) {
        lastError = error;
        if (error?.retryable !== true || attempt === this.maxAttempts) {
          this.onRequest({
            stage: 'chatwoot_request_failed',
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
        this.onRequest({ stage: 'chatwoot_request_retry', operation, attempt, delayMs });
        await this.sleep(delayMs);
      }
    }

    throw lastError ?? transientError('Chatwoot request failed', { code: 'CHATWOOT_REQUEST_FAILED' });
  }

  #accountPath(suffix) {
    return `api/v1/accounts/${this.accountId}/${normalizePath(suffix)}`;
  }

  async #requestOnce(path, query, operation) {
    const url = new URL(path, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ accept: 'application/json', api_access_token: this.accessToken });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
      const text = await readBoundedResponseText(response, this.maxResponseBytes);
      if (!response.ok) {
        throw createHttpError(response, parseJsonBestEffort(text), operation);
      }
      const payload = parseJsonStrict(text, operation, response.status);
      return Object.freeze({ payload, status: response.status });
    } catch (cause) {
      if (controller.signal.aborted || cause?.name === 'AbortError') {
        throw transientError(`Chatwoot request timed out: ${operation}`, {
          code: 'CHATWOOT_REQUEST_TIMEOUT',
          cause,
          details: { operation, timeoutMs: this.timeoutMs },
        });
      }
      if (cause?.code) throw cause;
      throw transientError(`Chatwoot network request failed: ${operation}`, {
        code: 'CHATWOOT_NETWORK_ERROR',
        cause,
        details: { operation },
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function createHttpError(response, payload, operation) {
  const status = Number(response?.status ?? 0);
  const retryAfter = readRetryAfter(response?.headers?.get?.('retry-after'));
  const details = { operation, status, retryAfter };
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) {
    return transientError(`Chatwoot request failed with retryable HTTP ${status}: ${operation}`, {
      code: status === 429 ? 'CHATWOOT_RATE_LIMITED' : 'CHATWOOT_HTTP_RETRYABLE',
      details,
    });
  }
  const errorCode = typeof payload?.code === 'string' ? payload.code : null;
  return permanentError(`Chatwoot request failed with HTTP ${status}: ${operation}`, {
    code: status === 401 || status === 403
      ? 'CHATWOOT_AUTHORIZATION_FAILED'
      : status === 404
        ? 'CHATWOOT_RESOURCE_NOT_FOUND'
        : 'CHATWOOT_HTTP_PERMANENT',
    details: { ...details, providerCode: errorCode },
  });
}

async function readBoundedResponseText(response, maxBytes) {
  if (!response?.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw responseTooLarge(maxBytes);
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
      if (totalBytes > maxBytes) {
        try { await reader.cancel('Chatwoot response exceeded byte limit'); } catch {}
        throw responseTooLarge(maxBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function responseTooLarge(maxBytes) {
  return permanentError('Chatwoot response exceeded configured byte limit', {
    code: 'CHATWOOT_RESPONSE_TOO_LARGE',
    details: { maxResponseBytes: maxBytes },
  });
}

function parseJsonStrict(text, operation, status) {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw permanentError(`Chatwoot response is not valid JSON: ${operation}`, {
      code: 'CHATWOOT_INVALID_JSON',
      cause,
      details: { operation, status },
    });
  }
}

function parseJsonBestEffort(text) {
  if (text === '') return null;
  try { return JSON.parse(text); } catch { return null; }
}

function normalizeBaseUrl(value, allowInsecureLocal) {
  const text = requireText(value, 'baseUrl');
  let url;
  try { url = new URL(text); } catch (cause) {
    throw permanentError('Chatwoot baseUrl must be an absolute URL', {
      code: 'CHATWOOT_CONFIG_INVALID',
      cause,
    });
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowInsecureLocal && local && url.protocol === 'http:')) {
    throw permanentError('Chatwoot baseUrl must use HTTPS', { code: 'CHATWOOT_CONFIG_INVALID' });
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
}

function normalizePath(value) {
  const path = requireText(value, 'path').replace(/^\/+|\/+$/gu, '');
  if (path.includes('..') || path.includes('?') || path.includes('#')) {
    throw permanentError('Chatwoot request path is invalid', { code: 'CHATWOOT_PATH_INVALID' });
  }
  return path;
}

function normalizeOperationName(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'chatwoot_get';
}

function freezePage(value) {
  return Object.freeze({
    page: value.page,
    rows: freezeRows(value.rows),
    totalCount: value.totalCount ?? null,
    totalPages: value.totalPages ?? null,
    hasMore: value.hasMore === true,
  });
}

function freezeRows(rows) {
  return Object.freeze(rows.map((row) => Object.freeze({ ...requireObject(row, 'row') })));
}

function readArrayPayload(payload, field, operation) {
  return requireArray(payload?.[field], `${operation}.${field}`);
}

function assertStrictlyIncreasing(values, previous) {
  let last = previous;
  for (const value of values) {
    if (last !== null && value <= last) {
      throw permanentError('Chatwoot message cursor did not increase', {
        code: 'CHATWOOT_MESSAGE_CURSOR_REPEATED',
        details: { previous: last, current: value },
      });
    }
    last = value;
  }
}

function calculateRetryDelay(input) {
  if (Number.isFinite(input.retryAfter) && input.retryAfter >= 0) {
    return Math.min(input.maxDelayMs, Math.round(input.retryAfter * 1_000));
  }
  const exponent = Math.max(0, input.attempt - 1);
  const base = Math.min(input.maxDelayMs, input.baseDelayMs * (2 ** exponent));
  return Math.min(input.maxDelayMs, Math.round(base * (0.75 + input.random() * 0.5)));
}

function readRetryAfter(value) {
  if (value === null || value === undefined || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1_000) : null;
}

function timestampSeconds(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive timestamp`);
  return String(Math.floor(number > 100_000_000_000 ? number / 1_000 : number));
}

function requirePositiveId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
  return String(number);
}

function optionalPositiveId(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requirePositiveId(value, fieldName);
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return number;
}

function boundedInteger(value, fieldName, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new TypeError(`${fieldName} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }
  return number;
}

function nullableNonNegativeInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return nonNegativeInteger(value, fieldName);
}

function nullablePositiveInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return positiveInteger(value, fieldName);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
