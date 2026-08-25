import { createHash } from 'node:crypto';
import { JOB_SCHEMA_VERSIONS, JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { createStableQueueOperationBody } from '../../packages/application/src/jobs/queue-operation.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

export const CHATWOOT_FINAL_UAT_CONTRACT_VERSION = 'chatwoot_final_30d_daily_uat_v1';
export const CHATWOOT_FINAL_UAT_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_CHATWOOT_FINAL_UAT',
  value: 'EXECUTE_CHATWOOT_30D_DAILY_UAT',
});
export const CHATWOOT_FINAL_UAT_SUCCESS_MARKER = 'CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE';
export const CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BOUNDARY = Object.freeze({
  minimumMainQueueAttempts: 17,
  minimumNextSequence: 2,
  dlqRecords: 8,
  openChatwootAlerts: 14,
});
export const CHATWOOT_FINAL_UAT_QUEUE_EXHAUSTED_RESUME_BOUNDARY = Object.freeze({
  mainQueueAttempts: 25,
  nextSequence: 3,
  dlqRecords: 9,
  openChatwootAlerts: 15,
});
export const CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_CHATWOOT_ENABLED',
  'MKT_CHATWOOT_D1_WRITE_ENABLED',
  'MKT_CHATWOOT_LARK_WRITE_ENABLED',
  'MKT_CHATWOOT_REPORT_WRITE_ENABLED',
]);
export const CHATWOOT_FINAL_UAT_LOCKED_VARS = Object.freeze({
  CHATWOOT_INITIAL_BACKFILL_DAYS: '30',
  CHATWOOT_INCREMENTAL_OVERLAP_DAYS: '3',
  CHATWOOT_SYNC_FREQUENCY: 'daily',
  CHATWOOT_AUTO_EXPAND_BACKFILL: 'false',
  CHATWOOT_INCLUDE_UPDATED_OLDER_CONVERSATIONS: 'true',
  CHATWOOT_CONVERSATION_PAGES_PER_INVOCATION: '1',
  CHATWOOT_CONVERSATION_ROWS_PER_INVOCATION: '1',
  CHATWOOT_REPORTING_PAGES_PER_INVOCATION: '5',
  CHATWOOT_MAX_REPORTING_PAGES: '5000',
});

export const CHATWOOT_FINAL_UAT_TABLES = deepFreeze([
  table('rawChatwootAccounts', 'LARK_TABLE_RAW_CHATWOOT_ACCOUNTS', 'account_state_key', 'chatwoot_account_state'),
  table('rawChatwootInboxes', 'LARK_TABLE_RAW_CHATWOOT_INBOXES', 'inbox_key', 'chatwoot_inbox_state'),
  table('rawChatwootContacts', 'LARK_TABLE_RAW_CHATWOOT_CONTACTS', 'contact_key', 'chatwoot_contact_state'),
  table('rawChatwootAgents', 'LARK_TABLE_RAW_CHATWOOT_AGENTS', 'agent_key', 'chatwoot_agent_state'),
  table('rawChatwootTeams', 'LARK_TABLE_RAW_CHATWOOT_TEAMS', 'team_key', 'chatwoot_team_state'),
  table('rawChatwootLabels', 'LARK_TABLE_RAW_CHATWOOT_LABELS', 'label_key', 'chatwoot_label_state'),
  table('rawChatwootConversations', 'LARK_TABLE_RAW_CHATWOOT_CONVERSATIONS', 'conversation_key', 'chatwoot_conversation_state'),
  table('rawChatwootConversationLabels', 'LARK_TABLE_RAW_CHATWOOT_CONVERSATION_LABELS', 'conversation_label_key', 'chatwoot_conversation_label_state'),
  table('rawChatwootMessageAnalytics', 'LARK_TABLE_RAW_CHATWOOT_MESSAGE_ANALYTICS', 'message_key', 'chatwoot_message_analytics_state'),
  table('rawChatwootReportingEvents', 'LARK_TABLE_RAW_CHATWOOT_REPORTING_EVENTS', 'reporting_event_key', 'chatwoot_reporting_event_facts'),
  table('mktConversations', 'LARK_TABLE_MKT_CONVERSATIONS', 'conversation_key', 'chatwoot_conversation_state'),
  table('mktConversationDaily', 'LARK_TABLE_MKT_CONVERSATION_DAILY', 'conversation_daily_key', 'chatwoot_conversation_daily_facts'),
  table('mktAgentDaily', 'LARK_TABLE_MKT_AGENT_DAILY', 'agent_daily_key', 'chatwoot_agent_daily_facts'),
  table('mktInboxDaily', 'LARK_TABLE_MKT_INBOX_DAILY', 'inbox_daily_key', 'chatwoot_inbox_daily_facts'),
  table('mktConversationAccountDaily', 'LARK_TABLE_MKT_CONVERSATION_ACCOUNT_DAILY', 'account_daily_key', 'chatwoot_account_daily_facts'),
]);

const EXPECTED_CRONS = Object.freeze(['*/5 * * * *', '50 0 * * *']);
const SAFE_OPERATION_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/u;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function assertChatwootFinalUatConfirmation(env = {}) {
  const contract = CHATWOOT_FINAL_UAT_CONFIRMATION;
  if (env?.[contract.envName] !== contract.value) {
    throw uatError(
      `Chatwoot final UAT requires ${contract.envName}=${contract.value}`,
      'CHATWOOT_FINAL_UAT_CONFIRMATION_REQUIRED',
      { envName: contract.envName },
    );
  }
  return true;
}

export function buildChatwootFinalUatConfigWindow(sourceText) {
  const source = parseJsoncObject(requireText(sourceText, 'sourceText'));
  requireExact(source.name, 'social-mkt-sync-worker', 'name');
  requireExact(source.vars?.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(source.vars?.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(source.vars?.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  for (const [name, expected] of Object.entries(CHATWOOT_FINAL_UAT_LOCKED_VARS)) {
    requireExact(String(source.vars?.[name] ?? ''), expected, name);
  }
  requireExact(String(source.vars?.MKT_SCHEDULE_CHATWOOT_ENABLED ?? ''), 'false', 'MKT_SCHEDULE_CHATWOOT_ENABLED');
  requireExact(String(source.vars?.MKT_CHATWOOT_WEBHOOK_ENABLED ?? ''), 'false', 'MKT_CHATWOOT_WEBHOOK_ENABLED');

  const allExecutionFlags = Object.keys(source.vars ?? {})
    .filter((name) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name))
    .sort();
  for (const name of CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS) {
    if (!allExecutionFlags.includes(name)) {
      throw uatError(`Chatwoot UAT config lacks ${name}`, 'CHATWOOT_FINAL_UAT_CONFIG_FLAG_MISSING', { name });
    }
  }

  const safe = structuredClone(source);
  safe.workers_dev = false;
  safe.vars = {
    ...safe.vars,
    ...Object.fromEntries(allExecutionFlags.map((name) => [name, 'false'])),
    ...CHATWOOT_FINAL_UAT_LOCKED_VARS,
    MKT_SCHEDULE_CHATWOOT_ENABLED: 'false',
    MKT_CHATWOOT_WEBHOOK_ENABLED: 'false',
  };
  const active = structuredClone(safe);
  for (const name of CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS) active.vars[name] = 'true';

  const safeTrueFlags = readTrueExecutionFlags(safe);
  const activeTrueFlags = readTrueExecutionFlags(active);
  if (safeTrueFlags.length !== 0) {
    throw uatError('Safe Chatwoot UAT config contains a true execution flag', 'CHATWOOT_FINAL_UAT_SAFE_FLAG_INVALID', { safeTrueFlags });
  }
  if (stableJson(activeTrueFlags) !== stableJson([...CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS].sort())) {
    throw uatError('Active Chatwoot UAT config contains an unapproved true flag', 'CHATWOOT_FINAL_UAT_ACTIVE_FLAG_INVALID', { activeTrueFlags });
  }
  if (stableJson(normalizeFlagWindow(safe)) !== stableJson(normalizeFlagWindow(active))) {
    throw uatError('Chatwoot UAT config changes fields outside the approved flag window', 'CHATWOOT_FINAL_UAT_CONFIG_DIFF_INVALID');
  }

  const d1 = exactlyOne(source.d1_databases, (item) => item?.binding === 'MKT_STATE_DB', 'MKT_STATE_DB');
  requireExact(d1.database_name, 'social-mkt-state-dev', 'database_name');
  const producer = exactlyOne(source.queues?.producers, (item) => item?.binding === 'MKT_SYNC_QUEUE', 'MKT_SYNC_QUEUE producer');
  requireExact(producer.queue, 'social-mkt-sync-jobs', 'producer.queue');
  const mainConsumer = exactlyOne(source.queues?.consumers, (item) => item?.queue === 'social-mkt-sync-jobs', 'main Queue consumer');
  requireExact(mainConsumer.dead_letter_queue, 'social-mkt-sync-dlq', 'main.dead_letter_queue');
  exactlyOne(source.queues?.consumers, (item) => item?.queue === 'social-mkt-sync-dlq', 'DLQ consumer');
  const crons = requireStringArray(source.triggers?.crons ?? [], 'triggers.crons').sort();
  if (stableJson(crons) !== stableJson([...EXPECTED_CRONS].sort())) {
    throw uatError('Chatwoot UAT source Cron set differs from the reviewed Shared Worker', 'CHATWOOT_FINAL_UAT_CRON_INVALID', { crons });
  }

  const tableIds = Object.freeze(Object.fromEntries(CHATWOOT_FINAL_UAT_TABLES.map((spec) => [
    spec.key,
    requireRealMapping(source.vars?.[spec.envName], spec.envName),
  ])));
  const safeText = `${JSON.stringify(safe, null, 2)}\n`;
  const activeText = `${JSON.stringify(active, null, 2)}\n`;
  return deepFreeze({
    safeText,
    activeText,
    safeSha256: sha256(safeText),
    activeSha256: sha256(activeText),
    safeTrueFlags,
    activeTrueFlags,
    allExecutionFlags,
    tableIds,
    tableIdFingerprint: sha256(stableJson(tableIds)),
    workerName: 'social-mkt-sync-worker',
    databaseName: 'social-mkt-state-dev',
    databaseId: requireUuid(d1.database_id, 'database_id'),
    mainQueueName: 'social-mkt-sync-jobs',
    dlqName: 'social-mkt-sync-dlq',
    expectedCrons: EXPECTED_CRONS,
    bindingFingerprint: sha256(stableJson({
      d1: { binding: d1.binding, databaseName: d1.database_name, databaseId: d1.database_id },
      queues: source.queues,
      crons,
      routes: source.routes ?? [],
      workersDev: source.workers_dev,
    })),
  });
}

export function createChatwootFinalUatSession(input = {}) {
  const repositoryHead = requireSha(input.repositoryHead, 'repositoryHead');
  const createdAt = requireTimestamp(input.createdAt ?? Date.now(), 'createdAt');
  const initialRequestedAt = requireTimestamp(input.initialRequestedAt ?? createdAt, 'initialRequestedAt');
  const dailyRequestedAt = requireTimestamp(
    input.dailyRequestedAt ?? Math.max(initialRequestedAt + 1, createdAt + 1),
    'dailyRequestedAt',
  );
  if (dailyRequestedAt <= initialRequestedAt) {
    throw uatError('Daily operation must have a newer generation than Initial UAT', 'CHATWOOT_FINAL_UAT_SESSION_INVALID');
  }
  const suffix = repositoryHead.slice(0, 12);
  const initialOperationId = requireOperationId(
    input.initialOperationId ?? `chatwoot-initial-30d-${initialRequestedAt}-${suffix}`,
  );
  const dailyOperationId = requireOperationId(
    input.dailyOperationId ?? `chatwoot-daily-3d-${dailyRequestedAt}-${suffix}`,
  );
  const session = {
    contractVersion: CHATWOOT_FINAL_UAT_CONTRACT_VERSION,
    repositoryHead,
    createdAt,
    initial: operationIdentity('initial', initialOperationId, initialRequestedAt),
    daily: operationIdentity('daily', dailyOperationId, dailyRequestedAt),
  };
  return deepFreeze({ ...session, sessionFingerprint: sha256(stableJson(session)) });
}

export function buildChatwootFinalUatJob(operation = {}) {
  const trigger = operation.mode === 'initial'
    ? JOB_TRIGGERS.CHATWOOT_INITIAL_30_DAY_UAT
    : operation.mode === 'daily'
      ? JOB_TRIGGERS.CHATWOOT_DAILY_INCREMENTAL
      : null;
  if (!trigger) throw uatError('Chatwoot operation mode is invalid', 'CHATWOOT_FINAL_UAT_OPERATION_INVALID');
  return createStableQueueOperationBody({
    schemaVersion: JOB_SCHEMA_VERSIONS.CHATWOOT_RUNTIME,
    type: JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC,
    trigger,
    accountKey: 'chemistry_k',
    continuationSequence: 0,
    dryRun: false,
  }, {
    operationId: requireOperationId(operation.operationId),
    originalRequestedAt: requireTimestamp(operation.originalRequestedAt, 'originalRequestedAt'),
  });
}

export function buildChatwootFinalUatPreflightSql(input = {}) {
  const accountKey = sqlText(requireExact(input.accountKey ?? 'chemistry_k', 'chemistry_k', 'accountKey'));
  const priorOperationRange = sqlPrefixRange('operation_id', 'chatwoot-');
  const tableNameRange = sqlPrefixRange('name', 'chatwoot_');
  const indexNameRange = sqlPrefixRange('name', 'idx_chatwoot_');
  const businessCounts = uniqueD1Tables().map((name) => (
    `(SELECT COUNT(*) FROM ${name} WHERE account_key = '${accountKey}') AS ${name}`
  )).join(', ');
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sync_work_runs WHERE work_type = 'chatwoot.conversations.sync' AND lifecycle_status = 'active') AS active_chatwoot_work,
      (SELECT COUNT(*) FROM sync_locks WHERE lock_key = 'chatwoot:chemistry_k:analytics' AND expires_at > unixepoch('now') * 1000) AS active_chatwoot_locks,
      (SELECT COUNT(*) FROM queue_operation_attempts WHERE ${priorOperationRange}) AS prior_chatwoot_operations,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND ${tableNameRange}) AS chatwoot_table_count,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND ${indexNameRange}) AS chatwoot_index_count,
      ${businessCounts};
  `);
}

export function buildChatwootFinalUatSnapshotSql(operation = {}) {
  const operationId = sqlText(requireOperationId(operation.operationId));
  const workKey = sqlText(requireExact(operation.workKey, `chatwoot:chemistry_k:${operation.operationId}`, 'workKey'));
  const rawSyncRunId = requireExact(operation.syncRunId, `chatwoot:chemistry_k:${operation.operationId}`, 'syncRunId');
  const syncRunId = sqlText(rawSyncRunId);
  const unitSyncRunRange = sqlPrefixRange('sync_run_id', `${rawSyncRunId}:unit:`);
  const requestedAt = requireTimestamp(operation.originalRequestedAt, 'originalRequestedAt');
  const counts = CHATWOOT_FINAL_UAT_TABLES.map((spec) => (
    `(SELECT COUNT(*) FROM ${spec.d1Table} WHERE account_key = 'chemistry_k') AS ${spec.key}`
  )).join(', ');
  return compactSql(`
    SELECT
      (SELECT lifecycle_status FROM sync_work_runs WHERE work_key = '${workKey}') AS work_lifecycle_status,
      (SELECT completed_at FROM sync_work_runs WHERE work_key = '${workKey}') AS work_completed_at,
      CASE WHEN (SELECT completion_json FROM sync_work_runs WHERE work_key = '${workKey}') IS NULL THEN 0 ELSE 1 END AS completion_json_present,
      (SELECT json_extract(completion_json, '$.status') FROM sync_work_runs WHERE work_key = '${workKey}') AS completion_status,
      (SELECT json_extract(completion_json, '$.syncRunId') FROM sync_work_runs WHERE work_key = '${workKey}') AS completion_sync_run_id,
      (SELECT json_extract(completion_json, '$.reconciliation.mode') FROM sync_work_runs WHERE work_key = '${workKey}') AS completion_mode,
      (SELECT json_extract(completion_json, '$.reconciliation.windowStartAt') FROM sync_work_runs WHERE work_key = '${workKey}') AS window_start_at,
      (SELECT json_extract(completion_json, '$.reconciliation.windowEndAt') FROM sync_work_runs WHERE work_key = '${workKey}') AS window_end_at,
      COALESCE((SELECT json_extract(completion_json, '$.reconciliation.automaticBackfillExpansion') FROM sync_work_runs WHERE work_key = '${workKey}'), 0) AS automatic_backfill_expansion,
      COALESCE((SELECT json_extract(completion_json, '$.reconciliation.includeUpdatedOlderConversations') FROM sync_work_runs WHERE work_key = '${workKey}'), 0) AS include_updated_older_conversations,
      COALESCE((SELECT json_extract(completion_json, '$.reconciliation.conversationPagesProcessed') FROM sync_work_runs WHERE work_key = '${workKey}'), 0) AS conversation_pages_processed,
      COALESCE((SELECT json_extract(completion_json, '$.reconciliation.reportingPagesProcessed') FROM sync_work_runs WHERE work_key = '${workKey}'), 0) AS reporting_pages_processed,
      COALESCE((SELECT json_extract(completion_json, '$.reconciliation.rollupPagesProcessed') FROM sync_work_runs WHERE work_key = '${workKey}'), 0) AS rollup_pages_processed,
      COALESCE((SELECT json_extract(completion_json, '$.reconciliation.checkpointComplete') FROM sync_work_runs WHERE work_key = '${workKey}'), 0) AS checkpoint_complete,
      (SELECT json_extract(state_json, '$.stage') FROM sync_work_phases WHERE work_key = '${workKey}' AND phase = 'chatwoot_runtime_30d_daily_v1') AS active_stage,
      COALESCE((SELECT json_extract(state_json, '$.nextSequence') FROM sync_work_phases WHERE work_key = '${workKey}' AND phase = 'chatwoot_runtime_30d_daily_v1'), 0) AS active_next_sequence,
      COALESCE((SELECT json_extract(state_json, '$.conversationPagesProcessed') FROM sync_work_phases WHERE work_key = '${workKey}' AND phase = 'chatwoot_runtime_30d_daily_v1'), 0) AS active_conversation_pages,
      COALESCE((SELECT json_extract(state_json, '$.reportingPagesProcessed') FROM sync_work_phases WHERE work_key = '${workKey}' AND phase = 'chatwoot_runtime_30d_daily_v1'), 0) AS active_reporting_pages,
      COALESCE((SELECT json_extract(state_json, '$.rollupPagesProcessed') FROM sync_work_phases WHERE work_key = '${workKey}' AND phase = 'chatwoot_runtime_30d_daily_v1'), 0) AS active_rollup_pages,
      (SELECT COUNT(*) FROM sync_locks WHERE lock_key = 'chatwoot:chemistry_k:analytics' AND expires_at > unixepoch('now') * 1000) AS active_lock_count,
      COALESCE((SELECT MAX(main_queue_attempts) FROM queue_operation_attempts WHERE operation_id = '${operationId}' AND work_key = '${workKey}'), 0) AS main_queue_attempts,
      (SELECT COUNT(*) FROM sync_runs WHERE ${unitSyncRunRange}) AS unit_sync_runs,
      (SELECT COUNT(*) FROM sync_runs WHERE ${unitSyncRunRange} AND status IN ('failed', 'partial_success')) AS failed_unit_sync_runs,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE ${unitSyncRunRange}) AS coverage_runs,
      (SELECT COUNT(*) FROM data_coverage_runs WHERE ${unitSyncRunRange} AND failed_rows > 0) AS failed_coverage_runs,
      (SELECT COALESCE(SUM(failed_rows), 0) FROM data_coverage_runs WHERE ${unitSyncRunRange}) AS failed_coverage_rows,
      (SELECT COUNT(*) FROM dead_letter_operation_metadata WHERE operation_id = '${operationId}') AS dlq_records,
      (SELECT COUNT(*) FROM system_alerts WHERE platform = 'chatwoot' AND status = 'open' AND created_at >= ${requestedAt}) AS open_chatwoot_alerts,
      (SELECT sync_type FROM sync_cursors WHERE cursor_key = 'chatwoot:chemistry_k:analytics') AS cursor_sync_type,
      (SELECT last_full_sync_at FROM sync_cursors WHERE cursor_key = 'chatwoot:chemistry_k:analytics') AS cursor_last_full_sync_at,
      (SELECT last_successful_sync_at FROM sync_cursors WHERE cursor_key = 'chatwoot:chemistry_k:analytics') AS cursor_last_successful_sync_at,
      (SELECT incremental_run_count FROM sync_cursors WHERE cursor_key = 'chatwoot:chemistry_k:analytics') AS cursor_incremental_run_count,
      (SELECT last_sync_run_id FROM sync_cursors WHERE cursor_key = 'chatwoot:chemistry_k:analytics') AS cursor_last_sync_run_id,
      (SELECT generation FROM sync_cursors WHERE cursor_key = 'chatwoot:chemistry_k:analytics') AS cursor_generation,
      (SELECT generation_work_key FROM sync_cursors WHERE cursor_key = 'chatwoot:chemistry_k:analytics') AS cursor_generation_work_key,
      (SELECT requested_at FROM sync_cursors WHERE cursor_key = 'chatwoot:chemistry_k:analytics') AS cursor_requested_at,
      ${counts};
  `);
}

export function normalizeChatwootFinalUatPreflight(row = {}) {
  const businessCounts = Object.fromEntries(uniqueD1Tables().map((name) => [
    name,
    count(row[name], name),
  ]));
  return deepFreeze({
    activeChatwootWork: count(row.active_chatwoot_work, 'active_chatwoot_work'),
    activeChatwootLocks: count(row.active_chatwoot_locks, 'active_chatwoot_locks'),
    priorChatwootOperations: count(row.prior_chatwoot_operations, 'prior_chatwoot_operations'),
    chatwootTableCount: count(row.chatwoot_table_count, 'chatwoot_table_count'),
    chatwootIndexCount: count(row.chatwoot_index_count, 'chatwoot_index_count'),
    businessCounts,
  });
}

export function assertChatwootFinalUatPreflight(snapshot = {}, options = {}) {
  const totalBusinessRows = Object.values(snapshot.businessCounts ?? {}).reduce((sum, value) => sum + count(value, 'businessCount'), 0);
  const expectedActiveWork = count(options.expectedActiveWork ?? 0, 'expectedActiveWork');
  if (snapshot.activeChatwootWork !== expectedActiveWork || snapshot.activeChatwootLocks !== 0
      || snapshot.chatwootTableCount !== 14 || snapshot.chatwootIndexCount !== 15) {
    throw uatError('Remote D1 is not a valid Chatwoot Initial-UAT target', 'CHATWOOT_FINAL_UAT_PREFLIGHT_BLOCKED', {
      activeChatwootWork: snapshot.activeChatwootWork,
      activeChatwootLocks: snapshot.activeChatwootLocks,
      chatwootTableCount: snapshot.chatwootTableCount,
      chatwootIndexCount: snapshot.chatwootIndexCount,
      totalBusinessRows,
    });
  }
  return Object.freeze({ ...snapshot, totalBusinessRows });
}

export function mapChatwootFinalUatD1BaselineCounts(businessCounts = {}) {
  return deepFreeze(Object.fromEntries(CHATWOOT_FINAL_UAT_TABLES.map((spec) => [
    spec.key,
    count(businessCounts?.[spec.d1Table], spec.d1Table),
  ])));
}

export function assertChatwootFinalUatBaselineCompatible(d1Counts = {}, larkCounts = {}) {
  const d1 = normalizeChatwootFinalUatLogicalCounts(d1Counts, 'd1');
  const lark = normalizeChatwootFinalUatLogicalCounts(larkCounts, 'lark');
  const larkExcess = CHATWOOT_FINAL_UAT_TABLES
    .filter((spec) => lark[spec.key] > d1[spec.key])
    .map((spec) => ({
      tableKey: spec.key,
      d1Rows: d1[spec.key],
      larkRows: lark[spec.key],
    }));
  if (larkExcess.length > 0) {
    throw uatError(
      'Lark Chatwoot baseline contains rows that are not present in D1',
      'CHATWOOT_FINAL_UAT_BASELINE_MISMATCH',
      { larkExcess },
    );
  }
  return deepFreeze({
    d1Counts: d1,
    larkCounts: lark,
    d1Rows: Object.values(d1).reduce((sum, value) => sum + value, 0),
    larkRows: Object.values(lark).reduce((sum, value) => sum + value, 0),
  });
}

export function assertChatwootFinalUatBaselinePreserved(
  baselineCounts = {},
  currentCounts = {},
  label = 'baseline',
) {
  const baseline = normalizeChatwootFinalUatLogicalCounts(
    baselineCounts,
    `${label}:baseline`,
  );
  const current = normalizeChatwootFinalUatLogicalCounts(
    currentCounts,
    `${label}:current`,
  );
  const decreases = CHATWOOT_FINAL_UAT_TABLES
    .filter((spec) => current[spec.key] < baseline[spec.key])
    .map((spec) => ({
      tableKey: spec.key,
      baselineRows: baseline[spec.key],
      currentRows: current[spec.key],
    }));
  if (decreases.length > 0) {
    throw uatError(
      'Chatwoot Final UAT reduced an existing business baseline',
      'CHATWOOT_FINAL_UAT_BASELINE_REGRESSION',
      { label, decreases },
    );
  }
  return deepFreeze({ accepted: true, label, baseline, current });
}

/**
 * Accept only the one already-admitted Initial operation after the local controller stopped.
 * The ordinary boundary is poll-only. The exact retry-exhausted boundary may send one reviewed
 * same-Work continuation after guarded reactivation; it never authorizes another Initial admission.
 */
export function assertChatwootFinalUatControllerResume(snapshot = {}, operation = {}) {
  const boundary = CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BOUNDARY;
  const exhausted = CHATWOOT_FINAL_UAT_QUEUE_EXHAUSTED_RESUME_BOUNDARY;
  const expectedWorkKey = `chatwoot:chemistry_k:${requireOperationId(operation.operationId)}`;
  requireExact(operation.mode, 'initial', 'operation.mode');
  requireExact(operation.workKey, expectedWorkKey, 'operation.workKey');
  requireExact(operation.syncRunId, expectedWorkKey, 'operation.syncRunId');
  requireTimestamp(operation.originalRequestedAt, 'operation.originalRequestedAt');
  const active = snapshot.workLifecycleStatus === 'active';
  const completed = snapshot.workLifecycleStatus === 'completed';
  const terminal = snapshot.workLifecycleStatus === 'terminal';
  const queueExhausted = (active || terminal || completed)
    && snapshot.mainQueueAttempts === exhausted.mainQueueAttempts
    && snapshot.dlqRecords === exhausted.dlqRecords
    && snapshot.openChatwootAlerts === exhausted.openChatwootAlerts
    && snapshot.failedCoverageRuns === 0
    && snapshot.failedCoverageRows === 0
    && snapshot.failedUnitSyncRuns === 0
    && (terminal || completed || snapshot.activeNextSequence === exhausted.nextSequence);
  const invalid = [];
  if (!queueExhausted) {
    if (!active && !completed) invalid.push('work_lifecycle');
    if (snapshot.mainQueueAttempts < boundary.minimumMainQueueAttempts) invalid.push('queue_attempts');
    if (snapshot.dlqRecords !== boundary.dlqRecords) invalid.push('dlq_records');
    if (snapshot.openChatwootAlerts !== boundary.openChatwootAlerts) invalid.push('open_alerts');
    if (snapshot.failedCoverageRuns !== 0 || snapshot.failedCoverageRows !== 0) {
      invalid.push('coverage_failure');
    }
    if (active && snapshot.activeNextSequence < boundary.minimumNextSequence) invalid.push('durable_sequence');
    if (active && snapshot.failedUnitSyncRuns !== 0) invalid.push('failed_unit');
  }
  if (invalid.length > 0) {
    throw uatError(
      'Chatwoot controller resume boundary drifted',
      'CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BLOCKED',
      { invalid },
    );
  }
  return deepFreeze({
    accepted: true,
    pollOnly: !queueExhausted,
    queueSend: queueExhausted && active,
    replaceActiveDeployment: queueExhausted,
    boundary: queueExhausted ? 'queue_retry_exhausted_terminal_v1' : 'controller_interrupted_v1',
    minimumAttempts: snapshot.mainQueueAttempts,
    lifecycle: snapshot.workLifecycleStatus,
  });
}

export function assertChatwootFinalUatResumeIdentity(current = {}, retained = {}) {
  for (const field of [
    'operationId', 'workKey', 'syncRunId', 'originalRequestedAt', 'generation',
  ]) {
    if (current?.[field] !== retained?.[field]) {
      throw uatError(
        'Chatwoot controller resume session identity drifted',
        'CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BLOCKED',
        { field },
      );
    }
  }
  if (!['initial', 'daily'].includes(current.mode) || current.mode !== retained.mode) {
    throw uatError(
      'Chatwoot controller resume session mode drifted',
      'CHATWOOT_FINAL_UAT_CONTROLLER_RESUME_BLOCKED',
    );
  }
  return true;
}

function normalizeChatwootFinalUatLogicalCounts(values = {}, label = 'counts') {
  return deepFreeze(Object.fromEntries(CHATWOOT_FINAL_UAT_TABLES.map((spec) => [
    spec.key,
    count(values?.[spec.key], `${label}:${spec.key}`),
  ])));
}

export function normalizeChatwootFinalUatSnapshot(row = {}) {
  const d1Counts = Object.fromEntries(CHATWOOT_FINAL_UAT_TABLES.map((spec) => [
    spec.key,
    count(row[spec.key], spec.key),
  ]));
  return deepFreeze({
    workLifecycleStatus: optionalText(row.work_lifecycle_status),
    workCompletedAt: nullableTimestamp(row.work_completed_at, 'work_completed_at'),
    completionJsonPresent: count(row.completion_json_present, 'completion_json_present'),
    completionStatus: optionalText(row.completion_status),
    completionSyncRunId: optionalText(row.completion_sync_run_id),
    completionMode: optionalText(row.completion_mode),
    windowStartAt: nullableTimestamp(row.window_start_at, 'window_start_at'),
    windowEndAt: nullableTimestamp(row.window_end_at, 'window_end_at'),
    automaticBackfillExpansion: booleanCount(row.automatic_backfill_expansion, 'automatic_backfill_expansion'),
    includeUpdatedOlderConversations: booleanCount(row.include_updated_older_conversations, 'include_updated_older_conversations'),
    conversationPagesProcessed: count(row.conversation_pages_processed, 'conversation_pages_processed'),
    reportingPagesProcessed: count(row.reporting_pages_processed, 'reporting_pages_processed'),
    rollupPagesProcessed: count(row.rollup_pages_processed, 'rollup_pages_processed'),
    checkpointComplete: booleanCount(row.checkpoint_complete, 'checkpoint_complete'),
    activeStage: optionalText(row.active_stage),
    activeNextSequence: count(row.active_next_sequence, 'active_next_sequence'),
    activeConversationPages: count(row.active_conversation_pages, 'active_conversation_pages'),
    activeReportingPages: count(row.active_reporting_pages, 'active_reporting_pages'),
    activeRollupPages: count(row.active_rollup_pages, 'active_rollup_pages'),
    activeLockCount: count(row.active_lock_count, 'active_lock_count'),
    mainQueueAttempts: count(row.main_queue_attempts, 'main_queue_attempts'),
    unitSyncRuns: count(row.unit_sync_runs, 'unit_sync_runs'),
    failedUnitSyncRuns: count(row.failed_unit_sync_runs, 'failed_unit_sync_runs'),
    coverageRuns: count(row.coverage_runs, 'coverage_runs'),
    failedCoverageRuns: count(row.failed_coverage_runs, 'failed_coverage_runs'),
    failedCoverageRows: count(row.failed_coverage_rows, 'failed_coverage_rows'),
    dlqRecords: count(row.dlq_records, 'dlq_records'),
    openChatwootAlerts: count(row.open_chatwoot_alerts, 'open_chatwoot_alerts'),
    cursorSyncType: optionalText(row.cursor_sync_type),
    cursorLastFullSyncAt: nullableTimestamp(row.cursor_last_full_sync_at, 'cursor_last_full_sync_at'),
    cursorLastSuccessfulSyncAt: nullableTimestamp(row.cursor_last_successful_sync_at, 'cursor_last_successful_sync_at'),
    cursorIncrementalRunCount: count(row.cursor_incremental_run_count, 'cursor_incremental_run_count'),
    cursorLastSyncRunId: optionalText(row.cursor_last_sync_run_id),
    cursorGeneration: nullableTimestamp(row.cursor_generation, 'cursor_generation'),
    cursorGenerationWorkKey: optionalText(row.cursor_generation_work_key),
    cursorRequestedAt: nullableTimestamp(row.cursor_requested_at, 'cursor_requested_at'),
    d1Counts,
  });
}

export function classifyChatwootFinalUatCompletion(snapshot = {}, operation = {}, options = {}) {
  const requestedAt = requireTimestamp(operation.originalRequestedAt, 'originalRequestedAt');
  const days = operation.mode === 'initial' ? 30 : operation.mode === 'daily' ? 3 : null;
  const expectedMode = operation.mode === 'initial' ? 'initial_30_day_uat' : 'daily_incremental';
  const expectedSyncRunId = requireExact(operation.syncRunId, `chatwoot:chemistry_k:${operation.operationId}`, 'syncRunId');
  const missing = [];
  if (snapshot.workLifecycleStatus !== 'completed') missing.push('work_completed');
  if (snapshot.completionJsonPresent !== 1) missing.push('completion_json');
  if (!['completed', 'completed_replay'].includes(snapshot.completionStatus)) missing.push('completion_status');
  if (snapshot.completionSyncRunId !== expectedSyncRunId) missing.push('completion_sync_run_id');
  if (snapshot.completionMode !== expectedMode) missing.push('completion_mode');
  if (snapshot.windowEndAt !== requestedAt || snapshot.windowStartAt !== requestedAt - days * 86_400_000) missing.push('immutable_window');
  if (snapshot.automaticBackfillExpansion !== false) missing.push('automatic_expansion_disabled');
  if (snapshot.includeUpdatedOlderConversations !== true) missing.push('updated_older_conversations');
  if (snapshot.checkpointComplete !== true) missing.push('checkpoint_complete');
  if (snapshot.activeLockCount !== 0) missing.push('zero_active_lock');
  if (snapshot.failedUnitSyncRuns !== 0) missing.push('zero_failed_unit_sync');
  if (snapshot.failedCoverageRuns !== 0 || snapshot.failedCoverageRows !== 0) missing.push('zero_failed_coverage');
  const allowedDlqRecords = count(options.allowedDlqRecords ?? 0, 'allowedDlqRecords');
  const allowedOpenAlerts = count(options.allowedOpenAlerts ?? 0, 'allowedOpenAlerts');
  if (snapshot.dlqRecords !== allowedDlqRecords
      || snapshot.openChatwootAlerts !== allowedOpenAlerts) missing.push('terminal_incident_boundary');
  if (snapshot.mainQueueAttempts < 2 || snapshot.unitSyncRuns < 2) missing.push('bounded_multi_unit_runtime');
  if (snapshot.cursorLastSyncRunId !== expectedSyncRunId
      || snapshot.cursorGeneration !== requestedAt
      || snapshot.cursorGenerationWorkKey !== operation.workKey
      || snapshot.cursorRequestedAt !== requestedAt) missing.push('cursor_identity');
  if (operation.mode === 'initial' && snapshot.cursorLastFullSyncAt !== requestedAt) missing.push('initial_full_checkpoint');
  if (operation.mode === 'daily' && snapshot.cursorSyncType !== 'daily_incremental') missing.push('daily_cursor_type');
  return deepFreeze({
    complete: missing.length === 0,
    missing,
    snapshot,
    businessFingerprint: businessFingerprint(snapshot),
    cursorFingerprint: cursorFingerprint(snapshot),
  });
}

export function compareChatwootFinalUatReplay(before = {}, after = {}) {
  const problems = [];
  if (after.mainQueueAttempts <= before.mainQueueAttempts) problems.push('queue_attempt_not_increased');
  if (businessFingerprint(after) !== businessFingerprint(before)) problems.push('business_drift');
  if (coverageFingerprint(after) !== coverageFingerprint(before)) problems.push('coverage_drift');
  if (cursorFingerprint(after) !== cursorFingerprint(before)) problems.push('cursor_drift');
  if (after.workLifecycleStatus !== 'completed') problems.push('work_not_completed');
  if (problems.length > 0) {
    throw uatError('Chatwoot same-operation replay is not idempotent', 'CHATWOOT_FINAL_UAT_REPLAY_INVALID', { problems });
  }
  return Object.freeze({
    accepted: true,
    attemptsBefore: before.mainQueueAttempts,
    attemptsAfter: after.mainQueueAttempts,
    businessFingerprint: businessFingerprint(after),
    coverageFingerprint: coverageFingerprint(after),
    cursorFingerprint: cursorFingerprint(after),
  });
}

export function compareChatwootD1LarkParity(d1Counts = {}, larkCounts = {}) {
  const mismatches = [];
  for (const spec of CHATWOOT_FINAL_UAT_TABLES) {
    const d1 = count(d1Counts[spec.key], `d1.${spec.key}`);
    const lark = count(larkCounts[spec.key], `lark.${spec.key}`);
    if (d1 !== lark) mismatches.push({ tableKey: spec.key, d1, lark });
  }
  if (mismatches.length > 0) {
    throw uatError('Chatwoot D1/Lark parity mismatch', 'CHATWOOT_FINAL_UAT_PARITY_MISMATCH', { mismatches });
  }
  return Object.freeze({
    exact: true,
    tableCount: CHATWOOT_FINAL_UAT_TABLES.length,
    countFingerprint: sha256(stableJson(d1Counts)),
    totalRows: Object.values(d1Counts).reduce((sum, value) => sum + count(value, 'd1Count'), 0),
  });
}

export function sanitizeChatwootFinalProgress(snapshot = {}) {
  return Object.freeze({
    lifecycle: snapshot.workLifecycleStatus,
    stage: snapshot.activeStage,
    nextSequence: snapshot.activeNextSequence,
    conversationPages: snapshot.activeConversationPages || snapshot.conversationPagesProcessed,
    reportingPages: snapshot.activeReportingPages || snapshot.reportingPagesProcessed,
    rollupPages: snapshot.activeRollupPages || snapshot.rollupPagesProcessed,
    mainQueueAttempts: snapshot.mainQueueAttempts,
    unitSyncRuns: snapshot.unitSyncRuns,
    coverageRuns: snapshot.coverageRuns,
    completed: snapshot.workLifecycleStatus === 'completed',
  });
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function operationIdentity(mode, operationId, originalRequestedAt) {
  return Object.freeze({
    mode,
    operationId,
    workKey: `chatwoot:chemistry_k:${operationId}`,
    syncRunId: `chatwoot:chemistry_k:${operationId}`,
    originalRequestedAt,
    generation: originalRequestedAt,
  });
}

function table(key, envName, stableKeyField, d1Table) {
  return Object.freeze({ key, envName, stableKeyField, d1Table });
}

function uniqueD1Tables() {
  return [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((spec) => spec.d1Table))];
}

function businessFingerprint(snapshot) {
  return sha256(stableJson(snapshot.d1Counts ?? {}));
}
function coverageFingerprint(snapshot) {
  return sha256(stableJson({
    coverageRuns: snapshot.coverageRuns,
    failedCoverageRuns: snapshot.failedCoverageRuns,
    failedCoverageRows: snapshot.failedCoverageRows,
  }));
}
function cursorFingerprint(snapshot) {
  return sha256(stableJson({
    cursorSyncType: snapshot.cursorSyncType,
    cursorLastFullSyncAt: snapshot.cursorLastFullSyncAt,
    cursorLastSuccessfulSyncAt: snapshot.cursorLastSuccessfulSyncAt,
    cursorIncrementalRunCount: snapshot.cursorIncrementalRunCount,
    cursorLastSyncRunId: snapshot.cursorLastSyncRunId,
    cursorGeneration: snapshot.cursorGeneration,
    cursorGenerationWorkKey: snapshot.cursorGenerationWorkKey,
    cursorRequestedAt: snapshot.cursorRequestedAt,
  }));
}

function normalizeFlagWindow(config) {
  const clone = structuredClone(config);
  for (const name of CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS) clone.vars[name] = '<window>';
  return clone;
}
function readTrueExecutionFlags(config) {
  return Object.entries(config.vars ?? {})
    .filter(([name, value]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && readBoolean(value, name))
    .map(([name]) => name).sort();
}
function readBoolean(value, fieldName) {
  if (value === true || value === false) return value;
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text === 'true') return true;
  if (text === 'false') return false;
  throw uatError(`${fieldName} must be true or false`, 'CHATWOOT_FINAL_UAT_CONFIG_BOOLEAN_INVALID', { fieldName });
}
function requireRealMapping(value, fieldName) {
  const text = requireText(value, fieldName);
  if (/replace-with|placeholder|example|^tbl_[0-9]+$/iu.test(text)) {
    throw uatError(`${fieldName} is not a real reviewed mapping`, 'CHATWOOT_FINAL_UAT_TABLE_MAPPING_INVALID', { fieldName });
  }
  return text;
}
function exactlyOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) {
    throw uatError(`Chatwoot UAT requires exactly one ${label}`, 'CHATWOOT_FINAL_UAT_TOPOLOGY_INVALID', { label, matchCount: matches.length });
  }
  return matches[0];
}
function requireStringArray(value, fieldName) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw uatError(`${fieldName} must be a string array`, 'CHATWOOT_FINAL_UAT_CONFIG_INVALID', { fieldName });
  }
  return value.map((item) => item.trim());
}
function requireOperationId(value) {
  const text = requireText(value, 'operationId').toLowerCase();
  if (!SAFE_OPERATION_ID.test(text)) throw uatError('Chatwoot operationId has an unsafe format', 'CHATWOOT_FINAL_UAT_OPERATION_INVALID');
  return text;
}
function requireSha(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!FULL_SHA.test(text)) throw uatError(`${fieldName} must be a full Git SHA`, 'CHATWOOT_FINAL_UAT_SHA_INVALID', { fieldName });
  return text;
}
function requireUuid(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!UUID.test(text)) throw uatError(`${fieldName} must be a UUID`, 'CHATWOOT_FINAL_UAT_CONFIG_INVALID', { fieldName });
  return text;
}
function requireTimestamp(value, fieldName) {
  const number = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2020, 0, 1)) {
    throw uatError(`${fieldName} must be a valid timestamp`, 'CHATWOOT_FINAL_UAT_TIMESTAMP_INVALID', { fieldName });
  }
  return number;
}
function nullableTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw uatError(`${fieldName} must be a timestamp or null`, 'CHATWOOT_FINAL_UAT_REMOTE_VALUE_INVALID', { fieldName });
  return number;
}
function count(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw uatError(`${fieldName} must be a non-negative integer`, 'CHATWOOT_FINAL_UAT_REMOTE_VALUE_INVALID', { fieldName });
  return number;
}
function booleanCount(value, fieldName) {
  const number = Number(value ?? 0);
  if (number === 0) return false;
  if (number === 1) return true;
  throw uatError(`${fieldName} must be 0 or 1`, 'CHATWOOT_FINAL_UAT_REMOTE_VALUE_INVALID', { fieldName });
}
function requireExact(value, expected, fieldName) {
  if (value !== expected) throw uatError(`${fieldName} must equal ${expected}`, 'CHATWOOT_FINAL_UAT_TARGET_INVALID', { fieldName });
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw uatError(`${fieldName} is required`, 'CHATWOOT_FINAL_UAT_INPUT_REQUIRED', { fieldName });
  return value.trim();
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function sqlText(value) {
  return String(value).replaceAll("'", "''");
}
function sqlPrefixRange(columnName, prefixValue) {
  const column = requireSqlIdentifier(columnName);
  const prefix = requireText(prefixValue, 'prefixValue');
  if (!/^[a-z0-9:_-]+$/u.test(prefix)) {
    throw uatError('SQL prefix contains unsupported characters', 'CHATWOOT_FINAL_UAT_SQL_PREFIX_INVALID');
  }
  const lastCode = prefix.charCodeAt(prefix.length - 1);
  if (!Number.isSafeInteger(lastCode) || lastCode >= 0x7f) {
    throw uatError('SQL prefix cannot form a bounded upper range', 'CHATWOOT_FINAL_UAT_SQL_PREFIX_INVALID');
  }
  const upper = `${prefix.slice(0, -1)}${String.fromCharCode(lastCode + 1)}`;
  return `${column} >= '${sqlText(prefix)}' AND ${column} < '${sqlText(upper)}'`;
}
function requireSqlIdentifier(value) {
  const text = requireText(value, 'sqlIdentifier');
  if (!/^[a-z_][a-z0-9_]*$/u.test(text)) {
    throw uatError('SQL identifier has an unsafe format', 'CHATWOOT_FINAL_UAT_SQL_PREFIX_INVALID');
  }
  return text;
}
function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
function uatError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootFinalUatError';
  error.code = code;
  error.details = details;
  return error;
}
