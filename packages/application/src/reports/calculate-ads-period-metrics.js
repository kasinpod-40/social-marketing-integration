import { calculateRate, calculateRoas } from '../../../domain/src/value-objects/metric-value.js';

const SUM_FIELDS = Object.freeze([
  'spend_micros', 'impressions', 'reach', 'clicks', 'conversions',
  'conversion_value_micros', 'video_views',
]);

/** SUM one explicit report level first, then derive ratios from aggregate components. */
export function calculateAdsPeriodMetrics(input = {}) {
  const rows = requireArray(input.rows, 'rows');
  const reportLevel = normalizeReportLevel(input.reportLevel, rows);
  assertOneReportLevel(rows, reportLevel);
  const totals = Object.fromEntries(SUM_FIELDS.map((field) => [field, sumKnown(rows, field)]));
  const dataStatus = resolveDataStatus(rows, input.coverageStatus);
  return Object.freeze({
    report_level: reportLevel,
    ...totals,
    ctr: calculateRate(totals.clicks, totals.impressions),
    conversion_rate: calculateRate(totals.conversions, totals.clicks),
    cpc_micros: divideKnown(totals.spend_micros, totals.clicks),
    cpm_micros: multiplyThenDivideKnown(totals.spend_micros, 1_000, totals.impressions),
    cpa_micros: divideKnown(totals.spend_micros, totals.conversions),
    roas: calculateRoas({
      conversionValue: totals.conversion_value_micros,
      spend: totals.spend_micros,
    }),
    video_view_rate: calculateRate(totals.video_views, totals.impressions),
    data_status: dataStatus,
    coverage_rate: input.coverageRate ?? null,
  });
}

export function buildAdsMetricPayload(input = {}) {
  const platform = requireText(input.platform, 'platform');
  const formulaVersion = requireText(input.formulaVersion, 'formulaVersion');
  const current = requireObject(input.current, 'current');
  const compare = input.compare == null ? null : requireObject(input.compare, 'compare');
  const definitions = [
    ['spend_micros', 'Spend', 'currency'],
    ['impressions', 'Impressions', 'count'],
    ['reach', 'Reach', 'count'],
    ['clicks', 'Clicks', 'count'],
    ['conversions', 'Conversions', 'count'],
    ['conversion_value_micros', 'Conversion value', 'currency'],
    ['ctr', 'CTR', 'ratio'],
    ['conversion_rate', 'Conversion rate', 'ratio'],
    ['cpc_micros', 'CPC', 'currency'],
    ['cpm_micros', 'CPM', 'currency'],
    ['cpa_micros', 'CPA', 'currency'],
    ['roas', 'ROAS', 'ratio'],
    ['video_views', 'Video views', 'count'],
    ['video_view_rate', 'Video view rate', 'ratio'],
  ];
  return Object.freeze(Object.fromEntries(definitions.map(([key, displayName, unit], index) => {
    const currentValue = normalizeMetric(current[key]);
    const compareValue = compare ? normalizeMetric(compare[key]) : null;
    const change = currentValue === null || compareValue === null ? null : currentValue - compareValue;
    return [`${platform}:${key}`, Object.freeze({
      metricKey: `${platform}:${key}`,
      displayName,
      unit,
      current: currentValue,
      compare: compareValue,
      change,
      changePercent: change === null || compareValue === 0 ? null : change / Math.abs(compareValue),
      clientVisible: true,
      sortOrder: index + 1,
      formulaVersion,
    })];
  })));
}

function normalizeReportLevel(value, rows) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const levels = [...new Set(rows.map((row) => row?.report_level).filter((level) => typeof level === 'string' && level.trim()))];
  if (levels.length === 1) return levels[0];
  if (rows.length === 0) return null;
  throw new TypeError('Ads report calculation requires one explicit reportLevel');
}

function assertOneReportLevel(rows, expected) {
  const mismatch = rows.find((row) => expected !== null && row?.report_level !== expected);
  if (mismatch) {
    throw new TypeError(`Ads report row level ${mismatch?.report_level ?? 'missing'} does not match ${expected}`);
  }
}

function sumKnown(rows, field) {
  const values = rows.map((row) => row?.[field]).filter((value) => value !== null && value !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + requireNumber(value, field), 0);
}

function divideKnown(numerator, denominator) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function multiplyThenDivideKnown(value, multiplier, denominator) {
  if (value === null || denominator === null || denominator === 0) return null;
  return (value * multiplier) / denominator;
}

function resolveDataStatus(rows, coverageStatus) {
  if (coverageStatus === 'source_unavailable') return 'source_unavailable';
  if (rows.length === 0) return coverageStatus === 'no_data_confirmed' ? 'no_data_confirmed' : 'partial';
  const statuses = new Set(rows.map((row) => row.data_status));
  if (statuses.has('source_unavailable')) return 'source_unavailable';
  if (statuses.has('partial')) return 'partial';
  if (statuses.has('revisable')) return 'revisable';
  return coverageStatus === 'complete' ? 'complete' : 'partial';
}

function normalizeMetric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function requireArray(value, fieldName) { if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`); return value; }
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} is required`);
  return value;
}
function requireNumber(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${fieldName} must be finite`);
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
