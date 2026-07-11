/** Metric แบบจำนวนที่ Organic platform หลักรองรับร่วมกัน */
const ORGANIC_COUNT_METRICS = Object.freeze([
  ['views', 'Views', 'count', true],
  ['likes', 'Likes', 'count', true],
  ['comments', 'Comments', 'count', true],
  ['shares', 'Shares', 'count', true],
  ['engagement', 'Engagement', 'count', true],
]);

/** Platform Organic ที่ใช้ชุด Metric count มาตรฐาน */
const ORGANIC_PLATFORMS = Object.freeze(['facebook', 'instagram', 'tiktok', 'youtube']);

/** Platform โฆษณาที่ใช้ Metric reporting กลาง */
const ADS_PLATFORMS = Object.freeze(['meta_ads', 'tiktok_ads', 'google_ads']);

/** นิยาม Metric โฆษณาพร้อมหน่วยและสิทธิ์เปรียบเทียบข้าม Platform */
const ADS_METRICS = Object.freeze([
  ['spend', 'Spend', 'currency', true],
  ['impressions', 'Impressions', 'count', true],
  ['reach', 'Reach', 'count', false],
  ['clicks', 'Clicks', 'count', true],
  ['ctr', 'CTR', 'percent', true],
  ['cpc', 'CPC', 'currency', true],
  ['cpm', 'CPM', 'currency', true],
  ['conversions', 'Conversions', 'count', true],
  ['conversion_value', 'Conversion Value', 'currency', true],
  ['actual_roas', 'Actual ROAS', 'ratio', true],
]);

/**
 * Seed rows ที่สร้างแบบ Deterministic และใช้ metric_key เป็น Stable Key
 * ข้อความใน metric_note เป็น Metadata สำหรับผู้ใช้ Lark จึงเก็บเป็นภาษาอังกฤษตามชื่อ Metric สากล
 */
export const METRIC_DEFINITION_ROWS = Object.freeze([
  ...ORGANIC_PLATFORMS.flatMap((platform) => ORGANIC_COUNT_METRICS.map(([metric, displayName, unit, canCompare]) => createMetricRow({
    platform,
    metric,
    rawFieldName: metric,
    displayName,
    unit,
    canCompareCrossPlatform: canCompare,
    metricNote: 'Organic count metric used by Canva-style performance summaries.',
  }))),
  createMetricRow({
    platform: 'facebook',
    metric: 'reach',
    rawFieldName: 'reach',
    displayName: 'Reach',
    unit: 'count',
    canCompareCrossPlatform: false,
    fallbackMetric: null,
    metricNote: 'Reach from Meta insights. Compare carefully against TikTok/YouTube because definitions differ.',
  }),
  createMetricRow({
    platform: 'instagram',
    metric: 'reach',
    rawFieldName: 'reach',
    displayName: 'Reach',
    unit: 'count',
    canCompareCrossPlatform: false,
    fallbackMetric: null,
    metricNote: 'Reach from Instagram insights. Compare carefully against TikTok/YouTube because definitions differ.',
  }),
  createMetricRow({
    platform: 'tiktok',
    metric: 'unique_viewers',
    rawFieldName: 'unique_viewers',
    displayName: 'Unique Viewers',
    unit: 'count',
    canCompareCrossPlatform: false,
    fallbackMetric: 'views',
    metricNote: 'Do not automatically rename this as Reach. Use as TikTok-specific viewer metric.',
  }),
  createMetricRow({
    platform: 'tiktok',
    metric: 'avg_watch_time_seconds',
    rawFieldName: 'average_play_duration',
    displayName: 'Average Watch Time',
    unit: 'seconds',
    canCompareCrossPlatform: false,
    fallbackMetric: null,
    metricNote: 'From TikTok Creator native analytics when available.',
  }),
  createMetricRow({
    platform: 'tiktok',
    metric: 'completion_rate',
    rawFieldName: 'completion_rate',
    displayName: 'Completion Rate',
    unit: 'percent',
    canCompareCrossPlatform: false,
    fallbackMetric: null,
    metricNote: 'Stored as decimal ratio in normalized tables; display as percent in reports.',
  }),
  ...ADS_PLATFORMS.flatMap((platform) => ADS_METRICS.map(([metric, displayName, unit, canCompare]) => createMetricRow({
    platform,
    metric,
    rawFieldName: metric,
    displayName,
    unit,
    canCompareCrossPlatform: canCompare,
    metricNote: 'Ads performance metric. Performance rows must come from reporting API or tracking-ready source.',
  }))),
]);

/** สร้างหนึ่งแถว Metric definition และตรวจ Field สำคัญก่อน Freeze */
function createMetricRow(input) {
  const platform = requireText(input.platform, 'platform');
  const metric = requireText(input.metric, 'metric');

  return Object.freeze({
    metric_key: `${platform}:${metric}`,
    platform,
    raw_field_name: requireText(input.rawFieldName, 'rawFieldName'),
    display_name: requireText(input.displayName, 'displayName'),
    formula: input.formula ?? null,
    unit: requireText(input.unit, 'unit'),
    can_compare_cross_platform: Boolean(input.canCompareCrossPlatform),
    fallback_metric: input.fallbackMetric ?? null,
    metric_note: input.metricNote ?? null,
  });
}

/** บังคับข้อความที่ไม่ว่างเพื่อป้องกัน Seed key หรือ Mapping ที่ไม่สมบูรณ์ */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Metric definition seed requires ${fieldName}`);
  }

  return value.trim();
}
