import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIKTOK_RECOVERY_BIND_FAILURE,
  TIKTOK_RECOVERY_BIND_HOTFIX_CONFIRMATIONS,
  TIKTOK_RECOVERY_BIND_HOTFIX_MERGE,
  assertTikTokRecoveryBindHotfixConfirmation,
  assertTikTokRecoveryBindHotfixEnv,
  buildTikTokRecoveryBindResumeSql,
  parseTikTokRecoveryBindHotfixArgs,
  validateTikTokRecoveryBindResumeRow,
} from '../../scripts/lib/tiktok-durable-recovery-bind-hotfix.js';

test('TikTok bind-hotfix operator exposes guarded deploy and resume phases', () => {
  assert.deepEqual(parseTikTokRecoveryBindHotfixArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseTikTokRecoveryBindHotfixArgs(['--phase=deploy', '--execute']),
    { phase: 'deploy', execute: true },
  );
  assert.deepEqual(
    parseTikTokRecoveryBindHotfixArgs(['--phase=resume', '--execute']),
    { phase: 'resume', execute: true },
  );
  assert.equal(TIKTOK_RECOVERY_BIND_HOTFIX_MERGE, '9ada02baf6059b6d9efc1aab2b96a4ff3b0bdfa4');
});

test('TikTok bind-hotfix confirmations and resume credentials are exact', () => {
  assert.throws(
    () => assertTikTokRecoveryBindHotfixConfirmation('resume', {}),
    (error) => error.code === 'TIKTOK_RECOVERY_BIND_HOTFIX_CONFIRMATION_REQUIRED',
  );
  assert.equal(
    assertTikTokRecoveryBindHotfixConfirmation('resume', {
      [TIKTOK_RECOVERY_BIND_HOTFIX_CONFIRMATIONS.resume.envName]:
        TIKTOK_RECOVERY_BIND_HOTFIX_CONFIRMATIONS.resume.value,
    }),
    true,
  );
  assert.throws(
    () => assertTikTokRecoveryBindHotfixEnv('resume', {
      WRANGLER_CONFIG: 'wrangler.sync.jsonc',
      MKT_D1_DATABASE_NAME: 'social-mkt-state-dev',
    }),
    (error) => error.code === 'TIKTOK_RECOVERY_BIND_HOTFIX_ENV_MISSING'
      && error.details.envName === 'CLOUDFLARE_ACCOUNT_ID',
  );
  assert.deepEqual(assertTikTokRecoveryBindHotfixEnv('resume', {
    WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_D1_DATABASE_NAME: 'social-mkt-state-dev',
    CLOUDFLARE_ACCOUNT_ID: 'account-id-12345678',
    CF_QUEUE_ID: 'queue-id-12345678',
    CLOUDFLARE_API_TOKEN: 'secret',
  }), {
    wranglerConfig: 'wrangler.sync.jsonc',
    databaseName: 'social-mkt-state-dev',
    accountId: 'account-id-12345678',
    queueId: 'queue-id-12345678',
  });
});

test('TikTok bind-hotfix resume SQL locks exact operation and failed recovery DLQ', () => {
  const sql = buildTikTokRecoveryBindResumeSql();
  assert.match(sql, new RegExp(TIKTOK_RECOVERY_BIND_FAILURE.operationId, 'u'));
  assert.match(sql, new RegExp(TIKTOK_RECOVERY_BIND_FAILURE.failedRecoveryDlqId, 'u'));
  assert.match(sql, /D1_ORGANIC_OBSERVATION_READ_FAILED/u);
  assert.match(sql, /main_queue_attempts/u);
});

test('TikTok bind-hotfix resume validation accepts only the exact exhausted retry state', () => {
  const row = exactResumeRow();
  assert.equal(validateTikTokRecoveryBindResumeRow(row, 1784868000000).lockExpiredOrAbsent, true);

  assert.throws(
    () => validateTikTokRecoveryBindResumeRow({ ...row, main_queue_attempts: 7 }, 1784868000000),
    (error) => error.code === 'TIKTOK_RECOVERY_BIND_HOTFIX_EVIDENCE_MISMATCH'
      && error.details.fieldName === 'main_queue_attempts',
  );
  assert.throws(
    () => validateTikTokRecoveryBindResumeRow({ ...row, lock_expires_at: 1784869000000 }, 1784868000000),
    (error) => error.code === 'TIKTOK_RECOVERY_BIND_HOTFIX_LOCK_ACTIVE',
  );
});

function exactResumeRow() {
  const incident = TIKTOK_RECOVERY_BIND_FAILURE;
  return {
    organic_content_state: 1309,
    organic_content_observations: 1000,
    data_coverage_entities: 1000,
    work_status: 'active',
    work_generation: incident.generation,
    work_requested_at: incident.requestedAt,
    next_sequence: 2,
    units_completed: 2,
    raw_records_completed: 1000,
    content_rows_durable: 1000,
    observation_rows_durable: 1000,
    coverage_entities_written: 1000,
    phase_complete: 0,
    original_dlq_status: 'open',
    original_dlq_message_id: incident.originalDlqMessageId,
    original_dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
    recovery_status: 'in_progress',
    recovery_reference: incident.recoveryReference,
    recovery_operation_id: incident.operationId,
    recovery_work_key: incident.workKey,
    recovery_generation: incident.generation,
    recovery_requested_at: incident.requestedAt,
    main_queue_attempts: 6,
    failed_recovery_dlq_status: 'open',
    failed_recovery_message_id: incident.failedRecoveryMessageId,
    failed_recovery_job_type: 'tiktok.creator.native.history.recover',
    failed_recovery_error_code: 'QUEUE_RETRY_EXHAUSTED',
    failed_recovery_retry_count: 6,
    matching_failed_runs: 6,
    max_failed_retry_count: 5,
    lock_expires_at: null,
    coverage_status: 'partial',
    coverage_expected_entities: 2021,
    coverage_observed_entities: 0,
    coverage_expected_rows: 2021,
    coverage_observed_rows: 0,
    coverage_failed_rows: 0,
    coverage_completed_at: null,
  };
}
