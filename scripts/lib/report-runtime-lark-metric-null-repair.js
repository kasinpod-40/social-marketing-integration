const DEFAULT_DECIMAL_PLACES = 4;
const METRIC_NUMBER_FIELDS = Object.freeze([
  Object.freeze({ payloadField: 'current', larkField: 'current_value' }),
  Object.freeze({ payloadField: 'compare', larkField: 'compare_value' }),
  Object.freeze({ payloadField: 'change', larkField: 'change_value' }),
  Object.freeze({ payloadField: 'changePercent', larkField: 'change_percent' }),
]);
const APPROVED_ORGANIC_NULL_METRIC_KEYS = Object.freeze([
  'tiktok:period_comments',
  'tiktok:period_engagement',
  'tiktok:period_engagement_rate',
  'tiktok:period_likes',
  'tiktok:period_shares',
  'tiktok:period_views',
]);

export function buildReportRuntimeMetricNullRepairPlan(input = {}) {
  const payload = requireObject(input.payload, 'payload');
  const metricPayload = requireObject(payload.metricPayload, 'payload.metricPayload');
  const records = requireArray(input.records, 'records');
  const decimalPlaces = readDecimalPlaces(input.decimalPlaces ?? DEFAULT_DECIMAL_PLACES);
  const expectedMetricKeys = Object.keys(metricPayload).sort();
  const recordsByMetricKey = new Map();

  for (const record of records) {
    const metricKey = normalizeText(record?.fields?.metric_key);
    const recordId = normalizeText(record?.recordId ?? record?.record_id);
    if (!metricKey || !recordId) throw repairError(
      'Report metric repair requires metric_key and record_id for every Lark row',
      'REPORT_RUNTIME_METRIC_NULL_REPAIR_RECORD_INVALID',
    );
    if (recordsByMetricKey.has(metricKey)) throw repairError(
      'Report metric repair found duplicate metric_key rows',
      'REPORT_RUNTIME_METRIC_NULL_REPAIR_DUPLICATE_KEY',
      { duplicateCount: 1 },
    );
    recordsByMetricKey.set(metricKey, record);
  }

  const observedMetricKeys = [...recordsByMetricKey.keys()].sort();
  if (JSON.stringify(expectedMetricKeys) !== JSON.stringify(observedMetricKeys)) throw repairError(
    'Report metric repair requires exact D1/Lark metric key parity',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_KEY_DRIFT',
    { expectedCount: expectedMetricKeys.length, observedCount: observedMetricKeys.length },
  );

  const staleCurrentKeys = [];
  let nonRepairableCurrentMismatchCount = 0;
  const updates = [];
  for (const metricKey of expectedMetricKeys) {
    const definition = requireObject(metricPayload[metricKey], `metricPayload.${metricKey}`);
    const record = recordsByMetricKey.get(metricKey);
    const expectedCurrent = canonicalizeNumber(definition.current, decimalPlaces);
    const observedCurrent = canonicalizeNumber(record?.fields?.current_value, decimalPlaces);
    if (expectedCurrent !== observedCurrent) {
      if (expectedCurrent === null && observedCurrent !== null) staleCurrentKeys.push(metricKey);
      else nonRepairableCurrentMismatchCount += 1;
    }

    const fields = {};
    for (const mapping of METRIC_NUMBER_FIELDS) {
      fields[mapping.larkField] = canonicalizeNumber(definition[mapping.payloadField], decimalPlaces);
    }
    updates.push(Object.freeze({
      recordId: normalizeText(record?.recordId ?? record?.record_id),
      fields: Object.freeze(fields),
    }));
  }

  const sortedStaleCurrentKeys = [...staleCurrentKeys].sort();
  const exactApprovedNullSet = JSON.stringify(sortedStaleCurrentKeys)
    === JSON.stringify(APPROVED_ORGANIC_NULL_METRIC_KEYS);
  if (!exactApprovedNullSet || nonRepairableCurrentMismatchCount !== 0) throw repairError(
    'Report metric repair observed drift outside the approved stale-null Organic KPI set',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_DRIFT_NOT_APPROVED',
    {
      metricCount: expectedMetricKeys.length,
      staleNullableCurrentCount: sortedStaleCurrentKeys.length,
      nonRepairableCurrentMismatchCount,
      approvedStaleNullableCurrentCount: APPROVED_ORGANIC_NULL_METRIC_KEYS.length,
    },
  );

  return Object.freeze({
    metricCount: expectedMetricKeys.length,
    staleNullableCurrentCount: sortedStaleCurrentKeys.length,
    nonRepairableCurrentMismatchCount,
    updates: Object.freeze(updates),
  });
}

export function assertReportRuntimeMetricNullRepairReadback(input = {}) {
  const payload = requireObject(input.payload, 'payload');
  const metricPayload = requireObject(payload.metricPayload, 'payload.metricPayload');
  const records = requireArray(input.records, 'records');
  const decimalPlaces = readDecimalPlaces(input.decimalPlaces ?? DEFAULT_DECIMAL_PLACES);
  const recordsByMetricKey = new Map();
  let duplicateMetricKeys = 0;

  for (const record of records) {
    const metricKey = normalizeText(record?.fields?.metric_key);
    if (!metricKey) throw repairError(
      'Report metric repair readback lacks metric_key',
      'REPORT_RUNTIME_METRIC_NULL_REPAIR_RECORD_INVALID',
    );
    if (recordsByMetricKey.has(metricKey)) duplicateMetricKeys += 1;
    recordsByMetricKey.set(metricKey, record);
  }

  const expectedMetricKeys = Object.keys(metricPayload).sort();
  const observedMetricKeys = [...recordsByMetricKey.keys()].sort();
  if (duplicateMetricKeys !== 0 || JSON.stringify(expectedMetricKeys) !== JSON.stringify(observedMetricKeys)) {
    throw repairError(
      'Report metric repair readback key shape is invalid',
      'REPORT_RUNTIME_METRIC_NULL_REPAIR_READBACK_KEY_DRIFT',
      {
        expectedCount: expectedMetricKeys.length,
        observedCount: observedMetricKeys.length,
        duplicateMetricKeys,
      },
    );
  }

  const mismatchFieldCounts = Object.fromEntries(METRIC_NUMBER_FIELDS.map(({ larkField }) => [larkField, 0]));
  for (const metricKey of expectedMetricKeys) {
    const definition = requireObject(metricPayload[metricKey], `metricPayload.${metricKey}`);
    const record = recordsByMetricKey.get(metricKey);
    for (const mapping of METRIC_NUMBER_FIELDS) {
      const expected = canonicalizeNumber(definition[mapping.payloadField], decimalPlaces);
      const observed = canonicalizeNumber(record?.fields?.[mapping.larkField], decimalPlaces);
      if (expected !== observed) mismatchFieldCounts[mapping.larkField] += 1;
    }
  }

  const mismatchCount = Object.values(mismatchFieldCounts).reduce((sum, count) => sum + count, 0);
  if (mismatchCount !== 0) throw repairError(
    'Report metric repair readback differs from D1 materialization',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_READBACK_DRIFT',
    { metricCount: expectedMetricKeys.length, mismatchCount, mismatchFieldCounts },
  );
  return Object.freeze({ metricCount: expectedMetricKeys.length, mismatchCount: 0 });
}

export function summarizeReportRuntimeMetricNullRepairPlan(plan = {}) {
  return Object.freeze({
    metricCount: finiteInteger(plan.metricCount),
    staleNullableCurrentCount: finiteInteger(plan.staleNullableCurrentCount),
    nonRepairableCurrentMismatchCount: finiteInteger(plan.nonRepairableCurrentMismatchCount),
    updateCount: Array.isArray(plan.updates) ? plan.updates.length : 0,
  });
}

function canonicalizeNumber(value, decimalPlaces) {
  if (value === null || value === undefined || value === '') return null;
  const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const candidate = scalar && typeof scalar === 'object'
    ? (scalar.value ?? scalar.text ?? null)
    : scalar;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const number = Number(candidate);
  if (!Number.isFinite(number)) throw repairError(
    'Report metric repair requires finite numbers or null',
    'REPORT_RUNTIME_METRIC_NULL_REPAIR_VALUE_INVALID',
  );
  const canonical = Number(number.toFixed(decimalPlaces));
  return Object.is(canonical, -0) ? 0 : canonical;
}

function readDecimalPlaces(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 15) {
    throw new TypeError('Report metric repair decimalPlaces must be an integer from 0 to 15');
  }
  return number;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizeText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const items = value.map(normalizeText).filter(Boolean);
    return items.length === 0 ? null : items.join('');
  }
  if (value && typeof value === 'object') return normalizeText(value.text ?? value.value ?? value.name ?? null);
  return value === null || value === undefined ? null : String(value).trim() || null;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`Report metric null repair requires array ${fieldName}`);
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw repairError(
      `Report metric null repair requires ${fieldName}`,
      'REPORT_RUNTIME_METRIC_NULL_REPAIR_VALUE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function repairError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeMetricNullRepairError';
  error.code = code;
  error.details = details;
  return error;
}
