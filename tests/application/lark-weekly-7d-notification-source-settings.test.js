import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  assertLarkWeekly7dNotificationSourceSettingsBaseline,
  normalizeLarkWeekly7dNotificationRestorableBaseline,
  resolveLarkWeekly7dNotificationSourceSettings,
  summarizeLarkWeekly7dNotificationSettingsBaseline,
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
  assert.equal(authority.activeSettingCount, 0);
  assert.equal(authority.inactiveSettingCount, 2);
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
  assert.equal(authority.activeSettingCount, 2);
  assert.equal(authority.inactiveSettingCount, 0);
  assert.equal(authority.baseline.every((row) => row.aiEnabled), true);
  assert.equal(authority.baseline.every((row) => row.notificationEnabled), true);
});

test('accepts mixed active/inactive source rows and retains the exact per-row restore baseline', () => {
  const settings = [
    setting('setting-meta-7d', { ai_enabled: true, notification_enabled: true }),
    setting('setting-google-7d'),
  ];
  const authority = resolve({ settings });

  assert.equal(authority.state, 'mixed');
  assert.equal(authority.activeSettingCount, 1);
  assert.equal(authority.inactiveSettingCount, 1);
  assert.deepEqual(authority.restorableBaseline, [
    {
      reportSettingKey: 'setting-google-7d',
      aiEnabled: false,
      notificationEnabled: false,
    },
    {
      reportSettingKey: 'setting-meta-7d',
      aiEnabled: true,
      notificationEnabled: true,
    },
  ]);
  assert.equal(
    assertLarkWeekly7dNotificationSourceSettingsBaseline(settings, authority),
    true,
  );
});

test('retained per-row baseline is normalized, summarized and checked exactly', () => {
  const authority = resolve({
    settings: [
      setting('setting-meta-7d', { ai_enabled: true, notification_enabled: true }),
      setting('setting-google-7d'),
    ],
  });
  const retained = normalizeLarkWeekly7dNotificationRestorableBaseline([
    {
      reportSettingKey: 'setting-meta-7d',
      aiEnabled: true,
      notificationEnabled: true,
    },
    {
      reportSettingKey: 'setting-google-7d',
      aiEnabled: false,
      notificationEnabled: false,
    },
  ]);
  assert.deepEqual(summarizeLarkWeekly7dNotificationSettingsBaseline(retained), {
    state: 'mixed',
    activeSettingCount: 1,
    inactiveSettingCount: 1,
    sourceSettingCount: 2,
  });
  assert.equal(
    assertLarkWeekly7dNotificationSourceSettingsBaseline([
      setting('setting-meta-7d', { ai_enabled: true, notification_enabled: true }),
      setting('setting-google-7d'),
    ], authority, retained),
    true,
  );
  assert.throws(
    () => assertLarkWeekly7dNotificationSourceSettingsBaseline([
      setting('setting-meta-7d', { ai_enabled: true, notification_enabled: true }),
      setting('setting-google-7d', { ai_enabled: true, notification_enabled: true }),
    ], authority, retained),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_READBACK_FAILED',
  );
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

test('fails closed on partial activation inside any one source Setting', () => {
  assert.throws(
    () => resolve({ settings: [setting('setting-meta-7d'), setting('setting-google-7d', { notification_enabled: true })] }),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID',
  );
  assert.throws(
    () => resolve({ settings: [setting('setting-meta-7d'), setting('setting-google-7d', { ai_enabled: true })] }),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID',
  );
  assert.throws(
    () => normalizeLarkWeekly7dNotificationRestorableBaseline([
      {
        reportSettingKey: 'setting-meta-7d',
        aiEnabled: true,
        notificationEnabled: false,
      },
    ]),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID',
  );
});
