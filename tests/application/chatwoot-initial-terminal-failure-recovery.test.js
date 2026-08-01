import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CHATWOOT_FINAL_UAT_TABLES,
  createChatwootFinalUatSession,
} from '../../scripts/lib/chatwoot-final-30d-daily-uat.js';
import {
  parseChatwootWranglerJsonOutput,
} from '../../scripts/lib/chatwoot-final-source-config-recovery.js';
import {
  CHATWOOT_INITIAL_RECOVERY_BOUNDARIES,
  assertChatwootInitialFailureInspectorConfirmation,
  buildChatwootCurrentIncidentClosureSql,
  buildChatwootInitialFailureReactivationSql,
  buildChatwootInitialRecoveryContinuationJob,
  buildChatwootInitialFailureCandidateSql,
  buildChatwootInitialFailureInspectorSql,
  classifyChatwootInitialRecoveryBoundary,
  isChatwootInitialFailureCandidateAdmitted,
  normalizeChatwootInitialFailureInspection,
  sanitizeFailureDetails,
  selectLatestIncompleteChatwootSession,
} from '../../scripts/lib/chatwoot-initial-terminal-failure-recovery.js';

const HEAD = 'a'.repeat(40);

function session(createdAt = 1_800_000_000_000) {
  return createChatwootFinalUatSession({
    repositoryHead: HEAD,
    createdAt,
    initialRequestedAt: createdAt,
    dailyRequestedAt: createdAt + 1_000,
  });
}

test('Wrangler JSON parser accepts progress-prefixed object and array output', () => {
  assert.deepEqual(parseChatwootWranglerJsonOutput(
    '├ Checking...\n[{"results":[{"ok":1}]}]\n',
  ), [{ results: [{ ok: 1 }] }]);
  assert.deepEqual(parseChatwootWranglerJsonOutput(
    'progress {not-json}\n{"bindings":[]}',
  ), { bindings: [] });
});

test('inspector confirmation and latest admitted incomplete session are fail closed', () => {
  assert.throws(
    () => assertChatwootInitialFailureInspectorConfirmation({}),
    (error) => error?.code === 'CHATWOOT_INITIAL_FAILURE_INSPECTOR_CONFIRMATION_REQUIRED',
  );
  const older = session(1_800_000_000_000);
  const latest = session(1_800_000_001_000);
  const selected = selectLatestIncompleteChatwootSession([
    { path: '/older/session.json', session: older, hasInitialSendAttempt: true, hasAcceptedSummary: false },
    { path: '/latest/session.json', session: latest, hasInitialSendAttempt: true, hasAcceptedSummary: false },
    { path: '/completed/session.json', session: session(1_800_000_002_000), hasInitialSendAttempt: true, hasAcceptedSummary: true },
  ]);
  assert.equal(selected.path, '/latest/session.json');
  assert.equal(selected.session.initial.operationId, latest.initial.operationId);
  const canonical = selectLatestIncompleteChatwootSession([
    { path: '/copy/session.json', session: latest, hasInitialSendAttempt: true, hasAcceptedSummary: false },
    { path: `/evidence/${HEAD}/session.json`, session: latest, hasInitialSendAttempt: true, hasAcceptedSummary: false },
  ]);
  assert.equal(canonical.path, `/evidence/${HEAD}/session.json`);
  const conflicting = createChatwootFinalUatSession({
    repositoryHead: 'b'.repeat(40),
    createdAt: latest.createdAt,
    initialRequestedAt: latest.createdAt,
    dailyRequestedAt: latest.createdAt + 1_000,
  });
  assert.throws(
    () => selectLatestIncompleteChatwootSession([
      { path: '/a/session.json', session: latest, hasInitialSendAttempt: true, hasAcceptedSummary: false },
      { path: '/b/session.json', session: conflicting, hasInitialSendAttempt: true, hasAcceptedSummary: false },
    ]),
    (error) => error?.code === 'CHATWOOT_INITIAL_FAILURE_SESSION_AMBIGUOUS',
  );
});

test('candidate admission forwards only known shallow boundaries to exact inspection', () => {
  assert.equal(isChatwootInitialFailureCandidateAdmitted({
    lifecycle_status: 'terminal', main_queue_attempts: 2, unit_sync_runs: 1,
  }), true);
  assert.equal(isChatwootInitialFailureCandidateAdmitted({
    lifecycle_status: 'terminal', main_queue_attempts: 4, unit_sync_runs: 2,
  }), true);
  assert.equal(isChatwootInitialFailureCandidateAdmitted({
    lifecycle_status: 'terminal', main_queue_attempts: 5, unit_sync_runs: 2,
  }), true);
  assert.equal(isChatwootInitialFailureCandidateAdmitted({
    lifecycle_status: 'terminal', main_queue_attempts: 7, unit_sync_runs: 2,
  }), true);
  assert.equal(isChatwootInitialFailureCandidateAdmitted({
    lifecycle_status: 'terminal', main_queue_attempts: 9, unit_sync_runs: 2,
  }), true);
  assert.equal(isChatwootInitialFailureCandidateAdmitted({
    lifecycle_status: 'terminal', main_queue_attempts: 11, unit_sync_runs: 2,
  }), true);
  assert.equal(isChatwootInitialFailureCandidateAdmitted({
    lifecycle_status: 'terminal', main_queue_attempts: 14, unit_sync_runs: 3,
  }), true);
  assert.equal(isChatwootInitialFailureCandidateAdmitted({
    lifecycle_status: 'terminal', main_queue_attempts: 16, unit_sync_runs: 3,
  }), true);
  assert.equal(isChatwootInitialFailureCandidateAdmitted({
    lifecycle_status: 'terminal', main_queue_attempts: 25, unit_sync_runs: 4,
  }), true);
  assert.equal(isChatwootInitialFailureCandidateAdmitted({
    lifecycle_status: 'terminal', main_queue_attempts: 4, unit_sync_runs: 3,
  }), false);
  assert.equal(isChatwootInitialFailureCandidateAdmitted({
    lifecycle_status: 'completed', main_queue_attempts: 4, unit_sync_runs: 2,
  }), false);
});

test('inspector SQL is SELECT-only and exact-session scoped', () => {
  const operation = session().initial;
  const candidateSql = buildChatwootInitialFailureCandidateSql([{
    path: '/candidate/session.json',
    session: session(),
    hasInitialSendAttempt: true,
    hasAcceptedSummary: false,
  }]);
  assert.match(candidateSql, /^SELECT /u);
  assert.doesNotMatch(candidateSql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/iu);
  assert.match(candidateSql, new RegExp(operation.operationId, 'u'));
  const sql = buildChatwootInitialFailureInspectorSql(operation);
  assert.match(sql, /^SELECT /u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/iu);
  assert.match(sql, new RegExp(operation.operationId, 'u'));
  assert.match(sql, new RegExp(operation.workKey, 'u'));
  assert.match(sql, /status IN \('failed','partial_success'\)/u);
  assert.match(sql, /failed_details_json/u);
});

test('failed-unit normalization preserves the exact boundary and sanitizes diagnostics', () => {
  const operation = session().initial;
  const row = {
    work_lifecycle_status: 'active',
    work_terminal_reason: null,
    work_abandoned_at: null,
    work_audit_reference: null,
    work_generation: operation.generation,
    work_requested_at: operation.originalRequestedAt,
    active_chatwoot_work: 1,
    phase_rows: 0,
    durable_stage: null,
    next_sequence: 0,
    active_lock_count: 0,
    queue_operation_rows: 1,
    main_queue_attempts: 1,
    unit_sync_runs: 1,
    failed_unit_sync_runs: 1,
    failed_sync_run_id: `${operation.syncRunId}:unit:0`,
    unit_sync_run_status: 'failed',
    failed_error_code: 'LARK_INVALID_REQUEST',
    failed_error_message: 'failed for user@example.com at https://example.com/private',
    failed_details_json: JSON.stringify({ retryable: false, token: 'secret', nested: { stage: 'lark' } }),
    coverage_runs: 10,
    failed_coverage_rows: 0,
    current_dlq_records: 0,
    current_open_alerts: 0,
  };
  for (const table of new Set(CHATWOOT_FINAL_UAT_TABLES.map((item) => item.d1Table))) {
    row[table] = 0;
  }
  const result = normalizeChatwootInitialFailureInspection(row, operation);
  assert.equal(result.errorCode, 'LARK_INVALID_REQUEST');
  assert.doesNotMatch(result.errorMessage, /example\.com|user@/u);
  assert.equal(result.details.token, undefined);
  assert.equal(result.details.nested.stage, 'lark');
  assert.deepEqual(sanitizeFailureDetails('{invalid'), { parseStatus: 'invalid_json' });
});

test('exact recovery continuation cannot create a replacement Initial identity', () => {
  const operation = session().initial;
  const job = buildChatwootInitialRecoveryContinuationJob(operation);
  assert.equal(job.operationId, operation.operationId);
  assert.equal(job.workKey, operation.workKey);
  assert.equal(job.generation, operation.generation);
  assert.equal(job.originalRequestedAt, operation.originalRequestedAt);
  assert.equal(job.continuationSequence, 0);
  assert.equal(job.recoveryKind, 'exact_existing_work_continuation');
});

test('terminal reactivation and current incident closure are exact guarded mutations', () => {
  const operation = session().initial;
  const businessCounts = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((item) => item.d1Table))]
      .map((table) => [table, table === 'chatwoot_account_state' ? 1 : 0]),
  );
  const inspection = {
    operation,
    workLifecycle: 'terminal',
    terminalReason: 'QUEUE_PERMANENT_FAILURE',
    abandonedAt: 1_800_000_100_000,
    auditReference: 'terminal:message-id',
    workGeneration: operation.generation,
    workRequestedAt: operation.originalRequestedAt,
    activeChatwootWork: 0,
    phaseRows: 0,
    durableStage: null,
    nextSequence: 0,
    activeLockCount: 0,
    queueOperationRows: 1,
    mainQueueAttempts: 2,
    unitSyncRuns: 1,
    failedUnitSyncRuns: 0,
    failedSyncRunId: `${operation.syncRunId}:unit:0`,
    unitSyncRunStatus: 'running',
    errorCode: 'CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID',
    currentDlqRecords: 1,
    currentOpenAlerts: 1,
    failedCoverageRows: 0,
    businessCounts,
  };
  const reactivation = buildChatwootInitialFailureReactivationSql(inspection);
  assert.match(reactivation, /^UPDATE sync_work_runs/u);
  assert.match(reactivation, /SET lifecycle_status='active'/u);
  assert.match(reactivation, /main_queue_attempts=2/u);
  assert.match(reactivation, /CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID/u);
  assert.match(reactivation, /work_type='chatwoot\.conversations\.sync' AND lifecycle_status='active'/u);
  assert.doesNotMatch(reactivation, /sync_work_runs WHERE lifecycle_status='active'/u);
  assert.match(reactivation, /SELECT changes\(\) AS reactivated_rows/u);
  assert.doesNotMatch(reactivation, /UPDATE (?:chatwoot_|data_coverage)/u);

  const closure = buildChatwootCurrentIncidentClosureSql(operation, {
    recoveryReference: `chatwoot-initial-terminal-recovery:${HEAD}`,
    completedAt: 1_800_000_200_000,
  });
  assert.match(closure, /UPDATE dead_letter_jobs/u);
  assert.match(closure, /UPDATE dead_letter_operation_metadata/u);
  assert.match(closure, /UPDATE system_alerts/u);
  assert.match(closure, /conversation\.waiting_since is outside the supported range 2000-2100/u);
  assert.match(closure, /CHATWOOT_LABEL_MAPPING_MISSING/u);
  assert.match(closure, /CHATWOOT_MESSAGE_CURSOR_REPEATED/u);
  assert.match(closure, /reporting_event\.name is unsupported: conversation_resolved/u);
  assert.match(closure, /reporting_event\.name is unsupported: conversation_opened/u);
  assert.match(closure, /main_queue_attempts IN \(2,4,5,7,9,11,14,16,25\)/u);
  assert.match(closure, /QUEUE_RETRY_EXHAUSTED/u);
  assert.doesNotMatch(closure, /\bDELETE\b/iu);
});

test('fractional timestamp terminal recovery preserves the durable Conversation cursor', () => {
  const operation = session().initial;
  const businessCounts = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((item) => item.d1Table))]
      .map((table) => [table, table === 'chatwoot_account_state' ? 1 : 0]),
  );
  const inspection = {
    operation,
    workLifecycle: 'terminal',
    terminalReason: 'QUEUE_PERMANENT_FAILURE',
    abandonedAt: 1_800_000_100_000,
    auditReference: 'terminal:fractional-timestamp',
    workGeneration: operation.generation,
    workRequestedAt: operation.originalRequestedAt,
    activeChatwootWork: 0,
    phaseRows: 1,
    durableStage: 'conversations',
    nextSequence: 1,
    activeLockCount: 0,
    queueOperationRows: 1,
    mainQueueAttempts: 4,
    unitSyncRuns: 2,
    failedUnitSyncRuns: 1,
    failedSyncRunId: `${operation.syncRunId}:unit:1`,
    unitSyncRunStatus: 'failed',
    errorCode: 'PERMANENT_QUEUE_FAILURE',
    errorMessage: 'conversation.updated_at must fit a safe integer',
    currentDlqRecords: 2,
    currentOpenAlerts: 3,
    failedCoverageRows: 0,
    businessCounts,
  };
  assert.equal(
    classifyChatwootInitialRecoveryBoundary(inspection),
    CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.fractionalTimestamp,
  );
  const sql = buildChatwootInitialFailureReactivationSql(inspection);
  assert.match(sql, /json_extract\(state_json,'\$\.stage'\)='conversations'/u);
  assert.match(sql, /json_extract\(state_json,'\$\.nextSequence'\)=1/u);
  assert.match(sql, /main_queue_attempts=4/u);
  assert.match(sql, /UNHANDLED_SYNC_ERROR/u);
  assert.match(sql, /conversation\.updated_at must fit a safe integer/u);
  assert.doesNotMatch(sql, /DELETE FROM sync_work_phases/iu);
});

test('safe-restore race boundary reactivates only the exact admitted Work', () => {
  const operation = session().initial;
  const businessCounts = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((item) => item.d1Table))]
      .map((table) => [table, table === 'chatwoot_account_state' ? 1 : 0]),
  );
  const inspection = {
    operation,
    workLifecycle: 'terminal',
    terminalReason: 'QUEUE_PERMANENT_FAILURE',
    abandonedAt: 1_800_000_100_000,
    auditReference: 'terminal:safe-restore-race',
    workGeneration: operation.generation,
    workRequestedAt: operation.originalRequestedAt,
    activeChatwootWork: 0,
    phaseRows: 1,
    durableStage: 'conversations',
    nextSequence: 1,
    activeLockCount: 0,
    queueOperationRows: 1,
    mainQueueAttempts: 5,
    unitSyncRuns: 2,
    failedUnitSyncRuns: 1,
    failedSyncRunId: `${operation.syncRunId}:unit:1`,
    unitSyncRunStatus: 'failed',
    errorCode: 'CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID',
    errorMessage: 'Chatwoot connector is disabled or outside the protected UAT runtime',
    currentDlqRecords: 3,
    currentOpenAlerts: 4,
    failedCoverageRows: 0,
    businessCounts,
  };
  assert.equal(
    classifyChatwootInitialRecoveryBoundary(inspection),
    CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.safeRestoreRace,
  );
  const sql = buildChatwootInitialFailureReactivationSql(inspection);
  assert.match(sql, /main_queue_attempts=5/u);
  assert.match(sql, /main_queue_attempts=4/u);
  assert.match(sql, /main_queue_attempts=2/u);
  assert.match(sql, /\)=3 AND EXISTS/u);
  assert.match(sql, /\)=4/u);
});

test('waiting-since terminal recovery preserves the exact zero-write durable cursor', () => {
  const operation = session().initial;
  const businessCounts = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((item) => item.d1Table))]
      .map((table) => [table, table === 'chatwoot_account_state' ? 1 : 0]),
  );
  const inspection = {
    operation,
    workLifecycle: 'terminal',
    terminalReason: 'QUEUE_PERMANENT_FAILURE',
    abandonedAt: 1_800_000_100_000,
    auditReference: 'terminal:waiting-since',
    workGeneration: operation.generation,
    workRequestedAt: operation.originalRequestedAt,
    activeChatwootWork: 0,
    phaseRows: 1,
    durableStage: 'conversations',
    nextSequence: 1,
    activeLockCount: 0,
    queueOperationRows: 1,
    mainQueueAttempts: 7,
    unitSyncRuns: 2,
    failedUnitSyncRuns: 1,
    failedSyncRunId: `${operation.syncRunId}:unit:1`,
    unitSyncRunStatus: 'failed',
    errorCode: 'PERMANENT_QUEUE_FAILURE',
    errorMessage: 'conversation.waiting_since is outside the supported range 2000-2100',
    currentDlqRecords: 4,
    currentOpenAlerts: 6,
    failedCoverageRows: 0,
    businessCounts,
  };
  assert.equal(
    classifyChatwootInitialRecoveryBoundary(inspection),
    CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.waitingSince,
  );
  const sql = buildChatwootInitialFailureReactivationSql(inspection);
  assert.match(sql, /main_queue_attempts=7/u);
  assert.match(sql, /main_queue_attempts=5/u);
  assert.match(sql, /conversation\.waiting_since is outside the supported range 2000-2100/u);
  assert.match(sql, /\)=4 AND EXISTS/u);
  assert.match(sql, /\)=6/u);
  assert.doesNotMatch(sql, /DELETE FROM sync_work_phases/iu);
});

test('unknown-label terminal recovery admits only the exact attempts-9 incident', () => {
  const operation = session().initial;
  const businessCounts = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((item) => item.d1Table))]
      .map((table) => [table, table === 'chatwoot_account_state' ? 1 : 0]),
  );
  const inspection = {
    operation,
    workLifecycle: 'terminal',
    terminalReason: 'QUEUE_PERMANENT_FAILURE',
    abandonedAt: 1_800_000_100_000,
    auditReference: 'terminal:unknown-label',
    workGeneration: operation.generation,
    workRequestedAt: operation.originalRequestedAt,
    activeChatwootWork: 0,
    phaseRows: 1,
    durableStage: 'conversations',
    nextSequence: 1,
    activeLockCount: 0,
    queueOperationRows: 1,
    mainQueueAttempts: 9,
    unitSyncRuns: 2,
    failedUnitSyncRuns: 1,
    failedSyncRunId: `${operation.syncRunId}:unit:1`,
    unitSyncRunStatus: 'failed',
    errorCode: 'CHATWOOT_LABEL_MAPPING_MISSING',
    errorMessage: 'Chatwoot conversation references an unknown label',
    currentDlqRecords: 5,
    currentOpenAlerts: 8,
    failedCoverageRows: 0,
    businessCounts,
  };
  assert.equal(
    classifyChatwootInitialRecoveryBoundary(inspection),
    CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.unknownLabel,
  );
  const sql = buildChatwootInitialFailureReactivationSql(inspection);
  assert.match(sql, /main_queue_attempts=9/u);
  assert.match(sql, /main_queue_attempts=7/u);
  assert.match(sql, /CHATWOOT_LABEL_MAPPING_MISSING/u);
  assert.match(sql, /\)=5 AND EXISTS/u);
  assert.match(sql, /\)=8/u);
  assert.doesNotMatch(sql, /DELETE FROM sync_work_phases/iu);
});

test('message-order terminal recovery admits only the exact attempts-11 incident', () => {
  const operation = session().initial;
  const businessCounts = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((item) => item.d1Table))]
      .map((table) => [table, table === 'chatwoot_account_state' ? 1 : 0]),
  );
  const inspection = {
    operation,
    workLifecycle: 'terminal',
    terminalReason: 'QUEUE_PERMANENT_FAILURE',
    abandonedAt: 1_800_000_100_000,
    auditReference: 'terminal:message-order',
    workGeneration: operation.generation,
    workRequestedAt: operation.originalRequestedAt,
    activeChatwootWork: 0,
    phaseRows: 1,
    durableStage: 'conversations',
    nextSequence: 1,
    activeLockCount: 0,
    queueOperationRows: 1,
    mainQueueAttempts: 11,
    unitSyncRuns: 2,
    failedUnitSyncRuns: 1,
    failedSyncRunId: `${operation.syncRunId}:unit:1`,
    unitSyncRunStatus: 'failed',
    errorCode: 'CHATWOOT_MESSAGE_CURSOR_REPEATED',
    errorMessage: 'Chatwoot message cursor did not increase',
    currentDlqRecords: 6,
    currentOpenAlerts: 10,
    failedCoverageRows: 0,
    businessCounts,
  };
  assert.equal(
    classifyChatwootInitialRecoveryBoundary(inspection),
    CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.messageOrder,
  );
  const sql = buildChatwootInitialFailureReactivationSql(inspection);
  assert.match(sql, /main_queue_attempts=11/u);
  assert.match(sql, /main_queue_attempts=9/u);
  assert.match(sql, /CHATWOOT_MESSAGE_CURSOR_REPEATED/u);
  assert.match(sql, /\)=6 AND EXISTS/u);
  assert.match(sql, /\)=10/u);
});

test('reporting-event terminal recovery preserves the committed page-1 cursor', () => {
  const operation = session().initial;
  const businessCounts = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((item) => item.d1Table))]
      .map((table) => [table, 0]),
  );
  Object.assign(businessCounts, {
    chatwoot_account_state: 1,
    chatwoot_inbox_state: 3,
    chatwoot_agent_state: 12,
    chatwoot_team_state: 3,
    chatwoot_label_state: 47,
    chatwoot_conversation_state: 17,
    chatwoot_conversation_label_state: 22,
    chatwoot_message_analytics_state: 590,
    chatwoot_reporting_event_facts: 122,
    chatwoot_conversation_daily_facts: 29,
    chatwoot_agent_daily_facts: 14,
    chatwoot_inbox_daily_facts: 8,
    chatwoot_account_daily_facts: 8,
  });
  const inspection = {
    operation,
    workLifecycle: 'terminal',
    terminalReason: 'QUEUE_PERMANENT_FAILURE',
    abandonedAt: 1_800_000_100_000,
    auditReference: 'terminal:reporting-event',
    workGeneration: operation.generation,
    workRequestedAt: operation.originalRequestedAt,
    activeChatwootWork: 0,
    phaseRows: 1,
    durableStage: 'conversations',
    nextSequence: 2,
    activeLockCount: 0,
    queueOperationRows: 1,
    mainQueueAttempts: 14,
    unitSyncRuns: 3,
    failedUnitSyncRuns: 1,
    failedSyncRunId: `${operation.syncRunId}:unit:2`,
    unitSyncRunStatus: 'failed',
    errorCode: 'PERMANENT_QUEUE_FAILURE',
    errorMessage: 'reporting_event.name is unsupported: conversation_resolved',
    coverageRuns: 24,
    currentDlqRecords: 7,
    currentOpenAlerts: 12,
    failedCoverageRows: 0,
    businessCounts,
  };
  assert.equal(
    classifyChatwootInitialRecoveryBoundary(inspection),
    CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.reportingEvent,
  );
  const sql = buildChatwootInitialFailureReactivationSql(inspection);
  assert.match(sql, /main_queue_attempts=14/u);
  assert.match(sql, /json_extract\(state_json,'\$\.nextSequence'\)=2/u);
  assert.match(sql, /json_extract\(state_json,'\$\.conversationPagesProcessed'\)=1/u);
  assert.match(sql, /reporting_event\.name is unsupported: conversation_resolved/u);
  assert.match(sql, /\)=7 AND EXISTS/u);
  assert.match(sql, /\)=12/u);
  assert.doesNotMatch(sql, /DELETE FROM sync_work_phases/iu);
});

test('reporting-event-name terminal recovery admits the exact attempts-16 incident', () => {
  const operation = session().initial;
  const businessCounts = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((item) => item.d1Table))]
      .map((table) => [table, 0]),
  );
  Object.assign(businessCounts, {
    chatwoot_account_state: 1,
    chatwoot_inbox_state: 3,
    chatwoot_agent_state: 12,
    chatwoot_team_state: 3,
    chatwoot_label_state: 47,
    chatwoot_conversation_state: 17,
    chatwoot_conversation_label_state: 22,
    chatwoot_message_analytics_state: 590,
    chatwoot_reporting_event_facts: 122,
    chatwoot_conversation_daily_facts: 29,
    chatwoot_agent_daily_facts: 14,
    chatwoot_inbox_daily_facts: 8,
    chatwoot_account_daily_facts: 8,
  });
  const inspection = {
    operation,
    workLifecycle: 'terminal',
    terminalReason: 'QUEUE_PERMANENT_FAILURE',
    abandonedAt: 1_800_000_100_000,
    auditReference: 'terminal:reporting-event-names',
    workGeneration: operation.generation,
    workRequestedAt: operation.originalRequestedAt,
    activeChatwootWork: 0,
    phaseRows: 1,
    durableStage: 'conversations',
    nextSequence: 2,
    activeLockCount: 0,
    queueOperationRows: 1,
    mainQueueAttempts: 16,
    unitSyncRuns: 3,
    failedUnitSyncRuns: 1,
    failedSyncRunId: `${operation.syncRunId}:unit:2`,
    unitSyncRunStatus: 'failed',
    errorCode: 'PERMANENT_QUEUE_FAILURE',
    errorMessage: 'reporting_event.name is unsupported: conversation_opened',
    coverageRuns: 24,
    currentDlqRecords: 8,
    currentOpenAlerts: 14,
    failedCoverageRows: 0,
    businessCounts,
  };
  assert.equal(
    classifyChatwootInitialRecoveryBoundary(inspection),
    CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.reportingEventNames,
  );
  const sql = buildChatwootInitialFailureReactivationSql(inspection);
  assert.match(sql, /main_queue_attempts=16/u);
  assert.match(sql, /reporting_event\.name is unsupported: conversation_opened/u);
  assert.match(sql, /\)=8 AND EXISTS/u);
  assert.match(sql, /\)=14/u);
  assert.doesNotMatch(sql, /DELETE FROM sync_work_phases/iu);
});

test('Queue retry exhaustion recovery preserves page 3 and admits only attempt 25', () => {
  const operation = session().initial;
  const businessCounts = Object.fromEntries(
    [...new Set(CHATWOOT_FINAL_UAT_TABLES.map((item) => item.d1Table))]
      .map((table) => [table, 0]),
  );
  Object.assign(businessCounts, {
    chatwoot_account_state: 1,
    chatwoot_inbox_state: 3,
    chatwoot_agent_state: 12,
    chatwoot_team_state: 3,
    chatwoot_label_state: 47,
    chatwoot_conversation_state: 65,
    chatwoot_conversation_label_state: 126,
    chatwoot_message_analytics_state: 2071,
    chatwoot_reporting_event_facts: 448,
    chatwoot_conversation_daily_facts: 200,
    chatwoot_agent_daily_facts: 81,
    chatwoot_inbox_daily_facts: 54,
    chatwoot_account_daily_facts: 42,
  });
  const inspection = {
    operation,
    workLifecycle: 'terminal',
    terminalReason: 'QUEUE_RETRY_EXHAUSTED',
    abandonedAt: 1_800_000_100_000,
    auditReference: 'dlq:retry-exhausted',
    workGeneration: operation.generation,
    workRequestedAt: operation.originalRequestedAt,
    activeChatwootWork: 0,
    phaseRows: 1,
    durableStage: 'conversations',
    nextSequence: 3,
    activeLockCount: 0,
    queueOperationRows: 1,
    mainQueueAttempts: 25,
    unitSyncRuns: 4,
    failedUnitSyncRuns: 0,
    failedSyncRunId: `${operation.syncRunId}:unit:3`,
    unitSyncRunStatus: 'running',
    errorCode: 'QUEUE_RETRY_EXHAUSTED',
    errorMessage: 'Queue retry exhausted',
    coverageRuns: 52,
    currentDlqRecords: 9,
    currentOpenAlerts: 15,
    failedCoverageRows: 0,
    businessCounts,
  };
  assert.equal(
    classifyChatwootInitialRecoveryBoundary(inspection),
    CHATWOOT_INITIAL_RECOVERY_BOUNDARIES.queueRetryExhausted,
  );
  const sql = buildChatwootInitialFailureReactivationSql(inspection);
  assert.match(sql, /terminal_reason='QUEUE_RETRY_EXHAUSTED'/u);
  assert.match(sql, /main_queue_attempts=25/u);
  assert.match(sql, /json_extract\(state_json,'\$\.conversationPage'\)=3/u);
  assert.match(sql, /json_extract\(state_json,'\$\.messagesSelected'\)=1270/u);
  assert.match(sql, /COUNT\(\*\) FROM data_coverage_runs/u);
  assert.match(sql, /QUEUE_RETRY_EXHAUSTED/u);
  assert.doesNotMatch(sql, /DELETE FROM sync_work_phases/iu);
});

test('public recovery is plan-only and delegates exact resume through existing Final UAT', async () => {
  const source = await readFile(
    new URL('../../scripts/chatwoot-initial-terminal-failure-recovery-launcher.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /chatwoot-initial-terminal-failure-inspector\.mjs/u);
  assert.match(source, /buildChatwootInitialFailureReactivationSql/u);
  assert.match(source, /MKT_CHATWOOT_INITIAL_FAILURE_RECOVERY_SESSION_PATH/u);
  assert.match(source, /MKT_CHATWOOT_INITIAL_FAILURE_RECOVERY_BOUNDARY/u);
  assert.match(source, /findControllerResume/u);
  assert.match(source, /MKT_CHATWOOT_FINAL_UAT_RESUME_EVIDENCE_DIR/u);
  assert.match(source, /Multiple incomplete Chatwoot controller sessions are ambiguous/u);
  assert.match(source, /assertChatwootFinalUatControllerResume/u);
  assert.match(source, /chatwoot-final-source-config-recovery-launcher\.mjs/u);
  assert.match(source, /buildChatwootCurrentIncidentClosureSql/u);
  assert.doesNotMatch(source, /sendOnce\(/u);
  const finalUat = await readFile(
    new URL('../../scripts/chatwoot-final-30d-daily-uat.mjs', import.meta.url),
    'utf8',
  );
  assert.match(finalUat, /allowedPreexistingFailedUnits/u);
  assert.match(finalUat, /last\.workLifecycleStatus === 'terminal'/u);
});
