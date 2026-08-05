import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import {
  LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONFIRMATION,
  assertLarkNotificationRuntimeSmokeRecoveryConfirmation,
  assertLarkNotificationRuntimeSmokeRecoveryDelivered,
  assertLarkNotificationRuntimeSmokeRecoveryEvidence,
  assertLarkNotificationRuntimeSmokeRecoveryStable,
  classifyLarkNotificationRuntimeSmokeRecoveryReadback,
  normalizeLarkNotificationRuntimeSmokeRecoveryReadback,
  selectLarkNotificationRuntimeSmokeRecoveryAiRow,
} from '../../scripts/lib/lark-notification-runtime-smoke-recovery.js';

const HEAD = '9ca8091a3e258813793f88499d931b2f9da62a59';
const AI_KEY = `notification-runtime-smoke:${'a'.repeat(64)}`;
const AI_HASH = createHash('sha256').update(AI_KEY).digest('hex');

function evidence() {
  return assertLarkNotificationRuntimeSmokeRecoveryEvidence({
    directoryHead: HEAD,
    preflight: {
      contractVersion: 'lark_notification_runtime_smoke_test_v1',
      repositoryHead: HEAD,
      smokeAiRunKeyHash: AI_HASH,
      deliveryRowsBefore: 1,
      notificationLogRowsBefore: 1,
      activatedReportSettingCount: 4,
      controlledUatStable: true,
      queueAdmissionCount: 0,
      workerDeploymentCount: 0,
      reportSettingWriteCount: 0,
      automationActivationCount: 0,
      scheduleActivationCount: 0,
      production: 'BLOCKED',
    },
    attempt: {
      contractVersion: 'lark_notification_runtime_smoke_test_v1',
      repositoryHead: HEAD,
      aiRunKeyHash: AI_HASH,
      operationIdHash: 'b'.repeat(64),
      jobSha256: 'c'.repeat(64),
      attemptedAt: '2026-08-05T02:10:00.000Z',
      maximumQueueAdmissionCount: 1,
    },
  });
}

function row(overrides = {}) {
  return {
    notification_table_count: 1,
    notification_index_count: 3,
    active_locks: 0,
    total_delivery_rows: 2,
    sent_mirrored_rows: 1,
    unsafe_delivery_rows: 1,
    controlled_uat_rows: 1,
    controlled_uat_sent_mirrored_rows: 1,
    smoke_delivery_rows: 1,
    smoke_delivery_status: 'sending',
    smoke_mirror_status: 'pending',
    smoke_claim_count: 1,
    smoke_sent_at: null,
    smoke_message_id_hash: null,
    ...overrides,
  };
}

test('requires the exact poll-only recovery confirmation', () => {
  assert.throws(
    () => assertLarkNotificationRuntimeSmokeRecoveryConfirmation({}),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertLarkNotificationRuntimeSmokeRecoveryConfirmation({
    [LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONFIRMATION.envName]:
      LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONFIRMATION.value,
  }), true);
});

test('accepts exactly one in-flight smoke row while retaining all other terminal parity', () => {
  const normalized = normalizeLarkNotificationRuntimeSmokeRecoveryReadback(row());
  assert.equal(normalized.unsafeDeliveryRows, 1);
  assert.equal(classifyLarkNotificationRuntimeSmokeRecoveryReadback(normalized).state, 'in_flight');

  assert.throws(
    () => normalizeLarkNotificationRuntimeSmokeRecoveryReadback(row({
      unsafe_delivery_rows: 2,
      total_delivery_rows: 3,
    })),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_REMOTE_STATE_INVALID',
  );
  assert.throws(
    () => normalizeLarkNotificationRuntimeSmokeRecoveryReadback(row({
      smoke_delivery_status: 'sent',
      smoke_mirror_status: 'mirrored',
    })),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_REMOTE_STATE_INVALID',
  );
});

test('closes one terminal sent and mirrored delivery from the retained preflight baseline', () => {
  const terminal = normalizeLarkNotificationRuntimeSmokeRecoveryReadback(row({
    sent_mirrored_rows: 2,
    unsafe_delivery_rows: 0,
    smoke_delivery_status: 'sent',
    smoke_mirror_status: 'mirrored',
    smoke_claim_count: 1,
    smoke_sent_at: 1785895800000,
    smoke_message_id_hash: 'd'.repeat(64),
  }));
  const delivered = assertLarkNotificationRuntimeSmokeRecoveryDelivered(evidence(), terminal);
  assert.equal(delivered.deliveryRowsBefore, 1);
  assert.equal(delivered.deliveryRowsAfter, 2);
  assert.equal(delivered.additionalMessageSendCount, 1);
  assert.deepEqual(assertLarkNotificationRuntimeSmokeRecoveryStable(delivered, terminal), {
    exactSmokeDeliveryRows: 1,
    duplicateDeliveryRows: 0,
    additionalQueueAdmissionCount: 0,
    additionalMessageSendCount: 0,
    sentAtStable: true,
    messageIdHashStable: true,
  });
});

test('resolves the retained Lark smoke identity only through the persisted SHA-256', () => {
  const selected = selectLarkNotificationRuntimeSmokeRecoveryAiRow([{
    recordId: 'smoke-record',
    fields: {
      ai_run_key: AI_KEY,
      scope_type: 'executive',
      notification_reason: 'runtime_smoke_test',
      preview_mode: false,
    },
  }], AI_HASH);
  assert.equal(selected.aiRunKey, AI_KEY);
  assert.throws(
    () => selectLarkNotificationRuntimeSmokeRecoveryAiRow([], AI_HASH),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_IDENTITY_INVALID',
  );
});
