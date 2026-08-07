import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReportRuntimeCloseoutCandidates,
} from '../../scripts/lib/report-runtime-closeout-operator.js';
import {
  CHATWOOT_1D_EXACT_INCIDENT,
  assertChatwoot1dContinuationCandidate,
  assertChatwoot1dExactIncident,
  assertChatwoot1dIncidentClosed,
  assertChatwoot1dIncidentPreflight,
  assertChatwoot1dInitialState,
  assertChatwoot1dMaterialization,
  buildChatwoot1dClosureReadbackSql,
  buildChatwoot1dClosureStatements,
  buildChatwoot1dContinuationPollSql,
  buildChatwoot1dExactIncidentSql,
} from '../../scripts/lib/report-runtime-chatwoot-1d-incident-continuation.js';

const incident = CHATWOOT_1D_EXACT_INCIDENT;

function candidate() {
  return buildReportRuntimeCloseoutCandidates({
    requestedAt: incident.requestedAt,
    periodEnd: incident.periodEnd,
    sourceWatermark: incident.sourceWatermark,
    timeZone: 'Asia/Bangkok',
    platformScope: incident.platformScope,
    accountKey: incident.accountKey,
    formulaVersion: incident.formulaVersion,
  }).find((row) => row.windowDays === incident.windowDays);
}

function preflight(overrides = {}) {
  return {
    coverage_status: 'complete',
    coverage_dataset_key: 'chatwoot.conversation_daily',
    coverage_scope_mode: null,
    source_watermark: incident.sourceWatermark,
    period_end: incident.periodEnd,
    source_scope: 'customer_service_daily',
    coverage_required_count: 2,
    coverage_watermark_count: 2,
    conversation_fact_count: incident.expectedConversationFactCount,
    account_fact_count: incident.expectedAccountFactCount,
    active_report_work_count: 0,
    active_report_locks: 0,
    open_report_dlq: 1,
    open_report_critical_alerts: 1,
    historical_connector_critical_alerts:
      incident.expectedHistoricalConnectorAlertCount,
    ...overrides,
  };
}

function exactIncidentRow(selected, overrides = {}) {
  return {
    exact_sync_count: 1,
    sync_run_id: incident.failedSync.syncRunId,
    sync_status: incident.failedSync.status,
    sync_error_code: incident.failedSync.errorCode,
    sync_error_message: incident.failedSync.errorMessage,
    exact_alert_count: 1,
    alert_id: 'alert-chatwoot-1d',
    alert_sync_run_id: incident.failedSync.syncRunId,
    alert_status: incident.alert.status,
    alert_error_code: incident.alert.errorCode,
    alert_message:
      `รอบ Sync ล้มเหลว error=${incident.failedSync.errorMessage}`,
    alert_created_at: incident.alert.createdAt,
    alert_updated_at: incident.alert.updatedAt,
    exact_dlq_count: 1,
    dlq_id: 'dlq:chatwoot-1d',
    message_id: 'chatwoot-1d-message',
    queue_name: 'social-mkt-sync-jobs',
    schema_version: 1,
    replay_payload_json: JSON.stringify(selected.job),
    dlq_error_code: incident.failedSync.errorCode,
    dlq_error_message: incident.failedSync.errorMessage,
    retry_count: 0,
    dlq_status: 'open',
    dlq_created_at: incident.failedSync.finishedAt + 1,
    operation_id: null,
    original_work_key: 'chatwoot:chatwoot-1d-message',
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

test('binds the exact Chatwoot 1D candidate and current source/runtime incident boundary', () => {
  const selected = candidate();
  const candidateEvidence = assertChatwoot1dContinuationCandidate(
    selected,
    incident,
  );
  assert.match(candidateEvidence.jobSha256, /^[0-9a-f]{64}$/u);
  assert.equal(assertChatwoot1dIncidentPreflight(preflight(), incident), true);

  assert.throws(
    () => assertChatwoot1dIncidentPreflight(
      preflight({ open_report_dlq: 0 }),
      incident,
    ),
    (error) => error?.code
      === 'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_PREFLIGHT_MISMATCH',
  );
});

test('binds exactly one failed Sync Run, one DLQ replay payload and one Critical Alert', () => {
  const selected = candidate();
  const binding = assertChatwoot1dExactIncident(
    exactIncidentRow(selected),
    selected,
    incident,
  );

  assert.equal(binding.syncRunId, incident.failedSync.syncRunId);
  assert.equal(binding.alertId, 'alert-chatwoot-1d');
  assert.equal(binding.dlqId, 'dlq:chatwoot-1d');
  assert.equal(binding.errorCode, incident.failedSync.errorCode);
  assert.equal(binding.replayPayload.reportSettingKey, incident.reportSettingKey);
  assert.equal(binding.closureReference, incident.closureReference);

  const driftedPayload = {
    ...selected.job,
    windowDays: 3,
  };
  assert.throws(
    () => assertChatwoot1dExactIncident(
      exactIncidentRow(selected, {
        replay_payload_json: JSON.stringify(driftedPayload),
      }),
      selected,
      incident,
    ),
    (error) => error?.code
      === 'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_INCIDENT_MISMATCH',
  );
});

test('requires an empty target before send and exact 139-row D1/Lark state after send', () => {
  assert.equal(assertChatwoot1dInitialState({
    d1: {
      report_id: null,
      materialization_count: 0,
      sync_status: incident.failedSync.status,
      successful_sync_count: 0,
      active_lock_count: 0,
      new_dlq_count: 1,
    },
    lark: {
      snapshots: 0,
      metrics: 0,
      topContent: 0,
      topAds: 0,
      duplicateMetricKeys: 0,
    },
  }, incident), true);

  assert.equal(assertChatwoot1dMaterialization({
    d1: {
      report_id: incident.reportId,
      materialization_count: 1,
      sync_status: 'success',
      successful_sync_count: 1,
      active_lock_count: 0,
    },
    lark: {
      snapshots: 1,
      metrics: incident.expectedMetricCount,
      topContent: 0,
      topAds: 0,
      duplicateMetricKeys: 0,
    },
  }, incident), true);

  assert.throws(
    () => assertChatwoot1dMaterialization({
      d1: {
        report_id: incident.reportId,
        materialization_count: 1,
        sync_status: 'success',
        successful_sync_count: 1,
        active_lock_count: 0,
      },
      lark: {
        snapshots: 1,
        metrics: incident.expectedMetricCount - 1,
        topContent: 0,
        topAds: 0,
        duplicateMetricKeys: 0,
      },
    }, incident),
    (error) => error?.code
      === 'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_MATERIALIZATION_MISMATCH',
  );
});

test('builds exact incident/poll SQL and bounded three-statement closure', () => {
  const selected = candidate();
  const binding = assertChatwoot1dExactIncident(
    exactIncidentRow(selected),
    selected,
    incident,
  );
  const incidentSql = buildChatwoot1dExactIncidentSql(incident);
  const pollSql = buildChatwoot1dContinuationPollSql(
    incident.failedSync.finishedAt + 1,
    incident,
  );
  const statements = buildChatwoot1dClosureStatements(
    binding,
    incident.failedSync.finishedAt + 2,
    incident,
  );
  const readbackSql = buildChatwoot1dClosureReadbackSql(
    binding,
    incident,
  );

  assert.match(incidentSql, new RegExp(incident.failedSync.syncRunId, 'u'));
  assert.match(incidentSql, /exact_dlq_count/u);
  assert.match(pollSql, /exact_new_dlq_count/u);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /WHERE dlq_id = 'dlq:chatwoot-1d'/u);
  assert.match(statements[1], /original_requested_at = 1786016588074/u);
  assert.match(statements[2], /WHERE alert_id = 'alert-chatwoot-1d'/u);
  assert.doesNotMatch(statements.join('\n'), /DELETE FROM/iu);
  assert.match(readbackSql, /open_report_critical_alert_count/u);
});

test('accepts only complete exact DLQ/Alert closure readback', () => {
  const selected = candidate();
  const binding = assertChatwoot1dExactIncident(
    exactIncidentRow(selected),
    selected,
    incident,
  );
  const row = {
    dlq_status: 'redriven',
    redrive_reference: binding.closureReference,
    recovery_status: 'completed',
    recovery_reference: binding.closureReference,
    audit_reference: binding.closureReference,
    alert_status: 'resolved',
    open_report_dlq_count: 0,
    open_report_critical_alert_count: 0,
  };
  assert.equal(assertChatwoot1dIncidentClosed(row, binding), true);
  assert.throws(
    () => assertChatwoot1dIncidentClosed({
      ...row,
      alert_status: 'open',
    }, binding),
    (error) => error?.code
      === 'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_CLOSURE_INCOMPLETE',
  );
});
