const REPORT_TYPES = new Set([
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

/**
 * Builds one MKT_Report_Snapshots row. The row stores computed payloads as JSON
 * strings so AI summaries consume system-calculated numbers instead of guessing.
 *
 * @param {Object} input
 * @param {string} input.reportType
 * @param {string} input.periodStart YYYY-MM-DD
 * @param {string} input.periodEnd YYYY-MM-DD
 * @param {string} [input.compareStart] YYYY-MM-DD
 * @param {string} [input.compareEnd] YYYY-MM-DD
 * @param {string} input.comparisonMode
 * @param {string[]} input.platforms
 * @param {string|null} [input.courseName]
 * @param {Object} input.metricPayload
 * @param {Array|Object} [input.topContent]
 * @param {Array|Object} [input.topAds]
 * @param {string} [input.generatedAt]
 */
export function buildReportSnapshot(input) {
  const reportType = requireOption(input?.reportType, REPORT_TYPES, 'reportType');
  const periodStart = requireDate(input?.periodStart, 'periodStart');
  const periodEnd = requireDate(input?.periodEnd, 'periodEnd');
  const comparisonMode = requireOption(input?.comparisonMode ?? 'none', COMPARISON_MODES, 'comparisonMode');
  const compareStart = optionalDate(input?.compareStart, 'compareStart');
  const compareEnd = optionalDate(input?.compareEnd, 'compareEnd');
  const platforms = normalizePlatforms(input?.platforms);
  const courseName = normalizeNullableText(input?.courseName);
  const generatedAt = input?.generatedAt ?? new Date().toISOString();

  if (comparisonMode !== 'none' && (!compareStart || !compareEnd)) {
    throw new Error('Comparison report snapshot requires compareStart and compareEnd');
  }

  return Object.freeze({
    report_id: createReportId({ reportType, periodStart, periodEnd, compareStart, compareEnd, comparisonMode, platforms, courseName }),
    report_type: reportType,
    period_start: periodStart,
    period_end: periodEnd,
    compare_start: compareStart,
    compare_end: compareEnd,
    comparison_mode: comparisonMode,
    platform: Object.freeze(platforms),
    course_name: courseName,
    metric_payload_json: stableStringify(requireObject(input?.metricPayload, 'metricPayload')),
    top_content_json: stableStringify(input?.topContent ?? []),
    top_ads_json: stableStringify(input?.topAds ?? []),
    generated_at: requireIsoDateTime(generatedAt, 'generatedAt'),
  });
}

function createReportId(input) {
  const parts = [
    input.reportType,
    input.periodStart,
    input.periodEnd,
    input.comparisonMode,
    input.compareStart ?? 'none',
    input.compareEnd ?? 'none',
    input.platforms.join('+'),
    input.courseName ?? 'all_courses',
  ];

  return parts.join('::');
}

function normalizePlatforms(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('Report snapshot requires non-empty platforms array');
  }

  return [...new Set(value.map((item) => requireText(item, 'platform')))].sort();
}

function stableStringify(value) {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortDeep(nested)]));
  }

  return value;
}

function requireOption(value, allowed, fieldName) {
  const text = requireText(value, fieldName);
  if (!allowed.has(text)) {
    throw new Error(`${fieldName} is not supported: ${text}`);
  }

  return text;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }

  return text;
}

function optionalDate(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requireDate(value, fieldName);
}

function requireIsoDateTime(value, fieldName) {
  const text = requireText(value, fieldName);
  if (Number.isNaN(Date.parse(text))) {
    throw new Error(`${fieldName} must be ISO datetime`);
  }

  return text;
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Report snapshot requires object ${fieldName}`);
  }

  return value;
}

function normalizeNullableText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(value, 'courseName');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Report snapshot requires ${fieldName}`);
  }

  return value.trim();
}
