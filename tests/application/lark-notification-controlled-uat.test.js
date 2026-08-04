import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION,
  assertLarkNotificationControlledUatConfirmation,
  assertLarkNotificationControlledUatDelivered,
  assertLarkNotificationControlledUatReplayStable,
  buildLarkNotificationControlledUatReadbackSql,
  buildLarkNotificationControlledUatRow,
  buildLarkNotificationControlledUatWranglerConfig,
  resolveLarkNotificationControlledUatTables,
  selectLarkNotificationExecutivePreview,
} from '../../scripts/lib/lark-notification-controlled-uat.js';
import { LarkRecordRepository } from '../../packages/connectors/src/lark/lark-record-repository.js';

function preview(overrides = {}) {
  return {
    recordId: 'preview-1',
    fields: {
      ai_run_key: 'preview:executive:1d',
      report_id: 'ai-preview:executive:1d',
      scope_type: 'executive',
      channel_key: 'executive',
      capability: 'cross_channel',
      window_days: '1',
      generation_status: 'completed',
      notification_eligible: false,
      notification_reason: 'controlled_preview',
      preview_mode: true,
      sent_to_group: false,
      sent_at: null,
      readiness_status: 'report_partial',
      severity: 'warning',
      source_report_ids_json: JSON.stringify(['source-report-1']),
      dedupe_key: 'a'.repeat(64),
      insight_summary: 'สรุปภาพรวม',
      strengths: 'จุดแข็ง',
      weaknesses: 'จุดที่ต้องระวัง',
      recommendations: 'ข้อเสนอแนะ',
      generated_at: 1_785_758_350_638,
      ...overrides,
    },
  };
}

test('selects the latest exact 1D Executive Preview and creates a separate live UAT identity', () => {
  const source = selectLarkNotificationExecutivePreview([
    preview({ generated_at: 1000 }),
    { ...preview({ generated_at: 2000 }), recordId: 'preview-2' },
  ]);
  assert.equal(source.recordId, 'preview-2');

  const uat = buildLarkNotificationControlledUatRow(source);
  assert.notEqual(uat.aiRunKey, source.fields.ai_run_key);
  assert.match(uat.aiRunKey, /^notification-uat:[a-f0-9]{64}$/u);
  assert.equal(uat.fields.scope_type, 'executive');
  assert.equal(uat.fields.generation_status, 'generated');
  assert.equal(uat.fields.notification_eligible, true);
  assert.equal(uat.fields.preview_mode, false);
  assert.equal(uat.fields.sent_to_group, false);
  assert.equal(uat.fields.notification_reason, 'controlled_uat');
  assert.deepEqual(uat.sourceReportIds, ['source-report-1']);
  assert.equal(source.fields.preview_mode, true);
  assert.equal(source.fields.notification_eligible, false);
});

test('normalizes Lark rich-text Preview fields before dedicated UAT write preflight', async () => {
  const source = selectLarkNotificationExecutivePreview([preview({
    channel_status_vector_json: [{ text: '{"tiktok_organic":"report_partial"}' }],
    insight_summary: [{ text: 'สรุป' }, { text: 'ภาพรวม' }],
    strengths: [{ text: 'จุดแข็ง' }],
    weaknesses: [{ text: 'จุดที่ต้องระวัง' }],
    recommendations: [{ text: 'ข้อเสนอแนะ' }],
  })]);
  const uat = buildLarkNotificationControlledUatRow(source);
  const schema = Object.entries(uat.fields).map(([fieldName, value]) => ({
    fieldName,
    type: typeof value === 'boolean' ? 7 : (typeof value === 'number' ? 2 : 1),
  }));
  const repository = new LarkRecordRepository({
    client: {
      async listFields() { return schema; },
      async listRecords() { return []; },
      async batchCreateRecords() { return { created: 0 }; },
      async batchUpdateRecords() { return { updated: 0 }; },
    },
  });

  const [prepared] = await repository.prepareRows('table-ai-runs', [uat.fields], {
    keyField: 'ai_run_key',
  });
  assert.equal(prepared.channel_status_vector_json, '{"tiktok_organic":"report_partial"}');
  assert.equal(prepared.insight_summary, 'สรุปภาพรวม');
  assert.equal(prepared.strengths, 'จุดแข็ง');
  assert.equal(prepared.weaknesses, 'จุดที่ต้องระวัง');
  assert.equal(prepared.recommendations, 'ข้อเสนอแนะ');
  assert.match(prepared.ai_run_key, /^notification-uat:[a-f0-9]{64}$/u);

  await assert.rejects(
    repository.prepareRows('table-ai-runs', [{
      ...uat.fields,
      channel_status_vector_json: { tiktok_organic: 'report_partial' },
    }], { keyField: 'ai_run_key' }),
    (error) => (
      error.code === 'LARK_PREFLIGHT_FAILED'
      && error.details?.fieldName === 'channel_status_vector_json'
    ),
  );
});

test('rejects an ambiguous latest Executive Preview identity', () => {
  assert.throws(
    () => selectLarkNotificationExecutivePreview([
      preview({ generated_at: 2000 }),
      { ...preview({ generated_at: 2000 }), recordId: 'preview-2' },
    ]),
    (error) => error.code === 'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_AMBIGUOUS',
  );
});

test('resolves exact Lark table names without exposing IDs in diagnostics', () => {
  const result = resolveLarkNotificationControlledUatTables([
    { name: '🧠 MKT_AI_Report_Runs', tableId: 'table-ai' },
    { name: '🧾 MKT_Report_Snapshots', tableId: 'table-snapshots' },
    { name: '⚙️ MKT_Report_Settings', tableId: 'table-settings' },
    { name: '🔔 MKT_Notification_Log', tableId: 'table-log' },
  ]);
  assert.deepEqual(result, {
    aiRuns: 'table-ai',
    reportSnapshots: 'table-snapshots',
    reportSettings: 'table-settings',
    notificationLog: 'table-log',
  });
});

test('builds isolated active and safe Wrangler windows while preserving trigger config', () => {
  const source = JSON.stringify({
    name: 'social-mkt-sync-worker',
    main: 'apps/sync-worker/src/index.js',
    vars: {
      MKT_META_ENABLED: 'true',
      MKT_NOTIFICATION_RUNTIME_ENABLED: 'false',
    },
    triggers: { crons: ['*/5 * * * *'] },
    d1_databases: [{ binding: 'MKT_STATE_DB', database_name: 'social-mkt-state-dev' }],
  });
  const tables = {
    aiRuns: 'table-ai', reportSnapshots: 'table-snapshots',
    reportSettings: 'table-settings', notificationLog: 'table-log',
  };
  const active = buildLarkNotificationControlledUatWranglerConfig(source, tables, { active: true });
  const safe = buildLarkNotificationControlledUatWranglerConfig(source, tables, { active: false });
  assert.equal(active.config.vars.MKT_META_ENABLED, 'false');
  assert.equal(active.config.vars.MKT_NOTIFICATION_RUNTIME_ENABLED, 'true');
  assert.equal(active.config.vars.MKT_NOTIFICATION_LARK_SEND_ENABLED, 'true');
  assert.equal(active.config.vars.MKT_NOTIFICATION_LARK_MIRROR_ENABLED, 'true');
  assert.equal(active.scheduleConfigPreserved, true);
  assert.equal(safe.config.vars.MKT_NOTIFICATION_RUNTIME_ENABLED, 'false');
  assert.equal(safe.config.vars.MKT_NOTIFICATION_LARK_SEND_ENABLED, 'false');
  assert.equal(safe.config.vars.MKT_NOTIFICATION_LARK_MIRROR_ENABLED, 'false');
});

test('requires exact confirmation before any controlled UAT execution', () => {
  assert.throws(
    () => assertLarkNotificationControlledUatConfirmation({}),
    (error) => error.code === 'LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertLarkNotificationControlledUatConfirmation({
    [LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION.envName]:
      LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION.value,
  }), true);
});

test('proves one sent delivery and one exact no-send replay reached D1', () => {
  const first = {
    notificationTableCount: 1,
    notificationIndexCount: 3,
    activeLocks: 0,
    deliveryRows: 1,
    deliveryStatus: 'sent',
    mirrorStatus: 'mirrored',
    claimCount: 1,
    sentAt: 1234,
    messageIdHash: 'b'.repeat(64),
  };
  const replay = { ...first, claimCount: 2 };
  assert.equal(assertLarkNotificationControlledUatDelivered(first).deliveryRows, 1);
  assert.deepEqual(assertLarkNotificationControlledUatReplayStable(first, replay), {
    deliveryRows: 1,
    deliveryStatus: 'sent',
    mirrorStatus: 'mirrored',
    firstClaimCount: 1,
    replayClaimCount: 2,
    replayObservedByD1: true,
    sentAtStable: true,
    messageIdHashStable: true,
    secondMessageSendBlockedByAtomicClaim: true,
  });
  assert.throws(
    () => assertLarkNotificationControlledUatReplayStable(first, first),
    (error) => error.code === 'LARK_NOTIFICATION_CONTROLLED_UAT_REPLAY_INVALID',
  );
  assert.throws(
    () => assertLarkNotificationControlledUatReplayStable(first, {
      ...replay,
      sentAt: 5678,
    }),
    (error) => error.code === 'LARK_NOTIFICATION_CONTROLLED_UAT_REPLAY_INVALID',
  );
});

test('readback SQL is SELECT-only and binds exact identity plus replay proof', () => {
  const sql = buildLarkNotificationControlledUatReadbackSql('notification-uat:key');
  assert.match(sql, /^SELECT /u);
  assert.match(sql, /ai_run_key = 'notification-uat:key'/u);
  assert.match(sql, /claim_count/u);
  assert.match(sql, /lark_message_id_hash/u);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|INSERT|ALTER|DROP)\b/iu);
});
