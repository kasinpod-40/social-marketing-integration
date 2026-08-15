import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIKTOK_RESOLVED_GENERATION_ALERT,
  TIKTOK_RESOLVED_GENERATION_ALERTS,
  TIKTOK_RESOLVED_GENERATION_ALERT_CONFIRMATION,
  assertTikTokResolvedGenerationAlertConfirmation,
  buildTikTokResolvedGenerationAlertClosureSql,
  buildTikTokResolvedGenerationAlertEvidenceSql,
  validateTikTokResolvedGenerationAlertClosureRow,
  validateTikTokResolvedGenerationAlertEvidence,
} from '../../scripts/lib/tiktok-resolved-generation-alert-closeout.js';

test('builds exact read-only evidence without replay or broad alert selection', () => {
  const sql = buildTikTokResolvedGenerationAlertEvidenceSql();
  assert.match(sql, new RegExp(TIKTOK_RESOLVED_GENERATION_ALERT.alertId, 'u'));
  assert.match(sql, /AS incident_sync_status/u);
  assert.match(sql, /AS newer_two_work_status/u);
  assert.doesNotMatch(sql, /UPDATE|DELETE|INSERT/iu);
});

test('accepts only the exact successful generation chain with no live lock or DLQ', () => {
  const incident = TIKTOK_RESOLVED_GENERATION_ALERT;
  const row = {
    alert_status: 'open',
    alert_platform: 'tiktok',
    alert_type: 'sync_partial_write',
    alert_error_code: 'SYNC_PARTIAL_WRITE',
    alert_sync_run_id: incident.syncRunId,
    closure_reference: null,
    incident_sync_status: 'success',
    incident_records_written: incident.recordsWritten,
    incident_work_status: 'completed',
    incident_generation: incident.generation,
    newer_one_sync_status: 'success',
    newer_one_records_written: incident.newerGenerations[0].recordsWritten,
    newer_one_work_status: 'completed',
    newer_one_generation: incident.newerGenerations[0].generation,
    newer_two_sync_status: 'success',
    newer_two_records_written: incident.newerGenerations[1].recordsWritten,
    newer_two_work_status: 'completed',
    newer_two_generation: incident.newerGenerations[1].generation,
    active_tiktok_locks: 0,
    current_tiktok_dlq: 0,
  };
  assert.deepEqual(validateTikTokResolvedGenerationAlertEvidence(row), { alreadyResolved: false });
  assert.throws(
    () => validateTikTokResolvedGenerationAlertEvidence({ ...row, active_tiktok_locks: 1 }),
    (error) => error?.code === 'TIKTOK_RESOLVED_GENERATION_ALERT_EVIDENCE_MISMATCH',
  );
});

test('recognizes only this operator closure as an idempotent resolved state', () => {
  const incident = TIKTOK_RESOLVED_GENERATION_ALERT;
  const row = {
    alert_status: 'resolved',
    alert_platform: 'tiktok', alert_type: 'sync_partial_write', alert_error_code: 'SYNC_PARTIAL_WRITE',
    alert_sync_run_id: incident.syncRunId, closure_reference: incident.closureReference,
    incident_sync_status: 'success', incident_records_written: incident.recordsWritten,
    incident_work_status: 'completed', incident_generation: incident.generation,
    newer_one_sync_status: 'success', newer_one_records_written: incident.newerGenerations[0].recordsWritten,
    newer_one_work_status: 'completed', newer_one_generation: incident.newerGenerations[0].generation,
    newer_two_sync_status: 'success', newer_two_records_written: incident.newerGenerations[1].recordsWritten,
    newer_two_work_status: 'completed', newer_two_generation: incident.newerGenerations[1].generation,
    active_tiktok_locks: 0, current_tiktok_dlq: 0,
  };
  assert.deepEqual(validateTikTokResolvedGenerationAlertEvidence(row), { alreadyResolved: true });
  assert.throws(() => validateTikTokResolvedGenerationAlertEvidence({ ...row, closure_reference: 'other' }));
});

test('closure changes only the exact alert and records the classification', () => {
  const sql = buildTikTokResolvedGenerationAlertClosureSql(1786780000000);
  assert.match(sql, /WHERE alert_id='1a2a3464-c5ce-4e7a-bfa9-ec34738ea3a7'/u);
  assert.match(sql, /resolved_by_new_generation/u);
  assert.match(sql, /status='open'/u);
  for (const newer of TIKTOK_RESOLVED_GENERATION_ALERT.newerGenerations) {
    assert.match(sql, new RegExp(newer.syncRunId, 'u'));
    assert.match(sql, new RegExp(newer.workKey, 'u'));
  }
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM dead_letter_jobs/u);
  assert.doesNotMatch(sql, /DELETE|INSERT/iu);
  assert.deepEqual(validateTikTokResolvedGenerationAlertClosureRow({ resolved_alert_rows: 1 }), {
    resolvedAlertRows: 1,
  });
});

test('requires the exact execution confirmation', () => {
  assert.throws(() => assertTikTokResolvedGenerationAlertConfirmation('wrong'));
  assert.doesNotThrow(() => assertTikTokResolvedGenerationAlertConfirmation(
    TIKTOK_RESOLVED_GENERATION_ALERT_CONFIRMATION,
  ));
});

test('legacy closeout remains separately pinned to one exact successful generation', () => {
  const legacy = TIKTOK_RESOLVED_GENERATION_ALERTS.legacy;
  const sql = buildTikTokResolvedGenerationAlertClosureSql(1786780000000, legacy);
  assert.match(sql, new RegExp(legacy.alertId, 'u'));
  assert.match(sql, new RegExp(String(legacy.generation), 'u'));
  assert.doesNotMatch(sql, new RegExp(TIKTOK_RESOLVED_GENERATION_ALERT.alertId, 'u'));
});
