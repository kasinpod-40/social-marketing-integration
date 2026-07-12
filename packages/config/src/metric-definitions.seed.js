/** Metric แบบจำนวนที่ Organic platform หลักรองรับร่วมกันในระดับ Snapshot */
const ORGANIC_COUNT_METRICS = Object.freeze([
  ['views', 'Views', 'count', true],
  ['likes', 'Likes', 'count', true],
  ['comments', 'Comments', 'count', true],
  ['shares', 'Shares', 'count', true],
  ['engagement', 'Engagement', 'count', true],
]);

/** Platform Organic ที่ใช้ชุด Metric snapshot มาตรฐาน */
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

/** Metric ระดับ Report ของ TikTok Organic v1 ตาม cumulative snapshot semantics */
const TIKTOK_REPORT_METRICS = Object.freeze([
  reportMetric('period_views', 'Views เพิ่มในช่วง', 'count', 'sum_delta', 10, true),
  reportMetric('period_likes', 'Likes เพิ่มในช่วง', 'count', 'sum_delta', 20, true),
  reportMetric('period_comments', 'Comments เพิ่มในช่วง', 'count', 'sum_delta', 30, true),
  reportMetric('period_shares', 'Shares เพิ่มในช่วง', 'count', 'sum_delta', 40, true),
  reportMetric('period_engagement', 'Engagement เพิ่มในช่วง', 'count', 'derived_rate', 50, true),
  reportMetric('period_engagement_rate', 'Engagement Rate ในช่วง', 'percent', 'derived_rate', 60, true, 4),
  reportMetric('new_content_count', 'จำนวนคอนเทนต์ใหม่', 'count', 'count_distinct', 70, true),
  reportMetric('tracked_content_count', 'จำนวนคอนเทนต์ที่ติดตาม', 'count', 'count_distinct', 80, false),
  reportMetric('baseline_coverage_rate', 'ความครบถ้วนของ Baseline', 'percent', 'coverage_ratio', 90, false, 4),
  reportMetric('latest_total_views', 'ยอดวิวสะสมล่าสุด', 'count', 'sum_latest', 100, true),
  reportMetric('latest_total_engagement', 'Engagement สะสมล่าสุด', 'count', 'sum_latest', 110, true),
  reportMetric('latest_weighted_avg_watch_time_seconds', 'Average Watch Time ล่าสุด', 'seconds', 'weighted_average_latest', 120, true, 2),
  reportMetric('latest_weighted_completion_rate', 'Completion Rate ล่าสุด', 'percent', 'weighted_average_latest', 130, true, 4),
]);

/**
 * Seed rows แบบ Deterministic และใช้ metric_key เป็น Stable Key
 * Field metadata ถูกเตรียมให้ Report Engine, Dashboard และ Lark AI ใช้ความหมายชุดเดียวกัน
 */
export const METRIC_DEFINITION_ROWS = Object.freeze([
  ...ORGANIC_PLATFORMS.flatMap((platform) => ORGANIC_COUNT_METRICS.map(([metric, displayName, unit, canCompare]) => createMetricRow({
    platform,
    metric,
    rawFieldName: metric,
    displayName,
    unit,
    canCompareCrossPlatform: canCompare,
    metricNote: 'Organic cumulative content snapshot metric.',
    metricScope: 'content_snapshot',
    sourceTable: 'MKT_Content_Daily',
    aggregationMethod: 'sum_latest',
    clientVisible: false,
    sortOrder: 1_000,
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
    metricScope: 'content_snapshot',
    sourceTable: 'MKT_Content_Daily',
    aggregationMethod: 'sum_latest',
    clientVisible: false,
    sortOrder: 1_000,
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
    metricScope: 'content_snapshot',
    sourceTable: 'MKT_Content_Daily',
    aggregationMethod: 'sum_latest',
    clientVisible: false,
    sortOrder: 1_000,
  }),
  createMetricRow({
    platform: 'tiktok',
    metric: 'unique_viewers',
    rawFieldName: 'unique_viewers',
    displayName: 'Unique Viewers',
    unit: 'count',
    canCompareCrossPlatform: false,
    fallbackMetric: 'views',
    metricNote: 'Do not automatically rename this as Reach. It is content-level TikTok unique viewers and can overlap across videos.',
    metricScope: 'content_snapshot',
    sourceTable: 'MKT_Content_Daily',
    aggregationMethod: 'sum_latest',
    clientVisible: false,
    sortOrder: 1_000,
  }),
  createMetricRow({
    platform: 'tiktok',
    metric: 'avg_watch_time_seconds',
    rawFieldName: 'avg_watch_time_seconds',
    displayName: 'Average Watch Time',
    unit: 'seconds',
    canCompareCrossPlatform: false,
    fallbackMetric: null,
    metricNote: 'From TikTok Creator native analytics when available.',
    metricScope: 'content_snapshot',
    sourceTable: 'MKT_Content_Daily',
    aggregationMethod: 'weighted_average_latest',
    decimalPlaces: 2,
    clientVisible: false,
    sortOrder: 1_000,
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
    metricScope: 'content_snapshot',
    sourceTable: 'MKT_Content_Daily',
    aggregationMethod: 'weighted_average_latest',
    decimalPlaces: 4,
    clientVisible: false,
    sortOrder: 1_000,
  }),
  ...TIKTOK_REPORT_METRICS,
  ...ADS_PLATFORMS.flatMap((platform) => ADS_METRICS.map(([metric, displayName, unit, canCompare]) => createMetricRow({
    platform,
    metric,
    rawFieldName: metric,
    displayName,
    unit,
    canCompareCrossPlatform: canCompare,
    metricNote: 'Ads performance metric. Performance rows must come from reporting API or tracking-ready source.',
    metricScope: 'account_period',
    sourceTable: 'MKT_Ads_Daily',
    aggregationMethod: metric === 'ctr' || metric === 'cpc' || metric === 'cpm' || metric === 'actual_roas'
      ? 'derived_rate'
      : 'sum_delta',
    clientVisible: false,
    sortOrder: 2_000,
  }))),
]);

function reportMetric(metric, displayName, unit, aggregationMethod, sortOrder, clientVisible, decimalPlaces = 0) {
  return createMetricRow({
    platform: 'tiktok',
    metric,
    rawFieldName: metric,
    displayName,
    unit,
    canCompareCrossPlatform: false,
    metricNote: 'Computed by TikTok Organic Report Engine from cumulative daily content snapshots.',
    metricScope: metric === 'baseline_coverage_rate' ? 'report_quality' : 'account_period',
    sourceTable: 'derived',
    aggregationMethod,
    nullPolicy: 'preserve_null',
    higherIsBetter: metric !== 'baseline_coverage_rate' ? true : null,
    decimalPlaces,
    formulaVersion: 'tiktok-organic-v1',
    clientVisible,
    sortOrder,
  });
}

/** สร้างหนึ่งแถว Metric definition และตรวจ Field สำคัญก่อน Freeze */
function createMetricRow(input) {
  const platform = requireText(input.platform, 'platform');
  const metric = requireText(input.metric, 'metric');
  const unit = requireText(input.unit, 'unit');

  return Object.freeze({
    metric_key: `${platform}:${metric}`,
    platform,
    raw_field_name: requireText(input.rawFieldName, 'rawFieldName'),
    display_name: requireText(input.displayName, 'displayName'),
    formula: input.formula ?? null,
    unit,
    can_compare_cross_platform: Boolean(input.canCompareCrossPlatform),
    fallback_metric: input.fallbackMetric ?? null,
    metric_note: input.metricNote ?? null,
    enabled: input.enabled !== false,
    metric_scope: input.metricScope ?? 'content_snapshot',
    source_table: input.sourceTable ?? 'derived',
    aggregation_method: input.aggregationMethod ?? 'sum_latest',
    null_policy: input.nullPolicy ?? 'preserve_null',
    higher_is_better: input.higherIsBetter === null ? null : input.higherIsBetter !== false,
    decimal_places: Number.isInteger(input.decimalPlaces)
      ? input.decimalPlaces
      : defaultDecimalPlaces(unit),
    formula_version: input.formulaVersion ?? 'metric-v1',
    client_visible: input.clientVisible === true,
    sort_order: Number.isFinite(input.sortOrder) ? input.sortOrder : 1_000,
  });
}

function defaultDecimalPlaces(unit) {
  if (unit === 'percent' || unit === 'ratio') return 4;
  if (unit === 'seconds' || unit === 'currency') return 2;
  return 0;
}

/** บังคับข้อความที่ไม่ว่างเพื่อป้องกัน Seed key หรือ Mapping ที่ไม่สมบูรณ์ */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Metric definition seed requires ${fieldName}`);
  }

  return value.trim();
}
