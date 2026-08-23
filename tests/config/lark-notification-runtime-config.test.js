import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LARK_EXECUTIVE_DESTINATION_CHAT_NAME,
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  LARK_NOTIFICATION_RUNTIME_MODES,
  readLarkNotificationRuntimeConfig,
} from '../../packages/config/src/lark-notification-runtime-config.js';

test('all notification runtime gates are false by default', () => {
  const config = readLarkNotificationRuntimeConfig({});
  assert.deepEqual(config.flags, {
    runtimeEnabled: false,
    sendEnabled: false,
    mirrorEnabled: false,
  });
  assert.equal(config.mode, LARK_NOTIFICATION_RUNTIME_MODES.DISABLED);
  assert.equal(config.tables, null);
  assert.equal(config.destinationKeyHash, LARK_EXECUTIVE_DESTINATION_KEY_HASH);
  assert.equal(config.destinationChatName, LARK_EXECUTIVE_DESTINATION_CHAT_NAME);
  assert.equal(config.customerProfile, 'integration_workspace');
  assert.equal(config.safety.scheduleEnabled, false);
  assert.equal(config.safety.production, 'BLOCKED');
});

test('Customer Production runtime requires and retains exact destination authority', () => {
  const hash = 'b'.repeat(64);
  const config = readLarkNotificationRuntimeConfig({
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    MKT_NOTIFICATION_RUNTIME_ENABLED: 'true',
    MKT_NOTIFICATION_DESTINATION_KEY_HASH: hash,
    MKT_NOTIFICATION_DESTINATION_CHAT_NAME: 'Chemistry K — Marketing Alerts',
    LARK_TABLE_MKT_AI_REPORT_RUNS: 'tbl_ai',
    LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl_snapshots',
    LARK_TABLE_MKT_REPORT_SETTINGS: 'tbl_settings',
  });
  assert.equal(config.customerProfile, 'chemistry_k');
  assert.equal(config.destinationKeyHash, hash);
  assert.equal(config.destinationChatName, 'Chemistry K — Marketing Alerts');
});

test('Customer Production runtime fails closed without exact destination authority', () => {
  const base = {
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    MKT_NOTIFICATION_RUNTIME_ENABLED: 'true',
    LARK_TABLE_MKT_AI_REPORT_RUNS: 'tbl_ai',
    LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl_snapshots',
    LARK_TABLE_MKT_REPORT_SETTINGS: 'tbl_settings',
  };
  assert.throws(
    () => readLarkNotificationRuntimeConfig(base),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_CONFIG_INVALID'
      && error.details?.fieldName === 'MKT_NOTIFICATION_DESTINATION_KEY_HASH',
  );
  assert.throws(
    () => readLarkNotificationRuntimeConfig({
      ...base,
      MKT_NOTIFICATION_DESTINATION_KEY_HASH: 'c'.repeat(64),
    }),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_CONFIG_INVALID'
      && error.details?.fieldName === 'MKT_NOTIFICATION_DESTINATION_CHAT_NAME',
  );
});

test('send and mirror cannot enable without the D1 runtime gate', () => {
  for (const field of ['MKT_NOTIFICATION_LARK_SEND_ENABLED', 'MKT_NOTIFICATION_LARK_MIRROR_ENABLED']) {
    assert.throws(
      () => readLarkNotificationRuntimeConfig({ [field]: 'true' }),
      (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_CONFIG_INVALID',
    );
  }
});

test('disabled runtime rejects an active runtime mode', () => {
  assert.throws(
    () => readLarkNotificationRuntimeConfig({
      MKT_NOTIFICATION_RUNTIME_MODE: LARK_NOTIFICATION_RUNTIME_MODES.RUNTIME,
    }),
    (error) => (
      error.code === 'LARK_NOTIFICATION_RUNTIME_CONFIG_INVALID'
      && error.details?.fieldName === 'MKT_NOTIFICATION_RUNTIME_MODE'
    ),
  );
});

test('enabled runtime defaults to controlled-UAT mode for retained operators', () => {
  const config = readLarkNotificationRuntimeConfig({
    MKT_NOTIFICATION_RUNTIME_ENABLED: 'true',
    MKT_NOTIFICATION_LARK_SEND_ENABLED: 'false',
    MKT_NOTIFICATION_LARK_MIRROR_ENABLED: 'false',
    LARK_TABLE_MKT_AI_REPORT_RUNS: 'tbl_ai',
    LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl_snapshots',
    LARK_TABLE_MKT_REPORT_SETTINGS: 'tbl_settings',
  });
  assert.equal(config.flags.runtimeEnabled, true);
  assert.equal(config.flags.sendEnabled, false);
  assert.equal(config.mode, LARK_NOTIFICATION_RUNTIME_MODES.CONTROLLED_UAT);
  assert.equal(config.tables.notificationLog, null);
});

test('reviewed runtime mode is explicit and keeps schedule disabled', () => {
  const config = readLarkNotificationRuntimeConfig({
    MKT_NOTIFICATION_RUNTIME_ENABLED: 'true',
    MKT_NOTIFICATION_LARK_SEND_ENABLED: 'true',
    MKT_NOTIFICATION_LARK_MIRROR_ENABLED: 'true',
    MKT_NOTIFICATION_RUNTIME_MODE: 'runtime',
    LARK_TABLE_MKT_AI_REPORT_RUNS: 'tbl_ai',
    LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl_snapshots',
    LARK_TABLE_MKT_REPORT_SETTINGS: 'tbl_settings',
    LARK_TABLE_MKT_NOTIFICATION_LOG: 'tbl_log',
  });
  assert.equal(config.mode, LARK_NOTIFICATION_RUNTIME_MODES.RUNTIME);
  assert.deepEqual(config.flags, {
    runtimeEnabled: true,
    sendEnabled: true,
    mirrorEnabled: true,
  });
  assert.equal(config.safety.scheduleEnabled, false);
  assert.equal(config.safety.baseAutomationNotificationEnabled, false);
  assert.equal(config.safety.production, 'BLOCKED');
});

test('unknown runtime modes fail closed', () => {
  assert.throws(
    () => readLarkNotificationRuntimeConfig({
      MKT_NOTIFICATION_RUNTIME_ENABLED: 'true',
      MKT_NOTIFICATION_RUNTIME_MODE: 'automatic',
      LARK_TABLE_MKT_AI_REPORT_RUNS: 'tbl_ai',
      LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl_snapshots',
      LARK_TABLE_MKT_REPORT_SETTINGS: 'tbl_settings',
    }),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_CONFIG_INVALID',
  );
});

test('mirror gate requires the existing Notification Log table mapping', () => {
  assert.throws(
    () => readLarkNotificationRuntimeConfig({
      MKT_NOTIFICATION_RUNTIME_ENABLED: 'true',
      MKT_NOTIFICATION_LARK_MIRROR_ENABLED: 'true',
      LARK_TABLE_MKT_AI_REPORT_RUNS: 'tbl_ai',
      LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl_snapshots',
      LARK_TABLE_MKT_REPORT_SETTINGS: 'tbl_settings',
    }),
    (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_CONFIG_INVALID',
  );
});
