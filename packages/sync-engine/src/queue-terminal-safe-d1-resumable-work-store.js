import { permanentError, transientError } from '../../shared/src/errors/runtime-error.js';
import { D1ResumableWorkStore as BaseD1ResumableWorkStore } from './d1-resumable-work-store.js';

/**
 * Queue failure handling must never reverse durable completion.
 * The base store still supports terminal/superseded lifecycle transitions for active Work, while
 * this Queue-specific adapter treats a completed Work as immutable operational evidence.
 */
export class D1ResumableWorkStore extends BaseD1ResumableWorkStore {
  async abandonWork(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const current = await this.db.prepare(`
      SELECT lifecycle_status
      FROM sync_work_runs
      WHERE work_key = ?
    `).bind(workKey).first();
    if (current?.lifecycle_status === 'completed') {
      return Object.freeze({
        terminal: false,
        found: true,
        status: 'completed',
        protectedCompletedWork: true,
      });
    }
    return super.abandonWork(input);
  }

  /**
   * Revive one exact same-generation terminal Work only after a retained source phase is already
   * durably complete. This is intentionally narrower than beginWork(): it cannot create Work,
   * change generation, revive superseded/completed Work, or run while the cursor has an active lock.
   */
  async prepareCompletedSourceRedrive(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const generation = requireTimestamp(input.generation, 'generation');
    const sourcePhase = requireText(input.sourcePhase, 'sourcePhase');
    const auditReference = requireText(input.auditReference, 'auditReference');
    const now = requireTimestamp(input.now ?? this.now(), 'now');

    let current;
    try {
      current = await this.#readCompletedSourceRecoveryState({ workKey, sourcePhase, now });
    } catch (cause) {
      throw transientError('Failed to read completed-source Work recovery state', {
        code: 'D1_SYNC_WORK_RECOVERY_READ_FAILED',
        cause,
      });
    }
    assertRecoveryIdentity(current, { workKey, generation, sourcePhase });

    if (current.lifecycleStatus === 'completed') {
      return freezeRecovery(current, 'completed');
    }
    if (current.lifecycleStatus === 'superseded') {
      throw permanentError('Superseded Work cannot be revived', {
        code: 'SYNC_WORK_RECOVERY_SUPERSEDED',
        details: { workKey, generation },
      });
    }
    if (current.sourceComplete !== 1 || current.sourceStage !== 'complete') {
      throw permanentError('Terminal Work source staging is not durably complete', {
        code: 'SYNC_WORK_RECOVERY_SOURCE_INCOMPLETE',
        details: {
          workKey,
          generation,
          sourcePhase,
          sourceComplete: current.sourceComplete,
          sourceStage: current.sourceStage,
        },
      });
    }
    if (current.activeLockCount > 0) {
      return freezeRecovery(current, 'already_processing');
    }
    if (current.lifecycleStatus === 'active') {
      return freezeRecovery(current, 'active');
    }
    if (current.lifecycleStatus !== 'terminal' || current.completedAt !== null) {
      throw permanentError('Work lifecycle is not eligible for same-generation recovery', {
        code: 'SYNC_WORK_RECOVERY_STATE_INVALID',
        details: {
          workKey,
          generation,
          lifecycleStatus: current.lifecycleStatus,
          completed: current.completedAt !== null,
        },
      });
    }

    let result;
    try {
      result = await this.db.prepare(`
        UPDATE sync_work_runs
        SET lifecycle_status = 'active',
            terminal_reason = NULL,
            abandoned_at = NULL,
            expires_at = NULL,
            audit_reference = ?,
            updated_at = ?
        WHERE work_key = ?
          AND generation = ?
          AND lifecycle_status = 'terminal'
          AND completed_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM sync_work_phases AS phase
            WHERE phase.work_key = sync_work_runs.work_key
              AND phase.phase = ?
              AND phase.complete = 1
              AND json_extract(phase.state_json, '$.stage') = 'complete'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM sync_locks AS lock
            WHERE lock.lock_key = sync_work_runs.cursor_key
              AND lock.expires_at > ?
          )
      `).bind(
        auditReference,
        now,
        workKey,
        generation,
        sourcePhase,
        now,
      ).run();
    } catch (cause) {
      throw transientError('Failed to revive completed-source terminal Work', {
        code: 'D1_SYNC_WORK_RECOVERY_WRITE_FAILED',
        cause,
      });
    }
    if (readChanges(result) !== 1) {
      throw transientError('Completed-source Work recovery lost its guarded transition race', {
        code: 'D1_SYNC_WORK_RECOVERY_RACE',
        details: { workKey, generation },
      });
    }

    return Object.freeze({
      disposition: 'revived',
      workKey,
      generation,
      lifecycleStatus: 'active',
      sourcePhase,
      sourceComplete: true,
      sourceStage: 'complete',
    });
  }

  async #readCompletedSourceRecoveryState({ workKey, sourcePhase, now }) {
    const row = await this.db.prepare(`
      SELECT
        work.work_key,
        work.generation,
        work.lifecycle_status,
        work.completed_at,
        phase.complete AS source_complete,
        json_extract(phase.state_json, '$.stage') AS source_stage,
        (
          SELECT COUNT(*)
          FROM sync_locks AS lock
          WHERE lock.lock_key = work.cursor_key
            AND lock.expires_at > ?
        ) AS active_lock_count
      FROM sync_work_runs AS work
      LEFT JOIN sync_work_phases AS phase
        ON phase.work_key = work.work_key
       AND phase.phase = ?
      WHERE work.work_key = ?
      LIMIT 1
    `).bind(now, sourcePhase, workKey).first();
    if (!row) return null;
    return Object.freeze({
      workKey: row.work_key,
      generation: Number(row.generation),
      lifecycleStatus: row.lifecycle_status,
      completedAt: row.completed_at === null || row.completed_at === undefined
        ? null
        : Number(row.completed_at),
      sourceComplete: Number(row.source_complete ?? 0),
      sourceStage: row.source_stage ?? null,
      activeLockCount: Number(row.active_lock_count ?? 0),
    });
  }
}

function assertRecoveryIdentity(current, expected) {
  if (!current) {
    throw permanentError('Resumable Work was not found for recovery', {
      code: 'SYNC_WORK_RECOVERY_NOT_FOUND',
      details: { workKey: expected.workKey },
    });
  }
  if (current.workKey !== expected.workKey || current.generation !== expected.generation) {
    throw permanentError('Resumable Work recovery identity mismatch', {
      code: 'SYNC_WORK_RECOVERY_IDENTITY_MISMATCH',
      details: { workKey: expected.workKey, generation: expected.generation },
    });
  }
}

function freezeRecovery(current, disposition) {
  return Object.freeze({
    disposition,
    workKey: current.workKey,
    generation: current.generation,
    lifecycleStatus: current.lifecycleStatus,
    sourceComplete: current.sourceComplete === 1,
    sourceStage: current.sourceStage,
  });
}

function readChanges(result) {
  const number = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw new TypeError(`Queue-terminal-safe Work store requires valid ${fieldName}`);
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Queue-terminal-safe Work store requires ${fieldName}`);
  }
  return value.trim();
}
