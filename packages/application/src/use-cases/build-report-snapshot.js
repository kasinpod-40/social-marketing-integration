import { dateOnlyToEpochMilliseconds, requireDateOnly } from '../../../shared/src/date/date-only.js';
import { toEpochMilliseconds } from '../../../shared/src/date/date-time.js';

const REPORT_TYPES = new Set([
  'daily_organic_report',
  'weekly_organic_report',
  'monthly_organic_report',
  'ads_performance_report',
  'course_campaign_report',
  'top_content_report',
  'platform_strength_weakness_report',
  'executive_summary_report',
  'yoy_report',
]);

const COMPARISON_MODES = new Set(['none', 'previous_period', 'year_over_year', 'custom_range']);
const DATA_STATUSES = new Set(['complete', 'partial', 'no_data']);

/**
 * สร้างหนึ่งแถว Lark-ready สำหรับ MKT_Report_Snapshots
 * Report ID รวม Customer/Profile/Account เพื่อไม่ชนกันเมื่อใช้ Codebase เดียวกับหลายลูกค้า
 */
export function buildReportSnapshot(input = {}) {
  const reportType = requireOption(input.reportType, REPORT_TYPES, 'reportType');
  const reportSettingKey = requireText(input.reportSettingKey, 'reportSettingKey');
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const accountId = requireText(input.accountId, 'accountId');
  const periodStart = requireDateOnly(input.periodStart, { label: 'periodStart' });
  const periodEnd = requireDateOnly(input.periodEnd, { label: 'periodEnd' });
  const comparisonMode = requireOption(
    input.comparisonMode ?? 'none',
    COMPARISON_MODES,
    'comparisonMode',
  );
  const compareStart = optionalDate(input.compareStart, 'compareStart');
  const compareEnd = optionalDate(input.compareEnd, 'compareEnd');
  const platforms = normalizePlatforms(input.platforms);
  const courseName = normalizeNullableText(input.courseName);
  const generatedAt = toEpochMilliseconds(
    input.generatedAt ?? new Date().toISOString(),
    { label: 'generatedAt' },
  );
  const utcOffset = requireText(input.utcOffset ?? '+07:00', 'utcOffset');
  const dataStatus = requireOption(input.dataStatus ?? 'complete', DATA_STATUSES, 'dataStatus');
  const formulaVersion = requireText(input.formulaVersion, 'formulaVersion');
  const sourceSnapshotCount = nonNegativeInteger(input.sourceSnapshotCount ?? 0, 'sourceSnapshotCount');
  const baselineCoverageRate = optionalFiniteNumber(input.baselineCoverageRate, 'baselineCoverageRate');

  assertDateRange(periodStart, periodEnd, 'report period');
  if (comparisonMode !== 'none') {
    if (!compareStart || !compareEnd) {
      throw new Error('Comparison report snapshot requires compareStart and compareEnd');
    }
    assertDateRange(compareStart, compareEnd, 'comparison period');
  } else if (compareStart || compareEnd) {
    throw new Error('comparisonMode=none must not include compareStart or compareEnd');
  }

  const reportId = createReportId({
    reportType,
    reportSettingKey,
    customerProfile,
    accountId,
    periodStart,
    periodEnd,
    compareStart,
    compareEnd,
    comparisonMode,
    platforms,
    courseName,
  });

  return Object.freeze({
    report_id: reportId,
    report_setting_key: reportSettingKey,
    customer_profile: customerProfile,
    account_id: accountId,
    report_type: reportType,
    period_start: dateOnlyToEpochMilliseconds(periodStart, { label: 'periodStart', utcOffset }),
    period_end: dateOnlyToEpochMilliseconds(periodEnd, { label: 'periodEnd', utcOffset }),
    compare_start: compareStart
      ? dateOnlyToEpochMilliseconds(compareStart, { label: 'compareStart', utcOffset })
      : null,
    compare_end: compareEnd
      ? dateOnlyToEpochMilliseconds(compareEnd, { label: 'compareEnd', utcOffset })
      : null,
    comparison_mode: comparisonMode,
    platform: Object.freeze(platforms),
    course_name: courseName,
    metric_payload_json: stableStringify(requirePlainObject(input.metricPayload, 'metricPayload')),
    top_content_json: stableStringify(input.topContent ?? []),
    top_ads_json: stableStringify(input.topAds ?? []),
    generated_at: generatedAt,
    data_status: dataStatus,
    formula_version: formulaVersion,
    source_snapshot_count: sourceSnapshotCount,
    baseline_coverage_rate: baselineCoverageRate,
  });
}

/** สร้าง Stable report ID จากทุกมิติที่กำหนดเอกลักษณ์ของ Snapshot */
export function createReportId(input = {}) {
  const platformDimension = normalizePlatforms(input.platforms)
    .map((platform) => escapeReportIdentityPart(platform))
    .join('+');

  return [
    requireText(input.reportType, 'reportType'),
    escapeReportIdentityPart(requireText(input.customerProfile, 'customerProfile')),
    escapeReportIdentityPart(requireText(input.accountId, 'accountId')),
    requireDateOnly(input.periodStart, { label: 'periodStart' }),
    requireDateOnly(input.periodEnd, { label: 'periodEnd' }),
    requireText(input.comparisonMode, 'comparisonMode'),
    input.compareStart ?? 'none',
    input.compareEnd ?? 'none',
    platformDimension,
    escapeReportIdentityPart(input.courseName ?? 'all_courses'),
    escapeReportIdentityPart(requireText(input.reportSettingKey, 'reportSettingKey')),
  ].join('::');
}

/** Escape Separator ของ Report ID โดยคงค่าให้อ่านและ Trace ได้ */
export function escapeReportIdentityPart(value) {
  return requireText(value, 'report identity part')
    .replace(/%/gu, '%25')
    .replace(/:/gu, '%3A')
    .replace(/\+/gu, '%2B');
}

/** Normalize Platform ให้ไม่ซ้ำ ตัวพิมพ์เล็ก และเรียงลำดับคงที่ */
function normalizePlatforms(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('Report snapshot requires non-empty platforms array');
  }
  return [...new Set(value.map((item) => requireText(item, 'platform').toLowerCase()))].sort();
}

/** Serialize JSON แบบเรียง Object key ทุกระดับเพื่อให้ Diff และ Hash คงที่ */
export function stableStringify(value) {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('Report snapshot payload must not contain circular references');
    seen.add(value);
    const sortedItems = value.map((item) => sortDeep(item, seen));
    seen.delete(value);
    return sortedItems;
  }

  if (value && typeof value === 'object') {
    if (!isPlainObject(value)) {
      throw new TypeError('Report snapshot payload must contain only plain JSON objects and arrays');
    }
    if (seen.has(value)) throw new TypeError('Report snapshot payload must not contain circular references');
    seen.add(value);
    const sorted = Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortDeep(nested, seen)]),
    );
    seen.delete(value);
    return sorted;
  }

  if (value === undefined
    || typeof value === 'bigint'
    || typeof value === 'function'
    || typeof value === 'symbol'
    || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new TypeError('Report snapshot payload contains a non-JSON value');
  }
  return value;
}

function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireOption(value, allowed, fieldName) {
  const text = requireText(value, fieldName);
  if (!allowed.has(text)) throw new Error(`${fieldName} is not supported: ${text}`);
  return text;
}

function optionalDate(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requireDateOnly(value, { label: fieldName });
}

function assertDateRange(start, end, label) {
  if (start > end) throw new RangeError(`${label} start must not be after end`);
}

function requirePlainObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Report snapshot requires object ${fieldName}`);
  }
  return value;
}

function normalizeNullableText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(value, 'courseName');
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`Report snapshot ${fieldName} must be a non-negative integer`);
  }
  return number;
}

function optionalFiniteNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`Report snapshot ${fieldName} must be finite`);
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Report snapshot requires ${fieldName}`);
  }
  return value.trim();
}
