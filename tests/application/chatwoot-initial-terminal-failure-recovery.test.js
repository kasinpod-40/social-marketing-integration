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
  assertChatwootInitialFailureInspectorConfirmation,
  buildChatwootCurrentIncidentClosureSql,
  buildChatwootInitialFailureReactivationSql,
  buildChatwootInitialRecoveryContinuationJob,
  buildChatwootInitialFailureCandidateSql,
  buildChatwootInitialFailureInspectorSql,
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
  assert.throws(
    () => selectLatestIncompleteChatwootSession([
      { path: '/a/session.json', session: latest, hasInitialSendAttempt: true, hasAcceptedSummary: false },
      { path: '/b/session.json', session: latest, hasInitialSendAttempt: true, hasAcceptedSummary: false },
    ]),
    (error) => error?.code === 'CHATWOOT_INITIAL_FAILURE_SESSION_AMBIGUOUS',
  );
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
  assert.doesNotMatch(closure, /\bDELETE\b/iu);
});

test('public recovery is plan-only and delegates exact resume through existing Final UAT', async () => {
  const source = await readFile(
    new URL('../../scripts/chatwoot-initial-terminal-failure-recovery-launcher.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /chatwoot-initial-terminal-failure-inspector\.mjs/u);
  assert.match(source, /buildChatwootInitialFailureReactivationSql/u);
  assert.match(source, /MKT_CHATWOOT_INITIAL_FAILURE_RECOVERY_SESSION_PATH/u);
  assert.match(source, /chatwoot-final-source-config-recovery-launcher\.mjs/u);
  assert.match(source, /buildChatwootCurrentIncidentClosureSql/u);
  assert.doesNotMatch(source, /sendOnce\(/u);
});
