import { createHash } from 'node:crypto';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { createStableQueueOperationBody } from '../../packages/application/src/jobs/queue-operation.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

export const YOUTUBE_LARK_UAT_CONTRACT_VERSION = 'youtube_lark_full_sync_uat_v2';
export const YOUTUBE_LARK_UAT_PHASES = Object.freeze([
  'plan', 'lark-preflight', 'remote-preflight', 'backup', 'deploy-active',
  'verify-active', 'snapshot-before', 'send-full-sync', 'verify-full-sync',
  'resend-same-operation', 'verify-idempotent-rerun', 'restore-all-false',
  'verify-restore', 'summary',
]);
export const YOUTUBE_LARK_UAT_CONFIRMATIONS = deepFreeze(Object.fromEntries(
  YOUTUBE_LARK_UAT_PHASES.filter((phase) => phase !== 'plan').map((phase) => [phase, {
    envName: `CONFIRM_YOUTUBE_LARK_UAT_${phase.toUpperCase().replaceAll('-', '_')}`,
    value: `${phase.toUpperCase().replaceAll('-', '_')}_YOUTUBE_LARK_UAT`,
  }]),
));
export const YOUTUBE_LARK_UAT_ACTIVE_TRUE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_YOUTUBE_ENABLED',
  'MKT_TIME_SERIES_D1_WRITE_ENABLED',
  'MKT_YOUTUBE_END_TO_END_ENABLED',
  'MKT_YOUTUBE_LARK_WRITE_ENABLED',
]);
export const YOUTUBE_LARK_UAT_REQUIRED_TABLE_KEYS = Object.freeze([
  'mktAccounts', 'mktContent', 'mktContentDaily',
  'mktSyncLog', 'mktSystemAlerts',
]);
export const YOUTUBE_LARK_UAT_REQUIRED_POSITIVE_COUNT_KEYS = Object.freeze([
  'mktAccounts', 'mktContent', 'mktContentDaily',
]);

const LARK_ENV_BY_KEY = Object.freeze({
  mktAccounts: 'LARK_TABLE_MKT_ACCOUNTS',
  mktContent: 'LARK_TABLE_MKT_CONTENT',
  mktContentDaily: 'LARK_TABLE_MKT_CONTENT_DAILY',
  mktSyncLog: 'LARK_TABLE_MKT_SYNC_LOG',
  mktSystemAlerts: 'LARK_TABLE_MKT_SYSTEM_ALERTS',
});
const FULL_SHA = /^[0-9a-f]{40}$/u;
const VERSION_ID = /^[0-9a-f-]{36}$/u;
const SAFE_OPERATION_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXPECTED_CRONS = Object.freeze(['*/5 * * * *', '50 0 * * *']);

export function parseYouTubeLarkUatArgs(args = []) {
  let phase = 'plan';
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') execute = true;
    else if (arg.startsWith('--phase=')) phase = arg.slice('--phase='.length);
    else throw uatError(`Unknown YouTube Lark UAT argument: ${arg}`, 'YOUTUBE_LARK_UAT_ARGUMENT_INVALID');
  }
  requirePhase(phase);
  if (phase === 'plan' && execute) {
    throw uatError('Plan phase does not accept --execute', 'YOUTUBE_LARK_UAT_PLAN_EXECUTE_INVALID');
  }
  return Object.freeze({ phase, execute });
}

export function assertYouTubeLarkUatConfirmation(phase, env = {}) {
  requirePhase(phase);
  if (phase === 'plan') return true;
  const expected = YOUTUBE_LARK_UAT_CONFIRMATIONS[phase];
  if (env?.[expected.envName] !== expected.value) {
    throw uatError(
      `YouTube Lark UAT requires ${expected.envName}=${expected.value}`,
      'YOUTUBE_LARK_UAT_CONFIRMATION_REQUIRED',
      { phase, envName: expected.envName },
    );
  }
  return true;
}

export function loadYouTubeLarkUatTarget(env = {}) {
  const operationId = requireOperationId(env.MKT_YOUTUBE_LARK_UAT_OPERATION_ID);
  const originalRequestedAt = requireTimestamp(
    env.MKT_YOUTUBE_LARK_UAT_ORIGINAL_REQUESTED_AT,
    'MKT_YOUTUBE_LARK_UAT_ORIGINAL_REQUESTED_AT',
  );
  const target = {
    repositoryHead: requireSha(env.MKT_YOUTUBE_LARK_UAT_REPOSITORY_HEAD, 'MKT_YOUTUBE_LARK_UAT_REPOSITORY_HEAD'),
    environment: requireExact(env.MKT_ENV, 'development', 'MKT_ENV'),
    customerProfile: requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE'),
    customerKey: requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY'),
    accountKey: requireExact(env.MKT_YOUTUBE_LARK_UAT_ACCOUNT_KEY, 'chemistry_k', 'MKT_YOUTUBE_LARK_UAT_ACCOUNT_KEY'),
    channelId: requireText(env.MKT_YOUTUBE_LARK_UAT_EXPECTED_CHANNEL_ID, 'MKT_YOUTUBE_LARK_UAT_EXPECTED_CHANNEL_ID'),
    workerName: requireExact(env.MKT_YOUTUBE_LARK_UAT_WORKER_NAME ?? 'social-mkt-sync-worker', 'social-mkt-sync-worker', 'MKT_YOUTUBE_LARK_UAT_WORKER_NAME'),
    databaseName: requireExact(env.MKT_YOUTUBE_LARK_UAT_DATABASE_NAME ?? 'social-mkt-state-dev', 'social-mkt-state-dev', 'MKT_YOUTUBE_LARK_UAT_DATABASE_NAME'),
    mainQueueName: requireExact(env.MKT_YOUTUBE_LARK_UAT_MAIN_QUEUE ?? 'social-mkt-sync-jobs', 'social-mkt-sync-jobs', 'MKT_YOUTUBE_LARK_UAT_MAIN_QUEUE'),
    dlqName: requireExact(env.MKT_YOUTUBE_LARK_UAT_DLQ ?? 'social-mkt-sync-dlq', 'social-mkt-sync-dlq', 'MKT_YOUTUBE_LARK_UAT_DLQ'),
    wranglerConfigPath: requireText(env.MKT_YOUTUBE_LARK_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc', 'MKT_YOUTUBE_LARK_UAT_WRANGLER_CONFIG'),
    accountId: optionalText(env.CLOUDFLARE_ACCOUNT_ID),
    queueId: optionalText(env.MKT_YOUTUBE_LARK_UAT_QUEUE_ID),
    operationId,
    workKey: `youtube:${operationId}`,
    syncRunId: `youtube-lark-uat:${operationId}`,
    originalRequestedAt,
    generation: originalRequestedAt,
  };
  return deepFreeze({ ...target, targetFingerprint: sha256(stableJson(target)) });
}

export function buildYouTubeLarkUatConfigWindow(sourceText, input = {}) {
  const source = parseJsoncObject(requireText(sourceText, 'sourceText'));
  validateBaseConfig(source, input);
  const flagNames = Object.keys(source.vars ?? {})
    .filter((name) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)).sort();
  for (const flag of [...YOUTUBE_LARK_UAT_ACTIVE_TRUE_FLAGS, 'MKT_YOUTUBE_ANALYTICS_ENABLED', 'MKT_SCHEDULE_YOUTUBE_ENABLED']) {
    if (!flagNames.includes(flag)) {
      throw uatError(`YouTube Lark UAT source config lacks ${flag}`, 'YOUTUBE_LARK_UAT_CONFIG_FLAG_MISSING', { flag });
    }
  }
  const safe = structuredClone(source);
  safe.workers_dev = false;
  safe.vars = { ...safe.vars, ...Object.fromEntries(flagNames.map((name) => [name, 'false'])) };
  const active = structuredClone(safe);
  for (const flag of YOUTUBE_LARK_UAT_ACTIVE_TRUE_FLAGS) active.vars[flag] = 'true';
  const safeText = `${JSON.stringify(safe, null, 2)}\n`;
  const activeText = `${JSON.stringify(active, null, 2)}\n`;
  const safeTrueFlags = readTrueFlags(safe);
  const activeTrueFlags = readTrueFlags(active);
  const expectedTrueFlags = [...YOUTUBE_LARK_UAT_ACTIVE_TRUE_FLAGS].sort();
  if (safeTrueFlags.length !== 0) throw uatError('Safe YouTube Lark UAT config contains a true flag', 'YOUTUBE_LARK_UAT_SAFE_FLAG_INVALID');
  if (stableJson(activeTrueFlags) !== stableJson(expectedTrueFlags)) {
    throw uatError('Active YouTube Lark UAT config contains an unapproved true flag', 'YOUTUBE_LARK_UAT_ACTIVE_FLAG_INVALID', { activeTrueFlags });
  }
  if (stableJson(normalizeFlagWindow(safe)) !== stableJson(normalizeFlagWindow(active))) {
    throw uatError('YouTube Lark UAT config changes fields outside the approved flag window', 'YOUTUBE_LARK_UAT_CONFIG_DIFF_INVALID');
  }
  const tableIds = Object.freeze(Object.fromEntries(
    Object.entries(LARK_ENV_BY_KEY).map(([key, envName]) => [key, requireRealMapping(source.vars?.[envName], envName)]),
  ));
  const d1 = exactlyOne(source.d1_databases, (item) => item?.binding === 'MKT_STATE_DB', 'MKT_STATE_DB');
  return deepFreeze({
    safeText, activeText,
    safeSha256: sha256(safeText), activeSha256: sha256(activeText),
    safeTrueFlags, activeTrueFlags,
    falseFlagNames: flagNames.filter((name) => !expectedTrueFlags.includes(name)),
    tableIds, tableIdFingerprint: sha256(stableJson(tableIds)),
    databaseId: requireUuid(d1.database_id, 'database_id'),
    databaseName: requireText(d1.database_name, 'database_name'),
    bindingFingerprint: sha256(stableJson({
      d1: { binding: d1.binding, databaseName: d1.database_name, databaseId: d1.database_id },
      queues: source.queues,
      crons: source.triggers?.crons ?? [],
      routes: source.routes ?? [],
      workersDev: source.workers_dev,
    })),
  });
}

export function buildYouTubeLarkFullSyncJob(input = {}) {
  const operationId = requireOperationId(input.operationId);
  const originalRequestedAt = requireTimestamp(input.originalRequestedAt, 'originalRequestedAt');
  const metricDate = bangkokDate(originalRequestedAt);
  if (input.metricDate !== undefined && input.metricDate !== metricDate) {
    throw uatError('YouTube Lark UAT metricDate must match generation in Asia/Bangkok', 'YOUTUBE_LARK_UAT_METRIC_DATE_INVALID', { expectedMetricDate: metricDate });
  }
  return createStableQueueOperationBody({
    schemaVersion: 1,
    type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
    trigger: JOB_TRIGGERS.YOUTUBE_LARK_FULL_SYNC_UAT,
    dryRun: false,
    analyticsEnabled: false,
    metricDate,
    syncMode: 'full',
  }, { operationId, originalRequestedAt });
}

export function buildYouTubeLarkUatSnapshotSql(input = {}) {
  const operationId = sqlText(requireOperationId(input.operationId));
  const workKey = sqlText(requireExact(input.workKey, `youtube:${input.operationId}`, 'workKey'));
  const syncRunId = sqlText(requireExact(input.syncRunId, `youtube-lark-uat:${input.operationId}`, 'syncRunId'));
  return compactSql(`
    WITH storage_ids AS (
      SELECT
        json_extract(completion_json, '$.endToEnd.storage.historySyncRunId') AS history_sync_run_id,
        json_extract(completion_json, '$.endToEnd.storage.contentCoverageRunId') AS content_coverage_run_id,
        json_extract(completion_json, '$.endToEnd.storage.accountCoverageRunId') AS account_coverage_run_id
      FROM sync_work_runs WHERE work_key = '${workKey}' LIMIT 1
    )
    SELECT
      (SELECT status FROM sync_runs WHERE sync_run_id = '${syncRunId}') AS sync_run_status,
      (SELECT finished_at FROM sync_runs WHERE sync_run_id = '${syncRunId}') AS sync_run_finished_at,
      (SELECT error_code FROM sync_runs WHERE sync_run_id = '${syncRunId}') AS sync_run_error_code,
      (SELECT status FROM sync_work_runs WHERE work_key = '${workKey}') AS sync_work_status,
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key = '${workKey}') AS work_lifecycle_status,
      (SELECT completed_at FROM sync_work_runs WHERE work_key = '${workKey}') AS work_completed_at,
      CASE WHEN (SELECT completion_json FROM sync_work_runs WHERE work_key = '${workKey}') IS NULL THEN 0 ELSE 1 END AS completion_json_present,
      CASE WHEN (SELECT history_sync_run_id FROM storage_ids) IS NULL THEN 0 ELSE 1 END AS history_sync_run_id_present,
      CASE WHEN (SELECT content_coverage_run_id FROM storage_ids) IS NULL THEN 0 ELSE 1 END AS content_coverage_run_id_present,
      CASE WHEN (SELECT account_coverage_run_id FROM storage_ids) IS NULL THEN 0 ELSE 1 END AS account_coverage_run_id_present,
      (SELECT COUNT(*) FROM sync_locks WHERE owner_id = '${syncRunId}' AND expires_at > (unixepoch() * 1000)) AS active_lock_count,
      (SELECT COUNT(*) FROM queue_operation_attempts WHERE operation_id = '${operationId}' AND work_key = '${workKey}') AS queue_operation_attempts,
      (SELECT COALESCE(MAX(main_queue_attempts), 0) FROM queue_operation_attempts WHERE operation_id = '${operationId}') AS main_queue_attempts,
      (SELECT COUNT(*) FROM dead_letter_operation_metadata WHERE operation_id = '${operationId}') AS dlq_records,
      COALESCE((SELECT json_extract(details_json, '$.providerRequestCount') FROM sync_runs WHERE sync_run_id = '${syncRunId}'), 0) AS provider_requests,
      (SELECT COUNT(*) FROM organic_content_state WHERE last_sync_run_id = (SELECT history_sync_run_id FROM storage_ids)) AS organic_content_state,
      (SELECT COUNT(*) FROM organic_content_observations WHERE sync_run_id = (SELECT history_sync_run_id FROM storage_ids)) AS organic_content_observations,
      (SELECT COUNT(*) FROM organic_account_daily_facts WHERE sync_run_id = (SELECT history_sync_run_id FROM storage_ids)) AS organic_account_daily_facts,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE coverage_run_id = (SELECT content_coverage_run_id FROM storage_ids) OR coverage_run_id = (SELECT account_coverage_run_id FROM storage_ids)) AS data_coverage_runs,
      (SELECT COUNT(*) FROM data_coverage_entities WHERE coverage_run_id = (SELECT content_coverage_run_id FROM storage_ids)) AS data_coverage_entities,
      (SELECT COUNT(*) FROM sync_cursors WHERE last_sync_run_id = '${syncRunId}' OR generation_work_key = '${workKey}') AS sync_cursors,
      (SELECT COUNT(*) FROM source_record_states WHERE last_seen_sync_run_id = '${syncRunId}') AS source_record_states;
  `);
}

export function normalizeYouTubeLarkUatSnapshot(row = {}) {
  return deepFreeze({
    syncRunStatus: optionalText(readEither(row, 'sync_run_status', 'syncRunStatus')),
    syncRunFinishedAt: optionalRemoteTimestamp(readEither(row, 'sync_run_finished_at', 'syncRunFinishedAt')),
    syncRunErrorCode: optionalText(readEither(row, 'sync_run_error_code', 'syncRunErrorCode')),
    workStatus: optionalText(readEither(row, 'sync_work_status', 'workStatus')),
    workLifecycleStatus: optionalText(readEither(row, 'work_lifecycle_status', 'workLifecycleStatus')),
    workCompletedAt: optionalRemoteTimestamp(readEither(row, 'work_completed_at', 'workCompletedAt')),
    completionJsonPresent: countEither(row, 'completion_json_present', 'completionJsonPresent'),
    historySyncRunIdPresent: countEither(row, 'history_sync_run_id_present', 'historySyncRunIdPresent'),
    contentCoverageRunIdPresent: countEither(row, 'content_coverage_run_id_present', 'contentCoverageRunIdPresent'),
    accountCoverageRunIdPresent: countEither(row, 'account_coverage_run_id_present', 'accountCoverageRunIdPresent'),
    activeLockCount: countEither(row, 'active_lock_count', 'activeLockCount'),
    queueOperationAttempts: countEither(row, 'queue_operation_attempts', 'queueOperationAttempts'),
    mainQueueAttempts: countEither(row, 'main_queue_attempts', 'mainQueueAttempts'),
    dlqRecords: countEither(row, 'dlq_records', 'dlqRecords'),
    providerRequests: countEither(row, 'provider_requests', 'providerRequests'),
    organicContentState: countEither(row, 'organic_content_state', 'organicContentState'),
    organicContentObservations: countEither(row, 'organic_content_observations', 'organicContentObservations'),
    organicAccountDailyFacts: countEither(row, 'organic_account_daily_facts', 'organicAccountDailyFacts'),
    dataCoverageRuns: countEither(row, 'data_coverage_runs', 'dataCoverageRuns'),
    dataCoverageEntities: countEither(row, 'data_coverage_entities', 'dataCoverageEntities'),
    syncCursors: countEither(row, 'sync_cursors', 'syncCursors'),
    sourceRecordStates: countEither(row, 'source_record_states', 'sourceRecordStates'),
  });
}

export function classifyYouTubeLarkUatCompletion(snapshotInput = {}) {
  const snapshot = normalizeYouTubeLarkUatSnapshot(snapshotInput);
  if (snapshot.dlqRecords !== 0) throw uatError('YouTube Lark UAT operation appeared in the DLQ', 'YOUTUBE_LARK_UAT_DLQ_DETECTED');
  if (['failed', 'partial_success', 'skipped'].includes(snapshot.syncRunStatus)) {
    throw uatError('YouTube Lark UAT Sync run reached a terminal non-success status', 'YOUTUBE_LARK_UAT_SYNC_FAILED', {
      status: snapshot.syncRunStatus,
      errorCode: snapshot.syncRunErrorCode,
    });
  }
  const required = {
    syncRunStatus: snapshot.syncRunStatus === 'success',
    syncRunFinishedAt: snapshot.syncRunFinishedAt !== null,
    workLifecycleStatus: snapshot.workLifecycleStatus === 'completed',
    workCompletedAt: snapshot.workCompletedAt !== null,
    completionJsonPresent: snapshot.completionJsonPresent === 1,
    historySyncRunIdPresent: snapshot.historySyncRunIdPresent === 1,
    contentCoverageRunIdPresent: snapshot.contentCoverageRunIdPresent === 1,
    accountCoverageRunIdPresent: snapshot.accountCoverageRunIdPresent === 1,
    activeLockCount: snapshot.activeLockCount === 0,
    mainQueueAttempts: snapshot.mainQueueAttempts >= 1,
    dlqRecords: snapshot.dlqRecords === 0,
    organicContentState: snapshot.organicContentState > 0,
    organicContentObservations: snapshot.organicContentObservations > 0,
    organicAccountDailyFacts: snapshot.organicAccountDailyFacts > 0,
    dataCoverageRuns: snapshot.dataCoverageRuns >= 2,
    dataCoverageEntities: snapshot.dataCoverageEntities > 0,
    syncCursors: snapshot.syncCursors > 0,
    sourceRecordStates: snapshot.sourceRecordStates > 0,
  };
  const missing = Object.entries(required).filter(([, ok]) => !ok).map(([name]) => name);
  return deepFreeze({ complete: missing.length === 0, missing, snapshot });
}

export function classifyYouTubeLarkCounts(counts = {}) {
  const normalized = Object.fromEntries(YOUTUBE_LARK_UAT_REQUIRED_TABLE_KEYS.map((key) => [key, nonNegativeInteger(counts[key] ?? 0, key)]));
  const missingPositive = YOUTUBE_LARK_UAT_REQUIRED_POSITIVE_COUNT_KEYS.filter((key) => normalized[key] <= 0);
  return deepFreeze({ counts: normalized, complete: missingPositive.length === 0, missingPositive, analyticsStoredInD1: true });
}

export function compareYouTubeLarkUatRerun(input = {}) {
  const before = normalizeYouTubeLarkUatSnapshot(input.before ?? {});
  const after = normalizeYouTubeLarkUatSnapshot(input.after ?? {});
  const beforeLark = classifyYouTubeLarkCounts(input.beforeLark ?? {}).counts;
  const afterLark = classifyYouTubeLarkCounts(input.afterLark ?? {}).counts;
  const changedLark = Object.keys(beforeLark).filter((key) => beforeLark[key] !== afterLark[key]);
  const durableFields = [
    'historySyncRunIdPresent', 'contentCoverageRunIdPresent', 'accountCoverageRunIdPresent',
    'organicContentState', 'organicContentObservations', 'organicAccountDailyFacts',
    'dataCoverageRuns', 'dataCoverageEntities', 'syncCursors', 'sourceRecordStates',
  ];
  const changedDurable = durableFields.filter((key) => before[key] !== after[key]);
  if (changedLark.length > 0 || changedDurable.length > 0) {
    throw uatError('YouTube Lark UAT rerun changed stable business counts', 'YOUTUBE_LARK_UAT_IDEMPOTENCY_FAILED', { changedLark, changedDurable });
  }
  if (before.providerRequests <= 0 || after.providerRequests !== 0) {
    throw uatError('YouTube Lark UAT rerun regenerated Provider data', 'YOUTUBE_LARK_UAT_PROVIDER_REPLAY_FAILED', {
      firstRunProviderRequests: before.providerRequests,
      rerunProviderRequests: after.providerRequests,
    });
  }
  if (after.mainQueueAttempts < 2) throw uatError('YouTube Lark UAT rerun was not admitted twice', 'YOUTUBE_LARK_UAT_RERUN_NOT_OBSERVED');
  return deepFreeze({
    idempotent: true,
    providerReplayVerified: true,
    firstRunProviderRequests: before.providerRequests,
    rerunProviderRequests: after.providerRequests,
    changedLark,
    changedDurable,
    mainQueueAttempts: after.mainQueueAttempts,
  });
}

export function createYouTubeLarkUatEvidence(input = {}) {
  const body = {
    contractVersion: YOUTUBE_LARK_UAT_CONTRACT_VERSION,
    phase: requirePhase(input.phase),
    repositoryHead: requireSha(input.repositoryHead, 'repositoryHead'),
    targetFingerprint: requireText(input.targetFingerprint, 'targetFingerprint'),
    operationId: requireOperationId(input.operationId),
    priorEvidenceSha256: input.priorEvidenceSha256 ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    data: input.data ?? {},
  };
  return deepFreeze({ ...body, evidenceSha256: sha256(stableJson(body)) });
}

export function validateYouTubeLarkUatEvidence(evidence, input = {}) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw uatError('YouTube Lark UAT evidence is required', 'YOUTUBE_LARK_UAT_EVIDENCE_INVALID');
  const copy = { ...evidence };
  const observed = copy.evidenceSha256;
  delete copy.evidenceSha256;
  if (observed !== sha256(stableJson(copy))) throw uatError('YouTube Lark UAT evidence SHA is invalid', 'YOUTUBE_LARK_UAT_EVIDENCE_SHA_INVALID');
  requireExact(copy.contractVersion, YOUTUBE_LARK_UAT_CONTRACT_VERSION, 'contractVersion');
  requirePhase(copy.phase);
  requireExact(copy.repositoryHead, input.repositoryHead, 'repositoryHead');
  requireExact(copy.targetFingerprint, input.targetFingerprint, 'targetFingerprint');
  requireExact(copy.operationId, input.operationId, 'operationId');
  return deepFreeze({ ...copy, evidenceSha256: observed });
}

export function evidenceFileForYouTubeLarkUatPhase(phase) {
  return `${requirePhase(phase)}.json`;
}

export function requireVersionId(value, fieldName = 'versionId') {
  const text = requireText(value, fieldName).toLowerCase();
  if (!VERSION_ID.test(text)) throw uatError(`${fieldName} is invalid`, 'YOUTUBE_LARK_UAT_TARGET_INVALID', { fieldName });
  return text;
}

function validateBaseConfig(source, input) {
  requireExact(source.name, 'social-mkt-sync-worker', 'name');
  requireExact(source.vars?.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(source.vars?.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(source.vars?.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  requireExact(source.vars?.YOUTUBE_CHANNEL_ID, requireText(input.channelId, 'channelId'), 'YOUTUBE_CHANNEL_ID');
  if (source.workers_dev !== false) throw uatError('YouTube Lark UAT requires workers_dev=false', 'YOUTUBE_LARK_UAT_WORKERS_DEV_INVALID');
  if (Array.isArray(source.routes) && source.routes.length > 0) throw uatError('YouTube Lark UAT requires no Worker routes', 'YOUTUBE_LARK_UAT_ROUTE_INVALID');
  if (stableJson(source.triggers?.crons ?? []) !== stableJson(EXPECTED_CRONS)) throw uatError('YouTube Lark UAT Cron set differs from the reviewed shared Worker', 'YOUTUBE_LARK_UAT_CRON_INVALID');
  const d1 = exactlyOne(source.d1_databases, (item) => item?.binding === 'MKT_STATE_DB', 'MKT_STATE_DB');
  requireExact(d1.database_name, 'social-mkt-state-dev', 'database_name');
  requireUuid(d1.database_id, 'database_id');
  const producer = exactlyOne(source.queues?.producers, (item) => item?.binding === 'MKT_SYNC_QUEUE', 'MKT_SYNC_QUEUE');
  requireExact(producer.queue, 'social-mkt-sync-jobs', 'producer.queue');
  const main = exactlyOne(source.queues?.consumers, (item) => item?.queue === 'social-mkt-sync-jobs', 'main consumer');
  requireExact(main.dead_letter_queue, 'social-mkt-sync-dlq', 'dead_letter_queue');
  requireInteger(main.max_concurrency, 1, 'main.max_concurrency');
  requireInteger(main.max_batch_size, 10, 'main.max_batch_size');
  requireInteger(main.max_batch_timeout, 30, 'main.max_batch_timeout');
  requireInteger(main.max_retries, 5, 'main.max_retries');
  const dlq = exactlyOne(source.queues?.consumers, (item) => item?.queue === 'social-mkt-sync-dlq', 'dlq consumer');
  requireInteger(dlq.max_concurrency, 1, 'dlq.max_concurrency');
  requireInteger(dlq.max_batch_size, 10, 'dlq.max_batch_size');
  requireInteger(dlq.max_batch_timeout, 30, 'dlq.max_batch_timeout');
  requireInteger(dlq.max_retries, 10, 'dlq.max_retries');
}

function normalizeFlagWindow(config) {
  const copy = structuredClone(config);
  for (const key of Object.keys(copy.vars ?? {})) if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) copy.vars[key] = '<flag>';
  return copy;
}
function readTrueFlags(config) {
  return Object.entries(config.vars ?? {}).filter(([name, value]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && String(value).trim().toLowerCase() === 'true').map(([name]) => name).sort();
}
function readEither(value, snakeName, camelName) {
  return Object.hasOwn(value, snakeName) ? value[snakeName] : value[camelName];
}
function countEither(value, snakeName, camelName) {
  return nonNegativeInteger(readEither(value, snakeName, camelName) ?? 0, camelName);
}
function exactlyOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) throw uatError(`YouTube Lark UAT requires exactly one ${label}`, 'YOUTUBE_LARK_UAT_CONFIG_TOPOLOGY_INVALID', { label, matchCount: matches.length });
  return matches[0];
}
function requirePhase(value) {
  const phase = requireText(value, 'phase');
  if (!YOUTUBE_LARK_UAT_PHASES.includes(phase)) throw uatError(`Invalid YouTube Lark UAT phase: ${phase}`, 'YOUTUBE_LARK_UAT_PHASE_INVALID');
  return phase;
}
function requireOperationId(value) {
  const text = requireText(value, 'operationId').toLowerCase();
  if (!SAFE_OPERATION_ID.test(text)) throw uatError('YouTube Lark UAT operationId is invalid', 'YOUTUBE_LARK_UAT_OPERATION_ID_INVALID');
  return text;
}
function requireSha(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!FULL_SHA.test(text)) throw uatError(`${fieldName} must be a full Git SHA`, 'YOUTUBE_LARK_UAT_TARGET_INVALID', { fieldName });
  return text;
}
function requireUuid(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!UUID.test(text)) throw uatError(`${fieldName} is invalid`, 'YOUTUBE_LARK_UAT_TARGET_INVALID', { fieldName });
  return text;
}
function requireRealMapping(value, fieldName) {
  const text = requireText(value, fieldName);
  if (/replace|placeholder|example|todo|000000/iu.test(text)) throw uatError(`${fieldName} is not a real mapping`, 'YOUTUBE_LARK_UAT_TABLE_MAPPING_INVALID');
  return text;
}
function requireTimestamp(value, fieldName) {
  let number = null;
  if (typeof value === 'number') number = value;
  else if (typeof value === 'string' && /^\d+$/u.test(value.trim())) number = Number(value.trim());
  else if (typeof value === 'string' && value.trim()) number = Date.parse(value.trim());
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) throw uatError(`${fieldName} is invalid`, 'YOUTUBE_LARK_UAT_TIMESTAMP_INVALID', { fieldName });
  return number;
}
function bangkokDate(timestamp) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}
function requireInteger(value, expected, fieldName) {
  if (Number(value) !== expected) throw uatError(`${fieldName} must equal ${expected}`, 'YOUTUBE_LARK_UAT_CONFIG_TOPOLOGY_INVALID', { fieldName });
  return expected;
}
function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw uatError(`${fieldName} must be a non-negative integer`, 'YOUTUBE_LARK_UAT_COUNT_INVALID');
  return number;
}
function requireExact(value, expected, fieldName) {
  const observed = requireText(value, fieldName);
  if (observed !== expected) throw uatError(`${fieldName} must equal ${expected}`, 'YOUTUBE_LARK_UAT_TARGET_INVALID', { fieldName });
  return observed;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw uatError(`${fieldName} is required`, 'YOUTUBE_LARK_UAT_TARGET_INVALID', { fieldName });
  return value.trim();
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function optionalRemoteTimestamp(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  return optionalText(value);
}
function sqlText(value) {
  return String(value).replaceAll("'", "''");
}
function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
function uatError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'YouTubeLarkFullSyncUatError';
  error.code = code;
  if (details !== undefined) error.details = Object.freeze({ ...details });
  return error;
}
