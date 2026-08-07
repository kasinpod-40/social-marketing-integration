import {
  LARK_NATIVE_AI_AUTOMATION_PROMPTS,
  LARK_NATIVE_AI_AUTOMATION_PROMPT_REFERENCE_SLOTS,
  LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION,
} from '../../../config/src/lark-native-ai-automation-prompt-contract.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_SAFETY,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_VERSION,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_DAYS,
} from '../../../config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { stableStringify } from '../use-cases/build-report-snapshot.js';
import { buildAllChannelAiPreviewRows } from './build-all-channel-ai-preview.js';

const REQUIRED_WINDOWS = Object.freeze([1, 3, 7, 30]);
const SAFE_EXISTING_STATUSES = new Set(['pending', 'failed', 'skipped', 'generated']);
const UAT_OUTPUT_FIELDS = Object.freeze([
  'insight_summary',
  'strengths',
  'weaknesses',
  'recommendations',
]);

export async function buildLarkNativeAiWeekly7dControlledUat(input = {}) {
  const generatedAt = requireEpoch(input.generatedAt ?? Date.now(), 'generatedAt');
  const customerKey = requireText(input.customerKey ?? 'integration_workspace', 'customerKey');
  const customerProfile = requireText(input.customerProfile ?? 'integration_workspace', 'customerProfile');
  const utcOffset = requireText(input.utcOffset ?? '+07:00', 'utcOffset');
  const targetPeriod = normalizeTargetPeriod(input.targetPeriod);
  const periods = buildFourWindowPeriods(targetPeriod);
  const settings = requireArray(input.settings, 'settings');
  const reportBundles = requireArray(input.reportBundles, 'reportBundles');

  const rows = await buildAllChannelAiPreviewRows({
    customerKey,
    customerProfile,
    templateVersion: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
    generatedAt,
    utcOffset,
    periods,
    settings,
    reportBundles,
  });
  const matches = rows.filter((row) => (
    row.scope_type === 'executive'
    && Number(row.window_days) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_DAYS
  ));
  if (matches.length !== 1) throw uatError(
    'Weekly 7D controlled UAT must produce exactly one Executive row',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_EXECUTIVE_ROW_INVALID',
    { matchCount: matches.length },
  );
  const row = matches[0];
  if (row.preview_mode !== true
    || row.notification_eligible !== false
    || row.sent_to_group !== false
    || row.generation_status !== 'pending'
    || row.template_version !== LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION) {
    throw uatError(
      'Weekly 7D Executive UAT row is outside the controlled Preview boundary',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_ROW_UNSAFE',
      {
        previewMode: row.preview_mode,
        notificationEligible: row.notification_eligible,
        sentToGroup: row.sent_to_group,
        generationStatus: row.generation_status,
        templateVersion: row.template_version,
      },
    );
  }

  const parsedSummary = parseJsonObject(row.metric_summary_json, 'metric_summary_json');
  if (parsedSummary.evidenceShape !== 'executive_business_first_v2'
    || !Array.isArray(parsedSummary.channelBusinessEvidence)
    || parsedSummary.channelBusinessEvidence.length !== 9) {
    throw uatError(
      'Weekly Executive UAT is missing business-first v2 evidence',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_BUSINESS_EVIDENCE_INVALID',
    );
  }

  return deepFreeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_VERSION,
    targetPeriod,
    executiveRow: structuredClone(row),
    businessEvidenceSummary: summarizeBusinessEvidence(parsedSummary.channelBusinessEvidence),
    uiConfiguration: buildUiConfiguration(),
    safety: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_SAFETY,
  });
}

export function planLarkNativeAiWeekly7dControlledUatWrite(input = {}) {
  const desired = normalizeDesiredRow(input.desiredRow);
  const existingRecords = requireArray(input.existingRecords ?? [], 'existingRecords');
  if (existingRecords.length > 1) throw uatError(
    'Weekly Executive UAT ai_run_key is duplicated in Lark',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_DUPLICATE_IDENTITY',
    { count: existingRecords.length },
  );
  if (existingRecords.length === 0) {
    return deepFreeze({
      status: 'create',
      writeCount: 1,
      action: { action: 'create', fields: structuredClone(desired) },
    });
  }

  const existing = normalizeExistingRecord(existingRecords[0]);
  assertSafeExistingUatRow(existing.fields, desired);
  if (managedStateSignature(existing.fields) === managedStateSignature(desired)) {
    return deepFreeze({
      status: 'zero_drift',
      writeCount: 0,
      action: null,
      recordId: existing.recordId,
    });
  }
  return deepFreeze({
    status: 'update',
    writeCount: 1,
    action: {
      action: 'update',
      recordId: existing.recordId,
      fields: structuredClone(desired),
    },
  });
}

export function assertLarkNativeAiWeekly7dControlledUatReadback(input = {}) {
  const desired = normalizeDesiredRow(input.desiredRow);
  const records = requireArray(input.records, 'records');
  if (records.length !== 1) throw uatError(
    'Weekly Executive UAT readback requires exactly one row',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_READBACK_COUNT_INVALID',
    { count: records.length },
  );
  const existing = normalizeExistingRecord(records[0]);
  assertSafeExistingUatRow(existing.fields, desired);
  if (managedStateSignature(existing.fields) !== managedStateSignature(desired)) throw uatError(
    'Weekly Executive UAT readback does not match the reviewed business evidence',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_READBACK_DRIFT',
  );
  return deepFreeze({
    ok: true,
    recordId: existing.recordId,
    aiRunKey: desired.ai_run_key,
    generationStatus: normalizeTextField(existing.fields.generation_status),
  });
}

function buildUiConfiguration() {
  const actions = Object.values(LARK_NATIVE_AI_AUTOMATION_PROMPTS).map((prompt) => ({
    actionType: 'AI-generated text (GPT model)',
    targetField: prompt.fieldName,
    language: prompt.language,
    referenceSlots: [...prompt.referenceSlots],
    promptText: prompt.text,
  }));
  return deepFreeze({
    automationTitle: 'AI Materialization → MKT_AI_Report_Runs',
    automationStateRequired: 'inactive',
    promptVersion: LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION,
    referenceSlots: [...LARK_NATIVE_AI_AUTOMATION_PROMPT_REFERENCE_SLOTS],
    actionCount: actions.length,
    actions,
    finalUpdate: {
      targetTable: '🧠 MKT_AI_Report_Runs',
      targetIdentity: 'current trigger record',
      resultBindings: Object.fromEntries(actions.map(({ targetField }) => [targetField, `${targetField}:AI result`])),
      fixedFields: {
        generation_status: 'generated',
        failure_code: null,
        generated_at: 'automation_now',
      },
    },
    forbidden: [
      'activate automation during AI quality UAT',
      'send Lark Group message from AI Materialization automation',
      'change Eligible AI Run → Lark Group Notification automation',
      'set notification_eligible=true',
      'set preview_mode=false',
    ],
  });
}

function summarizeBusinessEvidence(channels) {
  return deepFreeze(channels.map((channel) => ({
    channelKey: channel.channelKey,
    displayName: channel.displayName,
    readinessStatus: channel.readinessStatus,
    metricCount: Array.isArray(channel.availableMetrics) ? channel.availableMetrics.length : 0,
    topContentCount: Array.isArray(channel.topContent) ? channel.topContent.length : 0,
    topAdsCount: Array.isArray(channel.topAds) ? channel.topAds.length : 0,
    collectionKeys: channel.collections && typeof channel.collections === 'object'
      ? Object.keys(channel.collections).sort()
      : [],
  })));
}

function buildFourWindowPeriods(target) {
  return deepFreeze(REQUIRED_WINDOWS.map((windowDays) => {
    if (windowDays === 7) return { ...target };
    const periodEnd = target.periodEnd;
    const periodStart = addDays(periodEnd, -(windowDays - 1));
    const compareEnd = addDays(periodStart, -1);
    const compareStart = addDays(compareEnd, -(windowDays - 1));
    return {
      windowDays,
      periodStart,
      periodEnd,
      comparisonMode: 'previous_period',
      compareStart,
      compareEnd,
    };
  }));
}

function normalizeTargetPeriod(value) {
  const period = requireObject(value, 'targetPeriod');
  const windowDays = Number(period.windowDays ?? period.window_days);
  if (windowDays !== 7) throw uatError(
    'Weekly controlled UAT requires a 7D target period',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_INVALID',
    { windowDays },
  );
  const periodStart = requireDateOnly(period.periodStart ?? period.period_start, 'targetPeriod.periodStart');
  const periodEnd = requireDateOnly(period.periodEnd ?? period.period_end, 'targetPeriod.periodEnd');
  if (periodStart > periodEnd) throw new RangeError('targetPeriod start must not be after end');
  const comparisonMode = optionalText(period.comparisonMode ?? period.comparison_mode) ?? 'none';
  const compareStart = optionalDateOnly(period.compareStart ?? period.compare_start);
  const compareEnd = optionalDateOnly(period.compareEnd ?? period.compare_end);
  if (comparisonMode === 'none') {
    return deepFreeze({ windowDays: 7, periodStart, periodEnd, comparisonMode, compareStart: null, compareEnd: null });
  }
  if (!compareStart || !compareEnd) throw uatError(
    '7D trend language requires an exact previous-period date range',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_COMPARISON_INVALID',
  );
  return deepFreeze({ windowDays: 7, periodStart, periodEnd, comparisonMode, compareStart, compareEnd });
}

function assertSafeExistingUatRow(fields, desired) {
  const templateVersion = normalizeTextField(fields.template_version);
  const scopeType = normalizeTextField(fields.scope_type);
  const channelKey = normalizeTextField(fields.channel_key);
  const windowDays = Number(normalizeTextField(fields.window_days));
  const generationStatus = normalizeTextField(fields.generation_status);
  if (templateVersion !== LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION
    || scopeType !== 'executive'
    || channelKey !== 'executive'
    || windowDays !== 7
    || normalizeBoolean(fields.preview_mode) !== true
    || normalizeBoolean(fields.notification_eligible) !== false
    || normalizeBoolean(fields.sent_to_group) !== false
    || !SAFE_EXISTING_STATUSES.has(generationStatus)
    || normalizeTextField(fields.ai_run_key) !== desired.ai_run_key) {
    throw uatError(
      'Existing ai_run_key row is outside the isolated weekly Executive UAT boundary',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_EXISTING_ROW_UNSAFE',
    );
  }
}

function managedStateSignature(fields) {
  return stableStringify({
    ai_run_key: normalizeTextField(fields.ai_run_key),
    report_id: normalizeTextField(fields.report_id),
    scope_type: normalizeTextField(fields.scope_type),
    channel_key: normalizeTextField(fields.channel_key),
    window_days: normalizeTextField(fields.window_days),
    period_start: normalizeNumber(fields.period_start),
    period_end: normalizeNumber(fields.period_end),
    compare_start: normalizeNumber(fields.compare_start),
    compare_end: normalizeNumber(fields.compare_end),
    comparison_mode: normalizeTextField(fields.comparison_mode),
    metric_summary_json: normalizeTextField(fields.metric_summary_json),
    source_report_ids_json: normalizeTextField(fields.source_report_ids_json),
    source_report_checksum: normalizeTextField(fields.source_report_checksum),
    channel_status_vector_json: normalizeTextField(fields.channel_status_vector_json),
    readiness_status: normalizeTextField(fields.readiness_status),
    readiness_message: normalizeTextField(fields.readiness_message),
    severity: normalizeTextField(fields.severity),
    dedupe_key: normalizeTextField(fields.dedupe_key),
    template_version: normalizeTextField(fields.template_version),
    preview_mode: normalizeBoolean(fields.preview_mode),
    notification_eligible: normalizeBoolean(fields.notification_eligible),
    sent_to_group: normalizeBoolean(fields.sent_to_group),
    generation_status: normalizeTextField(fields.generation_status),
    insight_summary: normalizeNullableText(fields.insight_summary),
    strengths: normalizeNullableText(fields.strengths),
    weaknesses: normalizeNullableText(fields.weaknesses),
    recommendations: normalizeNullableText(fields.recommendations),
  });
}

function normalizeDesiredRow(value) {
  const row = requireObject(value, 'desiredRow');
  if (row.scope_type !== 'executive'
    || Number(row.window_days) !== 7
    || row.preview_mode !== true
    || row.notification_eligible !== false
    || row.sent_to_group !== false
    || row.template_version !== LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION) {
    throw uatError(
      'Desired weekly Executive row is unsafe',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_DESIRED_ROW_UNSAFE',
    );
  }
  return deepFreeze(structuredClone(row));
}
function normalizeExistingRecord(value) {
  const record = requireObject(value, 'existingRecord');
  return deepFreeze({
    recordId: requireText(record.recordId ?? record.record_id, 'existingRecord.recordId'),
    fields: structuredClone(requireObject(record.fields, 'existingRecord.fields')),
  });
}
function parseJsonObject(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw uatError(`${label} must be a JSON object`, 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_JSON_INVALID', { label });
  }
}
function addDays(dateOnly, days) {
  const epoch = Date.parse(`${dateOnly}T00:00:00.000Z`);
  if (!Number.isFinite(epoch)) throw new TypeError(`Invalid date: ${dateOnly}`);
  return new Date(epoch + (days * 86_400_000)).toISOString().slice(0, 10);
}
function requireDateOnly(value, label) {
  const text = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00.000Z`))) {
    throw new TypeError(`${label} must be YYYY-MM-DD`);
  }
  return text;
}
function optionalDateOnly(value) { return value == null || value === '' ? null : requireDateOnly(value, 'date'); }
function normalizeTextField(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(normalizeTextField).join('').trim();
  if (value && typeof value === 'object') return normalizeTextField(value.text ?? value.value ?? value.name ?? '');
  return value == null ? '' : String(value).trim();
}
function normalizeNullableText(value) { const text = normalizeTextField(value); return text || null; }
function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || value == null || value === '' || String(value).toLowerCase() === 'false') return false;
  return Boolean(value);
}
function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const candidate = scalar && typeof scalar === 'object' ? scalar.value ?? scalar.text : scalar;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : null;
}
function requireEpoch(value, label) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${label} must be an epoch`); return Math.trunc(number); }
function optionalText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function requireText(value, label) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`); return value.trim(); }
function requireArray(value, label) { if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`); return value; }
function requireObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value; }
function deepFreeze(value, seen = new WeakSet()) { if (value && typeof value === 'object') { if (seen.has(value)) return value; seen.add(value); for (const nested of Object.values(value)) deepFreeze(nested, seen); Object.freeze(value); } return value; }
export function weekly7dControlledUatError(message, code, details = {}) { return uatError(message, code, details); }
function uatError(message, code, details = {}) { const error = new Error(message); error.name = 'LarkNativeAiWeekly7dControlledUatError'; error.code = code; error.details = deepFreeze(structuredClone(details)); return error; }
