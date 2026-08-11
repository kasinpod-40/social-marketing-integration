import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  resolveLarkWeekly7dNotificationSourceSettings,
} from '../../scripts/lib/lark-weekly-7d-notification-source-settings.js';

const GROUP_ID = 'weekly-reviewed-destination';
const DESTINATION_HASH = createHash('sha256').update(GROUP_ID).digest('hex');

function sourceAuthority(reportId, settingKey) {
  return { reportId, reportSettingKey: settingKey };
}
function setting(settingKey, overrides = {}) {
  return {
    recordId: `setting-${settingKey}`,
    fields: {
      report_setting_key: settingKey,
      customer_profile: 'integration_workspace',
      enabled: true,
      ai_enabled: false,
      notification_enabled: false,
      group_id: null,
      ...overrides,
    },
  };
}

function resolve(overrides = {}) {
  return resolveLarkWeekly7dNotificationSourceSettings({
    sourceReportIds: ['report-google-7d', 'report-meta-7d'],
    sourceAuthorities: [
      sourceAuthority('report-meta-7d', 'setting-meta-7d'),
      sourceAuthority('report-google-7d', 'setting-google-7d'),
    ],
    settings: [setting('setting-meta-7d'), setting('setting-google-7d')],
    expectedDestinationKeyHash: DESTINATION_HASH,
    ...overrides,
  });
}

test('resolves inactive Settings from canonical source authority without Report Snapshots', () => {
  const authority = resolve();
  assert.equal(authority.state, 'inactive');
  assert.equal(authority.destinationBaseline, 'unset');
  assert.deepEqual(authority.sourceReportIds, ['report-google-7d', 'report-meta-7d']);
  assert.deepEqual(authority.settingKeys, ['setting-google-7d', 'setting-meta-7d']);
  assert.equal(authority.baseline.length, 2);
  assert.equal(authority.baseline.every((row) => row.enabled), true);
  assert.equal(authority.baseline.every((row) => !row.aiEnabled), true);
  assert.equal(authority.baseline.every((row) => !row.notificationEnabled), true);
  assert.equal(authority.baseline.every((row) => row.groupId === null), true);
});

test('accepts one exact uniformly active retained baseline without changing runtime scheduling', () => {
  const authority = resolve({
    settings: [
      setting('setting-meta-7d', { ai_enabled: true, notification_enabled: true }),
      setting('setting-google-7d', { ai_enabled: true, notification_enabled: true }),
    ],
  });
  assert.equal(authority.state, 'active');
  assert.equal(authority.baseline.every((row) => row.aiEnabled), true);
  assert.equal(authority.baseline.every((row) => row.notificationEnabled), true);
});

test('accepts a retained reviewed destination but rejects any non-reviewed destination', () => {
  const authority = resolveLarkWeekly7dNotificationSourceSettings({
    sourceReportIds: ['report-current-7d'],
    sourceAuthorities: [sourceAuthority('report-current-7d', 'setting-current-7d')],
    settings: [setting('setting-current-7d', { group_id: GROUP_ID })],
    expectedDestinationKeyHash: DESTINATION_HASH,
  });
  assert.equal(authority.destinationBaseline, 'reviewed');
  assert.equal(authority.baseline[0].groupId, GROUP_ID);

  assert.throws(
    () => resolveLarkWeekly7dNotificationSourceSettings({
      sourceReportIds: ['report-current-7d'],
      sourceAuthorities: [sourceAuthority('report-current-7d', 'setting-current-7d')],
      settings: [setting('setting-current-7d', { group_id: 'other-destination' })],
      expectedDestinationKeyHash: DESTINATION_HASH,
    }),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_DESTINATION_INVALID',
  );
});

test('fails closed when canonical source authority is missing or mismatched', () => {
  assert.throws(
    () => resolve({ sourceAuthorities: [] }),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_REPORT_INVALID',
  );
  assert.throws(
    () => resolve({
      sourceAuthorities: [
        sourceAuthority('report-meta-7d', 'setting-meta-7d'),
        sourceAuthority('report-other-7d', 'setting-google-7d'),
      ],
    }),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_REPORT_INVALID',
  );
});

test('fails closed on partial activation or mixed active/inactive source Settings', () => {
  assert.throws(
    () => resolve({ settings: [setting('setting-meta-7d'), setting('setting-google-7d', { notification_enabled: true })] }),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID',
  );
  assert.throws(
    () => resolve({ settings: [setting('setting-meta-7d'), setting('setting-google-7d', { ai_enabled: true })] }),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID',
  );
  assert.throws(
    () => resolve({
      settings: [
        setting('setting-meta-7d', { ai_enabled: true, notification_enabled: true }),
        setting('setting-google-7d'),
      ],
    }),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID'
      && error.details.activeStateCount === 2,
  );
});
