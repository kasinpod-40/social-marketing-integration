import { LARK_NATIVE_AI_CHANNELS } from '../../../config/src/lark-native-ai-all-channel-contract.js';
import { stableStringify } from '../use-cases/build-report-snapshot.js';

export const LARK_WEEKLY_EXECUTIVE_FACTUAL_REPORT_SHAPE =
  'executive_notification_full_channel_v4';
export const LARK_WEEKLY_EXECUTIVE_FACTUAL_CHANNEL_COUNT = 9;

const LEGACY_FACTUAL_REPORT_SHAPES = new Set(['executive_notification_full_channel_v3']);
const MAX_METRICS_PER_CHANNEL = 4;
const MAX_CONTENT_CANDIDATES_PER_CHANNEL = 5;
const MAX_AD_CANDIDATES_PER_CHANNEL = 5;
const MAX_RENDERED_CANDIDATES_PER_CHANNEL = 3;
const EXECUTIVE_METRIC_SCOPES = new Set(['period_delta', 'summary', 'current_total']);
const PLACEHOLDER = /^(?:ไม่มีข้อมูล|no[_ -]?data|not[_ -]?available|unavailable|placeholder)$/iu;
const INVALID_URL = /invalid\.example/iu;
const CHANNEL_ICONS = Object.freeze({
  tiktok_organic: '🎵',
  facebook_organic: '📘',
  instagram_organic: '📸',
  youtube_organic: '▶️',
  meta_ads: '💰',
  google_ads: '🔎',
  tiktok_ads: '📣',
  woocommerce: '🛒',
  chatwoot: '💬',
});

export function buildLarkWeeklyExecutiveFactualReport(input = {}) {
  const period = normalizePeriod(input.targetPeriod);
  const reportBundles = requireArray(input.reportBundles ?? [], 'reportBundles');
  const byChannel = new Map();
  for (const raw of reportBundles) {
    const bundle = normalizeBundle(raw);
    if (byChannel.has(bundle.channelKey)) {
      throw new TypeError(`Duplicate factual Report bundle for ${bundle.channelKey}`);
    }
    byChannel.set(bundle.channelKey, bundle);
  }

  const channels = LARK_NATIVE_AI_CHANNELS.map((channel) => {
    const bundle = byChannel.get(channel.channelKey) ?? null;
    if (!bundle) return emptyChannel(channel);
    const metrics = bundle.metricValues
      .filter(isUsableExecutiveMetric)
      .sort(compareMetric)
      .slice(0, MAX_METRICS_PER_CHANNEL)
      .map(normalizeFactualMetric);
    const contentCandidates = realTopContentCandidates(bundle.topContent);
    const adCandidates = realTopAdCandidates(bundle.topAds);
    const topContent = contentCandidates[0] ?? null;
    const topAd = adCandidates[0] ?? null;
    return deepFreeze({
      channelKey: channel.channelKey,
      displayName: channel.displayName,
      platform: channel.platform,
      capability: channel.capability,
      sourceReportId: bundle.reportId,
      dataStatus: bundle.dataStatus,
      metrics,
      contentCandidates,
      adCandidates,
      topContent,
      topAd,
      hasBusinessFacts: metrics.length > 0 || contentCandidates.length > 0 || adCandidates.length > 0,
    });
  });

  if (channels.length !== LARK_WEEKLY_EXECUTIVE_FACTUAL_CHANNEL_COUNT) {
    throw new TypeError('Weekly Executive factual report must preserve all nine channels');
  }
  const sourceReportIds = [...new Set(channels
    .map((channel) => channel.sourceReportId)
    .filter(Boolean))].sort();
  return deepFreeze({
    evidenceShape: LARK_WEEKLY_EXECUTIVE_FACTUAL_REPORT_SHAPE,
    period,
    sourceReportIds,
    channelCount: channels.length,
    businessFactChannelCount: channels.filter((channel) => channel.hasBusinessFacts).length,
    channels,
  });
}

export function serializeLarkWeeklyExecutiveFactualReport(value) {
  return stableStringify(normalizeFactualReport(value));
}

export function parseLarkWeeklyExecutiveFactualReport(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new TypeError('Weekly Executive factual report must be valid JSON');
  }
  return normalizeFactualReport(parsed);
}

export function renderLarkWeeklyExecutiveChannelSections(value) {
  const report = normalizeFactualReport(value);
  return Object.freeze(report.channels.map((channel) => Object.freeze({
    channelKey: channel.channelKey,
    heading: `${CHANNEL_ICONS[channel.channelKey] ?? '•'} ${channel.displayName}`,
    lines: Object.freeze(renderChannelLines(channel)),
  })));
}

function normalizeFactualReport(value) {
  const report = requireObject(value, 'factualReport');
  if (report.evidenceShape !== LARK_WEEKLY_EXECUTIVE_FACTUAL_REPORT_SHAPE
      && !LEGACY_FACTUAL_REPORT_SHAPES.has(report.evidenceShape)) {
    throw new TypeError('Unsupported Weekly Executive factual report shape');
  }
  const period = normalizePeriod(report.period);
  const channels = requireArray(report.channels, 'factualReport.channels').map((channel) => {
    const item = requireObject(channel, 'factualReport.channel');
    const contract = LARK_NATIVE_AI_CHANNELS.find(({ channelKey }) => channelKey === item.channelKey);
    if (!contract || item.displayName !== contract.displayName) {
      throw new TypeError('Weekly Executive factual channel identity is invalid');
    }
    const metrics = requireArray(item.metrics ?? [], 'factualReport.channel.metrics')
      .slice(0, MAX_METRICS_PER_CHANNEL)
      .map(normalizeFactualMetric);
    const contentCandidates = normalizeCandidateCollection(
      item.contentCandidates,
      item.topContent,
      MAX_CONTENT_CANDIDATES_PER_CHANNEL,
      normalizeTopContent,
      'factualReport.channel.contentCandidates',
    );
    const adCandidates = normalizeCandidateCollection(
      item.adCandidates,
      item.topAd,
      MAX_AD_CANDIDATES_PER_CHANNEL,
      normalizeTopAd,
      'factualReport.channel.adCandidates',
    );
    const topContent = contentCandidates[0] ?? null;
    const topAd = adCandidates[0] ?? null;
    return deepFreeze({
      channelKey: contract.channelKey,
      displayName: contract.displayName,
      platform: contract.platform,
      capability: contract.capability,
      sourceReportId: optionalText(item.sourceReportId),
      dataStatus: optionalText(item.dataStatus),
      metrics,
      contentCandidates,
      adCandidates,
      topContent,
      topAd,
      hasBusinessFacts: metrics.length > 0 || contentCandidates.length > 0 || adCandidates.length > 0,
    });
  });
  const orderedKeys = channels.map(({ channelKey }) => channelKey);
  const expectedKeys = LARK_NATIVE_AI_CHANNELS.map(({ channelKey }) => channelKey);
  if (channels.length !== LARK_WEEKLY_EXECUTIVE_FACTUAL_CHANNEL_COUNT
      || JSON.stringify(orderedKeys) !== JSON.stringify(expectedKeys)) {
    throw new TypeError('Weekly Executive factual report must contain nine ordered channels');
  }
  const sourceReportIds = [...new Set(channels.map(({ sourceReportId }) => sourceReportId).filter(Boolean))].sort();
  return deepFreeze({
    evidenceShape: LARK_WEEKLY_EXECUTIVE_FACTUAL_REPORT_SHAPE,
    period,
    sourceReportIds,
    channelCount: channels.length,
    businessFactChannelCount: channels.filter(({ hasBusinessFacts }) => hasBusinessFacts).length,
    channels,
  });
}

function normalizeCandidateCollection(collection, fallback, maximum, normalizer, label) {
  const rows = collection === undefined
    ? (fallback ? [fallback] : [])
    : requireArray(collection, label);
  return Object.freeze(rows
    .slice(0, maximum)
    .map(normalizer)
    .sort((left, right) => left.rank - right.rank));
}

function normalizeBundle(raw) {
  const bundle = requireObject(raw, 'reportBundle');
  const channel = LARK_NATIVE_AI_CHANNELS.find(({ channelKey }) => channelKey === bundle.channelKey);
  if (!channel) throw new TypeError(`Unsupported factual Report channel: ${bundle.channelKey}`);
  const payload = requireObject(bundle.payload, 'reportBundle.payload');
  return deepFreeze({
    channelKey: channel.channelKey,
    reportId: requireText(bundle.reportId, 'reportBundle.reportId'),
    dataStatus: requireText(payload.dataStatus, 'reportBundle.payload.dataStatus'),
    metricValues: requireArray(bundle.metricValues ?? [], 'reportBundle.metricValues'),
    topContent: requireArray(bundle.topContent ?? [], 'reportBundle.topContent'),
    topAds: requireArray(bundle.topAds ?? [], 'reportBundle.topAds'),
  });
}

function emptyChannel(channel) {
  return deepFreeze({
    channelKey: channel.channelKey,
    displayName: channel.displayName,
    platform: channel.platform,
    capability: channel.capability,
    sourceReportId: null,
    dataStatus: null,
    metrics: [],
    contentCandidates: [],
    adCandidates: [],
    topContent: null,
    topAd: null,
    hasBusinessFacts: false,
  });
}

function isUsableExecutiveMetric(metric) {
  if (!metric || typeof metric !== 'object') return false;
  const scope = metric.metric_scope ?? metric.metricScope ?? 'summary';
  const dimension = metric.dimension_type ?? metric.dimensionType ?? 'summary';
  const availability = metric.availability_status ?? metric.availabilityStatus ?? 'not_available';
  const metricKey = String(metric.metric_key ?? metric.metricKey ?? '');
  return EXECUTIVE_METRIC_SCOPES.has(scope)
    && dimension === 'summary'
    && !metricKey.includes(':dimension:')
    && availability === 'available'
    && finiteOrNull(metric.current_value ?? metric.currentValue) !== null;
}

function compareMetric(left, right) {
  return metricScopePriority(left) - metricScopePriority(right)
    || normalizeRank(left.rank) - normalizeRank(right.rank)
    || String(left.metric_key ?? left.metricKey ?? '').localeCompare(String(right.metric_key ?? right.metricKey ?? ''));
}

function metricScopePriority(metric) {
  const scope = metric?.metric_scope ?? metric?.metricScope ?? 'summary';
  if (scope === 'period_delta') return 0;
  if (scope === 'summary') return 1;
  if (scope === 'current_total') return 2;
  return 99;
}

function normalizeFactualMetric(raw) {
  const metric = requireObject(raw, 'metric');
  const metricKey = requireText(metric.metricKey ?? metric.metric_key, 'metric.metricKey');
  const currentValue = requireFinite(metric.currentValue ?? metric.current_value, 'metric.currentValue');
  const unit = optionalText(metric.unit) ?? 'count';
  const microsCurrency = unit === 'currency' && metricKey.endsWith('_micros');
  const explicitDisplayValue = finiteOrNull(metric.displayValue ?? metric.display_value);
  return deepFreeze({
    metricKey,
    displayName: optionalText(metric.displayName ?? metric.display_name) ?? metricKey,
    currentValue,
    displayValue: explicitDisplayValue
      ?? (microsCurrency ? round(currentValue / 1_000_000, 4) : currentValue),
    compareValue: finiteOrNull(metric.compareValue ?? metric.compare_value),
    changeValue: finiteOrNull(metric.changeValue ?? metric.change_value),
    changePercent: finiteOrNull(metric.changePercent ?? metric.change_percent),
    unit,
    rank: normalizeRank(metric.rank),
  });
}

function realTopContentCandidates(rows) {
  return Object.freeze([...rows]
    .sort((a, b) => normalizeRank(a?.rank) - normalizeRank(b?.rank))
    .filter((row) => isRealText(row?.caption)
      && !PLACEHOLDER.test(String(row?.data_status ?? ''))
      && !INVALID_URL.test(String(row?.content_url ?? '')))
    .slice(0, MAX_CONTENT_CANDIDATES_PER_CHANNEL)
    .map(normalizeTopContent));
}

function normalizeTopContent(raw) {
  const row = requireObject(raw, 'topContent');
  return deepFreeze({
    rank: normalizeRank(row.rank),
    externalContentId: optionalText(row.externalContentId ?? row.external_content_id),
    caption: requireText(row.caption, 'topContent.caption'),
    contentUrl: optionalText(row.contentUrl ?? row.content_url),
    publishedAt: finiteOrNull(row.publishedAt ?? row.published_at),
    periodViews: finiteOrNull(row.periodViews ?? row.period_views),
    periodLikes: finiteOrNull(row.periodLikes ?? row.period_likes),
    periodComments: finiteOrNull(row.periodComments ?? row.period_comments),
    periodShares: finiteOrNull(row.periodShares ?? row.period_shares),
    periodEngagement: finiteOrNull(row.periodEngagement ?? row.period_engagement),
    periodEngagementRate: finiteOrNull(row.periodEngagementRate ?? row.period_engagement_rate),
    latestTotalViews: finiteOrNull(row.latestTotalViews ?? row.latest_total_views),
    performanceStatus: optionalText(row.performanceStatus ?? row.performance_status),
  });
}

function realTopAdCandidates(rows) {
  return Object.freeze([...rows]
    .sort((a, b) => normalizeRank(a?.rank) - normalizeRank(b?.rank))
    .filter((row) => isRealText(row?.ad_name ?? row?.adName)
      && !PLACEHOLDER.test(String(row?.data_status ?? ''))
      && !/^no_data_/iu.test(String(row?.external_ad_id ?? row?.externalAdId ?? '')))
    .slice(0, MAX_AD_CANDIDATES_PER_CHANNEL)
    .map(normalizeTopAd));
}

function normalizeTopAd(raw) {
  const row = requireObject(raw, 'topAd');
  const clicks = finiteOrNull(row.clicks);
  const impressions = finiteOrNull(row.impressions);
  const derivedCtrPercent = clicks !== null && impressions !== null && impressions > 0
    ? round((clicks / impressions) * 100, 5)
    : null;
  return deepFreeze({
    rank: normalizeRank(row.rank),
    externalAdId: optionalText(row.externalAdId ?? row.external_ad_id),
    adName: requireText(row.adName ?? row.ad_name, 'topAd.adName'),
    currency: optionalText(row.currency),
    spendMicros: finiteOrNull(row.spendMicros ?? row.spend_micros),
    impressions,
    reach: finiteOrNull(row.reach),
    clicks,
    conversions: finiteOrNull(row.conversions),
    conversionValueMicros: finiteOrNull(row.conversionValueMicros ?? row.conversion_value_micros),
    derivedCtrPercent,
    cpcMicros: finiteOrNull(row.cpcMicros ?? row.cpc_micros),
    cpaMicros: finiteOrNull(row.cpaMicros ?? row.cpa_micros),
    roas: finiteOrNull(row.roas),
  });
}

function renderChannelLines(channel) {
  if (!channel.hasBusinessFacts) return ['ยังไม่พบข้อมูลสำหรับช่วงนี้'];
  const lines = channel.metrics.map((metric) => `• ${metric.displayName}: ${formatMetric(metric)}${formatComparison(metric)}`);
  for (const item of channel.contentCandidates.slice(0, MAX_RENDERED_CANDIDATES_PER_CHANNEL)) {
    lines.push(`• Content #${item.rank}: ${item.caption}${formatTopContentFacts(item)}`);
  }
  for (const item of channel.adCandidates.slice(0, MAX_RENDERED_CANDIDATES_PER_CHANNEL)) {
    lines.push(`• Ad #${item.rank}: ${item.adName}${formatTopAdFacts(item)}`);
  }
  return lines.length > 0 ? lines : ['ยังไม่พบข้อมูลสำหรับช่วงนี้'];
}

function formatMetric(metric) {
  const value = metric.displayValue ?? metric.currentValue;
  const unit = metric.unit.toLowerCase();
  if (unit === 'percent' || unit === 'percentage' || unit === '%') return `${formatNumber(value, 2)}%`;
  if (unit === 'currency') return formatNumber(value, 2);
  if (unit === 'count') return formatNumber(value, Number.isInteger(value) ? 0 : 2);
  if (unit === 'seconds') return `${formatNumber(value, 2)} วินาที`;
  if (unit === 'minutes') return `${formatNumber(value, 2)} นาที`;
  return formatNumber(value, 2);
}

function formatComparison(metric) {
  if (metric.compareValue !== null && metric.compareValue !== 0) {
    const derivedPercent = ((metric.currentValue - metric.compareValue) / Math.abs(metric.compareValue)) * 100;
    const prefix = derivedPercent > 0 ? '+' : '';
    return ` (${prefix}${formatNumber(derivedPercent, 2)}% เทียบช่วงก่อน)`;
  }
  if (metric.compareValue !== null) {
    const compare = metric.unit === 'currency' && metric.metricKey.endsWith('_micros')
      ? metric.compareValue / 1_000_000
      : metric.compareValue;
    return ` (ช่วงก่อน ${formatNumber(compare, 2)})`;
  }
  if (metric.changePercent !== null) {
    const percent = metric.changePercent * 100;
    const prefix = percent > 0 ? '+' : '';
    return ` (${prefix}${formatNumber(percent, 2)}% เทียบช่วงก่อน)`;
  }
  return '';
}

function formatTopContentFacts(item) {
  const facts = [];
  const views = item.periodViews ?? item.latestTotalViews;
  if (views !== null) facts.push(`Views ${formatNumber(views, Number.isInteger(views) ? 0 : 2)}`);
  if (item.periodEngagement !== null) facts.push(`Engagement ${formatNumber(item.periodEngagement, Number.isInteger(item.periodEngagement) ? 0 : 2)}`);
  if (item.periodEngagementRate !== null) facts.push(`ER ${formatNumber(item.periodEngagementRate, 2)}%`);
  if (item.periodShares !== null) facts.push(`Shares ${formatNumber(item.periodShares, 0)}`);
  return facts.length ? ` — ${facts.join(' | ')}` : '';
}

function formatTopAdFacts(item) {
  const facts = [];
  if (item.spendMicros !== null) facts.push(`Spend ${formatNumber(item.spendMicros / 1_000_000, 2)}`);
  if (item.clicks !== null) facts.push(`Clicks ${formatNumber(item.clicks, 0)}`);
  if (item.impressions !== null) facts.push(`Impressions ${formatNumber(item.impressions, 0)}`);
  if (item.derivedCtrPercent !== null) facts.push(`CTR ${formatNumber(item.derivedCtrPercent, 2)}%`);
  if (item.cpcMicros !== null) facts.push(`CPC ${formatNumber(item.cpcMicros / 1_000_000, 2)}`);
  if (item.conversions !== null) facts.push(`Conversions ${formatNumber(item.conversions, Number.isInteger(item.conversions) ? 0 : 2)}`);
  if (item.cpaMicros !== null) facts.push(`CPA ${formatNumber(item.cpaMicros / 1_000_000, 2)}`);
  if (item.roas !== null) facts.push(`ROAS ${formatNumber(item.roas, 2)}`);
  return facts.length ? ` — ${facts.join(' | ')}` : '';
}

function normalizePeriod(value) {
  const period = requireObject(value, 'period');
  const periodStart = requireDate(period.periodStart ?? period.period_start, 'periodStart');
  const periodEnd = requireDate(period.periodEnd ?? period.period_end, 'periodEnd');
  if (periodStart > periodEnd) throw new TypeError('Weekly Executive factual period is invalid');
  return deepFreeze({
    periodStart,
    periodEnd,
    compareStart: optionalDate(period.compareStart ?? period.compare_start),
    compareEnd: optionalDate(period.compareEnd ?? period.compare_end),
    comparisonMode: optionalText(period.comparisonMode ?? period.comparison_mode) ?? 'none',
    windowDays: 7,
  });
}

function isRealText(value) {
  const text = optionalText(value);
  return Boolean(text && !PLACEHOLDER.test(text));
}
function formatNumber(value, maximumFractionDigits) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
}
function normalizeRank(value) {
  const rank = Number(value ?? 9999);
  return Number.isFinite(rank) && rank > 0 ? rank : 9999;
}
function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function requireFinite(value, label) {
  const number = finiteOrNull(value);
  if (number === null) throw new TypeError(`${label} must be finite`);
  return number;
}
function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function requireDate(value, label) {
  const text = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new TypeError(`${label} must be date-only`);
  return text;
}
function optionalDate(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireDate(value, 'optionalDate');
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function requireText(value, label) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}
function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}
function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}
