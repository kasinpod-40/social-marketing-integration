import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  loadLarkNotificationDeliveryRequest,
} from '../../packages/connectors/src/lark/lark-notification-delivery-source.js';
import {
  LARK_REVIEWED_EXECUTIVE_CHAT_NAME,
} from '../../packages/connectors/src/lark/lark-notification-reviewed-destination.js';

const TABLES = Object.freeze({ aiRuns: 'ai-runs', reportSnapshots: 'snapshots', reportSettings: 'settings' });
const CHAT_ID = 'reviewed-executive-chat';
const DESTINATION_HASH = createHash('sha256').update(CHAT_ID).digest('hex');
const PLATFORM_SCOPES = Object.freeze([
  ['chatwoot', 'chatwoot-customer-service-v1'],
  ['facebook', 'facebook-organic-v1'],
  ['google_ads', 'google-ads-v1'],
  ['instagram', 'instagram-organic-v1'],
  ['meta_ads', 'meta-ads-v1'],
  ['tiktok', 'tiktok-organic-v1'],
  ['woocommerce', 'woocommerce-commerce-v1'],
  ['youtube', 'youtube-organic-v1'],
]);
const SOURCE_REPORT_IDS = Object.freeze(PLATFORM_SCOPES.map(([scope, formula]) => (
  `integration_workspace:${scope}:rolling:7d:chemistry_k:rolling_days:2026-08-03:2026-08-09:${formula}`
)).sort());
const SETTING_KEYS = Object.freeze(PLATFORM_SCOPES.map(([scope]) => (
  `integration_workspace:${scope}:rolling:7d`
)).sort());

function repositoryFixture(options = {}) {
  const calls = [];
  const profile = options.profile ?? 'integration_workspace';
  const sourceReportIds = options.sourceReportIds ?? SOURCE_REPORT_IDS;
  const settingKeys = options.settingKeys ?? SETTING_KEYS;
  const aiRun = {
    recordId: 'weekly-ai',
    fields: {
      ai_run_key: 'notification-weekly-7d:test',
      report_id: 'notification-weekly-7d:test',
      template_version: 'executive_weekly_7d_notification_v1',
      scope_type: 'executive',
      generation_status: 'generated',
      notification_eligible: true,
      preview_mode: false,
      sent_to_group: false,
      dedupe_key: 'a'.repeat(64),
      window_days: 7,
      readiness_status: 'report_partial',
      severity: 'info',
      insight_summary: 'overview',
      strengths: 'strengths',
      weaknesses: 'weaknesses',
      recommendations: 'recommendations',
      source_report_ids_json: JSON.stringify(sourceReportIds),
      period_start: '2026-08-03',
      period_end: '2026-08-09',
    },
  };
  const configuredKeys = new Set(options.configuredDestinationSettingKeys ?? []);
  const wrongKeys = new Set(options.wrongDestinationSettingKeys ?? []);
  const settings = settingKeys.map((key) => ({
    recordId: `rec-${key}`,
    fields: {
      report_setting_key: key,
      customer_profile: profile,
      enabled: true,
      ai_enabled: true,
      notification_enabled: true,
      group_id: wrongKeys.has(key)
        ? 'other-executive-chat'
        : configuredKeys.has(key)
          ? CHAT_ID
          : null,
    },
  }));
  const repository = {
    calls,
    client: {
      async requestBitableJson(path, optionsInput) {
        calls.push({ kind: 'client', path, options: optionsInput });
        return { code: 0, data: { items: [{ chat_id: CHAT_ID, name: LARK_REVIEWED_EXECUTIVE_CHAT_NAME }], has_more: false } };
      },
    },
    async listByFieldValues(tableId, fieldName, values) {
      calls.push({ kind: 'repository', tableId, fieldName, values: [...values] });
      if (tableId === TABLES.aiRuns) return [aiRun];
      if (tableId === TABLES.reportSnapshots) throw new Error('WEEKLY_PATH_MUST_NOT_READ_SNAPSHOTS');
      if (tableId === TABLES.reportSettings) {
        const accepted = new Set(values);
        return settings.filter((row) => accepted.has(row.fields.report_setting_key));
      }
      return [];
    },
    async prepareRows() {},
    async prepareExistingRecords() {},
    async createMany() {},
    async updateMany() {},
  };
  return repository;
}

test('weekly 7D dedicated delivery regenerates exact source Settings without Report Snapshot reads', async () => {
  const repository = repositoryFixture();
  const request = await loadLarkNotificationDeliveryRequest({
    repository,
    tables: TABLES,
    aiRunKey: 'notification-weekly-7d:test',
    expectedDestinationKeyHash: DESTINATION_HASH,
  });

  assert.deepEqual(request.snapshot.sourceReportIds, SOURCE_REPORT_IDS);
  assert.deepEqual(request.snapshot.sourceReportSettingKeys, SETTING_KEYS);
  assert.equal(request.snapshot.customerProfile, 'integration_workspace');
  assert.equal(request.snapshot.periodStart, '2026-08-03');
  assert.equal(request.snapshot.periodEnd, '2026-08-09');
  assert.equal(request.settings.groupId, CHAT_ID);
  assert.equal(request.settings.destinationKeyHash, DESTINATION_HASH);
  assert.equal(repository.calls.some((call) => call.tableId === TABLES.reportSnapshots), false);
  assert.equal(repository.calls.some((call) => call.tableId === TABLES.reportSettings), true);
});

test('weekly 7D dedicated delivery regenerates Customer Production source authority', async () => {
  const profile = 'chemistry_k';
  const sourceReportIds = PLATFORM_SCOPES.map(([scope, formula]) => (
    `${profile}:${scope}:rolling:7d:chemistry_k:rolling_days:2026-08-03:2026-08-09:${formula}`
  )).sort();
  const settingKeys = PLATFORM_SCOPES.map(([scope]) => `${profile}:${scope}:rolling:7d`).sort();
  const repository = repositoryFixture({ profile, sourceReportIds, settingKeys });
  const request = await loadLarkNotificationDeliveryRequest({
    repository,
    tables: TABLES,
    aiRunKey: 'notification-weekly-7d:test',
    expectedCustomerProfile: profile,
    expectedDestinationKeyHash: DESTINATION_HASH,
    expectedDestinationName: LARK_REVIEWED_EXECUTIVE_CHAT_NAME,
  });

  assert.deepEqual(request.snapshot.sourceReportIds, sourceReportIds);
  assert.deepEqual(request.snapshot.sourceReportSettingKeys, settingKeys);
  assert.equal(request.snapshot.customerProfile, profile);
  assert.equal(request.settings.groupId, CHAT_ID);
});

test('weekly 7D delivery accepts reviewed configured subset plus unset rows without writing destination', async () => {
  const configuredDestinationSettingKeys = SETTING_KEYS.slice(0, 7);
  const repository = repositoryFixture({ configuredDestinationSettingKeys });
  const request = await loadLarkNotificationDeliveryRequest({
    repository,
    tables: TABLES,
    aiRunKey: 'notification-weekly-7d:test',
    expectedDestinationKeyHash: DESTINATION_HASH,
  });

  assert.equal(request.settings.groupId, CHAT_ID);
  assert.equal(request.settings.destinationKeyHash, DESTINATION_HASH);
  assert.equal(repository.calls.some((call) => call.kind === 'client'), false);
  assert.equal(repository.calls.some((call) => call.tableId === TABLES.reportSnapshots), false);
});

test('weekly 7D delivery rejects a configured wrong or second destination even with unset rows', async () => {
  const repository = repositoryFixture({
    configuredDestinationSettingKeys: [SETTING_KEYS[0]],
    wrongDestinationSettingKeys: [SETTING_KEYS[1]],
  });
  await assert.rejects(
    () => loadLarkNotificationDeliveryRequest({
      repository,
      tables: TABLES,
      aiRunKey: 'notification-weekly-7d:test',
      expectedDestinationKeyHash: DESTINATION_HASH,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_DESTINATION_MISMATCH',
  );
});
