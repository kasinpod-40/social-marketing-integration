import { REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS } from './report-runtime-closeout-operator.js';

export const REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION = 'EXECUTE_REPORT_RUNTIME_WINDOW_REPAIR';
export const REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS = Object.freeze({
  FRESH: 'fresh',
  REFRESH: 'refresh',
});
export const REPORT_RUNTIME_WINDOW_REPAIR_REFRESH_DAYS = Object.freeze([3, 7]);
export const REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE = Object.freeze([
  Object.freeze({ windowDays: 3, operation: REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS.REFRESH }),
  Object.freeze({ windowDays: 7, operation: REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS.REFRESH }),
  Object.freeze({ windowDays: 1, operation: REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS.FRESH }),
  Object.freeze({ windowDays: 30, operation: REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS.FRESH }),
]);

export function parseReportRuntimeWindowRepairArgs(argv = []) {
  const unknown = argv.filter((argument) => argument !== '--execute');
  if (unknown.length > 0) throw repairError(
    `Unsupported Report window repair arguments: ${unknown.join(', ')}`,
    'REPORT_RUNTIME_WINDOW_REPAIR_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertReportRuntimeWindowRepairConfirmation(env = {}) {
  if (env.CONFIRM_REPORT_RUNTIME_WINDOW_REPAIR !== REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION) {
    throw repairError(
      `Execution requires CONFIRM_REPORT_RUNTIME_WINDOW_REPAIR=${REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION}`,
      'REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function selectReportRuntimeWindowTarget(candidates, existingReportIds = [], env = process.env) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw repairError(
    'Report window candidate list is empty',
    'REPORT_RUNTIME_WINDOW_REPAIR_CANDIDATE_INVALID',
  );
  const windowDays = readWindowDays(env.MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS);
  const operation = readOperation(env.MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION);
  const existing = new Set(existingReportIds.map(String));
  if (windowDays === null) {
    if (operation === REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS.REFRESH) throw repairError(
      'Report refresh requires MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS',
      'REPORT_RUNTIME_WINDOW_REPAIR_WINDOW_REQUIRED',
    );
    const firstFresh = candidates.find((candidate) => !existing.has(candidate.reportId));
    if (!firstFresh) throw repairError(
      'Every reviewed Report preset already exists for the selected period',
      'REPORT_RUNTIME_WINDOW_REPAIR_FRESH_TARGET_EXISTS',
      { candidateCount: candidates.length },
    );
    return Object.freeze({ ...firstFresh, operation });
  }
  const selected = candidates.find((candidate) => candidate?.windowDays === windowDays);
  if (!selected) throw repairError(
    `Requested Report window is not available: ${windowDays}D`,
    'REPORT_RUNTIME_WINDOW_REPAIR_WINDOW_UNAVAILABLE',
    { windowDays },
  );

  const exists = existing.has(selected.reportId);
  if (operation === REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS.FRESH && exists) throw repairError(
    `Fresh Report window already exists for the selected period: ${windowDays}D`,
    'REPORT_RUNTIME_WINDOW_REPAIR_FRESH_TARGET_EXISTS',
    { windowDays },
  );
  if (operation === REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS.REFRESH) {
    if (!REPORT_RUNTIME_WINDOW_REPAIR_REFRESH_DAYS.includes(windowDays)) throw repairError(
      `Refresh is approved only for ${REPORT_RUNTIME_WINDOW_REPAIR_REFRESH_DAYS.join('D, ')}D`,
      'REPORT_RUNTIME_WINDOW_REPAIR_REFRESH_WINDOW_NOT_APPROVED',
      { windowDays },
    );
    if (!exists) throw repairError(
      `Refresh target does not exist for the selected period: ${windowDays}D`,
      'REPORT_RUNTIME_WINDOW_REPAIR_REFRESH_TARGET_MISSING',
      { windowDays },
    );
  }
  return Object.freeze({ ...selected, operation });
}

export function assertReportRuntimeWindowTargetPrestate(input = {}) {
  const operation = readOperation(input.operation);
  const reportId = requireText(input.reportId, 'reportId');
  const d1 = input.d1 ?? {};
  const lark = input.lark ?? {};
  const materializationCount = Number(d1.materialization_count ?? 0);
  const snapshotCount = Number(lark.snapshots ?? 0);
  const metricCount = Number(lark.metrics ?? 0);
  const topContentCount = Number(lark.topContent ?? 0);

  if (operation === REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS.FRESH) {
    if (materializationCount !== 0 || snapshotCount !== 0 || metricCount !== 0 || topContentCount !== 0) {
      throw repairError(
        'Fresh Report target already has D1 or Lark rows',
        'REPORT_RUNTIME_WINDOW_REPAIR_FRESH_PRESTATE_INVALID',
        { materializationCount, snapshotCount, metricCount, topContentCount },
      );
    }
    return true;
  }

  if (materializationCount !== 1
    || d1.report_id !== reportId
    || typeof d1.payload_checksum !== 'string'
    || d1.payload_checksum.trim() === ''
    || snapshotCount !== 1
    || metricCount <= 0
    || topContentCount < 0) {
    throw repairError(
      'Refresh Report target is missing or has duplicate/incomplete D1 or Lark rows',
      'REPORT_RUNTIME_WINDOW_REPAIR_REFRESH_PRESTATE_INVALID',
      {
        reportIdMatched: d1.report_id === reportId,
        materializationCount,
        snapshotCount,
        metricCount,
        topContentCount,
      },
    );
  }
  return true;
}

export function assertReportRuntimeWindowChanged(input = {}) {
  const operation = readOperation(input.operation);
  const before = input.before ?? {};
  const after = input.after ?? {};
  if (operation === REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS.FRESH) {
    if (Number(before.materialization_count ?? 0) !== 0 || Number(after.materialization_count ?? 0) !== 1) {
      throw repairError(
        'Fresh Report materialization did not transition from zero to one row',
        'REPORT_RUNTIME_WINDOW_REPAIR_FRESH_TRANSITION_INVALID',
      );
    }
    return true;
  }
  if (Number(before.materialization_count ?? 0) !== 1
    || Number(after.materialization_count ?? 0) !== 1
    || typeof before.payload_checksum !== 'string'
    || before.payload_checksum === after.payload_checksum) {
    throw repairError(
      'Refresh Report materialization did not replace the prior payload under the same Stable ID',
      'REPORT_RUNTIME_WINDOW_REPAIR_REFRESH_TRANSITION_INVALID',
      {
        stableRowCount: Number(after.materialization_count ?? 0),
        payloadChanged: before.payload_checksum !== after.payload_checksum,
      },
    );
  }
  return true;
}

export function assertReportRuntimeOrganicIntegrity(input = {}) {
  const payload = requireObject(input.payload, 'payload');
  const larkMetrics = requireObject(input.larkMetrics, 'larkMetrics');
  const metricPayload = requireObject(payload.metricPayload, 'payload.metricPayload');
  const aggregateMetricKeys = [
    'tiktok:period_views',
    'tiktok:period_likes',
    'tiktok:period_comments',
    'tiktok:period_shares',
    'tiktok:period_engagement',
    'tiktok:period_engagement_rate',
  ];
  const expectedMetricKeys = Object.keys(metricPayload).sort();
  const observedMetricKeys = Object.keys(larkMetrics).sort();
  if (JSON.stringify(expectedMetricKeys) !== JSON.stringify(observedMetricKeys)) throw repairError(
    'D1 and Lark Report metric key sets differ',
    'REPORT_RUNTIME_WINDOW_REPAIR_METRIC_KEY_DRIFT',
    { expectedCount: expectedMetricKeys.length, observedCount: observedMetricKeys.length },
  );

  let mismatches = 0;
  for (const metricKey of expectedMetricKeys) {
    const expected = optionalFinite(metricPayload[metricKey]?.current);
    const observed = optionalFinite(larkMetrics[metricKey]);
    if (expected !== observed) mismatches += 1;
  }
  if (mismatches !== 0) throw repairError(
    'D1 and Lark Report metric values differ',
    'REPORT_RUNTIME_WINDOW_REPAIR_METRIC_VALUE_DRIFT',
    { mismatchCount: mismatches },
  );

  const coverageRate = optionalFinite(payload.coverageRate);
  const incompleteBaseline = coverageRate !== null && coverageRate < 1;
  const aggregateNullCount = aggregateMetricKeys.filter((key) => optionalFinite(metricPayload[key]?.current) === null).length;
  if (incompleteBaseline && aggregateNullCount !== aggregateMetricKeys.length) throw repairError(
    'Incomplete Organic baseline exposed numeric aggregate KPI values',
    'REPORT_RUNTIME_WINDOW_REPAIR_PARTIAL_AGGREGATE_NUMERIC',
    { aggregateMetricCount: aggregateMetricKeys.length, aggregateNullCount },
  );
  return Object.freeze({
    metricCount: expectedMetricKeys.length,
    mismatchCount: mismatches,
    incompleteBaseline,
    aggregateMetricCount: aggregateMetricKeys.length,
    aggregateNullCount,
  });
}

function readWindowDays(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || !REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS.includes(number)) throw repairError(
    `MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS must be one of ${REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS.join(', ')}`,
    'REPORT_RUNTIME_WINDOW_REPAIR_WINDOW_INVALID',
    { windowDays: value },
  );
  return number;
}

function readOperation(value) {
  const normalized = value === undefined || value === null || String(value).trim() === ''
    ? REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS.FRESH
    : String(value).trim().toLowerCase();
  if (!Object.values(REPORT_RUNTIME_WINDOW_REPAIR_OPERATIONS).includes(normalized)) throw repairError(
    'MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION must be fresh or refresh',
    'REPORT_RUNTIME_WINDOW_REPAIR_OPERATION_INVALID',
    { operation: value },
  );
  return normalized;
}

function optionalFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw repairError(
    'Report metric must be finite or null',
    'REPORT_RUNTIME_WINDOW_REPAIR_METRIC_INVALID',
  );
  return number;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw repairError(
    `${fieldName} is required`,
    'REPORT_RUNTIME_WINDOW_REPAIR_VALUE_INVALID',
    { fieldName },
  );
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw repairError(
    `${fieldName} is required`,
    'REPORT_RUNTIME_WINDOW_REPAIR_VALUE_INVALID',
    { fieldName },
  );
  return value.trim();
}

function repairError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeWindowRepairError';
  error.code = code;
  error.details = details;
  return error;
}
