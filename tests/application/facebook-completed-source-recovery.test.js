import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FACEBOOK_COMPLETED_SOURCE_INCIDENT,
  buildFacebookRecoveryWranglerConfig,
  evaluateFacebookCompletedSourceCompletion,
  evaluateFacebookCompletedSourcePreflight,
  validateFacebookRecoveryWranglerConfig,
} from '../../scripts/lib/facebook-completed-source-recovery.js';

const incident = FACEBOOK_COMPLETED_SOURCE_INCIDENT;
const GENERATION = Date.parse('2026-08-10T12:00:00.000Z');

function sourceConfig({ booleanFlags = false } = {}) {
  const trueFlag = booleanFlags ? true : 'true';
  const falseFlag = booleanFlags ? false : 'false';
  return JSON.stringify({
    name: incident.workerName,
    main: './apps/sync-worker/src/index.js',
    compatibility_date: '2026-07-15',
    vars: {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: incident.customerProfile,
      MKT_CONNECTION_CUSTOMER_KEY: incident.customerKey,
      MKT_CONNECTOR_FACEBOOK_ENABLED: trueFlag,
      MKT_META_SOURCE_READ_ENABLED: trueFlag,
      MKT_META_D1_WRITE_ENABLED: trueFlag,
      MKT_META_LARK_WRITE_ENABLED: trueFlag,
      MKT_DLQ_REDRIVE_ENABLED: falseFlag,
      MKT_SCHEDULE_FACEBOOK_ENABLED: falseFlag,
      MKT_SCHEDULE_INSTAGRAM_ENABLED: falseFlag,
      UNRELATED_FLAG: 'retained',
    },
    d1_databases: [{
      binding: 'MKT_STATE_DB',
      database_name: 'social-mkt-state-dev',
      database_id: '12345678-1234-4234-8234-123456789012',
    }],
    queues: {
      producers: [{ binding: 'MKT_SYNC_QUEUE', queue: incident.mainQueueName }],
      consumers: [{
        queue: incident.mainQueueName,
        max_concurrency: 1,
        max_batch_size: 10,
        max_batch_timeout: 30,
        max_retries: 5,
        dead_letter_queue: 'social-mkt-sync-dlq',
      }, {
        queue: 'social-mkt-sync-dlq',
        max_concurrency: 1,
        max_batch_size: 10,
        max_batch_timeout: 30,
        max_retries: 10,
      }],
    },
  }, null, 2);
}

function passingPreflight() {
  return {
    work: {
      work_key: incident.workKey,
      cursor_key: 'integration_workspace:facebook:chemistry_k',
      generation: GENERATION,
      requested_at: GENERATION,
      lifecycle_status: 'terminal',
      terminal_reason: 'QUEUE_PERMANENT_FAILURE',
      completed_at: null,
    },
    source: {
      complete: 1,
      stage: 'complete',
      unit_count: incident.expectedUnits,
      content_index: incident.expectedContentCount,
      content_count: incident.expectedContentCount,
      scope: incident.sourceScope,
      scope_start_sequence: incident.scopeStartSequence,
    },
    phases: {
      d1_complete: null,
      lark_complete: null,
      completion_complete: null,
    },
    observations: {
      operation_observations: 0,
      target_day_observations: 0,
    },
    queueOperation: {
      operation_id: incident.operationId,
      work_key: incident.workKey,
      generation: GENERATION,
      original_requested_at: GENERATION,
      main_queue_attempts: incident.expectedUnits,
    },
    deadLetters: [{
      dlq_id: 'terminal:facebook-message-173',
      status: 'open',
      job_type: incident.jobType,
      error_code: incident.expectedFailureCode,
      metadata_operation_id: incident.operationId,
      metadata_work_key: incident.workKey,
      metadata_generation: GENERATION,
      metadata_original_requested_at: GENERATION,
      replay_type: incident.jobType,
      replay_operation_id: incident.operationId,
      replay_work_key: incident.workKey,
      replay_generation: GENERATION,
      replay_original_requested_at: GENERATION,
      replay_period_start: incident.periodStart,
      replay_period_end: incident.periodEnd,
    }],
    scopedSequences: Array.from(
      { length: incident.expectedScopedRows },
      (_, index) => incident.scopeStartSequence + index,
    ),
    activeLockCount: 0,
  };
}

test('recovery config flips only the redrive gate and retains all existing topology/vars', () => {
  const original = JSON.parse(sourceConfig());
  const validated = validateFacebookRecoveryWranglerConfig(sourceConfig());
  assert.equal(validated.executionFlags.redrive, 'false');

  const recovery = buildFacebookRecoveryWranglerConfig(sourceConfig(), true);
  const changed = JSON.parse(recovery.text);
  assert.deepEqual(recovery.changed, ['vars.MKT_DLQ_REDRIVE_ENABLED']);
  assert.equal(changed.vars.MKT_DLQ_REDRIVE_ENABLED, 'true');
  assert.equal(changed.vars.UNRELATED_FLAG, 'retained');

  changed.vars.MKT_DLQ_REDRIVE_ENABLED = 'false';
  assert.deepEqual(changed, original);
});

test('recovery config accepts boolean Wrangler flags and preserves the redrive value type', () => {
  const source = sourceConfig({ booleanFlags: true });
  const original = JSON.parse(source);
  const validated = validateFacebookRecoveryWranglerConfig(source);
  assert.equal(validated.executionFlags.facebook, true);
  assert.equal(validated.executionFlags.redrive, false);

  const recovery = buildFacebookRecoveryWranglerConfig(source, true);
  const changed = JSON.parse(recovery.text);
  assert.deepEqual(recovery.changed, ['vars.MKT_DLQ_REDRIVE_ENABLED']);
  assert.equal(changed.vars.MKT_DLQ_REDRIVE_ENABLED, true);
  assert.equal(changed.vars.MKT_CONNECTOR_FACEBOOK_ENABLED, true);
  assert.equal(changed.vars.MKT_SCHEDULE_FACEBOOK_ENABLED, false);

  changed.vars.MKT_DLQ_REDRIVE_ENABLED = false;
  assert.deepEqual(changed, original);
});

test('recovery config still rejects non-boolean flag representations', () => {
  const invalid = JSON.parse(sourceConfig());
  invalid.vars.MKT_CONNECTOR_FACEBOOK_ENABLED = 1;
  assert.throws(
    () => validateFacebookRecoveryWranglerConfig(JSON.stringify(invalid)),
    (error) => error?.code === 'FACEBOOK_RECOVERY_CONFIG_INVALID'
      && error?.details?.fieldName === 'MKT_CONNECTOR_FACEBOOK_ENABLED',
  );
});

test('completed-source incident preflight passes only the exact retained Facebook operation', () => {
  const result = evaluateFacebookCompletedSourcePreflight(passingPreflight());
  assert.equal(result.ok, true);
  assert.equal(result.status, 'FACEBOOK_COMPLETED_SOURCE_REDRIVE_PREFLIGHT_PASS');
  assert.equal(result.deadLetterId, 'terminal:facebook-message-173');
  assert.equal(result.scopedRows, 91);
  assert.deepEqual(result.missingScopedSequences, []);
});

test('completed-source incident preflight fails closed if any active scoped sequence is missing', () => {
  const input = passingPreflight();
  input.scopedSequences = input.scopedSequences.filter((sequence) => sequence !== 120);
  const result = evaluateFacebookCompletedSourcePreflight(input);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingScopedSequences, [120]);
  assert.ok(result.errors.some((row) => row.field === 'physical scoped staging'));
});

test('completed-source incident preflight fails closed after any Business mutation', () => {
  const input = passingPreflight();
  input.phases.d1_complete = 1;
  input.observations.operation_observations = 3;
  const result = evaluateFacebookCompletedSourcePreflight(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((row) => row.field === 'd1 phase must be incomplete'));
  assert.ok(result.errors.some((row) => row.field === 'operation observations before recovery'));
});

test('completed-source incident preflight rejects missing stable generation timestamps', () => {
  const input = passingPreflight();
  input.work.generation = null;
  input.work.requested_at = null;
  input.queueOperation.generation = null;
  input.queueOperation.original_requested_at = null;
  input.deadLetters[0].metadata_generation = null;
  input.deadLetters[0].metadata_original_requested_at = null;
  input.deadLetters[0].replay_generation = null;
  input.deadLetters[0].replay_original_requested_at = null;

  const result = evaluateFacebookCompletedSourcePreflight(input);
  assert.equal(result.ok, false);
  assert.equal(result.generation, null);
  assert.ok(result.errors.some((row) => row.field === 'work generation/requested_at'));
  assert.ok(result.errors.some((row) => row.field === 'queue operation generation'));
  assert.ok(result.errors.some((row) => row.field === 'dead letter replay generation'));
});

test('completion contract requires D1, Lark, Work completion and target-day observations', () => {
  const pass = evaluateFacebookCompletedSourceCompletion({
    latest: {
      work_lifecycle_status: 'completed',
      sync_status: 'success',
      source_complete: 1,
      source_stage: 'complete',
      source_units: incident.expectedUnits,
      content_index: incident.expectedContentCount,
      content_count: incident.expectedContentCount,
      d1_complete: 1,
      lark_complete: 1,
      completion_complete: 1,
      operation_observations: 89,
      target_day_observations: 89,
      active_locks: 0,
    },
  });
  assert.equal(pass.ok, true);

  const fail = evaluateFacebookCompletedSourceCompletion({
    latest: {
      work_lifecycle_status: 'active',
      sync_status: 'success',
      source_complete: 1,
      source_stage: 'complete',
      source_units: incident.expectedUnits,
      content_index: incident.expectedContentCount,
      content_count: incident.expectedContentCount,
      d1_complete: 1,
      lark_complete: 0,
      completion_complete: 0,
      operation_observations: 89,
      target_day_observations: 0,
      active_locks: 1,
    },
  });
  assert.equal(fail.ok, false);
});
