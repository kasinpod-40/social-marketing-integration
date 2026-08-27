import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAutomaticWeeklyExecutiveActivationConfig,
  buildAutomaticWeeklyExecutiveActiveBaseline,
  buildAutomaticWeeklyExecutiveSettingRows,
  readAutomaticWeeklyExecutiveSourceSettingRecords,
} from '../../scripts/lib/lark-automatic-weekly-executive-activation.js';

const TABLES = Object.freeze({
  aiRuns: 'tbl_ai',
  reportSnapshots: 'tbl_snapshots',
  reportSettings: 'tbl_settings',
  notificationLog: 'tbl_log',
});

function sourceConfig() {
  return JSON.stringify({
    name: 'social-mkt-sync-worker',
    triggers: { crons: ['*/5 * * * *'] },
    vars: {
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'true',
      MKT_REPORT_D1_READ_ENABLED: 'true',
      MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'true',
      MKT_SCHEDULE_FACEBOOK_ENABLED: 'true',
      MKT_NOTIFICATION_RUNTIME_ENABLED: 'false',
      MKT_NOTIFICATION_LARK_SEND_ENABLED: 'false',
      MKT_NOTIFICATION_LARK_MIRROR_ENABLED: 'false',
      MKT_NOTIFICATION_RUNTIME_MODE: 'disabled',
      LARK_TABLE_MKT_AI_REPORT_RUNS: 'tbl_ai',
      LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl_snapshots',
      LARK_TABLE_MKT_REPORT_SETTINGS: 'tbl_settings',
      LARK_TABLE_MKT_NOTIFICATION_LOG: 'tbl_log',
    },
  });
}

test('automatic Weekly activation changes only notification runtime and schedule gates', () => {
  const result = buildAutomaticWeeklyExecutiveActivationConfig(sourceConfig(), TABLES);
  const target = JSON.parse(result.targetText);
  assert.equal(target.vars.MKT_SCHEDULE_FACEBOOK_ENABLED, 'true');
  assert.equal(target.vars.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED, 'true');
  assert.equal(target.vars.MKT_NOTIFICATION_RUNTIME_ENABLED, 'true');
  assert.equal(target.vars.MKT_NOTIFICATION_LARK_SEND_ENABLED, 'true');
  assert.equal(target.vars.MKT_NOTIFICATION_LARK_MIRROR_ENABLED, 'true');
  assert.equal(target.vars.MKT_NOTIFICATION_RUNTIME_MODE, 'runtime');
  assert.equal(target.vars.MKT_SCHEDULE_WEEKLY_NOTIFICATION_ENABLED, 'true');
  assert.equal(target.vars.MKT_WEEKLY_NOTIFICATION_TIME, '09:30');
  assert.equal(target.vars.MKT_WEEKLY_NOTIFICATION_MAX_QUEUE_ATTEMPTS, '5');
  assert.deepEqual(target.triggers, { crons: ['*/5 * * * *'] });
  assert.deepEqual(result.changedEnabledFlags, [
    'MKT_NOTIFICATION_LARK_MIRROR_ENABLED',
    'MKT_NOTIFICATION_LARK_SEND_ENABLED',
    'MKT_NOTIFICATION_RUNTIME_ENABLED',
    'MKT_SCHEDULE_WEEKLY_NOTIFICATION_ENABLED',
  ]);
});

test('automatic Weekly activation refuses missing Report runtime or mapping drift', () => {
  const disabled = JSON.parse(sourceConfig());
  disabled.vars.MKT_REPORT_D1_READ_ENABLED = 'false';
  assert.throws(
    () => buildAutomaticWeeklyExecutiveActivationConfig(JSON.stringify(disabled), TABLES),
    (error) => error?.code === 'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_INVALID'
      && error?.details?.fieldName === 'MKT_REPORT_D1_READ_ENABLED',
  );

  const drift = JSON.parse(sourceConfig());
  drift.vars.LARK_TABLE_MKT_NOTIFICATION_LOG = 'wrong';
  assert.throws(
    () => buildAutomaticWeeklyExecutiveActivationConfig(JSON.stringify(drift), TABLES),
    (error) => error?.code === 'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_INVALID'
      && error?.details?.fieldName === 'LARK_TABLE_MKT_NOTIFICATION_LOG',
  );
});

test('automatic Weekly Settings plan activates only inactive exact source rows', () => {
  const authority = {
    baseline: [
      { reportSettingKey: 'a', aiEnabled: true, notificationEnabled: true },
      { reportSettingKey: 'b', aiEnabled: false, notificationEnabled: false },
    ],
  };
  assert.deepEqual(buildAutomaticWeeklyExecutiveSettingRows(authority), [{
    report_setting_key: 'b',
    ai_enabled: true,
    notification_enabled: true,
  }]);
  assert.deepEqual(buildAutomaticWeeklyExecutiveActiveBaseline(authority), [
    { reportSettingKey: 'a', aiEnabled: true, notificationEnabled: true },
    { reportSettingKey: 'b', aiEnabled: true, notificationEnabled: true },
  ]);
});

test('automatic Weekly activation reads raw Lark Setting records from canonical setting keys', async () => {
  const records = [
    {
      recordId: 'rec_a',
      fields: {
        report_setting_key: 'a',
        customer_profile: 'integration_workspace',
        enabled: true,
        ai_enabled: false,
        notification_enabled: false,
      },
    },
    {
      recordId: 'rec_b',
      fields: {
        report_setting_key: 'b',
        customer_profile: 'integration_workspace',
        enabled: true,
        ai_enabled: true,
        notification_enabled: true,
      },
    },
  ];
  const calls = [];
  const repository = {
    async listByFieldValues(tableId, fieldName, values) {
      calls.push({ tableId, fieldName, values });
      return records;
    },
  };

  const result = await readAutomaticWeeklyExecutiveSourceSettingRecords({
    repository,
    tableId: 'tbl_settings',
    sourceAuthorities: [
      { reportId: 'report_b', reportSettingKey: 'b' },
      { reportId: 'report_a', reportSettingKey: 'a' },
    ],
  });

  assert.equal(result, records);
  assert.deepEqual(calls, [{
    tableId: 'tbl_settings',
    fieldName: 'report_setting_key',
    values: ['a', 'b'],
  }]);
});
