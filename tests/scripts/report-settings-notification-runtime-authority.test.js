import assert from 'node:assert/strict';
import test from 'node:test';

import { createReportSettingRowsForProfile } from '../../packages/config/src/report-settings.seed.js';
import {
  REPORT_SETTINGS_NOTIFICATION_RUNTIME_AUTHORITY_VERSION,
  resolveReportSettingsNotificationRuntimeAuthority,
} from '../../scripts/lib/report-settings-notification-runtime-authority.js';

const DESTINATION = 'runtime-destination';
const DESTINATION_HASH =
  '2682b75c9df1350ff5ee97b5c4f13ccbd0e973cab835c9a6306599526aec1a7a';
const TABLES = Object.freeze({
  aiRuns: 'tbl-ai',
  reportSnapshots: 'tbl-snapshots',
  reportSettings: 'tbl-settings',
  notificationLog: 'tbl-log',
});
const ACTIVE_WINDOWS = Object.freeze([1, 3, 7, 30]);

function activeKeys() {
  return ACTIVE_WINDOWS.map(
    (windowDays) => `integration_workspace:facebook:rolling:${windowDays}d`,
  ).sort();
}

function preview(windowDays) {
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
      generated_at: 1000 + windowDays,
    },
  };
}

function inventory(options = {}) {
  const selectedKeys = activeKeys();
  const extraActiveKey = options.extraActive === true
    ? 'integration_workspace:instagram:rolling:1d'
    : null;
  const mixedKey = options.mixed === true ? selectedKeys[0] : null;
  const canonical = createReportSettingRowsForProfile('integration_workspace').map((row) => {
    const active = selectedKeys.includes(row.report_setting_key)
      || row.report_setting_key === extraActiveKey;
    return {
      recordId: `setting:${row.report_setting_key}`,
      fields: {
        ...row,
        ai_enabled: active,
        notification_enabled: row.report_setting_key === mixedKey ? false : active,
        group_id: active ? DESTINATION : null,
      },
    };
  });
  const snapshots = ACTIVE_WINDOWS.map((windowDays) => ({
    recordId: `snapshot-${windowDays}`,
    fields: {
      report_id: `report-${windowDays}`,
      report_setting_key:
        `integration_workspace:facebook:rolling:${windowDays}d`,
      customer_profile: 'integration_workspace',
    },
  }));
  const previews = ACTIVE_WINDOWS.map(preview);

  const client = {
    async listTables() {
      return [
        { tableId: TABLES.aiRuns, name: '🧠 MKT_AI_Report_Runs' },
        { tableId: TABLES.reportSnapshots, name: '🧾 MKT_Report_Snapshots' },
        { tableId: TABLES.reportSettings, name: '⚙️ MKT_Report_Settings' },
        { tableId: TABLES.notificationLog, name: '🔔 MKT_Notification_Log' },
      ];
    },
  };
  const repository = {
    async listByFieldValues(tableId, fieldName, values) {
      const source = tableId === TABLES.aiRuns
        ? previews
        : tableId === TABLES.reportSnapshots
          ? snapshots
          : tableId === TABLES.reportSettings
            ? canonical
            : [];
      return source.filter((record) => values.includes(record.fields[fieldName]));
    },
  };
  return { client, repository, canonical };
}

test('resolves exact active 1D/3D/7D/30D Notification Runtime authority', async () => {
  const source = inventory();
  const authority = await resolveReportSettingsNotificationRuntimeAuthority({
    client: source.client,
    repository: source.repository,
    reportSettingsTableId: TABLES.reportSettings,
    expectedDestinationKeyHash: DESTINATION_HASH,
  });
  assert.deepEqual(authority, {
    contractVersion: REPORT_SETTINGS_NOTIFICATION_RUNTIME_AUTHORITY_VERSION,
    state: 'active',
    settingKeys: activeKeys(),
    settingCount: 4,
    groupId: DESTINATION,
    destinationKeyHash: DESTINATION_HASH,
  });
});

test('returns inactive only when every canonical AI and notification flag is false', async () => {
  const source = inventory();
  for (const record of source.canonical) {
    record.fields.ai_enabled = false;
    record.fields.notification_enabled = false;
    record.fields.group_id = null;
  }
  const authority = await resolveReportSettingsNotificationRuntimeAuthority({
    client: source.client,
    repository: source.repository,
    reportSettingsTableId: TABLES.reportSettings,
    expectedDestinationKeyHash: DESTINATION_HASH,
  });
  assert.equal(authority.state, 'inactive');
  assert.equal(authority.settingCount, 0);
  assert.deepEqual(authority.settingKeys, []);
});

test('fails closed for mixed flags or any fifth active canonical Setting', async () => {
  for (const options of [{ mixed: true }, { extraActive: true }]) {
    const source = inventory(options);
    await assert.rejects(
      () => resolveReportSettingsNotificationRuntimeAuthority({
        client: source.client,
        repository: source.repository,
        reportSettingsTableId: TABLES.reportSettings,
        expectedDestinationKeyHash: DESTINATION_HASH,
      }),
      (error) => [
        'REPORT_SETTINGS_NOTIFICATION_RUNTIME_STATE_MIXED',
        'REPORT_SETTINGS_NOTIFICATION_RUNTIME_ACTIVE_SCOPE_INVALID',
      ].includes(error.code),
    );
  }
});
