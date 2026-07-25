import {
  permanentError,
  transientError,
} from '../../../shared/src/errors/runtime-error.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * Controlled redrive bridge for one exact Google Ads Queue reference.
 * Revives only terminal same-generation Work and never touches completed/superseded Work.
 */
export class D1GoogleAdsLiveRedriveStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  async prepare(input = {}) {
    const value = normalizePrepare(input, this.now());
    const current = await this.#read(value.operationId);
    if (!current) {
      throw permanentError('Google Ads LIVE admission is unavailable for redrive', {
        code: 'GOOGLE_ADS_REDRIVE_ADMISSION_NOT_FOUND',
      });
    }
    assertIdentity(current, value);
    if (current.admissionStatus === 'completed' || current.workLifecycleStatus === 'completed') {
      return freezeResult(current, 'completed');
    }
    if (['queued', 'processing'].includes(current.admissionStatus)
      && current.workLifecycleStatus === 'active') {
      return freezeResult(current, 'already_queued');
    }
    if (current.workLifecycleStatus === 'superseded') {
      throw permanentError('Superseded Google Ads Work cannot be redriven', {
        code: 'GOOGLE_ADS_REDRIVE_WORK_SUPERSEDED',
      });
    }
    if (!['terminal', 'active'].includes(current.workLifecycleStatus)) {
      throw permanentError('Google Ads Work is not eligible for redrive', {
        code: 'GOOGLE_ADS_REDRIVE_WORK_STATE_INVALID',
        details: { lifecycleStatus: current.workLifecycleStatus },
      });
    }
    if (!['failed_retryable', 'failed_permanent', 'send_pending'].includes(current.admissionStatus)) {
      throw permanentError('Google Ads LIVE admission is not eligible for redrive', {
        code: 'GOOGLE_ADS_REDRIVE_ADMISSION_STATE_INVALID',
        details: { status: current.admissionStatus },
      });
    }

    try {
      await this.db.batch([
        this.db.prepare(`
          UPDATE sync_work_runs
          SET lifecycle_status = 'active',
              terminal_reason = NULL,
              abandoned_at = NULL,
              expires_at = NULL,
              audit_reference = ?,
              updated_at = ?
          WHERE work_key = ?
            AND generation = ?
            AND lifecycle_status IN ('terminal', 'active')
            AND completed_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM sync_locks
              WHERE lock_key = sync_work_runs.cursor_key
                AND expires_at > ?
            )
        `).bind(
          value.auditReference,
          value.now,
          value.workKey,
          value.generation,
          value.now,
        ),
        this.db.prepare(`
          UPDATE google_ads_live_admissions
          SET status = 'send_pending',
              send_attempts = CASE
                WHEN status = 'send_pending' THEN send_attempts
                ELSE send_attempts + 1
              END,
              last_error_code = NULL,
              updated_at = ?
          WHERE run_id = ?
            AND operation_id = ?
            AND work_key = ?
            AND generation = ?
            AND original_requested_at = ?
            AND status IN ('failed_retryable', 'failed_permanent', 'send_pending')
            AND completed_at IS NULL
            AND EXISTS (
              SELECT 1 FROM sync_work_runs AS work
              WHERE work.work_key = google_ads_live_admissions.work_key
                AND work.generation = google_ads_live_admissions.generation
                AND work.lifecycle_status = 'active'
                AND work.completed_at IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM sync_locks
                  WHERE lock_key = work.cursor_key
                    AND expires_at > ?
                )
            )
        `).bind(
          value.now,
          value.operationId,
          value.operationId,
          value.workKey,
          value.generation,
          value.originalRequestedAt,
          value.now,
        ),
      ]);
    } catch (cause) {
      throw transientError('Google Ads redrive preparation failed', {
        code: 'GOOGLE_ADS_REDRIVE_PREPARE_FAILED',
        cause,
      });
    }

    const prepared = await this.#read(value.operationId);
    if (!prepared) {
      throw permanentError('Google Ads redrive state disappeared', {
        code: 'GOOGLE_ADS_REDRIVE_STATE_INVALID',
      });
    }
    assertIdentity(prepared, value);
    if (prepared.admissionStatus !== 'send_pending'
      || prepared.workLifecycleStatus !== 'active') {
      throw permanentError('Google Ads redrive state transition was rejected', {
        code: 'GOOGLE_ADS_REDRIVE_STATE_INVALID',
        details: {
          admissionStatus: prepared.admissionStatus,
          workLifecycleStatus: prepared.workLifecycleStatus,
        },
      });
    }
    return freezeResult(prepared, 'send_pending');
  }

  async markQueued(input = {}) {
    const operationId = requireUuid(input.operationId, 'operationId');
    const now = timestamp(input.now ?? this.now(), 'now');
    try {
      await this.db.prepare(`
        UPDATE google_ads_live_admissions
        SET status = 'queued',
            queued_at = COALESCE(queued_at, ?),
            last_error_code = NULL,
            updated_at = ?
        WHERE run_id = ?
          AND operation_id = ?
          AND status IN ('send_pending', 'queued')
          AND completed_at IS NULL
      `).bind(now, now, operationId, operationId).run();
    } catch (cause) {
      throw transientError('Google Ads redrive queued marker failed', {
        code: 'GOOGLE_ADS_REDRIVE_QUEUE_MARK_FAILED',
        cause,
      });
    }
    const row = await this.#read(operationId);
    if (!row || !['queued', 'processing', 'completed'].includes(row.admissionStatus)) {
      throw permanentError('Google Ads redrive queued marker was rejected', {
        code: 'GOOGLE_ADS_REDRIVE_STATE_INVALID',
      });
    }
    return freezeResult(row, row.admissionStatus === 'completed' ? 'completed' : 'queued');
  }

  async #read(operationId) {
    let row;
    try {
      row = await this.db.prepare(`
        SELECT
          admission.run_id,
          admission.operation_id,
          admission.work_key,
          admission.generation,
          admission.original_requested_at,
          admission.status AS admission_status,
          admission.send_attempts,
          admission.completed_at AS admission_completed_at,
          work.cursor_key,
          work.work_type,
          work.generation AS work_generation,
          work.lifecycle_status AS work_lifecycle_status,
          work.completed_at AS work_completed_at
        FROM google_ads_live_admissions AS admission
        JOIN sync_work_runs AS work
          ON work.work_key = admission.work_key
        WHERE admission.operation_id = ?
        LIMIT 1
      `).bind(requireUuid(operationId, 'operationId')).first();
    } catch (cause) {
      throw transientError('Google Ads redrive state read failed', {
        code: 'GOOGLE_ADS_REDRIVE_READ_FAILED',
        cause,
      });
    }
    return row ? mapRow(row) : null;
  }
}

function normalizePrepare(input, defaultNow) {
  const operationId = requireUuid(input.operationId, 'operationId');
  const workKey = requireText(input.workKey, 'workKey');
  const generation = timestamp(input.generation, 'generation');
  const originalRequestedAt = timestamp(input.originalRequestedAt, 'originalRequestedAt');
  if (workKey !== `google_ads:${operationId}` || generation !== originalRequestedAt) {
    throw permanentError('Google Ads redrive identity is inconsistent', {
      code: 'GOOGLE_ADS_REDRIVE_IDENTITY_MISMATCH',
    });
  }
  return Object.freeze({
    operationId,
    workKey,
    generation,
    originalRequestedAt,
    auditReference: requireText(input.auditReference, 'auditReference'),
    now: timestamp(input.now ?? defaultNow, 'now'),
  });
}

function assertIdentity(row, expected) {
  if (row.runId !== expected.operationId
    || row.operationId !== expected.operationId
    || row.workKey !== expected.workKey
    || row.generation !== expected.generation
    || row.originalRequestedAt !== expected.originalRequestedAt
    || row.workGeneration !== expected.generation) {
    throw permanentError('Google Ads redrive state conflicts with Queue reference', {
      code: 'GOOGLE_ADS_REDRIVE_IDENTITY_MISMATCH',
    });
  }
}

function mapRow(row) {
  return Object.freeze({
    runId: row.run_id,
    operationId: row.operation_id,
    workKey: row.work_key,
    generation: Number(row.generation),
    originalRequestedAt: Number(row.original_requested_at),
    admissionStatus: row.admission_status,
    sendAttempts: Number(row.send_attempts),
    admissionCompletedAt: nullableTimestamp(row.admission_completed_at),
    cursorKey: row.cursor_key,
    workType: row.work_type,
    workGeneration: Number(row.work_generation),
    workLifecycleStatus: row.work_lifecycle_status,
    workCompletedAt: nullableTimestamp(row.work_completed_at),
  });
}

function freezeResult(row, disposition) {
  return Object.freeze({
    disposition,
    operationId: row.operationId,
    workKey: row.workKey,
    generation: row.generation,
    originalRequestedAt: row.originalRequestedAt,
    admissionStatus: row.admissionStatus,
    workLifecycleStatus: row.workLifecycleStatus,
    sendAttempts: row.sendAttempts,
  });
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function' || typeof value?.batch !== 'function') {
    throw new TypeError('D1GoogleAdsLiveRedriveStore requires D1 prepare() and batch()');
  }
  return value;
}

function requireUuid(value, fieldName) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    throw new TypeError(`${fieldName} must be a UUID v4`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a timestamp`);
  return number;
}

function nullableTimestamp(value) {
  return value === null || value === undefined ? null : Number(value);
}
