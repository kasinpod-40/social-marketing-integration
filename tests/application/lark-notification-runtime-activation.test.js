import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIRMATION,
  LARK_NOTIFICATION_RUNTIME_ROLLBACK_CONFIRMATION,
  assertLarkNotificationRuntimeActivationConfirmation,
  assertLarkNotificationRuntimeActivationStable,
  assertLarkNotificationRuntimeSettingsState,
  buildLarkNotificationRuntimeActivationReadbackSql,
  buildLarkNotificationRuntimeActivationWranglerConfig,
  resolveLarkNotificationRuntimeActivationSettings,
  selectLarkNotificationRuntimeExecutivePreviews,
} from '../../scripts/lib/lark-notification-runtime-activation.js';

const TEST_DESTINATION_HASH =
  '2682b75c9df1350ff5ee97b5c4f13ccbd0e973cab835c9a6306599526aec1a7a';

function preview(windowDays, generatedAt = 1000) {
  return {
    recordId: `preview-${windowDays}`,
    fields: {
      ai_run_key: `preview:executive:${windowDays}d`,
      report_id: `preview:executive:${windowDays}d`,
      scope_type: 'executive',
      window_days: String(windowDays),
      generation_status: 'generated',
      preview_mode: true,
      sent_to_group: false,
      readiness_status: 'report_partial',
      source_report_ids_json: JSON.stringify([`report-${windowDays}`]),
      dedupe_key: String(windowDays).padStart(64, 'a').slice(-64),
      insight_summary: `summary-${windowDays}`,
      strengths: `strength-${windowDays}`,
      weaknesses: `weakness-${windowDays}`,
      recommendations: `recommendation-${windowDays}`,
      generated_at: generatedAt,
    },
  };
}

function snapshots() {
  return [1, 3, 7, 30].map((windowDays) => ({
    recordId: `snapshot-${windowDays}`,
    fields: {
      report_id: `report-${windowDays}`,
      report_setting_key: `setting-${windowDays}`,
      customer_profile: 'integration_workspace',
    },
  }));
}

function settings(active = false) {
  return [1, 3, 7, 30].map((windowDays) => ({
    recordId: `setting-record-${windowDays}`,
    fields: {
      report_setting_key: `setting-${windowDays}`,
      customer_profile: 'integration_workspace',
      enabled: true,
      ai_enabled: active,
      notification_enabled: active,
      group_id: 'runtime-destination',
    },
  }));
}

test('selects one latest Executive Preview for every supported runtime window', () => {
  const selected = selectLarkNotificationRuntimeExecutivePreviews([
    preview(1, 1000),
    { ...preview(1, 2000), recordId: 'preview-1-latest' },
    preview(3),
    preview(7),
    preview(30),
  ]);
  assert.deepEqual(selected.map((record) => Number(record.fields.window_days)), [1, 3, 7, 30]);
  assert.equal(selected[0].recordId, 'preview-1-latest');
});

test('builds active runtime and safe rollback configs without changing cron triggers', () => {
  const source = JSON.stringify({
    name: 'social-mkt-sync-worker',
    vars: {
      MKT_META_ENABLED: 'true',
      MKT_NOTIFICATION_RUNTIME_ENABLED: 'false',
    },
    triggers: { crons: ['*/5 * * * *', '50 0 * * *'] },
  });
  const tables = {
    aiRuns: 'table-ai',
    reportSnapshots: 'table-snapshots',
    reportSettings: 'table-settings',
    notificationLog: 'table-log',
  };
  const active = buildLarkNotificationRuntimeActivationWranglerConfig(
    source,
    tables,
    { active: true },
  );
  const safe = buildLarkNotificationRuntimeActivationWranglerConfig(
    source,
    tables,
    { active: false },
  );
  assert.equal(active.config.vars.MKT_META_ENABLED, 'false');
  assert.equal(active.config.vars.MKT_NOTIFICATION_RUNTIME_ENABLED, 'true');
  assert.equal(active.config.vars.MKT_NOTIFICATION_LARK_SEND_ENABLED, 'true');
  assert.equal(active.config.vars.MKT_NOTIFICATION_LARK_MIRROR_ENABLED, 'true');
  assert.equal(active.config.vars.MKT_NOTIFICATION_RUNTIME_MODE, 'runtime');
  assert.equal(active.scheduleConfigPreserved, true);
  assert.equal(safe.config.vars.MKT_NOTIFICATION_RUNTIME_ENABLED, 'false');
  assert.equal(safe.config.vars.MKT_NOTIFICATION_RUNTIME_MODE, 'disabled');
  assert.deepEqual(active.config.triggers, safe.config.triggers);
});

test('resolves exact inactive Settings from four-window Executive source authority', () => {
  const previews = [1, 3, 7, 30].map((windowDays) => preview(windowDays));
  const authority = resolveLarkNotificationRuntimeActivationSettings({
    previews,
    snapshots: snapshots(),
    settings: settings(false),
    expectedState: 'inactive',
    expectedDestinationKeyHash: TEST_DESTINATION_HASH,
  });
  assert.deepEqual(authority.settingKeys, [
    'setting-1', 'setting-3', 'setting-30', 'setting-7',
  ]);
  assert.equal(authority.baseline.length, 4);
  assert.equal(authority.baseline.every((item) => !item.aiEnabled), true);
  assert.equal(authority.baseline.every((item) => !item.notificationEnabled), true);
  assert.equal(
    assertLarkNotificationRuntimeSettingsState(settings(false), authority, false),
    true,
  );
  assert.equal(
    assertLarkNotificationRuntimeSettingsState(settings(true), authority, true),
    true,
  );
});

test('activation Settings fail closed on destination or state drift', () => {
  const previews = [1, 3, 7, 30].map((windowDays) => preview(windowDays));
  assert.throws(
    () => resolveLarkNotificationRuntimeActivationSettings({
      previews,
      snapshots: snapshots(),
      settings: settings(false).map((row, index) => (
        index === 0 ? { ...row, fields: { ...row.fields, group_id: 'other' } } : row
      )),
      expectedDestinationKeyHash: TEST_DESTINATION_HASH,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_ACTIVATION_DESTINATION_INVALID',
  );
  assert.throws(
    () => resolveLarkNotificationRuntimeActivationSettings({
      previews,
      snapshots: snapshots(),
      settings: settings(true),
      expectedState: 'inactive',
      expectedDestinationKeyHash: TEST_DESTINATION_HASH,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SETTINGS_INVALID',
  );
});

test('requires explicit activation and rollback confirmations', () => {
  assert.throws(
    () => assertLarkNotificationRuntimeActivationConfirmation({}),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertLarkNotificationRuntimeActivationConfirmation({
    [LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIRMATION.envName]:
      LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIRMATION.value,
  }), true);
  assert.equal(assertLarkNotificationRuntimeActivationConfirmation({
    [LARK_NOTIFICATION_RUNTIME_ROLLBACK_CONFIRMATION.envName]:
      LARK_NOTIFICATION_RUNTIME_ROLLBACK_CONFIRMATION.value,
  }, 'rollback'), true);
});

test('readback requires terminal mirrored deliveries and remains stable without Queue admission', () => {
  const before = {
    notificationTableCount: 1,
    notificationIndexCount: 3,
    activeLocks: 0,
    deliveryRows: 1,
    sentMirroredRows: 1,
    unsafeDeliveryRows: 0,
    controlledUatRows: 1,
    controlledUatSentMirroredRows: 1,
  };
  assert.deepEqual(assertLarkNotificationRuntimeActivationStable(before, before), {
    deliveryRows: 1,
    sentMirroredRows: 1,
    additionalDeliveryRows: 0,
    additionalMessageSendCount: 0,
  });
  assert.throws(
    () => assertLarkNotificationRuntimeActivationStable(before, {
      ...before,
      deliveryRows: 2,
      sentMirroredRows: 2,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_ACTIVATION_DELIVERY_DRIFT',
  );

  const sql = buildLarkNotificationRuntimeActivationReadbackSql();
  assert.match(sql, /^SELECT /u);
  assert.match(sql, /unsafe_delivery_rows/u);
  assert.match(sql, /notification-uat:%/u);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|ALTER|DROP)\b/iu);
});
