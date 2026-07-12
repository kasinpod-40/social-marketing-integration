import { dateOnlyToEpochMilliseconds } from '../../../shared/src/date/date-only.js';
import { escapeReportIdentityPart } from '../use-cases/build-report-snapshot.js';

const MAX_TOP_CONTENT_LIMIT = 100;

/** สร้างแถว Normalized metrics สำหรับ MKT_Report_Metric_Values */
export function buildReportMetricValueRows(input = {}) {
  const reportId = requireText(input.reportId, 'reportId');
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
        report_metric_key: [
          reportId,
          escapeReportIdentityPart(metric.metricKey),
          dimensionType,
          dimensionValue,
        ].join('::'),
        report_id: reportId,
        report_setting_key: requireText(input.reportSettingKey, 'reportSettingKey'),
        customer_profile: requireText(input.customerProfile, 'customerProfile'),
        report_type: requireText(input.reportType, 'reportType'),
        platform: 'tiktok',
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
        compare_start: period.compareStart
          ? dateOnlyToEpochMilliseconds(period.compareStart, { utcOffset })
          : null,
        compare_end: period.compareEnd
          ? dateOnlyToEpochMilliseconds(period.compareEnd, { utcOffset })
          : null,
        generated_at: generatedAt,
        formula_version: requireText(metric.formulaVersion, 'formulaVersion'),
        source_snapshot_count: nonNegativeInteger(input.sourceSnapshotCount, 'sourceSnapshotCount'),
        client_visible: metric.clientVisible === true,
      });
    });
  return Object.freeze(rows);
}

/** สร้างแถว Top content แบบ Fixed rank เพื่อให้ Rerun แทนค่ารายการเดิมได้โดยไม่เหลือแถวเก่า */
export function buildReportTopContentRows(input = {}) {
  const reportId = requireText(input.reportId, 'reportId');
  const rows = requireArray(input.contentRows, 'contentRows');
  const limit = positiveInteger(input.limit, 'limit');
  const period = requireObject(input.period, 'period');
  const generatedAt = requireEpoch(input.generatedAt, 'generatedAt');
  const utcOffset = requireText(input.utcOffset, 'utcOffset');
  const output = [];

  for (let index = 0; index < limit; index += 1) {
    const rank = index + 1;
    const row = rows[index] ?? null;
    output.push(Object.freeze({
      report_content_key: `${reportId}::rank:${rank}`,
      report_id: reportId,
      report_setting_key: requireText(input.reportSettingKey, 'reportSettingKey'),
      customer_profile: requireText(input.customerProfile, 'customerProfile'),
      report_type: requireText(input.reportType, 'reportType'),
      platform: 'tiktok',
      account_id: requireText(input.accountId, 'accountId'),
      rank,
      content_key: row?.content?.contentKey ?? `no_data:${reportId}:${rank}`,
      external_content_id: row?.content?.externalContentId ?? `no_data_${rank}`,
      // ใช้ค่าทดแทนแบบเขียนทับได้เสมอ เพราะ Lark null อาจหมายถึง omit และทิ้งค่า Rank เก่าไว้
      caption: row?.content?.caption ?? 'ไม่มีข้อมูล',
      content_url: row?.content?.contentUrl ?? 'https://www.tiktok.com/',
      thumbnail_url: row?.content?.thumbnailUrl ?? 'https://www.tiktok.com/',
      published_at: row?.content?.publishedAt ?? generatedAt,
      period_views: numberOrZero(row?.periodViews),
      period_likes: numberOrZero(row?.periodLikes),
      period_comments: numberOrZero(row?.periodComments),
      period_shares: numberOrZero(row?.periodShares),
      period_engagement: numberOrZero(row?.periodEngagement),
      period_engagement_rate: optionalFinite(row?.periodEngagementRate),
      latest_total_views: numberOrZero(row?.current?.views),
      performance_status: row?.performanceStatus ?? 'no_data',
      data_status: row?.dataStatus ?? 'no_data',
      period_start: dateOnlyToEpochMilliseconds(period.periodStart, { utcOffset }),
      period_end: dateOnlyToEpochMilliseconds(period.periodEnd, { utcOffset }),
      generated_at: generatedAt,
    }));
  }

  return Object.freeze(output);
}

function numberOrZero(value) {
  const normalized = optionalFinite(value);
  return normalized ?? 0;
}

function optionalFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Report output metric must be finite');
  return number;
}

function requireEpoch(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError(`Report output requires epoch ${fieldName}`);
  }
  return Math.trunc(number);
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`Report output ${fieldName} must be a non-negative integer`);
  }
  return number;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_TOP_CONTENT_LIMIT) {
    throw new TypeError(
      `Report output ${fieldName} must be an integer between 1 and ${MAX_TOP_CONTENT_LIMIT}`,
    );
  }
  return number;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`Report output requires ${fieldName}`);
  return value;
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Report output requires ${fieldName}`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Report output requires ${fieldName}`);
  }
  return value.trim();
}
