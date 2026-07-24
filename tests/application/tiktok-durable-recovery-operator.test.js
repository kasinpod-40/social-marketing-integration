import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIKTOK_DURABLE_RECOVERY_CONFIRMATIONS,
  TIKTOK_DURABLE_RECOVERY_INCIDENT,
  assertTikTokDurableRecoveryConfirmation,
  assertTikTokDurableRecoveryOperatorEnv,
  buildCloudflareQueuePushUrl,
  buildTikTokDurableRecoveryEnvelope,
  buildTikTokDurableRecoveryJob,
  extractWranglerD1Rows,
  parseTikTokDurableRecoveryArgs,
  validateTikTokRecoveryFinalRow,
  validateTikTokRecoveryPendingMigrations,
  validateTikTokRecoveryPostMigrationRow,
  validateTikTokRecoveryPreflightRow,
  validateTikTokRecoveryReplayRows,
  validateTikTokRecoveryWranglerConfig,
} from '../../scripts/lib/tiktok-durable-recovery-operator.js';

const NOW = Date.parse('2026-07-24T03:00:00.000Z');

test('operator defaults to plan and requires explicit execute flag', () => {
  assert.deepEqual(parseTikTokDurableRecoveryArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseTikTokDurableRecoveryArgs(['--phase=preflight', '--execute']),
    { phase: 'preflight', execute: true },
  );
  assert.throws(
    () => parseTikTokDurableRecoveryArgs(['--phase=all', '--execute']),
    /Unsupported TikTok recovery operator phase/u,
  );
});

test('write phases require exact distinct confirmations', () => {
  for (const [phase, contract] of Object.entries(TIKTOK_DURABLE_RECOVERY_CONFIRMATIONS)) {
    assert.throws(
      () => assertTikTokDurableRecoveryConfirmation(phase, {}),
      (error) => error.code === 'TIKTOK_RECOVERY_CONFIRMATION_REQUIRED',
    );
    assert.equal(assertTikTokDurableRecoveryConfirmation(phase, {
      [contract.envName]: contract.value,
    }), true);
  }
  assert.equal(assertTikTokDurableRecoveryConfirmation('preflight', {}), true);
  assert.equal(assertTikTokDurableRecoveryConfirmation('verify', {}), true);
});

test('operator environment locks the exact Integration Workspace D1 target', () => {
  const env = {
    WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_D1_DATABASE_NAME: 'social-mkt-state-dev',
  };
  assert.deepEqual(assertTikTokDurableRecoveryOperatorEnv('preflight', env), {
    wranglerConfig: 'wrangler.sync.jsonc',
    databaseName: 'social-mkt-state-dev',
    accountId: null,
    queueId: null,
  });
  assert.throws(
    () => assertTikTokDurableRecoveryOperatorEnv('preflight', {
      ...env,
      MKT_D1_DATABASE_NAME: 'production-db',
    }),
    (error) => error.code === 'TIKTOK_RECOVERY_TARGET_MISMATCH',
  );
  assert.throws(
    () => assertTikTokDurableRecoveryOperatorEnv('send', env),
    (error) => error.code === 'TIKTOK_RECOVERY_ENV_MISSING',
  );
});

test('recovery payload preserves exact incident identity and is never dry-run', () => {
  const job = buildTikTokDurableRecoveryJob();
  assert.deepEqual(job, {
    schemaVersion: 1,
    type: 'tiktok.creator.native.history.recover',
    trigger: 'manual_recovery',
    operationId: TIKTOK_DURABLE_RECOVERY_INCIDENT.operationId,
    workKey: TIKTOK_DURABLE_RECOVERY_INCIDENT.workKey,
    generation: TIKTOK_DURABLE_RECOVERY_INCIDENT.generation,
    originalRequestedAt: TIKTOK_DURABLE_RECOVERY_INCIDENT.requestedAt,
    requestedAt: '2026-07-23T18:03:00.000Z',
    dlqId: TIKTOK_DURABLE_RECOVERY_INCIDENT.dlqId,
    recoveryReference: `recovery:${TIKTOK_DURABLE_RECOVERY_INCIDENT.dlqId}:${TIKTOK_DURABLE_RECOVERY_INCIDENT.workKey}`,
    dryRun: false,
  });
  assert.deepEqual(buildTikTokDurableRecoveryEnvelope(), { body: job });
});

test('Cloudflare Queue endpoint accepts only safe account and Queue identifiers', () => {
  assert.equal(
    buildCloudflareQueuePushUrl({ accountId: 'account_12345678', queueId: 'queue_12345678' }),
    'https://api.cloudflare.com/client/v4/accounts/account_12345678/queues/queue_12345678/messages',
  );
  assert.throws(
    () => buildCloudflareQueuePushUrl({ accountId: '../bad', queueId: 'queue_12345678' }),
    (error) => error.code === 'TIKTOK_RECOVERY_CLOUDFLARE_IDENTIFIER_INVALID',
  );
});

test('pending migration gate accepts only reviewed Migration 0010', () => {
  assert.deepEqual(
    validateTikTokRecoveryPendingMigrations('Pending: 0010_tiktok_bootstrap_durable_recovery.sql'),
    ['0010_tiktok_bootstrap_durable_recovery.sql'],
  );
  assert.throws(
    () => validateTikTokRecoveryPendingMigrations([
      '0009_storage_foundation.sql',
      '0010_tiktok_bootstrap_durable_recovery.sql',
    ].join('\n')),
    (error) => error.code === 'TIKTOK_RECOVERY_PENDING_MIGRATIONS_MISMATCH',
  );
});

test('Wrangler config gate requires exact target, enabled recovery flags and disabled schedules', () => {
  const config = createSafeWranglerConfig();
  const result = validateTikTokRecoveryWranglerConfig(config);
  assert.equal(result.workerName, 'social-mkt-sync-worker');
  assert.equal(result.databaseName, 'social-mkt-state-dev');
  assert.equal(result.queueName, 'social-mkt-sync-jobs');
  assert.throws(
    () => validateTikTokRecoveryWranglerConfig(config.replace(
      '"MKT_SCHEDULE_TIKTOK_ENABLED": "false"',
      '"MKT_SCHEDULE_TIKTOK_ENABLED": "true"',
    )),
    (error) => error.code === 'TIKTOK_RECOVERY_CONFIG_UNSAFE',
  );
});

test('preflight evidence accepts only exact incident facts and an expired lock', () => {
  const row = createPreflightRow();
  assert.equal(validateTikTokRecoveryPreflightRow(row, NOW).lockExpired, true);
  assert.throws(
    () => validateTikTokRecoveryPreflightRow({ ...row, lock_expires_at: NOW + 1 }, NOW),
    (error) => error.code === 'TIKTOK_RECOVERY_LOCK_NOT_EXPIRED',
  );
  assert.throws(
    () => validateTikTokRecoveryPreflightRow({ ...row, organic_content_state: 1308 }, NOW),
    (error) => error.code === 'TIKTOK_RECOVERY_PREFLIGHT_EVIDENCE_MISMATCH',
  );
});

test('Wrangler D1 JSON extraction handles array envelopes and rejects empty results', () => {
  assert.deepEqual(extractWranglerD1Rows(JSON.stringify([{
    success: true,
    results: [{ value: 1 }],
  }])), [{ value: 1 }]);
  assert.throws(
    () => extractWranglerD1Rows(JSON.stringify([{ success: true, results: [] }])),
    (error) => error.code === 'TIKTOK_RECOVERY_D1_RESPONSE_EMPTY',
  );
});

test('post-migration evidence requires additive schema and unchanged business facts', () => {
  const row = {
    queue_operation_attempts_table: 1,
    dead_letter_operation_metadata_table: 1,
    queue_operation_attempts_index: 1,
    dead_letter_operation_work_index: 1,
    organic_content_state: 1309,
    organic_content_observations: 1000,
    data_coverage_entities: 1000,
  };
  assert.deepEqual(validateTikTokRecoveryPostMigrationRow(row), row);
  assert.throws(
    () => validateTikTokRecoveryPostMigrationRow({ ...row, organic_content_observations: 999 }),
    (error) => error.code === 'TIKTOK_RECOVERY_POST_MIGRATION_EVIDENCE_MISMATCH',
  );
});

test('final and replay evidence require exact 2021 completion with zero duplicate drift', () => {
  const final = createFinalRow();
  assert.deepEqual(validateTikTokRecoveryFinalRow(final), final);
  assert.equal(validateTikTokRecoveryReplayRows(final, { ...final }), true);
  assert.throws(
    () => validateTikTokRecoveryFinalRow({ ...final, observation_duplicate_groups: 1 }),
    (error) => error.code === 'TIKTOK_RECOVERY_FINAL_EVIDENCE_MISMATCH',
  );
  assert.throws(
    () => validateTikTokRecoveryReplayRows(final, {
      ...final,
      organic_content_observations: 2022,
    }),
    (error) => new Set([
      'TIKTOK_RECOVERY_FINAL_EVIDENCE_MISMATCH',
      'TIKTOK_RECOVERY_REPLAY_DRIFT',
    ]).has(error.code),
  );
});

function createSafeWranglerConfig() {
  return JSON.stringify({
    name: 'social-mkt-sync-worker',
    d1_databases: [{ database_name: 'social-mkt-state-dev' }],
    queues: { producers: [{ queue: 'social-mkt-sync-jobs' }] },
    vars: {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
      MKT_TIME_SERIES_D1_WRITE_ENABLED: 'true',
      MKT_TIME_SERIES_D1_BACKFILL_ENABLED: 'true',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'false',
      MKT_SCHEDULE_YOUTUBE_ENABLED: 'false',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
      MKT_REPORT_D1_SHADOW_READ_ENABLED: 'false',
      MKT_REPORT_D1_READ_ENABLED: 'false',
      MKT_LARK_DAILY_RETENTION_ENABLED: 'false',
      MKT_NOTIFICATION_RUNTIME_ENABLED: 'false',
      MKT_DLQ_REDRIVE_ENABLED: 'false',
    },
  }, null, 2);
}

function createPreflightRow() {
  return {
    organic_content_state: 1309,
    organic_content_observations: 1000,
    data_coverage_entities: 1000,
    work_status: 'active',
    work_generation: TIKTOK_DURABLE_RECOVERY_INCIDENT.generation,
    work_requested_at: TIKTOK_DURABLE_RECOVERY_INCIDENT.requestedAt,
    next_sequence: 2,
    units_completed: 2,
    raw_records_completed: 1000,
    content_rows_durable: 1000,
    observation_rows_durable: 1000,
    coverage_entities_written: 1000,
    phase_complete: 0,
    dlq_status: 'open',
    dlq_message_id: TIKTOK_DURABLE_RECOVERY_INCIDENT.dlqMessageId,
    dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
    lock_expires_at: NOW - 1,
    coverage_status: 'partial',
    coverage_expected_entities: 2021,
    coverage_observed_entities: 1000,
    coverage_expected_rows: 2021,
    coverage_observed_rows: 1000,
    coverage_failed_rows: 0,
    coverage_completed_at: null,
  };
}

function createFinalRow() {
  return {
    organic_content_state: 2021,
    organic_content_observations: 2021,
    initial_observations: 2021,
    data_coverage_entities: 2021,
    state_duplicate_groups: 0,
    observation_duplicate_groups: 0,
    work_status: 'completed',
    work_generation: TIKTOK_DURABLE_RECOVERY_INCIDENT.generation,
    work_requested_at: TIKTOK_DURABLE_RECOVERY_INCIDENT.requestedAt,
    next_sequence: 5,
    raw_records_completed: 2021,
    content_rows_durable: 2021,
    observation_rows_durable: 2021,
    coverage_entities_written: 2021,
    phase_complete: 1,
    dlq_status: 'redriven',
    recovery_status: 'completed',
    recovery_operation_id: TIKTOK_DURABLE_RECOVERY_INCIDENT.operationId,
    recovery_work_key: TIKTOK_DURABLE_RECOVERY_INCIDENT.workKey,
    coverage_status: 'complete',
    coverage_expected_entities: 2021,
    coverage_observed_entities: 2021,
    coverage_expected_rows: 2021,
    coverage_observed_rows: 2021,
    coverage_failed_rows: 0,
    coverage_completed_at: NOW,
  };
}
