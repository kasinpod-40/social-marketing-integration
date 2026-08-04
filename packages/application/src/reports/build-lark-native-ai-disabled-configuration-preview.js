import { stableStringify } from '../use-cases/build-report-snapshot.js';
import {
  LARK_NATIVE_AI_AUTOMATION_OUTPUT_BINDING,
  LARK_NATIVE_AI_AUTOMATION_PROMPTS,
  LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION,
  LARK_NATIVE_AI_CUSTOM_FIELD_AUTHORITY,
  LARK_NATIVE_AI_DISABLED_CONFIGURATION_PERMISSION_BUNDLE,
  LARK_NATIVE_AI_DISABLED_CONFIGURATION_PREVIEW_VERSION,
  LARK_NATIVE_AI_DISABLED_CONFIGURATION_SAFETY,
  LARK_NATIVE_AI_DISABLED_CONFIGURATION_WORKFLOWS,
  LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH,
  LARK_NATIVE_AI_EXECUTIVE_GROUP_NAME,
  LARK_NATIVE_AI_NOTIFICATION_CHECKSUM_POLICY,
  LARK_NATIVE_AI_NOTIFICATION_PAYLOAD_MAX_BYTES,
  LARK_NATIVE_AI_NOTIFICATION_SEVERITIES,
  LARK_NATIVE_AI_NOTIFICATION_WINDOWS,
} from '../../../config/src/lark-native-ai-disabled-configuration-preview-contract.js';

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const UNSAFE_DESTINATION_OR_SECRET = /(?:https?:\/\/[^\s]*webhook|\boc_[A-Za-z0-9_-]+\b|tenant_access_token|app_secret|authorization:\s*bearer)/iu;

export async function buildLarkNativeAiDisabledConfigurationPreview(input = {}) {
  const aiRun = normalizeAiRun(input.aiRun);
  const snapshot = normalizeSnapshot(input.snapshot, aiRun);
  const settings = normalizeSettings(input.settings, snapshot);
  const message = buildExecutiveMessage({ aiRun, snapshot });
  const canonicalPayload = deepFreeze({
    templateVersion: 'executive_report_notification_v1',
    destination: Object.freeze({
      exactName: LARK_NATIVE_AI_EXECUTIVE_GROUP_NAME,
      destinationKeyHash: LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH,
      rawDestinationPersisted: false,
    }),
    report: Object.freeze({
      aiRunKey: aiRun.aiRunKey,
      reportId: aiRun.reportId,
      reportSettingKey: snapshot.reportSettingKey,
      customerProfile: snapshot.customerProfile,
      windowDays: aiRun.windowDays,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
      severity: aiRun.severity,
      readinessStatus: aiRun.readinessStatus,
    }),
    message,
  });
  const payloadText = stableStringify(canonicalPayload);
  const payloadBytes = new TextEncoder().encode(payloadText).byteLength;
  if (payloadBytes > LARK_NATIVE_AI_NOTIFICATION_PAYLOAD_MAX_BYTES) {
    fail('LARK_NATIVE_AI_NOTIFICATION_PAYLOAD_TOO_LARGE', {
      observedBytes: payloadBytes,
      maximumBytes: LARK_NATIVE_AI_NOTIFICATION_PAYLOAD_MAX_BYTES,
    });
  }
  if (UNSAFE_DESTINATION_OR_SECRET.test(payloadText)) {
    fail('LARK_NATIVE_AI_NOTIFICATION_PAYLOAD_UNSAFE', {});
  }
  const repositoryPayloadChecksum = await sha256Hex(payloadText);
  const notificationAttemptKey = `${aiRun.aiRunKey}::${aiRun.dedupeKey}`;
  const logPreview = deepFreeze({
    notification_attempt_key: notificationAttemptKey,
    ai_run_key: aiRun.aiRunKey,
    dedupe_key: aiRun.dedupeKey,
    destination_key_hash: LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH,
    window_days: String(aiRun.windowDays),
    period_start: snapshot.periodStart,
    period_end: snapshot.periodEnd,
    severity: aiRun.severity,
    payload_checksum: LARK_NATIVE_AI_NOTIFICATION_CHECKSUM_POLICY.liveAutomationPayloadChecksum,
    attempt_status: 'pending',
    attempted_at: 'automation_now',
    sent_at: null,
    failure_code: null,
    redacted_failure_message: null,
    preview_mode: false,
  });

  const blockers = Object.freeze([]);
  const advisories = Object.freeze([
    Object.freeze({
      code: 'LARK_NATIVE_PAYLOAD_SHA256_NOT_AVAILABLE_NON_BLOCKING',
      reason: 'Lark Base Automation has no proven native SHA-256 action. Live payload_checksum remains null; exact send dedupe continues through notification_attempt_key and dedupe_key.',
    }),
    Object.freeze({
      code: 'UI_AUTOMATION_API_IDENTITY_NOT_EXPOSED',
      reason: 'The current List Workflows API inventory is empty while the two Base UI Automations exist; future edits must use the confirmed manual UI path unless an exact API identity is proven.',
    }),
  ]);

  return deepFreeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_DISABLED_CONFIGURATION_PREVIEW_VERSION,
    status: 'repository_preview_ready_for_manual_inactive_configuration',
    mode: 'repository_only',
    liveConfigurationAuthorized: false,
    activationAuthorized: false,
    targetGroupName: LARK_NATIVE_AI_EXECUTIVE_GROUP_NAME,
    destinationKeyHash: LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH,
    customAiFieldAuthority: LARK_NATIVE_AI_CUSTOM_FIELD_AUTHORITY,
    automationAiOutputBinding: LARK_NATIVE_AI_AUTOMATION_OUTPUT_BINDING,
    automationPromptVersion: LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION,
    automationPrompts: LARK_NATIVE_AI_AUTOMATION_PROMPTS,
    workflows: LARK_NATIVE_AI_DISABLED_CONFIGURATION_WORKFLOWS,
    notificationPayloadPreview: canonicalPayload,
    notificationPayloadBytes: payloadBytes,
    notificationPayloadChecksum: repositoryPayloadChecksum,
    notificationPayloadChecksumAuthority: 'repository_preview_only',
    notificationChecksumPolicy: LARK_NATIVE_AI_NOTIFICATION_CHECKSUM_POLICY,
    notificationLogRecordPreview: logPreview,
    settingsReadiness: Object.freeze({
      reportSettingKey: settings.reportSettingKey,
      customerProfile: settings.customerProfile,
      enabled: settings.enabled,
      notificationEnabled: settings.notificationEnabled,
      destinationHashMatches: settings.destinationKeyHash
        === LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH,
    }),
    requiredPermissionBundleForLaterMutation: LARK_NATIVE_AI_DISABLED_CONFIGURATION_PERMISSION_BUNDLE,
    blockerCount: blockers.length,
    blockers,
    advisoryCount: advisories.length,
    advisories,
    safety: LARK_NATIVE_AI_DISABLED_CONFIGURATION_SAFETY,
  });
}

export function validateLarkNativeAiDisabledConfigurationPreview(preview) {
  const blockers = [];
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    return Object.freeze([Object.freeze({ code: 'PREVIEW_INVALID' })]);
  }
  if (preview.contractVersion !== LARK_NATIVE_AI_DISABLED_CONFIGURATION_PREVIEW_VERSION) {
    blockers.push({ code: 'CONTRACT_VERSION_INVALID' });
  }
  if (preview.status !== 'repository_preview_ready_for_manual_inactive_configuration'
    || preview.mode !== 'repository_only'
    || preview.liveConfigurationAuthorized !== false
    || preview.activationAuthorized !== false) {
    blockers.push({ code: 'REMOTE_AUTHORITY_INVALID' });
  }
  if (!Array.isArray(preview.workflows) || preview.workflows.length !== 2) {
    blockers.push({ code: 'WORKFLOW_COUNT_INVALID' });
  }
  if (preview.targetGroupName !== LARK_NATIVE_AI_EXECUTIVE_GROUP_NAME
    || preview.destinationKeyHash !== LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH) {
    blockers.push({ code: 'DESTINATION_INVALID' });
  }
  if (preview.customAiFieldAuthority?.fieldCount !== 4
    || preview.customAiFieldAuthority?.usage !== 'target_fields_and_prompt_reference'
    || preview.customAiFieldAuthority?.promptCaptureComplete !== true) {
    blockers.push({ code: 'CUSTOM_AI_FIELD_AUTHORITY_INVALID' });
  }
  if (preview.automationAiOutputBinding?.exactCapabilityVerified !== true
    || preview.automationAiOutputBinding?.resultBinding
      !== 'ai_action_output_to_update_record_field'
    || preview.automationAiOutputBinding?.finalActionCount !== 4
    || preview.automationAiOutputBinding?.promptCaptureComplete !== true) {
    blockers.push({ code: 'AUTOMATION_AI_OUTPUT_BINDING_INVALID' });
  }
  const prompts = preview.automationPrompts;
  if (preview.automationPromptVersion !== LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION
    || !prompts || typeof prompts !== 'object'
    || Object.keys(prompts).sort().join(',')
      !== 'insight_summary,recommendations,strengths,weaknesses'
    || Object.values(prompts).some(({ text }) => typeof text !== 'string' || text.length < 200)) {
    blockers.push({ code: 'AUTOMATION_PROMPTS_INVALID' });
  }
  if (!SHA256_HEX.test(String(preview.notificationPayloadChecksum ?? ''))
    || preview.notificationPayloadChecksumAuthority !== 'repository_preview_only') {
    blockers.push({ code: 'PAYLOAD_PREVIEW_CHECKSUM_INVALID' });
  }
  if (preview.notificationChecksumPolicy?.liveAutomationPayloadChecksum !== null
    || preview.notificationChecksumPolicy?.liveAutomationStatus
      !== 'not_computed_in_lark_base_automation'
    || preview.notificationChecksumPolicy?.dedupeAuthority
      !== 'notification_attempt_key_and_dedupe_key'
    || preview.notificationChecksumPolicy?.blocking !== false
    || preview.notificationLogRecordPreview?.payload_checksum !== null) {
    blockers.push({ code: 'LIVE_CHECKSUM_POLICY_INVALID' });
  }
  if (preview.blockerCount !== 0 || !Array.isArray(preview.blockers)
    || preview.blockers.length !== 0) {
    blockers.push({ code: 'BLOCKER_STATE_INVALID' });
  }
  const serialized = stableStringify(preview.notificationPayloadPreview ?? {});
  if (UNSAFE_DESTINATION_OR_SECRET.test(serialized)) blockers.push({ code: 'PAYLOAD_UNSAFE' });
  if (preview.safety?.remoteLarkRead !== 0
    || preview.safety?.remoteLarkWrite !== 0
    || preview.safety?.workflowCreate !== 0
    || preview.safety?.workflowUpdate !== 0
    || preview.safety?.workflowStatusChange !== 0
    || preview.safety?.nativeAiCall !== 0
    || preview.safety?.recordWrite !== 0
    || preview.safety?.notificationSend !== 0
    || preview.safety?.scheduleEnabled !== false
    || preview.safety?.production !== 'BLOCKED') {
    blockers.push({ code: 'SAFETY_BOUNDARY_INVALID' });
  }
  return Object.freeze(blockers.map(Object.freeze));
}

function normalizeAiRun(value) {
  const source = requireObject(value, 'aiRun');
  const windowDays = requireInteger(source.windowDays ?? source.window_days, 'aiRun.windowDays');
  if (!LARK_NATIVE_AI_NOTIFICATION_WINDOWS.includes(windowDays)) {
    fail('LARK_NATIVE_AI_WINDOW_UNSUPPORTED', { windowDays });
  }
  const severity = requireText(source.severity, 'aiRun.severity');
  if (!LARK_NATIVE_AI_NOTIFICATION_SEVERITIES.includes(severity)) {
    fail('LARK_NATIVE_AI_SEVERITY_UNSUPPORTED', { severity });
  }
  const normalized = {
    aiRunKey: requireIdentity(source.aiRunKey ?? source.ai_run_key, 'aiRun.aiRunKey'),
    reportId: requireIdentity(source.reportId ?? source.report_id, 'aiRun.reportId'),
    scopeType: requireIdentity(source.scopeType ?? source.scope_type, 'aiRun.scopeType'),
    windowDays,
    generationStatus: requireIdentity(
      source.generationStatus ?? source.generation_status,
      'aiRun.generationStatus',
    ),
    readinessStatus: requireIdentity(
      source.readinessStatus ?? source.readiness_status,
      'aiRun.readinessStatus',
    ),
    severity,
    notificationEligible: requireBoolean(
      source.notificationEligible ?? source.notification_eligible,
      'aiRun.notificationEligible',
    ),
    previewMode: requireBoolean(source.previewMode ?? source.preview_mode, 'aiRun.previewMode'),
    sentToGroup: requireBoolean(source.sentToGroup ?? source.sent_to_group, 'aiRun.sentToGroup'),
    dedupeKey: requireText(source.dedupeKey ?? source.dedupe_key, 'aiRun.dedupeKey'),
    insightSummary: requireText(
      source.insightSummary ?? source.insight_summary,
      'aiRun.insightSummary',
    ),
    strengths: requireText(source.strengths, 'aiRun.strengths'),
    weaknesses: requireText(source.weaknesses, 'aiRun.weaknesses'),
    recommendations: requireText(source.recommendations, 'aiRun.recommendations'),
  };
  if (normalized.scopeType !== 'executive') fail('LARK_NATIVE_AI_SCOPE_NOT_EXECUTIVE', {});
  if (normalized.generationStatus !== 'generated') fail('LARK_NATIVE_AI_NOT_GENERATED', {});
  if (!['report_available', 'report_partial'].includes(normalized.readinessStatus)) {
    fail('LARK_NATIVE_AI_READINESS_NOT_SENDABLE', {
      readinessStatus: normalized.readinessStatus,
    });
  }
  if (normalized.notificationEligible !== true) fail('LARK_NATIVE_AI_NOTIFICATION_NOT_ELIGIBLE', {});
  if (normalized.previewMode !== false) fail('LARK_NATIVE_AI_PREVIEW_SEND_FORBIDDEN', {});
  if (normalized.sentToGroup !== false) fail('LARK_NATIVE_AI_ALREADY_SENT', {});
  if (!SHA256_HEX.test(normalized.dedupeKey)) fail('LARK_NATIVE_AI_DEDUPE_KEY_INVALID', {});
  return Object.freeze(normalized);
}

function normalizeSnapshot(value, aiRun) {
  const source = requireObject(value, 'snapshot');
  const normalized = {
    reportId: requireIdentity(source.reportId ?? source.report_id, 'snapshot.reportId'),
    reportSettingKey: requireIdentity(
      source.reportSettingKey ?? source.report_setting_key,
      'snapshot.reportSettingKey',
    ),
    customerProfile: requireIdentity(
      source.customerProfile ?? source.customer_profile,
      'snapshot.customerProfile',
    ),
    periodStart: requireDateOnly(source.periodStart ?? source.period_start, 'snapshot.periodStart'),
    periodEnd: requireDateOnly(source.periodEnd ?? source.period_end, 'snapshot.periodEnd'),
  };
  if (normalized.reportId !== aiRun.reportId) fail('LARK_NATIVE_AI_REPORT_ID_MISMATCH', {});
  if (normalized.periodStart > normalized.periodEnd) fail('LARK_NATIVE_AI_PERIOD_INVALID', {});
  return Object.freeze(normalized);
}

function normalizeSettings(value, snapshot) {
  const source = requireObject(value, 'settings');
  const normalized = {
    reportSettingKey: requireIdentity(
      source.reportSettingKey ?? source.report_setting_key,
      'settings.reportSettingKey',
    ),
    customerProfile: requireIdentity(
      source.customerProfile ?? source.customer_profile,
      'settings.customerProfile',
    ),
    enabled: requireBoolean(source.enabled, 'settings.enabled'),
    notificationEnabled: requireBoolean(
      source.notificationEnabled ?? source.notification_enabled,
      'settings.notificationEnabled',
    ),
    destinationKeyHash: requireText(
      source.destinationKeyHash ?? source.destination_key_hash,
      'settings.destinationKeyHash',
    ),
  };
  if (normalized.reportSettingKey !== snapshot.reportSettingKey
    || normalized.customerProfile !== snapshot.customerProfile) {
    fail('LARK_NATIVE_AI_SETTINGS_IDENTITY_MISMATCH', {});
  }
  if (normalized.enabled !== true || normalized.notificationEnabled !== true) {
    fail('LARK_NATIVE_AI_SETTINGS_DISABLED', {});
  }
  if (normalized.destinationKeyHash !== LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH) {
    fail('LARK_NATIVE_AI_DESTINATION_MISMATCH', {});
  }
  return Object.freeze(normalized);
}

function buildExecutiveMessage({ aiRun, snapshot }) {
  const text = [
    `📊 Social MKT Executive Report — ${aiRun.windowDays}D`,
    `ช่วง: ${snapshot.periodStart} ถึง ${snapshot.periodEnd}`,
    `ระดับ: ${aiRun.severity}`,
    `สถานะข้อมูล: ${aiRun.readinessStatus}`,
    '',
    'สรุป',
    aiRun.insightSummary,
    '',
    'จุดแข็ง',
    aiRun.strengths,
    '',
    'จุดที่ต้องระวัง',
    aiRun.weaknesses,
    '',
    'ข้อเสนอแนะ',
    aiRun.recommendations,
    '',
    'สร้างจาก Central Report Metrics ที่ผ่านการตรวจสอบ',
  ].join('\n');
  if (UNSAFE_DESTINATION_OR_SECRET.test(text)) fail('LARK_NATIVE_AI_MESSAGE_UNSAFE', {});
  return Object.freeze({
    format: 'plain_text',
    language: 'th',
    title: `📊 Social MKT Executive Report — ${aiRun.windowDays}D`,
    text,
  });
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required');
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} is required`);
  return value.trim();
}
function requireIdentity(value, field) {
  const text = requireText(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(text)) {
    throw new TypeError(`${field} must be a stable identity`);
  }
  return text;
}
function requireBoolean(value, field) {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be Boolean`);
  return value;
}
function requireInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${field} must be a positive integer`);
  return number;
}
function requireDateOnly(value, field) {
  const text = requireText(value, field);
  if (!DATE_ONLY.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00.000Z`))) {
    throw new TypeError(`${field} must be YYYY-MM-DD`);
  }
  return text;
}
function fail(code, details) {
  const error = new TypeError(code);
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}
function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}
