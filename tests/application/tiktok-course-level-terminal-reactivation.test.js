import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT,
} from '../../scripts/lib/tiktok-course-level-schema-recovery.js';
import {
  buildTikTokCourseLevelTerminalEvidenceSql,
  buildTikTokCourseLevelTerminalReactivationSql,
  validateTikTokCourseLevelTerminalEvidence,
  validateTikTokCourseLevelTerminalReactivationRow,
} from '../../scripts/lib/tiktok-course-level-terminal-reactivation.js';

const TERMINAL_MESSAGE_ID = 'message-course-level-1';
const TERMINAL_DLQ_ID = `terminal:${TERMINAL_MESSAGE_ID}`;
const OPERATION_ID = TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT.workKey.replace(/^tiktok:/u, '');

function terminalRow(overrides = {}) {
  const incident = TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT;
  return {
    admission_key: incident.admissionKey,
    work_key: incident.workKey,
    generation: incident.generation,
    source_watermark: incident.sourceWatermark,
    metric_date: incident.metricDate,
    source_record_count: incident.sourceRecordCount,
    admission_status: 'failed_permanent',
    admission_error_code: incident.errorCode,
    sync_run_id: incident.syncRunId,
    admission_requested_at: incident.generation,
    sync_status: 'failed',
    sync_error_code: incident.errorCode,
    records_written: 0,
    work_cursor_key: 'integration_workspace:tiktok:chemistry_k:native_import',
    work_type: 'tiktok.creator.native.sync',
    operation_fingerprint: 'fingerprint-1',
    work_generation: incident.generation,
    work_requested_at: incident.generation,
    work_lifecycle_status: 'terminal',
    work_terminal_reason: 'QUEUE_PERMANENT_FAILURE',
    work_audit_reference: TERMINAL_DLQ_ID,
    work_completed_at: null,
    work_completion_json: null,
    matching_fence_count: 1,
    active_lock_count: 0,
    terminal_dlq_id: TERMINAL_DLQ_ID,
    terminal_message_id: TERMINAL_MESSAGE_ID,
    terminal_dlq_status: 'open',
    terminal_job_type: 'tiktok.creator.native.sync',
    terminal_error_code: incident.errorCode,
    terminal_retry_count: 1,
    terminal_operation_id: OPERATION_ID,
    terminal_original_work_key: incident.workKey,
    terminal_generation: incident.generation,
    terminal_original_requested_at: incident.generation,
    terminal_main_queue_attempts: 1,
    terminal_recovery_status: 'not_started',
    attempt_work_key: incident.workKey,
    attempt_generation: incident.generation,
    attempt_original_requested_at: incident.generation,
    tracked_main_queue_attempts: 1,
    tracked_last_main_message_id: TERMINAL_MESSAGE_ID,
    ...overrides,
  };
}

function activeRow(overrides = {}) {
  return terminalRow({
    work_lifecycle_status: 'active',
    work_terminal_reason: null,
    work_audit_reference: null,
    terminal_dlq_id: null,
    terminal_message_id: null,
    terminal_dlq_status: null,
    terminal_job_type: null,
    terminal_error_code: null,
    terminal_retry_count: null,
    terminal_operation_id: null,
    terminal_original_work_key: null,
    terminal_generation: null,
    terminal_original_requested_at: null,
    terminal_main_queue_attempts: null,
    terminal_recovery_status: null,
    ...overrides,
  });
}

test('terminal evidence SQL reads exact Work, Fence, locks and permanent-failure DLQ evidence', () => {
  const sql = buildTikTokCourseLevelTerminalEvidenceSql({ checkedAt: 1785206000000 });
  assert.match(sql, /^SELECT /u);
  assert.match(sql, /w\.terminal_reason AS work_terminal_reason/u);
  assert.match(sql, /dead_letter_jobs AS d ON d\.dlq_id = w\.audit_reference/u);
  assert.match(sql, /dead_letter_operation_metadata AS m ON m\.dlq_id = w\.audit_reference/u);
  assert.match(sql, /queue_operation_attempts AS q ON q\.operation_id = 'watermark:f7f64/u);
  assert.match(sql, /l\.lock_key = w\.cursor_key/u);
  assert.match(sql, /l\.owner_id = a\.sync_run_id/u);
  assert.match(sql, /l\.owner_id = w\.work_key/u);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|DROP|ALTER|CREATE)\b/iu);
});

test('terminal reactivation SQL updates one exact operational Work and preserves Business facts', () => {
  const sql = buildTikTokCourseLevelTerminalReactivationSql({ updatedAt: 1785206000000 });
  assert.match(sql, /^UPDATE sync_work_runs SET lifecycle_status = 'active'/u);
  assert.match(sql, /terminal_reason = 'QUEUE_PERMANENT_FAILURE'/u);
  assert.match(sql, /d\.job_type = 'tiktok\.creator\.native\.sync'/u);
  assert.match(sql, /d\.error_code = 'LARK_PREFLIGHT_FAILED'/u);
  assert.match(sql, /m\.operation_id = 'watermark:f7f64/u);
  assert.match(sql, /m\.recovery_status = 'not_started'/u);
  assert.match(sql, /q\.last_main_message_id = substr\(sync_work_runs\.audit_reference, 10\)/u);
  assert.match(sql, /f\.cursor_key = sync_work_runs\.cursor_key/u);
  assert.match(sql, /RETURNING work_key/u);
  assert.doesNotMatch(sql, /\b(?:DELETE|DROP|ALTER|CREATE)\b/iu);
  assert.doesNotMatch(sql, /organic_content_state|organic_content_observations|data_coverage_entities/u);
});

test('terminal validator accepts only the exact permanent Lark preflight failure', () => {
  const result = validateTikTokCourseLevelTerminalEvidence(terminalRow(), 'terminal');
  assert.equal(result.status, 'terminal');
  assert.equal(result.reactivationRequired, true);
  assert.equal(result.auditReference, TERMINAL_DLQ_ID);
  assert.equal(result.mainQueueAttempts, 1);

  assert.throws(
    () => validateTikTokCourseLevelTerminalEvidence(
      terminalRow({ work_terminal_reason: 'QUEUE_RETRY_EXHAUSTED' }),
      'terminal',
    ),
    (error) => error.code === 'TIKTOK_COURSE_LEVEL_TERMINAL_DLQ_GUARD_FAILED',
  );
  assert.throws(
    () => validateTikTokCourseLevelTerminalEvidence(
      terminalRow({ terminal_error_code: 'OTHER_ERROR' }),
      'terminal',
    ),
    (error) => error.code === 'TIKTOK_COURSE_LEVEL_TERMINAL_DLQ_GUARD_FAILED',
  );
  assert.throws(
    () => validateTikTokCourseLevelTerminalEvidence(
      terminalRow({ active_lock_count: 1 }),
      'terminal',
    ),
    (error) => error.code === 'TIKTOK_COURSE_LEVEL_TERMINAL_GUARD_FAILED',
  );
  assert.throws(
    () => validateTikTokCourseLevelTerminalEvidence(
      terminalRow({ records_written: 1 }),
      'terminal',
    ),
    (error) => error.code === 'TIKTOK_COURSE_LEVEL_TERMINAL_GUARD_FAILED',
  );
});

test('active validator supports a retry-safe rerun before or after Admission reset', () => {
  const failedPermanent = validateTikTokCourseLevelTerminalEvidence(activeRow(), 'active');
  assert.equal(failedPermanent.status, 'active');
  assert.equal(failedPermanent.admissionStatus, 'failed_permanent');

  const failedRetryable = validateTikTokCourseLevelTerminalEvidence(
    activeRow({ admission_status: 'failed_retryable', admission_error_code: null }),
    'active',
  );
  assert.equal(failedRetryable.status, 'active');
  assert.equal(failedRetryable.admissionStatus, 'failed_retryable');
});

test('reactivation result must retain exact Work identity and clear terminal fields', () => {
  const incident = TIKTOK_COURSE_LEVEL_RECOVERY_INCIDENT;
  const result = validateTikTokCourseLevelTerminalReactivationRow({
    work_key: incident.workKey,
    cursor_key: 'integration_workspace:tiktok:chemistry_k:native_import',
    generation: incident.generation,
    requested_at: incident.generation,
    lifecycle_status: 'active',
    terminal_reason: null,
    audit_reference: null,
    completed_at: null,
    completion_json: null,
  });
  assert.equal(result.status, 'active');
  assert.equal(result.workKey, incident.workKey);

  assert.throws(
    () => validateTikTokCourseLevelTerminalReactivationRow({
      work_key: incident.workKey,
      cursor_key: 'integration_workspace:tiktok:chemistry_k:native_import',
      generation: incident.generation,
      requested_at: incident.generation,
      lifecycle_status: 'terminal',
      terminal_reason: 'QUEUE_PERMANENT_FAILURE',
      audit_reference: TERMINAL_DLQ_ID,
      completed_at: null,
      completion_json: null,
    }),
    (error) => error.code === 'TIKTOK_COURSE_LEVEL_TERMINAL_REACTIVATION_INVALID',
  );
});
