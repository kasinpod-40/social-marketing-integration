import { requireDateOnly } from '../../../shared/src/date/date-only.js';

const DATA_STATUSES = new Set([
  'complete', 'partial', 'no_data', 'no_data_confirmed',
  'source_unavailable', 'not_observed', 'revisable',
]);
const PERIOD_KINDS = new Set(['rolling_days', 'custom_range']);
const EXTENSIBLE_KEY = /^[a-z][a-z0-9_]{0,63}$/u;
export const MAX_REPORT_MATERIALIZATION_BYTES = 256 * 1024;

/** Validate the only payload shape Dashboard, Lark and AI consumers may receive. */
export function validateReportMaterializationPayload(value, input = {}) {
  const payload = requireObject(value, 'materialization payload');
  const period = requireObject(payload.period, 'materialization payload.period');
  const normalized = Object.freeze({
    schemaVersion: requireText(payload.schemaVersion, 'schemaVersion'),
    sourceReportId: optionalText(payload.sourceReportId),
    platformScope: requireText(payload.platformScope, 'platformScope'),
    capability: requireExtensibleKey(payload.capability, 'capability'),
    reportType: requireText(payload.reportType, 'reportType'),
    period: normalizePeriod(period),
    dataStatus: requireChoice(normalizeDataStatus(payload.dataStatus), DATA_STATUSES, 'dataStatus'),
    coverageRate: optionalFinite(payload.coverageRate, 'coverageRate'),
    metricPayload: deepFreezeJson(requireObject(payload.metricPayload ?? {}, 'metricPayload')),
    collections: normalizeCollections(payload.collections),
    topContent: deepFreezeJson(requireArray(payload.topContent ?? [], 'topContent')),
    topAds: deepFreezeJson(requireArray(payload.topAds ?? [], 'topAds')),
    source: requireText(payload.source, 'source'),
    sourceWatermark: optionalText(payload.sourceWatermark),
    generatedAt: requireEpoch(payload.generatedAt, 'generatedAt'),
    sourceUnavailableReason: optionalText(payload.sourceUnavailableReason),
    aiSummary: payload.aiSummary == null ? null : deepFreezeJson(requireObject(payload.aiSummary, 'aiSummary')),
  });
  const encoded = JSON.stringify(normalized);
  const byteLength = new TextEncoder().encode(encoded).byteLength;
  const maximum = input.maxBytes ?? MAX_REPORT_MATERIALIZATION_BYTES;
  if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new TypeError('maxBytes must be positive');
  if (byteLength > maximum) {
    throw new RangeError(`Report materialization payload exceeds ${maximum} bytes`);
  }
  return normalized;
}

export function parseReportMaterializationPayload(value, input = {}) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('payload_json is required');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    throw new TypeError(`payload_json is invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return validateReportMaterializationPayload(parsed, input);
}

function normalizePeriod(period) {
  const periodKind = requireChoice(period.periodKind, PERIOD_KINDS, 'period.periodKind');
  const periodStart = requireDateOnly(period.periodStart, { label: 'period.periodStart' });
  const periodEnd = requireDateOnly(period.periodEnd, { label: 'period.periodEnd' });
  if (periodStart > periodEnd) throw new RangeError('periodStart must not be after periodEnd');
  const comparisonMode = requireChoice(period.comparisonMode ?? 'none', new Set(['none', 'previous_period']), 'period.comparisonMode');
  const compareStart = optionalDate(period.compareStart, 'period.compareStart');
  const compareEnd = optionalDate(period.compareEnd, 'period.compareEnd');
  if (comparisonMode === 'none' && (compareStart || compareEnd)) {
    throw new TypeError('comparisonMode=none cannot include comparison dates');
  }
  if (comparisonMode !== 'none' && (!compareStart || !compareEnd)) {
    throw new TypeError('comparison dates are required');
  }
  const windowDays = periodKind === 'rolling_days' ? positiveInteger(period.windowDays, 'period.windowDays') : null;
  return Object.freeze({
    periodKind,
    windowDays,
    periodStart,
    periodEnd,
    comparisonMode,
    compareStart,
    compareEnd,
  });
}

function normalizeCollections(value) {
  if (value === null || value === undefined) return Object.freeze({});
  const collections = requireObject(value, 'collections');
  return deepFreezeJson(Object.fromEntries(Object.entries(collections).map(([key, rows]) => [
    requireExtensibleKey(key, `collections.${key}`),
    requireArray(rows, `collections.${key}`),
  ])));
}

function normalizeDataStatus(value) { return value === 'no_data' ? 'no_data_confirmed' : value; }
function optionalDate(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requireDateOnly(value, { label: fieldName });
}
function deepFreezeJson(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) throw new TypeError('materialization payload must not contain circular references');
    seen.add(value);
    for (const nested of Object.values(value)) deepFreezeJson(nested, seen);
    seen.delete(value);
    Object.freeze(value);
  } else if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
    || typeof value === 'bigint' || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new TypeError('materialization payload contains a non-JSON value');
  }
  return value;
}
function requireChoice(value, allowed, fieldName) {
  const text = requireText(value, fieldName);
  if (!allowed.has(text)) throw new TypeError(`${fieldName} is unsupported: ${text}`);
  return text;
}
function requireExtensibleKey(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!EXTENSIBLE_KEY.test(text)) throw new TypeError(`${fieldName} must be a lowercase extensible key`);
  return text;
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}
function optionalFinite(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${fieldName} must be finite`);
  return number;
}
function requireEpoch(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be epoch milliseconds`);
  return number;
}
function optionalText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}
function requireArray(value, fieldName) { if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`); return value; }
