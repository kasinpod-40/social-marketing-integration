import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT,
  assertReportRuntimeConfigDlqClosed,
  assertReportRuntimeConfigDlqIncident,
  assertReportRuntimeConfigDlqInitialState,
  assertReportRuntimeConfigDlqMetricRepairSummary,
  assertReportRuntimeConfigDlqRetryCompletion,
  assertReportRuntimeConfigDlqStableDeployment,
  buildReportRuntimeConfigDlqClosureStatements,
  buildReportRuntimeConfigDlqRetryStateSql,
} from '../../scripts/lib/report-runtime-config-dlq-recovery.js';

const INCIDENT = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;

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

test('exact Report configuration DLQ incident accepts only immutable observed identity', () => {
  assert.deepEqual(assertReportRuntimeConfigDlqIncident(incidentRow()), {
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
      () => assertReportRuntimeConfigDlqIncident(incidentRow(drift)),
      (error) => error.code === 'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT_MISMATCH',
    );
  }
});

test('metric repair and D1 initial state must exactly match the completed 3D incident', () => {
  assert.equal(assertReportRuntimeConfigDlqMetricRepairSummary({
    ok: true,
    contractVersion: 'report_runtime_metric_null_repair_v1',
    decision: 'EXACT_REPORT_METRIC_NULLS_REPAIRED',
    target: {
      platform: 'tiktok', capability: 'organic', operation: 'refresh', windowDays: 3, reportId: INCIDENT.reportId,
    },
    materialization: { payloadChecksum: INCIDENT.payloadChecksum },
    repair: {
      metricCount: 10,
      staleNullableCurrentCount: 6,
      nonRepairableCurrentMismatchCount: 0,
      firstMaterializationRetried: false,
      queueMessageSent: false,
      workerDeploymentAttempted: false,
      remoteD1Mutated: false,
    },
    readback: { mismatchCount: 0 },
    production: false,
  }), true);
  assert.equal(assertReportRuntimeConfigDlqInitialState({
    report_id: INCIDENT.reportId,
    payload_checksum: INCIDENT.payloadChecksum,
    materialization_count: 1,
    successful_sync_count: 1,
    active_lock_count: 0,
    exact_incident_count: 1,
    other_open_report_dlq: 0,
  }), true);
});

test('retry completion requires same materialization, second success, zero lock and no new DLQ', () => {
  assert.equal(assertReportRuntimeConfigDlqRetryCompletion({
    report_id: INCIDENT.reportId,
    payload_checksum: INCIDENT.payloadChecksum,
    materialization_count: 1,
    successful_sync_count: 2,
    latest_sync_status: 'success',
    active_lock_count: 0,
    new_dlq_count: 0,
  }), true);
  assert.throws(
    () => assertReportRuntimeConfigDlqRetryCompletion({
      report_id: INCIDENT.reportId,
      payload_checksum: INCIDENT.payloadChecksum,
      materialization_count: 1,
      successful_sync_count: 1,
      latest_sync_status: 'failed',
      active_lock_count: 0,
      new_dlq_count: 1,
    }),
    (error) => error.code === 'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_RETRY_INCOMPLETE',
  );
  const sql = buildReportRuntimeConfigDlqRetryStateSql(1785392000000);
  assert.match(sql, /created_at >= 1785392000000/u);
  assert.match(sql, new RegExp(INCIDENT.originalRequestedAt, 'u'));
});

test('active deployment must remain the same reviewed version and flag set across three samples', () => {
  const versionId = '11111111-2222-4333-8444-555555555555';
  assert.deepEqual(assertReportRuntimeConfigDlqStableDeployment([
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
    () => assertReportRuntimeConfigDlqStableDeployment([
      { versionId, trueFlags: [], mode: 'safe' },
      { versionId, trueFlags: [], mode: 'safe' },
      { versionId, trueFlags: [], mode: 'safe' },
    ], { versionId, trueFlags: ['MKT_REPORT_D1_READ_ENABLED'] }),
    (error) => error.code === 'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_DEPLOYMENT_NOT_STABLE',
  );
});

test('closure retains exact DLQ audit metadata without delete or business-table mutation', () => {
  const statements = buildReportRuntimeConfigDlqClosureStatements(1785393000000);
  assert.equal(statements.length, 2);
  const sql = statements.join('\n');
  assert.match(sql, /UPDATE dead_letter_jobs/u);
  assert.match(sql, /UPDATE dead_letter_operation_metadata/u);
  assert.match(sql, new RegExp(INCIDENT.dlqId, 'u'));
  assert.match(sql, new RegExp(INCIDENT.errorCode, 'u'));
  assert.match(sql, /operation_id IS NULL/u);
  assert.doesNotMatch(sql, /DELETE\s+FROM/iu);
  assert.doesNotMatch(sql, /report_materializations\s+SET|organic_content_|data_coverage_/iu);

  assert.equal(assertReportRuntimeConfigDlqClosed(incidentRow({
    status: 'redriven',
    redrive_reference: INCIDENT.closureReference,
    redriven_at: 1785393000000,
    recovery_status: 'completed',
    recovery_reference: INCIDENT.closureReference,
    recovery_completed_at: 1785393000000,
    audit_reference: INCIDENT.closureReference,
  })), true);
});
