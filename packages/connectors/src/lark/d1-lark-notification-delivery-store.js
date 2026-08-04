import {
  permanentError,
  sanitizeOperationalText,
  transientError,
} from '../../../shared/src/errors/runtime-error.js';

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const TERMINAL_STATUSES = new Set(['sent', 'blocked', 'blocked_unknown']);

/**
 * D1 delivery authority for Lark executive notifications.
 *
 * Exact-send safety:
 * - one INSERT/UPSERT statement atomically claims a notification_attempt_key;
 * - only an expired `claimed` row may be reclaimed because no send has started yet;
 * - `sending` is never automatically reclaimed because the remote outcome may be unknown;
 * - `sent` is terminal and every replay becomes a no-send dedupe result;
 * - a terminal `sent` replay increments claim_count only as durable proof that the replay reached D1.
 */
export class D1LarkNotificationDeliveryStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  async claim(input = {}) {
    const row = normalizeClaim(input, this.now());
    let result;
    try {
      result = await this.db.prepare(`
        INSERT INTO lark_notification_deliveries (
          notification_attempt_key, ai_run_key, dedupe_key, report_id,
          report_setting_key, customer_profile, destination_key_hash,
          template_version, payload_checksum, status, claim_owner,
          lease_expires_at, claim_count, mirror_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'claimed', ?, ?, 1, 'pending', ?, ?)
        ON CONFLICT(notification_attempt_key) DO UPDATE SET
          claim_owner = excluded.claim_owner,
          lease_expires_at = excluded.lease_expires_at,
          claim_count = lark_notification_deliveries.claim_count + 1,
          updated_at = excluded.updated_at
        WHERE lark_notification_deliveries.status = 'claimed'
          AND lark_notification_deliveries.lease_expires_at <= ?
          AND lark_notification_deliveries.ai_run_key = excluded.ai_run_key
          AND lark_notification_deliveries.dedupe_key = excluded.dedupe_key
          AND lark_notification_deliveries.report_id = excluded.report_id
          AND lark_notification_deliveries.report_setting_key = excluded.report_setting_key
          AND lark_notification_deliveries.customer_profile = excluded.customer_profile
          AND lark_notification_deliveries.destination_key_hash = excluded.destination_key_hash
          AND lark_notification_deliveries.template_version = excluded.template_version
          AND lark_notification_deliveries.payload_checksum = excluded.payload_checksum
      `).bind(
        row.notificationAttemptKey,
        row.aiRunKey,
        row.dedupeKey,
        row.reportId,
        row.reportSettingKey,
        row.customerProfile,
        row.destinationKeyHash,
        row.templateVersion,
        row.payloadChecksum,
        row.ownerId,
        row.leaseExpiresAt,
        row.now,
        row.now,
        row.now,
      ).run();
    } catch (cause) {
      throw d1Transient('Failed to claim Lark notification delivery', 'D1_LARK_NOTIFICATION_CLAIM_FAILED', cause);
    }

    let persisted = await this.read(row.notificationAttemptKey);
    assertClaimIdentity(persisted, row);
    const acquired = readChanges(result) > 0
      && persisted.status === 'claimed'
      && persisted.claimOwner === row.ownerId;

    // A sent replay must not acquire the claim or change send evidence. Increment only the
    // durable observation counter so Controlled UAT can prove the exact replay reached D1.
    if (!acquired && persisted.status === 'sent') {
      let replayResult;
      try {
        replayResult = await this.db.prepare(`
          UPDATE lark_notification_deliveries
          SET claim_count = claim_count + 1, updated_at = ?
          WHERE notification_attempt_key = ?
            AND status = 'sent'
            AND ai_run_key = ?
            AND dedupe_key = ?
            AND report_id = ?
            AND report_setting_key = ?
            AND customer_profile = ?
            AND destination_key_hash = ?
            AND template_version = ?
            AND payload_checksum = ?
        `).bind(
          row.now,
          row.notificationAttemptKey,
          row.aiRunKey,
          row.dedupeKey,
          row.reportId,
          row.reportSettingKey,
          row.customerProfile,
          row.destinationKeyHash,
          row.templateVersion,
          row.payloadChecksum,
        ).run();
      } catch (cause) {
        throw d1Transient(
          'Failed to record Lark notification replay observation',
          'D1_LARK_NOTIFICATION_REPLAY_OBSERVATION_FAILED',
          cause,
        );
      }
      assertChanged(replayResult, 'LARK_NOTIFICATION_REPLAY_OBSERVATION_REJECTED');
      persisted = await this.read(row.notificationAttemptKey);
      assertClaimIdentity(persisted, row);
    }

    return Object.freeze({
      acquired,
      disposition: acquired ? 'claimed' : dispositionFor(persisted),
      delivery: persisted,
    });
  }

  async markSending(input = {}) {
    const key = requireText(input.notificationAttemptKey, 'notificationAttemptKey');
    const ownerId = requireText(input.ownerId, 'ownerId');
    const now = optionalInteger(input.attemptedAt, 'attemptedAt') ?? this.now();
    const result = await this.#runTransition({
      sql: `
        UPDATE lark_notification_deliveries
        SET status = 'sending', attempted_at = COALESCE(attempted_at, ?), updated_at = ?
        WHERE notification_attempt_key = ?
          AND status = 'claimed'
          AND claim_owner = ?
          AND lease_expires_at > ?
      `,
      binds: [now, now, key, ownerId, now],
      code: 'D1_LARK_NOTIFICATION_MARK_SENDING_FAILED',
    });
    assertChanged(result, 'LARK_NOTIFICATION_CLAIM_NOT_OWNED');
    return this.read(key);
  }

  async markSent(input = {}) {
    const key = requireText(input.notificationAttemptKey, 'notificationAttemptKey');
    const ownerId = requireText(input.ownerId, 'ownerId');
    const now = optionalInteger(input.sentAt, 'sentAt') ?? this.now();
    const messageIdHash = optionalHash(input.messageIdHash, 'messageIdHash');
    const result = await this.#runTransition({
      sql: `
        UPDATE lark_notification_deliveries
        SET status = 'sent', sent_at = COALESCE(sent_at, ?),
            lark_message_id_hash = COALESCE(lark_message_id_hash, ?),
            error_code = NULL, redacted_error_message = NULL, updated_at = ?
        WHERE notification_attempt_key = ?
          AND status = 'sending'
          AND claim_owner = ?
      `,
      binds: [now, messageIdHash, now, key, ownerId],
      code: 'D1_LARK_NOTIFICATION_MARK_SENT_FAILED',
    });
    assertChanged(result, 'LARK_NOTIFICATION_SENDING_STATE_NOT_OWNED');
    return this.read(key);
  }

  async markBlockedUnknown(input = {}) {
    const key = requireText(input.notificationAttemptKey, 'notificationAttemptKey');
    const ownerId = requireText(input.ownerId, 'ownerId');
    const now = this.now();
    const errorCode = requireText(input.errorCode ?? 'LARK_NOTIFICATION_DELIVERY_OUTCOME_UNKNOWN', 'errorCode');
    const redacted = sanitizeError(input.errorMessage, errorCode);
    const result = await this.#runTransition({
      sql: `
        UPDATE lark_notification_deliveries
        SET status = 'blocked_unknown', error_code = ?, redacted_error_message = ?, updated_at = ?
        WHERE notification_attempt_key = ?
          AND status = 'sending'
          AND claim_owner = ?
      `,
      binds: [errorCode, redacted, now, key, ownerId],
      code: 'D1_LARK_NOTIFICATION_MARK_UNKNOWN_FAILED',
    });
    assertChanged(result, 'LARK_NOTIFICATION_SENDING_STATE_NOT_OWNED');
    return this.read(key);
  }

  async markMirrored(input = {}) {
    const key = requireText(input.notificationAttemptKey, 'notificationAttemptKey');
    const now = optionalInteger(input.mirroredAt, 'mirroredAt') ?? this.now();
    const result = await this.#runTransition({
      sql: `
        UPDATE lark_notification_deliveries
        SET mirror_status = 'mirrored', mirrored_at = COALESCE(mirrored_at, ?), updated_at = ?
        WHERE notification_attempt_key = ? AND status = 'sent'
      `,
      binds: [now, now, key],
      code: 'D1_LARK_NOTIFICATION_MARK_MIRRORED_FAILED',
    });
    assertChanged(result, 'LARK_NOTIFICATION_NOT_SENT');
    return this.read(key);
  }

  async markMirrorFailed(input = {}) {
    const key = requireText(input.notificationAttemptKey, 'notificationAttemptKey');
    const now = this.now();
    const errorCode = requireText(input.errorCode ?? 'LARK_NOTIFICATION_MIRROR_FAILED', 'errorCode');
    const redacted = sanitizeError(input.errorMessage, errorCode);
    const result = await this.#runTransition({
      sql: `
        UPDATE lark_notification_deliveries
        SET mirror_status = 'failed', error_code = ?, redacted_error_message = ?, updated_at = ?
        WHERE notification_attempt_key = ? AND status = 'sent'
      `,
      binds: [errorCode, redacted, now, key],
      code: 'D1_LARK_NOTIFICATION_MARK_MIRROR_FAILED_FAILED',
    });
    assertChanged(result, 'LARK_NOTIFICATION_NOT_SENT');
    return this.read(key);
  }

  async read(notificationAttemptKey) {
    const key = requireText(notificationAttemptKey, 'notificationAttemptKey');
    let row;
    try {
      row = await this.db.prepare(`
        SELECT * FROM lark_notification_deliveries WHERE notification_attempt_key = ?
      `).bind(key).first();
    } catch (cause) {
      throw d1Transient('Failed to read Lark notification delivery', 'D1_LARK_NOTIFICATION_READ_FAILED', cause);
    }
    if (!row) {
      throw permanentError('Lark notification delivery was not found', {
        code: 'LARK_NOTIFICATION_DELIVERY_NOT_FOUND',
        details: { notificationAttemptKey: key },
      });
    }
    return freezeRow(row);
  }

  async #runTransition(input) {
    try {
      return await this.db.prepare(input.sql).bind(...input.binds).run();
    } catch (cause) {
      throw d1Transient('Failed to transition Lark notification delivery', input.code, cause);
    }
  }
}

function normalizeClaim(input, now) {
  const claimedAt = optionalInteger(input.claimedAt, 'claimedAt') ?? now;
  const leaseMs = positiveInteger(input.leaseMs ?? 60_000, 'leaseMs');
  return Object.freeze({
    notificationAttemptKey: requireText(input.notificationAttemptKey, 'notificationAttemptKey'),
    aiRunKey: requireText(input.aiRunKey, 'aiRunKey'),
    dedupeKey: requireHash(input.dedupeKey, 'dedupeKey'),
    reportId: requireText(input.reportId, 'reportId'),
    reportSettingKey: requireText(input.reportSettingKey, 'reportSettingKey'),
    customerProfile: requireText(input.customerProfile, 'customerProfile'),
    destinationKeyHash: requireHash(input.destinationKeyHash, 'destinationKeyHash'),
    templateVersion: requireText(input.templateVersion, 'templateVersion'),
    payloadChecksum: requireHash(input.payloadChecksum, 'payloadChecksum'),
    ownerId: requireText(input.ownerId, 'ownerId'),
    now: claimedAt,
    leaseExpiresAt: claimedAt + leaseMs,
  });
}

function assertClaimIdentity(row, expected) {
  const actual = [
    row.aiRunKey,
    row.dedupeKey,
    row.reportId,
    row.reportSettingKey,
    row.customerProfile,
    row.destinationKeyHash,
    row.templateVersion,
    row.payloadChecksum,
  ];
  const wanted = [
    expected.aiRunKey,
    expected.dedupeKey,
    expected.reportId,
    expected.reportSettingKey,
    expected.customerProfile,
    expected.destinationKeyHash,
    expected.templateVersion,
    expected.payloadChecksum,
  ];
  if (actual.some((value, index) => value !== wanted[index])) {
    throw permanentError('Notification attempt identity conflicts with persisted delivery', {
      code: 'LARK_NOTIFICATION_ATTEMPT_IDENTITY_CONFLICT',
      details: { notificationAttemptKey: expected.notificationAttemptKey },
    });
  }
}

function dispositionFor(row) {
  if (row.status === 'sent') return 'already_sent';
  if (row.status === 'claimed' || row.status === 'sending') return 'in_flight';
  if (TERMINAL_STATUSES.has(row.status)) return 'blocked';
  return 'deduped';
}

function freezeRow(row) {
  return Object.freeze({
    notificationAttemptKey: requireText(row.notification_attempt_key, 'notification_attempt_key'),
    aiRunKey: requireText(row.ai_run_key, 'ai_run_key'),
    dedupeKey: requireHash(row.dedupe_key, 'dedupe_key'),
    reportId: requireText(row.report_id, 'report_id'),
    reportSettingKey: requireText(row.report_setting_key, 'report_setting_key'),
    customerProfile: requireText(row.customer_profile, 'customer_profile'),
    destinationKeyHash: requireHash(row.destination_key_hash, 'destination_key_hash'),
    templateVersion: requireText(row.template_version, 'template_version'),
    payloadChecksum: requireHash(row.payload_checksum, 'payload_checksum'),
    status: requireText(row.status, 'status'),
    claimOwner: optionalText(row.claim_owner),
    leaseExpiresAt: optionalInteger(row.lease_expires_at, 'lease_expires_at'),
    claimCount: positiveInteger(row.claim_count, 'claim_count'),
    attemptedAt: optionalInteger(row.attempted_at, 'attempted_at'),
    sentAt: optionalInteger(row.sent_at, 'sent_at'),
    messageIdHash: optionalHash(row.lark_message_id_hash, 'lark_message_id_hash'),
    mirrorStatus: requireText(row.mirror_status, 'mirror_status'),
    mirroredAt: optionalInteger(row.mirrored_at, 'mirrored_at'),
    errorCode: optionalText(row.error_code),
    redactedErrorMessage: optionalText(row.redacted_error_message),
    createdAt: optionalInteger(row.created_at, 'created_at'),
    updatedAt: optionalInteger(row.updated_at, 'updated_at'),
  });
}

function readChanges(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}
function assertChanged(result, code) {
  if (readChanges(result) !== 1) {
    throw permanentError('Notification delivery transition was rejected', { code });
  }
}
function sanitizeError(value, code) {
  const sanitized = sanitizeOperationalText(String(value ?? code), { code });
  return String(sanitized).slice(0, 500);
}
function requireD1(db) {
  if (typeof db?.prepare !== 'function') throw new TypeError('D1 notification delivery store requires db.prepare');
  return db;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}
function requireHash(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!SHA256_HEX.test(text)) throw new TypeError(`${fieldName} must be lowercase SHA-256 hex`);
  return text;
}
function optionalHash(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requireHash(String(value), fieldName);
}
function optionalInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a non-negative integer`);
  return number;
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}
function d1Transient(message, code, cause) {
  return transientError(message, { code, cause });
}
