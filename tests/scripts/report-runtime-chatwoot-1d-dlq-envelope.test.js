import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReportRuntimeCloseoutCandidates,
} from '../../scripts/lib/report-runtime-closeout-operator.js';
import {
  CHATWOOT_1D_EXACT_INCIDENT,
  assertChatwoot1dExactIncident,
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
    queue_name: 'social-mkt-sync-dlq',
    schema_version: 1,
    replay_payload_json: JSON.stringify(selected.job),
    dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
    dlq_error_message:
      'Cloudflare Queue moved this message to the dead-letter queue after retry exhaustion',
    retry_count: 0,
    dlq_status: 'open',
    dlq_created_at: incident.failedSync.finishedAt + 1,
    operation_id: null,
    original_work_key: 'chatwoot:chatwoot-1d-message',
    generation: incident.requestedAt,
    original_requested_at: incident.requestedAt,
    main_queue_attempts: 5,
    dlq_delivery_attempts: 1,
    recovery_status: 'not_started',
    recovery_reference: null,
    audit_reference: null,
    ...overrides,
  };
}

test('binds a retry-exhausted DLQ by exact payload and metadata without rewriting its error envelope', () => {
  const selected = candidate();
  const row = exactIncidentRow(selected);
  const binding = assertChatwoot1dExactIncident(
    row,
    selected,
    incident,
  );

  assert.equal(binding.errorCode, 'QUEUE_RETRY_EXHAUSTED');
  assert.equal(binding.mainQueueAttempts, 5);
  assert.equal(binding.dlqDeliveryAttempts, 1);
  assert.match(binding.errorMessageFingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(binding.replayPayload.reportSettingKey, incident.reportSettingKey);
});

test('still rejects Alert timestamp drift even when the DLQ payload is exact', () => {
  const selected = candidate();
  assert.throws(
    () => assertChatwoot1dExactIncident(
      exactIncidentRow(selected, {
        alert_updated_at: incident.alert.updatedAt + 1,
      }),
      selected,
      incident,
    ),
    (error) => error?.code
      === 'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_INCIDENT_MISMATCH',
  );
});
