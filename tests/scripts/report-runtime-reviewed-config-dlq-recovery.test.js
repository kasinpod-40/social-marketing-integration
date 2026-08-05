import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDashboardPresetJob } from '../../packages/application/src/reports/dashboard-report-request.js';
import { createReportId } from '../../packages/application/src/storage/marketing-history-contract.js';
import { resolveReportPeriod } from '../../packages/application/src/reports/report-period.js';
import {
  REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT,
  assertReviewedConfigDlqAttempt,
  assertReviewedConfigDlqCandidate,
  assertReviewedConfigDlqClosed,
  assertReviewedConfigDlqIncident,
  assertReviewedConfigDlqInitialState,
  assertReviewedConfigDlqPreflight,
  buildReviewedConfigDlqClosureStatements,
  buildReviewedConfigDlqIncidentSql,
} from '../../scripts/lib/report-runtime-reviewed-config-dlq-recovery.js';

const incident = REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT;

function candidate() {
  const period = resolveReportPeriod({
    periodKind: 'rolling_days',
    windowDays: incident.windowDays,
    periodEnd: incident.periodEnd,
    comparisonMode: 'previous_period',
    timeZone: 'Asia/Bangkok',
    now: new Date(incident.requestedAt),
  });
  const job = buildDashboardPresetJob({
    requestedAt: incident.requestedAt,
    reportSettingKey: incident.reportSettingKey,
    platformScope: incident.platformScope,
    windowDays: incident.windowDays,
    periodEnd: incident.periodEnd,
    comparisonMode: 'previous_period',
    timeZone: 'Asia/Bangkok',
    sourceWatermark: incident.sourceWatermark,
  });
  const reportId = createReportId({
    report_setting_key: incident.reportSettingKey,
    account_key: incident.accountKey,
    period_kind: 'rolling_days',
    period_start: period.periodStart,
    period_end: period.periodEnd,
    formula_version: incident.formulaVersion,
  });
  return { windowDays: incident.windowDays, reportSettingKey: incident.reportSettingKey, reportId, period, job };
}

function dlqRow(overrides = {}) {
  const replay = candidate().job;
  return {
    dlq_id: incident.dlqId,
    message_id: incident.messageId,
    queue_name: incident.queueName,
    job_type: incident.jobType,
    schema_version: 1,
    payload_json: '{}',
    replay_payload_json: JSON.stringify(replay),
    error_code: incident.errorCode,
    error_message: incident.errorMessage,
    retry_count: incident.retryCount,
    status: 'open',
    metadata_dlq_id: incident.dlqId,
    operation_id: null,
    original_work_key: `facebook:${incident.messageId}`,
    generation: incident.requestedAt,
    original_requested_at: incident.requestedAt,
    main_queue_attempts: 1,
    dlq_delivery_attempts: 0,
    recovery_status: 'not_started',
    recovery_reference: null,
    audit_reference: null,
    ...overrides,
  };
}

test('exact retained attempt and regenerated candidate match the Facebook 1D incident', () => {
  assert.equal(assertReviewedConfigDlqAttempt({
    reportId: incident.reportId,
    action: 'create_materialization',
    requestedAt: incident.requestedAt,
    jobSha256: incident.jobSha256,
  }), true);
  assert.equal(assertReviewedConfigDlqCandidate(candidate()), true);
  assert.throws(
    () => assertReviewedConfigDlqCandidate({ ...candidate(), reportId: 'wrong' }),
    (error) => error.code === 'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_CANDIDATE_MISMATCH',
  );
});

test('preflight allows only the exact bound open DLQ with account-daily Facebook facts', () => {
  const preflight = {
    coverage_status: 'complete',
    coverage_dataset_key: 'facebook.account.daily',
    source_scope: 'account',
    source_watermark: incident.sourceWatermark,
    period_end: incident.periodEnd,
    account_fact_count: 2,
    active_report_work_count: 0,
    active_report_locks: 0,
    open_report_dlq: 1,
    open_report_critical_alerts: 0,
  };
  assert.equal(assertReviewedConfigDlqPreflight(preflight), true);
  assert.throws(
    () => assertReviewedConfigDlqPreflight({ ...preflight, open_report_dlq: 2 }),
    (error) => error.code === 'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_PREFLIGHT_MISMATCH',
  );
});

test('incident validator binds exact DLQ identity, payload hash and operation metadata', () => {
  const result = assertReviewedConfigDlqIncident(dlqRow());
  assert.equal(result.replayPayload.reportSettingKey, incident.reportSettingKey);
  assert.equal(result.originalWorkKey, `facebook:${incident.messageId}`);
  assert.throws(
    () => assertReviewedConfigDlqIncident(dlqRow({ retry_count: 2 })),
    (error) => error.code === 'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT_MISMATCH',
  );
});

test('initial state requires zero D1 and Lark materialization identity', () => {
  assert.equal(assertReviewedConfigDlqInitialState({
    d1: {
      report_id: null,
      materialization_count: 0,
      successful_sync_count: 0,
      active_lock_count: 0,
    },
    lark: {
      snapshots: 0,
      metrics: 0,
      topContent: 0,
      topAds: 0,
      duplicateMetricKeys: 0,
    },
  }), true);
  assert.throws(
    () => assertReviewedConfigDlqInitialState({
      d1: { report_id: incident.reportId, materialization_count: 1 },
      lark: {},
    }),
    (error) => error.code === 'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INITIAL_STATE_MISMATCH',
  );
});

test('closure SQL is exact, guarded and readback requires both DLQ and metadata closure', () => {
  const sql = buildReviewedConfigDlqIncidentSql();
  assert.match(sql, /dead_letter_jobs/u);
  assert.match(sql, /dead_letter_operation_metadata/u);
  assert.match(sql, new RegExp(incident.messageId, 'u'));

  const statements = buildReviewedConfigDlqClosureStatements(1785920000000);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /status = 'redriven'/u);
  assert.equal(statements[0].includes(incident.closureReference), true);
  assert.match(statements[1], /recovery_status = 'completed'/u);

  assert.equal(assertReviewedConfigDlqClosed({
    dlq_id: incident.dlqId,
    status: 'redriven',
    redrive_reference: incident.closureReference,
    recovery_status: 'completed',
    recovery_reference: incident.closureReference,
    audit_reference: incident.closureReference,
  }), true);
});
