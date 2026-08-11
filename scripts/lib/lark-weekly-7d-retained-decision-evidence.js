import { createHash } from 'node:crypto';

import {
  resolveDashboardReportSourceAuthority,
} from '../../packages/application/src/reports/dashboard-report-source-authority.js';
import {
  validateLarkWeeklyExecutiveFullChannelAiOutputs,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';
import {
  readLarkWeeklyExecutiveCompactAiEvidence,
} from '../../packages/application/src/reports/read-lark-weekly-executive-compact-ai-evidence.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
} from '../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import {
  LARK_WEEKLY_7D_ACCEPTED_FACTUAL_RENDER,
  LARK_WEEKLY_7D_ACCEPTED_FACTUAL_REPORT_SHA256,
  LARK_WEEKLY_7D_ACCEPTED_CHANNEL_SECTIONS_SHA256,
  renderAcceptedWeekly7dChannelSections,
} from './lark-weekly-7d-accepted-factual-render.js';
import {
  assertFreshWeekly7dDecisionPeriod,
  isLarkWeekly7dExecutiveDecisionIdentity,
} from './lark-weekly-7d-executive-decision-preview.js';

export const LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256 =
  '24ed4cbae0a92e6dd89e850833056ca411781275c53fa9f8d7577c99a3d9c861';
export const LARK_WEEKLY_7D_NOTIFICATION_LOCKED_FACTUAL_REPORT_SHA256 =
  LARK_WEEKLY_7D_ACCEPTED_FACTUAL_REPORT_SHA256;
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
const LOCKED_PERIOD = Object.freeze({
  periodStart: '2026-08-03',
  periodEnd: '2026-08-09',
  compareStart: '2026-07-27',
  compareEnd: '2026-08-02',
  comparisonMode: 'previous_period',
  windowDays: 7,
});
const CTR_CLAIM = /\bCTR\b|อัตราการคลิก|ค่าดัชนีการคลิก/iu;

/**
 * Resolve the immutable accepted Fresh v4 authority without rolling Snapshots or ignored local
 * output files. Native-AI outputs and compact evidence come from the durable Lark AI row. Exact
 * Report identities are regenerated through shared materialization contracts. The deterministic
 * factual channel render is retained in source control and bound to the accepted factual SHA.
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
  const factualRender = assertAcceptedFactualRender(sourceAuthority.period);
  const evidence = readLarkWeeklyExecutiveCompactAiEvidence({
    metricSummaryJson: sourceAuthority.metricSummaryJson,
    channelStatusVectorJson: sourceAuthority.channelStatusVectorJson,
  });
  assertCompactRecommendationAuthority(sourceAuthority.outputs, evidence);
  assertCompactInsightBoundary(sourceAuthority.outputs, evidence);
  const qualityGate = validateLarkWeeklyExecutiveFullChannelAiOutputs(
    sourceAuthority.outputs,
    evidence,
  );
  if (qualityGate.passed !== true || qualityGate.violations.length !== 0) {
    throw evidenceError(
      'Accepted Fresh v4 outputs no longer pass the unchanged Executive Decision Quality Gate',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_QUALITY_FAILED',
      { violations: qualityGate.violations },
    );
  }

  return deepFreeze({
    sourceRecord,
    sourceAuthority,
    reportAuthority,
    evidence,
    qualityGate,
    factualRender,
  });
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
  const channelStatusVectorJson = requireText(
    scalar(fields.channel_status_vector_json),
    'channel_status_vector_json',
  );
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
  return deepFreeze({
    sourceAiRunKey,
    sourceReportIds,
    period,
    outputs,
    metricSummaryJson,
    channelStatusVectorJson,
    sourceReportChecksum,
  });
}

function assertAcceptedFactualRender(period) {
  const render = LARK_WEEKLY_7D_ACCEPTED_FACTUAL_RENDER;
  const invalid = [];
  if (render.factualReportSha256 !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_FACTUAL_REPORT_SHA256) {
    invalid.push('factualReportSha256');
  }
  if (JSON.stringify(render.period) !== JSON.stringify(period)) invalid.push('period');
  const channelSectionsText = renderAcceptedWeekly7dChannelSections();
  const observedSectionsSha256 = sha256(channelSectionsText);
  if (render.channelSectionsSha256 !== LARK_WEEKLY_7D_ACCEPTED_CHANNEL_SECTIONS_SHA256
      || observedSectionsSha256 !== LARK_WEEKLY_7D_ACCEPTED_CHANNEL_SECTIONS_SHA256) {
    invalid.push('channelSectionsSha256');
  }
  if (render.channelSections.length !== 9) invalid.push('channelSectionCount');
  if (invalid.length > 0) {
    throw evidenceError(
      'Tracked Weekly factual rendering drifted from the accepted factual-report authority',
      'LARK_WEEKLY_7D_NOTIFICATION_FACTUAL_RENDER_INVALID',
      { invalid },
    );
  }
  return deepFreeze({
    ...render,
    channelSectionsText,
    observedSectionsSha256,
  });
}

function assertCompactRecommendationAuthority(outputs, evidence) {
  const blueprints = evidence.recommendationBlueprints ?? [];
  if (blueprints.length === 0 || outputs.recommendations !== blueprints.join('\n')) {
    throw evidenceError(
      'Accepted Fresh v4 Recommendations must equal durable rb blueprints member-for-member',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_RB_MISMATCH',
      { blueprintCount: blueprints.length },
    );
  }
  return true;
}

function assertCompactInsightBoundary(outputs, evidence) {
  // The compact paid tuple retains reviewed CTR but intentionally drops impressions. The original
  // Quality Gate can therefore validate all durable decision rules except recomputing an Insight
  // CTR claim. Fail stricter if Insight contains CTR rather than silently weakening that proof.
  if (CTR_CLAIM.test(outputs.insight_summary)) {
    throw evidenceError(
      'Compact retained evidence cannot re-prove an Insight CTR claim without impressions',
      'LARK_WEEKLY_7D_NOTIFICATION_COMPACT_INSIGHT_CTR_UNPROVABLE',
    );
  }
  if (evidence.organicPaidMappingAvailable !== false) {
    throw evidenceError(
      'Accepted Fresh compact evidence must retain organicPaidMappingAvailable=false',
      'LARK_WEEKLY_7D_NOTIFICATION_COMPACT_EVIDENCE_INVALID',
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
function requireRepository(repository) {
  if (typeof repository?.listByFieldValues !== 'function') throw new TypeError('repository.listByFieldValues is required');
  return repository;
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
