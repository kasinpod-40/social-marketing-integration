import {
  permanentError,
  sanitizeOperationalText,
  transientError,
} from '../../shared/src/errors/runtime-error.js';

export const TIKTOK_BOOTSTRAP_INCIDENT = Object.freeze({
  dlqId: 'dlq:8d1b9077657385a417cb32a0ed3114cb',
  messageId: '8d1b9077657385a417cb32a0ed3114cb',
  operationId: 'f59b852f00634005c7ff4da51afee964',
  workKey: 'tiktok:f59b852f00634005c7ff4da51afee964',
  generation: 1784829780000,
  originalRequestedAt: 1784829780000,
  phase: 'tiktok_organic_history_write_v1',
  initialNextSequence: 2,
  expectedRows: 2021,
});

/** Operational metadata for stable Queue identity, attempt separation and guarded incident recovery. */
export class D1QueueOperationStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  async recordMainQueueAttempt(input = {}) {
    const operationId = optionalText(input.operationId);
    const workKey = optionalText(input.workKey);
    if (!operationId || !workKey) return Object.freeze({ mainQueueAttempts: 0, tracked: false });
    const now = timestamp(this.now(), 'now');
    try {
      await this.db.prepare(`
        INSERT INTO queue_operation_attempts (
          operation_id, work_key, generation, original_requested_at,
          main_queue_attempts, last_main_message_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(operation_id) DO UPDATE SET
          work_key = excluded.work_key,
          generation = COALESCE(queue_operation_attempts.generation, excluded.generation),
          original_requested_at = COALESCE(
            queue_operation_attempts.original_requested_at,
            excluded.original_requested_at
          ),
          main_queue_attempts = queue_operation_attempts.main_queue_attempts + 1,
          last_main_message_id = excluded.last_main_message_id,
          updated_at = excluded.updated_at
        WHERE queue_operation_attempts.work_key = excluded.work_key
      `).bind(
        operationId,
        workKey,
        nullableTimestamp(input.generation),
        nullableTimestamp(input.originalRequestedAt),
        optionalText(input.messageId),
        now,
        now,
      ).run();
      return this.readMainQueueAttempts({ operationId });
    } catch (cause) {
      throw d1Error('Failed to persist main Queue attempt', 'D1_QUEUE_OPERATION_ATTEMPT_WRITE_FAILED', cause);
    }
  }

  async readMainQueueAttempts(input = {}) {
    const operationId = optionalText(input.operationId);
    if (!operationId) return Object.freeze({ mainQueueAttempts: 0, tracked: false });
    try {
      const row = await this.db.prepare(`
        SELECT main_queue_attempts, work_key
        FROM queue_operation_attempts
        WHERE operation_id = ?
      `).bind(operationId).first();
      return Object.freeze({
        mainQueueAttempts: nonNegative(row?.main_queue_attempts ?? 0, 'main_queue_attempts'),
        workKey: optionalText(row?.work_key),
        tracked: Boolean(row),
      });
    } catch (cause) {
      throw d1Error('Failed to read main Queue attempts', 'D1_QUEUE_OPERATION_ATTEMPT_READ_FAILED', cause);
    }
  }

  async saveDeadLetterMetadata(input = {}) {
    const dlqId = requireText(input.dlqId, 'dlqId');
    const now = timestamp(this.now(), 'now');
    try {
      await this.db.prepare(`
        INSERT INTO dead_letter_operation_metadata (
          dlq_id, operation_id, original_work_key, generation, original_requested_at,
          main_queue_attempts, dlq_delivery_attempts, recovery_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'not_started', ?, ?)
        ON CONFLICT(dlq_id) DO UPDATE SET
          operation_id = COALESCE(dead_letter_operation_metadata.operation_id, excluded.operation_id),
          original_work_key = COALESCE(
            dead_letter_operation_metadata.original_work_key,
            excluded.original_work_key
          ),
          generation = COALESCE(dead_letter_operation_metadata.generation, excluded.generation),
          original_requested_at = COALESCE(
            dead_letter_operation_metadata.original_requested_at,
            excluded.original_requested_at
          ),
          main_queue_attempts = MAX(
            dead_letter_operation_metadata.main_queue_attempts,
            excluded.main_queue_attempts
          ),
          dlq_delivery_attempts = MAX(
            dead_letter_operation_metadata.dlq_delivery_attempts,
            excluded.dlq_delivery_attempts
          ),
          updated_at = excluded.updated_at
      `).bind(
        dlqId,
        optionalText(input.operationId),
        optionalText(input.workKey),
        nullableTimestamp(input.generation),
        nullableTimestamp(input.originalRequestedAt),
        nonNegative(input.mainQueueAttempts ?? 0, 'mainQueueAttempts'),
        nonNegative(input.dlqDeliveryAttempts ?? 0, 'dlqDeliveryAttempts'),
        now,
        now,
      ).run();
      return true;
    } catch (cause) {
      throw d1Error('Failed to persist dead-letter Queue metadata', 'D1_DEAD_LETTER_METADATA_WRITE_FAILED', cause);
    }
  }

  /**
   * Authorize only the exact 2026-07-23 incident. First authorization requires the original
   * expired lock and nextSequence=2; retries/continuations reuse the persisted recovery reference.
   */
  async authorizeTikTokBootstrapIncidentRecovery(input = {}) {
    assertExactIncident(input);
    const now = timestamp(input.now ?? this.now(), 'now');
    const recoveryReference = requireText(
      input.recoveryReference ?? `recovery:${TIKTOK_BOOTSTRAP_INCIDENT.dlqId}:${TIKTOK_BOOTSTRAP_INCIDENT.workKey}`,
      'recoveryReference',
    );
    try {
      const deadLetter = await this.db.prepare(`
        SELECT dlq_id, message_id, status, job_type
        FROM dead_letter_jobs
        WHERE dlq_id = ?
      `).bind(TIKTOK_BOOTSTRAP_INCIDENT.dlqId).first();
      if (!deadLetter || deadLetter.message_id !== TIKTOK_BOOTSTRAP_INCIDENT.messageId) {
        throw incidentError('Exact TikTok bootstrap DLQ record was not found', 'TIKTOK_BOOTSTRAP_RECOVERY_DLQ_MISMATCH');
      }
      if (!['open', 'redrive_pending', 'redriven'].includes(deadLetter.status)) {
        throw incidentError('TikTok bootstrap DLQ record is not recoverable', 'TIKTOK_BOOTSTRAP_RECOVERY_DLQ_STATE_INVALID');
      }

      const work = await this.db.prepare(`
        SELECT work_key, cursor_key, generation, requested_at, lifecycle_status
        FROM sync_work_runs
        WHERE work_key = ?
      `).bind(TIKTOK_BOOTSTRAP_INCIDENT.workKey).first();
      if (!work
        || Number(work.generation) !== TIKTOK_BOOTSTRAP_INCIDENT.generation
        || Number(work.requested_at) !== TIKTOK_BOOTSTRAP_INCIDENT.originalRequestedAt
        || !['active', 'completed'].includes(work.lifecycle_status)) {
        throw incidentError('Original TikTok bootstrap Work identity is not recoverable', 'TIKTOK_BOOTSTRAP_RECOVERY_WORK_MISMATCH');
      }
      if (work.lifecycle_status === 'completed' && deadLetter.status === 'redriven') {
        return Object.freeze({
          status: 'already_completed',
          recoveryReference,
          workKey: work.work_key,
          cursorKey: work.cursor_key,
        });
      }

      const phase = await this.db.prepare(`
        SELECT state_json, complete
        FROM sync_work_phases
        WHERE work_key = ? AND phase = ?
      `).bind(TIKTOK_BOOTSTRAP_INCIDENT.workKey, TIKTOK_BOOTSTRAP_INCIDENT.phase).first();
      const state = parseObject(phase?.state_json, 'state_json');
      const nextSequence = nonNegative(state.nextSequence ?? 0, 'nextSequence');

      const metadata = await this.db.prepare(`
        SELECT recovery_status, recovery_reference, original_work_key, operation_id
        FROM dead_letter_operation_metadata
        WHERE dlq_id = ?
      `).bind(TIKTOK_BOOTSTRAP_INCIDENT.dlqId).first();
      const firstAuthorization = !metadata || !['in_progress', 'completed'].includes(metadata.recovery_status);
      if (firstAuthorization && (Number(phase?.complete) === 1
        || nextSequence !== TIKTOK_BOOTSTRAP_INCIDENT.initialNextSequence)) {
        throw incidentError('TikTok bootstrap recovery checkpoint is not the exact incident checkpoint', 'TIKTOK_BOOTSTRAP_RECOVERY_CHECKPOINT_MISMATCH', {
          nextSequence,
        });
      }
      if (!firstAuthorization && metadata.recovery_reference !== recoveryReference) {
        throw incidentError('TikTok bootstrap recovery reference changed', 'TIKTOK_BOOTSTRAP_RECOVERY_REFERENCE_MISMATCH');
      }

      const lock = await this.db.prepare(`
        SELECT expires_at
        FROM sync_locks
        WHERE lock_key = ?
      `).bind(work.cursor_key).first();
      const expiresAt = lock ? Number(lock.expires_at) : null;
      if (Number.isSafeInteger(expiresAt) && expiresAt > now) {
        throw transientError('TikTok bootstrap recovery lock is still active', {
          code: 'SYNC_LOCK_BUSY',
          details: { lockKey: work.cursor_key, expiresAt },
        });
      }

      await this.db.prepare(`
        INSERT INTO dead_letter_operation_metadata (
          dlq_id, operation_id, original_work_key, generation, original_requested_at,
          main_queue_attempts, dlq_delivery_attempts, recovery_status,
          recovery_reference, recovery_started_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 'in_progress', ?, ?, ?, ?)
        ON CONFLICT(dlq_id) DO UPDATE SET
          operation_id = excluded.operation_id,
          original_work_key = excluded.original_work_key,
          generation = excluded.generation,
          original_requested_at = excluded.original_requested_at,
          recovery_status = CASE
            WHEN dead_letter_operation_metadata.recovery_status = 'completed' THEN 'completed'
            ELSE 'in_progress'
          END,
          recovery_reference = COALESCE(
            dead_letter_operation_metadata.recovery_reference,
            excluded.recovery_reference
          ),
          recovery_started_at = COALESCE(
            dead_letter_operation_metadata.recovery_started_at,
            excluded.recovery_started_at
          ),
          updated_at = excluded.updated_at
      `).bind(
        TIKTOK_BOOTSTRAP_INCIDENT.dlqId,
        TIKTOK_BOOTSTRAP_INCIDENT.operationId,
        TIKTOK_BOOTSTRAP_INCIDENT.workKey,
        TIKTOK_BOOTSTRAP_INCIDENT.generation,
        TIKTOK_BOOTSTRAP_INCIDENT.originalRequestedAt,
        recoveryReference,
        now,
        now,
        now,
      ).run();

      return Object.freeze({
        status: 'authorized',
        recoveryReference,
        workKey: work.work_key,
        cursorKey: work.cursor_key,
        nextSequence,
        firstAuthorization,
      });
    } catch (cause) {
      if (cause?.code?.startsWith?.('TIKTOK_BOOTSTRAP_RECOVERY_') || cause?.code === 'SYNC_LOCK_BUSY') {
        throw cause;
      }
      throw d1Error('Failed to authorize TikTok bootstrap recovery', 'D1_TIKTOK_BOOTSTRAP_RECOVERY_GUARD_FAILED', cause);
    }
  }

  /** Resolve the exact DLQ only after the original Work, write phase and Coverage prove completion. */
  async markTikTokBootstrapIncidentRecovered(input = {}) {
    assertExactIncident(input);
    const completedAt = timestamp(input.completedAt ?? this.now(), 'completedAt');
    const auditReference = requireText(input.auditReference, 'auditReference');
    try {
      const proof = await this.#readTikTokBootstrapCompletionProof();
      await this.db.batch([
        this.db.prepare(`
          UPDATE dead_letter_jobs
          SET status = 'redriven',
              redrive_requested_at = COALESCE(redrive_requested_at, ?),
              redrive_reference = COALESCE(redrive_reference, ?),
              redriven_at = COALESCE(redriven_at, ?),
              updated_at = ?
          WHERE dlq_id = ? AND status IN ('open', 'redrive_pending', 'redriven')
        `).bind(
          completedAt,
          auditReference,
          completedAt,
          completedAt,
          TIKTOK_BOOTSTRAP_INCIDENT.dlqId,
        ),
        this.db.prepare(`
          UPDATE dead_letter_operation_metadata
          SET recovery_status = 'completed',
              recovery_completed_at = COALESCE(recovery_completed_at, ?),
              audit_reference = COALESCE(audit_reference, ?),
              updated_at = ?
          WHERE dlq_id = ?
            AND operation_id = ?
            AND original_work_key = ?
            AND recovery_status IN ('in_progress', 'completed')
        `).bind(
          completedAt,
          auditReference,
          completedAt,
          TIKTOK_BOOTSTRAP_INCIDENT.dlqId,
          TIKTOK_BOOTSTRAP_INCIDENT.operationId,
          TIKTOK_BOOTSTRAP_INCIDENT.workKey,
        ),
      ]);
      return Object.freeze({
        status: 'completed',
        dlqId: TIKTOK_BOOTSTRAP_INCIDENT.dlqId,
        auditReference,
        completedAt,
        coverageRunId: proof.coverageRunId,
      });
    } catch (cause) {
      if (cause?.code?.startsWith?.('TIKTOK_BOOTSTRAP_RECOVERY_')) throw cause;
      throw d1Error('Failed to complete TikTok bootstrap incident recovery', 'D1_TIKTOK_BOOTSTRAP_RECOVERY_COMPLETE_FAILED', cause);
    }
  }

  async #readTikTokBootstrapCompletionProof() {
    const work = await this.db.prepare(`
      SELECT generation, requested_at, lifecycle_status, completion_json
      FROM sync_work_runs
      WHERE work_key = ?
    `).bind(TIKTOK_BOOTSTRAP_INCIDENT.workKey).first();
    if (!work
      || Number(work.generation) !== TIKTOK_BOOTSTRAP_INCIDENT.generation
      || Number(work.requested_at) !== TIKTOK_BOOTSTRAP_INCIDENT.originalRequestedAt
      || work.lifecycle_status !== 'completed') {
      throw incidentError('Original TikTok bootstrap Work is not completed', 'TIKTOK_BOOTSTRAP_RECOVERY_WORK_INCOMPLETE');
    }
    const completion = parseObject(work.completion_json, 'completion_json');
    const coverageRunId = optionalText(completion?.d1?.coverageRunId);
    if (!coverageRunId || completion?.d1?.coverageStatus !== 'complete') {
      throw incidentError('Original TikTok bootstrap completion lacks complete Coverage', 'TIKTOK_BOOTSTRAP_RECOVERY_COVERAGE_INCOMPLETE');
    }

    const phase = await this.db.prepare(`
      SELECT state_json, complete
      FROM sync_work_phases
      WHERE work_key = ? AND phase = ?
    `).bind(TIKTOK_BOOTSTRAP_INCIDENT.workKey, TIKTOK_BOOTSTRAP_INCIDENT.phase).first();
    const phaseState = parseObject(phase?.state_json, 'state_json');
    if (Number(phase?.complete) !== 1
      || Number(phaseState.rawRecordsCompleted) !== TIKTOK_BOOTSTRAP_INCIDENT.expectedRows
      || Number(phaseState.contentRowsDurable) !== TIKTOK_BOOTSTRAP_INCIDENT.expectedRows
      || Number(phaseState.observationRowsDurable) !== TIKTOK_BOOTSTRAP_INCIDENT.expectedRows) {
      throw incidentError('TikTok bootstrap write phase is not durably complete', 'TIKTOK_BOOTSTRAP_RECOVERY_PHASE_INCOMPLETE');
    }

    const coverage = await this.db.prepare(`
      SELECT status, expected_entities, observed_entities,
             expected_rows, observed_rows, failed_rows, completed_at
      FROM data_coverage_runs
      WHERE coverage_run_id = ?
    `).bind(coverageRunId).first();
    const expected = TIKTOK_BOOTSTRAP_INCIDENT.expectedRows;
    if (!coverage
      || coverage.status !== 'complete'
      || Number(coverage.expected_entities) !== expected
      || Number(coverage.observed_entities) !== expected
      || Number(coverage.expected_rows) !== expected
      || Number(coverage.observed_rows) !== expected
      || Number(coverage.failed_rows) !== 0
      || !Number.isSafeInteger(Number(coverage.completed_at))) {
      throw incidentError('TikTok bootstrap Coverage proof is not complete', 'TIKTOK_BOOTSTRAP_RECOVERY_COVERAGE_INCOMPLETE');
    }
    return Object.freeze({ coverageRunId });
  }
}

function assertExactIncident(input) {
  const values = {
    dlqId: requireText(input.dlqId, 'dlqId'),
    operationId: requireText(input.operationId, 'operationId'),
    workKey: requireText(input.workKey, 'workKey'),
    generation: timestamp(input.generation, 'generation'),
    originalRequestedAt: timestamp(input.originalRequestedAt, 'originalRequestedAt'),
  };
  for (const [key, expected] of Object.entries(TIKTOK_BOOTSTRAP_INCIDENT)) {
    if (!Object.hasOwn(values, key)) continue;
    if (values[key] !== expected) {
      throw incidentError('TikTok bootstrap recovery request does not match the exact incident', 'TIKTOK_BOOTSTRAP_RECOVERY_IDENTITY_MISMATCH', {
        fieldName: key,
      });
    }
  }
  return values;
}

function incidentError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

function parseObject(value, fieldName) {
  if (value === null || value === undefined || value === '') return {};
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError();
    return parsed;
  } catch (cause) {
    throw incidentError(`Invalid incident ${fieldName}`, 'TIKTOK_BOOTSTRAP_RECOVERY_STATE_INVALID', {
      fieldName,
      cause: sanitizeOperationalText(cause instanceof Error ? cause.message : String(cause)),
    });
  }
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

function requireD1(value) {
  if (typeof value?.prepare !== 'function' || typeof value?.batch !== 'function') {
    throw new TypeError('D1QueueOperationStore requires D1 prepare() and batch()');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`D1QueueOperationStore requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`D1QueueOperationStore ${fieldName} must be a non-negative safe integer`);
  }
  return number;
}

function nullableTimestamp(value) {
  return value === null || value === undefined ? null : timestamp(value, 'timestamp');
}

function nonNegative(value, fieldName) {
  return timestamp(value, fieldName);
}
