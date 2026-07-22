import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const EMPTY_PAYLOAD_JSON = '{}';
const TERMINAL_STATUSES = "'preview_validated', 'failed_permanent', 'completed'";

/** Durable replay, idempotency and bounded-payload store for signed Manager Script delivery. */
export class D1GoogleAdsDeliveryStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  async cleanupRetention(input = {}) {
    const now = safeInteger(input.now ?? this.now(), 'now');
    const auditCutoff = safeInteger(input.auditCutoff, 'auditCutoff');
    try {
      await this.db.prepare('DELETE FROM google_ads_delivery_nonces WHERE expires_at < ?')
        .bind(now)
        .run();
      await this.db.prepare(`
        UPDATE google_ads_deliveries
        SET status = CASE
              WHEN status IN ('reserved', 'queue_failed', 'queued', 'processing', 'failed_retryable')
                THEN 'failed_permanent'
              ELSE status
            END,
            payload_json = ?,
            last_error_code = CASE
              WHEN status IN ('reserved', 'queue_failed', 'queued', 'processing', 'failed_retryable')
                THEN 'GOOGLE_ADS_DELIVERY_PAYLOAD_EXPIRED'
              ELSE last_error_code
            END,
            completed_at = CASE
              WHEN status IN ('reserved', 'queue_failed', 'queued', 'processing', 'failed_retryable')
                THEN COALESCE(completed_at, ?)
              ELSE completed_at
            END,
            updated_at = ?
        WHERE payload_expires_at < ? AND payload_json <> ?
      `).bind(EMPTY_PAYLOAD_JSON, now, now, now, EMPTY_PAYLOAD_JSON).run();
      await this.db.prepare(`
        DELETE FROM google_ads_deliveries
        WHERE status IN (${TERMINAL_STATUSES}) AND updated_at < ?
      `).bind(auditCutoff).run();
      return true;
    } catch (cause) {
      throw d1Error('Failed to clean Google Ads delivery retention state', 'D1_GOOGLE_ADS_RETENTION_CLEANUP_FAILED', cause);
    }
  }

  async reserveNonce(input = {}) {
    const nonce = requireText(input.nonce, 'nonce');
    const keyId = requireText(input.keyId, 'keyId');
    const contentSha256 = requireSha(input.contentSha256);
    const receivedAt = safeInteger(input.receivedAt ?? this.now(), 'receivedAt');
    const expiresAt = safeInteger(input.expiresAt, 'expiresAt');
    try {
      const result = await this.db.prepare(`
        INSERT OR IGNORE INTO google_ads_delivery_nonces (
          nonce, key_id, content_sha256, received_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)
      `).bind(nonce, keyId, contentSha256, receivedAt, expiresAt).run();
      if (readChanges(result) === 0) {
        throw permanentError('Signed nonce has already been used', {
          code: 'GOOGLE_ADS_DELIVERY_REPLAY_REJECTED',
        });
      }
      return true;
    } catch (cause) {
      if (cause?.code === 'GOOGLE_ADS_DELIVERY_REPLAY_REJECTED') throw cause;
      throw d1Error('Failed to reserve signed nonce', 'D1_GOOGLE_ADS_NONCE_WRITE_FAILED', cause);
    }
  }

  async reserveDelivery(input = {}) {
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey');
    const deliveryId = requireText(input.deliveryId, 'deliveryId');
    const contentSha256 = requireSha(input.contentSha256);
    const mode = requireChoice(input.mode, ['PREVIEW', 'LIVE'], 'mode');
    const payloadJson = requireText(input.payloadJson, 'payloadJson');
    const payloadExpiresAt = safeInteger(input.payloadExpiresAt, 'payloadExpiresAt');
    const now = this.now();
    try {
      const insertResult = await this.db.prepare(`
        INSERT OR IGNORE INTO google_ads_deliveries (
          idempotency_key, delivery_id, content_sha256, mode, status,
          payload_json, payload_expires_at, queue_attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'reserved', ?, ?, 0, ?, ?)
      `).bind(
        idempotencyKey,
        deliveryId,
        contentSha256,
        mode,
        payloadJson,
        payloadExpiresAt,
        now,
        now,
      ).run();
      const duplicate = readChanges(insertResult) === 0;
      const row = await this.#readBy('idempotency_key', idempotencyKey);
      if (!row) throw new Error('Delivery reservation row was not readable');
      if (row.delivery_id !== deliveryId || row.content_sha256 !== contentSha256 || row.mode !== mode) {
        throw permanentError('Idempotency key was reused with different content', {
          code: 'GOOGLE_ADS_DELIVERY_IDEMPOTENCY_CONFLICT',
        });
      }
      return freezeDelivery(row, duplicate);
    } catch (cause) {
      if (cause?.code === 'GOOGLE_ADS_DELIVERY_IDEMPOTENCY_CONFLICT') throw cause;
      throw d1Error('Failed to reserve Google Ads delivery', 'D1_GOOGLE_ADS_DELIVERY_RESERVE_FAILED', cause);
    }
  }

  async markPreviewValidated(input = {}) {
    const deliveryId = requireText(input.deliveryId, 'deliveryId');
    const reconciliationJson = JSON.stringify(input.validation ?? {});
    const now = this.now();
    try {
      const result = await this.db.prepare(`
        UPDATE google_ads_deliveries
        SET status = 'preview_validated', payload_json = ?,
            completed_at = COALESCE(completed_at, ?), reconciliation_json = ?,
            last_error_code = NULL, updated_at = ?
        WHERE delivery_id = ? AND mode = 'PREVIEW'
          AND status IN ('reserved', 'preview_validated')
      `).bind(EMPTY_PAYLOAD_JSON, now, reconciliationJson, now, deliveryId).run();
      if (readChanges(result) === 0) {
        throw permanentError('Preview delivery state is invalid', {
          code: 'GOOGLE_ADS_DELIVERY_STATE_INVALID',
        });
      }
      return true;
    } catch (cause) {
      if (cause?.code === 'GOOGLE_ADS_DELIVERY_STATE_INVALID') throw cause;
      throw d1Error('Failed to complete preview validation', 'D1_GOOGLE_ADS_PREVIEW_COMPLETE_FAILED', cause);
    }
  }

  async markQueued(idempotencyKey) {
    return this.#updateStatus({
      idempotencyKey,
      sql: `UPDATE google_ads_deliveries
            SET status = 'queued', queue_attempts = queue_attempts + 1,
                queued_at = COALESCE(queued_at, ?), last_error_code = NULL, updated_at = ?
            WHERE idempotency_key = ? AND status IN ('reserved', 'queue_failed', 'queued')`,
      bindings: (now, key) => [now, now, key],
      code: 'D1_GOOGLE_ADS_DELIVERY_QUEUE_MARK_FAILED',
    });
  }

  async markQueueFailed(idempotencyKey, errorCode) {
    const key = requireText(idempotencyKey, 'idempotencyKey');
    const code = nullableText(errorCode);
    const now = this.now();
    try {
      await this.db.prepare(`
        UPDATE google_ads_deliveries
        SET status = 'queue_failed', queue_attempts = queue_attempts + 1,
            last_error_code = ?, updated_at = ?
        WHERE idempotency_key = ? AND status IN ('reserved', 'queue_failed', 'queued')
      `).bind(code, now, key).run();
      return true;
    } catch (cause) {
      throw d1Error('Failed to persist queue failure', 'D1_GOOGLE_ADS_DELIVERY_QUEUE_FAILURE_WRITE_FAILED', cause);
    }
  }

  async readDeliveryById(deliveryId) {
    const id = requireText(deliveryId, 'deliveryId');
    try {
      const row = await this.#readBy('delivery_id', id);
      if (!row) {
        throw permanentError('Google Ads delivery was not found', {
          code: 'GOOGLE_ADS_DELIVERY_NOT_FOUND',
        });
      }
      if (row.payload_json !== EMPTY_PAYLOAD_JSON
        && Number(row.payload_expires_at) < this.now()) {
        await this.#expirePayload(id);
        throw permanentError('Google Ads delivery payload has expired', {
          code: 'GOOGLE_ADS_DELIVERY_PAYLOAD_EXPIRED',
        });
      }
      return freezeDelivery(row, true);
    } catch (cause) {
      if (new Set(['GOOGLE_ADS_DELIVERY_NOT_FOUND', 'GOOGLE_ADS_DELIVERY_PAYLOAD_EXPIRED']).has(cause?.code)) throw cause;
      throw d1Error('Failed to read Google Ads delivery', 'D1_GOOGLE_ADS_DELIVERY_READ_FAILED', cause);
    }
  }

  async markProcessing(deliveryId) {
    const id = requireText(deliveryId, 'deliveryId');
    const now = this.now();
    try {
      const result = await this.db.prepare(`
        UPDATE google_ads_deliveries
        SET status = 'processing', processing_at = COALESCE(processing_at, ?), updated_at = ?
        WHERE delivery_id = ? AND mode = 'LIVE'
          AND status IN ('reserved', 'queue_failed', 'queued', 'processing', 'failed_retryable')
      `).bind(now, now, id).run();
      if (readChanges(result) === 0) {
        const current = await this.readDeliveryById(id);
        if (current.status === 'completed') return false;
        throw permanentError('Google Ads delivery state cannot enter processing', {
          code: 'GOOGLE_ADS_DELIVERY_STATE_INVALID',
        });
      }
      return true;
    } catch (cause) {
      if (cause?.code === 'GOOGLE_ADS_DELIVERY_STATE_INVALID') throw cause;
      throw d1Error('Failed to mark delivery processing', 'D1_GOOGLE_ADS_DELIVERY_PROCESSING_MARK_FAILED', cause);
    }
  }

  async markCompleted(input = {}) {
    const deliveryId = requireText(input.deliveryId, 'deliveryId');
    const reconciliationJson = JSON.stringify(input.reconciliation ?? {});
    const now = this.now();
    try {
      await this.db.prepare(`
        UPDATE google_ads_deliveries
        SET status = 'completed', payload_json = ?,
            completed_at = COALESCE(completed_at, ?), reconciliation_json = ?,
            last_error_code = NULL, updated_at = ?
        WHERE delivery_id = ? AND status IN ('processing', 'completed')
      `).bind(EMPTY_PAYLOAD_JSON, now, reconciliationJson, now, deliveryId).run();
      return true;
    } catch (cause) {
      throw d1Error('Failed to mark delivery completed', 'D1_GOOGLE_ADS_DELIVERY_COMPLETE_FAILED', cause);
    }
  }

  async markFailed(input = {}) {
    const deliveryId = requireText(input.deliveryId, 'deliveryId');
    const retryable = input.retryable === true;
    const now = this.now();
    try {
      await this.db.prepare(`
        UPDATE google_ads_deliveries
        SET status = ?,
            completed_at = CASE WHEN ? = 1 THEN completed_at ELSE COALESCE(completed_at, ?) END,
            last_error_code = ?, updated_at = ?
        WHERE delivery_id = ? AND status <> 'completed'
      `).bind(
        retryable ? 'failed_retryable' : 'failed_permanent',
        retryable ? 1 : 0,
        now,
        nullableText(input.errorCode),
        now,
        deliveryId,
      ).run();
      return true;
    } catch (cause) {
      throw d1Error('Failed to persist delivery failure', 'D1_GOOGLE_ADS_DELIVERY_FAILURE_WRITE_FAILED', cause);
    }
  }

  async #expirePayload(deliveryId) {
    const now = this.now();
    await this.db.prepare(`
      UPDATE google_ads_deliveries
      SET status = CASE
            WHEN status IN ('reserved', 'queue_failed', 'queued', 'processing', 'failed_retryable')
              THEN 'failed_permanent'
            ELSE status
          END,
          payload_json = ?,
          last_error_code = CASE
            WHEN status IN ('reserved', 'queue_failed', 'queued', 'processing', 'failed_retryable')
              THEN 'GOOGLE_ADS_DELIVERY_PAYLOAD_EXPIRED'
            ELSE last_error_code
          END,
          completed_at = CASE
            WHEN status IN ('reserved', 'queue_failed', 'queued', 'processing', 'failed_retryable')
              THEN COALESCE(completed_at, ?)
            ELSE completed_at
          END,
          updated_at = ?
      WHERE delivery_id = ? AND payload_json <> ?
    `).bind(EMPTY_PAYLOAD_JSON, now, now, deliveryId, EMPTY_PAYLOAD_JSON).run();
  }

  async #readBy(column, value) {
    if (!new Set(['idempotency_key', 'delivery_id']).has(column)) throw new TypeError('Unsupported lookup column');
    return this.db.prepare(`
      SELECT idempotency_key, delivery_id, content_sha256, mode, status,
             payload_json, payload_expires_at, queue_attempts, queued_at, processing_at,
             completed_at, reconciliation_json, last_error_code, created_at, updated_at
      FROM google_ads_deliveries WHERE ${column} = ?
    `).bind(value).first();
  }

  async #updateStatus(input) {
    const key = requireText(input.idempotencyKey, 'idempotencyKey');
    const now = this.now();
    try {
      await this.db.prepare(input.sql).bind(...input.bindings(now, key)).run();
      return true;
    } catch (cause) {
      throw d1Error('Failed to update Google Ads delivery state', input.code, cause);
    }
  }
}

function freezeDelivery(row, duplicate) {
  return Object.freeze({
    idempotencyKey: row.idempotency_key,
    deliveryId: row.delivery_id,
    contentSha256: row.content_sha256,
    mode: row.mode,
    status: row.status,
    payloadJson: row.payload_json,
    payloadExpiresAt: row.payload_expires_at ?? null,
    queueAttempts: Number(row.queue_attempts ?? 0),
    queuedAt: row.queued_at ?? null,
    processingAt: row.processing_at ?? null,
    completedAt: row.completed_at ?? null,
    reconciliationJson: row.reconciliation_json ?? null,
    lastErrorCode: row.last_error_code ?? null,
    duplicate,
  });
}
function readChanges(result) { const value = Number(result?.meta?.changes ?? result?.changes ?? 0); return Number.isFinite(value) ? Math.trunc(value) : 0; }
function requireD1(value) { if (!value || typeof value.prepare !== 'function') throw permanentError('MKT_STATE_DB binding is required', { code: 'D1_BINDING_MISSING' }); return value; }
function requireText(value, label) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`); return value.trim(); }
function requireSha(value) { const text = requireText(value, 'contentSha256'); if (!/^[0-9a-f]{64}$/u.test(text)) throw new TypeError('contentSha256 is invalid'); return text; }
function requireChoice(value, choices, label) { const text = requireText(value, label); if (!choices.includes(text)) throw new TypeError(`${label} is unsupported`); return text; }
function safeInteger(value, label) { const number = Number(value); if (!Number.isSafeInteger(number)) throw new TypeError(`${label} must be a safe integer`); return number; }
function nullableText(value) { return value === null || value === undefined || value === '' ? null : String(value).slice(0, 120); }
function d1Error(message, code, cause) { return transientError(message, { code, cause, details: { causeMessage: cause instanceof Error ? cause.message : String(cause) } }); }
