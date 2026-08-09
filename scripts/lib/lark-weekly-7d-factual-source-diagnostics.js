import { LARK_NATIVE_AI_CHANNELS } from '../../packages/config/src/lark-native-ai-all-channel-contract.js';

const PLACEHOLDER = /^(?:ไม่มีข้อมูล|no[_ -]?data|not[_ -]?available|unavailable|placeholder)$/iu;
const INVALID_URL = /invalid\.example/iu;
const MAX_SAMPLE_KEYS = 12;

export function diagnoseLarkWeekly7dFactualSource(input = {}) {
  const bundles = requireArray(input.reportBundles ?? [], 'reportBundles');
  const byChannel = new Map();
  for (const raw of bundles) {
    const bundle = requireObject(raw, 'reportBundle');
    const channelKey = requireText(bundle.channelKey, 'reportBundle.channelKey');
    if (byChannel.has(channelKey)) throw new TypeError(`Duplicate reportBundle channel: ${channelKey}`);
    byChannel.set(channelKey, bundle);
  }

  const channels = LARK_NATIVE_AI_CHANNELS.map((channel) => {
    const raw = byChannel.get(channel.channelKey) ?? null;
    if (!raw) return Object.freeze({
      channelKey: channel.channelKey,
      displayName: channel.displayName,
      sourceReportPresent: false,
      sourceReportId: null,
      dataStatus: null,
      metricRows: 0,
      usableSummaryMetricRows: 0,
      rejectedMetricRows: Object.freeze({
        scope: 0,
        dimension: 0,
        availability: 0,
        nullValue: 0,
      }),
      usableMetricKeys: Object.freeze([]),
      rejectedMetricSamples: Object.freeze([]),
      topContentRows: 0,
      realTopContentRows: 0,
      topAdsRows: 0,
      realTopAdsRows: 0,
      hasBusinessFacts: false,
      emptyReason: 'source_report_missing',
    });

    const payload = requireObject(raw.payload, 'reportBundle.payload');
    const metrics = requireArray(raw.metricValues ?? [], 'reportBundle.metricValues');
    const topContent = requireArray(raw.topContent ?? [], 'reportBundle.topContent');
    const topAds = requireArray(raw.topAds ?? [], 'reportBundle.topAds');
    const rejected = { scope: 0, dimension: 0, availability: 0, nullValue: 0 };
    const usableMetricKeys = [];
    const rejectedMetricSamples = [];

    for (const metric of metrics) {
      const item = requireObject(metric, 'metric');
      const metricKey = optionalText(item.metric_key ?? item.metricKey) ?? '(unknown)';
      const scope = optionalText(item.metric_scope ?? item.metricScope) ?? 'summary';
      const dimension = optionalText(item.dimension_type ?? item.dimensionType) ?? 'summary';
      const availability = optionalText(item.availability_status ?? item.availabilityStatus) ?? 'not_available';
      const currentValue = finiteOrNull(item.current_value ?? item.currentValue);
      let reason = null;
      if (scope !== 'summary') {
        rejected.scope += 1;
        reason = `scope:${scope}`;
      } else if (dimension !== 'summary') {
        rejected.dimension += 1;
        reason = `dimension:${dimension}`;
      } else if (availability !== 'available') {
        rejected.availability += 1;
        reason = `availability:${availability}`;
      } else if (currentValue === null) {
        rejected.nullValue += 1;
        reason = 'null_value';
      } else {
        usableMetricKeys.push(metricKey);
      }
      if (reason && rejectedMetricSamples.length < MAX_SAMPLE_KEYS) {
        rejectedMetricSamples.push(Object.freeze({ metricKey, reason }));
      }
    }

    const realTopContentRows = topContent.filter(isRealTopContent).length;
    const realTopAdsRows = topAds.filter(isRealTopAd).length;
    const hasBusinessFacts = usableMetricKeys.length > 0 || realTopContentRows > 0 || realTopAdsRows > 0;
    return Object.freeze({
      channelKey: channel.channelKey,
      displayName: channel.displayName,
      sourceReportPresent: true,
      sourceReportId: requireText(raw.reportId, 'reportBundle.reportId'),
      dataStatus: requireText(payload.dataStatus, 'reportBundle.payload.dataStatus'),
      metricRows: metrics.length,
      usableSummaryMetricRows: usableMetricKeys.length,
      rejectedMetricRows: Object.freeze(rejected),
      usableMetricKeys: Object.freeze(usableMetricKeys.slice(0, MAX_SAMPLE_KEYS)),
      rejectedMetricSamples: Object.freeze(rejectedMetricSamples),
      topContentRows: topContent.length,
      realTopContentRows,
      topAdsRows: topAds.length,
      realTopAdsRows,
      hasBusinessFacts,
      emptyReason: hasBusinessFacts ? null : resolveEmptyReason({ metrics, rejected, realTopContentRows, realTopAdsRows }),
    });
  });

  return Object.freeze({
    channelCount: channels.length,
    sourceReportChannelCount: channels.filter(({ sourceReportPresent }) => sourceReportPresent).length,
    businessFactChannelCount: channels.filter(({ hasBusinessFacts }) => hasBusinessFacts).length,
    channels: Object.freeze(channels),
  });
}

function resolveEmptyReason({ metrics, rejected, realTopContentRows, realTopAdsRows }) {
  if (metrics.length === 0 && realTopContentRows === 0 && realTopAdsRows === 0) return 'report_has_no_fact_rows';
  if (rejected.scope > 0 && rejected.scope === metrics.length) return 'all_metrics_non_summary_scope';
  if (rejected.dimension > 0 && rejected.scope + rejected.dimension === metrics.length) return 'all_summary_scope_metrics_dimensioned';
  if (rejected.availability > 0 && rejected.scope + rejected.dimension + rejected.availability === metrics.length) return 'all_summary_metrics_unavailable';
  if (rejected.nullValue > 0 && rejected.scope + rejected.dimension + rejected.availability + rejected.nullValue === metrics.length) return 'all_summary_metrics_null';
  return 'no_usable_business_fact_after_filter';
}

function isRealTopContent(row) {
  if (!row || typeof row !== 'object') return false;
  const caption = optionalText(row.caption);
  return Boolean(caption
    && !PLACEHOLDER.test(caption)
    && !PLACEHOLDER.test(String(row.data_status ?? ''))
    && !INVALID_URL.test(String(row.content_url ?? '')));
}

function isRealTopAd(row) {
  if (!row || typeof row !== 'object') return false;
  const name = optionalText(row.ad_name ?? row.adName);
  return Boolean(name
    && !PLACEHOLDER.test(name)
    && !PLACEHOLDER.test(String(row.data_status ?? ''))
    && !/^no_data_/iu.test(String(row.external_ad_id ?? row.externalAdId ?? '')));
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
