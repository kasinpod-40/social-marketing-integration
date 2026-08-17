import { createHash } from 'node:crypto';

import {
  buildLarkWeeklyExecutiveFullChannelAiEvidence,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';
import {
  parseLarkWeeklyExecutiveFactualReport,
  serializeLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
} from '../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import {
  LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_MARKER,
  assertLarkWeekly7dFullChannelAiGenerated,
  assertLarkWeekly7dFullChannelAiPrepared,
} from './lark-weekly-7d-full-channel-ai-synthesis.js';

export const LARK_WEEKLY_7D_EXECUTIVE_DECISION_PREVIEW_CONTRACT_VERSION =
  'lark_weekly_7d_executive_decision_preview_v6';
export const LARK_WEEKLY_7D_EXECUTIVE_DECISION_AI_PREFIX =
  'weekly-7d-executive-decision-ai:';
export const LARK_WEEKLY_7D_EXECUTIVE_DECISION_LEGACY_TRIGGER_MARKER =
  'CONTROLLED_WEEKLY_EXECUTIVE_DECISION_PREVIEW_V1';
export const LARK_WEEKLY_7D_EXECUTIVE_DECISION_TRIGGER_MARKER =
  LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_MARKER;
export const LARK_WEEKLY_7D_EXECUTIVE_DECISION_CLOSED_PERIOD_END = '2026-07-31';

const HASH = /^[a-f0-9]{64}$/u;

export function buildLarkWeekly7dExecutiveDecisionSynthesis(input = {}) {
  const sourceRecord = normalizeRecord(input.sourceRecord);
  const factualReport = parseLarkWeeklyExecutiveFactualReport(input.factualReport);
  const source = assertFreshDecisionSource(sourceRecord.fields, factualReport);
  const evidence = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport,
    channelStatusVectorJson: source.channelStatusVectorJson,
  });
  const factualJson = serializeLarkWeeklyExecutiveFactualReport(factualReport);
  const factualSha256 = sha256(factualJson);
  const evidenceSha256 = sha256(evidence.metricSummaryJson);
  const identity = sha256(JSON.stringify({
    contractVersion: LARK_WEEKLY_7D_EXECUTIVE_DECISION_PREVIEW_CONTRACT_VERSION,
    sourceAiRunKey: source.sourceAiRunKey,
    sourceDedupeKey: source.sourceDedupeKey,
    sourceReportIds: source.sourceReportIds,
    period: factualReport.period,
    factualSha256,
    evidenceSha256,
  }));
  const aiRunKey = `${LARK_WEEKLY_7D_EXECUTIVE_DECISION_AI_PREFIX}${identity}`;
  const fields = structuredClone(sourceRecord.fields);
  Object.assign(fields, {
    ai_run_key: aiRunKey,
    report_id: aiRunKey,
    template_version: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
    metric_summary_json: evidence.metricSummaryJson,
    channel_status_vector_json: evidence.channelStatusVectorJson,
    source_report_ids_json: JSON.stringify(source.sourceReportIds),
    source_report_checksum: sha256(JSON.stringify({
      sourceReportIds: source.sourceReportIds,
      period: factualReport.period,
      factualSha256,
    })),
    dedupe_key: sha256(`${source.sourceDedupeKey}:${LARK_WEEKLY_7D_EXECUTIVE_DECISION_PREVIEW_CONTRACT_VERSION}:${identity}`),
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
    sourceAiRunKey: source.sourceAiRunKey,
    sourceDedupeKey: source.sourceDedupeKey,
    sourceReportIds: source.sourceReportIds,
    aiRunKey,
    dedupeKey: fields.dedupe_key,
    factualReport,
    factualReportSha256: factualSha256,
    evidence,
    fields,
  });
}

export function assertLarkWeekly7dExecutiveDecisionPrepared(fields, expected) {
  if (scalar(fields?.failure_code) === LARK_WEEKLY_7D_EXECUTIVE_DECISION_LEGACY_TRIGGER_MARKER) {
    return assertLarkWeekly7dFullChannelAiPrepared({ ...fields, failure_code: null }, expected);
  }
  return assertLarkWeekly7dFullChannelAiPrepared(fields, expected);
}

export function assertLarkWeekly7dExecutiveDecisionGenerated(fields, expected) {
  return assertLarkWeekly7dFullChannelAiGenerated(fields, expected);
}

export function isLarkWeekly7dExecutiveDecisionIdentity(value) {
  const text = typeof value === 'string' ? value : '';
  return text.startsWith(LARK_WEEKLY_7D_EXECUTIVE_DECISION_AI_PREFIX)
    && HASH.test(text.slice(LARK_WEEKLY_7D_EXECUTIVE_DECISION_AI_PREFIX.length));
}

export function assertFreshWeekly7dDecisionPeriod(period = {}, now = Date.now()) {
  const normalized = normalizePeriod(period);
  if (normalized.periodEnd <= LARK_WEEKLY_7D_EXECUTIVE_DECISION_CLOSED_PERIOD_END) {
    throw decisionError(
      'Fresh Executive Decision Preview requires a period after the closed historical Weekly delivery',
      'LARK_WEEKLY_7D_EXECUTIVE_DECISION_PERIOD_NOT_FRESH',
      { periodEnd: normalized.periodEnd, closedPeriodEnd: LARK_WEEKLY_7D_EXECUTIVE_DECISION_CLOSED_PERIOD_END },
    );
  }
  const previousCompletedBangkokDay = addDays(dateOnlyInBangkok(now), -1);
  if (normalized.periodEnd > previousCompletedBangkokDay) {
    throw decisionError(
      'Fresh Executive Decision Preview cannot include the current incomplete Bangkok day',
      'LARK_WEEKLY_7D_EXECUTIVE_DECISION_PERIOD_INCOMPLETE',
      { periodEnd: normalized.periodEnd, previousCompletedBangkokDay },
    );
  }
  const expectedStart = addDays(normalized.periodEnd, -6);
  if (normalized.periodStart !== expectedStart) {
    throw decisionError(
      'Fresh Executive Decision Preview requires exactly seven completed Bangkok days',
      'LARK_WEEKLY_7D_EXECUTIVE_DECISION_PERIOD_INVALID',
      { periodStart: normalized.periodStart, expectedStart, periodEnd: normalized.periodEnd },
    );
  }
  return deepFreeze({ ...normalized, previousCompletedBangkokDay });
}

function assertFreshDecisionSource(fields, factualReport) {
  const invalid = [];
  if (scalar(fields.template_version) !== LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION) invalid.push('templateVersion');
  if (scalar(fields.scope_type) !== 'executive') invalid.push('scopeType');
  if (scalar(fields.channel_key) !== 'executive') invalid.push('channelKey');
  if (Number(scalar(fields.window_days)) !== 7) invalid.push('windowDays');
  if (booleanValue(fields.preview_mode) !== true) invalid.push('previewMode');
  if (booleanValue(fields.notification_eligible) !== false) invalid.push('notificationEligible');
  if (booleanValue(fields.sent_to_group) !== false) invalid.push('sentToGroup');
  const sourceAiRunKey = requireText(scalar(fields.ai_run_key), 'source.ai_run_key');
  const sourceDedupeKey = requireHash(scalar(fields.dedupe_key), 'source.dedupe_key');
  const sourceReportIds = parseSourceReportIds(fields.source_report_ids_json);
  const channelStatusVectorJson = requireText(scalar(fields.channel_status_vector_json), 'channel_status_vector_json');
  const sourcePeriod = {
    periodStart: dateOnlyValue(fields.period_start),
    periodEnd: dateOnlyValue(fields.period_end),
    compareStart: nullableDateOnlyValue(fields.compare_start),
    compareEnd: nullableDateOnlyValue(fields.compare_end),
    comparisonMode: requireText(scalar(fields.comparison_mode) ?? 'none', 'comparison_mode'),
    windowDays: 7,
  };
  if (JSON.stringify([...sourceReportIds].sort()) !== JSON.stringify([...factualReport.sourceReportIds].sort())) invalid.push('sourceReportIds');
  if (sourcePeriod.periodStart !== factualReport.period.periodStart
      || sourcePeriod.periodEnd !== factualReport.period.periodEnd
      || sourcePeriod.compareStart !== factualReport.period.compareStart
      || sourcePeriod.compareEnd !== factualReport.period.compareEnd
      || sourcePeriod.comparisonMode !== factualReport.period.comparisonMode) invalid.push('period');
  if (invalid.length > 0) {
    throw decisionError(
      'Fresh Executive Decision source is outside the reviewed Preview boundary',
      'LARK_WEEKLY_7D_EXECUTIVE_DECISION_SOURCE_INVALID',
      { invalid },
    );
  }
  return deepFreeze({
    sourceAiRunKey,
    sourceDedupeKey,
    sourceReportIds: Object.freeze([...sourceReportIds].sort()),
    channelStatusVectorJson,
  });
}

function parseSourceReportIds(value) {
  try {
    const parsed = JSON.parse(requireText(scalar(value), 'source_report_ids_json'));
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('invalid');
    const output = parsed.map((item) => requireText(item, 'source_report_id'));
    if (new Set(output).size !== output.length) throw new Error('duplicate');
    return output;
  } catch {
    throw decisionError(
      'Fresh Executive Decision source Report identities are invalid',
      'LARK_WEEKLY_7D_EXECUTIVE_DECISION_SOURCE_REPORT_IDS_INVALID',
    );
  }
}

function normalizePeriod(period) {
  const periodStart = requireDateOnly(period.periodStart ?? period.period_start, 'periodStart');
  const periodEnd = requireDateOnly(period.periodEnd ?? period.period_end, 'periodEnd');
  return { periodStart, periodEnd };
}

function dateOnlyValue(value) {
  const scalarValue = scalar(value);
  if (typeof scalarValue === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(scalarValue)) return scalarValue;
  const epoch = Number(scalarValue);
  if (!Number.isFinite(epoch) || epoch <= 0) throw decisionError(
    'Fresh Executive Decision source period is invalid',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_PERIOD_INVALID',
  );
  return dateOnlyInBangkok(epoch);
}

function nullableDateOnlyValue(value) {
  const item = scalar(value);
  return item === null || item === undefined || item === '' ? null : dateOnlyValue(item);
}

function dateOnlyInBangkok(value) {
  const date = value instanceof Date ? value : new Date(Number(value));
  if (!Number.isFinite(date.getTime())) throw decisionError(
    'Fresh Executive Decision Bangkok date is invalid',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_PERIOD_INVALID',
  );
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDays(dateOnly, days) {
  const epoch = Date.parse(`${dateOnly}T00:00:00Z`);
  return new Date(epoch + (days * 86_400_000)).toISOString().slice(0, 10);
}

function requireDateOnly(value, label) {
  const text = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw decisionError(
    `${label} must be date-only`,
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_PERIOD_INVALID',
    { label },
  );
  return text;
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('sourceRecord is required');
  if (!record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)) throw new TypeError('sourceRecord.fields is required');
  return Object.freeze({ fields: record.fields });
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
    for (const key of ['text', 'name', 'value']) if (value[key] !== undefined) return scalar(value[key]);
  }
  return value;
}

function requireText(value, label) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) throw decisionError(
    `${label} is required`,
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_INPUT_REQUIRED',
    { label },
  );
  return text;
}

function requireHash(value, label) {
  const text = requireText(value, label);
  if (!HASH.test(text)) throw decisionError(
    `${label} must be SHA-256`,
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_INPUT_REQUIRED',
    { label },
  );
  return text;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function decisionError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dExecutiveDecisionPreviewError';
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
