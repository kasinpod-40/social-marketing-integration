import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  resolveDashboardReportSourceAuthority,
} from '../../packages/application/src/reports/dashboard-report-source-authority.js';
import {
  LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
} from '../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import {
  assertFreshWeekly7dDecisionPeriod,
  isLarkWeekly7dExecutiveDecisionIdentity,
} from './lark-weekly-7d-executive-decision-preview.js';

export const LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256 =
  '24ed4cbae0a92e6dd89e850833056ca411781275c53fa9f8d7577c99a3d9c861';
export const LARK_WEEKLY_7D_NOTIFICATION_LOCKED_FACTUAL_REPORT_SHA256 =
  'a732d4c4790ef99261e23e6a129a38822e9268a1f478387dfc2e82126b8a6fea';
export const LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_SHA256 =
  '6b8a2f1d2243c0bb2575082afb4e5ea7a530e8d16de31a02ee666fcf27da2a5f';
export const LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_BYTES = 4118;
export const LARK_WEEKLY_7D_NOTIFICATION_LOCKED_PLATFORM_SCOPES = Object.freeze([
  'chatwoot',
  'facebook',
  'google_ads',
  'instagram',
  'meta_ads',
  'tiktok',
  'woocommerce',
  'youtube',
]);

const HASH = /^[a-f0-9]{64}$/u;
const SOURCE_SCOPE = 'executive';
const SOURCE_CHANNEL = 'executive';
const SOURCE_PROFILE = 'integration_workspace';
const SOURCE_ACCOUNT_KEY = 'chemistry_k';
const LOCKED_GENERATED_AT = 1_786_385_677_223;
const RETAINED_SUMMARY_FILE = 'decision-preview-summary.json';
const LOCKED_PERIOD = Object.freeze({
  periodStart: '2026-08-03',
  periodEnd: '2026-08-09',
  compareStart: '2026-07-27',
  compareEnd: '2026-08-02',
  comparisonMode: 'previous_period',
  windowDays: 7,
});

/**
 * Resolve the immutable accepted Fresh v4 row and its retained review evidence without reading
 * rolling Report Snapshot rows. The accepted Report identities are regenerated through the same
 * shared materialization contracts that originally created them.
 */
export async function loadLockedFreshWeekly7dDecisionEvidence(input = {}) {
  const repository = requireRepository(input.repository);
  const aiRunsTableId = requireText(input.aiRunsTableId, 'aiRunsTableId');
  const executiveRows = await repository.listByFieldValues(
    aiRunsTableId,
    'scope_type',
    [SOURCE_SCOPE],
  );
  const matches = executiveRows.filter((record) => {
    const key = optionalText(scalar(record?.fields?.ai_run_key));
    return key
      && isLarkWeekly7dExecutiveDecisionIdentity(key)
      && sha256(key) === LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256;
  });
  if (matches.length !== 1) {
    throw evidenceError(
      'Expected exactly one retained accepted Fresh Weekly Executive Decision source row',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
      { matchCount: matches.length },
    );
  }

  const sourceRecord = normalizeRecord(matches[0]);
  const sourceAuthority = assertLockedSourceFields(sourceRecord.fields, input.now ?? Date.now());
  const reportAuthority = resolveDashboardReportSourceAuthority({
    sourceReportIds: sourceAuthority.sourceReportIds,
    platformScopes: LARK_WEEKLY_7D_NOTIFICATION_LOCKED_PLATFORM_SCOPES,
    profileKey: SOURCE_PROFILE,
    accountKey: SOURCE_ACCOUNT_KEY,
    periodKind: 'rolling_days',
    periodStart: sourceAuthority.period.periodStart,
    periodEnd: sourceAuthority.period.periodEnd,
    windowDays: 7,
  });
  const retainedSummary = await readLockedSummary(input.decisionEvidenceRoot);
  assertLockedSummary(retainedSummary, sourceAuthority);

  return deepFreeze({ sourceRecord, sourceAuthority, reportAuthority, retainedSummary });
}

function assertLockedSourceFields(fields = {}, now) {
  const invalid = [];
  const sourceAiRunKey = requireText(scalar(fields.ai_run_key), 'source.ai_run_key');
  if (!isLarkWeekly7dExecutiveDecisionIdentity(sourceAiRunKey)) invalid.push('aiRunKey');
  if (sha256(sourceAiRunKey) !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256) {
    invalid.push('sourceIdentitySha256');
  }
  if (scalar(fields.template_version) !== LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION) invalid.push('templateVersion');
  if (scalar(fields.scope_type) !== SOURCE_SCOPE) invalid.push('scopeType');
  if (scalar(fields.channel_key) !== SOURCE_CHANNEL) invalid.push('channelKey');
  if (Number(scalar(fields.window_days)) !== 7) invalid.push('windowDays');
  if (!['report_available', 'report_partial'].includes(String(scalar(fields.readiness_status) ?? ''))) invalid.push('readinessStatus');
  if (scalar(fields.generation_status) !== 'generated') invalid.push('generationStatus');
  if (optionalText(scalar(fields.failure_code)) !== null) invalid.push('failureCode');
  if (booleanValue(fields.preview_mode) !== true) invalid.push('previewMode');
  if (booleanValue(fields.notification_eligible) !== false) invalid.push('notificationEligible');
  if (booleanValue(fields.sent_to_group) !== false) invalid.push('sentToGroup');
  if (Number(scalar(fields.generated_at)) !== LOCKED_GENERATED_AT) invalid.push('generatedAt');

  const period = Object.freeze({
    periodStart: dateOnlyValue(fields.period_start),
    periodEnd: dateOnlyValue(fields.period_end),
    compareStart: nullableDateOnlyValue(fields.compare_start),
    compareEnd: nullableDateOnlyValue(fields.compare_end),
    comparisonMode: requireText(scalar(fields.comparison_mode) ?? 'none', 'comparison_mode'),
    windowDays: 7,
  });
  assertFreshWeekly7dDecisionPeriod(period, now);
  if (JSON.stringify(period) !== JSON.stringify(LOCKED_PERIOD)) invalid.push('period');

  const sourceReportIds = parseSourceReportIds(fields.source_report_ids_json);
  if (sourceReportIds.length !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_PLATFORM_SCOPES.length) {
    invalid.push('sourceReportCount');
  }
  const outputs = readOutputs(fields);
  const metricSummaryJson = requireText(scalar(fields.metric_summary_json), 'metric_summary_json');
  const metricSummary = parseJsonObject(metricSummaryJson, 'metric_summary_json');
  if (metricSummary.promptShape !== LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE) invalid.push('promptShape');
  const statusVector = parseJsonArray(
    requireText(scalar(fields.channel_status_vector_json), 'channel_status_vector_json'),
    'channel_status_vector_json',
  );
  if (statusVector.length !== 9) invalid.push('channelStatusVector');

  const sourceReportChecksum = requireHash(
    scalar(fields.source_report_checksum),
    'source_report_checksum',
  );
  const expectedSourceReportChecksum = sha256(JSON.stringify({
    sourceReportIds,
    period,
    factualSha256: LARK_WEEKLY_7D_NOTIFICATION_LOCKED_FACTUAL_REPORT_SHA256,
  }));
  if (sourceReportChecksum !== expectedSourceReportChecksum) invalid.push('sourceReportChecksum');

  if (invalid.length > 0) {
    throw evidenceError(
      'Retained Fresh Weekly Executive Decision source drifted from the accepted v4 authority',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
      { invalid },
    );
  }
  return deepFreeze({ sourceAiRunKey, sourceReportIds, period, outputs, metricSummaryJson });
}

async function readLockedSummary(explicitRoot) {
  const evidenceRoot = resolve(
    explicitRoot
      ?? process.env.MKT_LARK_WEEKLY_7D_EXECUTIVE_DECISION_EVIDENCE_ROOT
      ?? 'outputs/lark-weekly-7d-executive-decision-preview',
  );
  const path = join(
    evidenceRoot,
    LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256,
    RETAINED_SUMMARY_FILE,
  );
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    throw evidenceError(
      'Accepted Fresh v4 requires its retained decision-preview summary evidence',
      'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_EVIDENCE_MISSING',
      { evidenceName: RETAINED_SUMMARY_FILE, causeCode: cause?.code ?? null },
    );
  }
}

function assertLockedSummary(summaryInput, sourceAuthority) {
  const summary = requireObject(summaryInput, 'retainedSummary');
  const invalid = [];
  const period = normalizePeriod(summary.period);
  const sourceReportIds = normalizeSourceReportIds(summary.sourceReportIds);
  const message = optionalText(summary.messagePreview);

  if (summary.ok !== true) invalid.push('ok');
  if (summary.synthesisState !== 'generated') invalid.push('synthesisState');
  if (summary.synthesisAiRunKeySha256 !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256) invalid.push('sourceIdentity');
  if (summary.factualReportSha256 !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_FACTUAL_REPORT_SHA256) invalid.push('factualReportSha256');
  if (JSON.stringify(period) !== JSON.stringify(LOCKED_PERIOD)) invalid.push('period');
  if (JSON.stringify(sourceReportIds) !== JSON.stringify(sourceAuthority.sourceReportIds)) invalid.push('sourceReportIds');
  try { assertOutputsEqual(sourceAuthority.outputs, summary.outputs); } catch { invalid.push('outputs'); }
  if (summary.qualityGate?.passed !== true
      || !Array.isArray(summary.qualityGate?.violations)
      || summary.qualityGate.violations.length !== 0) invalid.push('qualityGate');
  if (summary.evidence?.promptShape !== LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE) invalid.push('promptShape');
  if (!message) invalid.push('messagePreview');
  else {
    if (sha256(message) !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_SHA256) invalid.push('messageSha256Computed');
    if (Buffer.byteLength(message, 'utf8') !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_BYTES) invalid.push('messageBytesComputed');
  }
  if (summary.messageSha256 !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_SHA256) invalid.push('messageSha256');
  if (Number(summary.messageBytes) !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_BYTES) invalid.push('messageBytes');
  if (summary.persistedPreviewMode !== true) invalid.push('persistedPreviewMode');
  if (summary.persistedNotificationEligible !== false) invalid.push('persistedNotificationEligible');
  if (summary.persistedSentToGroup !== false) invalid.push('persistedSentToGroup');
  if (Number(summary.queueAdmissionCount ?? -1) !== 0) invalid.push('queueAdmissionCount');
  if (Number(summary.messageSendCount ?? -1) !== 0) invalid.push('messageSendCount');

  if (invalid.length > 0) {
    throw evidenceError(
      'Retained Fresh v4 decision-preview evidence differs from the accepted reviewed authority',
      'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_EVIDENCE_INVALID',
      { invalid },
    );
  }
  return true;
}

function assertOutputsEqual(expectedInput, observedInput) {
  const expected = readOutputs(expectedInput);
  const observed = readOutputs(observedInput);
  if (JSON.stringify(expected) !== JSON.stringify(observed)) {
    throw evidenceError(
      'Retained Fresh outputs differ from the accepted generated source row',
      'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_EVIDENCE_INVALID',
    );
  }
  return true;
}
function readOutputs(fields = {}) {
  return Object.freeze({
    insight_summary: requireText(scalar(fields.insight_summary), 'insight_summary'),
    strengths: requireText(scalar(fields.strengths), 'strengths'),
    weaknesses: requireText(scalar(fields.weaknesses), 'weaknesses'),
    recommendations: requireText(scalar(fields.recommendations), 'recommendations'),
  });
}
function normalizePeriod(value) {
  const period = requireObject(value, 'period');
  return Object.freeze({
    periodStart: requireDateOnly(period.periodStart ?? period.period_start, 'periodStart'),
    periodEnd: requireDateOnly(period.periodEnd ?? period.period_end, 'periodEnd'),
    compareStart: optionalDateOnly(period.compareStart ?? period.compare_start),
    compareEnd: optionalDateOnly(period.compareEnd ?? period.compare_end),
    comparisonMode: requireText(period.comparisonMode ?? period.comparison_mode ?? 'none', 'comparisonMode'),
    windowDays: Number(period.windowDays ?? period.window_days ?? 7),
  });
}
function normalizeSourceReportIds(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError('sourceReportIds must be a non-empty array');
  const rows = value.map((item) => requireText(item, 'source_report_id'));
  if (new Set(rows).size !== rows.length) throw new TypeError('sourceReportIds must not contain duplicates');
  return rows.sort();
}
function parseSourceReportIds(value) {
  try {
    return Object.freeze(normalizeSourceReportIds(JSON.parse(requireText(scalar(value), 'source_report_ids_json'))));
  } catch (cause) {
    if (cause?.code) throw cause;
    throw evidenceError(
      'Fresh Weekly Executive Decision source Report identities are invalid',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
    );
  }
}
function parseJsonObject(value, label) {
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw evidenceError(`${label} must be a JSON object`, 'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID');
  }
}
function parseJsonArray(value, label) {
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed;
  } catch {
    throw evidenceError(`${label} must be a JSON array`, 'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID');
  }
}
function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('sourceRecord is required');
  if (!record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)) throw new TypeError('sourceRecord.fields is required');
  return Object.freeze({ recordId: record.recordId ?? record.record_id ?? null, fields: record.fields });
}
function dateOnlyValue(value) {
  const item = scalar(value);
  if (typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(item)) return item;
  const epoch = Number(item);
  if (!Number.isFinite(epoch) || epoch <= 0) throw new TypeError('date authority is invalid');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(epoch));
  const byType = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
function nullableDateOnlyValue(value) {
  const item = scalar(value);
  return item === null || item === undefined || item === '' ? null : dateOnlyValue(item);
}
function optionalDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireDateOnly(value, 'optionalDate');
}
function requireDateOnly(value, label) {
  const text = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new TypeError(`${label} must be date-only`);
  return text;
}
function requireRepository(repository) {
  if (typeof repository?.listByFieldValues !== 'function') throw new TypeError('repository.listByFieldValues is required');
  return repository;
}
function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} is required`);
  return value;
}
function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return scalar(value[0]);
    return value.map(scalar).join('');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) if (value[key] !== undefined) return scalar(value[key]);
  }
  return value;
}
function booleanValue(value) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  return null;
}
function requireText(value, label) {
  const normalized = value === null || value === undefined ? '' : String(scalar(value) ?? '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}
function requireHash(value, label) {
  const text = requireText(value, label);
  if (!HASH.test(text)) throw new TypeError(`${label} must be SHA-256 hex`);
  return text;
}
function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
function evidenceError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dRetainedDecisionEvidenceError';
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
