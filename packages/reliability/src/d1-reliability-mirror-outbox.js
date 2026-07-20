import {
  permanentError,
  sanitizeOperationalText,
  transientError,
} from '../../shared/src/errors/runtime-error.js';

const SUPPORTED_METHODS = new Set(['saveSyncRun', 'saveSystemAlert']);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_PAYLOAD_LENGTH = 50_000;

/** เก็บงาน Mirror แบบ Durable ใน D1 เพื่อให้ Lark delivery รอดจาก Worker termination/retry */
export class D1ReliabilityMirrorOutbox {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  async schedule(input = {}) {
    const method = requireMethod(input.method);
    const payload = requirePayload(input.payload);
    const outboxId = buildReliabilityMirrorOutboxId(method, payload);
    const now = timestamp(input.createdAt ?? this.now(), 'createdAt');

    try {
      await this.db.prepare(`
        INSERT INTO reliability_mirror_outbox (
          outbox_id, mirror_method, payload_json, status, revision, delivery_attempts,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', 1, 0, ?, ?)
        ON CONFLICT(outbox_id) DO UPDATE SET
          mirror_method = excluded.mirror_method,
          payload_json = excluded.payload_json,
          status = 'pending',
          revision = reliability_mirror_outbox.revision + 1,
          last_error_code = NULL,
          last_error_message = NULL,
          delivered_at = NULL,
          updated_at = excluded.updated_at
      `).bind(outboxId, method, serializePayload(payload), now, now).run();
      return Object.freeze({ scheduled: true, status: 'pending' });
    } catch (cause) {
      throw d1Error('Failed to persist reliability mirror outbox', 'D1_RELIABILITY_MIRROR_OUTBOX_WRITE_FAILED', cause);
    }
  }

  async listPending(input = {}) {
    const limit = boundedLimit(input.limit ?? DEFAULT_LIMIT);
    try {
      const result = await this.db.prepare(`
        SELECT
          outbox_id, mirror_method, payload_json, revision, delivery_attempts,
          created_at, updated_at
        FROM reliability_mirror_outbox
        WHERE status = 'pending'
        ORDER BY updated_at ASC, outbox_id ASC
        LIMIT ?
      `).bind(limit).all();
      const rows = Array.isArray(result?.results) ? result.results : [];
      return Object.freeze(rows.map(normalizePendingRowSafely));
    } catch (cause) {
      if (cause?.retryable === false) throw cause;
      throw d1Error('Failed to read reliability mirror outbox', 'D1_RELIABILITY_MIRROR_OUTBOX_READ_FAILED', cause);
    }
  }

  async markDelivered(input = {}) {
    const outboxId = requireText(input.outboxId, 'outboxId');
    const revision = positiveInteger(input.revision, 'revision');
    const deliveredAt = timestamp(input.deliveredAt ?? this.now(), 'deliveredAt');
    try {
      const result = await this.db.prepare(`
        UPDATE reliability_mirror_outbox
        SET status = 'delivered',
            delivery_attempts = delivery_attempts + 1,
            last_error_code = NULL,
            last_error_message = NULL,
            delivered_at = COALESCE(delivered_at, ?),
            updated_at = ?
        WHERE outbox_id = ? AND status = 'pending' AND revision = ?
      `).bind(deliveredAt, deliveredAt, outboxId, revision).run();
      return Object.freeze({ delivered: readChanges(result) > 0 });
    } catch (cause) {
      throw d1Error('Failed to complete reliability mirror outbox', 'D1_RELIABILITY_MIRROR_OUTBOX_COMPLETE_FAILED', cause);
    }
  }

  async markPermanentFailed(input = {}) {
    const outboxId = requireText(input.outboxId, 'outboxId');
    const revision = positiveInteger(input.revision, 'revision');
    const updatedAt = timestamp(input.updatedAt ?? this.now(), 'updatedAt');
    const errorCode = nullableText(input.errorCode) ?? 'RELIABILITY_MIRROR_OUTBOX_INVALID';
    const errorMessage = sanitizeOperationalText(input.errorMessage ?? 'Reliability mirror outbox is invalid', {
      code: errorCode,
    });
    try {
      const result = await this.db.prepare(`
        UPDATE reliability_mirror_outbox
        SET status = 'failed_permanent',
            delivery_attempts = delivery_attempts + 1,
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
        WHERE outbox_id = ? AND status = 'pending' AND revision = ?
      `).bind(errorCode, errorMessage, updatedAt, outboxId, revision).run();
      return Object.freeze({ failedPermanent: readChanges(result) > 0 });
    } catch (cause) {
      throw d1Error('Failed to quarantine invalid reliability mirror outbox', 'D1_RELIABILITY_MIRROR_OUTBOX_QUARANTINE_FAILED', cause);
    }
  }

  async markDeliveryFailed(input = {}) {
    const outboxId = requireText(input.outboxId, 'outboxId');
    const revision = positiveInteger(input.revision, 'revision');
    const updatedAt = timestamp(input.updatedAt ?? this.now(), 'updatedAt');
    const errorCode = nullableText(input.errorCode) ?? 'RELIABILITY_MIRROR_DELIVERY_FAILED';
    const errorMessage = sanitizeOperationalText(input.errorMessage ?? 'Reliability mirror delivery failed', {
      code: errorCode,
    });
    try {
      const result = await this.db.prepare(`
        UPDATE reliability_mirror_outbox
        SET delivery_attempts = delivery_attempts + 1,
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
        WHERE outbox_id = ? AND status = 'pending' AND revision = ?
      `).bind(errorCode, errorMessage, updatedAt, outboxId, revision).run();
      return Object.freeze({ pending: readChanges(result) > 0 });
    } catch (cause) {
      throw d1Error('Failed to record reliability mirror delivery error', 'D1_RELIABILITY_MIRROR_OUTBOX_FAILURE_WRITE_FAILED', cause);
    }
  }
}

export function buildReliabilityMirrorOutboxId(method, payload) {
  const normalizedMethod = requireMethod(method);
  if (normalizedMethod === 'saveSyncRun') {
    return `reliability-mirror:sync-run:${requireText(payload?.syncId, 'payload.syncId')}`;
  }
  return `reliability-mirror:system-alert:${requireText(payload?.alertId, 'payload.alertId')}`;
}

function normalizePendingRowSafely(row) {
  const outboxId = requireText(row?.outbox_id, 'outbox_id');
  const revision = positiveInteger(row?.revision, 'revision');
  try {
    return normalizePendingRow(row);
  } catch (cause) {
    if (cause?.retryable === true) throw cause;
    return Object.freeze({
      outboxId,
      revision,
      invalid: true,
      validationCode: cause?.code ?? 'RELIABILITY_MIRROR_OUTBOX_INVALID',
    });
  }
}

function normalizePendingRow(row) {
  const method = requireMethod(row?.mirror_method);
  const payload = parsePayload(row?.payload_json);
  // ตรวจ deterministic identity ซ้ำตอนอ่าน เพื่อปฏิเสธข้อมูลเสียก่อนเรียก Lark
  const expectedId = buildReliabilityMirrorOutboxId(method, payload);
  const outboxId = requireText(row?.outbox_id, 'outbox_id');
  if (outboxId !== expectedId) {
    throw permanentError('Reliability mirror outbox identity does not match its payload', {
      code: 'RELIABILITY_MIRROR_OUTBOX_INVALID',
    });
  }
  return Object.freeze({
    outboxId,
    revision: positiveInteger(row?.revision, 'revision'),
    method,
    payload: Object.freeze(payload),
    deliveryAttempts: nonNegativeInteger(row?.delivery_attempts ?? 0, 'delivery_attempts'),
    createdAt: timestamp(row?.created_at, 'created_at'),
    updatedAt: timestamp(row?.updated_at, 'updated_at'),
  });
}

function serializePayload(value) {
  const text = JSON.stringify(value);
  if (typeof text !== 'string' || text.length > MAX_PAYLOAD_LENGTH) {
    throw permanentError('Reliability mirror payload is too large', {
      code: 'RELIABILITY_MIRROR_PAYLOAD_INVALID',
    });
  }
  return text;
}

function parsePayload(value) {
  try {
    return requirePayload(JSON.parse(requireText(value, 'payload_json')));
  } catch (cause) {
    if (cause?.code === 'RELIABILITY_MIRROR_PAYLOAD_INVALID') throw cause;
    throw permanentError('Reliability mirror outbox payload is malformed', {
      code: 'RELIABILITY_MIRROR_OUTBOX_INVALID',
      cause,
    });
  }
}

function requirePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw permanentError('Reliability mirror payload must be an object', {
      code: 'RELIABILITY_MIRROR_PAYLOAD_INVALID',
    });
  }
  return value;
}

function requireMethod(value) {
  const method = requireText(value, 'method');
  if (!SUPPORTED_METHODS.has(method)) {
    throw permanentError('Reliability mirror method is not supported', {
      code: 'RELIABILITY_MIRROR_METHOD_UNSUPPORTED',
    });
  }
  return method;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`D1ReliabilityMirrorOutbox ${fieldName} must be a positive integer`);
  }
  return number;
}

function boundedLimit(value) {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    throw permanentError(`Reliability mirror limit must be between 1 and ${MAX_LIMIT}`, {
      code: 'RELIABILITY_MIRROR_LIMIT_INVALID',
      details: { max: MAX_LIMIT },
    });
  }
  return limit;
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') {
    throw new TypeError('D1ReliabilityMirrorOutbox requires db.prepare');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`D1ReliabilityMirrorOutbox requires ${fieldName}`);
  }
  return value.trim();
}

function nullableText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`D1ReliabilityMirrorOutbox ${fieldName} must be a non-negative integer`);
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  return timestamp(value, fieldName);
}

function readChanges(result) {
  const value = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function d1Error(message, code, cause) {
  return transientError(message, {
    code,
    cause,
    details: {
      causeMessage: sanitizeOperationalText(cause instanceof Error ? cause.message : String(cause)),
    },
  });
}
