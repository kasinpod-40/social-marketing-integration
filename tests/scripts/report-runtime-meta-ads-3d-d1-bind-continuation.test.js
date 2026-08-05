import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildDashboardPresetJob } from '../../packages/application/src/reports/dashboard-report-request.js';
import { resolveReportPeriod } from '../../packages/application/src/reports/report-period.js';
import { createReportId } from '../../packages/application/src/storage/marketing-history-contract.js';
import {
  META_ADS_3D_D1_BIND_CONTINUATION,
  META_ADS_3D_D1_BIND_CONTINUATION_CONTRACT,
  assertMetaAds3dContinuationCandidate,
  assertMetaAds3dContinuationPreflight,
  assertMetaAds3dDlqClosed,
  assertMetaAds3dDlqRow,
  assertMetaAds3dInitialState,
  assertMetaAds3dRetainedAttempt,
  assertMetaAds3dRootCauseEvidence,
  buildMetaAds3dClosureStatements,
  buildMetaAds3dContinuationPollSql,
  buildMetaAds3dDlqSql,
  buildMetaAds3dFailedRecoveryStateSql,
} from '../../scripts/lib/report-runtime-meta-ads-3d-d1-bind-continuation.js';

const incident = META_ADS_3D_D1_BIND_CONTINUATION;

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
  return {
    windowDays: incident.windowDays,
    reportSettingKey: incident.reportSettingKey,
    reportId: createReportId({
      report_setting_key: incident.reportSettingKey,
      account_key: incident.accountKey,
      period_kind: 'rolling_days',
      period_start: period.periodStart,
      period_end: period.periodEnd,
      formula_version: incident.formulaVersion,
    }),
    period,
    job,
  };
}

function dlqRow(binding, overrides = {}) {
  return {
    dlq_id: binding.dlqId,
    message_id: binding.messageId,
    queue_name: binding.queueName,
    job_type: incident.jobType,
    schema_version: 1,
    replay_payload_json: JSON.stringify(candidate().job),
    error_code: binding.errorCode,
    error_message: binding.errorMessage,
    retry_count: binding.retryCount,
    status: 'open',
    created_at: binding.createdAt ?? 1785935000000,
    updated_at: binding.createdAt ?? 1785935000000,
    metadata_dlq_id: binding.dlqId,
    operation_id: null,
    original_work_key: binding.originalWorkKey,
    generation: incident.requestedAt,
    original_requested_at: incident.requestedAt,
    main_queue_attempts: binding.mainQueueAttempts,
    dlq_delivery_attempts: binding.dlqDeliveryAttempts,
    recovery_status: 'not_started',
    recovery_reference: null,
    audit_reference: null,
    ...overrides,
  };
}

function preflight(overrides = {}) {
  return {
    coverage_status: 'complete',
    coverage_dataset_key: incident.coverageDatasetKey,
    source_scope: incident.sourceScope,
    source_watermark: incident.sourceWatermark,
    period_end: incident.periodEnd,
    [incident.sourceFactField]: 630,
    active_report_work_count: 0,
    active_report_locks: 0,
    open_report_dlq: 3,
    open_report_critical_alerts: 0,
    ...overrides,
  };
}

test('exact continuation v2 binds current main and retained Queue-activation attempt', () => {
  assert.equal(
    META_ADS_3D_D1_BIND_CONTINUATION_CONTRACT,
    'report_runtime_meta_ads_3d_queue_activation_continuation_v2',
  );
  assert.equal(incident.requiredRepositoryHead, 'd3bbaa33fb51874609dae2abd04ab0cd25f36ea9');
  assert.equal(incident.rootCause.uniqueAds3d, 102);
  assert.equal(incident.rootCause.preFixBindings3d, 105);
  assert.equal(incident.dlqs.length, 3);
  assert.equal(assertMetaAds3dRetainedAttempt({
    incidentKey: 'meta_ads_3d_d1_bind_20260731',
    reportId: incident.reportId,
    jobSha256: incident.jobSha256,
    continuationRequestedAt: incident.failedContinuationRequestedAt,
    retainedDlqIds: incident.dlqs.slice(0, 2).map((binding) => binding.dlqId),
  }), true);
  assert.throws(
    () => assertMetaAds3dRetainedAttempt({
      incidentKey: 'meta_ads_3d_d1_bind_20260731',
      reportId: incident.reportId,
      jobSha256: incident.jobSha256,
      continuationRequestedAt: incident.failedContinuationRequestedAt + 1,
      retainedDlqIds: incident.dlqs.slice(0, 2).map((binding) => binding.dlqId),
    }),
    (error) => error.code === 'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_ATTEMPT_MISMATCH',
  );
});

test('regenerated candidate remains byte-stable to the exact retained job identity', () => {
  assert.equal(assertMetaAds3dContinuationCandidate(candidate()), true);
  assert.throws(
    () => assertMetaAds3dContinuationCandidate({ ...candidate(), reportId: 'wrong' }),
    (error) => error.code === 'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_CANDIDATE_MISMATCH',
  );
});

test('root-cause evidence proves 1D below and 3D above the D1 binding ceiling', () => {
  const retryDlq = incident.dlqs[1];
  assert.equal(assertMetaAds3dRootCauseEvidence({
    entity: {
      ranking_rows_3d: 630,
      ranking_rows_1d: 210,
      unique_ads_3d: 102,
      unique_ads_1d: 77,
      pre_fix_entity_binding_count_3d: 105,
      pre_fix_entity_binding_count_1d: 80,
      classification: 'ENTITY_BIND_LIMIT_CONFIRMED',
    },
    dlq: {
      dlq_id: retryDlq.dlqId,
      message_id: retryDlq.messageId,
      queue_name: retryDlq.queueName,
      job_type: incident.jobType,
      schema_version: 1,
      error_code: retryDlq.errorCode,
      error_message: retryDlq.errorMessage,
      retry_count: 0,
      status: 'open',
      replay_payload_bytes: 354,
      replay_platform_scope: 'meta_ads',
      replay_window_days: 3,
      replay_report_setting_key: incident.reportSettingKey,
      replay_period_end: incident.periodEnd,
      replay_source_watermark: incident.sourceWatermark,
      replay_requested_at: new Date(incident.requestedAt).toISOString(),
      operation_id: null,
      original_work_key: retryDlq.originalWorkKey,
      generation: incident.requestedAt,
      original_requested_at: incident.requestedAt,
      main_queue_attempts: 0,
      dlq_delivery_attempts: 1,
      recovery_status: 'not_started',
    },
  }), true);
});

test('preflight requires all three exact open DLQs and zero active Report runtime', () => {
  assert.equal(assertMetaAds3dContinuationPreflight(preflight()), true);
  assert.throws(
    () => assertMetaAds3dContinuationPreflight(preflight({ open_report_dlq: 2 })),
    (error) => error.code === 'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_PREFLIGHT_MISMATCH',
  );
  assert.throws(
    () => assertMetaAds3dContinuationPreflight(preflight({ active_report_locks: 1 })),
    (error) => error.code === 'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_PREFLIGHT_MISMATCH',
  );
});

for (const binding of incident.dlqs) {
  test(`${binding.role} DLQ is exact and closure is independently guarded`, () => {
    const sql = buildMetaAds3dDlqSql(binding);
    assert.match(sql, /dead_letter_jobs/u);
    assert.match(sql, new RegExp(binding.messageId, 'u'));
    const evidence = assertMetaAds3dDlqRow(dlqRow(binding), binding);
    assert.equal(evidence.replayPayload.reportSettingKey, incident.reportSettingKey);
    assert.throws(
      () => assertMetaAds3dDlqRow(dlqRow(binding, { status: 'redriven' }), binding),
      (error) => error.code === 'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_DLQ_MISMATCH',
    );

    const statements = buildMetaAds3dClosureStatements(binding, 1785945000000);
    assert.equal(statements.length, 2);
    assert.match(statements[0], /status = 'redriven'/u);
    assert.equal(statements[0].includes(binding.closureReference), true);
    assert.equal(statements[1].includes(binding.originalWorkKey), true);
    assert.equal(statements[1].includes(`main_queue_attempts = ${binding.mainQueueAttempts}`), true);
    assert.equal(assertMetaAds3dDlqClosed({
      dlq_id: binding.dlqId,
      status: 'redriven',
      redrive_reference: binding.closureReference,
      recovery_status: 'completed',
      recovery_reference: binding.closureReference,
      audit_reference: binding.closureReference,
    }, binding), true);
  });
}

test('initial state binds six failed attempts, two prior successes and empty D1/Lark target', () => {
  assert.equal(assertMetaAds3dInitialState({
    d1: {
      report_id: null,
      materialization_count: 0,
      successful_sync_count: 2,
      active_lock_count: 0,
    },
    failed: {
      failed_sync_count: 6,
      active_sync_count: 0,
      retry_exhausted_dlq_count: 1,
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
    () => assertMetaAds3dInitialState({
      d1: { report_id: null, materialization_count: 0, successful_sync_count: 2, active_lock_count: 0 },
      failed: { failed_sync_count: 5, active_sync_count: 0, retry_exhausted_dlq_count: 1 },
      lark: { snapshots: 0, metrics: 0, topContent: 0, topAds: 0, duplicateMetricKeys: 0 },
    }),
    (error) => error.code === 'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_INITIAL_STATE_MISMATCH',
  );
});

test('poll and retained-state SQL are exact to the failed recovery and next continuation window', () => {
  const failedSql = buildMetaAds3dFailedRecoveryStateSql();
  assert.equal(failedSql.includes(String(incident.failedRecoveryRequestedAt)), true);
  assert.equal(failedSql.includes(incident.dlqs[1].dlqId), true);
  const pollSql = buildMetaAds3dContinuationPollSql(1785945000000);
  assert.equal(pollSql.includes('1785945000000'), true);
  assert.equal(pollSql.includes(incident.reportSettingKey), true);
  assert.equal(pollSql.includes(new Date(incident.requestedAt).toISOString()), true);
  assert.match(pollSql, /exact_new_dlq_count/u);
});

test('operator sends one first job and one replay, then closes all incident DLQs after restore', () => {
  const source = readFileSync(
    new URL('../../scripts/report-runtime-meta-ads-3d-d1-bind-continuation.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /repository\.head !== incident\.requiredRepositoryHead/u);
  assert.match(source, /send-exact-meta-ads-3d-continuation-once/u);
  assert.match(source, /send-exact-meta-ads-3d-replay-once/u);
  assert.match(source, /for \(const binding of incident\.dlqs\)/u);
  assert.equal((source.match(/sendReviewedQueueMessage\(/gu) ?? []).length, 2);
  assert.equal(source.indexOf("currentStage = 'close-both-exact-retained-dlqs'")
    > source.indexOf("currentStage = 'restore-preserved-notification-worker-baseline'"), true);
  assert.doesNotMatch(source, /report-runtime-reviewed-config-dlq-recovery\.mjs/u);
});
