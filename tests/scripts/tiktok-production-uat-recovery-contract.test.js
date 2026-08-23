import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIKTOK_PRODUCTION_RECOVERY,
  assertDarkProductionConfig,
  buildIdempotencyEnvelope,
  buildRecoveryConfigText,
  buildRedriveEnvelope,
  validateRetainedDlqRow,
  validateSuccessfulSyncRun,
} from '../../scripts/lib/tiktok-production-uat-recovery-contract.js';

const DARK_CONFIG = `{
  "name": "social-mkt-sync-worker",
  "workers_dev": false,
  "vars": {
    "MKT_ENV": "production",
    "MKT_CUSTOMER_PROFILE": "chemistry_k",
    "MKT_CONNECTOR_TIKTOK_ENABLED": "false",
    "MKT_PRODUCTION_CONNECTOR_UAT_ENABLED": "false",
    "MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR": "",
    "MKT_DLQ_REDRIVE_ENABLED": "false",
    "MKT_SCHEDULE_TIKTOK_ENABLED": "false",
    "MKT_NOTIFICATION_RUNTIME_ENABLED": "false",
    "LARK_REQUEST_TIMEOUT_MS": "30000",
    "LARK_MAX_ATTEMPTS": "5"
  }
}`;

const ORIGINAL = Object.freeze({
  schemaVersion: 1,
  type: 'tiktok.creator.native.sync',
  trigger: 'production_connector_uat',
  requestedAt: '2026-08-22T10:43:35.801Z',
  metricDate: '2026-08-22',
});

test('dark config opens only TikTok/UAT/redrive with bounded Lark transport attempts', () => {
  assert.equal(assertDarkProductionConfig(DARK_CONFIG), true);
  const recovery = buildRecoveryConfigText(DARK_CONFIG);
  assert.match(recovery, /"MKT_CONNECTOR_TIKTOK_ENABLED": "true"/u);
  assert.match(recovery, /"MKT_PRODUCTION_CONNECTOR_UAT_ENABLED": "true"/u);
  assert.match(recovery, /"MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR": "tiktok"/u);
  assert.match(recovery, /"MKT_DLQ_REDRIVE_ENABLED": "true"/u);
  assert.match(recovery, /"LARK_REQUEST_TIMEOUT_MS": "15000"/u);
  assert.match(recovery, /"LARK_MAX_ATTEMPTS": "1"/u);
  assert.doesNotMatch(recovery, /"cpu_ms"/u);
  assert.match(recovery, /"MKT_SCHEDULE_TIKTOK_ENABLED": "false"/u);
  assert.match(recovery, /"MKT_NOTIFICATION_RUNTIME_ENABLED": "false"/u);
  assert.match(DARK_CONFIG, /"MKT_CONNECTOR_TIKTOK_ENABLED": "false"/u);
  assert.match(DARK_CONFIG, /"LARK_REQUEST_TIMEOUT_MS": "30000"/u);
  assert.match(DARK_CONFIG, /"LARK_MAX_ATTEMPTS": "5"/u);
});

test('recovery config preserves an existing account-supported CPU limit without changing it', () => {
  const withLimits = DARK_CONFIG.replace(
    '  "workers_dev": false,',
    '  "workers_dev": false,\n  "limits": { "cpu_ms": 30000 },',
  );
  const recovery = buildRecoveryConfigText(withLimits);
  assert.equal((recovery.match(/"cpu_ms"/gu) ?? []).length, 1);
  assert.match(recovery, /"cpu_ms": 30000/u);
});

test('canonical redrive envelope only points at the retained DLQ', () => {
  assert.deepEqual(buildRedriveEnvelope('terminal:f7081abcdef'), {
    body: {
      schemaVersion: 1,
      type: 'system.dead-letter.redrive',
      dlqId: 'terminal:f7081abcdef',
    },
  });
});

test('retained Production DLQ must preserve exact TikTok UAT trigger and metric date', () => {
  const retained = validateRetainedDlqRow({
    dlq_id: 'terminal:f7081abcdef',
    message_id: 'f7081abcdef',
    job_type: TIKTOK_PRODUCTION_RECOVERY.jobType,
    status: 'open',
    payload_json: JSON.stringify(ORIGINAL),
  });
  assert.equal(retained.dlqId, 'terminal:f7081abcdef');
  assert.deepEqual(retained.payload, ORIGINAL);
});

test('idempotency rerun reuses logical scope but gets a fresh generation', () => {
  const envelope = buildIdempotencyEnvelope({
    ...ORIGINAL,
    redriveOfDlqId: 'terminal:f7081abcdef',
    redriveReference: 'redrive:terminal:f7081abcdef:1',
  }, Date.parse('2026-08-22T12:00:00.000Z'));
  assert.equal(envelope.body.type, ORIGINAL.type);
  assert.equal(envelope.body.trigger, ORIGINAL.trigger);
  assert.equal(envelope.body.metricDate, ORIGINAL.metricDate);
  assert.equal(envelope.body.requestedAt, '2026-08-22T12:00:00.000Z');
  assert.equal('redriveOfDlqId' in envelope.body, false);
  assert.equal('redriveReference' in envelope.body, false);
});

test('idempotency proof rejects any created, updated, or written business row', () => {
  const base = {
    sync_run_id: 'run-1',
    customer_profile: 'chemistry_k',
    platform: 'tiktok',
    sync_type: 'native_import',
    status: 'success',
    error_code: null,
    records_created: 0,
    records_updated: 0,
    records_written: 0,
  };
  assert.equal(validateSuccessfulSyncRun(base, { idempotency: true }).sync_run_id, 'run-1');
  assert.throws(
    () => validateSuccessfulSyncRun({ ...base, records_written: 1 }, { idempotency: true }),
    (error) => error?.code === 'TIKTOK_PRODUCTION_IDEMPOTENCY_WRITE_DETECTED',
  );
});
