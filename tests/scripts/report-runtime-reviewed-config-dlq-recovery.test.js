import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDashboardPresetJob } from '../../packages/application/src/reports/dashboard-report-request.js';
import { createReportId } from '../../packages/application/src/storage/marketing-history-contract.js';
import { resolveReportPeriod } from '../../packages/application/src/reports/report-period.js';
import {
  REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT,
  REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENTS,
  REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT,
  assertReviewedConfigDlqAttempt,
  assertReviewedConfigDlqCandidate,
  assertReviewedConfigDlqClosed,
  assertReviewedConfigDlqIncident,
  assertReviewedConfigDlqInitialState,
  assertReviewedConfigDlqPreflight,
  buildReviewedConfigDlqClosureStatements,
  buildReviewedConfigDlqIncidentSql,
  resolveReviewedConfigDlqIncident,
} from '../../scripts/lib/report-runtime-reviewed-config-dlq-recovery.js';

function candidate(incident) {
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

function dlqRow(incident, overrides = {}) {
  const replay = candidate(incident).job;
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
    original_work_key: incident.originalWorkKey,
    generation: incident.requestedAt,
    original_requested_at: incident.requestedAt,
    main_queue_attempts: incident.mainQueueAttempts,
    dlq_delivery_attempts: incident.dlqDeliveryAttempts,
    recovery_status: 'not_started',
    recovery_reference: null,
    audit_reference: null,
    ...overrides,
  };
}

function preflight(incident) {
  return {
    coverage_status: 'complete',
    coverage_dataset_key: incident.coverageDatasetKey,
    source_scope: incident.sourceScope,
    source_watermark: incident.sourceWatermark,
    period_end: incident.periodEnd,
    [incident.sourceFactField]: 2,
    active_report_work_count: 0,
    active_report_locks: 0,
    open_report_dlq: 1,
    open_report_critical_alerts: 0,
  };
}

for (const incident of Object.values(REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENTS)) {
  test(`${incident.key} binds the exact retained attempt and regenerated candidate`, () => {
    assert.equal(assertReviewedConfigDlqAttempt({
      reportId: incident.reportId,
      action: 'create_materialization',
      requestedAt: incident.requestedAt,
      jobSha256: incident.jobSha256,
    }, incident), true);
    assert.equal(assertReviewedConfigDlqCandidate(candidate(incident), incident), true);
    assert.throws(
      () => assertReviewedConfigDlqCandidate({ ...candidate(incident), reportId: 'wrong' }, incident),
      (error) => error.code === 'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_CANDIDATE_MISMATCH',
    );
  });

  test(`${incident.key} preflight allows only the exact bound open DLQ and source facts`, () => {
    assert.equal(assertReviewedConfigDlqPreflight(preflight(incident), incident), true);
    assert.throws(
      () => assertReviewedConfigDlqPreflight({ ...preflight(incident), open_report_dlq: 2 }, incident),
      (error) => error.code === 'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_PREFLIGHT_MISMATCH',
    );
  });

  test(`${incident.key} validator binds exact DLQ payload and operation metadata`, () => {
    const result = assertReviewedConfigDlqIncident(dlqRow(incident), incident);
    assert.equal(result.replayPayload.reportSettingKey, incident.reportSettingKey);
    assert.equal(result.originalWorkKey, incident.originalWorkKey);
    assert.throws(
      () => assertReviewedConfigDlqIncident(dlqRow(incident, { retry_count: incident.retryCount + 1 }), incident),
      (error) => error.code === 'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT_MISMATCH',
    );
  });

  test(`${incident.key} initial state retains the exact prior successful-run floor`, () => {
    assert.equal(assertReviewedConfigDlqInitialState({
      d1: {
        report_id: null,
        materialization_count: 0,
        successful_sync_count: incident.successfulSyncCountBeforeRecovery,
        active_lock_count: 0,
      },
      lark: {
        snapshots: 0,
        metrics: 0,
        topContent: 0,
        topAds: 0,
        duplicateMetricKeys: 0,
      },
    }, incident), true);
    assert.throws(
      () => assertReviewedConfigDlqInitialState({
        d1: {
          report_id: null,
          materialization_count: 0,
          successful_sync_count: incident.successfulSyncCountBeforeRecovery + 1,
          active_lock_count: 0,
        },
        lark: {},
      }, incident),
      (error) => error.code === 'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INITIAL_STATE_MISMATCH',
    );
  });

  test(`${incident.key} closure SQL is exact and readback requires both closures`, () => {
    const sql = buildReviewedConfigDlqIncidentSql(incident);
    assert.match(sql, /dead_letter_jobs/u);
    assert.match(sql, /dead_letter_operation_metadata/u);
    assert.match(sql, new RegExp(incident.messageId, 'u'));

    const statements = buildReviewedConfigDlqClosureStatements(1785920000000, incident);
    assert.equal(statements.length, 2);
    assert.match(statements[0], /status = 'redriven'/u);
    assert.equal(statements[0].includes(incident.closureReference), true);
    assert.match(statements[1], /recovery_status = 'completed'/u);
    assert.equal(statements[1].includes(`main_queue_attempts = ${incident.mainQueueAttempts}`), true);
    assert.equal(statements[1].includes(incident.originalWorkKey), true);

    assert.equal(assertReviewedConfigDlqClosed({
      dlq_id: incident.dlqId,
      status: 'redriven',
      redrive_reference: incident.closureReference,
      recovery_status: 'completed',
      recovery_reference: incident.closureReference,
      audit_reference: incident.closureReference,
    }, incident), true);
  });
}

test('incident resolver preserves the completed Facebook v1 authority and exposes exact Meta Ads 3D authority', () => {
  assert.equal(
    REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT,
    'report_runtime_reviewed_config_dlq_recovery_v1',
  );
  assert.equal(REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.key, 'facebook_1d_20260731');
  assert.equal(
    REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.closureReference,
    'report-runtime-reviewed-config-dlq-recovery-v1:terminal:4c366c2b02ad5162c6e4035899d67abc',
  );
  assert.equal(resolveReviewedConfigDlqIncident().key, 'facebook_1d_20260731');
  const meta = resolveReviewedConfigDlqIncident('meta_ads_3d_20260731');
  assert.equal(meta.platformScope, 'meta_ads');
  assert.equal(meta.windowDays, 3);
  assert.equal(meta.retryCount, 4);
  assert.equal(meta.mainQueueAttempts, 4);
  assert.equal(meta.successfulSyncCountBeforeRecovery, 2);
  assert.equal(
    meta.closureReference,
    'report-runtime-reviewed-config-dlq-recovery-v1:terminal:e408707c9c2d383e04a3e213a7be45a0',
  );
  assert.throws(
    () => resolveReviewedConfigDlqIncident('unknown'),
    (error) => error.code === 'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT_KEY_INVALID',
  );
});
