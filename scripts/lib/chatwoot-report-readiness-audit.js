export const CHATWOOT_REPORT_READINESS_CONFIRMATION = 'RUN_CHATWOOT_REPORT_READINESS_AUDIT';
export const CHATWOOT_REPORT_READINESS_WINDOWS = Object.freeze([1, 3, 7, 30]);
export const CHATWOOT_REPORT_EXPECTED_METRIC_COUNT = 139;
export const CHATWOOT_ACCEPTED_UAT_MARKER = 'CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE';
export const CHATWOOT_ACCEPTED_SOURCE_FACTS = Object.freeze({
  conversations: 65,
  messages: 2071,
  retainedDlq: 9,
  retainedAlerts: 15,
});
export const CHATWOOT_REPORT_WINDOW_ACTIONS = Object.freeze({
  CREATE: 'create_materialization',
  REFRESH: 'refresh_or_repair_materialization',
  REUSE: 'reuse_or_idempotent_verify',
  BLOCKED: 'blocked',
});

const EXPECTED_TARGET = Object.freeze({
  environment: 'development',
  customerProfile: 'integration_workspace',
  accountKey: 'chemistry_k',
  platformScope: 'chatwoot',
});
const VALID_DATA_STATUSES = new Set(['complete', 'no_data_confirmed']);

export function parseChatwootReportReadinessArgs(argv = []) {
  const allowed = new Set(['--execute']);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) throw auditError(
    `Unsupported Chatwoot Report readiness arguments: ${unknown.join(', ')}`,
    'CHATWOOT_REPORT_READINESS_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertChatwootReportReadinessConfirmation(env = {}) {
  if (env.CONFIRM_CHATWOOT_REPORT_READINESS_AUDIT !== CHATWOOT_REPORT_READINESS_CONFIRMATION) {
    throw auditError(
      `Execution requires CONFIRM_CHATWOOT_REPORT_READINESS_AUDIT=${CHATWOOT_REPORT_READINESS_CONFIRMATION}`,
      'CHATWOOT_REPORT_READINESS_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assessChatwootReportReadiness(input = {}) {
  const target = requireObject(input.target, 'target');
  assertExactTarget(target);
  const repository = requireObject(input.repository, 'repository');
  const runtime = requireObject(input.runtime, 'runtime');
  const catalog = requireObject(input.catalog, 'catalog');
  const source = requireObject(input.source, 'source');
  const report = requireObject(input.report, 'report');
  const incidents = requireObject(input.incidents, 'incidents');
  const windowsInput = requireArray(input.windows, 'windows');

  const blockers = [];
  const warnings = [];
  collectRepository(repository, blockers);
  collectRuntime(runtime, blockers);
  collectCatalog(catalog, blockers);
  collectSource(source, blockers);
  collectReport(report, blockers);
  collectIncidents(incidents, blockers);

  const unsupported = windowsInput
    .map((entry) => Number(entry?.windowDays))
    .filter((windowDays) => !CHATWOOT_REPORT_READINESS_WINDOWS.includes(windowDays));
  if (unsupported.length > 0) blockers.push(blocker(
    'unsupported_window_present',
    'report',
    { windowDays: Object.freeze([...new Set(unsupported)].sort((a, b) => a - b)) },
  ));

  const windows = CHATWOOT_REPORT_READINESS_WINDOWS.map((windowDays) => assessWindow(
    windowDays,
    windowsInput.find((entry) => Number(entry?.windowDays) === windowDays) ?? {},
    blockers,
    warnings,
  ));
  const globalBlock = blockers.some((entry) => entry.scope !== 'window')
    || blockers.some((entry) => entry.code === 'unsupported_window_present');
  const finalWindows = globalBlock
    ? windows.map((window) => Object.freeze({
      ...window,
      action: CHATWOOT_REPORT_WINDOW_ACTIONS.BLOCKED,
    }))
    : windows;
  const promotionReady = blockers.length === 0;

  return Object.freeze({
    contractVersion: 'chatwoot_report_readiness_audit_v1',
    target: Object.freeze({ ...EXPECTED_TARGET }),
    repository: Object.freeze({
      branch: optionalText(repository.branch),
      head: optionalText(repository.head),
      reviewedHead: optionalText(repository.reviewedHead),
      clean: repository.clean === true,
    }),
    promotionReady,
    nextGate: promotionReady ? 'catalog_promotion_ready' : nextGate(blockers),
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    windows: Object.freeze(finalWindows),
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    catalogPromotionAuthorized: false,
    liveMaterializationAuthorized: false,
    production: 'BLOCKED',
  });
}

export function sanitizeChatwootReadinessEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeChatwootReadinessEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|secret|authorization|cookie|password|table.?id|database.?id|queue.?id|version.?id|uuid|raw|external.?account)/iu.test(key))
    .map(([key, entry]) => [key, sanitizeChatwootReadinessEvidence(entry)])));
}

function collectRepository(repository, blockers) {
  const branch = optionalText(repository.branch);
  const head = optionalText(repository.head);
  const reviewedHead = optionalText(repository.reviewedHead);
  if (branch !== 'main') blockers.push(blocker('repository_branch_not_main', 'repository', { observed: branch }));
  if (repository.clean !== true) blockers.push(blocker('repository_not_clean', 'repository'));
  if (!isCommitSha(head) || !isCommitSha(reviewedHead)) blockers.push(blocker(
    'repository_head_invalid',
    'repository',
    { headPresent: isCommitSha(head), reviewedHeadPresent: isCommitSha(reviewedHead) },
  ));
  else if (head !== reviewedHead) blockers.push(blocker(
    'repository_head_not_reviewed',
    'repository',
    { head, reviewedHead },
  ));
}

function collectRuntime(runtime, blockers) {
  if (runtime.allExecutionFlagsFalse !== true) blockers.push(blocker('worker_flags_not_safe', 'runtime'));
  if (runtime.bindingsMatch !== true) blockers.push(blocker('runtime_binding_drift', 'runtime'));
  if (Number(runtime.activeTrafficPercent) !== 100) blockers.push(blocker(
    'worker_traffic_not_100_percent',
    'runtime',
    { activeTrafficPercent: finiteOrNull(runtime.activeTrafficPercent) },
  ));
  for (const [field, code] of [
    ['pendingMigrationCount', 'pending_migration'],
    ['activeTargetWorkCount', 'active_work_or_lock'],
    ['activeTargetLockCount', 'active_work_or_lock'],
  ]) {
    const count = nonNegativeInteger(runtime[field], `runtime.${field}`);
    if (count !== 0) blockers.push(blocker(code, 'runtime', { field, count }));
  }
}

function collectCatalog(catalog, blockers) {
  for (const field of ['connectorStatus', 'jobStatus', 'reportStatus']) {
    if (catalog[field] !== 'uat_pending') blockers.push(blocker(
      'catalog_status_unexpected',
      'catalog',
      { field, expected: 'uat_pending', observed: catalog[field] ?? null },
    ));
  }
  if (catalog.adapterRegistered !== true) blockers.push(blocker('report_contract_missing', 'catalog'));
  if (catalog.readerRegistered !== true) blockers.push(blocker('source_reader_missing', 'catalog'));
}

function collectSource(source, blockers) {
  if (source.acceptedUatMarker !== CHATWOOT_ACCEPTED_UAT_MARKER) blockers.push(blocker(
    'accepted_uat_evidence_missing',
    'source',
  ));
  if (!isCommitSha(source.acceptedUatRepositoryHead)) blockers.push(blocker(
    'accepted_uat_head_invalid',
    'source',
  ));
  for (const field of [
    'initial30DayVerified',
    'initialReplayVerified',
    'daily3DayVerified',
    'dailyReplayVerified',
    'restoredAllFlagsFalse',
    'coverageComplete',
    'factsPresent',
    'larkParityComplete',
    'dateRangeSufficient',
  ]) {
    if (source[field] !== true) blockers.push(blocker('source_uat_pending', 'source', { field }));
  }
  if (source.scheduleEnabled !== false || source.webhookEnabled !== false) blockers.push(blocker(
    'source_schedule_or_webhook_enabled',
    'source',
  ));
  if (nonNegativeInteger(source.coverageFailureCount, 'source.coverageFailureCount') !== 0) {
    blockers.push(blocker('coverage_incomplete', 'source'));
  }
  if (nonNegativeInteger(source.conversationCount, 'source.conversationCount')
    !== CHATWOOT_ACCEPTED_SOURCE_FACTS.conversations) blockers.push(blocker(
    'accepted_source_fact_drift',
    'source',
    { fact: 'conversations', expected: CHATWOOT_ACCEPTED_SOURCE_FACTS.conversations, observed: source.conversationCount },
  ));
  if (nonNegativeInteger(source.messageCount, 'source.messageCount')
    !== CHATWOOT_ACCEPTED_SOURCE_FACTS.messages) blockers.push(blocker(
    'accepted_source_fact_drift',
    'source',
    { fact: 'messages', expected: CHATWOOT_ACCEPTED_SOURCE_FACTS.messages, observed: source.messageCount },
  ));
  if (source.reportingTimezone !== 'Asia/Bangkok') blockers.push(blocker(
    'reporting_timezone_drift',
    'source',
    { observed: source.reportingTimezone ?? null },
  ));
}

function collectReport(report, blockers) {
  if (report.settingsReady !== true) blockers.push(blocker('report_settings_missing', 'report'));
  if (report.materializerCompatible !== true) blockers.push(blocker('report_contract_missing', 'report'));
  if (report.larkWriterCompatible !== true) blockers.push(blocker('report_lark_contract_missing', 'report'));
  if (report.tablesReady !== true) blockers.push(blocker('report_lark_tables_missing', 'report'));
  if (report.stableKeysReady !== true) blockers.push(blocker('report_lark_stable_keys_missing', 'report'));
  if (report.nullZeroSemanticsVerified !== true) blockers.push(blocker('report_null_zero_contract_pending', 'report'));
  if (report.weightedDurationVerified !== true) blockers.push(blocker('weighted_duration_contract_pending', 'report'));
  const previewWindows = Array.isArray(report.previewWindows) ? report.previewWindows.map(Number) : [];
  if (JSON.stringify(previewWindows) !== JSON.stringify(CHATWOOT_REPORT_READINESS_WINDOWS)) blockers.push(blocker(
    'report_preview_incomplete',
    'report',
    { observed: previewWindows },
  ));
}

function collectIncidents(incidents, blockers) {
  if (incidents.acceptedForensicTruth !== true) blockers.push(blocker('accepted_incident_boundary_missing', 'incident'));
  const dlq = nonNegativeInteger(incidents.retainedDlqCount, 'incidents.retainedDlqCount');
  const alerts = nonNegativeInteger(incidents.retainedAlertCount, 'incidents.retainedAlertCount');
  if (dlq !== CHATWOOT_ACCEPTED_SOURCE_FACTS.retainedDlq
    || alerts !== CHATWOOT_ACCEPTED_SOURCE_FACTS.retainedAlerts) blockers.push(blocker(
    'retained_incident_drift',
    'incident',
    {
      expectedDlq: CHATWOOT_ACCEPTED_SOURCE_FACTS.retainedDlq,
      observedDlq: dlq,
      expectedAlerts: CHATWOOT_ACCEPTED_SOURCE_FACTS.retainedAlerts,
      observedAlerts: alerts,
    },
  ));
  if (nonNegativeInteger(incidents.incidentMutationCount, 'incidents.incidentMutationCount') !== 0) {
    blockers.push(blocker('incident_mutation_not_authorized', 'incident'));
  }
}

function assessWindow(windowDays, input, blockers, warnings) {
  const d1Count = nonNegativeInteger(input.d1MaterializationCount ?? 0, `windows.${windowDays}.d1MaterializationCount`);
  const payloadMetricCount = nonNegativeInteger(input.d1MetricCount ?? 0, `windows.${windowDays}.d1MetricCount`);
  const larkSnapshotCount = nonNegativeInteger(input.larkSnapshotCount ?? 0, `windows.${windowDays}.larkSnapshotCount`);
  const larkMetricCount = nonNegativeInteger(input.larkMetricCount ?? 0, `windows.${windowDays}.larkMetricCount`);
  const duplicateMetricKeys = nonNegativeInteger(input.duplicateMetricKeys ?? 0, `windows.${windowDays}.duplicateMetricKeys`);
  const dataStatus = optionalText(input.dataStatus);

  if (d1Count === 0 && larkSnapshotCount === 0 && larkMetricCount === 0) return Object.freeze({
    windowDays,
    state: 'missing',
    action: CHATWOOT_REPORT_WINDOW_ACTIONS.CREATE,
    expectedMetricCount: CHATWOOT_REPORT_EXPECTED_METRIC_COUNT,
  });
  if (d1Count === 0 && (larkSnapshotCount > 0 || larkMetricCount > 0)) {
    blockers.push(blocker('lark_orphan_report_rows', 'window', { windowDays, larkSnapshotCount, larkMetricCount }));
    return Object.freeze({ windowDays, state: 'blocked_orphan_lark', action: CHATWOOT_REPORT_WINDOW_ACTIONS.BLOCKED });
  }
  if (d1Count !== 1) blockers.push(blocker('d1_report_identity_count_invalid', 'window', { windowDays, d1Count }));
  if (duplicateMetricKeys !== 0 || larkSnapshotCount > 1) blockers.push(blocker(
    'lark_duplicate_report_rows',
    'window',
    { windowDays, duplicateMetricKeys, larkSnapshotCount },
  ));
  if (d1Count === 1 && !VALID_DATA_STATUSES.has(String(dataStatus))) blockers.push(blocker(
    'd1_report_data_status_invalid',
    'window',
    { windowDays, dataStatus },
  ));

  const exact = d1Count === 1
    && payloadMetricCount === CHATWOOT_REPORT_EXPECTED_METRIC_COUNT
    && larkSnapshotCount === 1
    && larkMetricCount === CHATWOOT_REPORT_EXPECTED_METRIC_COUNT
    && duplicateMetricKeys === 0
    && input.parity === true;
  if (exact) return Object.freeze({
    windowDays,
    state: 'ready_reusable',
    action: CHATWOOT_REPORT_WINDOW_ACTIONS.REUSE,
    metricCount: payloadMetricCount,
    parity: true,
  });
  if (d1Count === 1 && duplicateMetricKeys === 0 && larkSnapshotCount <= 1) {
    warnings.push(Object.freeze({
      code: 'window_requires_controlled_refresh',
      windowDays,
      payloadMetricCount,
      larkMetricCount,
      parity: input.parity === true,
    }));
    return Object.freeze({
      windowDays,
      state: 'refresh_required',
      action: CHATWOOT_REPORT_WINDOW_ACTIONS.REFRESH,
      payloadMetricCount,
      larkMetricCount,
      parity: input.parity === true,
    });
  }
  return Object.freeze({
    windowDays,
    state: 'blocked',
    action: CHATWOOT_REPORT_WINDOW_ACTIONS.BLOCKED,
    payloadMetricCount,
    larkMetricCount,
    parity: input.parity === true,
  });
}

function nextGate(blockers) {
  const priority = [
    'repository_head_not_reviewed',
    'active_work_or_lock',
    'retained_incident_drift',
    'accepted_uat_evidence_missing',
    'source_uat_pending',
    'accepted_source_fact_drift',
    'coverage_incomplete',
    'source_reader_missing',
    'report_settings_missing',
  ];
  return priority.find((code) => blockers.some((entry) => entry.code === code))
    ?? blockers[0]?.code
    ?? 'catalog_promotion_ready';
}

function assertExactTarget(target) {
  for (const [field, expected] of Object.entries(EXPECTED_TARGET)) {
    if (target[field] !== expected) throw auditError(
      `Chatwoot Report readiness target ${field} must equal ${expected}`,
      'CHATWOOT_REPORT_READINESS_TARGET_INVALID',
      { field, expected, observed: target[field] ?? null },
    );
  }
}
function blocker(code, scope, details = {}) {
  return Object.freeze({ code, scope, details: Object.freeze({ ...details }) });
}
function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw auditError(
    `${field} must be a non-negative integer`,
    'CHATWOOT_REPORT_READINESS_COUNT_INVALID',
    { field },
  );
  return number;
}
function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function isCommitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
}
function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw auditError(
    `${field} must be an object`,
    'CHATWOOT_REPORT_READINESS_INPUT_INVALID',
    { field },
  );
  return value;
}
function requireArray(value, field) {
  if (!Array.isArray(value)) throw auditError(
    `${field} must be an array`,
    'CHATWOOT_REPORT_READINESS_INPUT_INVALID',
    { field },
  );
  return value;
}
function auditError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootReportReadinessAuditError';
  error.code = code;
  error.details = details;
  return error;
}
