import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  loadLarkNotificationDeliveryRequest,
} from '../../packages/connectors/src/lark/lark-notification-delivery-source.js';

const TABLES = Object.freeze({
  aiRuns: 'ai-runs',
  reportSnapshots: 'snapshots',
  reportSettings: 'settings',
});
const GROUP_ID = 'reviewed-executive-group';
const DESTINATION_HASH = createHash('sha256').update(GROUP_ID).digest('hex');

function repositoryFixture(overrides = {}) {
  const records = {
    [TABLES.aiRuns]: [{
      recordId: 'ai-1',
      fields: {
        ai_run_key: 'uat:executive:3d',
        report_id: 'ai-preview:executive:3d',
        template_version: 'executive_weekly_7d_notification_v1',
        scope_type: 'executive',
        generation_status: 'generated',
        notification_eligible: true,
        preview_mode: false,
        sent_to_group: false,
        dedupe_key: 'a'.repeat(64),
        window_days: '3',
        readiness_status: 'report_partial',
        severity: 'warning',
        insight_summary: 'สรุปภาพรวม',
        strengths: 'จุดแข็ง',
        weaknesses: 'จุดที่ต้องระวัง',
        recommendations: 'ข้อเสนอแนะ',
        source_report_ids_json: JSON.stringify(['source-report-b', 'source-report-a']),
      },
    }],
    [TABLES.reportSnapshots]: [
      {
        recordId: 'snapshot-a',
        fields: {
          report_id: 'source-report-a',
          report_setting_key: 'setting-a',
          customer_profile: 'integration_workspace',
          period_start: '2026-08-01',
          period_end: '2026-08-03',
        },
      },
      {
        recordId: 'snapshot-b',
        fields: {
          report_id: 'source-report-b',
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
          group_id: GROUP_ID,
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
          group_id: GROUP_ID,
        },
      },
    ],
    ...overrides,
  };
  return {
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
}

test('resolves an executive AI identity through its exact source Report set', async () => {
  const request = await loadLarkNotificationDeliveryRequest({
    repository: repositoryFixture(),
    tables: TABLES,
    aiRunKey: 'uat:executive:3d',
    expectedDestinationKeyHash: DESTINATION_HASH,
  });

  assert.equal(request.aiRun.reportId, 'ai-preview:executive:3d');
  assert.equal(request.aiRun.templateVersion, 'executive_weekly_7d_notification_v1');
  assert.equal(request.snapshot.reportId, 'ai-preview:executive:3d');
  assert.deepEqual(request.snapshot.sourceReportIds, ['source-report-a', 'source-report-b']);
  assert.deepEqual(request.snapshot.sourceReportSettingKeys, ['setting-a', 'setting-b']);
  assert.equal(request.snapshot.reportSettingKey, 'setting-a');
  assert.equal(request.snapshot.periodStart, '2026-08-01');
  assert.equal(request.snapshot.periodEnd, '2026-08-03');
  assert.equal(request.settings.enabled, true);
  assert.equal(request.settings.aiEnabled, true);
  assert.equal(request.settings.notificationEnabled, true);
  assert.equal(request.settings.destinationKeyHash, DESTINATION_HASH);
});

test('normalizes numeric Lark Date epochs as Asia/Bangkok business dates', async () => {
  const repository = repositoryFixture({
    [TABLES.reportSnapshots]: [
      {
        recordId: 'snapshot-a',
        fields: {
          report_id: 'source-report-a',
          report_setting_key: 'setting-a',
          customer_profile: 'integration_workspace',
          period_start: 1785517200000,
          period_end: 1785690000000,
        },
      },
      {
        recordId: 'snapshot-b',
        fields: {
          report_id: 'source-report-b',
          report_setting_key: 'setting-b',
          customer_profile: 'integration_workspace',
          period_start: 1785517200000,
          period_end: 1785690000000,
        },
      },
    ],
  });

  const request = await loadLarkNotificationDeliveryRequest({
    repository,
    tables: TABLES,
    aiRunKey: 'uat:executive:3d',
    expectedDestinationKeyHash: DESTINATION_HASH,
  });

  assert.equal(new Date(1785517200000).toISOString().slice(0, 10), '2026-07-31');
  assert.equal(new Date(1785690000000).toISOString().slice(0, 10), '2026-08-02');
  assert.equal(request.snapshot.periodStart, '2026-08-01');
  assert.equal(request.snapshot.periodEnd, '2026-08-03');
});

test('keeps the legacy direct Report identity path when source_report_ids_json is absent', async () => {
  const records = repositoryFixture({
    [TABLES.aiRuns]: [{
      recordId: 'ai-legacy',
      fields: {
        ai_run_key: 'uat:executive:3d',
        report_id: 'source-report-a',
        scope_type: 'executive',
        generation_status: 'generated',
        notification_eligible: true,
        preview_mode: false,
        sent_to_group: false,
        dedupe_key: 'a'.repeat(64),
        window_days: '3',
        readiness_status: 'report_partial',
        severity: 'warning',
        insight_summary: 'สรุปภาพรวม',
        strengths: 'จุดแข็ง',
        weaknesses: 'จุดที่ต้องระวัง',
        recommendations: 'ข้อเสนอแนะ',
      },
    }],
    [TABLES.reportSnapshots]: [{
      recordId: 'snapshot-a',
      fields: {
        report_id: 'source-report-a',
        report_setting_key: 'setting-a',
        customer_profile: 'integration_workspace',
        period_start: '2026-08-01',
        period_end: '2026-08-03',
      },
    }],
    [TABLES.reportSettings]: [{
      recordId: 'setting-a',
      fields: {
        report_setting_key: 'setting-a',
        customer_profile: 'integration_workspace',
        enabled: true,
        ai_enabled: true,
        notification_enabled: true,
        group_id: GROUP_ID,
      },
    }],
  });
  const request = await loadLarkNotificationDeliveryRequest({
    repository: records,
    tables: TABLES,
    aiRunKey: 'uat:executive:3d',
    expectedDestinationKeyHash: DESTINATION_HASH,
  });
  assert.equal(request.aiRun.templateVersion, null);
  assert.deepEqual(request.snapshot.sourceReportIds, ['source-report-a']);
});

test('fails closed when source Reports do not share the exact period', async () => {
  const repository = repositoryFixture({
    [TABLES.reportSnapshots]: [
      {
        recordId: 'snapshot-a',
        fields: {
          report_id: 'source-report-a', report_setting_key: 'setting-a',
          customer_profile: 'integration_workspace', period_start: '2026-08-01', period_end: '2026-08-03',
        },
      },
      {
        recordId: 'snapshot-b',
        fields: {
          report_id: 'source-report-b', report_setting_key: 'setting-b',
          customer_profile: 'integration_workspace', period_start: '2026-08-02', period_end: '2026-08-03',
        },
      },
    ],
  });
  await assert.rejects(
    () => loadLarkNotificationDeliveryRequest({
      repository,
      tables: TABLES,
      aiRunKey: 'uat:executive:3d',
      expectedDestinationKeyHash: DESTINATION_HASH,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_SOURCE_REPORTS_MISMATCH',
  );
});

test('fails closed when source Settings point at more than one destination', async () => {
  const repository = repositoryFixture({
    [TABLES.reportSettings]: [
      {
        recordId: 'setting-a',
        fields: {
          report_setting_key: 'setting-a', customer_profile: 'integration_workspace',
          enabled: true, ai_enabled: true, notification_enabled: true, group_id: GROUP_ID,
        },
      },
      {
        recordId: 'setting-b',
        fields: {
          report_setting_key: 'setting-b', customer_profile: 'integration_workspace',
          enabled: true, ai_enabled: true, notification_enabled: true, group_id: 'other-group',
        },
      },
    ],
  });
  await assert.rejects(
    () => loadLarkNotificationDeliveryRequest({
      repository,
      tables: TABLES,
      aiRunKey: 'uat:executive:3d',
      expectedDestinationKeyHash: DESTINATION_HASH,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_DESTINATION_MISMATCH',
  );
});
