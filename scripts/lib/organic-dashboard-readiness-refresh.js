export const ORGANIC_DASHBOARD_READINESS_REFRESH_CONTRACT_VERSION =
  'organic_dashboard_readiness_refresh_v1';
export const ORGANIC_DASHBOARD_READINESS_REFRESH_CONFIRMATION =
  'EXECUTE_ORGANIC_DASHBOARD_READINESS_REFRESH';
export const ORGANIC_DASHBOARD_READINESS_REFRESH_WINDOWS = Object.freeze([1, 3, 7, 30]);

export const ORGANIC_DASHBOARD_READINESS_METRIC_KEYS = Object.freeze([
  'tiktok:period_views',
  'tiktok:period_likes',
  'tiktok:period_comments',
  'tiktok:period_shares',
  'tiktok:period_engagement',
  'tiktok:period_engagement_rate',
  'tiktok:latest_total_views',
  'tiktok:latest_total_likes',
  'tiktok:latest_total_comments',
  'tiktok:latest_total_shares',
  'tiktok:latest_total_engagement',
  'tiktok:latest_engagement_rate',
  'tiktok:new_content_count',
  'tiktok:tracked_content_count',
  'tiktok:baseline_covered_content_count',
  'tiktok:baseline_missing_content_count',
  'tiktok:baseline_coverage_rate',
]);

const PERIOD_KEYS = new Set(ORGANIC_DASHBOARD_READINESS_METRIC_KEYS.slice(0, 6));
const CURRENT_TOTAL_KEYS = new Set(ORGANIC_DASHBOARD_READINESS_METRIC_KEYS.slice(6, 12));
const DATA_QUALITY_KEYS = new Set(ORGANIC_DASHBOARD_READINESS_METRIC_KEYS.slice(12));
const LARK_DECIMAL_PLACES = 4;

export function assertOrganicDashboardReadinessRefreshConfirmation(env = {}) {
  if (env.CONFIRM_ORGANIC_DASHBOARD_READINESS_REFRESH
    !== ORGANIC_DASHBOARD_READINESS_REFRESH_CONFIRMATION) {
    throw readinessError(
      `Execution requires CONFIRM_ORGANIC_DASHBOARD_READINESS_REFRESH=${ORGANIC_DASHBOARD_READINESS_REFRESH_CONFIRMATION}`,
      'ORGANIC_DASHBOARD_READINESS_REFRESH_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assertOrganicDashboardReadinessCloseoutSummary(summary = {}, windowDays) {
  const expectedWindow = requireWindowDays(windowDays);
  if (summary.ok !== true
    || summary.decision !== 'REPORT_WINDOW_REFRESHED'
    || Number(summary.target?.windowDays) !== expectedWindow
    || summary.target?.operation !== 'refresh'
    || Number(summary.materialization?.d1MaterializationCount) !== 1
    || Number(summary.materialization?.integrity?.metricCount) !== ORGANIC_DASHBOARD_READINESS_METRIC_KEYS.length
    || Number(summary.materialization?.integrity?.mismatchCount) !== 0
    || summary.replay?.sameReportId !== true
    || summary.replay?.samePayloadChecksum !== true
    || Number(summary.replay?.d1MaterializationCount) !== 1
    || Number(summary.replay?.successfulSyncRunCount) < 2
    || summary.replay?.larkRowsUnchanged !== true
    || summary.replay?.integrityUnchanged !== true
    || summary.runtime?.restoredAllFalse !== true
    || summary.runtime?.providerCalls !== 0
    || summary.runtime?.production !== false) {
    throw readinessError(
      `Report closeout summary is not a completed ${expectedWindow}D readiness refresh`,
      'ORGANIC_DASHBOARD_READINESS_CLOSEOUT_INVALID',
      {
        windowDays: expectedWindow,
        decision: summary.decision ?? null,
        metricCount: finiteOrNull(summary.materialization?.integrity?.metricCount),
        mismatchCount: finiteOrNull(summary.materialization?.integrity?.mismatchCount),
        restoredAllFalse: summary.runtime?.restoredAllFalse === true,
      },
    );
  }
  return Object.freeze({
    windowDays: expectedWindow,
    reportId: requireText(summary.target.reportId, 'summary.target.reportId'),
    payloadChecksum: requireText(summary.materialization.payloadChecksum, 'summary.materialization.payloadChecksum'),
    finalWorkerVersion: requireText(summary.runtime.finalWorkerVersion, 'summary.runtime.finalWorkerVersion'),
  });
}

export function assertOrganicDashboardReadinessWindow(input = {}) {
  const windowDays = requireWindowDays(input.windowDays);
  const payload = requireObject(input.payload, 'payload');
  const metricPayload = requireObject(payload.metricPayload, 'payload.metricPayload');
  const rows = requireArray(input.larkRows, 'larkRows');
  const expectedKeys = [...ORGANIC_DASHBOARD_READINESS_METRIC_KEYS].sort();
  const payloadKeys = Object.keys(metricPayload).sort();
  if (stableJson(payloadKeys) !== stableJson(expectedKeys)) throw readinessError(
    'Organic readiness materialization does not contain the exact 17 metric keys',
    'ORGANIC_DASHBOARD_READINESS_METRIC_KEYS_INVALID',
    { windowDays, expectedCount: expectedKeys.length, observedCount: payloadKeys.length },
  );
  if (rows.length !== expectedKeys.length) throw readinessError(
    'Lark Organic readiness metric row count is not 17',
    'ORGANIC_DASHBOARD_READINESS_LARK_ROW_COUNT_INVALID',
    { windowDays, expectedCount: expectedKeys.length, observedCount: rows.length },
  );

  const byKey = new Map();
  for (const raw of rows) {
    const row = requireObject(raw, 'larkRow');
    const metricKey = requireText(row.metricKey ?? row.metric_key, 'larkRow.metricKey');
    if (byKey.has(metricKey)) throw readinessError(
      'Lark Organic readiness metrics contain a duplicate key',
      'ORGANIC_DASHBOARD_READINESS_LARK_DUPLICATE_KEY',
      { windowDays, metricKey },
    );
    byKey.set(metricKey, row);
  }
  if (stableJson([...byKey.keys()].sort()) !== stableJson(expectedKeys)) throw readinessError(
    'D1 and Lark Organic readiness metric key sets differ',
    'ORGANIC_DASHBOARD_READINESS_LARK_KEY_DRIFT',
    { windowDays, expectedCount: expectedKeys.length, observedCount: byKey.size },
  );

  const scopeCounts = { period_delta: 0, current_total: 0, data_quality: 0 };
  const availabilityCounts = {
    available: 0,
    baseline_incomplete: 0,
    source_unavailable: 0,
    not_observed: 0,
  };
  let valueMismatchCount = 0;
  let metadataMismatchCount = 0;
  for (const metricKey of expectedKeys) {
    const expected = requireObject(metricPayload[metricKey], `metricPayload.${metricKey}`);
    const observed = byKey.get(metricKey);
    const expectedScope = expectedScopeForKey(metricKey);
    const expectedCurrent = canonicalNumber(expected.current);
    const observedCurrent = canonicalNumber(observed.currentValue ?? observed.current_value);
    if (expectedCurrent !== observedCurrent) valueMismatchCount += 1;

    const expectedAvailability = requireText(expected.availabilityStatus, `${metricKey}.availabilityStatus`);
    const expectedMessage = requireText(expected.availabilityMessage, `${metricKey}.availabilityMessage`);
    const observedScope = requireText(observed.metricScope ?? observed.metric_scope, `${metricKey}.metricScope`);
    const observedAvailability = requireText(
      observed.availabilityStatus ?? observed.availability_status,
      `${metricKey}.availabilityStatus`,
    );
    const observedMessage = requireText(
      observed.availabilityMessage ?? observed.availability_message,
      `${metricKey}.availabilityMessage`,
    );
    if (expected.metricScope !== expectedScope
      || observedScope !== expectedScope
      || observedAvailability !== expectedAvailability
      || observedMessage !== expectedMessage) metadataMismatchCount += 1;

    scopeCounts[expectedScope] += 1;
    if (!Object.hasOwn(availabilityCounts, expectedAvailability)) throw readinessError(
      'Organic readiness metric has an unsupported availability status',
      'ORGANIC_DASHBOARD_READINESS_AVAILABILITY_INVALID',
      { windowDays, metricKey, availabilityStatus: expectedAvailability },
    );
    availabilityCounts[expectedAvailability] += 1;
  }

  const coverageRate = finiteOrNull(payload.coverageRate);
  const incompleteBaseline = coverageRate !== null && coverageRate < 1;
  if (scopeCounts.period_delta !== 6
    || scopeCounts.current_total !== 6
    || scopeCounts.data_quality !== 5
    || valueMismatchCount !== 0
    || metadataMismatchCount !== 0) {
    throw readinessError(
      'Organic readiness metric values or metadata did not converge',
      'ORGANIC_DASHBOARD_READINESS_PARITY_FAILED',
      { windowDays, scopeCounts, valueMismatchCount, metadataMismatchCount },
    );
  }

  for (const metricKey of CURRENT_TOTAL_KEYS) {
    const metric = metricPayload[metricKey];
    if (!Number.isFinite(Number(metric.current))
      || metric.availabilityStatus !== 'available'
      || metric.availabilityMessage !== 'พร้อมใช้งาน') {
      throw readinessError(
        'Current-total Organic metric is not available after refresh',
        'ORGANIC_DASHBOARD_READINESS_CURRENT_TOTAL_UNAVAILABLE',
        { windowDays, metricKey },
      );
    }
  }
  for (const metricKey of DATA_QUALITY_KEYS) {
    const metric = metricPayload[metricKey];
    if (!Number.isFinite(Number(metric.current)) || metric.availabilityStatus !== 'available') {
      throw readinessError(
        'Data-readiness Organic metric is not available after refresh',
        'ORGANIC_DASHBOARD_READINESS_DATA_QUALITY_UNAVAILABLE',
        { windowDays, metricKey },
      );
    }
  }
  if (incompleteBaseline) {
    for (const metricKey of PERIOD_KEYS) {
      const metric = metricPayload[metricKey];
      if (metric.current !== null
        || metric.availabilityStatus !== 'baseline_incomplete'
        || metric.availabilityMessage !== 'N/A — Baseline ยังไม่ครบ') {
        throw readinessError(
          'Incomplete baseline did not preserve an explicit N/A Period metric',
          'ORGANIC_DASHBOARD_READINESS_PERIOD_SEMANTICS_INVALID',
          { windowDays, metricKey },
        );
      }
    }
  }

  return Object.freeze({
    windowDays,
    metricCount: expectedKeys.length,
    valueMismatchCount,
    metadataMismatchCount,
    scopeCounts: Object.freeze(scopeCounts),
    availabilityCounts: Object.freeze(availabilityCounts),
    incompleteBaseline,
    coverageRate,
  });
}

export function assertOrganicDashboardReadinessSequence(windows = []) {
  const rows = requireArray(windows, 'windows');
  if (rows.length !== ORGANIC_DASHBOARD_READINESS_REFRESH_WINDOWS.length) throw readinessError(
    'Organic Dashboard readiness sequence requires four windows',
    'ORGANIC_DASHBOARD_READINESS_SEQUENCE_INVALID',
    { expectedCount: ORGANIC_DASHBOARD_READINESS_REFRESH_WINDOWS.length, observedCount: rows.length },
  );
  const observedDays = rows.map((row) => Number(row.windowDays));
  if (stableJson(observedDays) !== stableJson(ORGANIC_DASHBOARD_READINESS_REFRESH_WINDOWS)
    || rows.some((row) => row.metricCount !== 17
      || row.valueMismatchCount !== 0
      || row.metadataMismatchCount !== 0
      || row.restoredAllFalse !== true)) {
    throw readinessError(
      'Organic Dashboard readiness sequence did not fully converge',
      'ORGANIC_DASHBOARD_READINESS_SEQUENCE_INVALID',
      { observedDays },
    );
  }
  return true;
}

function expectedScopeForKey(metricKey) {
  if (PERIOD_KEYS.has(metricKey)) return 'period_delta';
  if (CURRENT_TOTAL_KEYS.has(metricKey)) return 'current_total';
  if (DATA_QUALITY_KEYS.has(metricKey)) return 'data_quality';
  throw readinessError(
    'Organic readiness metric key is outside the reviewed scope',
    'ORGANIC_DASHBOARD_READINESS_METRIC_KEYS_INVALID',
    { metricKey },
  );
}

function canonicalNumber(value) {
  const number = finiteOrNull(value);
  if (number === null) return null;
  const canonical = Number(number.toFixed(LARK_DECIMAL_PLACES));
  return Object.is(canonical, -0) ? 0 : canonical;
}
function requireWindowDays(value) {
  const number = Number(value);
  if (!ORGANIC_DASHBOARD_READINESS_REFRESH_WINDOWS.includes(number)) throw readinessError(
    'Organic Dashboard readiness window must be 1, 3, 7 or 30 days',
    'ORGANIC_DASHBOARD_READINESS_WINDOW_INVALID',
    { windowDays: value },
  );
  return number;
}
function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw readinessError(
    'Organic Dashboard readiness metric must be finite or null',
    'ORGANIC_DASHBOARD_READINESS_VALUE_INVALID',
  );
  return number;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw readinessError(`${fieldName} must be an array`, 'ORGANIC_DASHBOARD_READINESS_VALUE_INVALID');
  return value;
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw readinessError(
    `${fieldName} must be an object`,
    'ORGANIC_DASHBOARD_READINESS_VALUE_INVALID',
  );
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw readinessError(
    `${fieldName} is required`,
    'ORGANIC_DASHBOARD_READINESS_VALUE_INVALID',
  );
  return value.trim();
}
function stableJson(value) { return JSON.stringify(value); }
function readinessError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'OrganicDashboardReadinessRefreshError';
  error.code = code;
  error.details = details;
  return error;
}
