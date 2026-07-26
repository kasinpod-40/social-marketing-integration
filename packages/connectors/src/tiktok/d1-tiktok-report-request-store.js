import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

export class D1TikTokReportRequestStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  async claim(input = {}) {
    const row = requireRequest(input, this.now());
    let result;
    try {
      result = await this.db.prepare(`
        INSERT INTO report_requests (
          request_id, customer_key, account_key, platform_scope,
          period_start, period_end, comparison_mode, status,
          result_report_id, requested_at, started_at, finished_at,
          error_code, created_at, updated_at
        ) VALUES (?, ?, ?, 'tiktok', ?, ?, ?, 'pending', NULL, ?, NULL, NULL, NULL, ?, ?)
        ON CONFLICT(request_id) DO NOTHING
      `).bind(
        row.requestId,
        row.customerKey,
        row.accountKey,
        row.periodStart,
        row.periodEnd,
        row.comparisonMode,
        row.requestedAt,
        row.createdAt,
        row.updatedAt,
      ).run();
    } catch (cause) {
      throw d1Error('Failed to claim TikTok report request', 'D1_TIKTOK_REPORT_REQUEST_WRITE_FAILED', cause);
    }
    const request = await this.read(row.requestId);
    if (!request) {
      throw transientError('TikTok report request was not readable after claim', {
        code: 'D1_TIKTOK_REPORT_REQUEST_READ_FAILED',
      });
    }
    assertIdentity(request, row);
    return Object.freeze({ created: readChanges(result) > 0, request });
  }

  async read(requestId) {
    const id = requireText(requestId, 'requestId');
    try {
      const row = await this.db.prepare('SELECT * FROM report_requests WHERE request_id = ?')
        .bind(id).first();
      return row ? freezeRequest(row) : null;
    } catch (cause) {
      throw d1Error('Failed to read TikTok report request', 'D1_TIKTOK_REPORT_REQUEST_READ_FAILED', cause);
    }
  }

  async markProcessing(input = {}) {
    return this.#transition(input.requestId, ['pending', 'processing', 'failed_retryable'], 'processing', {
      started_at: safeTimestamp(input.startedAt ?? this.now(), 'startedAt'),
      error_code: null,
    });
  }

  async markCompleted(input = {}) {
    return this.#transition(input.requestId, ['processing', 'completed'], 'completed', {
      result_report_id: requireText(input.reportId, 'reportId'),
      finished_at: safeTimestamp(input.finishedAt ?? this.now(), 'finishedAt'),
      error_code: null,
    });
  }

  async markFailed(input = {}) {
    return this.#transition(
      input.requestId,
      ['pending', 'processing', 'failed_retryable', 'failed_permanent'],
      input.retryable === true ? 'failed_retryable' : 'failed_permanent',
      { error_code: requireText(input.errorCode ?? 'TIKTOK_REPORT_FAILED', 'errorCode') },
    );
  }

  async #transition(requestId, allowed, status, assignments) {
    const id = requireText(requestId, 'requestId');
    const entries = Object.entries(assignments);
    const now = safeTimestamp(this.now(), 'now');
    let result;
    try {
      result = await this.db.prepare(`
        UPDATE report_requests
        SET status = ?,
            ${entries.map(([field]) => `${field} = ?`).join(',\n            ')},
            updated_at = ?
        WHERE request_id = ? AND status IN (${placeholders(allowed.length)})
      `).bind(
        status,
        ...entries.map(([, value]) => value ?? null),
        now,
        id,
        ...allowed,
      ).run();
    } catch (cause) {
      throw d1Error('Failed to update TikTok report request', 'D1_TIKTOK_REPORT_REQUEST_WRITE_FAILED', cause);
    }
    const request = await this.read(id);
    if (!request) throw permanentError('TikTok report request not found', { code: 'TIKTOK_REPORT_REQUEST_NOT_FOUND' });
    if (readChanges(result) === 0 && request.status !== status) {
      throw permanentError('TikTok report request transition is not allowed', {
        code: 'TIKTOK_REPORT_REQUEST_STATE_CONFLICT',
        details: { requestId: id, currentStatus: request.status, requestedStatus: status },
      });
    }
    return request;
  }
}

function requireRequest(value, now) {
  const periodStart = requireDate(value.periodStart, 'periodStart');
  const periodEnd = requireDate(value.periodEnd, 'periodEnd');
  if (periodStart > periodEnd) throw new TypeError('periodStart cannot be after periodEnd');
  const createdAt = safeTimestamp(value.createdAt ?? now, 'createdAt');
  return Object.freeze({
    requestId: requireText(value.requestId, 'requestId'),
    customerKey: requireText(value.customerKey, 'customerKey'),
    accountKey: requireText(value.accountKey, 'accountKey'),
    periodStart,
    periodEnd,
    comparisonMode: requireText(value.comparisonMode ?? 'previous_period', 'comparisonMode'),
    requestedAt: safeTimestamp(value.requestedAt, 'requestedAt'),
    createdAt,
    updatedAt: safeTimestamp(value.updatedAt ?? createdAt, 'updatedAt'),
  });
}

function assertIdentity(existing, incoming) {
  const fields = ['customerKey', 'accountKey', 'periodStart', 'periodEnd', 'comparisonMode'];
  const mismatch = fields.find((field) => existing[field] !== incoming[field]);
  if (mismatch) {
    throw permanentError('TikTok report request ID was reused with different identity', {
      code: 'TIKTOK_REPORT_REQUEST_IDENTITY_CONFLICT',
      details: { requestId: incoming.requestId, fieldName: mismatch },
    });
  }
}

function freezeRequest(row) {
  return Object.freeze({
    requestId: row.request_id,
    customerKey: row.customer_key,
    accountKey: row.account_key,
    platformScope: row.platform_scope,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    comparisonMode: row.comparison_mode,
    status: row.status,
    resultReportId: row.result_report_id ?? null,
    requestedAt: Number(row.requested_at),
    startedAt: nullableInteger(row.started_at),
    finishedAt: nullableInteger(row.finished_at),
    errorCode: row.error_code ?? null,
  });
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function safeTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a safe timestamp`);
  return number;
}

function nullableInteger(value) {
  return value === null || value === undefined ? null : Number(value);
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function readChanges(result) {
  const value = result?.meta?.changes ?? result?.changes ?? 0;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') throw new TypeError('D1TikTokReportRequestStore requires D1');
  return value;
}

function d1Error(message, code, cause) {
  return transientError(message, {
    code,
    cause,
    details: { causeMessage: cause instanceof Error ? cause.message : String(cause ?? '') },
  });
}
