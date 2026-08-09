import { createHash } from 'node:crypto';

import {
  LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE,
  buildLarkWeeklyExecutiveFullChannelAiEvidence,
  validateLarkWeeklyExecutiveFullChannelAiOutputs,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';
import {
  parseLarkWeeklyExecutiveFactualReport,
  serializeLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
} from '../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import {
  isExactAcceptedWeekly7dSource,
} from './lark-weekly-7d-notification-admission.js';
import { parseSourceReportIds } from './lark-notification-controlled-uat.js';

export const LARK_WEEKLY_7D_FULL_CHANNEL_AI_SYNTHESIS_CONTRACT_VERSION =
  'lark_weekly_7d_full_channel_ai_synthesis_v1';
export const LARK_WEEKLY_7D_FULL_CHANNEL_AI_SYNTHESIS_PREFIX =
  'weekly-7d-full-channel-ai:';
export const LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_MARKER =
  'CONTROLLED_UAT_FULL_CHANNEL_AI_SYNTHESIS_V1';

const HASH = /^[a-f0-9]{64}$/u;
const OUTPUT_FIELDS = Object.freeze([
  'insight_summary',
  'strengths',
  'weaknesses',
  'recommendations',
]);

export function buildLarkWeekly7dFullChannelAiSynthesis(input = {}) {
  const sourceRecord = normalizeRecord(input.sourceRecord);
  if (!isExactAcceptedWeekly7dSource(sourceRecord.fields)) {
    throw synthesisError(
      'Full-channel AI synthesis requires the exact accepted V9 source row',
      'LARK_WEEKLY_7D_FULL_CHANNEL_AI_SOURCE_INVALID',
    );
  }
  const factualReport = parseLarkWeeklyExecutiveFactualReport(input.factualReport);
  const sourceReportIds = parseSourceReportIds(sourceRecord.fields.source_report_ids_json);
  if (JSON.stringify([...sourceReportIds].sort()) !== JSON.stringify([...factualReport.sourceReportIds].sort())) {
    throw synthesisError(
      'Full-channel AI synthesis factual Report identities differ from accepted V9 authority',
      'LARK_WEEKLY_7D_FULL_CHANNEL_AI_SOURCE_DRIFT',
    );
  }
  const evidence = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport,
    channelStatusVectorJson: requireText(scalar(sourceRecord.fields.channel_status_vector_json), 'channel_status_vector_json'),
  });
  const sourceAiRunKey = requireText(scalar(sourceRecord.fields.ai_run_key), 'source.ai_run_key');
  const sourceDedupeKey = requireHash(scalar(sourceRecord.fields.dedupe_key), 'source.dedupe_key');
  const factualJson = serializeLarkWeeklyExecutiveFactualReport(factualReport);
  const factualSha256 = sha256(factualJson);
  const evidenceSha256 = sha256(evidence.metricSummaryJson);
  const identity = sha256(JSON.stringify({
    contractVersion: LARK_WEEKLY_7D_FULL_CHANNEL_AI_SYNTHESIS_CONTRACT_VERSION,
    sourceAiRunKey,
    sourceDedupeKey,
    sourceReportIds,
    factualSha256,
    evidenceSha256,
  }));
  const aiRunKey = `${LARK_WEEKLY_7D_FULL_CHANNEL_AI_SYNTHESIS_PREFIX}${identity}`;
  const fields = structuredClone(sourceRecord.fields);
  Object.assign(fields, {
    ai_run_key: aiRunKey,
    report_id: aiRunKey,
    template_version: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
    metric_summary_json: evidence.metricSummaryJson,
    channel_status_vector_json: evidence.channelStatusVectorJson,
    source_report_ids_json: JSON.stringify(sourceReportIds),
    source_report_checksum: sha256(JSON.stringify({ sourceReportIds, factualSha256 })),
    dedupe_key: sha256(`${sourceDedupeKey}:${LARK_WEEKLY_7D_FULL_CHANNEL_AI_SYNTHESIS_CONTRACT_VERSION}:${identity}`),
    insight_summary: null,
    strengths: null,
    weaknesses: null,
    recommendations: null,
    generation_status: 'pending',
    failure_code: null,
    generated_at: null,
    preview_mode: true,
    notification_eligible: false,
    notification_reason: 'controlled_preview',
    sent_to_group: false,
    sent_at: null,
    cooldown_until: null,
  });
  return deepFreeze({
    sourceRecordId: sourceRecord.recordId,
    sourceAiRunKey,
    sourceDedupeKey,
    sourceReportIds,
    aiRunKey,
    dedupeKey: fields.dedupe_key,
    factualReport,
    factualReportSha256: factualSha256,
    evidence,
    fields,
  });
}

export function isLarkWeekly7dFullChannelAiIdentity(value) {
  const text = typeof value === 'string' ? value : '';
  return text.startsWith(LARK_WEEKLY_7D_FULL_CHANNEL_AI_SYNTHESIS_PREFIX)
    && HASH.test(text.slice(LARK_WEEKLY_7D_FULL_CHANNEL_AI_SYNTHESIS_PREFIX.length));
}

export function assertLarkWeekly7dFullChannelAiPrepared(fields = {}, expected = {}) {
  const invalid = [];
  if (scalar(fields.ai_run_key) !== expected.aiRunKey) invalid.push('aiRunKey');
  if (scalar(fields.report_id) !== expected.aiRunKey) invalid.push('reportId');
  if (scalar(fields.template_version) !== LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION) invalid.push('templateVersion');
  if (scalar(fields.scope_type) !== 'executive') invalid.push('scopeType');
  if (scalar(fields.channel_key) !== 'executive') invalid.push('channelKey');
  if (Number(scalar(fields.window_days)) !== 7) invalid.push('windowDays');
  if (scalar(fields.generation_status) !== 'pending') invalid.push('generationStatus');
  if (scalar(fields.failure_code) !== null) invalid.push('failureCode');
  if (booleanValue(fields.preview_mode) !== true) invalid.push('previewMode');
  if (booleanValue(fields.notification_eligible) !== false) invalid.push('notificationEligible');
  if (booleanValue(fields.sent_to_group) !== false) invalid.push('sentToGroup');
  if (OUTPUT_FIELDS.some((field) => scalar(fields[field]) !== null)) invalid.push('outputs');
  const promptShape = parsePromptShape(fields.metric_summary_json);
  if (promptShape !== LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE) invalid.push('promptShape');
  if (invalid.length > 0) {
    throw synthesisError(
      'Full-channel AI synthesis prepared row is outside the reviewed boundary',
      'LARK_WEEKLY_7D_FULL_CHANNEL_AI_PREPARED_INVALID',
      { invalid },
    );
  }
  return true;
}

export function assertLarkWeekly7dFullChannelAiGenerated(fields = {}, expected = {}) {
  const invalid = [];
  if (scalar(fields.ai_run_key) !== expected.aiRunKey) invalid.push('aiRunKey');
  if (scalar(fields.generation_status) !== 'generated') invalid.push('generationStatus');
  if (scalar(fields.failure_code) !== null) invalid.push('failureCode');
  if (booleanValue(fields.preview_mode) !== true) invalid.push('previewMode');
  if (booleanValue(fields.notification_eligible) !== false) invalid.push('notificationEligible');
  if (booleanValue(fields.sent_to_group) !== false) invalid.push('sentToGroup');
  if (OUTPUT_FIELDS.some((field) => !requireOptionalText(scalar(fields[field])))) invalid.push('outputs');
  const promptShape = parsePromptShape(fields.metric_summary_json);
  if (promptShape !== LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE) invalid.push('promptShape');
  if (invalid.length > 0) {
    throw synthesisError(
      'Full-channel AI synthesis did not converge to one generated preview row',
      'LARK_WEEKLY_7D_FULL_CHANNEL_AI_GENERATED_INVALID',
      { invalid },
    );
  }
  const outputs = readOutputs(fields);
  const qualityGate = validateLarkWeeklyExecutiveFullChannelAiOutputs(outputs, expected.evidence.evidence);
  if (!qualityGate.passed) {
    throw synthesisError(
      'Full-channel AI synthesis failed the cross-channel quality gate',
      'LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED',
      { violations: qualityGate.violations },
    );
  }
  return deepFreeze({ outputs, qualityGate });
}

export function readLarkWeekly7dFullChannelAiOutputs(fields = {}) {
  return readOutputs(fields);
}

function readOutputs(fields) {
  return deepFreeze(Object.fromEntries(OUTPUT_FIELDS.map((field) => [
    field,
    requireText(scalar(fields[field]), field),
  ])));
}
function parsePromptShape(value) {
  try {
    const parsed = JSON.parse(requireText(scalar(value), 'metric_summary_json'));
    return parsed?.promptShape ?? null;
  } catch {
    return null;
  }
}
function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('sourceRecord is required');
  if (!record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)) throw new TypeError('sourceRecord.fields is required');
  return Object.freeze({ recordId: record.recordId ?? record.record_id ?? null, fields: record.fields });
}
function booleanValue(value) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  return null;
}
function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return scalar(value[0]);
    return value.map(scalar).join('');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) {
      if (value[key] !== undefined) return scalar(value[key]);
    }
  }
  return value;
}
function requireOptionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function requireText(value, fieldName) {
  const text = requireOptionalText(value);
  if (!text) throw synthesisError(`${fieldName} is required`, 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_INPUT_REQUIRED', { fieldName });
  return text;
}
function requireHash(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!HASH.test(text)) throw synthesisError(`${fieldName} must be SHA-256`, 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_INPUT_REQUIRED', { fieldName });
  return text;
}
function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
function synthesisError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dFullChannelAiSynthesisError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}
