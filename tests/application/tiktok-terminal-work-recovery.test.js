import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIKTOK_TERMINAL_WORK_CONFIRMATIONS,
  TIKTOK_TERMINAL_WORK_INCIDENT,
  assertTikTokTerminalWorkConfirmation,
  assertTikTokTerminalWorkEnv,
  buildTikTokTerminalWorkEvidenceSql,
  buildTikTokTerminalWorkReactivationSql,
  parseTikTokTerminalWorkArgs,
  validateTikTokTerminalWorkReactivationResult,
  validateTikTokTerminalWorkRow,
} from '../../scripts/lib/tiktok-terminal-work-recovery.js';

const NOW = 1784869000000;

test('terminal-work operator exposes separate guarded reactivation and Queue resume phases', () => {
  assert.deepEqual(parseTikTokTerminalWorkArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseTikTokTerminalWorkArgs(['--phase=reactivate', '--execute']),
    { phase: 'reactivate', execute: true },
  );
  assert.deepEqual(
    parseTikTokTerminalWorkArgs(['--phase=resume', '--execute']),
    { phase: 'resume', execute: true },
  );
});

test('terminal-work confirmations and credentials are phase specific', () => {
  assert.throws(
    () => assertTikTokTerminalWorkConfirmation('reactivate', {}),
    (error) => error.code === 'TIKTOK_TERMINAL_WORK_CONFIRMATION_REQUIRED',
  );
  assert.equal(
    assertTikTokTerminalWorkConfirmation('reactivate', {
      [TIKTOK_TERMINAL_WORK_CONFIRMATIONS.reactivate.envName]:
        TIKTOK_TERMINAL_WORK_CONFIRMATIONS.reactivate.value,
    }),
    true,
  );

  assert.deepEqual(assertTikTokTerminalWorkEnv('reactivate', {
    WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_D1_DATABASE_NAME: 'social-mkt-state-dev',
  }), {
    wranglerConfig: 'wrangler.sync.jsonc',
    databaseName: 'social-mkt-state-dev',
    accountId: null,
    queueId: null,
  });

  assert.throws(
    () => assertTikTokTerminalWorkEnv('resume', {
      WRANGLER_CONFIG: 'wrangler.sync.jsonc',
      MKT_D1_DATABASE_NAME: 'social-mkt-state-dev',
    }),
    (error) => error.code === 'TIKTOK_TERMINAL_WORK_ENV_MISSING'
      && error.details.envName === 'CLOUDFLARE_ACCOUNT_ID',
  );
});

test('terminal-work SQL is exact, additive and guarded against current incident drift', () => {
  const evidenceSql = buildTikTokTerminalWorkEvidenceSql();
  const updateSql = buildTikTokTerminalWorkReactivationSql(NOW);

  assert.match(evidenceSql, new RegExp(TIKTOK_TERMINAL_WORK_INCIDENT.workKey, 'u'));
  assert.match(evidenceSql, new RegExp(TIKTOK_TERMINAL_WORK_INCIDENT.failedRecoveryDlqId, 'u'));
  assert.match(updateSql, /SET lifecycle_status='active'/u);
  assert.match(updateSql, /lifecycle_status='terminal'/u);
  assert.match(updateSql, /terminal_reason='QUEUE_RETRY_EXHAUSTED'/u);
  assert.match(updateSql, new RegExp(TIKTOK_TERMINAL_WORK_INCIDENT.failedRecoveryDlqId, 'u'));
  assert.match(updateSql, /json_extract\(state_json, '\$\.nextSequence'\)=2/u);
  assert.match(updateSql, /main_queue_attempts=6/u);
  assert.match(updateSql, /SELECT changes\(\) AS reactivated_rows/u);
  assert.doesNotMatch(updateSql, /\bDELETE\b/iu);
  assert.doesNotMatch(updateSql, /organic_content_state\s+SET/iu);
});

test('terminal-work evidence accepts only the exact terminal incident before reactivation', () => {
  const terminal = exactEvidenceRow('terminal');
  assert.equal(validateTikTokTerminalWorkRow(terminal, 'terminal', NOW).lockExpiredOrAbsent, true);

  assert.throws(
    () => validateTikTokTerminalWorkRow({ ...terminal, work_status: 'active' }, 'terminal', NOW),
    (error) => error.code === 'TIKTOK_TERMINAL_WORK_EVIDENCE_MISMATCH'
      && error.details.fieldName === 'work_status',
  );
  assert.throws(
    () => validateTikTokTerminalWorkRow({ ...terminal, work_audit_reference: 'wrong-dlq' }, 'terminal', NOW),
    (error) => error.code === 'TIKTOK_TERMINAL_WORK_EVIDENCE_MISMATCH'
      && error.details.fieldName === 'work_audit_reference',
  );
  assert.throws(
    () => validateTikTokTerminalWorkRow({ ...terminal, lock_expires_at: NOW + 1 }, 'terminal', NOW),
    (error) => error.code === 'TIKTOK_TERMINAL_WORK_LOCK_ACTIVE',
  );
});

test('active post-reactivation evidence keeps all durable facts and checkpoint unchanged', () => {
  const active = exactEvidenceRow('active');
  const validated = validateTikTokTerminalWorkRow(active, 'active', NOW);
  assert.equal(validated.work_status, 'active');
  assert.equal(validated.next_sequence, 2);
  assert.equal(validated.content_rows_durable, 1000);
  assert.deepEqual(
    validateTikTokTerminalWorkReactivationResult([{ reactivated_rows: 1 }]),
    { reactivatedRows: 1 },
  );
  assert.throws(
    () => validateTikTokTerminalWorkReactivationResult([{ reactivated_rows: 0 }]),
    (error) => error.code === 'TIKTOK_TERMINAL_WORK_REACTIVATION_FAILED',
  );
});

function exactEvidenceRow(status) {
  const incident = TIKTOK_TERMINAL_WORK_INCIDENT;
  const terminal = status === 'terminal';
  return {
    organic_content_state: 1309,
    organic_content_observations: 1000,
    data_coverage_entities: 1000,
    work_cursor_key: incident.cursorKey,
    work_status: status,
    work_terminal_reason: terminal ? 'QUEUE_RETRY_EXHAUSTED' : null,
    work_audit_reference: terminal ? incident.failedRecoveryDlqId : null,
    work_completed_at: null,
    work_generation: incident.generation,
    work_requested_at: incident.requestedAt,
    next_sequence: 2,
    units_completed: 2,
    raw_records_completed: 1000,
    content_rows_durable: 1000,
    observation_rows_durable: 1000,
    coverage_entities_written: 1000,
    phase_complete: 0,
    fence_cursor_key: incident.cursorKey,
    fence_generation: incident.generation,
    fence_requested_at: incident.requestedAt,
    original_dlq_status: 'open',
    original_dlq_message_id: incident.originalDlqMessageId,
    original_dlq_job_type: 'tiktok.creator.native.history.bootstrap',
    original_dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
    original_dlq_retry_count: 1,
    recovery_status: 'in_progress',
    recovery_reference: incident.recoveryReference,
    recovery_operation_id: incident.operationId,
    recovery_work_key: incident.workKey,
    recovery_generation: incident.generation,
    recovery_requested_at: incident.requestedAt,
    main_queue_attempts: incident.expectedMainQueueAttempts,
    failed_recovery_dlq_status: 'open',
    failed_recovery_message_id: incident.failedRecoveryMessageId,
    failed_recovery_job_type: 'tiktok.creator.native.history.recover',
    failed_recovery_error_code: 'QUEUE_RETRY_EXHAUSTED',
    failed_recovery_retry_count: incident.expectedMainQueueAttempts,
    matching_failed_runs: incident.expectedFailedRuns,
    max_failed_retry_count: incident.expectedMainQueueAttempts - 1,
    lock_expires_at: null,
    coverage_status: 'partial',
    coverage_expected_entities: incident.expectedRows,
    coverage_observed_entities: 0,
    coverage_expected_rows: incident.expectedRows,
    coverage_observed_rows: 0,
    coverage_failed_rows: 0,
    coverage_completed_at: null,
  };
}
