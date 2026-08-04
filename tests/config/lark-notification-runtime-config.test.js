import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  readLarkNotificationRuntimeConfig,
} from '../../packages/config/src/lark-notification-runtime-config.js';

test('all notification runtime gates are false by default', () => {
  const config = readLarkNotificationRuntimeConfig({});
  assert.deepEqual(config.flags, {
    runtimeEnabled: false,
    sendEnabled: false,
    mirrorEnabled: false,
  });
  assert.equal(config.tables, null);
  assert.equal(config.destinationKeyHash, LARK_EXECUTIVE_DESTINATION_KEY_HASH);
  assert.equal(config.safety.scheduleEnabled, false);
  assert.equal(config.safety.production, 'BLOCKED');
});

test('send and mirror cannot enable without the D1 runtime gate', () => {
  for (const field of ['MKT_NOTIFICATION_LARK_SEND_ENABLED', 'MKT_NOTIFICATION_LARK_MIRROR_ENABLED']) {
    assert.throws(
      () => readLarkNotificationRuntimeConfig({ [field]: 'true' }),
      (error) => error.code === 'LARK_NOTIFICATION_RUNTIME_CONFIG_INVALID',
    );
  }
});

test('enabled runtime requires exact existing Lark tables and keeps send separate', () => {
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
  assert.equal(config.tables.notificationLog, null);
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
