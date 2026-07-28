import {
  TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT,
} from './tiktok-course-level-schema-recovery.js';

const TERMINAL_REASON = 'QUEUE_PERMANENT_FAILURE';
const TERMINAL_JOB_TYPE = 'tiktok.creator.native.sync';
const OPERATION_ID = TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT.workKey.replace(/^tiktok:/u, '');

export const TIKTOK_COURSE_LEVEL_TERMINAL_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_TIKTOK_COURSE_LEVEL_TERMINAL_REACTIVATION',
  value: 'REACTIVATE_EXACT_TIKTOK_COURSE_LEVEL_TERMINAL_WORK',
});

/** อ่าน Admission/Work/Fence/Lock/Terminal DLQ ของ Incident เดิมโดยไม่แตะ Business facts */
export function buildTikTokCourseLevelTerminalEvidenceSql(input = {}) {
  const checkedAt = requireNonNegativeInteger(input.checkedAt ?? Date.now(), 'checkedAt');
  const incident = TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT;
  return compactSql(`
    SELECT
      a.admission_key,
      a.work_key,
      a.generation,
      a.source_watermark,
      a.metric_date,
      a.source_record_count,
      a.status AS admission_status,
      a.error_code AS admission_error_code,
      a.sync_run_id,
      a.requested_at AS admission_requested_at,
      r.status AS sync_status,
      r.error_code AS sync_error_code,
      r.records_written,
      w.cursor_key AS work_cursor_key,
      w.work_type,
      w.operation_fingerprint,
      w.generation AS work_generation,
      w.requested_at AS work_requested_at,
      w.lifecycle_status AS work_lifecycle_status,
      w.terminal_reason AS work_terminal_reason,
      w.audit_reference AS work_audit_reference,
      w.completed_at AS work_completed_at,
      w.completion_json AS work_completion_json,
      (
        SELECT COUNT(*)
        FROM sync_generation_fences AS f
        WHERE f.cursor_key = w.cursor_key
          AND f.work_key = w.work_key
          AND f.generation = w.generation
          AND f.requested_at = w.requested_at
      ) AS matching_fence_count,
      (
        SELECT COUNT(*)
        FROM sync_locks AS l
        WHERE (l.lock_key = w.cursor_key OR l.owner_id = a.sync_run_id OR l.owner_id = w.work_key)
          AND l.expires_at > ${checkedAt}
      ) AS active_lock_count,
      d.dlq_id AS terminal_dlq_id,
      d.message_id AS terminal_message_id,
      d.status AS terminal_dlq_status,
      d.job_type AS terminal_job_type,
      d.error_code AS terminal_error_code,
      d.retry_count AS terminal_retry_count,
      m.operation_id AS terminal_operation_id,
      m.original_work_key AS terminal_original_work_key,
      m.generation AS terminal_generation,
      m.original_requested_at AS terminal_original_requested_at,
      m.main_queue_attempts AS terminal_main_queue_attempts,
      m.recovery_status AS terminal_recovery_status,
      q.work_key AS attempt_work_key,
      q.generation AS attempt_generation,
      q.original_requested_at AS attempt_original_requested_at,
      q.main_queue_attempts AS tracked_main_queue_attempts,
      q.last_main_message_id AS tracked_last_main_message_id
    FROM tiktok_source_admissions AS a
    LEFT JOIN sync_runs AS r ON r.sync_run_id = a.sync_run_id
    LEFT JOIN sync_work_runs AS w ON w.work_key = a.work_key
    LEFT JOIN dead_letter_jobs AS d ON d.dlq_id = w.audit_reference
    LEFT JOIN dead_letter_operation_metadata AS m ON m.dlq_id = w.audit_reference
    LEFT JOIN queue_operation_attempts AS q ON q.operation_id = '${sqlText(OPERATION_ID)}'
    WHERE a.admission_key = '${sqlText(incident.admissionKey)}'
    LIMIT 1;
  `);
}

/** Reactivate เฉพาะ Work ที่ Queue Core terminalized จาก Permanent Lark preflight incident นี้ */
export function buildTikTokCourseLevelTerminalReactivationSql(input = {}) {
  const updatedAt = requireNonNegativeInteger(input.updatedAt ?? Date.now(), 'updatedAt');
  const incident = TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT;
  return compactSql(`
    UPDATE sync_work_runs
    SET lifecycle_status = 'active',
        terminal_reason = NULL,
        abandoned_at = NULL,
        expires_at = NULL,
        audit_reference = NULL,
        updated_at = ${updatedAt}
    WHERE work_key = '${sqlText(incident.workKey)}'
      AND generation = ${incident.generation}
      AND requested_at = ${incident.generation}
      AND lifecycle_status = 'terminal'
      AND terminal_reason = '${TERMINAL_REASON}'
      AND completed_at IS NULL
      AND completion_json IS NULL
      AND audit_reference GLOB 'terminal:*'
      AND EXISTS (
        SELECT 1
        FROM tiktok_source_admissions AS a
        WHERE a.admission_key = '${sqlText(incident.admissionKey)}'
          AND a.work_key = sync_work_runs.work_key
          AND a.generation = sync_work_runs.generation
          AND a.requested_at = sync_work_runs.requested_at
          AND a.source_watermark = '${sqlText(incident.sourceWatermark)}'
          AND a.metric_date = '${sqlText(incident.metricDate)}'
          AND a.source_record_count = ${incident.sourceRecordCount}
          AND a.sync_run_id = '${sqlText(incident.syncRunId)}'
          AND a.status = 'failed_permanent'
          AND a.error_code = '${sqlText(incident.errorCode)}'
      )
      AND EXISTS (
        SELECT 1
        FROM sync_runs AS r
        WHERE r.sync_run_id = '${sqlText(incident.syncRunId)}'
          AND r.status = 'failed'
          AND r.error_code = '${sqlText(incident.errorCode)}'
          AND r.records_written = 0
      )
      AND EXISTS (
        SELECT 1
        FROM sync_generation_fences AS f
        WHERE f.cursor_key = sync_work_runs.cursor_key
          AND f.work_key = sync_work_runs.work_key
          AND f.generation = sync_work_runs.generation
          AND f.requested_at = sync_work_runs.requested_at
      )
      AND EXISTS (
        SELECT 1
        FROM dead_letter_jobs AS d
        WHERE d.dlq_id = sync_work_runs.audit_reference
          AND d.message_id = substr(sync_work_runs.audit_reference, 10)
          AND d.status = 'open'
          AND d.job_type = '${TERMINAL_JOB_TYPE}'
          AND d.error_code = '${sqlText(incident.errorCode)}'
      )
      AND EXISTS (
        SELECT 1
        FROM dead_letter_operation_metadata AS m
        WHERE m.dlq_id = sync_work_runs.audit_reference
          AND m.operation_id = '${sqlText(OPERATION_ID)}'
          AND m.original_work_key = sync_work_runs.work_key
          AND m.generation = sync_work_runs.generation
          AND m.original_requested_at = sync_work_runs.requested_at
          AND m.main_queue_attempts >= 1
          AND m.recovery_status = 'not_started'
      )
      AND EXISTS (
        SELECT 1
        FROM queue_operation_attempts AS q
        WHERE q.operation_id = '${sqlText(OPERATION_ID)}'
          AND q.work_key = sync_work_runs.work_key
          AND q.generation = sync_work_runs.generation
          AND q.original_requested_at = sync_work_runs.requested_at
          AND q.main_queue_attempts >= 1
          AND q.last_main_message_id = substr(sync_work_runs.audit_reference, 10)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM sync_locks AS l
        WHERE (l.lock_key = sync_work_runs.cursor_key
          OR l.owner_id = '${sqlText(incident.syncRunId)}'
          OR l.owner_id = sync_work_runs.work_key)
          AND l.expires_at > ${updatedAt}
      )
    RETURNING
      work_key,
      cursor_key,
      generation,
      requested_at,
      lifecycle_status,
      terminal_reason,
      audit_reference,
      completed_at,
      completion_json;
  `);
}

export function validateTikTokCourseLevelTerminalEvidence(row, expectedStatus = 'terminal') {
  const value = requireObject(row, 'terminal evidence row');
  const incident = TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT;
  const exact = [
    ['admission_key', incident.admissionKey],
    ['work_key', incident.workKey],
    ['generation', incident.generation],
    ['source_watermark', incident.sourceWatermark],
    ['metric_date', incident.metricDate],
    ['source_record_count', incident.sourceRecordCount],
    ['sync_run_id', incident.syncRunId],
    ['admission_requested_at', incident.generation],
    ['work_generation', incident.generation],
    ['work_requested_at', incident.generation],
  ];
  const mismatch = exact.find(([field, expected]) => normalizeComparable(value[field]) !== expected);
  if (mismatch) {
    throw terminalError(
      'TikTok terminal recovery identity does not match the reviewed incident',
      'TIKTOK_COURSE_LEVEL_TERMINAL_IDENTITY_MISMATCH',
      { fieldName: mismatch[0] },
    );
  }
  if (value.sync_status !== 'failed'
    || value.sync_error_code !== incident.errorCode
    || Number(value.records_written) !== 0
    || Number(value.matching_fence_count) !== 1
    || Number(value.active_lock_count) !== 0
    || value.work_completed_at !== null
    || value.work_completion_json !== null) {
    throw terminalError(
      'TikTok terminal recovery zero-write/Fence/Lock guards are not satisfied',
      'TIKTOK_COURSE_LEVEL_TERMINAL_GUARD_FAILED',
      {
        syncStatus: value.sync_status ?? null,
        syncErrorCode: value.sync_error_code ?? null,
        recordsWritten: Number(value.records_written ?? 0),
        matchingFenceCount: Number(value.matching_fence_count ?? 0),
        activeLockCount: Number(value.active_lock_count ?? 0),
      },
    );
  }
  const cursorKey = requireText(value.work_cursor_key, 'work_cursor_key');

  if (expectedStatus === 'active') {
    if (!['failed_permanent', 'failed_retryable'].includes(value.admission_status)
      || value.work_lifecycle_status !== 'active'
      || value.work_terminal_reason !== null
      || value.work_audit_reference !== null) {
      throw terminalError(
        'TikTok course-level Work is not in the exact reactivated state',
        'TIKTOK_COURSE_LEVEL_TERMINAL_ACTIVE_VERIFY_FAILED',
        {
          admissionStatus: value.admission_status ?? null,
          workLifecycleStatus: value.work_lifecycle_status ?? null,
        },
      );
    }
    return Object.freeze({
      status: 'active',
      cursorKey,
      admissionStatus: value.admission_status,
      reactivationRequired: false,
    });
  }

  if (expectedStatus !== 'terminal') {
    throw new TypeError(`Unsupported expected terminal-work status: ${expectedStatus}`);
  }
  const auditReference = requireTerminalAuditReference(value.work_audit_reference);
  if (value.admission_status !== 'failed_permanent'
    || value.admission_error_code !== incident.errorCode
    || value.work_lifecycle_status !== 'terminal'
    || value.work_terminal_reason !== TERMINAL_REASON
    || value.terminal_dlq_id !== auditReference
    || value.terminal_message_id !== auditReference.slice('terminal:'.length)
    || value.terminal_dlq_status !== 'open'
    || value.terminal_job_type !== TERMINAL_JOB_TYPE
    || value.terminal_error_code !== incident.errorCode
    || value.terminal_operation_id !== OPERATION_ID
    || value.terminal_original_work_key !== incident.workKey
    || Number(value.terminal_generation) !== incident.generation
    || Number(value.terminal_original_requested_at) !== incident.generation
    || Number(value.terminal_main_queue_attempts) < 1
    || value.terminal_recovery_status !== 'not_started'
    || value.attempt_work_key !== incident.workKey
    || Number(value.attempt_generation) !== incident.generation
    || Number(value.attempt_original_requested_at) !== incident.generation
    || Number(value.tracked_main_queue_attempts) < 1
    || value.tracked_last_main_message_id !== value.terminal_message_id) {
    throw terminalError(
      'TikTok terminal DLQ evidence does not match the exact permanent preflight failure',
      'TIKTOK_COURSE_LEVEL_TERMINAL_DLQ_GUARD_FAILED',
      {
        admissionStatus: value.admission_status ?? null,
        lifecycleStatus: value.work_lifecycle_status ?? null,
        terminalReason: value.work_terminal_reason ?? null,
        terminalDlqStatus: value.terminal_dlq_status ?? null,
        terminalJobType: value.terminal_job_type ?? null,
        terminalErrorCode: value.terminal_error_code ?? null,
      },
    );
  }
  return Object.freeze({
    status: 'terminal',
    cursorKey,
    auditReference,
    terminalMessageId: value.terminal_message_id,
    mainQueueAttempts: Number(value.tracked_main_queue_attempts),
    reactivationRequired: true,
  });
}

export function validateTikTokCourseLevelTerminalReactivationRow(row) {
  const value = requireObject(row, 'terminal reactivation row');
  const incident = TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT;
  if (value.work_key !== incident.workKey
    || Number(value.generation) !== incident.generation
    || Number(value.requested_at) !== incident.generation
    || value.lifecycle_status !== 'active'
    || value.terminal_reason !== null
    || value.audit_reference !== null
    || value.completed_at !== null
    || value.completion_json !== null) {
    throw terminalError(
      'TikTok terminal Work reactivation did not update the exact reviewed row',
      'TIKTOK_COURSE_LEVEL_TERMINAL_REACTIVATION_INVALID',
    );
  }
  return Object.freeze({
    workKey: incident.workKey,
    cursorKey: requireText(value.cursor_key, 'cursor_key'),
    generation: incident.generation,
    status: 'active',
  });
}

function requireTerminalAuditReference(value) {
  const text = requireText(value, 'work_audit_reference');
  if (!/^terminal:[A-Za-z0-9_-]+$/u.test(text)) {
    throw terminalError(
      'TikTok terminal audit reference has an unsafe shape',
      'TIKTOK_COURSE_LEVEL_TERMINAL_AUDIT_INVALID',
    );
  }
  return text;
}

function normalizeComparable(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value);
  return value;
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function sqlText(value) {
  return String(value).replaceAll("'", "''");
}

function requireNonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return number;
}

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be non-empty text`);
  }
  return value.trim();
}

function terminalError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokCourseLevelTerminalReactivationError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
