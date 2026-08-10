import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  loadLarkNotificationDeliveryRequest,
} from '../../packages/connectors/src/lark/lark-notification-delivery-source.js';
import {
  LARK_REVIEWED_EXECUTIVE_CHAT_NAME,
} from '../../packages/connectors/src/lark/lark-notification-reviewed-destination.js';

const TABLES = Object.freeze({
  aiRuns: 'ai-runs',
  reportSnapshots: 'snapshots',
  reportSettings: 'settings',
});
const CHAT_ID = 'reviewed-executive-group';
const DESTINATION_HASH = createHash('sha256').update(CHAT_ID).digest('hex');

function repositoryFixture(groupValues = [null, null]) {
  const records = {
    [TABLES.aiRuns]: [{
      recordId: 'ai-1',
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
        window_days: 3,
        readiness_status: 'report_available',
        severity: 'info',
        insight_summary: 'summary',
        strengths: 'strengths',
        weaknesses: 'weaknesses',
        recommendations: 'recommendations',
        source_report_ids_json: JSON.stringify(['source-a', 'source-b']),
      },
    }],
    [TABLES.reportSnapshots]: [
      {
        recordId: 'snap-a',
        fields: {
          report_id: 'source-a',
          report_setting_key: 'setting-a',
          customer_profile: 'integration_workspace',
          period_start: '2026-08-01',
          period_end: '2026-08-03',
        },
      },
      {
        recordId: 'snap-b',
        fields: {
          report_id: 'source-b',
          report_setting_key: 'setting-b',
          customer_profile: 'integration_workspace',
          period_start: '2026-08-01',
          period_end: '2026-08-03',
        },
      },
    ],
    [TABLES.reportSettings]: [
      {
        recordId: 'setting-a',
        fields: {
          report_setting_key: 'setting-a',
          customer_profile: 'integration_workspace',
          enabled: true,
          ai_enabled: true,
          notification_enabled: true,
          group_id: groupValues[0],
        },
      },
      {
        recordId: 'setting-b',
        fields: {
          report_setting_key: 'setting-b',
          customer_profile: 'integration_workspace',
          enabled: true,
          ai_enabled: true,
          notification_enabled: true,
          group_id: groupValues[1],
        },
      },
    ],
  };

  const repository = {
    client: {
      calls: [],
      async requestBitableJson(path, options) {
        this.calls.push({ path, options });
        return {
          code: 0,
          data: {
            items: [{ chat_id: CHAT_ID, name: LARK_REVIEWED_EXECUTIVE_CHAT_NAME }],
            has_more: false,
          },
        };
      },
    },
    async listByFieldValues(tableId, fieldName, values) {
      const allowed = new Set(values.map(String));
      return (records[tableId] ?? []).filter((record) => (
        allowed.has(String(record.fields[fieldName] ?? ''))
      ));
    },
    async prepareRows() {},
    async prepareExistingRecords() {},
    async createMany() {},
    async updateMany() {},
  };
  return repository;
}

test('resolves an all-null Settings destination from reviewed Lark chat without persisting it', async () => {
  const repository = repositoryFixture();
  const request = await loadLarkNotificationDeliveryRequest({
    repository,
    tables: TABLES,
    aiRunKey: 'notification-weekly-7d:test',
    expectedDestinationKeyHash: DESTINATION_HASH,
  });

  assert.equal(request.settings.groupId, CHAT_ID);
  assert.equal(request.settings.destinationKeyHash, DESTINATION_HASH);
  assert.equal(request.settings.enabled, true);
  assert.equal(request.settings.aiEnabled, true);
  assert.equal(request.settings.notificationEnabled, true);
  assert.equal(repository.client.calls.length, 1);
  assert.equal(repository.client.calls[0].options.method, 'GET');
  assert.match(repository.client.calls[0].path, /^\/open-apis\/im\/v1\/chats\?/u);
});

test('rejects mixed null and configured group destination state before chat lookup', async () => {
  const repository = repositoryFixture([CHAT_ID, null]);
  await assert.rejects(
    () => loadLarkNotificationDeliveryRequest({
      repository,
      tables: TABLES,
      aiRunKey: 'notification-weekly-7d:test',
      expectedDestinationKeyHash: DESTINATION_HASH,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_DESTINATION_MISMATCH'
      && error.details.nullDestinationCount === 1,
  );
  assert.equal(repository.client.calls.length, 0);
});
