import {
  permanentError,
  sanitizeOperationalText,
  sanitizeOperationalValue,
  sanitizeQueueReplayValue,
  transientError,
} from '../../shared/src/errors/runtime-error.js';

const MAX_JSON_LENGTH = 50_000;
const DEAD_LETTER_REDRIVE_SELECT_SQL = `
  SELECT
    dlq_id, message_id, queue_name, job_type, schema_version,
    payload_json, replay_payload_json,
    error_code, retry_count, status, redrive_requested_at,
    redrive_reference, redriven_at
  FROM dead_letter_jobs
  WHERE dlq_id = ?
`;

/**
 * Operational store และ Distributed lease lock บน Cloudflare D1
 *
 * D1 เป็นแหล่งสถานะหลักสำหรับ Worker เพราะรองรับ atomic SQL statement ข้ามหลาย invocation
 * ส่วน Lark Base เป็น mirror เพื่อให้ผู้ใช้ตรวจสอบผ่าน UI ได้สะดวก
 */
export class D1ReliabilityStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  /** Upsert รายละเอียดหนึ่งรอบ Sync ลง sync_runs */
  async saveSyncRun(entry) {
    try {
      await this.db.prepare(`
        INSERT INTO sync_runs (
          sync_run_id, customer_profile, platform, account_key, source, sync_type, status,
          started_at, finished_at, records_pulled, records_created, records_updated,
          records_skipped, records_written, retry_count, error_code, error_message,
          details_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sync_run_id) DO UPDATE SET
          customer_profile = excluded.customer_profile,
          platform = excluded.platform,
          account_key = excluded.account_key,
          source = excluded.source,
          sync_type = excluded.sync_type,
          status = excluded.status,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          records_pulled = excluded.records_pulled,
          records_created = excluded.records_created,
          records_updated = excluded.records_updated,
          records_skipped = excluded.records_skipped,
          records_written = excluded.records_written,
          retry_count = excluded.retry_count,
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          details_json = excluded.details_json,
          updated_at = excluded.updated_at
      `).bind(
        requireText(entry?.syncId, 'syncId'),
        nullableText(entry?.customerProfile),
        requireText(entry?.platform, 'platform'),
        nullableText(entry?.accountKey),
        nullableText(entry?.source),
        requireText(entry?.syncType, 'syncType'),
        requireText(entry?.status, 'status'),
        nullableInteger(entry?.startedAt),
        nullableInteger(entry?.finishedAt),
        nonNegativeInteger(entry?.recordsPulled ?? 0, 'recordsPulled'),
        nonNegativeInteger(entry?.recordsCreated ?? 0, 'recordsCreated'),
        nonNegativeInteger(entry?.recordsUpdated ?? 0, 'recordsUpdated'),
        nonNegativeInteger(entry?.recordsSkipped ?? 0, 'recordsSkipped'),
        nonNegativeInteger(entry?.recordsWritten ?? 0, 'recordsWritten'),
        nonNegativeInteger(entry?.retryCount ?? 0, 'retryCount'),
        nullableText(entry?.errorCode),
        nullableOperationalText(entry?.errorMessage, entry?.errorCode),
        safeJson(entry?.details ?? {}),
        this.now(),
        this.now(),
      ).run();
      return true;
    } catch (cause) {
      throw d1Error('Failed to persist sync run', 'D1_SYNC_RUN_WRITE_FAILED', cause);
    }
  }

  /** Upsert System alert ลง D1 เพื่อใช้ค้นหา/ปิดสถานะภายหลัง */
  async saveSystemAlert(alert) {
    try {
      await this.db.prepare(`
        INSERT INTO system_alerts (
          alert_id, sync_run_id, alert_type, severity, platform, status,
          message, error_code, details_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(alert_id) DO UPDATE SET
          sync_run_id = excluded.sync_run_id,
          alert_type = excluded.alert_type,
          severity = excluded.severity,
          platform = excluded.platform,
          status = excluded.status,
          message = excluded.message,
          error_code = excluded.error_code,
          details_json = excluded.details_json,
          updated_at = excluded.updated_at
      `).bind(
        requireText(alert?.alertId, 'alertId'),
        nullableText(alert?.syncRunId),
        requireText(alert?.alertType, 'alertType'),
        requireText(alert?.severity, 'severity'),
        requireText(alert?.platform, 'platform'),
        requireText(alert?.status, 'status'),
        requireText(sanitizeOperationalText(alert?.message, { code: alert?.errorCode }), 'message'),
        nullableText(alert?.errorCode),
        safeJson(alert?.details ?? {}),
        nullableInteger(alert?.createdAt) ?? this.now(),
        this.now(),
      ).run();
      return true;
    } catch (cause) {
      throw d1Error('Failed to persist system alert', 'D1_SYSTEM_ALERT_WRITE_FAILED', cause);
    }
  }

  /** เก็บ Message ที่หยุดถาวรหรือมาจาก Cloudflare DLQ */
  async saveDeadLetter(deadLetter) {
    const operationalPayloadJson = safeJson(deadLetter?.payload ?? {});
    const replayPayloadJson = safeReplayJson(deadLetter?.payload ?? {});
    try {
      await this.db.prepare(`
        INSERT INTO dead_letter_jobs (
          dlq_id, message_id, queue_name, job_type, schema_version,
          payload_json, replay_payload_json,
          error_code, error_message, retry_count, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dlq_id) DO UPDATE SET
          message_id = excluded.message_id,
          queue_name = excluded.queue_name,
          job_type = excluded.job_type,
          schema_version = excluded.schema_version,
          payload_json = excluded.payload_json,
          replay_payload_json = CASE
            WHEN dead_letter_jobs.status IN ('redrive_pending', 'redriven')
              THEN dead_letter_jobs.replay_payload_json
            ELSE excluded.replay_payload_json
          END,
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          retry_count = excluded.retry_count,
          status = CASE
            WHEN dead_letter_jobs.status IN ('redrive_pending', 'redriven')
              THEN dead_letter_jobs.status
            ELSE excluded.status
          END,
          updated_at = excluded.updated_at
      `).bind(
        requireText(deadLetter?.dlqId, 'dlqId'),
        nullableText(deadLetter?.messageId),
        nullableText(deadLetter?.queueName),
        nullableText(deadLetter?.jobType),
        nullableInteger(deadLetter?.schemaVersion),
        operationalPayloadJson,
        replayPayloadJson,
        nullableText(deadLetter?.errorCode),
        nullableOperationalText(deadLetter?.errorMessage, deadLetter?.errorCode),
        nonNegativeInteger(deadLetter?.retryCount ?? 0, 'retryCount'),
        requireText(deadLetter?.status ?? 'open', 'status'),
        nullableInteger(deadLetter?.createdAt) ?? this.now(),
        this.now(),
      ).run();
      return true;
    } catch (cause) {
      throw d1Error('Failed to persist dead letter', 'D1_DEAD_LETTER_WRITE_FAILED', cause);
    }
  }

  /** อ่าน Dead-letter แบบไม่เปลี่ยนสถานะ เพื่อให้ Application validate recursion/schema ก่อนจอง Redrive */
  async readDeadLetterRedriveCandidate(input = {}) {
    const dlqId = requireText(input.dlqId, 'dlqId');
    try {
      const existing = await this.db.prepare(DEAD_LETTER_REDRIVE_SELECT_SQL).bind(dlqId).first();
      assertDeadLetterRedriveEligibility(existing, dlqId);
      return freezeDeadLetterRedriveCandidate(existing);
    } catch (cause) {
      if ([
        'DEAD_LETTER_NOT_FOUND',
        'DEAD_LETTER_NOT_REDRIVABLE',
        'DEAD_LETTER_REPLAY_PAYLOAD_UNAVAILABLE',
        'DEAD_LETTER_PAYLOAD_INVALID',
      ].includes(cause?.code)) throw cause;
      throw d1Error('Failed to read dead-letter redrive candidate', 'D1_DEAD_LETTER_REDRIVE_READ_FAILED', cause);
    }
  }

  /** จอง Redrive generation แบบ Idempotent ก่อนส่ง Queue เพื่อให้ Retry ส่งซ้ำได้อย่างปลอดภัย */
  async prepareDeadLetterRedrive(input = {}) {
    const dlqId = requireText(input.dlqId, 'dlqId');
    const requestedAt = nullableInteger(input.requestedAt) ?? this.now();
    const redriveReference = requireText(
      input.redriveReference ?? `redrive:${dlqId}:${requestedAt}`,
      'redriveReference',
    );
    const forbiddenJobTypes = new Set(requireTextList(input.forbiddenJobTypes ?? [], 'forbiddenJobTypes'));
    try {
      const existing = await this.db.prepare(DEAD_LETTER_REDRIVE_SELECT_SQL).bind(dlqId).first();
      assertDeadLetterRedriveEligibility(existing, dlqId);
      // Legacy rows before migration 0005 ไม่มี exact replay payload และต้อง Fail closed.
      const replayPayload = parseReplayPayload(existing.replay_payload_json);
      const persistedJobType = nullableText(existing.job_type);
      const replayJobType = nullableText(replayPayload.type);
      if (forbiddenJobTypes.has(persistedJobType) || forbiddenJobTypes.has(replayJobType)) {
        throw permanentError('A dead-letter redrive command cannot redrive itself', {
          code: 'DEAD_LETTER_REDRIVE_RECURSION_BLOCKED',
          details: { dlqId },
        });
      }
      if (existing.status === 'redriven') return freezeDeadLetterRedriveRow(existing);

      await this.db.prepare(`
        UPDATE dead_letter_jobs
        SET status = 'redrive_pending',
            redrive_requested_at = COALESCE(redrive_requested_at, ?),
            redrive_reference = COALESCE(redrive_reference, ?),
            updated_at = ?
        WHERE dlq_id = ? AND status IN ('open', 'redrive_pending')
      `).bind(requestedAt, redriveReference, this.now(), dlqId).run();

      const prepared = await this.db.prepare(DEAD_LETTER_REDRIVE_SELECT_SQL).bind(dlqId).first();
      if (!prepared || !['redrive_pending', 'redriven'].includes(prepared.status)) {
        throw permanentError('Dead-letter job is not eligible for redrive', {
          code: 'DEAD_LETTER_NOT_REDRIVABLE',
          details: { dlqId, status: prepared?.status ?? null },
        });
      }
      return freezeDeadLetterRedriveRow(prepared);
    } catch (cause) {
      if ([
        'DEAD_LETTER_NOT_FOUND',
        'DEAD_LETTER_NOT_REDRIVABLE',
        'DEAD_LETTER_REPLAY_PAYLOAD_UNAVAILABLE',
        'DEAD_LETTER_PAYLOAD_INVALID',
        'DEAD_LETTER_REDRIVE_STATE_INVALID',
        'DEAD_LETTER_REDRIVE_RECURSION_BLOCKED',
      ].includes(cause?.code)) throw cause;
      throw d1Error('Failed to prepare dead-letter redrive', 'D1_DEAD_LETTER_REDRIVE_PREPARE_FAILED', cause);
    }
  }

  /** ยืนยันว่า Queue send สำเร็จ; Retry หลัง Mark ล้มใช้ Generation เดิมและถูก fence กันซ้ำ */
  async markDeadLetterRedriven(input = {}) {
    const dlqId = requireText(input.dlqId, 'dlqId');
    const redrivenAt = nullableInteger(input.redrivenAt) ?? this.now();
    try {
      const result = await this.db.prepare(`
        UPDATE dead_letter_jobs
        SET status = 'redriven',
            redriven_at = COALESCE(redriven_at, ?),
            updated_at = ?
        WHERE dlq_id = ? AND status IN ('redrive_pending', 'redriven')
      `).bind(redrivenAt, this.now(), dlqId).run();
      if (readChanges(result) === 0) {
        throw permanentError('Dead-letter redrive state was not prepared', {
          code: 'DEAD_LETTER_NOT_REDRIVABLE',
          details: { dlqId },
        });
      }
      return true;
    } catch (cause) {
      if (cause?.code === 'DEAD_LETTER_NOT_REDRIVABLE') throw cause;
      throw d1Error('Failed to complete dead-letter redrive', 'D1_DEAD_LETTER_REDRIVE_COMPLETE_FAILED', cause);
    }
  }

  /**
   * ขอ Lease lock ด้วย Atomic INSERT ... ON CONFLICT ... WHERE
   * Statement จะเปลี่ยนแถวได้เฉพาะเมื่อ Lock หมดอายุหรือ Owner เดิมขอต่อเอง
   */
  async acquire(input) {
    const lockKey = requireText(input?.lockKey, 'lockKey');
    const ownerId = requireText(input?.ownerId, 'ownerId');
    const leaseMs = positiveInteger(input?.leaseMs, 'leaseMs');
    const now = this.now();
    const expiresAt = now + leaseMs;

    try {
      const result = await this.db.prepare(`
        INSERT INTO sync_locks (lock_key, owner_id, acquired_at, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(lock_key) DO UPDATE SET
          owner_id = excluded.owner_id,
          acquired_at = excluded.acquired_at,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
        WHERE sync_locks.expires_at <= ? OR sync_locks.owner_id = ?
      `).bind(
        lockKey,
        ownerId,
        now,
        expiresAt,
        now,
        now,
        ownerId,
      ).run();

      const acquired = readChanges(result) > 0;
      return Object.freeze({
        acquired,
        lockKey,
        ownerId,
        expiresAt: acquired ? expiresAt : null,
      });
    } catch (cause) {
      throw d1Error('Failed to acquire distributed sync lock', 'D1_SYNC_LOCK_ACQUIRE_FAILED', cause);
    }
  }

  /** ต่ออายุ Lease เฉพาะ Owner เดิม และคืน false เมื่อ Ownership ถูกเปลี่ยนหรือ Lock หาย */
  async renew(input) {
    const lockKey = requireText(input?.lockKey, 'lockKey');
    const ownerId = requireText(input?.ownerId, 'ownerId');
    const leaseMs = positiveInteger(input?.leaseMs, 'leaseMs');
    const now = this.now();
    const expiresAt = now + leaseMs;

    try {
      const result = await this.db.prepare(`
        UPDATE sync_locks
        SET expires_at = ?, updated_at = ?
        WHERE lock_key = ? AND owner_id = ? AND expires_at > ?
      `).bind(expiresAt, now, lockKey, ownerId, now).run();
      const renewed = readChanges(result) > 0;
      return Object.freeze({ renewed, lockKey, ownerId, expiresAt: renewed ? expiresAt : null });
    } catch (cause) {
      throw d1Error('Failed to renew distributed sync lock', 'D1_SYNC_LOCK_RENEW_FAILED', cause);
    }
  }

  /** ปล่อย Lock เฉพาะ Owner เดิม เพื่อไม่ลบ Lease ของ Invocation อื่น */
  async release(input) {
    const lockKey = requireText(input?.lockKey, 'lockKey');
    const ownerId = requireText(input?.ownerId, 'ownerId');

    try {
      const result = await this.db.prepare(
        'DELETE FROM sync_locks WHERE lock_key = ? AND owner_id = ?',
      ).bind(lockKey, ownerId).run();
      return readChanges(result) > 0;
    } catch (cause) {
      throw d1Error('Failed to release distributed sync lock', 'D1_SYNC_LOCK_RELEASE_FAILED', cause);
    }
  }
}

function readChanges(result) {
  const value = result?.meta?.changes ?? result?.changes ?? 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function d1Error(message, code, cause) {
  return transientError(message, {
    code,
    cause,
    details: { causeMessage: sanitizeOperationalText(cause instanceof Error ? cause.message : String(cause)) },
  });
}

function safeJson(value) {
  const text = JSON.stringify(sanitizeOperationalValue(value));
  const normalized = text ?? '{}';
  return normalized.length <= MAX_JSON_LENGTH
    ? normalized
    : JSON.stringify({ truncated: true, preview: normalized.slice(0, MAX_JSON_LENGTH - 100) });
}

function nullableOperationalText(value, code) {
  if (value === null || value === undefined || value === '') return null;
  return nullableText(sanitizeOperationalText(value, { code }));
}

function assertDeadLetterRedriveEligibility(row, dlqId) {
  if (!row) {
    throw permanentError('Dead-letter job was not found', {
      code: 'DEAD_LETTER_NOT_FOUND',
      details: { dlqId },
    });
  }
  if (!['open', 'redrive_pending', 'redriven'].includes(row.status)) {
    throw permanentError('Dead-letter job is not eligible for redrive', {
      code: 'DEAD_LETTER_NOT_REDRIVABLE',
      details: { dlqId, status: row.status },
    });
  }
}

function freezeDeadLetterRedriveCandidate(row) {
  return Object.freeze({
    dlqId: requireText(row.dlq_id, 'dlq_id'),
    originalMessageId: nullableText(row.message_id),
    queueName: nullableText(row.queue_name),
    jobType: nullableText(row.job_type),
    schemaVersion: row.schema_version === null ? null : nullableInteger(row.schema_version),
    payload: parseReplayPayload(row.replay_payload_json),
    errorCode: nullableText(row.error_code),
    retryCount: nonNegativeInteger(row.retry_count ?? 0, 'retryCount'),
    status: requireText(row.status, 'status'),
    redriveRequestedAt: nullableInteger(row.redrive_requested_at),
    redriveReference: nullableText(row.redrive_reference),
    redrivenAt: nullableInteger(row.redriven_at),
  });
}

function freezeDeadLetterRedriveRow(row) {
  const redriveRequestedAt = nullableInteger(row.redrive_requested_at);
  if (redriveRequestedAt === null) {
    throw permanentError('Dead-letter redrive generation is missing', {
      code: 'DEAD_LETTER_REDRIVE_STATE_INVALID',
    });
  }
  return Object.freeze({
    dlqId: requireText(row.dlq_id, 'dlq_id'),
    originalMessageId: nullableText(row.message_id),
    queueName: nullableText(row.queue_name),
    jobType: nullableText(row.job_type),
    schemaVersion: row.schema_version === null ? null : nullableInteger(row.schema_version),
    payload: parseReplayPayload(row.replay_payload_json),
    errorCode: nullableText(row.error_code),
    retryCount: nonNegativeInteger(row.retry_count ?? 0, 'retryCount'),
    status: requireText(row.status, 'status'),
    redriveRequestedAt,
    redriveReference: requireText(row.redrive_reference, 'redrive_reference'),
    redrivenAt: nullableInteger(row.redriven_at),
  });
}

function safeReplayJson(value) {
  // Dead-letter persistence ต้องไม่กลายเป็น Poison retry เพราะ Payload ที่ Redrive ไม่ได้.
  // เก็บ null แล้วให้ Admin redrive fail-closed แทน; Queue job ปกติถูก Normalize เป็น Object ก่อนถึงจุดนี้.
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = JSON.stringify(sanitizeQueueReplayValue(value));
  if (typeof text !== 'string' || text.length > MAX_JSON_LENGTH) return null;
  return text;
}

function parseReplayPayload(value) {
  if (value === null || value === undefined || value === '') {
    throw permanentError('Dead-letter replay payload is unavailable for this legacy record', {
      code: 'DEAD_LETTER_REPLAY_PAYLOAD_UNAVAILABLE',
    });
  }
  return parseStoredJson(value, 'replay_payload_json');
}

function parseStoredJson(value, fieldName) {
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError(`${fieldName} must contain an object`);
    }
    return Object.freeze(parsed);
  } catch (cause) {
    throw permanentError('Dead-letter payload is invalid JSON', {
      code: 'DEAD_LETTER_PAYLOAD_INVALID',
      cause,
      details: { fieldName },
    });
  }
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') {
    throw new TypeError('D1ReliabilityStore requires a D1 database binding');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`D1ReliabilityStore requires ${fieldName}`);
  }
  return value.trim();
}

function nullableText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(String(value), 'text');
}

function requireTextList(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`D1ReliabilityStore requires ${fieldName} to be an array`);
  return value.map((entry, index) => requireText(entry, `${fieldName}[${index}]`));
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new TypeError('D1ReliabilityStore requires a safe integer');
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`D1ReliabilityStore ${fieldName} must be a non-negative integer`);
  }
  return number;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`D1ReliabilityStore ${fieldName} must be a positive integer`);
  }
  return number;
}
