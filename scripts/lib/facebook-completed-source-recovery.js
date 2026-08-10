import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

export const FACEBOOK_COMPLETED_SOURCE_INCIDENT = Object.freeze({
  contractVersion: 'facebook_completed_source_recovery_v1',
  requiredMainSha: 'df401ddf914a82c8cd1a616832f8e011376edea5',
  operationId: 'facebook-dashboard-repair-20260809-v1',
  workKey: 'facebook:facebook-dashboard-repair-20260809-v1',
  syncRunId: 'meta:facebook:facebook:facebook-dashboard-repair-20260809-v1',
  jobType: 'facebook.page.organic.sync',
  sourcePhase: 'meta_end_to_end_source_staging_v1',
  d1Phase: 'meta_end_to_end_d1_write_v1',
  larkPhase: 'meta_end_to_end_lark_write_v1',
  completionPhase: 'meta_end_to_end_completion_v1',
  sourceScope: 'facebook_daily_dashboard_lookback_v1',
  scopeStartSequence: 82,
  expectedUnits: 173,
  expectedScopedRows: 91,
  expectedContentCount: 89,
  periodStart: '2026-08-09',
  periodEnd: '2026-08-09',
  expectedFailureCode: 'META_END_TO_END_SOURCE_STAGING_INCOMPLETE',
  mainQueueName: 'social-mkt-sync-jobs',
  workerName: 'social-mkt-sync-worker',
  customerProfile: 'integration_workspace',
  customerKey: 'chemistry_k',
});

const REQUIRED_TRUE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_FACEBOOK_ENABLED',
  'MKT_META_SOURCE_READ_ENABLED',
  'MKT_META_D1_WRITE_ENABLED',
  'MKT_META_LARK_WRITE_ENABLED',
]);

const REQUIRED_FALSE_FLAGS = Object.freeze([
  'MKT_DLQ_REDRIVE_ENABLED',
  'MKT_SCHEDULE_FACEBOOK_ENABLED',
  'MKT_SCHEDULE_INSTAGRAM_ENABLED',
]);

export function validateFacebookRecoveryWranglerConfig(sourceText) {
  const source = parseJsoncObject(sourceText);
  const incident = FACEBOOK_COMPLETED_SOURCE_INCIDENT;
  requireEqual(source.name, incident.workerName, 'name');
  requireEqual(source.vars?.MKT_ENV, 'development', 'MKT_ENV');
  requireEqual(source.vars?.MKT_CUSTOMER_PROFILE, incident.customerProfile, 'MKT_CUSTOMER_PROFILE');
  requireEqual(
    source.vars?.MKT_CONNECTION_CUSTOMER_KEY,
    incident.customerKey,
    'MKT_CONNECTION_CUSTOMER_KEY',
  );

  for (const flag of REQUIRED_TRUE_FLAGS) requireEqual(source.vars?.[flag], 'true', flag);
  for (const flag of REQUIRED_FALSE_FLAGS) requireEqual(source.vars?.[flag], 'false', flag);

  const d1 = exactlyOne(
    source.d1_databases,
    (item) => item?.binding === 'MKT_STATE_DB',
    'MKT_STATE_DB binding',
  );
  const databaseId = requireText(d1.database_id, 'MKT_STATE_DB.database_id');
  const databaseName = requireText(d1.database_name, 'MKT_STATE_DB.database_name');

  const producer = exactlyOne(
    source.queues?.producers,
    (item) => item?.binding === 'MKT_SYNC_QUEUE',
    'MKT_SYNC_QUEUE producer',
  );
  requireEqual(producer.queue, incident.mainQueueName, 'MKT_SYNC_QUEUE.queue');

  const mainConsumer = exactlyOne(
    source.queues?.consumers,
    (item) => item?.queue === incident.mainQueueName,
    'main Queue consumer',
  );
  requireEqual(mainConsumer.max_concurrency, 1, 'main Queue max_concurrency');
  requireEqual(mainConsumer.max_retries, 5, 'main Queue max_retries');
  requireEqual(mainConsumer.dead_letter_queue, 'social-mkt-sync-dlq', 'main Queue dead_letter_queue');

  return Object.freeze({
    source,
    databaseId,
    databaseName,
    workerName: incident.workerName,
    mainQueueName: incident.mainQueueName,
    executionFlags: Object.freeze({
      facebook: source.vars.MKT_CONNECTOR_FACEBOOK_ENABLED,
      sourceRead: source.vars.MKT_META_SOURCE_READ_ENABLED,
      d1Write: source.vars.MKT_META_D1_WRITE_ENABLED,
      larkWrite: source.vars.MKT_META_LARK_WRITE_ENABLED,
      redrive: source.vars.MKT_DLQ_REDRIVE_ENABLED,
      facebookSchedule: source.vars.MKT_SCHEDULE_FACEBOOK_ENABLED,
      instagramSchedule: source.vars.MKT_SCHEDULE_INSTAGRAM_ENABLED,
    }),
  });
}

export function buildFacebookRecoveryWranglerConfig(sourceText, redriveEnabled) {
  const validated = validateFacebookRecoveryWranglerConfig(sourceText);
  if (typeof redriveEnabled !== 'boolean') {
    throw contractError('redriveEnabled must be boolean', 'FACEBOOK_RECOVERY_CONFIG_INVALID');
  }
  const next = structuredClone(validated.source);
  next.vars = {
    ...next.vars,
    MKT_DLQ_REDRIVE_ENABLED: redriveEnabled ? 'true' : 'false',
  };
  const changed = changedLeafPaths(validated.source, next);
  const allowed = ['vars.MKT_DLQ_REDRIVE_ENABLED'];
  if (changed.length !== 1 || changed[0] !== allowed[0]) {
    throw contractError('Recovery config changed fields outside the redrive gate', 'FACEBOOK_RECOVERY_CONFIG_DRIFT', {
      changed,
    });
  }
  return Object.freeze({
    text: `${JSON.stringify(next, null, 2)}\n`,
    changed: Object.freeze(changed),
    redriveEnabled,
  });
}

export function evaluateFacebookCompletedSourcePreflight(input = {}) {
  const incident = FACEBOOK_COMPLETED_SOURCE_INCIDENT;
  const errors = [];
  const work = input.work ?? {};
  const source = input.source ?? {};
  const phases = input.phases ?? {};
  const observations = input.observations ?? {};
  const queueOperation = input.queueOperation ?? {};
  const deadLetters = Array.isArray(input.deadLetters) ? input.deadLetters : [];
  const scopedSequences = Array.isArray(input.scopedSequences)
    ? input.scopedSequences.map(Number).filter(Number.isSafeInteger)
    : [];

  expect(errors, work.work_key, incident.workKey, 'work.work_key');
  expect(errors, work.lifecycle_status, 'terminal', 'work.lifecycle_status');
  expect(errors, work.completed_at ?? null, null, 'work.completed_at');
  expect(errors, work.terminal_reason, 'QUEUE_PERMANENT_FAILURE', 'work.terminal_reason');
  expectSameSafeInteger(errors, work.generation, work.requested_at, 'work generation/requested_at');

  expect(errors, Number(source.complete), 1, 'source.complete');
  expect(errors, source.stage, 'complete', 'source.stage');
  expect(errors, Number(source.unit_count), incident.expectedUnits, 'source.unit_count');
  expect(errors, Number(source.content_index), incident.expectedContentCount, 'source.content_index');
  expect(errors, Number(source.content_count), incident.expectedContentCount, 'source.content_count');
  expect(errors, source.scope, incident.sourceScope, 'source.scope');
  expect(errors, Number(source.scope_start_sequence), incident.scopeStartSequence, 'source.scope_start_sequence');

  expect(errors, Number(phases.d1_complete ?? 0), 0, 'd1 phase must be incomplete');
  expect(errors, Number(phases.lark_complete ?? 0), 0, 'lark phase must be incomplete');
  expect(errors, Number(phases.completion_complete ?? 0), 0, 'completion phase must be incomplete');
  expect(errors, Number(observations.operation_observations ?? 0), 0, 'operation observations before recovery');
  expect(errors, Number(observations.target_day_observations ?? 0), 0, 'target-day observations before recovery');
  expect(errors, Number(input.activeLockCount ?? 0), 0, 'active lock count');

  expect(errors, queueOperation.operation_id, incident.operationId, 'queue operation id');
  expect(errors, queueOperation.work_key, incident.workKey, 'queue operation work_key');
  expectSameSafeInteger(errors, queueOperation.generation, work.generation, 'queue operation generation');
  expectSameSafeInteger(
    errors,
    queueOperation.original_requested_at,
    work.requested_at,
    'queue operation original_requested_at',
  );
  expect(errors, Number(queueOperation.main_queue_attempts), incident.expectedUnits, 'main Queue attempts');

  const sequenceSet = new Set(scopedSequences);
  const missing = [];
  for (let sequence = incident.scopeStartSequence; sequence < incident.expectedUnits; sequence += 1) {
    if (!sequenceSet.has(sequence)) missing.push(sequence);
  }
  if (sequenceSet.size !== incident.expectedScopedRows || missing.length > 0) {
    errors.push({
      field: 'physical scoped staging',
      expected: `${incident.expectedScopedRows} contiguous rows`,
      actual: { distinct: sequenceSet.size, missing: missing.slice(0, 20) },
    });
  }

  if (deadLetters.length !== 1) {
    errors.push({ field: 'dead letter count', expected: 1, actual: deadLetters.length });
  }
  const deadLetter = deadLetters[0] ?? {};
  expect(errors, deadLetter.status, 'open', 'dead letter status');
  expect(errors, deadLetter.job_type, incident.jobType, 'dead letter job_type');
  expect(errors, deadLetter.error_code, incident.expectedFailureCode, 'dead letter error_code');
  expect(errors, deadLetter.metadata_operation_id, incident.operationId, 'dead letter metadata operation_id');
  expect(errors, deadLetter.metadata_work_key, incident.workKey, 'dead letter metadata work_key');
  expectSameSafeInteger(errors, deadLetter.metadata_generation, work.generation, 'dead letter metadata generation');
  expectSameSafeInteger(
    errors,
    deadLetter.metadata_original_requested_at,
    work.requested_at,
    'dead letter metadata original_requested_at',
  );
  expect(errors, deadLetter.replay_type, incident.jobType, 'dead letter replay type');
  expect(errors, deadLetter.replay_operation_id, incident.operationId, 'dead letter replay operationId');
  expect(errors, deadLetter.replay_work_key, incident.workKey, 'dead letter replay workKey');
  expectSameSafeInteger(errors, deadLetter.replay_generation, work.generation, 'dead letter replay generation');
  expectSameSafeInteger(
    errors,
    deadLetter.replay_original_requested_at,
    work.requested_at,
    'dead letter replay originalRequestedAt',
  );
  expect(errors, deadLetter.replay_period_start, incident.periodStart, 'dead letter replay periodStart');
  expect(errors, deadLetter.replay_period_end, incident.periodEnd, 'dead letter replay periodEnd');

  const generation = Number(work.generation);
  return Object.freeze({
    ok: errors.length === 0,
    status: errors.length === 0
      ? 'FACEBOOK_COMPLETED_SOURCE_REDRIVE_PREFLIGHT_PASS'
      : 'FACEBOOK_COMPLETED_SOURCE_REDRIVE_PREFLIGHT_BLOCKED',
    errors: Object.freeze(errors.map((row) => Object.freeze(row))),
    deadLetterId: deadLetter.dlq_id ?? null,
    generation: Number.isSafeInteger(generation) ? generation : null,
    scopedRows: sequenceSet.size,
    missingScopedSequences: Object.freeze(missing),
  });
}

export function evaluateFacebookCompletedSourceCompletion(input = {}) {
  const incident = FACEBOOK_COMPLETED_SOURCE_INCIDENT;
  const latest = input.latest ?? {};
  const errors = [];
  expect(errors, latest.work_lifecycle_status, 'completed', 'work lifecycle');
  expect(errors, latest.sync_status, 'success', 'sync status');
  expect(errors, Number(latest.source_complete), 1, 'source complete');
  expect(errors, latest.source_stage, 'complete', 'source stage');
  expect(errors, Number(latest.source_units), incident.expectedUnits, 'source unit count');
  expect(errors, Number(latest.content_index), incident.expectedContentCount, 'content index');
  expect(errors, Number(latest.content_count), incident.expectedContentCount, 'content count');
  expect(errors, Number(latest.d1_complete), 1, 'D1 complete');
  expect(errors, Number(latest.lark_complete), 1, 'Lark complete');
  expect(errors, Number(latest.completion_complete), 1, 'completion complete');
  if (Number(latest.operation_observations ?? 0) <= 0) {
    errors.push({ field: 'operation observations', expected: '> 0', actual: latest.operation_observations ?? null });
  }
  if (Number(latest.target_day_observations ?? 0) <= 0) {
    errors.push({ field: 'target-day observations', expected: '> 0', actual: latest.target_day_observations ?? null });
  }
  expect(errors, Number(latest.active_locks ?? 0), 0, 'active lock count after completion');

  return Object.freeze({
    ok: errors.length === 0,
    status: errors.length === 0
      ? 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_COMPLETE'
      : 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_INCOMPLETE',
    errors: Object.freeze(errors.map((row) => Object.freeze(row))),
  });
}

function changedLeafPaths(left, right, prefix = '') {
  if (Object.is(left, right)) return [];
  if (!isPlainObject(left) || !isPlainObject(right)) return [prefix || '<root>'];
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changed = [];
  for (const key of [...keys].sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    changed.push(...changedLeafPaths(left[key], right[key], path));
  }
  return changed;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactlyOne(values, predicate, fieldName) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) {
    throw contractError(`Expected exactly one ${fieldName}`, 'FACEBOOK_RECOVERY_CONFIG_INVALID', {
      fieldName,
      count: matches.length,
    });
  }
  return matches[0];
}

function requireEqual(actual, expected, fieldName) {
  if (actual !== expected) {
    throw contractError(`Unexpected ${fieldName}`, 'FACEBOOK_RECOVERY_CONFIG_INVALID', {
      fieldName,
      expected,
      actual: actual ?? null,
    });
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw contractError(`${fieldName} is required`, 'FACEBOOK_RECOVERY_CONFIG_INVALID', { fieldName });
  }
  return value.trim();
}

function expect(errors, actual, expected, field) {
  if (!Object.is(actual, expected)) errors.push({ field, expected, actual: actual ?? null });
}

function expectSameSafeInteger(errors, left, right, field) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isSafeInteger(leftNumber)
    || !Number.isSafeInteger(rightNumber)
    || leftNumber !== rightNumber) {
    errors.push({
      field,
      expected: Number.isSafeInteger(rightNumber) ? rightNumber : 'safe integer identity',
      actual: Number.isSafeInteger(leftNumber) ? leftNumber : left ?? null,
    });
  }
}

function contractError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
