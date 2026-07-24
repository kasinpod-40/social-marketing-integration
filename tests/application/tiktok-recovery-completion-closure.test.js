import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIKTOK_RECOVERY_COMPLETION_CLOSURE,
  assertTikTokRecoveryCompletionClosureConfirmation,
  buildTikTokRecoveryCompletionClosureRepairSql,
  parseTikTokRecoveryCompletionClosureArgs,
  validateTikTokRecoveryCompletionClosureReplay,
  validateTikTokRecoveryCompletionClosureRow,
} from '../../scripts/lib/tiktok-recovery-completion-closure.js';

const NOW = TIKTOK_RECOVERY_COMPLETION_CLOSURE.terminalAt + 60_000;

test('completion-closure parser and confirmation are fail-closed', () => {
  assert.deepEqual(
    parseTikTokRecoveryCompletionClosureArgs(['--phase=repair', '--execute']),
    { phase: 'repair', execute: true },
  );
  assert.throws(
    () => parseTikTokRecoveryCompletionClosureArgs(['--phase=unknown']),
    /Unsupported TikTok completion-closure phase/u,
  );
  assert.throws(
    () => assertTikTokRecoveryCompletionClosureConfirmation('repair', {}),
    (error) => error.code === 'TIKTOK_RECOVERY_COMPLETION_CLOSURE_CONFIRMATION_REQUIRED',
  );
  assert.equal(
    assertTikTokRecoveryCompletionClosureConfirmation('repair', {
      CONFIRM_TIKTOK_COMPLETION_CLOSURE_REPAIR: 'REPAIR_EXACT_COMPLETED_TIKTOK_RECOVERY_CLOSURE',
    }),
    true,
  );
});

test('exact terminal completion evidence and repaired final evidence pass', () => {
  const before = closureRow('before_repair');
  const validatedBefore = validateTikTokRecoveryCompletionClosureRow(
    before,
    'before_repair',
    NOW,
  );
  assert.equal(validatedBefore.lockExpiredOrAbsent, true);

  const final = closureRow('final');
  const validatedFinal = validateTikTokRecoveryCompletionClosureRow(final, 'final', NOW);
  assert.equal(validatedFinal.work_status, 'completed');
  assert.equal(validatedFinal.original_dlq_status, 'redriven');
  assert.equal(validatedFinal.terminal_dlq_status, 'redriven');
});

test('completion-closure rejects business-fact drift and replay drift', () => {
  const drift = closureRow('final');
  drift.organic_content_observations -= 1;
  assert.throws(
    () => validateTikTokRecoveryCompletionClosureRow(drift, 'final', NOW),
    (error) => error.code === 'TIKTOK_RECOVERY_COMPLETION_CLOSURE_EVIDENCE_MISMATCH',
  );

  const before = closureRow('final');
  const after = closureRow('final');
  assert.equal(validateTikTokRecoveryCompletionClosureReplay(before, after), true);
  after.data_coverage_entities += 1;
  assert.throws(
    () => validateTikTokRecoveryCompletionClosureReplay(before, after),
    (error) => error.code === 'TIKTOK_RECOVERY_COMPLETION_CLOSURE_EVIDENCE_MISMATCH'
      || error.code === 'TIKTOK_RECOVERY_COMPLETION_CLOSURE_REPLAY_DRIFT',
  );
});

test('guarded repair SQL is exact, additive and contains no business-fact mutation', () => {
  const sql = buildTikTokRecoveryCompletionClosureRepairSql(NOW);
  assert.match(sql, new RegExp(TIKTOK_RECOVERY_COMPLETION_CLOSURE.workKey, 'u'));
  assert.match(sql, new RegExp(TIKTOK_RECOVERY_COMPLETION_CLOSURE.originalDlqId, 'u'));
  assert.match(sql, new RegExp(TIKTOK_RECOVERY_COMPLETION_CLOSURE.terminalDlqId, 'u'));
  assert.match(sql, /lifecycle_status='completed'/u);
  assert.match(sql, /recovery_status='completed'/u);
  assert.doesNotMatch(sql, /DELETE\s+FROM/iu);
  assert.doesNotMatch(sql, /UPDATE\s+organic_content_/iu);
  assert.doesNotMatch(sql, /UPDATE\s+data_coverage_/iu);
});

function closureRow(stage) {
  const incident = TIKTOK_RECOVERY_COMPLETION_CLOSURE;
  const final = stage === 'final';
  return {
    organic_content_state: incident.expectedRows,
    organic_content_observations: incident.expectedRows,
    initial_observations: incident.expectedRows,
    data_coverage_entities: incident.expectedRows,
    state_duplicate_groups: 0,
    observation_duplicate_groups: 0,
    work_cursor_key: incident.cursorKey,
    work_status: final ? 'completed' : 'terminal',
    work_terminal_reason: final ? null : 'QUEUE_PERMANENT_FAILURE',
    work_audit_reference: final ? null : incident.terminalDlqId,
    work_generation: incident.generation,
    work_requested_at: incident.requestedAt,
    work_completed_at: incident.completedAt,
    work_abandoned_at: final ? null : incident.terminalAt,
    work_expires_at: incident.completedAt + 604_800_000,
    completion_mode: 'd1_only',
    completion_destination_mode: 'd1_only',
    completion_dry_run: 0,
    completion_raw_records: incident.expectedRows,
    completion_next_sequence: 5,
    completion_continuation_required: 0,
    completion_source_durable: 1,
    completion_source_complete: 1,
    completion_source_records: incident.expectedRows,
    completion_coverage_run_id: incident.coverageRunId,
    completion_coverage_status: 'complete',
    completion_planned_state_rows: incident.expectedRows,
    completion_planned_observation_rows: incident.expectedRows,
    completion_content_rows_durable: incident.expectedRows,
    completion_observation_rows_durable: incident.expectedRows,
    completion_coverage_entities_written: incident.expectedRows,
    completion_lark_content_writes: 0,
    completion_lark_daily_writes: 0,
    completion_lark_blocked: 1,
    completion_reconciliation_expected_entities: incident.expectedRows,
    completion_reconciliation_observed_entities: incident.expectedRows,
    completion_reconciliation_expected_rows: incident.expectedRows,
    completion_reconciliation_observed_rows: incident.expectedRows,
    completion_reconciliation_failed_rows: 0,
    completion_reconciliation_skipped_rows: 0,
    completion_reconciliation_duplicate_rows: 0,
    completion_reconciliation_status: 'complete',
    completion_resumable_generation: incident.generation,
    completion_resumable_complete: 1,
    phase_rows: 0,
    unit_rows: 0,
    fence_cursor_key: incident.cursorKey,
    fence_generation: incident.generation,
    fence_requested_at: incident.requestedAt,
    lock_expires_at: null,
    original_dlq_status: final ? 'redriven' : 'open',
    original_dlq_message_id: incident.originalDlqMessageId,
    original_dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
    original_recovery_status: final ? 'completed' : 'in_progress',
    original_recovery_reference: incident.recoveryReference,
    original_recovery_audit_reference: final ? incident.recoveryReference : null,
    failed_recovery_dlq_status: 'open',
    failed_recovery_dlq_message_id: incident.failedRecoveryMessageId,
    failed_recovery_dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
    terminal_dlq_status: final ? 'redriven' : 'open',
    terminal_dlq_message_id: incident.terminalMessageId,
    terminal_dlq_error_code: 'TIKTOK_BOOTSTRAP_RECOVERY_PHASE_INCOMPLETE',
    terminal_dlq_retry_count: incident.expectedMainQueueAttemptsBeforeReplay,
    terminal_recovery_status: final ? 'completed' : 'not_started',
    terminal_recovery_reference: final ? incident.closureReference : null,
    terminal_recovery_audit_reference: final ? incident.closureReference : null,
    main_queue_attempts: incident.expectedMainQueueAttemptsBeforeReplay,
    unexpected_terminal_failures: 0,
    coverage_status: 'complete',
    coverage_expected_entities: incident.expectedRows,
    coverage_observed_entities: incident.expectedRows,
    coverage_expected_rows: incident.expectedRows,
    coverage_observed_rows: incident.expectedRows,
    coverage_failed_rows: 0,
    coverage_completed_at: incident.completedAt - 431,
  };
}
