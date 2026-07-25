import {
  permanentError,
  transientError,
} from '../../../shared/src/errors/runtime-error.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TERMINAL_STATUSES = new Set(['completed', 'failed_permanent']);

/** Atomic D1 authority for one reference-only Queue admission per validated LIVE run. */
export class D1GoogleAdsLiveAdmissionStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  async reserve(input = {}) {
    const row = normalizeReservation(input, this.now());
    try {
      await this.db.prepare(`
        INSERT INTO google_ads_live_admissions (
          run_id, operation_id, work_key, generation, original_requested_at,
          queue_body_digest, status, send_attempts, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, 'live_validated', 0, ?, ?
        FROM google_ads_delivery_runs
        WHERE run_id = ?
          AND mode = 'LIVE'
          AND status = 'assembling'
          AND run_started_at = ?
          AND received_chunk_count = expected_chunk_count
          AND received_row_count = expected_row_count
          AND payload_redacted_at IS NULL
        ON CONFLICT(run_id) DO NOTHING
      `).bind(
        row.runId,
        row.operationId,
        row.workKey,
        row.generation,
        row.originalRequestedAt,
        row.queueBodyDigest,
        row.now,
        row.now,
        row.runId,
        row.generation,
      ).run();
    } catch (cause) {
      throw d1Unavailable('Google Ads LIVE admission reservation failed', 'GOOGLE_ADS_LIVE_ADMISSION_RESERVE_FAILED', cause);
    }

    const existing = await this.getByRunId(row.runId);
    if (!existing) {
      throw permanentError('Google Ads LIVE run is incomplete or not admissible', {
        code: 'GOOGLE_ADS_LIVE_RUN_NOT_ADMISSIBLE',
      });
    }
    assertReservationMatches(existing, row);
    return Object.freeze({
      disposition: existing.createdAt === row.now ? 'reserved' : 'exact_retry',
      admission: existing,
    });
  }

  async markSendPending(input = {}) {
    const runId = requireUuid(input.runId, 'runId');
    const now = timestamp(input.now ?? this.now(), 'now');
    try {
      await this.db.prepare(`
        UPDATE google_ads_live_admissions
        SET status = 'send_pending',
            send_attempts = CASE
              WHEN status = 'send_pending' THEN send_attempts
              ELSE send_attempts + 1
            END,
            last_error_code = NULL,
            updated_at = ?
        WHERE run_id = ?
          AND status IN ('live_validated', 'send_pending', 'failed_retryable')
      `).bind(now, runId).run();
    } catch (cause) {
      throw d1Unavailable('Google Ads Queue send reservation failed', 'GOOGLE_ADS_QUEUE_SEND_RESERVE_FAILED', cause);
    }
    return this.requireMutable(runId, ['send_pending']);
  }

  async markQueued(input = {}) {
    const runId = requireUuid(input.runId, 'runId');
    const messageId = optionalText(input.messageId);
    const now = timestamp(input.now ?? this.now(), 'now');
    try {
      await this.db.prepare(`
        UPDATE google_ads_live_admissions
        SET status = 'queued',
            last_queue_message_id = COALESCE(?, last_queue_message_id),
            queued_at = COALESCE(queued_at, ?),
            last_error_code = NULL,
            updated_at = ?
        WHERE run_id = ? AND status IN ('send_pending', 'queued')
      `).bind(messageId, now, now, runId).run();
    } catch (cause) {
      throw d1Unavailable('Google Ads Queue admission completion failed', 'GOOGLE_ADS_QUEUE_ADMISSION_COMPLETE_FAILED', cause);
    }
    return this.requireMutable(runId, ['queued']);
  }

  async markProcessing(input = {}) {
    const runId = requireUuid(input.runId, 'runId');
    const now = timestamp(input.now ?? this.now(), 'now');
    try {
      await this.db.prepare(`
        UPDATE google_ads_live_admissions
        SET status = 'processing',
            processing_at = COALESCE(processing_at, ?),
            last_error_code = NULL,
            updated_at = ?
        WHERE run_id = ? AND status IN ('queued', 'processing', 'failed_retryable')
      `).bind(now, now, runId).run();
    } catch (cause) {
      throw d1Unavailable('Google Ads processing claim failed', 'GOOGLE_ADS_PROCESSING_CLAIM_FAILED', cause);
    }
    return this.requireMutable(runId, ['processing', 'completed']);
  }

  async markFailed(input = {}) {
    const runId = requireUuid(input.runId, 'runId');
    const retryable = input.retryable === true;
    const status = retryable ? 'failed_retryable' : 'failed_permanent';
    const errorCode = requireText(input.errorCode, 'errorCode');
    const now = timestamp(input.now ?? this.now(), 'now');
    try {
      await this.db.prepare(`
        UPDATE google_ads_live_admissions
        SET status = ?,
            last_error_code = ?,
            completed_at = CASE WHEN ? = 'failed_permanent' THEN COALESCE(completed_at, ?) ELSE completed_at END,
            updated_at = ?
        WHERE run_id = ? AND status <> 'completed'
      `).bind(status, errorCode, status, now, now, runId).run();
    } catch (cause) {
      throw d1Unavailable('Google Ads processing failure persistence failed', 'GOOGLE_ADS_PROCESSING_FAILURE_WRITE_FAILED', cause);
    }
    return this.requireMutable(runId, [status]);
  }

  async markCompleted(input = {}) {
    const runId = requireUuid(input.runId, 'runId');
    const reconciliationJson = stringifyJson(input.reconciliation ?? {}, 'reconciliation');
    const now = timestamp(input.now ?? this.now(), 'now');
    try {
      await this.db.batch([
        this.db.prepare(`
          UPDATE google_ads_delivery_chunks
          SET payload_json = NULL,
              redacted_at = COALESCE(redacted_at, ?)
          WHERE run_id = ? AND payload_json IS NOT NULL
        `).bind(now, runId),
        this.db.prepare(`
          UPDATE google_ads_delivery_runs
          SET completed_at = COALESCE(completed_at, ?),
              payload_redacted_at = COALESCE(payload_redacted_at, ?),
              updated_at = ?
          WHERE run_id = ? AND mode = 'LIVE'
        `).bind(now, now, now, runId),
        this.db.prepare(`
          UPDATE google_ads_live_admissions
          SET status = 'completed',
              reconciliation_json = ?,
              last_error_code = NULL,
              completed_at = COALESCE(completed_at, ?),
              payload_redacted_at = COALESCE(payload_redacted_at, ?),
              updated_at = ?
          WHERE run_id = ? AND status IN ('processing', 'completed')
        `).bind(reconciliationJson, now, now, now, runId),
      ]);
    } catch (cause) {
      throw d1Unavailable('Google Ads processing completion failed', 'GOOGLE_ADS_PROCESSING_COMPLETE_FAILED', cause);
    }
    return this.requireMutable(runId, ['completed']);
  }

  async getByRunId(runId) {
    return this.#first('SELECT * FROM google_ads_live_admissions WHERE run_id = ?', [requireUuid(runId, 'runId')]);
  }

  async getByOperationId(operationId) {
    return this.#first(
      'SELECT * FROM google_ads_live_admissions WHERE operation_id = ?',
      [requireUuid(operationId, 'operationId')],
    );
  }

  async requireMutable(runId, allowedStatuses) {
    const row = await this.getByRunId(runId);
    if (!row) {
      throw permanentError('Google Ads LIVE admission was not found', {
        code: 'GOOGLE_ADS_LIVE_ADMISSION_NOT_FOUND',
      });
    }
    if (!allowedStatuses.includes(row.status)) {
      if (TERMINAL_STATUSES.has(row.status)) return row;
      throw permanentError('Google Ads LIVE admission state transition was rejected', {
        code: 'GOOGLE_ADS_LIVE_ADMISSION_STATE_INVALID',
        details: { status: row.status },
      });
    }
    return row;
  }

  async #first(sql, bindings) {
    let row;
    try {
      row = await this.db.prepare(sql).bind(...bindings).first();
    } catch (cause) {
      throw d1Unavailable('Google Ads LIVE admission read failed', 'GOOGLE_ADS_LIVE_ADMISSION_READ_FAILED', cause);
    }
    return row ? mapAdmission(row) : null;
  }
}

function normalizeReservation(input, defaultNow) {
  const runId = requireUuid(input.runId, 'runId');
  const operationId = requireUuid(input.operationId, 'operationId');
  const generation = timestamp(input.generation, 'generation');
  const originalRequestedAt = timestamp(input.originalRequestedAt, 'originalRequestedAt');
  const workKey = requireText(input.workKey, 'workKey');
  if (operationId !== runId || workKey !== `google_ads:${runId}` || generation !== originalRequestedAt) {
    throw permanentError('Google Ads LIVE admission identity is inconsistent', {
      code: 'GOOGLE_ADS_LIVE_ADMISSION_IDENTITY_MISMATCH',
    });
  }
  return Object.freeze({
    runId,
    operationId,
    workKey,
    generation,
    originalRequestedAt,
    queueBodyDigest: digest(input.queueBodyDigest, 'queueBodyDigest'),
    now: timestamp(input.now ?? defaultNow, 'now'),
  });
}

function assertReservationMatches(existing, expected) {
  if (
    existing.operationId !== expected.operationId
    || existing.workKey !== expected.workKey
    || existing.generation !== expected.generation
    || existing.originalRequestedAt !== expected.originalRequestedAt
    || existing.queueBodyDigest !== expected.queueBodyDigest
  ) {
    throw permanentError('Google Ads LIVE admission conflicts with stored state', {
      code: 'GOOGLE_ADS_LIVE_ADMISSION_CONFLICT',
    });
  }
}

function mapAdmission(row) {
  return Object.freeze({
    runId: row.run_id,
    operationId: row.operation_id,
    workKey: row.work_key,
    generation: Number(row.generation),
    originalRequestedAt: Number(row.original_requested_at),
    queueBodyDigest: row.queue_body_digest,
    status: row.status,
    sendAttempts: Number(row.send_attempts),
    lastQueueMessageId: row.last_queue_message_id ?? null,
    lastErrorCode: row.last_error_code ?? null,
    reconciliation: parseJson(row.reconciliation_json),
    queuedAt: nullableTimestamp(row.queued_at),
    processingAt: nullableTimestamp(row.processing_at),
    completedAt: nullableTimestamp(row.completed_at),
    payloadRedactedAt: nullableTimestamp(row.payload_redacted_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  });
}

function parseJson(value) {
  if (!value) return null;
  try { return Object.freeze(JSON.parse(value)); } catch { return null; }
}

function stringifyJson(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > 262_144) {
    throw new RangeError(`${fieldName} exceeds 262144 bytes`);
  }
  return json;
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function' || typeof value?.batch !== 'function') {
    throw new TypeError('D1GoogleAdsLiveAdmissionStore requires D1 prepare() and batch()');
  }
  return value;
}

function requireUuid(value, fieldName) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) throw new TypeError(`${fieldName} must be a UUID v4`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(String(value), 'text');
}

function digest(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) throw new TypeError(`${fieldName} must be a SHA-256 hex digest`);
  return text;
}

function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a timestamp`);
  return number;
}

function nullableTimestamp(value) {
  return value === null || value === undefined ? null : Number(value);
}

function d1Unavailable(message, code, cause) {
  return transientError(message, { code, cause });
}
