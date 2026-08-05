import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sha256,
  stableJson,
} from '../../scripts/lib/report-runtime-closeout-reviewed-process.js';
import {
  WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT,
  assertWooCommerceReportD1Prestate,
  assertWooCommerceReportDimensionOptions,
  assertWooCommerceReportDlqClosed,
  assertWooCommerceReportFailedSync,
  assertWooCommerceReportFinalizerEvidence,
  assertWooCommerceReportOpenDlq,
  assertWooCommerceReportRetainedAttempt,
  assertWooCommerceReportWindowParity,
  buildWooCommerceReportDlqClosureStatements,
  classifyWooCommerceReportLarkState,
} from '../../scripts/lib/woocommerce-report-lark-incomplete-recovery.js';

const baseIncident = WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT;

function fixtureIncident() {
  const requestedAt = 1_785_961_183_475;
  const payload = {
    type: 'report.materialization.generate',
    trigger: 'dashboard_preset',
    platformScope: 'woocommerce',
    periodKind: 'rolling_days',
    windowDays: 1,
    periodEnd: '2026-07-31',
    reportSettingKey: 'integration_workspace:woocommerce:rolling:1d',
    requestedAt: new Date(requestedAt).toISOString(),
  };
  return {
    incident: Object.freeze({
      ...baseIncident,
      requestedAt,
      jobSha256: sha256(stableJson(payload)),
    }),
    payload: Object.freeze(payload),
  };
}

function errorMessage(incident) {
  return [
    'Lark preflight failed:',
    `report_metric_key=${incident.reportId}::metric::product::rank%3A1,`,
    `field=${incident.failedField}:`,
    `value "${incident.rejectedValue}" is not configured in destination select options`,
  ].join(' ');
}

test('exact retained attempt and safe Finalizer evidence are required', () => {
  assert.equal(assertWooCommerceReportRetainedAttempt({
    reportId: baseIncident.reportId,
    action: baseIncident.action,
    requestedAt: baseIncident.requestedAt,
    jobSha256: baseIncident.jobSha256,
  }), true);
  assert.throws(
    () => assertWooCommerceReportRetainedAttempt({
      reportId: baseIncident.reportId,
      action: baseIncident.action,
      requestedAt: baseIncident.requestedAt,
      jobSha256: '0'.repeat(64),
    }),
    { code: 'WOOCOMMERCE_REPORT_LARK_RECOVERY_ATTEMPT_MISMATCH' },
  );

  assert.equal(assertWooCommerceReportFinalizerEvidence({
    ok: true,
    contractVersion: 'report_runtime_finalize_v1',
    repository: { branch: 'main', clean: true },
    schema: { readbackActions: 0, conflicts: 0 },
    runtime: {
      notificationAdmissionEnabled: false,
      schedulesEnabled: false,
      workerDeployed: false,
      queueMessageSent: false,
      remoteD1Mutated: false,
    },
  }), true);
});

test('Shared Report dimension options include WooCommerce and Chatwoot values', () => {
  const expected = [
    'summary',
    'product',
    'payment_method',
    'shipping_method',
    'inbox',
    'agent',
  ];
  const fields = [{
    field_name: 'dimension_type',
    type: 3,
    property: { options: expected.map((name, index) => ({ name, id: `opt-${index}` })) },
  }];
  assert.deepEqual(assertWooCommerceReportDimensionOptions(fields), {
    fieldType: 3,
    options: expected,
  });
  assert.throws(
    () => assertWooCommerceReportDimensionOptions([{
      ...fields[0],
      property: { options: [{ name: 'summary' }, { name: 'product' }] },
    }]),
    { code: 'WOOCOMMERCE_REPORT_LARK_RECOVERY_DIMENSION_OPTIONS_INVALID' },
  );
});

test('failed Sync and exact open DLQ bind to the retained Lark option failure', () => {
  const { incident, payload } = fixtureIncident();
  const diagnostic = errorMessage(incident);
  const sync = assertWooCommerceReportFailedSync([{
    sync_run_id: 'sync-1',
    status: 'failed',
    started_at: incident.requestedAt + 1,
    finished_at: incident.requestedAt + 2,
    records_written: 0,
    records_skipped: 0,
    error_code: incident.errorCode,
    error_message: diagnostic,
  }], incident);
  assert.equal(sync.errorCode, incident.errorCode);

  const replayPayloadJson = stableJson(payload);
  const dlq = assertWooCommerceReportOpenDlq([{
    dlq_id: 'dlq-1',
    message_id: 'message-1',
    queue_name: 'social-mkt-sync-jobs',
    job_type: incident.jobType,
    schema_version: 1,
    replay_payload_json: replayPayloadJson,
    error_code: incident.errorCode,
    error_message: diagnostic,
    retry_count: 1,
    status: 'open',
    created_at: incident.requestedAt + 3,
    updated_at: incident.requestedAt + 3,
    redrive_requested_at: null,
    redrive_reference: null,
    redriven_at: null,
    metadata_dlq_id: 'dlq-1',
    operation_id: null,
    original_work_key: 'woocommerce:message-1',
    generation: 1,
    original_requested_at: incident.requestedAt,
    main_queue_attempts: 1,
    dlq_delivery_attempts: 0,
    recovery_status: 'not_started',
    recovery_reference: null,
    recovery_completed_at: null,
    audit_reference: null,
  }], incident);
  assert.equal(dlq.dlqIdFingerprint, sha256('dlq-1'));
  assert.equal(dlq.replayPayload.platformScope, 'woocommerce');

  const statements = buildWooCommerceReportDlqClosureStatements(dlq, incident.requestedAt + 10);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /UPDATE dead_letter_jobs/u);
  assert.match(statements[1], /UPDATE dead_letter_operation_metadata/u);

  assert.equal(assertWooCommerceReportDlqClosed({
    dlq_id: 'dlq-1',
    status: 'redriven',
    redrive_reference: dlq.closureReference,
    recovery_status: 'completed',
    recovery_reference: dlq.closureReference,
    audit_reference: dlq.closureReference,
  }, dlq), true);
});

test('D1 prestate, 58-row Lark shape and Dashboard window parity remain exact', () => {
  assert.equal(assertWooCommerceReportD1Prestate({
    report_id: baseIncident.reportId,
    materialization_count: 1,
    data_status: 'revisable',
    payload_checksum: 'a'.repeat(64),
    sync_status: 'failed',
    successful_sync_count: 0,
    active_lock_count: 0,
    new_dlq_count: 1,
  }), true);
  assert.equal(classifyWooCommerceReportLarkState({
    snapshots: 0,
    metrics: 0,
    topContent: 0,
    topAds: 0,
    duplicateMetricKeys: 0,
  }), 'empty');
  assert.equal(classifyWooCommerceReportLarkState({
    snapshots: 1,
    metrics: 58,
    topContent: 0,
    topAds: 0,
    duplicateMetricKeys: 0,
  }), 'complete');
  assert.throws(
    () => classifyWooCommerceReportLarkState({
      snapshots: 1,
      metrics: 13,
      topContent: 0,
      topAds: 0,
      duplicateMetricKeys: 0,
    }),
    { code: 'WOOCOMMERCE_REPORT_LARK_RECOVERY_PARTIAL_LARK_BLOCKED' },
  );

  const records = Array.from({ length: 58 }, (_, index) => ({
    record_id: `record-${index}`,
    fields: {
      window_days: 1,
      __mkt_legacy_window_days_single_select_v1: '1',
    },
  }));
  assert.deepEqual(assertWooCommerceReportWindowParity(records), {
    metricCount: 58,
    mismatchCount: 0,
  });
  records[0].fields.__mkt_legacy_window_days_single_select_v1 = '3';
  assert.throws(
    () => assertWooCommerceReportWindowParity(records),
    { code: 'WOOCOMMERCE_REPORT_LARK_RECOVERY_WINDOW_PARITY_INVALID' },
  );
});
