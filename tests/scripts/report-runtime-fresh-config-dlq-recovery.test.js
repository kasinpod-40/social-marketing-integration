import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT,
  assertReportRuntimeFreshConfigDlqClosed,
  assertReportRuntimeFreshConfigDlqCompletion,
  assertReportRuntimeFreshConfigDlqEvidence,
  assertReportRuntimeFreshConfigDlqIncident,
  assertReportRuntimeFreshConfigDlqInitialState,
  assertReportRuntimeFreshConfigDlqPreflight,
  assertReportRuntimeStableActiveDeployment,
  buildReportRuntimeFreshConfigDlqClosureStatements,
  buildReportRuntimeFreshConfigDlqCompletionSql,
} from '../../scripts/lib/report-runtime-fresh-config-dlq-recovery.js';

const INCIDENT = REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT;
const SHA = 'a'.repeat(64);
const HEAD = 'b'.repeat(40);

function incidentRow(overrides = {}) {
  return {
    dlq_id: INCIDENT.dlqId,
    message_id: INCIDENT.messageId,
    status: 'open',
    job_type: INCIDENT.jobType,
    error_code: INCIDENT.errorCode,
    retry_count: INCIDENT.retryCount,
    redrive_reference: null,
    redriven_at: null,
    operation_id: null,
    original_work_key: INCIDENT.originalWorkKey,
    generation: INCIDENT.generation,
    original_requested_at: INCIDENT.originalRequestedAt,
    main_queue_attempts: INCIDENT.mainQueueAttempts,
    dlq_delivery_attempts: INCIDENT.dlqDeliveryAttempts,
    recovery_status: 'not_started',
    recovery_reference: null,
    recovery_completed_at: null,
    audit_reference: null,
    ...overrides,
  };
}

function candidate() {
  return {
    operation: 'fresh',
    windowDays: 1,
    reportId: INCIDENT.reportId,
    reportSettingKey: INCIDENT.reportSettingKey,
    job: {
      type: INCIDENT.jobType,
      trigger: 'dashboard_preset',
      periodKind: 'rolling_days',
      requestedAt: new Date(INCIDENT.originalRequestedAt).toISOString(),
    },
  };
}

test('exact 1D configuration DLQ accepts only the immutable observed identity', () => {
  assert.deepEqual(assertReportRuntimeFreshConfigDlqIncident(incidentRow()), {
    dlqId: INCIDENT.dlqId,
    status: 'open',
    recoveryStatus: 'not_started',
    alreadyClosed: false,
  });
  for (const drift of [
    { error_code: 'OTHER' },
    { retry_count: 2 },
    { operation_id: 'unexpected' },
    { main_queue_attempts: 2 },
  ]) {
    assert.throws(
      () => assertReportRuntimeFreshConfigDlqIncident(incidentRow(drift)),
      (error) => error.code === 'REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT_MISMATCH',
    );
  }
});

test('1D recovery preflight requires complete coverage, zero lock and the single exact open Report DLQ', () => {
  assert.equal(assertReportRuntimeFreshConfigDlqPreflight({
    coverage_status: 'complete',
    source_watermark: 'watermark',
    period_end: '2026-07-28',
    content_state_count: 2024,
    observation_count: 3149,
    active_report_locks: 0,
    open_report_dlq: 1,
  }), true);
  assert.throws(
    () => assertReportRuntimeFreshConfigDlqPreflight({
      coverage_status: 'complete',
      source_watermark: 'watermark',
      period_end: '2026-07-28',
      content_state_count: 2024,
      observation_count: 3149,
      active_report_locks: 0,
      open_report_dlq: 2,
    }),
    (error) => error.code === 'REPORT_RUNTIME_FRESH_CONFIG_DLQ_PREFLIGHT_INVALID',
  );
});

test('original 1D evidence must be fresh, unmaterialized, unreplayed and job-identical', () => {
  assert.deepEqual(assertReportRuntimeFreshConfigDlqEvidence({
    deployAttempt: {
      repositoryHead: HEAD,
      operation: 'fresh',
      windowDays: 1,
      selectedReportId: INCIDENT.reportId,
      configSha256: SHA,
    },
    sendFirstAttempt: {
      operation: 'fresh',
      requestedAt: INCIDENT.originalRequestedAt,
      reportId: INCIDENT.reportId,
      jobSha256: SHA,
    },
    restoreAttempt: {
      repositoryHead: HEAD,
      configSha256: SHA,
    },
    replayAttempt: null,
    summaryExists: false,
    candidate: candidate(),
    activeConfigSha256: SHA,
    safeConfigSha256: SHA,
    jobSha256: SHA,
  }), {
    reportId: INCIDENT.reportId,
    requestedAt: INCIDENT.originalRequestedAt,
    jobSha256: SHA,
    originalRepositoryHead: HEAD,
  });
  assert.throws(
    () => assertReportRuntimeFreshConfigDlqEvidence({
      deployAttempt: {
        repositoryHead: HEAD,
        operation: 'fresh',
        windowDays: 1,
        selectedReportId: INCIDENT.reportId,
        configSha256: SHA,
      },
      sendFirstAttempt: {
        operation: 'fresh',
        requestedAt: INCIDENT.originalRequestedAt,
        reportId: INCIDENT.reportId,
        jobSha256: SHA,
      },
      restoreAttempt: { repositoryHead: HEAD, configSha256: SHA },
      replayAttempt: { reportId: INCIDENT.reportId },
      summaryExists: false,
      candidate: candidate(),
      activeConfigSha256: SHA,
      safeConfigSha256: SHA,
      jobSha256: SHA,
    }),
    (error) => error.code === 'REPORT_RUNTIME_FRESH_CONFIG_DLQ_EVIDENCE_MISMATCH',
  );
});

test('initial state is zero materialization and completion requires one stable row plus bounded successes', () => {
  assert.equal(assertReportRuntimeFreshConfigDlqInitialState({
    report_id: null,
    payload_checksum: null,
    materialization_count: 0,
    successful_sync_count: 0,
    active_lock_count: 0,
    exact_incident_count: 1,
    other_open_report_dlq: 0,
  }), true);
  const completed = {
    report_id: INCIDENT.reportId,
    payload_checksum: SHA,
    payload_json: '{}',
    materialization_count: 1,
    successful_sync_count: 2,
    latest_sync_status: 'success',
    active_lock_count: 0,
    new_dlq_count: 0,
  };
  assert.equal(assertReportRuntimeFreshConfigDlqCompletion(completed, 1), true);
  assert.equal(assertReportRuntimeFreshConfigDlqCompletion(completed, 2), true);
  assert.throws(
    () => assertReportRuntimeFreshConfigDlqCompletion({
      ...completed,
      successful_sync_count: 1,
    }, 2),
    (error) => error.code === 'REPORT_RUNTIME_FRESH_CONFIG_DLQ_COMPLETION_INCOMPLETE',
  );
  const sql = buildReportRuntimeFreshConfigDlqCompletionSql(1785412000000);
  assert.match(sql, /payload_json/u);
  assert.match(sql, /started_at >= 1785412000000/u);
  assert.match(sql, /created_at >= 1785412000000/u);
});

test('every Report Queue send requires three samples of the same version and exact true flags', () => {
  const versionId = '11111111-2222-4333-8444-555555555555';
  assert.deepEqual(assertReportRuntimeStableActiveDeployment([
    { versionId, trueFlags: ['MKT_REPORT_PRESET_MATERIALIZATION_ENABLED', 'MKT_REPORT_D1_READ_ENABLED'], mode: 'active' },
    { versionId, trueFlags: ['MKT_REPORT_D1_READ_ENABLED', 'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED'], mode: 'active' },
    { versionId, trueFlags: ['MKT_REPORT_D1_READ_ENABLED', 'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED'], mode: 'active' },
  ], {
    versionId,
    trueFlags: ['MKT_REPORT_D1_READ_ENABLED', 'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED'],
  }), {
    sampleCount: 3,
    versionId,
    trueFlags: ['MKT_REPORT_D1_READ_ENABLED', 'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED'],
  });
  assert.throws(
    () => assertReportRuntimeStableActiveDeployment([
      { versionId, trueFlags: [], mode: 'active' },
      { versionId, trueFlags: [], mode: 'active' },
      { versionId, trueFlags: [], mode: 'active' },
    ], { versionId, trueFlags: ['MKT_REPORT_D1_READ_ENABLED'] }),
    (error) => error.code === 'REPORT_RUNTIME_ACTIVE_DEPLOYMENT_NOT_STABLE',
  );
});

test('closure retains only exact DLQ audit metadata and never deletes Report or business facts', () => {
  const statements = buildReportRuntimeFreshConfigDlqClosureStatements(1785413000000);
  assert.equal(statements.length, 2);
  const sql = statements.join('\n');
  assert.match(sql, /UPDATE dead_letter_jobs/u);
  assert.match(sql, /UPDATE dead_letter_operation_metadata/u);
  assert.match(sql, new RegExp(INCIDENT.dlqId, 'u'));
  assert.match(sql, new RegExp(INCIDENT.errorCode, 'u'));
  assert.doesNotMatch(sql, /DELETE\s+FROM/iu);
  assert.doesNotMatch(sql, /report_materializations\s+SET|organic_content_|data_coverage_/iu);
  assert.equal(assertReportRuntimeFreshConfigDlqClosed(incidentRow({
    status: 'redriven',
    redrive_reference: INCIDENT.closureReference,
    redriven_at: 1785413000000,
    recovery_status: 'completed',
    recovery_reference: INCIDENT.closureReference,
    recovery_completed_at: 1785413000000,
    audit_reference: INCIDENT.closureReference,
  })), true);
});
