import { dateOnlyToEpochMilliseconds } from '../../../shared/src/date/date-only.js';
import { escapeReportIdentityPart } from '../use-cases/build-report-snapshot.js';

const MAX_RANK_LIMIT = 100;
const NO_DATA_URL = 'https://invalid.example/';

/** สร้างแถว Normalized metrics สำหรับ MKT_Report_Metric_Values */
export function buildReportMetricValueRows(input = {}) {
  const reportId = requireText(input.reportId, 'reportId');
  const platform = requireText(input.platform ?? 'tiktok', 'platform');
  const metrics = requireObject(input.metrics, 'metrics');
  const period = requireObject(input.period, 'period');
  const generatedAt = requireEpoch(input.generatedAt, 'generatedAt');
  const utcOffset = requireText(input.utcOffset, 'utcOffset');
  const rows = Object.values(metrics)
    .sort((left, right) => Number(left.sortOrder ?? 1_000) - Number(right.sortOrder ?? 1_000))
    .map((metric, index) => {
      const dimensionType = 'summary';
      const dimensionValue = 'all';
      return Object.freeze({
        report_metric_key: [reportId, escapeReportIdentityPart(metric.metricKey), dimensionType, dimensionValue].join('::'),
        report_id: reportId,
        report_setting_key: requireText(input.reportSettingKey, 'reportSettingKey'),
        customer_profile: requireText(input.customerProfile, 'customerProfile'),
        report_type: requireText(input.reportType, 'reportType'),
        platform,
        account_id: requireText(input.accountId, 'accountId'),
        metric_key: requireText(metric.metricKey, 'metricKey'),
        display_name: requireText(metric.displayName, 'displayName'),
        current_value: optionalFinite(metric.current),
        compare_value: optionalFinite(metric.compare),
        change_value: optionalFinite(metric.change),
        change_percent: optionalFinite(metric.changePercent),
        unit: requireText(metric.unit, 'unit'),
        data_status: requireText(input.dataStatus, 'dataStatus'),
        dimension_type: dimensionType,
        dimension_value: dimensionValue,
        rank: index + 1,
        period_start: dateOnlyToEpochMilliseconds(period.periodStart, { utcOffset }),
        period_end: dateOnlyToEpochMilliseconds(period.periodEnd, { utcOffset }),
        compare_start: period.compareStart ? dateOnlyToEpochMilliseconds(period.compareStart, { utcOffset }) : null,
        compare_end: period.compareEnd ? dateOnlyToEpochMilliseconds(period.compareEnd, { utcOffset }) : null,
        generated_at: generatedAt,
        formula_version: requireText(metric.formulaVersion, 'formulaVersion'),
        source_snapshot_count: nonNegativeInteger(input.sourceSnapshotCount ?? 0, 'sourceSnapshotCount'),
        client_visible: metric.clientVisible === true,
      });
    });
  return Object.freeze(rows);
}

/** Fixed-rank platform-neutral Top Content output; default platform preserves TikTok compatibility. */
export function buildReportTopContentRows(input = {}) {
  const reportId = requireText(input.reportId, 'reportId');
  const platform = requireText(input.platform ?? 'tiktok', 'platform');
  const rows = requireArray(input.contentRows, 'contentRows');
  const limit = positiveInteger(input.limit, 'limit');
  const period = requireObject(input.period, 'period');
  const generatedAt = requireEpoch(input.generatedAt, 'generatedAt');
  const utcOffset = requireText(input.utcOffset, 'utcOffset');
  const output = [];
  for (let index = 0; index < limit; index += 1) {
    const rank = index + 1;
    const row = rows[index] ?? null;
    const content = row?.content ?? normalizeTopContentPayload(row);
    output.push(Object.freeze({
      report_content_key: `${reportId}::rank:${rank}`,
      report_id: reportId,
      report_setting_key: requireText(input.reportSettingKey, 'reportSettingKey'),
      customer_profile: requireText(input.customerProfile, 'customerProfile'),
      report_type: requireText(input.reportType, 'reportType'),
      platform,
      account_id: requireText(input.accountId, 'accountId'),
      rank,
      content_key: content?.contentKey ?? content?.content_key ?? `no_data:${reportId}:${rank}`,
      external_content_id: content?.externalContentId ?? content?.external_content_id ?? `no_data_${rank}`,
      caption: content?.caption ?? 'ไม่มีข้อมูล',
      content_url: content?.contentUrl ?? content?.content_url ?? NO_DATA_URL,
      thumbnail_url: content?.thumbnailUrl ?? content?.thumbnail_url ?? NO_DATA_URL,
      published_at: content?.publishedAt ?? content?.published_at ?? generatedAt,
      period_views: optionalFinite(row?.periodViews ?? row?.period_views),
      period_likes: optionalFinite(row?.periodLikes ?? row?.period_likes),
      period_comments: optionalFinite(row?.periodComments ?? row?.period_comments),
      period_shares: optionalFinite(row?.periodShares ?? row?.period_shares),
      period_engagement: optionalFinite(row?.periodEngagement ?? row?.period_engagement),
      period_engagement_rate: optionalFinite(row?.periodEngagementRate ?? row?.period_engagement_rate),
      latest_total_views: optionalFinite(row?.current?.views ?? row?.latest_total_views),
      performance_status: row?.performanceStatus ?? row?.performance_status ?? 'no_data',
      data_status: row?.dataStatus ?? row?.data_status ?? 'no_data',
      period_start: dateOnlyToEpochMilliseconds(period.periodStart, { utcOffset }),
      period_end: dateOnlyToEpochMilliseconds(period.periodEnd, { utcOffset }),
      generated_at: generatedAt,
    }));
  }
  return Object.freeze(output);
}

/** Fixed-rank Top Ads output. Empty slots overwrite old ranks with explicit no_data rows. */
export function buildReportTopAdsRows(input = {}) {
  const reportId = requireText(input.reportId, 'reportId');
  const platform = requireText(input.platform, 'platform');
  const rows = requireArray(input.adRows, 'adRows');
  const limit = positiveInteger(input.limit, 'limit');
  const period = requireObject(input.period, 'period');
  const generatedAt = requireEpoch(input.generatedAt, 'generatedAt');
  const utcOffset = requireText(input.utcOffset, 'utcOffset');
  return Object.freeze(Array.from({ length: limit }, (_, index) => {
    const rank = index + 1;
    const row = rows[index] ?? null;
    return Object.freeze({
      report_ad_key: `${reportId}::rank:${rank}`,
      report_id: reportId,
      report_setting_key: requireText(input.reportSettingKey, 'reportSettingKey'),
      customer_profile: requireText(input.customerProfile, 'customerProfile'),
      report_type: requireText(input.reportType, 'reportType'),
      platform,
      account_id: requireText(input.accountId, 'accountId'),
      rank,
      external_ad_id: row?.external_ad_id ?? `no_data_${rank}`,
      external_campaign_id: row?.external_campaign_id ?? null,
      external_ad_group_id: row?.external_ad_group_id ?? null,
      external_creative_id: row?.external_creative_id ?? null,
      ad_name: row?.ad_name ?? 'ไม่มีข้อมูล',
      currency: row?.currency ?? null,
      spend_micros: optionalFinite(row?.spend_micros),
      impressions: optionalFinite(row?.impressions),
      reach: optionalFinite(row?.reach),
      clicks: optionalFinite(row?.clicks),
      conversions: optionalFinite(row?.conversions),
      conversion_value_micros: optionalFinite(row?.conversion_value_micros),
      ctr: optionalFinite(row?.ctr),
      cpc_micros: optionalFinite(row?.cpc_micros),
      cpm_micros: optionalFinite(row?.cpm_micros),
      cpa_micros: optionalFinite(row?.cpa_micros),
      roas: optionalFinite(row?.roas),
      data_status: row?.data_status ?? 'no_data',
      period_start: dateOnlyToEpochMilliseconds(period.periodStart, { utcOffset }),
      period_end: dateOnlyToEpochMilliseconds(period.periodEnd, { utcOffset }),
      generated_at: generatedAt,
    });
  }));
}

function normalizeTopContentPayload(row) { return row && typeof row === 'object' ? row : null; }
function optionalFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Report output metric must be finite');
  return number;
}
function requireEpoch(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`Report output requires epoch ${fieldName}`);
  return Math.trunc(number);
}
function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`Report output ${fieldName} must be non-negative`);
  return number;
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_RANK_LIMIT) {
    throw new TypeError(`Report output ${fieldName} must be an integer between 1 and ${MAX_RANK_LIMIT}`);
  }
  return number;
}
function requireArray(value, fieldName) { if (!Array.isArray(value)) throw new TypeError(`Report output requires ${fieldName}`); return value; }
function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Report output requires ${fieldName}`);
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Report output requires ${fieldName}`);
  return value.trim();
}
