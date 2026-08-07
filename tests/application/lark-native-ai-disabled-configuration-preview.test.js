import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LARK_NATIVE_AI_AUTOMATION_OUTPUT_BINDING,
  LARK_NATIVE_AI_AUTOMATION_PROMPTS,
  LARK_NATIVE_AI_AUTOMATION_PROMPT_REFERENCE_SLOTS,
  LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION,
  LARK_NATIVE_AI_CUSTOM_FIELD_AUTHORITY,
  LARK_NATIVE_AI_DISABLED_CONFIGURATION_PERMISSION_BUNDLE,
  LARK_NATIVE_AI_DISABLED_CONFIGURATION_WORKFLOWS,
  LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH,
  LARK_NATIVE_AI_NOTIFICATION_CHECKSUM_POLICY,
} from '../../packages/config/src/lark-native-ai-disabled-configuration-preview-contract.js';
import {
  LARK_NATIVE_AI_NOTIFICATION_DEDUPE_GATE_AUTHORITY,
  LARK_NATIVE_AI_NOTIFICATION_DEDUPE_PREVIEW_VERSION,
} from '../../packages/config/src/lark-native-ai-notification-dedupe-gate-contract.js';
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
      strengths: 'TikTok Organic มี Engagement เด่นที่สุดในข้อมูลที่มี',
      weaknesses: 'Facebook ยังไม่พบข้อมูลสำหรับช่วงนี้',
      recommendations: 'ต่อยอดรูปแบบคอนเทนต์ที่สร้าง Engagement ได้ดีในสัปดาห์ถัดไป',
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

test('builds v6 preview with configured AI materialization and blocked notification workflow', async () => {
  const preview = await buildLarkNativeAiDisabledConfigurationPreview(fixture());
  assert.equal(preview.ok, true);
  assert.equal(
    preview.status,
    'repository_preview_ai_materialization_configured_notification_blocked',
  );
  assert.equal(preview.contractVersion, LARK_NATIVE_AI_NOTIFICATION_DEDUPE_PREVIEW_VERSION);
  assert.equal(preview.contractVersion, 'lark_native_ai_disabled_configuration_preview_v6');
  assert.equal(preview.mode, 'repository_only');
  assert.equal(preview.liveConfigurationAuthorized, false);
  assert.equal(preview.activationAuthorized, false);
  assert.equal(preview.aiMaterializationConfigurationStatus, 'saved_inactive_user_confirmed');
  assert.equal(preview.notificationAutomationConfigurationAuthorized, false);
  assert.equal(preview.workflows.length, 2);
  assert.equal(preview.workflows[0].status, 'inactive_configured');
  assert.equal(preview.workflows[1].status, 'inactive_placeholder');
  assert.equal(preview.workflows[1].liveConfigurationSupported, false);
  assert.deepEqual(preview.workflows[1].actions, []);
  assert.equal(preview.customAiFieldAuthority.promptCaptureComplete, true);
  assert.equal(preview.automationAiOutputBinding.promptCaptureComplete, true);
  assert.equal(preview.automationPromptVersion, LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION);
  assert.deepEqual(Object.keys(preview.automationPrompts), [
    'insight_summary',
    'strengths',
    'weaknesses',
    'recommendations',
  ]);
  assert.match(preview.notificationPayloadChecksum, /^[a-f0-9]{64}$/u);
  assert.equal(preview.notificationPayloadChecksumAuthority, 'repository_preview_only');
  assert.equal(preview.notificationLogRecordPreview.payload_checksum, null);
  assert.equal(preview.blockerCount, 1);
  assert.deepEqual(preview.blockers.map(({ code }) => code), [
    'LARK_NATIVE_NOTIFICATION_DEDUPE_GATE_UNSUPPORTED',
  ]);
  assert.equal(preview.advisoryCount, 2);
  assert.deepEqual(preview.advisories.map(({ code }) => code), [
    'LARK_NATIVE_PAYLOAD_SHA256_NOT_AVAILABLE_NON_BLOCKING',
    'UI_AUTOMATION_API_IDENTITY_NOT_EXPOSED',
  ]);
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

test('captures unsupported inverse Find records gate and preserves inactive placeholder', async () => {
  assert.equal(LARK_NATIVE_AI_NOTIFICATION_DEDUPE_GATE_AUTHORITY.source, 'user_confirmed_lark_base_ui');
  assert.deepEqual(
    LARK_NATIVE_AI_NOTIFICATION_DEDUPE_GATE_AUTHORITY.availableNoRecordPolicies,
    ['continue', 'stop'],
  );
  assert.equal(
    LARK_NATIVE_AI_NOTIFICATION_DEDUPE_GATE_AUTHORITY.requiredExistingRecordPolicy,
    'stop_when_records_found',
  );
  assert.equal(LARK_NATIVE_AI_NOTIFICATION_DEDUPE_GATE_AUTHORITY.supported, false);
  assert.equal(LARK_NATIVE_AI_NOTIFICATION_DEDUPE_GATE_AUTHORITY.safeState, 'inactive_placeholder');
  const preview = await buildLarkNativeAiDisabledConfigurationPreview(fixture());
  const notification = preview.workflows[1];
  assert.equal(notification.safeStateReason, 'LARK_NATIVE_NOTIFICATION_DEDUPE_GATE_UNSUPPORTED');
  assert.deepEqual(notification.actions, []);
  assert.equal(notification.deferredActionCount, LARK_NATIVE_AI_DISABLED_CONFIGURATION_WORKFLOWS[1].actions.length);
  assert.equal(notification.forbiddenActionTypes.includes('save_without_existing_record_stop_gate'), true);
});

test('uses nullable live checksum without pretending it solves notification dedupe', () => {
  assert.deepEqual(LARK_NATIVE_AI_NOTIFICATION_CHECKSUM_POLICY, {
    repositoryPreviewAlgorithm: 'SHA-256',
    repositoryPreviewEncoding: 'hex',
    liveAutomationPayloadChecksum: null,
    liveAutomationStatus: 'not_computed_in_lark_base_automation',
    dedupeAuthority: 'notification_attempt_key_and_dedupe_key',
    blocking: false,
  });
  assert.equal(LARK_NATIVE_AI_NOTIFICATION_DEDUPE_GATE_AUTHORITY.liveConfigurationSupported, false);
});

test('captures business-first Thai prompt v2 with exact shared reference slots', () => {
  assert.equal(LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION, 'lark_native_ai_automation_prompts_v2');
  assert.deepEqual(LARK_NATIVE_AI_AUTOMATION_PROMPT_REFERENCE_SLOTS, [
    'scope_type',
    'channel_key',
    'window_days',
    'data_status',
    'readiness_status',
    'readiness_message',
    'severity',
    'metric_summary_json',
    'executive_channel_statuses',
  ]);
  assert.deepEqual(Object.keys(LARK_NATIVE_AI_AUTOMATION_PROMPTS), [
    'insight_summary',
    'strengths',
    'weaknesses',
    'recommendations',
  ]);
  for (const [fieldName, prompt] of Object.entries(LARK_NATIVE_AI_AUTOMATION_PROMPTS)) {
    assert.equal(prompt.fieldName, fieldName);
    assert.equal(prompt.language, 'th');
    assert.equal(prompt.source, 'user_approved_weekly_executive_quality_2026-08-07');
    assert.deepEqual(prompt.referenceSlots, LARK_NATIVE_AI_AUTOMATION_PROMPT_REFERENCE_SLOTS);
    assert.match(prompt.text, /นักวิเคราะห์การตลาด/u);
    assert.match(prompt.text, /ยังไม่พบข้อมูลสำหรับช่วงนี้/u);
    assert.match(prompt.text, /ห้ามสร้างหรือคาดเดาตัวเลข/u);
    assert.match(prompt.text, /\{\{metric_summary_json\}\}/u);
    assert.match(prompt.text, /\{\{executive_channel_statuses\}\}/u);
  }
  assert.match(LARK_NATIVE_AI_AUTOMATION_PROMPTS.insight_summary.text, /ผลงานของช่องทาง/u);
  assert.match(LARK_NATIVE_AI_AUTOMATION_PROMPTS.insight_summary.text, /Content\/Ad\/สินค้า\/การสนทนา/u);
  assert.match(LARK_NATIVE_AI_AUTOMATION_PROMPTS.strengths.text, /ห้ามใช้ “ข้อมูลพร้อม”/u);
  assert.match(LARK_NATIVE_AI_AUTOMATION_PROMPTS.weaknesses.text, /การไม่มีข้อมูลไม่ใช่ผลงานแย่/u);
  assert.match(LARK_NATIVE_AI_AUTOMATION_PROMPTS.recommendations.text, /สิ่งที่ควรทำสัปดาห์หน้า/u);
  assert.match(LARK_NATIVE_AI_AUTOMATION_PROMPTS.recommendations.text, /ห้ามใช้ศัพท์ระบบ/u);
});

test('locks Custom AI target fields and verified Automation result binding', () => {
  assert.equal(LARK_NATIVE_AI_CUSTOM_FIELD_AUTHORITY.fieldCount, 4);
  assert.equal(LARK_NATIVE_AI_CUSTOM_FIELD_AUTHORITY.promptCaptureComplete, true);
  assert.equal(
    LARK_NATIVE_AI_CUSTOM_FIELD_AUTHORITY.automaticGenerationPolicy,
    'not_required_by_selected_automation_path',
  );
  assert.equal(LARK_NATIVE_AI_AUTOMATION_OUTPUT_BINDING.actionType, 'AI-generated text (GPT model)');
  assert.equal(LARK_NATIVE_AI_AUTOMATION_OUTPUT_BINDING.targetAction, 'Update record');
  assert.equal(LARK_NATIVE_AI_AUTOMATION_OUTPUT_BINDING.targetTable, '🧠 MKT_AI_Report_Runs');
  assert.equal(LARK_NATIVE_AI_AUTOMATION_OUTPUT_BINDING.verifiedTargetField, 'insight_summary');
  assert.equal(LARK_NATIVE_AI_AUTOMATION_OUTPUT_BINDING.promptCaptureComplete, true);
});

test('AI materialization Workflow binds one approved prompt to each text action', () => {
  const ai = LARK_NATIVE_AI_DISABLED_CONFIGURATION_WORKFLOWS[0];
  assert.equal(ai.finalTrigger.table, '🧠 MKT_AI_Report_Runs');
  assert.equal(ai.generationAuthority.type, 'lark_automation_ai_generated_text_actions');
  assert.equal(ai.generationAuthority.promptCaptureComplete, true);
  assert.deepEqual(ai.actions.map(({ type }) => type), [
    'lark_ai_generated_text',
    'lark_ai_generated_text',
    'lark_ai_generated_text',
    'lark_ai_generated_text',
    'update_current_record',
  ]);
  assert.deepEqual(ai.actions.slice(0, 4).map(({ config }) => config.outputField), [
    'insight_summary',
    'strengths',
    'weaknesses',
    'recommendations',
  ]);
  for (const { config } of ai.actions.slice(0, 4)) {
    assert.equal(config.promptStatus, 'captured_approved');
    assert.equal(config.prompt, LARK_NATIVE_AI_AUTOMATION_PROMPTS[config.outputField].text);
  }
  assert.equal(ai.actions.some(({ type }) => type === 'send_lark_message'), false);
  assert.equal(ai.actions.some(({ type }) => type === 'enable_automation'), false);
});

test('never exposes raw destination or an executable notification chain in v6 preview', async () => {
  const preview = await buildLarkNativeAiDisabledConfigurationPreview(fixture());
  const serialized = JSON.stringify(preview.workflows[1]);
  assert.deepEqual(preview.workflows[1].actions, []);
  assert.doesNotMatch(serialized, /\boc_[A-Za-z0-9_-]+\b/u);
  assert.doesNotMatch(serialized, /https?:\/\/[^\s"]*webhook/iu);
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
