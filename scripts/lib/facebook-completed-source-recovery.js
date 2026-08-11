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

const MIN_RECOVERY_TIMESTAMP = Date.UTC(2000, 0, 1);
const REQUIRED_TRUE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_FACEBOOK_ENABLED',
  'MKT_META_SOURCE_READ_ENABLED',
  'MKT_META_D1_WRITE_ENABLED',
  'MKT_META_LARK_WRITE_ENABLED',
]);

const REQUIRED_FALSE_FLAGS = Object.freeze([
  'MKT_DLQ_REDRIVE_ENABLED',
]);

const PRESERVED_SCHEDULE_FLAGS = Object.freeze([
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

  for (const flag of REQUIRED_TRUE_FLAGS) requireBooleanFlag(source.vars?.[flag], true, flag);
  for (const flag of REQUIRED_FALSE_FLAGS) requireBooleanFlag(source.vars?.[flag], false, flag);
  for (const flag of PRESERVED_SCHEDULE_FLAGS) requireBooleanFlagValue(source.vars?.[flag], flag);

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
  const next = { ...validated.source };
  const retainedRedriveValue = validated.source.vars.MKT_DLQ_REDRIVE_ENABLED;
  next.vars = {
    ...next.vars,
    MKT_DLQ_REDRIVE_ENABLED: typeof retainedRedriveValue === 'boolean'
      ? redriveEnabled
      : (redriveEnabled ? 'true' : 'false'),
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
  expectSameTimestamp(errors, work.generation, work.requested_at, 'work generation/requested_at');

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
  expectSameTimestamp(errors, queueOperation.generation, work.generation, 'queue operation generation');
  expectSameTimestamp(
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
  expectSameTimestamp(errors, deadLetter.metadata_generation, work.generation, 'dead letter metadata generation');
  expectSameTimestamp(
    errors,
    deadLetter.metadata_original_requested_at,
    work.requested_at,
    'dead letter metadata original_requested_at',
  );
  expect(errors, deadLetter.replay_type, incident.jobType, 'dead letter replay type');
  expect(errors, deadLetter.replay_operation_id, incident.operationId, 'dead letter replay operationId');
  expect(errors, deadLetter.replay_work_key, incident.workKey, 'dead letter replay workKey');
  expectSameTimestamp(errors, deadLetter.replay_generation, work.generation, 'dead letter replay generation');
  expectSameTimestamp(
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
    generation: Number.isSafeInteger(generation) && generation >= MIN_RECOVERY_TIMESTAMP ? generation : null,
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
  expect(errors, latest.sync_error_code ?? null, null, 'sync error');
  expect(errors, Number(latest.active_locks ?? 0), 0, 'active lock count after completion');

  const completion = parseCompletionEvidence(latest.completion_json ?? latest.completion, errors);
  if (completion) {
    validateDurableCompletionEvidence({ incident, latest, completion, errors });
  } else {
    validateLegacyPhaseCompletion({ incident, latest, errors });
  }

  const summary = completion ? buildDurableCompletionSummary(latest, completion) : null;
  return Object.freeze({
    ok: errors.length === 0,
    status: errors.length === 0
      ? 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_COMPLETE'
      : 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_INCOMPLETE',
    errors: Object.freeze(errors.map((row) => Object.freeze(row))),
    summary,
  });
}

function validateLegacyPhaseCompletion({ incident, latest, errors }) {
  expect(errors, Number(latest.source_complete), 1, 'source complete');
  expect(errors, latest.source_stage, 'complete', 'source stage');
  expect(errors, Number(latest.source_units), incident.expectedUnits, 'source unit count');
  expect(errors, Number(latest.content_index), incident.expectedContentCount, 'content index');
  expect(errors, Number(latest.content_count), incident.expectedContentCount, 'content count');
  expect(errors, Number(latest.d1_complete), 1, 'D1 complete');
  expect(errors, Number(latest.lark_complete), 1, 'Lark complete');
  expect(errors, Number(latest.completion_complete), 1, 'completion complete');
}

function validateDurableCompletionEvidence({ incident, latest, completion, errors }) {
  expect(errors, completion.schemaVersion, 'meta_end_to_end_reconciliation_v1', 'completion schema');
  expect(errors, completion.operationId, incident.operationId, 'completion operation id');
  expect(errors, completion.connectorKey, 'facebook', 'completion connector');
  expect(errors, Number(completion.failed), 0, 'completion failed count');

  const source = objectOrEmpty(completion.source);
  expect(errors, Number(source.sourceContentRows), incident.expectedContentCount, 'completion source content rows');
  expect(errors, Number(source.rawContentRows), incident.expectedContentCount, 'completion raw content rows');
  expect(errors, Number(source.contentInsightEntities), incident.expectedContentCount, 'completion content insight entities');
  expect(errors, source.sourceStatus, 'complete', 'completion source status');
  requirePositive(errors, source.contentDailyRows, 'completion content daily rows');
  requirePositive(errors, source.accountDailyRows, 'completion account daily rows');

  const d1 = objectOrEmpty(completion.d1);
  const expectedOperations = nonNegativeOrNull(d1.expectedOperations);
  const processedOperations = nonNegativeOrNull(d1.processedOperations);
  if (expectedOperations === null || processedOperations === null || expectedOperations !== processedOperations) {
    errors.push({
      field: 'completion D1 operations',
      expected: 'processedOperations === expectedOperations',
      actual: { expectedOperations: d1.expectedOperations ?? null, processedOperations: d1.processedOperations ?? null },
    });
  }

  const history = objectOrEmpty(d1.organicHistory);
  const historyContentRows = nonNegativeOrNull(history.contentRows);
  const contentDailyRows = nonNegativeOrNull(source.contentDailyRows);
  if (historyContentRows === null || contentDailyRows === null || historyContentRows !== contentDailyRows) {
    errors.push({
      field: 'completion organic history/content daily parity',
      expected: contentDailyRows,
      actual: history.contentRows ?? null,
    });
  }
  if (historyContentRows !== null) {
    expectSum(errors, [history.stateWritten, history.stateSkipped], historyContentRows, 'completion organic state rows');
    expectSum(
      errors,
      [history.observationsCreated, history.observationsSkipped, history.observationsNotRequired],
      historyContentRows,
      'completion organic observation accounting',
    );
    expectSum(
      errors,
      [history.coverageEntitiesWritten, history.coverageEntitiesSkipped],
      historyContentRows,
      'completion organic coverage entities',
    );
  }

  const lark = Array.isArray(completion.lark) ? completion.lark : [];
  if (lark.length === 0) {
    errors.push({ field: 'completion Lark reconciliation', expected: '> 0 tables', actual: 0 });
  }
  for (const row of lark) {
    const expected = nonNegativeOrNull(row?.expected);
    if (expected === null) {
      errors.push({ field: `completion Lark ${row?.tableKey ?? 'unknown'}`, expected: 'valid expected count', actual: row?.expected ?? null });
      continue;
    }
    expectSum(
      errors,
      [row?.created, row?.updated, row?.skipped],
      expected,
      `completion Lark ${row?.tableKey ?? 'unknown'}`,
    );
  }

  expect(errors, latest.dead_letter_status, 'redriven', 'dead letter status after recovery');
  if (Number(latest.queue_attempts ?? 0) <= incident.expectedUnits) {
    errors.push({
      field: 'Queue attempts after recovery',
      expected: `> ${incident.expectedUnits}`,
      actual: latest.queue_attempts ?? null,
    });
  }
  requireTimestampEvidence(errors, latest.work_completed_at, 'work completed_at');

  if (historyContentRows !== null) {
    validateCoverageEvidence({
      errors,
      prefix: 'content coverage',
      status: latest.content_coverage_status,
      syncRunId: latest.content_coverage_sync_run_id,
      expectedEntities: latest.content_coverage_expected_entities,
      observedEntities: latest.content_coverage_observed_entities,
      expectedRows: latest.content_coverage_expected_rows,
      observedRows: latest.content_coverage_observed_rows,
      writtenRows: latest.content_coverage_written_rows,
      failedRows: latest.content_coverage_failed_rows,
      expectedCount: historyContentRows,
      incident,
    });
  }

  const accountDailyRows = nonNegativeOrNull(source.accountDailyRows);
  if (accountDailyRows !== null) {
    validateCoverageEvidence({
      errors,
      prefix: 'account coverage',
      status: latest.account_coverage_status,
      syncRunId: latest.account_coverage_sync_run_id,
      expectedEntities: latest.account_coverage_expected_entities,
      observedEntities: latest.account_coverage_observed_entities,
      expectedRows: latest.account_coverage_expected_rows,
      observedRows: latest.account_coverage_observed_rows,
      writtenRows: latest.account_coverage_written_rows,
      failedRows: latest.account_coverage_failed_rows,
      expectedCount: accountDailyRows,
      incident,
    });
    expect(errors, Number(latest.account_daily_rows ?? 0), accountDailyRows, 'account daily D1 rows');
  }
  if (Number(latest.target_day_account_daily_rows ?? 0) <= 0) {
    errors.push({
      field: 'target-day account daily D1 rows',
      expected: '> 0',
      actual: latest.target_day_account_daily_rows ?? null,
    });
  }
}

function validateCoverageEvidence(input) {
  expect(input.errors, input.status, 'complete', `${input.prefix} status`);
  expect(input.errors, input.syncRunId, input.incident.syncRunId, `${input.prefix} sync_run_id`);
  expect(input.errors, Number(input.expectedEntities), input.expectedCount, `${input.prefix} expected entities`);
  expect(input.errors, Number(input.observedEntities), input.expectedCount, `${input.prefix} observed entities`);
  expect(input.errors, Number(input.expectedRows), input.expectedCount, `${input.prefix} expected rows`);
  expect(input.errors, Number(input.observedRows), input.expectedCount, `${input.prefix} observed rows`);
  expect(input.errors, Number(input.writtenRows), input.expectedCount, `${input.prefix} written rows`);
  expect(input.errors, Number(input.failedRows), 0, `${input.prefix} failed rows`);
}

function buildDurableCompletionSummary(latest, completion) {
  const source = objectOrEmpty(completion.source);
  const d1 = objectOrEmpty(completion.d1);
  const history = objectOrEmpty(d1.organicHistory);
  const lark = Array.isArray(completion.lark) ? completion.lark : [];
  return Object.freeze({
    sourceContentRows: Number(source.sourceContentRows ?? 0),
    contentDailyRows: Number(source.contentDailyRows ?? 0),
    accountDailyRows: Number(source.accountDailyRows ?? 0),
    d1ExpectedOperations: Number(d1.expectedOperations ?? 0),
    d1ProcessedOperations: Number(d1.processedOperations ?? 0),
    organicHistoryContentRows: Number(history.contentRows ?? 0),
    larkTableCount: lark.length,
    operationObservations: Number(latest.operation_observations ?? 0),
    targetDayAccountDailyRows: Number(latest.target_day_account_daily_rows ?? 0),
    queueAttempts: Number(latest.queue_attempts ?? 0),
  });
}

function parseCompletionEvidence(value, errors) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push({ field: 'durable completion_json', expected: 'retained reconciliation object', actual: value ?? null });
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('not an object');
    return parsed;
  } catch {
    errors.push({ field: 'durable completion_json', expected: 'valid reconciliation JSON object', actual: '<invalid>' });
    return null;
  }
}

function expectSum(errors, values, expected, field) {
  const normalized = values.map(nonNegativeOrNull);
  if (normalized.some((value) => value === null)) {
    errors.push({ field, expected, actual: values });
    return;
  }
  const actual = normalized.reduce((sum, value) => sum + value, 0);
  expect(errors, actual, expected, field);
}

function requirePositive(errors, value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    errors.push({ field, expected: '> 0', actual: value ?? null });
  }
}

function requireTimestampEvidence(errors, value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < MIN_RECOVERY_TIMESTAMP) {
    errors.push({ field, expected: 'valid completion timestamp', actual: value ?? null });
  }
}

function nonNegativeOrNull(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function normalizeBooleanFlag(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function requireBooleanFlagValue(actual, fieldName) {
  if (normalizeBooleanFlag(actual) === null) {
    throw contractError(`Unexpected ${fieldName}`, 'FACEBOOK_RECOVERY_CONFIG_INVALID', {
      fieldName,
      expected: 'boolean true/false',
      actual: actual ?? null,
    });
  }
}

function requireBooleanFlag(actual, expected, fieldName) {
  const normalized = normalizeBooleanFlag(actual);
  if (normalized !== expected) {
    throw contractError(`Unexpected ${fieldName}`, 'FACEBOOK_RECOVERY_CONFIG_INVALID', {
      fieldName,
      expected: expected ? 'true' : 'false',
      actual: actual ?? null,
    });
  }
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

function expectSameTimestamp(errors, left, right, field) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isSafeInteger(leftNumber)
    || !Number.isSafeInteger(rightNumber)
    || leftNumber < MIN_RECOVERY_TIMESTAMP
    || rightNumber < MIN_RECOVERY_TIMESTAMP
    || leftNumber !== rightNumber) {
    errors.push({
      field,
      expected: Number.isSafeInteger(rightNumber) && rightNumber >= MIN_RECOVERY_TIMESTAMP
        ? rightNumber
        : 'valid timestamp identity',
      actual: Number.isSafeInteger(leftNumber) && leftNumber >= MIN_RECOVERY_TIMESTAMP
        ? leftNumber
        : left ?? null,
    });
  }
}

function contractError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
