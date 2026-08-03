import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LARK_NATIVE_AI_DISABLED_CONFIGURATION_PERMISSION_BUNDLE,
  LARK_NATIVE_AI_DISABLED_CONFIGURATION_WORKFLOWS,
  LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../../packages/config/src/lark-native-ai-disabled-configuration-preview-contract.js';
import {
  buildLarkNativeAiDisabledConfigurationPreview,
  validateLarkNativeAiDisabledConfigurationPreview,
} from '../../packages/application/src/reports/build-lark-native-ai-disabled-configuration-preview.js';

function fixture() {
  return {
    aiRun: {
      aiRunKey: 'integration_workspace:executive:7d:2026-08-03',
      reportId: 'integration_workspace:executive:7d:2026-08-03',
      scopeType: 'executive',
      windowDays: 7,
      generationStatus: 'generated',
      readinessStatus: 'report_partial',
      severity: 'warning',
      notificationEligible: true,
      previewMode: false,
      sentToGroup: false,
      dedupeKey: 'a'.repeat(64),
      insightSummary: 'สรุปจาก Report กลางที่ผ่านการตรวจสอบ',
      strengths: 'ข้อมูลมี Stable key และ Coverage ที่ตรวจสอบแล้ว',
      weaknesses: 'บางช่องทางยังไม่ครบ',
      recommendations: 'รอ Coverage ครบก่อนเปิดส่งอัตโนมัติ',
    },
    snapshot: {
      reportId: 'integration_workspace:executive:7d:2026-08-03',
      reportSettingKey: 'integration_workspace:executive:rolling:7',
      customerProfile: 'integration_workspace',
      periodStart: '2026-07-28',
      periodEnd: '2026-08-03',
    },
    settings: {
      reportSettingKey: 'integration_workspace:executive:rolling:7',
      customerProfile: 'integration_workspace',
      enabled: true,
      notificationEnabled: true,
      destinationKeyHash: LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH,
    },
  };
}

test('builds exact repository-only disabled configuration and payload preview', async () => {
  const preview = await buildLarkNativeAiDisabledConfigurationPreview(fixture());
  assert.equal(preview.ok, true);
  assert.equal(preview.status, 'repository_preview_ready_live_configuration_blocked');
  assert.equal(preview.mode, 'repository_only');
  assert.equal(preview.liveConfigurationAuthorized, false);
  assert.equal(preview.activationAuthorized, false);
  assert.equal(preview.workflows.length, 2);
  assert.deepEqual(preview.workflows.map(({ title }) => title), [
    'AI Materialization → MKT_AI_Report_Runs',
    'Eligible AI Run → Lark Group Notification',
  ]);
  assert.match(preview.notificationPayloadChecksum, /^[a-f0-9]{64}$/u);
  assert.equal(
    preview.notificationLogRecordPreview.notification_attempt_key,
    `integration_workspace:executive:7d:2026-08-03::${'a'.repeat(64)}`,
  );
  assert.equal(preview.notificationLogRecordPreview.preview_mode, false);
  assert.equal(preview.notificationLogRecordPreview.attempt_status, 'pending');
  assert.equal(preview.notificationLogRecordPreview.sent_at, null);
  assert.match(preview.notificationPayloadPreview.message.text, /ข้อเสนอแนะ/u);
  assert.equal(validateLarkNativeAiDisabledConfigurationPreview(preview).length, 0);
  assert.equal(preview.safety.remoteLarkRead, 0);
  assert.equal(preview.safety.remoteLarkWrite, 0);
  assert.equal(preview.safety.workflowCreate, 0);
  assert.equal(preview.safety.workflowUpdate, 0);
  assert.equal(preview.safety.workflowStatusChange, 0);
  assert.equal(preview.safety.notificationSend, 0);
  assert.equal(preview.safety.scheduleEnabled, false);
  assert.equal(preview.safety.production, 'BLOCKED');
});

test('maps notification identity through Snapshot before Settings and never stores raw destination', () => {
  const notification = LARK_NATIVE_AI_DISABLED_CONFIGURATION_WORKFLOWS[1];
  assert.equal(notification.actions[0].config.table, '🧾 MKT_Report_Snapshots');
  assert.deepEqual(notification.actions[0].config.readFields, [
    'report_setting_key',
    'customer_profile',
    'period_start',
    'period_end',
  ]);
  assert.equal(notification.actions[1].config.table, '⚙️ MKT_Report_Settings');
  assert.equal(notification.actions[1].config.identitySource, '🧾 MKT_Report_Snapshots');
  const serialized = JSON.stringify(notification);
  assert.doesNotMatch(serialized, /\boc_[A-Za-z0-9_-]+\b/u);
  assert.doesNotMatch(serialized, /webhook/iu);
});

test('AI generation Workflow has no message, notification log or activation action', () => {
  const ai = LARK_NATIVE_AI_DISABLED_CONFIGURATION_WORKFLOWS[0];
  assert.equal(ai.finalTrigger.table, '🧠 MKT_AI_Report_Runs');
  assert.deepEqual(ai.actions.map(({ type }) => type), [
    'lark_native_ai_generate_structured_text',
    'update_current_record',
  ]);
  assert.equal(ai.actions.some(({ type }) => type === 'send_lark_message'), false);
  assert.equal(ai.actions.some(({ type }) => type === 'add_notification_log_record'), false);
  assert.equal(ai.actions.some(({ type }) => type === 'enable_automation'), false);
});

test('discloses the complete remaining permission bundle together', () => {
  assert.deepEqual(LARK_NATIVE_AI_DISABLED_CONFIGURATION_PERMISSION_BUNDLE, [
    'base:workflow:read',
    'base:workflow:create',
    'base:workflow:update',
    'base:workflow:write',
  ]);
  assert.equal(LARK_NATIVE_AI_DISABLED_CONFIGURATION_PERMISSION_BUNDLE.includes(
    'base:workflow:delete',
  ), false);
});

test('rejects preview, ineligible, already-sent and non-executive AI runs', async () => {
  const cases = [
    ['previewMode', true, 'LARK_NATIVE_AI_PREVIEW_SEND_FORBIDDEN'],
    ['notificationEligible', false, 'LARK_NATIVE_AI_NOTIFICATION_NOT_ELIGIBLE'],
    ['sentToGroup', true, 'LARK_NATIVE_AI_ALREADY_SENT'],
    ['scopeType', 'channel', 'LARK_NATIVE_AI_SCOPE_NOT_EXECUTIVE'],
  ];
  for (const [field, value, code] of cases) {
    const input = fixture();
    input.aiRun[field] = value;
    await assert.rejects(
      () => buildLarkNativeAiDisabledConfigurationPreview(input),
      (error) => error.code === code,
    );
  }
});

test('rejects mismatched Snapshot, Settings and destination identity', async () => {
  const scenarios = [
    ['snapshot.reportId', 'other:report', 'LARK_NATIVE_AI_REPORT_ID_MISMATCH'],
    ['settings.reportSettingKey', 'other:setting', 'LARK_NATIVE_AI_SETTINGS_IDENTITY_MISMATCH'],
    ['settings.destinationKeyHash', 'b'.repeat(64), 'LARK_NATIVE_AI_DESTINATION_MISMATCH'],
  ];
  for (const [path, value, code] of scenarios) {
    const input = fixture();
    const [object, field] = path.split('.');
    input[object][field] = value;
    await assert.rejects(
      () => buildLarkNativeAiDisabledConfigurationPreview(input),
      (error) => error.code === code,
    );
  }
});

test('rejects malformed dedupe and unsafe message-shaped secret text', async () => {
  const malformed = fixture();
  malformed.aiRun.dedupeKey = 'not-a-sha';
  await assert.rejects(
    () => buildLarkNativeAiDisabledConfigurationPreview(malformed),
    (error) => error.code === 'LARK_NATIVE_AI_DEDUPE_KEY_INVALID',
  );

  const unsafe = fixture();
  unsafe.aiRun.recommendations = 'send to https://example.test/webhook/private';
  await assert.rejects(
    () => buildLarkNativeAiDisabledConfigurationPreview(unsafe),
    (error) => error.code === 'LARK_NATIVE_AI_MESSAGE_UNSAFE',
  );
});
