import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildLarkWeekly7dFullChannelRepairCompleteSql,
  buildLarkWeekly7dFullChannelRepairDeadLetterSql,
  buildLarkWeekly7dFullChannelRepairPrepareSql,
  buildLarkWeekly7dFullChannelRepairResolveAlertSql,
  selectLarkWeekly7dFullChannelRepairCandidate,
} from '../../scripts/lib/lark-weekly-7d-full-channel-delivery-repair.js';

const AI_RUN_KEY = `notification-weekly-7d:full-channel:${'a'.repeat(64)}`;
const OPERATION_ID = 'lark_weekly_7d_full_channel_1234567890abcdef';
const REQUESTED_AT = 1786290000000;
const PAYLOAD = Object.freeze({
  type: 'lark.notification.send',
  schemaVersion: 1,
  trigger: 'lark_notification_runtime',
  aiRunKey: AI_RUN_KEY,
  operationId: OPERATION_ID,
  workKey: `lark_notification:${OPERATION_ID}`,
  generation: REQUESTED_AT,
  originalRequestedAt: REQUESTED_AT,
  requestedAt: new Date(REQUESTED_AT).toISOString(),
});
const JOB_SHA = createHash('sha256').update(JSON.stringify(PAYLOAD)).digest('hex');

function row(overrides = {}) {
  return {
    dlq_id: 'terminal:message-1',
    message_id: 'message-1',
    queue_name: 'main-queue',
    job_type: 'lark.notification.send',
    schema_version: 1,
    replay_payload_json: JSON.stringify(PAYLOAD),
    error_code: 'LARK_NOTIFICATION_RUNTIME_DISABLED',
    retry_count: 1,
    status: 'open',
    redrive_requested_at: null,
    redrive_reference: null,
    redriven_at: null,
    open_alert_count: 1,
    ...overrides,
  };
}

test('repair selects one exact runtime-rejected notification payload with stable identity', () => {
  const selected = selectLarkWeekly7dFullChannelRepairCandidate([row()], {
    aiRunKey: AI_RUN_KEY,
    operationId: OPERATION_ID,
    jobSha256: JOB_SHA,
    allowedStatuses: ['open'],
  });
  assert.equal(selected.dlqId, 'terminal:message-1');
  assert.equal(selected.errorCode, 'LARK_NOTIFICATION_RUNTIME_DISABLED');
  assert.equal(selected.operation.stable, true);
  assert.equal(selected.operation.operationId, OPERATION_ID);
});

test('repair rejects a non-runtime dead letter before replay', () => {
  assert.throws(
    () => selectLarkWeekly7dFullChannelRepairCandidate([row({ error_code: 'LARK_MESSAGE_SEND_FAILED' })], {
      aiRunKey: AI_RUN_KEY,
      operationId: OPERATION_ID,
      jobSha256: JOB_SHA,
      allowedStatuses: ['open'],
    }),
    (error) => error?.code === 'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_ERROR_UNSUPPORTED',
  );
});

test('repair rejects replay payload drift from immutable queue-attempt evidence', () => {
  assert.throws(
    () => selectLarkWeekly7dFullChannelRepairCandidate([row()], {
      aiRunKey: AI_RUN_KEY,
      operationId: OPERATION_ID,
      jobSha256: 'b'.repeat(64),
      allowedStatuses: ['open'],
    }),
    (error) => error?.code === 'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_IDENTITY_MISMATCH',
  );
});

test('repair SQL is exact-scope and lifecycle bounded', () => {
  assert.match(buildLarkWeekly7dFullChannelRepairDeadLetterSql(), /job_type = 'lark\.notification\.send'/u);
  const selected = selectLarkWeekly7dFullChannelRepairCandidate([row()], {
    aiRunKey: AI_RUN_KEY,
    operationId: OPERATION_ID,
    jobSha256: JOB_SHA,
  });
  const prepared = buildLarkWeekly7dFullChannelRepairPrepareSql(selected, {
    now: REQUESTED_AT,
    redriveReference: 'repair:abc',
  });
  assert.match(prepared, /status = 'redrive_pending'/u);
  assert.match(prepared, /WHERE dlq_id = 'terminal:message-1' AND status = 'open'/u);
  const completed = buildLarkWeekly7dFullChannelRepairCompleteSql(selected, {
    now: REQUESTED_AT + 1,
    redriveReference: 'repair:abc',
  });
  assert.match(completed, /status = 'redriven'/u);
  const alert = buildLarkWeekly7dFullChannelRepairResolveAlertSql(selected, { now: REQUESTED_AT + 1 });
  assert.match(alert, /alert:terminal:message-1/u);
});
