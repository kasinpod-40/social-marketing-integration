import { requireDateOnly } from '../../../shared/src/date/date-only.js';
import {
  dashboardMetricAvailabilityMessage,
  normalizeDashboardMetricAvailability,
  normalizeDashboardMetricScope,
} from '../../../config/src/dashboard-metric-readiness.js';

const SUM_DEFINITIONS = Object.freeze([
  metric('account_views', 'Account views', 'count', 'period_delta', 'views'),
  metric('account_reach', 'Account reach', 'count', 'period_delta', 'reach'),
  metric('account_profile_views', 'Profile views', 'count', 'period_delta', 'profile_views'),
  metric('account_engaged', 'Accounts engaged', 'count', 'period_delta', 'accounts_engaged'),
  metric('account_interactions', 'Account interactions', 'count', 'period_delta', 'total_interactions'),
  metric('account_net_follows', 'Net follows', 'count', 'period_delta', 'net_follows'),
]);
const SNAPSHOT_DEFINITIONS = Object.freeze([
  metric('account_followers', 'Followers', 'count', 'current_total', 'followers'),
  metric('account_follows', 'Following', 'count', 'current_total', 'follows'),
]);
const DEFINITIONS = Object.freeze([...SUM_DEFINITIONS, ...SNAPSHOT_DEFINITIONS]);

/** Aggregate proven Organic account-daily facts without substituting zero for missing metrics. */
export function calculateOrganicAccountPeriodMetrics(input = {}) {
  const rows = requireArray(input.rows ?? [], 'rows');
  const periodStart = requireDateOnly(input.periodStart, { label: 'periodStart' });
  const periodEnd = requireDateOnly(input.periodEnd, { label: 'periodEnd' });
  if (periodStart > periodEnd) throw new RangeError('periodStart must not be after periodEnd');
  const selected = rows.filter((row) => {
    const metricDate = requireDateOnly(row.metric_date ?? row.metricDate, { label: 'metricDate' });
    return metricDate >= periodStart && metricDate <= periodEnd;
  }).sort((left, right) => String(left.metric_date ?? left.metricDate)
    .localeCompare(String(right.metric_date ?? right.metricDate)));

  const metrics = {};
  for (const definition of SUM_DEFINITIONS) {
    metrics[definition.key] = sumStrict(selected.map((row) => row[definition.sourceField]));
  }
  for (const definition of SNAPSHOT_DEFINITIONS) {
    metrics[definition.key] = latestKnown(selected, definition.sourceField);
  }
  const coverageStatus = normalizeStatus(input.coverageStatus);
  const dataStatus = resolveStatus(selected, coverageStatus);
  return Object.freeze({
    periodStart,
    periodEnd,
    dataStatus,
    rowCount: selected.length,
    metrics: Object.freeze(metrics),
  });
}

export function buildOrganicAccountMetricPayload(input = {}) {
  const platform = requireText(input.platform, 'platform');
  const formulaVersion = requireText(input.formulaVersion, 'formulaVersion');
  const current = requireObject(input.current, 'current');
  const compare = input.compare == null ? null : requireObject(input.compare, 'compare');
  return Object.freeze(Object.fromEntries(DEFINITIONS.map((definition, index) => {
    const currentValue = finiteOrNull(current.metrics?.[definition.key]);
    const compareValue = compare ? finiteOrNull(compare.metrics?.[definition.key]) : null;
    const change = currentValue === null || compareValue === null ? null : currentValue - compareValue;
    const availabilityStatus = currentValue !== null
      ? normalizeDashboardMetricAvailability({ status: 'available' })
      : normalizeDashboardMetricAvailability({
        status: current.dataStatus === 'source_unavailable' ? 'source_unavailable' : 'not_observed',
      });
    const metricKey = `${platform}:${definition.key}`;
    return [metricKey, Object.freeze({
      metricKey,
      displayName: definition.displayName,
      unit: definition.unit,
      current: currentValue,
      compare: compareValue,
      change,
      changePercent: change === null || compareValue === 0 ? null : change / Math.abs(compareValue),
      metricScope: definition.metricScope,
      availabilityStatus,
      availabilityMessage: dashboardMetricAvailabilityMessage(availabilityStatus),
      clientVisible: true,
      sortOrder: 100 + index,
      formulaVersion,
    })];
  })));
}

function metric(key, displayName, unit, metricScope, sourceField) {
  return Object.freeze({
    key,
    displayName,
    unit,
    metricScope: normalizeDashboardMetricScope(metricScope),
    sourceField,
  });
}
function resolveStatus(rows, coverageStatus) {
  if (coverageStatus === 'source_unavailable') return 'source_unavailable';
  if (rows.length === 0) return coverageStatus === 'no_data_confirmed' ? 'no_data_confirmed' : 'not_observed';
  const statuses = new Set(rows.map((row) => normalizeStatus(row.data_status ?? row.dataStatus)));
  if (statuses.has('source_unavailable')) return 'source_unavailable';
  if (statuses.has('not_observed')) return 'not_observed';
  if (statuses.has('partial')) return 'partial';
  if (statuses.has('revisable') || coverageStatus === 'revisable') return 'revisable';
  return coverageStatus === 'complete' ? 'complete' : 'partial';
}
function sumStrict(values) {
  if (values.length === 0) return null;
  const normalized = values.map(finiteOrNull);
  if (normalized.some((value) => value === null)) return null;
  return normalized.reduce((total, value) => total + value, 0);
}
function latestKnown(rows, fieldName) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = finiteOrNull(rows[index]?.[fieldName]);
    if (value !== null) return value;
  }
  return null;
}
function normalizeStatus(value) {
  const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return status === 'completed' ? 'complete' : (status || 'not_observed');
}
function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Organic account metric must be finite or null');
  return number;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} is required`);
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
