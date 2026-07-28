import { calculateRate, calculateRoas } from '../../../domain/src/value-objects/metric-value.js';

const SUM_FIELDS = Object.freeze([
  'spend_micros', 'impressions', 'reach', 'clicks', 'conversions',
  'conversion_value_micros', 'video_views',
]);

/** SUM revision-resolved daily facts first, then derive ratios from aggregate numerators. */
export function calculateAdsPeriodMetrics(input = {}) {
  const rows = requireArray(input.rows, 'rows');
  const totals = Object.fromEntries(SUM_FIELDS.map((field) => [field, sumKnown(rows, field)]));
  const dataStatus = resolveDataStatus(rows, input.coverageStatus);
  return Object.freeze({
    ...totals,
    ctr: calculateRate(totals.clicks, totals.impressions),
    conversion_rate: calculateRate(totals.conversions, totals.clicks),
    roas: calculateRoas({
      conversionValue: totals.conversion_value_micros,
      spend: totals.spend_micros,
    }),
    video_view_rate: calculateRate(totals.video_views, totals.impressions),
    data_status: dataStatus,
    coverage_rate: input.coverageRate ?? null,
  });
}

function sumKnown(rows, field) {
  const values = rows.map((row) => row?.[field]).filter((value) => value !== null && value !== undefined);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + requireNumber(value, field), 0);
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

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireNumber(value, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${fieldName} must be finite`);
  return value;
}
