import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONFIRMATION,
  LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_EXPECTED_ACTIVE_VERSION,
  assertLarkNotificationRuntimeSmokeTestBaseline,
  assertLarkNotificationRuntimeSmokeTestConfirmation,
  assertLarkNotificationRuntimeSmokeTestDelivered,
  assertLarkNotificationRuntimeSmokeTestStable,
  buildLarkNotificationRuntimeSmokeTestJob,
  buildLarkNotificationRuntimeSmokeTestReadbackSql,
  buildLarkNotificationRuntimeSmokeTestRow,
  parseLarkNotificationRuntimeSmokeTestDeploymentStatus,
} from '../../scripts/lib/lark-notification-runtime-smoke-test.js';
import {
  JOB_SCHEMA_VERSIONS,
  JOB_TRIGGERS,
  JOB_TYPES,
} from '../../packages/application/src/jobs/job-catalog.js';

const REPOSITORY_HEAD = 'a'.repeat(40);

function preview(overrides = {}) {
  return {
    recordId: 'preview-1d',
    fields: {
      ai_run_key: 'preview:executive:1d',
      report_id: 'preview:executive:1d',
      scope_type: 'executive',
      channel_key: 'executive',
      capability: 'cross_channel',
      window_days: '1',
      generation_status: 'generated',
      notification_eligible: false,
      notification_reason: 'controlled_preview',
      preview_mode: true,
      sent_to_group: false,
      sent_at: null,
      readiness_status: 'report_partial',
      severity: 'warning',
      source_report_ids_json: JSON.stringify(['source-report-1']),
      dedupe_key: 'b'.repeat(64),
      insight_summary: 'สรุปภาพรวม',
      strengths: 'จุดแข็ง',
      weaknesses: 'จุดที่ต้องระวัง',
      recommendations: 'ข้อเสนอแนะ',
      generated_at: 1_785_758_350_638,
      ...overrides,
    },
  };
}

function baseline() {
  return {
    notificationTableCount: 1,
    notificationIndexCount: 3,
    activeLocks: 0,
    totalDeliveryRows: 1,
    sentMirroredRows: 1,
    unsafeDeliveryRows: 0,
    controlledUatRows: 1,
    controlledUatSentMirroredRows: 1,
    smokeDeliveryRows: 0,
    smokeDeliveryStatus: null,
    smokeMirrorStatus: null,
    smokeClaimCount: 0,
    smokeSentAt: null,
    smokeMessageIdHash: null,
  };
}

function delivered() {
  return {
    ...baseline(),
    totalDeliveryRows: 2,
    sentMirroredRows: 2,
    smokeDeliveryRows: 1,
    smokeDeliveryStatus: 'sent',
    smokeMirrorStatus: 'mirrored',
    smokeClaimCount: 1,
    smokeSentAt: 1_800_000_000_000,
    smokeMessageIdHash: 'c'.repeat(64),
  };
}

test('builds one deterministic non-UAT Runtime smoke AI identity', () => {
  const source = preview();
  const first = buildLarkNotificationRuntimeSmokeTestRow(source, REPOSITORY_HEAD);
  const second = buildLarkNotificationRuntimeSmokeTestRow(source, REPOSITORY_HEAD);

  assert.equal(first.aiRunKey, second.aiRunKey);
  assert.match(first.aiRunKey, /^notification-runtime-smoke:[a-f0-9]{64}$/u);
  assert.doesNotMatch(first.aiRunKey, /^notification-uat:/u);
  assert.equal(first.fields.notification_eligible, true);
  assert.equal(first.fields.notification_reason, 'runtime_smoke_test');
  assert.equal(first.fields.preview_mode, false);
  assert.equal(first.fields.sent_to_group, false);
  assert.equal(first.fields.generation_status, 'generated');
  assert.deepEqual(first.sourceReportIds, ['source-report-1']);
  assert.equal(source.fields.preview_mode, true);
  assert.equal(source.fields.notification_eligible, false);
});

test('binds the smoke Job to the existing Runtime trigger and stable Queue identity', () => {
  const smoke = buildLarkNotificationRuntimeSmokeTestRow(preview(), REPOSITORY_HEAD);
  const job = buildLarkNotificationRuntimeSmokeTestJob({
    aiRunKey: smoke.aiRunKey,
    operationId: 'lark_notification_runtime_smoke_test',
    requestedAt: 1_800_000_000_000,
  });

  assert.equal(job.type, JOB_TYPES.LARK_NOTIFICATION_SEND);
  assert.equal(job.schemaVersion, JOB_SCHEMA_VERSIONS.LARK_NOTIFICATION_RUNTIME);
  assert.equal(job.trigger, JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME);
  assert.equal(job.aiRunKey, smoke.aiRunKey);
  assert.equal(job.operationId, 'lark_notification_runtime_smoke_test');
  assert.equal(job.workKey, 'lark_notification:lark_notification_runtime_smoke_test');
  assert.equal(job.generation, 1_800_000_000_000);
  assert.equal(job.originalRequestedAt, 1_800_000_000_000);
});

test('requires the separate exact Runtime smoke confirmation', () => {
  assert.throws(
    () => assertLarkNotificationRuntimeSmokeTestConfirmation({}),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertLarkNotificationRuntimeSmokeTestConfirmation({
    [LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONFIRMATION.envName]:
      LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONFIRMATION.value,
  }), true);
});

test('requires the reviewed active Worker version to serve all traffic', () => {
  const output = JSON.stringify({
    deployments: [{
      versions: [{
        version_id: LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_EXPECTED_ACTIVE_VERSION,
        percentage: 100,
      }],
    }],
  });
  assert.deepEqual(parseLarkNotificationRuntimeSmokeTestDeploymentStatus(output), {
    activeVersionId: LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_EXPECTED_ACTIVE_VERSION,
    trafficPercentage: 100,
    allocationCount: 1,
  });
  assert.throws(
    () => parseLarkNotificationRuntimeSmokeTestDeploymentStatus(JSON.stringify({
      versions: [
        {
          version_id: LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_EXPECTED_ACTIVE_VERSION,
          percentage: 90,
        },
        {
          version_id: '11111111-1111-4111-8111-111111111111',
          percentage: 10,
        },
      ],
    })),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_DEPLOYMENT_INVALID',
  );
});

test('accepts the retained baseline and proves exactly one new sent mirrored delivery', () => {
  assert.equal(assertLarkNotificationRuntimeSmokeTestBaseline(baseline()).totalDeliveryRows, 1);
  const result = assertLarkNotificationRuntimeSmokeTestDelivered(baseline(), delivered());
  assert.equal(result.deliveryRowsBefore, 1);
  assert.equal(result.deliveryRowsAfter, 2);
  assert.equal(result.additionalDeliveryRows, 1);
  assert.equal(result.additionalMessageSendCount, 1);
  assert.equal(result.smokeDeliveryStatus, 'sent');
  assert.equal(result.smokeMirrorStatus, 'mirrored');

  assert.throws(
    () => assertLarkNotificationRuntimeSmokeTestDelivered(baseline(), {
      ...delivered(),
      totalDeliveryRows: 3,
      sentMirroredRows: 3,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_DELIVERY_NOT_CONFIRMED',
  );
});

test('proves no duplicate delivery without a second Queue admission', () => {
  assert.deepEqual(assertLarkNotificationRuntimeSmokeTestStable(delivered(), delivered()), {
    exactDeliveryRows: 1,
    duplicateDeliveryRows: 0,
    additionalMessageSendCountDuringObservation: 0,
    sentAtStable: true,
    messageIdHashStable: true,
  });
  assert.throws(
    () => assertLarkNotificationRuntimeSmokeTestStable(delivered(), {
      ...delivered(),
      smokeClaimCount: 2,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_STABILITY_FAILED',
  );
});

test('readback SQL is SELECT-only and covers exact plus retained delivery authority', () => {
  const sql = buildLarkNotificationRuntimeSmokeTestReadbackSql(
    "notification-runtime-smoke:key'escaped",
  );
  assert.match(sql, /^SELECT /u);
  assert.match(sql, /notification-uat:%/u);
  assert.match(sql, /notification-runtime-smoke:key''escaped/u);
  assert.match(sql, /smoke_message_id_hash/u);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|ALTER|DROP)\b/iu);
});
