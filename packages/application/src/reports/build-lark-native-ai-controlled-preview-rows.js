import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIMITS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_PROMPT_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_REQUIRED_LARK_FIELDS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_ROW_CHANNELS,
} from '../../../config/src/lark-native-ai-controlled-preview-contract.js';
import { stableStringify } from '../use-cases/build-report-snapshot.js';

const BUSINESS_PLATFORMS = new Set(
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_ROW_CHANNELS.map(({ platform }) => platform),
);

export async function buildLarkNativeAiControlledPreviewRows(bundle, previewRunKey) {
  const channels = new Map(
    bundle.channels
      .filter(({ platform }) => BUSINESS_PLATFORMS.has(platform))
      .map((channel) => [channel.platform, channel]),
  );
  const rows = [];
  for (const descriptor of LARK_NATIVE_AI_CONTROLLED_PREVIEW_ROW_CHANNELS) {
    const channel = channels.get(descriptor.platform);
    if (!channel) throw new TypeError(`Missing controlled-preview channel: ${descriptor.platform}`);
    rows.push(await buildChannelRow(bundle, channel, descriptor, previewRunKey));
  }
  rows.push(await buildExecutiveRow(bundle, previewRunKey));
  return deepFreeze(rows);
}

export function validateLarkNativeAiControlledPreviewRows(rows) {
  const blockers = [];
  if (!Array.isArray(rows)
    || rows.length !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIMITS.expectedRowCountPerWindow) {
    blockers.push({ code: 'LARK_ROW_COUNT_INVALID', subject: 'rows' });
    return Object.freeze(blockers);
  }
  const dedupeKeys = new Set();
  for (const row of rows) {
    const missing = LARK_NATIVE_AI_CONTROLLED_PREVIEW_REQUIRED_LARK_FIELDS
      .filter((name) => !Object.prototype.hasOwnProperty.call(row.fields, name));
    if (missing.length > 0) blockers.push({ code: 'LARK_ROW_FIELD_MISSING', subject: row.channelKey });
    if (dedupeKeys.has(row.fields.dedupe_key)) {
      blockers.push({ code: 'LARK_ROW_DEDUPE_KEY_DUPLICATE', subject: row.channelKey });
    }
    dedupeKeys.add(row.fields.dedupe_key);
    if (byteLength(row.fields.metric_summary_json)
      > LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIMITS.maxMetricSummaryBytesPerRow) {
      blockers.push({ code: 'LARK_ROW_METRIC_SUMMARY_TOO_LARGE', subject: row.channelKey });
    }
    if (row.fields.preview_mode !== true
      || row.fields.notification_eligible !== false
      || row.fields.sent_to_group !== false
      || row.fields.sent_at !== null) {
      blockers.push({ code: 'LARK_ROW_PREVIEW_SAFETY_INVALID', subject: row.channelKey });
    }
  }
  return Object.freeze(blockers.map(Object.freeze));
}

async function buildChannelRow(bundle, channel, descriptor, previewRunKey) {
  const readiness = mapReadiness(channel.availabilityStatus);
  const sourceReportIds = channel.reportIdentity ? [channel.reportIdentity.reportId] : [];
  const metricSummaryJson = stableStringify({
    platform: channel.platform,
    availabilityStatus: channel.availabilityStatus,
    coverageStatus: channel.coverageStatus,
    freshness: channel.freshness,
    summaryMetrics: channel.summaryMetrics,
    warnings: channel.warnings,
    dataQualityIssues: channel.dataQualityIssues,
  });
  const sourceReportChecksum = await sha256Hex(metricSummaryJson);
  const dedupeKey = await sha256Hex(stableStringify({
    previewRunKey,
    channelKey: descriptor.channelKey,
    sourceReportChecksum,
  }));
  return deepFreeze({
    rowType: 'channel',
    channelKey: descriptor.channelKey,
    platform: channel.platform,
    fields: makeFields({
      reportId: channel.reportIdentity?.reportId ?? channel.evidenceIdentity,
      platforms: [channel.platform],
      reportType: 'dashboard_channel_status',
      metricSummaryJson,
      aiRunKey: `${previewRunKey}:${descriptor.channelKey}`,
      scopeType: 'channel',
      channelKey: descriptor.channelKey,
      capability: descriptor.capability,
      windowDays: bundle.window.windowDays,
      readiness,
      readinessMessage: channel.availabilityMessage,
      coverageRate: inferCoverageRate(channel),
      sourceReportIds,
      sourceReportChecksum,
      channelStatusVectorJson: null,
      dedupeKey,
      generatedAt: bundle.generation.generatedAt,
    }),
  });
}

async function buildExecutiveRow(bundle, previewRunKey) {
  const business = bundle.channels.filter(({ platform }) => BUSINESS_PLATFORMS.has(platform));
  const operations = bundle.channels.find(({ platform }) => platform === 'operations');
  if (!operations) throw new TypeError('Operations evidence is required for Executive readiness');
  const vector = [...business, operations].map((channel) => ({
    platform: channel.platform,
    capability: channel.capability,
    availabilityStatus: channel.availabilityStatus,
    coverageStatus: channel.coverageStatus,
    freshnessStatus: channel.freshness.status,
    recommendationLevel: channel.recommendationEligibility.level,
  }));
  const sourceReportIds = business
    .map(({ reportIdentity }) => reportIdentity?.reportId)
    .filter(Boolean)
    .sort();
  const readiness = executiveReadiness(business, operations);
  const metricSummaryJson = stableStringify({
    bundleId: bundle.bundleId,
    currencies: bundle.currencies,
    statusVector: vector,
    traceCount: Object.keys(bundle.traceIndex).length,
  });
  const sourceReportChecksum = await sha256Hex(stableStringify({ sourceReportIds, vector }));
  const dedupeKey = await sha256Hex(stableStringify({
    previewRunKey,
    channelKey: 'executive',
    sourceReportChecksum,
  }));
  return deepFreeze({
    rowType: 'executive',
    channelKey: 'executive',
    platform: 'executive',
    fields: makeFields({
      reportId: `ai-preview:${previewRunKey}`,
      platforms: business.map(({ platform }) => platform).sort(),
      reportType: 'dashboard_executive_summary',
      metricSummaryJson,
      aiRunKey: `${previewRunKey}:executive`,
      scopeType: 'executive',
      channelKey: 'executive',
      capability: 'cross_channel',
      windowDays: bundle.window.windowDays,
      readiness,
      readinessMessage: readiness.message,
      coverageRate: readiness.coverageRate,
      sourceReportIds,
      sourceReportChecksum,
      channelStatusVectorJson: stableStringify(vector),
      dedupeKey,
      generatedAt: bundle.generation.generatedAt,
    }),
  });
}

function makeFields(input) {
  return {
    report_id: input.reportId,
    platforms: input.platforms,
    report_type: input.reportType,
    metric_summary_json: input.metricSummaryJson,
    insight_summary: null,
    strengths: null,
    weaknesses: null,
    recommendations: null,
    sent_to_group: false,
    sent_at: null,
    ai_run_key: input.aiRunKey,
    scope_type: input.scopeType,
    channel_key: input.channelKey,
    capability: input.capability,
    account_id: null,
    window_days: String(input.windowDays),
    data_status: input.readiness.dataStatus,
    readiness_status: input.readiness.readinessStatus,
    readiness_message: input.readinessMessage,
    coverage_rate: input.coverageRate,
    source_report_ids_json: stableStringify(input.sourceReportIds),
    source_report_checksum: input.sourceReportChecksum,
    channel_status_vector_json: input.channelStatusVectorJson,
    severity: input.readiness.severity,
    notification_eligible: false,
    notification_reason: 'controlled_preview',
    dedupe_key: input.dedupeKey,
    cooldown_until: null,
    preview_mode: true,
    generation_status: input.readiness.generationStatus,
    failure_code: null,
    template_version: LARK_NATIVE_AI_CONTROLLED_PREVIEW_PROMPT_VERSION,
    generated_at: input.generatedAt,
  };
}

function mapReadiness(status) {
  const value = {
    complete: ['complete', 'report_available', 'info', 'pending'],
    partial: ['partial', 'report_partial', 'warning', 'pending'],
    coverage_incomplete: ['partial', 'report_partial', 'warning', 'pending'],
    no_data_confirmed: ['no_data_confirmed', 'no_data_confirmed', 'info', 'skipped'],
    unavailable: ['source_unavailable', 'source_unavailable', 'warning', 'skipped'],
    source_pending: ['report_missing', 'report_missing', 'info', 'skipped'],
  }[status];
  if (!value) throw new TypeError(`Unsupported availability status: ${status}`);
  return Object.freeze({
    dataStatus: value[0], readinessStatus: value[1], severity: value[2], generationStatus: value[3],
  });
}

function executiveReadiness(channels, operations) {
  const all = [...channels, operations];
  const completeLike = all.filter(({ availabilityStatus }) =>
    ['complete', 'no_data_confirmed'].includes(availabilityStatus)).length;
  const reportBacked = all.filter(({ availabilityStatus }) =>
    ['complete', 'partial', 'coverage_incomplete', 'no_data_confirmed'].includes(availabilityStatus)).length;
  const coverageRate = completeLike === all.length ? 1 : null;
  if (completeLike === all.length) return Object.freeze({
    dataStatus: 'complete', readinessStatus: 'report_available', severity: 'info', generationStatus: 'pending',
    coverageRate, message: 'All-channel validated evidence is ready for controlled Preview.',
  });
  if (reportBacked > 0) return Object.freeze({
    dataStatus: 'partial', readinessStatus: 'report_partial', severity: 'warning', generationStatus: 'pending',
    coverageRate, message: 'All-channel evidence is mixed; unavailable sections must remain suppressed.',
  });
  return Object.freeze({
    dataStatus: 'report_missing', readinessStatus: 'report_missing', severity: 'warning', generationStatus: 'skipped',
    coverageRate, message: 'No validated business Report is available for this window.',
  });
}

function inferCoverageRate(channel) {
  return ['complete', 'no_data_confirmed'].includes(channel.availabilityStatus) ? 1 : null;
}

async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
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
