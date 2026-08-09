import {
  LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK,
  LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
  validateLarkNativeAiExecutiveWriterOutputs,
} from './lark-native-ai-executive-writer-quality.js';
import {
  parseLarkWeeklyExecutiveFactualReport,
} from '../notifications/build-lark-weekly-executive-factual-report.js';
import { stableStringify } from '../use-cases/build-report-snapshot.js';

export const LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE =
  'lark_ai_full_channel_synthesis_v1';

const MAX_AI_METRICS_PER_CHANNEL = 2;
const MAX_METRIC_SUMMARY_CHARS = 3_400;
const MAX_STATUS_VECTOR_CHARS = 700;
const LOWER_IS_BETTER = /(?:cpc|cpm|cpa|cost_per|refund)/iu;
const NEUTRAL_DIRECTION = /(?:spend|budget)/iu;
const INTERNAL_METRIC_LANGUAGE = /\b(?:metric_key|change_percent|compare_value|current_value|derived_ctr_percent)\b/iu;
const NON_BUSINESS_METRIC_LANGUAGE = /ความทบทวนหน้า/u;

export function buildLarkWeeklyExecutiveFullChannelAiEvidence(input = {}) {
  const factual = parseLarkWeeklyExecutiveFactualReport(input.factualReport);
  const statusVector = parseStatusVector(input.channelStatusVectorJson);
  if (statusVector.length !== 9) {
    throw evidenceError(
      'Full-channel Weekly AI evidence requires exactly nine channel-status rows',
      'LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_STATUS_INVALID',
      { observed: statusVector.length },
    );
  }

  const channels = factual.channels.map(toAiChannelEvidence);
  const businessChannels = channels.filter(({ businessEvidencePresent }) => businessEvidencePresent);
  const comparisonChannels = businessChannels.filter(({ comparisonEvidencePresent }) => comparisonEvidencePresent);
  const positiveComparisonChannelNames = comparisonChannels
    .filter((channel) => channel.availableMetrics.some((metric) => metricSignal(metric) === 'positive'))
    .map(({ displayName }) => displayName);
  const negativeComparisonChannelNames = comparisonChannels
    .filter((channel) => channel.availableMetrics.some((metric) => metricSignal(metric) === 'negative'))
    .map(({ displayName }) => displayName);
  const summaryRequiredFacts = collectCrossChannelRequiredFacts(businessChannels);
  const derivedCtrFacts = businessChannels.flatMap((channel) => (channel.topAds ?? []).map((ad) => Object.freeze({
    channel: channel.displayName,
    adName: ad.ad_name,
    clicks: ad.clicks,
    impressions: ad.impressions,
    derivedCtrPercent: ad.derived_ctr_percent,
  })));

  const qualityContext = Object.freeze({
    businessEvidenceChannelCount: businessChannels.length,
    comparisonEvidenceChannelCount: comparisonChannels.length,
    strengthsMode: positiveComparisonChannelNames.length > 0 ? 'evidence_only' : 'fallback_no_positive_comparison',
    recommendationMode: 'cross_channel_business_followup',
    summaryRequiredFacts,
  });
  const metricSummary = Object.freeze({
    evidenceShape: 'executive_business_first_v2',
    promptShape: LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE,
    qualityContext,
    writerContract: Object.freeze({
      overview: 'สรุป 2+ ช่องที่มี facts; ใช้ค่าจริง/comparison เท่านั้น',
      strengths: 'ใช้ comparison/rank จริง; spend/budget เพิ่มไม่ใช่ strength',
      weaknesses: 'ใช้ negative comparison จริง; missing data ไม่ใช่ weakness',
      recommendations: 'business action จาก facts; ห้าม Data Ops',
      language: 'ใช้ display_name เป็นชื่อ metric ที่แสดงต่อผู้บริหารเท่านั้น; ห้ามชื่อ field ภายในและคำว่า ความทบทวนหน้า',
    }),
    channelBusinessEvidence: channels,
  });
  const metricSummaryJson = stableStringify(metricSummary);
  const normalizedStatusVectorJson = stableStringify(statusVector);
  if (metricSummaryJson.length > MAX_METRIC_SUMMARY_CHARS) {
    throw evidenceError(
      'Full-channel Weekly AI evidence exceeds the bounded metric-summary budget',
      'LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_METRIC_LIMIT_EXCEEDED',
      { observedChars: metricSummaryJson.length, maximumChars: MAX_METRIC_SUMMARY_CHARS },
    );
  }
  if (normalizedStatusVectorJson.length > MAX_STATUS_VECTOR_CHARS) {
    throw evidenceError(
      'Full-channel Weekly AI status vector exceeds the reviewed budget',
      'LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_STATUS_LIMIT_EXCEEDED',
      { observedChars: normalizedStatusVectorJson.length, maximumChars: MAX_STATUS_VECTOR_CHARS },
    );
  }

  const evidence = deepFreeze({
    promptShape: LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE,
    businessEvidenceChannelCount: businessChannels.length,
    comparisonEvidenceChannelCount: comparisonChannels.length,
    strengthsMode: qualityContext.strengthsMode,
    recommendationMode: qualityContext.recommendationMode,
    businessEvidenceChannelNames: businessChannels.map(({ displayName }) => displayName),
    comparisonEvidenceChannelNames: comparisonChannels.map(({ displayName }) => displayName),
    positiveComparisonChannelNames,
    negativeComparisonChannelNames,
    summaryRequiredFacts,
    derivedCtrFacts,
  });

  return deepFreeze({
    metricSummaryJson,
    channelStatusVectorJson: normalizedStatusVectorJson,
    metricSummaryChars: metricSummaryJson.length,
    channelStatusVectorChars: normalizedStatusVectorJson.length,
    evidence,
  });
}

export function validateLarkWeeklyExecutiveFullChannelAiOutputs(outputs = {}, evidence = {}) {
  const base = validateLarkNativeAiExecutiveWriterOutputs(outputs, evidence);
  const violations = [...base.violations];
  const insight = text(outputs.insight_summary);
  const strengths = text(outputs.strengths);
  const weaknesses = text(outputs.weaknesses);
  const allText = [insight, strengths, weaknesses, text(outputs.recommendations)].join('\n');

  if (INTERNAL_METRIC_LANGUAGE.test(allText)) violations.push('internal_metric_field_language');
  if (NON_BUSINESS_METRIC_LANGUAGE.test(allText)) violations.push('non_business_metric_language');

  const businessNames = Array.isArray(evidence.businessEvidenceChannelNames)
    ? evidence.businessEvidenceChannelNames
    : [];
  if (businessNames.length >= 2) {
    const mentioned = businessNames.filter((name) => insight.includes(name));
    if (mentioned.length < 2) violations.push('insight_missing_cross_channel_coverage');
  }

  const positiveNames = Array.isArray(evidence.positiveComparisonChannelNames)
    ? evidence.positiveComparisonChannelNames
    : [];
  if (positiveNames.length > 0) {
    if (strengths === LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK) {
      violations.push('strengths_ignored_positive_comparison');
    } else if (!positiveNames.some((name) => strengths.includes(name))) {
      violations.push('strengths_missing_positive_channel');
    }
  }

  const negativeNames = Array.isArray(evidence.negativeComparisonChannelNames)
    ? evidence.negativeComparisonChannelNames
    : [];
  if (negativeNames.length > 0) {
    if (weaknesses === LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK) {
      violations.push('weaknesses_ignored_negative_comparison');
    } else if (!negativeNames.some((name) => weaknesses.includes(name))) {
      violations.push('weaknesses_missing_negative_channel');
    }
  }

  return Object.freeze({
    passed: violations.length === 0,
    violations: Object.freeze([...new Set(violations)]),
  });
}

function toAiChannelEvidence(channel) {
  if (!channel.hasBusinessFacts) {
    return deepFreeze({
      channelKey: channel.channelKey,
      businessEvidencePresent: false,
    });
  }
  const metrics = channel.metrics.slice(0, MAX_AI_METRICS_PER_CHANNEL).map((metric) => {
    const currentValue = presentationValue(metric.currentValue, metric.metricKey, metric.unit);
    const compareValue = metric.compareValue === null
      ? null
      : presentationValue(metric.compareValue, metric.metricKey, metric.unit);
    return Object.freeze({
      metric_key: metric.metricKey,
      display_name: thaiBusinessMetricLabel(metric.metricKey, metric.displayName),
      current_value: currentValue,
      compare_value: compareValue,
      change_percent: deriveChangePercent(metric.currentValue, metric.compareValue),
      unit: metric.unit,
    });
  });
  const topContent = channel.topContent ? [Object.freeze({
    caption: channel.topContent.caption,
    views: channel.topContent.periodViews ?? channel.topContent.latestTotalViews,
    engagement: channel.topContent.periodEngagement,
  })] : [];
  const topAds = channel.topAd ? [Object.freeze({
    ad_name: channel.topAd.adName,
    clicks: channel.topAd.clicks,
    impressions: channel.topAd.impressions,
    derived_ctr_percent: channel.topAd.derivedCtrPercent,
  })] : [];
  const comparisonEvidencePresent = metrics.some(({ compare_value }) => compare_value !== null);
  return deepFreeze({
    channelKey: channel.channelKey,
    displayName: channel.displayName,
    businessEvidencePresent: true,
    comparisonEvidencePresent,
    availableMetrics: metrics,
    ...(topContent.length ? { topContent } : {}),
    ...(topAds.length ? { topAds } : {}),
  });
}

function collectCrossChannelRequiredFacts(channels) {
  const ordered = [...channels].sort((left, right) => (
    Number(right.comparisonEvidencePresent) - Number(left.comparisonEvidencePresent)
    || left.displayName.localeCompare(right.displayName)
  ));
  const facts = [];
  for (const channel of ordered) {
    const metric = channel.availableMetrics?.[0];
    if (metric && Number.isFinite(metric.current_value)) {
      facts.push(Object.freeze({
        channel: channel.displayName,
        metric: metric.metric_key,
        value: metric.current_value,
      }));
    } else if (channel.topAds?.[0]?.clicks !== null && Number.isFinite(channel.topAds?.[0]?.clicks)) {
      facts.push(Object.freeze({ channel: channel.displayName, metric: 'clicks', value: channel.topAds[0].clicks }));
    }
    if (facts.length >= 3) break;
  }
  return Object.freeze(facts);
}

function metricSignal(metric) {
  const change = metric?.change_percent;
  if (!Number.isFinite(change) || change === 0) return 'neutral';
  const key = `${metric.metric_key ?? ''} ${metric.display_name ?? ''}`;
  if (NEUTRAL_DIRECTION.test(key)) return 'neutral';
  if (LOWER_IS_BETTER.test(key)) return change < 0 ? 'positive' : 'negative';
  return change > 0 ? 'positive' : 'negative';
}

function thaiBusinessMetricLabel(metricKey, fallback) {
  const key = String(metricKey ?? '').toLowerCase();
  if (/(?:^|:)account_followers$|followers?$/u.test(key)) return 'ผู้ติดตาม';
  if (/(?:^|:)account_views$|(?:^|:)views?$/u.test(key)) return 'ยอดดู';
  if (/(?:^|:)account_reach$|(?:^|:)reach$/u.test(key)) return 'การเข้าถึง';
  if (/(?:^|:)impressions?$/u.test(key)) return 'การแสดงผล';
  if (/(?:^|:)clicks?$/u.test(key)) return 'การคลิก';
  if (/spend(?:_micros)?$/u.test(key)) return 'ค่าใช้จ่าย';
  if (/net_sales(?:_micros)?$/u.test(key)) return 'ยอดขายสุทธิ';
  if (/gross_sales(?:_micros)?$/u.test(key)) return 'ยอดขายรวม';
  if (/recognized_revenue(?:_micros)?$/u.test(key)) return 'รายได้ที่รับรู้';
  if (/refunds?(?:_micros)?$/u.test(key)) return 'ยอดคืนเงิน';
  return String(fallback ?? metricKey ?? 'Metric').trim();
}

function deriveChangePercent(currentValue, compareValue) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(compareValue) || compareValue === 0) return null;
  return round(((currentValue - compareValue) / Math.abs(compareValue)) * 100, 4);
}

function presentationValue(value, metricKey, unit) {
  if (!Number.isFinite(value)) return null;
  return unit === 'currency' && metricKey.endsWith('_micros')
    ? round(value / 1_000_000, 4)
    : value;
}

function parseStatusVector(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed;
  } catch {
    throw evidenceError(
      'Full-channel Weekly AI status vector must be valid JSON array',
      'LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_STATUS_INVALID',
    );
  }
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}
function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
function evidenceError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeeklyExecutiveFullChannelAiEvidenceError';
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
