import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkWeekly7dNotificationRuntimeWindow,
} from '../../scripts/lib/lark-weekly-7d-notification-runtime-window.js';

const TABLES = Object.freeze({
  aiRuns: 'tbl-ai',
  reportSnapshots: 'tbl-snapshots',
  reportSettings: 'tbl-settings',
  notificationLog: 'tbl-log',
});

function sourceConfig(overrides = {}) {
  return JSON.stringify({
    name: 'social-mkt-sync-worker',
    vars: {
      MKT_FACEBOOK_ENABLED: 'true',
      MKT_META_ENABLED: 'true',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'true',
      MKT_NOTIFICATION_RUNTIME_ENABLED: 'false',
      MKT_NOTIFICATION_LARK_SEND_ENABLED: 'false',
      MKT_NOTIFICATION_LARK_MIRROR_ENABLED: 'false',
      MKT_NOTIFICATION_RUNTIME_MODE: 'disabled',
      LARK_TABLE_MKT_AI_REPORT_RUNS: TABLES.aiRuns,
      LARK_TABLE_MKT_REPORT_SNAPSHOTS: TABLES.reportSnapshots,
      LARK_TABLE_MKT_REPORT_SETTINGS: TABLES.reportSettings,
      LARK_TABLE_MKT_NOTIFICATION_LOG: TABLES.notificationLog,
      ...overrides,
    },
    triggers: { crons: ['*/5 * * * *', '10 1 * * *', '15 1 * * 1'] },
  });
}

test('adds only Notification flags while preserving current source and Report schedules', () => {
  const window = buildLarkWeekly7dNotificationRuntimeWindow(sourceConfig(), TABLES);
  const active = JSON.parse(window.activeText);
  const restore = JSON.parse(window.restoreText);

  assert.equal(window.baselineNotificationOff, true);
  assert.equal(window.scheduleConfigPreserved, true);
  assert.deepEqual(active.triggers, restore.triggers);
  assert.equal(active.vars.MKT_FACEBOOK_ENABLED, 'true');
  assert.equal(active.vars.MKT_META_ENABLED, 'true');
  assert.equal(active.vars.MKT_SCHEDULE_DAILY_REPORT_ENABLED, 'true');
  assert.equal(active.vars.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED, 'true');
  assert.equal(active.vars.MKT_NOTIFICATION_RUNTIME_ENABLED, 'true');
  assert.equal(active.vars.MKT_NOTIFICATION_LARK_SEND_ENABLED, 'true');
  assert.equal(active.vars.MKT_NOTIFICATION_LARK_MIRROR_ENABLED, 'true');
  assert.equal(active.vars.MKT_NOTIFICATION_RUNTIME_MODE, 'runtime');
  assert.equal(restore.vars.MKT_NOTIFICATION_RUNTIME_ENABLED, 'false');
  assert.equal(restore.vars.MKT_SCHEDULE_DAILY_REPORT_ENABLED, 'true');
  assert.equal(restore.vars.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED, 'true');
  assert.deepEqual(
    window.activeTrueFlags.filter((name) => !window.sourceTrueFlags.includes(name)).sort(),
    [
      'MKT_NOTIFICATION_LARK_MIRROR_ENABLED',
      'MKT_NOTIFICATION_LARK_SEND_ENABLED',
      'MKT_NOTIFICATION_RUNTIME_ENABLED',
    ],
  );
});

test('fails closed when Notification is already active at baseline', () => {
  assert.throws(
    () => buildLarkWeekly7dNotificationRuntimeWindow(
      sourceConfig({ MKT_NOTIFICATION_RUNTIME_ENABLED: 'true' }),
      TABLES,
    ),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_RUNTIME_WINDOW_INVALID',
  );
});

test('fails closed on reviewed Lark table mapping drift', () => {
  assert.throws(
    () => buildLarkWeekly7dNotificationRuntimeWindow(
      sourceConfig({ LARK_TABLE_MKT_NOTIFICATION_LOG: 'wrong-table' }),
      TABLES,
    ),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_RUNTIME_WINDOW_INVALID',
  );
});
