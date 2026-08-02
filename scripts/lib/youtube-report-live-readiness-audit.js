export const YOUTUBE_REPORT_LIVE_READINESS_CONFIRMATION = 'RUN_YOUTUBE_REPORT_READINESS_AUDIT';
export const YOUTUBE_REPORT_WINDOWS = Object.freeze([1, 3, 7, 30]);
export const YOUTUBE_ORGANIC_METRIC_COUNT = 17;
export const YOUTUBE_ACCEPTED_SOURCE_ENTITY_FLOOR = 837;
export const YOUTUBE_REPORT_WINDOW_ACTIONS = Object.freeze({
  CREATE: 'create_materialization',
  REFRESH: 'refresh_or_repair_materialization',
  REUSE: 'reuse_or_idempotent_verify',
  BLOCKED: 'blocked',
});

const EXPECTED_TARGET = Object.freeze({
  environment: 'development',
  customerProfile: 'integration_workspace',
  accountKey: 'chemistry_k',
  platformScope: 'youtube',
});

export function parseYouTubeReportReadinessArgs(argv = []) {
  const allowed = new Set(['--execute']);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) throw auditError(
    `Unsupported YouTube Report readiness arguments: ${unknown.join(', ')}`,
    'YOUTUBE_REPORT_READINESS_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertYouTubeReportReadinessConfirmation(env = {}) {
  if (env.CONFIRM_YOUTUBE_REPORT_READINESS_AUDIT !== YOUTUBE_REPORT_LIVE_READINESS_CONFIRMATION) {
    throw auditError(
      `Execution requires CONFIRM_YOUTUBE_REPORT_READINESS_AUDIT=${YOUTUBE_REPORT_LIVE_READINESS_CONFIRMATION}`,
      'YOUTUBE_REPORT_READINESS_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assessYouTubeReportLiveReadiness(input = {}) {
  const target = requireObject(input.target, 'target');
  assertExactTarget(target);
  const catalog = requireObject(input.catalog, 'catalog');
  const runtime = requireObject(input.runtime, 'runtime');
  const source = requireObject(input.source, 'source');
  const lark = requireObject(input.lark, 'lark');
  const windows = requireArray(input.windows, 'windows');

  const blockers = [];
  collectCatalogBlockers(catalog, blockers);
  collectRuntimeBlockers(runtime, blockers);
  collectSourceBlockers(source, blockers);
  collectLarkBlockers(lark, blockers);

  const indexedWindows = new Map();
  for (const window of windows) {
    const row = requireObject(window, 'windows row');
    const windowDays = requireWindowDays(row.windowDays);
    if (indexedWindows.has(windowDays)) blockers.push(blocker(
      'window_state_duplicate',
      { windowDays },
    ));
    indexedWindows.set(windowDays, row);
  }

  const windowDecisions = YOUTUBE_REPORT_WINDOWS.map((windowDays) => classifyWindow({
    windowDays,
    state: indexedWindows.get(windowDays),
    globalBlocked: blockers.length > 0,
  }));

  for (const windowDays of indexedWindows.keys()) {
    if (!YOUTUBE_REPORT_WINDOWS.includes(windowDays)) blockers.push(blocker(
      'unsupported_window_present',
      { windowDays },
    ));
  }

  const blockedWindowCount = windowDecisions.filter(
    (decision) => decision.action === YOUTUBE_REPORT_WINDOW_ACTIONS.BLOCKED,
  ).length;
  const readyForLive = blockers.length === 0 && blockedWindowCount === 0;

  return Object.freeze({
    contractVersion: 'youtube_report_live_readiness_audit_v1',
    target: Object.freeze({ ...EXPECTED_TARGET }),
    readyForLive,
    sourceReady: !blockers.some((entry) => entry.scope === 'source'),
    runtimeSafe: !blockers.some((entry) => entry.scope === 'runtime'),
    larkReady: !blockers.some((entry) => entry.scope === 'lark'),
    expectedMetricRowsPerWindow: YOUTUBE_ORGANIC_METRIC_COUNT,
    expectedMetricRowsTotal: YOUTUBE_ORGANIC_METRIC_COUNT * YOUTUBE_REPORT_WINDOWS.length,
    acceptedSourceEntityFloor: YOUTUBE_ACCEPTED_SOURCE_ENTITY_FLOOR,
    blockers: Object.freeze(blockers),
    windows: Object.freeze(windowDecisions),
    remoteMutationCount: 0,
    providerRequestCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    production: 'BLOCKED',
  });
}

function collectCatalogBlockers(catalog, blockers) {
  for (const [field, expected] of [
    ['connectorStatus', 'active'],
    ['jobStatus', 'active'],
    ['reportStatus', 'active'],
    ['adapterCapability', 'organic'],
  ]) {
    if (catalog[field] !== expected) blockers.push(blocker(
      'catalog_contract_invalid',
      { field, expected, observed: catalog[field] },
      'catalog',
    ));
  }
  if (catalog.reportSettingsReady !== true) blockers.push(blocker(
    'report_settings_missing',
    {},
    'catalog',
  ));
}

function collectRuntimeBlockers(runtime, blockers) {
  const booleans = [
    ['allExecutionFlagsFalse', 'worker_flags_not_safe'],
    ['bindingsMatch', 'runtime_binding_drift'],
  ];
  for (const [field, code] of booleans) {
    if (runtime[field] !== true) blockers.push(blocker(code, {}, 'runtime'));
  }
  if (Number(runtime.activeTrafficPercent) !== 100) blockers.push(blocker(
    'worker_traffic_not_100_percent',
    { activeTrafficPercent: finiteOrNull(runtime.activeTrafficPercent) },
    'runtime',
  ));
  for (const [field, code] of [
    ['pendingMigrationCount', 'pending_migration'],
    ['activeReportWorkCount', 'active_report_work'],
    ['activeReportLockCount', 'active_report_lock'],
    ['openReportDlqCount', 'open_report_dlq'],
    ['openReportCriticalAlertCount', 'open_report_critical_alert'],
  ]) {
    const count = nonNegativeInteger(runtime[field], field);
    if (count !== 0) blockers.push(blocker(code, { count }, 'runtime'));
  }
}

function collectSourceBlockers(source, blockers) {
  for (const [field, expected] of [
    ['contentCoverageStatus', 'completed'],
    ['accountCoverageStatus', 'completed'],
  ]) {
    if (source[field] !== expected) blockers.push(blocker(
      'coverage_incomplete',
      { field, observed: source[field] },
      'source',
    ));
  }
  const failureCount = nonNegativeInteger(source.failureCount, 'source.failureCount');
  if (failureCount !== 0) blockers.push(blocker('coverage_failure_present', { failureCount }, 'source'));

  const contentEntityCount = nonNegativeInteger(source.contentEntityCount, 'source.contentEntityCount');
  const contentStateCount = nonNegativeInteger(source.contentStateCount, 'source.contentStateCount');
  const observationCount = nonNegativeInteger(source.observationCount, 'source.observationCount');
  if (contentEntityCount < YOUTUBE_ACCEPTED_SOURCE_ENTITY_FLOOR) blockers.push(blocker(
    'accepted_source_entity_regression',
    { contentEntityCount, acceptedFloor: YOUTUBE_ACCEPTED_SOURCE_ENTITY_FLOOR },
    'source',
  ));
  if (new Set([contentEntityCount, contentStateCount, observationCount]).size !== 1) blockers.push(blocker(
    'source_entity_reconciliation_drift',
    { contentEntityCount, contentStateCount, observationCount },
    'source',
  ));
  if (nonNegativeInteger(source.accountFactCount, 'source.accountFactCount') < 1) blockers.push(blocker(
    'account_fact_missing',
    {},
    'source',
  ));
  if (!isDate(source.watermarkDate)) blockers.push(blocker('source_watermark_missing', {}, 'source'));
  if (!isNonEmptyText(source.reportingTimezone)) blockers.push(blocker('reporting_timezone_missing', {}, 'source'));
}

function collectLarkBlockers(lark, blockers) {
  if (lark.tablesReady !== true) blockers.push(blocker('report_tables_missing', {}, 'lark'));
  if (lark.stableKeysReady !== true) blockers.push(blocker('report_stable_keys_missing', {}, 'lark'));
  if (lark.windowFieldId !== 'fldMlTUP3Z') blockers.push(blocker(
    'window_field_identity_drift',
    { observed: lark.windowFieldId ?? null },
    'lark',
  ));
  const options = Array.isArray(lark.windowOptions) ? lark.windowOptions.map(Number) : [];
  if (JSON.stringify(options) !== JSON.stringify(YOUTUBE_REPORT_WINDOWS)) blockers.push(blocker(
    'window_option_order_drift',
    { observed: options },
    'lark',
  ));
}

function classifyWindow({ windowDays, state, globalBlocked }) {
  if (!state) return freezeDecision(windowDays, YOUTUBE_REPORT_WINDOW_ACTIONS.BLOCKED, [
    blocker('window_state_missing', { windowDays }, 'window'),
  ]);

  const localBlockers = [];
  const d1MaterializationCount = nonNegativeInteger(
    state.d1MaterializationCount,
    `windows.${windowDays}.d1MaterializationCount`,
  );
  const larkSnapshotCount = nonNegativeInteger(
    state.larkSnapshotCount,
    `windows.${windowDays}.larkSnapshotCount`,
  );
  const d1MetricCount = nonNegativeInteger(state.d1MetricCount, `windows.${windowDays}.d1MetricCount`);
  const larkMetricCount = nonNegativeInteger(state.larkMetricCount, `windows.${windowDays}.larkMetricCount`);
  const d1TopContentCount = nonNegativeInteger(
    state.d1TopContentCount,
    `windows.${windowDays}.d1TopContentCount`,
  );
  const larkTopContentCount = nonNegativeInteger(
    state.larkTopContentCount,
    `windows.${windowDays}.larkTopContentCount`,
  );

  if (d1MaterializationCount > 1 || larkSnapshotCount > 1) localBlockers.push(blocker(
    'window_identity_duplicate',
    { windowDays, d1MaterializationCount, larkSnapshotCount },
    'window',
  ));
  if (d1MaterializationCount === 0 && larkSnapshotCount > 0) localBlockers.push(blocker(
    'orphan_lark_report_rows',
    { windowDays },
    'window',
  ));
  if (state.payloadValid === false) localBlockers.push(blocker('materialization_payload_invalid', { windowDays }, 'window'));

  let action;
  if (globalBlocked || localBlockers.length > 0) action = YOUTUBE_REPORT_WINDOW_ACTIONS.BLOCKED;
  else if (d1MaterializationCount === 0 && larkSnapshotCount === 0) action = YOUTUBE_REPORT_WINDOW_ACTIONS.CREATE;
  else if (
    d1MaterializationCount === 1
    && larkSnapshotCount === 1
    && d1MetricCount === YOUTUBE_ORGANIC_METRIC_COUNT
    && larkMetricCount === YOUTUBE_ORGANIC_METRIC_COUNT
    && d1TopContentCount === larkTopContentCount
    && state.parity === true
  ) action = YOUTUBE_REPORT_WINDOW_ACTIONS.REUSE;
  else action = YOUTUBE_REPORT_WINDOW_ACTIONS.REFRESH;

  return freezeDecision(windowDays, action, localBlockers, {
    baselineComplete: state.baselineComplete === true,
    d1MaterializationCount,
    larkSnapshotCount,
    d1MetricCount,
    larkMetricCount,
    d1TopContentCount,
    larkTopContentCount,
    parity: state.parity === true,
  });
}

function freezeDecision(windowDays, action, blockers, extra = {}) {
  return Object.freeze({
    windowDays,
    action,
    blockers: Object.freeze(blockers),
    ...extra,
  });
}

function assertExactTarget(target) {
  for (const [field, expected] of Object.entries(EXPECTED_TARGET)) {
    if (target[field] !== expected) throw auditError(
      `YouTube Report readiness target ${field} must equal ${expected}`,
      'YOUTUBE_REPORT_READINESS_TARGET_INVALID',
      { field, expected, observed: target[field] ?? null },
    );
  }
}

function requireWindowDays(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw auditError(
    'YouTube Report readiness windowDays must be a positive integer',
    'YOUTUBE_REPORT_READINESS_WINDOW_INVALID',
    { value },
  );
  return number;
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw auditError(
    `${field} must be a non-negative integer`,
    'YOUTUBE_REPORT_READINESS_COUNT_INVALID',
    { field },
  );
  return number;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function blocker(code, details = {}, scope = 'general') {
  return Object.freeze({ code, scope, details: Object.freeze({ ...details }) });
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw auditError(
    `${field} must be an object`,
    'YOUTUBE_REPORT_READINESS_INPUT_INVALID',
    { field },
  );
  return value;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) throw auditError(
    `${field} must be an array`,
    'YOUTUBE_REPORT_READINESS_INPUT_INVALID',
    { field },
  );
  return value;
}

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isDate(value) {
  return isNonEmptyText(value) && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function auditError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'YouTubeReportReadinessAuditError';
  error.code = code;
  error.details = details;
  return error;
}
