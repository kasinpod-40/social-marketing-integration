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
   * Claim one same-generation retry-exhausted Work for bounded automatic recovery. The claim is
   * durable per DLQ row and the Work transition cannot revive completed, superseded or permanent
   * failures. A repeated DLQ delivery may resend the same stable payload after a send/mark crash.
   */
  async authorizeSafeAutoRecovery(input = {}) {
    const dlqId = requireText(input.dlqId, 'dlqId');
    const operationId = requireText(input.operationId, 'operationId');
    const workKey = requireText(input.workKey, 'workKey');
    const generation = timestamp(input.generation, 'generation');
    const originalRequestedAt = timestamp(input.originalRequestedAt, 'originalRequestedAt');
    const jobType = requireText(input.jobType, 'jobType');
    const recoveryReference = requireText(input.recoveryReference, 'recoveryReference');
    const maxRecoveries = boundedPositiveInteger(input.maxRecoveries, 'maxRecoveries', 10);
    const cooldownSeconds = boundedPositiveInteger(
      input.cooldownSeconds,
      'cooldownSeconds',
      43_200,
    );
    const now = timestamp(input.now ?? this.now(), 'now');

    try {
      const current = await this.#readSafeAutoRecoveryState({ dlqId, now });
      assertSafeAutoRecoveryIdentity(current, {
        dlqId,
        operationId,
        workKey,
        generation,
        originalRequestedAt,
        jobType,
        recoveryReference,
      });
      if (current.workLifecycleStatus === 'completed') {
        return freezeSafeAutoRecovery(current, 'completed', false, 0);
      }
      if (current.metadataRecoveryStatus === 'completed') {
        return freezeSafeAutoRecovery(current, 'already_completed', false, 0);
      }
      const alreadyClaimed = current.metadataRecoveryStatus === 'in_progress'
        && current.metadataRecoveryReference === recoveryReference;
      if (!alreadyClaimed) {
        const claim = await this.db.prepare(`
          UPDATE dead_letter_operation_metadata
          SET recovery_status = 'in_progress',
              recovery_reference = ?,
              recovery_started_at = COALESCE(recovery_started_at, ?),
              updated_at = ?
          WHERE dlq_id = ?
            AND operation_id = ?
            AND original_work_key = ?
            AND generation = ?
            AND original_requested_at = ?
            AND recovery_status = 'not_started'
            AND (
              SELECT COUNT(*)
              FROM dead_letter_operation_metadata AS prior
              WHERE prior.original_work_key = dead_letter_operation_metadata.original_work_key
                AND prior.dlq_id <> dead_letter_operation_metadata.dlq_id
                AND prior.recovery_reference LIKE 'auto-recovery:%'
            ) < ?
        `).bind(
          recoveryReference,
          now,
          now,
          dlqId,
          operationId,
          workKey,
          generation,
          originalRequestedAt,
          maxRecoveries,
        ).run();
        if (readChanges(claim) !== 1) {
          const afterClaim = await this.#readSafeAutoRecoveryState({ dlqId, now });
          if (afterClaim?.metadataRecoveryStatus !== 'in_progress'
            || afterClaim.metadataRecoveryReference !== recoveryReference) {
            return freezeSafeAutoRecovery(
              afterClaim ?? current,
              'recovery_budget_exhausted',
              false,
              0,
            );
          }
        }
      }

      const revived = await this.db.prepare(`
        UPDATE sync_work_runs
        SET lifecycle_status = 'active',
            terminal_reason = NULL,
            abandoned_at = NULL,
            expires_at = NULL,
            audit_reference = ?,
            updated_at = ?
        WHERE work_key = ?
          AND generation = ?
          AND requested_at = ?
          AND lifecycle_status = 'terminal'
          AND terminal_reason = 'QUEUE_RETRY_EXHAUSTED'
          AND completed_at IS NULL
      `).bind(
        recoveryReference,
        now,
        workKey,
        generation,
        originalRequestedAt,
      ).run();
      const after = await this.#readSafeAutoRecoveryState({ dlqId, now });
      if (after?.workLifecycleStatus === 'completed') {
        return freezeSafeAutoRecovery(after, 'completed', false, 0);
      }
      if (after?.workLifecycleStatus !== 'active'
        || ![0, 1].includes(readChanges(revived))) {
        throw permanentError('Queue Work is not eligible for same-generation auto-recovery', {
          code: 'QUEUE_AUTO_RECOVERY_WORK_STATE_INVALID',
          details: { dlqId, workKey, generation },
        });
      }
      const lockDelay = Number.isSafeInteger(after.activeLockExpiresAt)
        && after.activeLockExpiresAt > now
        ? Math.ceil((after.activeLockExpiresAt - now) / 1000) + 5
        : 0;
      const priorCooldown = Number.isSafeInteger(after.priorRecoveryStartedAt)
        ? Math.max(0, Math.ceil(
          (after.priorRecoveryStartedAt + (cooldownSeconds * 1000) - now) / 1000,
        ))
        : 0;
      const delaySeconds = Math.min(
        43_200,
        Math.max(cooldownSeconds, lockDelay, priorCooldown),
      );
      return freezeSafeAutoRecovery(after, 'authorized', true, delaySeconds);
    } catch (cause) {
      if (cause?.code?.startsWith?.('QUEUE_AUTO_RECOVERY_')) throw cause;
      throw d1Error(
        'Failed to authorize Queue auto-recovery',
        'D1_QUEUE_AUTO_RECOVERY_AUTHORIZE_FAILED',
        cause,
      );
    }
  }

  async markSafeAutoRecoveryQueued(input = {}) {
    const dlqId = requireText(input.dlqId, 'dlqId');
    const operationId = requireText(input.operationId, 'operationId');
    const workKey = requireText(input.workKey, 'workKey');
    const recoveryReference = requireText(input.recoveryReference, 'recoveryReference');
    const now = timestamp(input.now ?? this.now(), 'now');
    try {
      const results = await this.db.batch([
        this.db.prepare(`
          UPDATE dead_letter_jobs
          SET status = 'redrive_pending',
              redrive_requested_at = COALESCE(redrive_requested_at, ?),
              redrive_reference = COALESCE(redrive_reference, ?),
              updated_at = ?
          WHERE dlq_id = ? AND status IN ('open', 'redrive_pending')
        `).bind(now, recoveryReference, now, dlqId),
        this.db.prepare(`
          UPDATE dead_letter_operation_metadata
          SET updated_at = ?
          WHERE dlq_id = ?
            AND operation_id = ?
            AND original_work_key = ?
            AND recovery_status = 'in_progress'
            AND recovery_reference = ?
        `).bind(now, dlqId, operationId, workKey, recoveryReference),
      ]);
      if (results.some((result) => readChanges(result) !== 1)) {
        throw permanentError('Queue auto-recovery queued marker was rejected', {
          code: 'QUEUE_AUTO_RECOVERY_MARK_QUEUED_REJECTED',
          details: { dlqId, workKey },
        });
      }
      return true;
    } catch (cause) {
      if (cause?.code?.startsWith?.('QUEUE_AUTO_RECOVERY_')) throw cause;
      throw d1Error(
        'Failed to persist Queue auto-recovery queued state',
        'D1_QUEUE_AUTO_RECOVERY_MARK_QUEUED_FAILED',
        cause,
      );
    }
  }

  /** Close only auto-recovery incidents after the exact Work is durably completed. */
  async completeSafeAutoRecoveriesForWork(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const generation = timestamp(input.generation, 'generation');
    const now = timestamp(input.now ?? this.now(), 'now');
    try {
      const work = await this.db.prepare(`
        SELECT lifecycle_status, completed_at
        FROM sync_work_runs
        WHERE work_key = ? AND generation = ?
      `).bind(workKey, generation).first();
      if (work?.lifecycle_status !== 'completed' || work.completed_at === null) {
        return Object.freeze({ completed: false, incidents: 0 });
      }
      const rows = await this.db.prepare(`
        SELECT dlq_id, recovery_reference
        FROM dead_letter_operation_metadata
        WHERE original_work_key = ?
          AND generation = ?
          AND recovery_status = 'in_progress'
          AND recovery_reference LIKE 'auto-recovery:%'
        ORDER BY created_at ASC
        LIMIT 25
      `).bind(workKey, generation).all();
      const incidents = readRows(rows);
      for (const incident of incidents) {
        const dlqId = requireText(incident.dlq_id, 'dlq_id');
        const recoveryReference = requireText(incident.recovery_reference, 'recovery_reference');
        await this.db.batch([
          this.db.prepare(`
            UPDATE dead_letter_operation_metadata
            SET recovery_status = 'completed',
                recovery_completed_at = COALESCE(recovery_completed_at, ?),
                audit_reference = COALESCE(audit_reference, ?),
                updated_at = ?
            WHERE dlq_id = ?
              AND original_work_key = ?
              AND generation = ?
              AND recovery_status = 'in_progress'
              AND recovery_reference = ?
          `).bind(now, recoveryReference, now, dlqId, workKey, generation, recoveryReference),
          this.db.prepare(`
            UPDATE dead_letter_jobs
            SET status = 'redriven',
                redrive_requested_at = COALESCE(redrive_requested_at, ?),
                redrive_reference = COALESCE(redrive_reference, ?),
                redriven_at = COALESCE(redriven_at, ?),
                updated_at = ?
            WHERE dlq_id = ? AND status IN ('open', 'redrive_pending', 'redriven')
          `).bind(now, recoveryReference, now, now, dlqId),
          this.db.prepare(`
            UPDATE system_alerts
            SET status = 'resolved', updated_at = ?
            WHERE alert_id = ? AND status IN ('open', 'acknowledged', 'resolved')
          `).bind(now, `alert:${dlqId}`),
        ]);
      }
      return Object.freeze({ completed: true, incidents: incidents.length });
    } catch (cause) {
      throw d1Error(
        'Failed to close completed Queue auto-recovery incidents',
        'D1_QUEUE_AUTO_RECOVERY_COMPLETE_FAILED',
        cause,
      );
    }
  }

  async #readSafeAutoRecoveryState({ dlqId, now }) {
    const row = await this.db.prepare(`
      SELECT
        dead.dlq_id,
        dead.job_type,
        dead.status AS dlq_status,
        dead.error_code,
        metadata.operation_id,
        metadata.original_work_key,
        metadata.generation AS metadata_generation,
        metadata.original_requested_at,
        metadata.recovery_status,
        metadata.recovery_reference,
        metadata.recovery_started_at,
        work.generation AS work_generation,
        work.requested_at AS work_requested_at,
        work.lifecycle_status,
        work.terminal_reason,
        work.completed_at,
        (
          SELECT MAX(lock.expires_at)
          FROM sync_locks AS lock
          WHERE lock.lock_key = work.cursor_key AND lock.expires_at > ?
        ) AS active_lock_expires_at,
        (
          SELECT MAX(prior.recovery_started_at)
          FROM dead_letter_operation_metadata AS prior
          WHERE prior.original_work_key = metadata.original_work_key
            AND prior.dlq_id <> metadata.dlq_id
            AND prior.recovery_reference LIKE 'auto-recovery:%'
        ) AS prior_recovery_started_at
      FROM dead_letter_jobs AS dead
      JOIN dead_letter_operation_metadata AS metadata ON metadata.dlq_id = dead.dlq_id
      JOIN sync_work_runs AS work ON work.work_key = metadata.original_work_key
      WHERE dead.dlq_id = ?
      LIMIT 1
    `).bind(now, dlqId).first();
    if (!row) return null;
    return Object.freeze({
      dlqId: row.dlq_id,
      jobType: row.job_type,
      dlqStatus: row.dlq_status,
      errorCode: row.error_code,
      operationId: row.operation_id,
      workKey: row.original_work_key,
      metadataGeneration: nullableNumber(row.metadata_generation),
      originalRequestedAt: nullableNumber(row.original_requested_at),
      metadataRecoveryStatus: row.recovery_status,
      metadataRecoveryReference: optionalText(row.recovery_reference),
      metadataRecoveryStartedAt: nullableNumber(row.recovery_started_at),
      workGeneration: nullableNumber(row.work_generation),
      workRequestedAt: nullableNumber(row.work_requested_at),
      workLifecycleStatus: row.lifecycle_status,
      terminalReason: row.terminal_reason,
      completedAt: nullableNumber(row.completed_at),
      activeLockExpiresAt: nullableNumber(row.active_lock_expires_at),
      priorRecoveryStartedAt: nullableNumber(row.prior_recovery_started_at),
    });
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

function assertSafeAutoRecoveryIdentity(current, expected) {
  if (!current) {
    throw permanentError('Queue auto-recovery state was not found', {
      code: 'QUEUE_AUTO_RECOVERY_STATE_NOT_FOUND',
      details: { dlqId: expected.dlqId },
    });
  }
  const identityMatches = current.dlqId === expected.dlqId
    && current.operationId === expected.operationId
    && current.workKey === expected.workKey
    && current.metadataGeneration === expected.generation
    && current.originalRequestedAt === expected.originalRequestedAt
    && current.workGeneration === expected.generation
    && current.workRequestedAt === expected.originalRequestedAt
    && current.jobType === expected.jobType;
  if (!identityMatches) {
    throw permanentError('Queue auto-recovery identity is inconsistent', {
      code: 'QUEUE_AUTO_RECOVERY_IDENTITY_MISMATCH',
      details: { dlqId: expected.dlqId, workKey: expected.workKey },
    });
  }
  if (!['open', 'redrive_pending', 'redriven'].includes(current.dlqStatus)
    || current.errorCode !== 'QUEUE_RETRY_EXHAUSTED') {
    throw permanentError('Dead-letter is not eligible for Queue auto-recovery', {
      code: 'QUEUE_AUTO_RECOVERY_DLQ_STATE_INVALID',
      details: { dlqId: expected.dlqId },
    });
  }
  if (!['not_started', 'in_progress', 'completed'].includes(current.metadataRecoveryStatus)) {
    throw permanentError('Queue auto-recovery metadata state is invalid', {
      code: 'QUEUE_AUTO_RECOVERY_METADATA_STATE_INVALID',
      details: { dlqId: expected.dlqId },
    });
  }
  if (current.metadataRecoveryReference
    && current.metadataRecoveryReference !== expected.recoveryReference) {
    throw permanentError('Queue auto-recovery reference changed', {
      code: 'QUEUE_AUTO_RECOVERY_REFERENCE_MISMATCH',
      details: { dlqId: expected.dlqId },
    });
  }
  if (current.workLifecycleStatus === 'completed') return true;
  if (current.workLifecycleStatus === 'active'
    && current.metadataRecoveryStatus === 'in_progress'
    && current.metadataRecoveryReference === expected.recoveryReference) return true;
  if (current.workLifecycleStatus !== 'terminal'
    || current.terminalReason !== 'QUEUE_RETRY_EXHAUSTED'
    || current.completedAt !== null) {
    throw permanentError('Queue Work is not a retry-exhausted terminal', {
      code: 'QUEUE_AUTO_RECOVERY_WORK_STATE_INVALID',
      details: { dlqId: expected.dlqId, workKey: expected.workKey },
    });
  }
  return true;
}

function freezeSafeAutoRecovery(current, disposition, sendRequired, delaySeconds) {
  return Object.freeze({
    disposition,
    sendRequired,
    delaySeconds,
    dlqId: current.dlqId,
    operationId: current.operationId,
    workKey: current.workKey,
    generation: current.workGeneration,
    lifecycleStatus: current.workLifecycleStatus,
  });
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

function boundedPositiveInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw new TypeError(`D1QueueOperationStore ${fieldName} must be between 1 and ${maximum}`);
  }
  return number;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function readRows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function readChanges(result) {
  const number = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}
