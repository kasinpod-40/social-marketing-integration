export const YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION =
  'RUN_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR';
export const YOUTUBE_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF =
  'YOUTUBE_REPORT_REMOTE_REVIEWED_HANDOFF_V1';

export function parseYouTubeReportRemoteCollectorArgs(argv = []) {
  const allowed = new Set(['--execute']);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) throw collectorError(
    `Unsupported YouTube Report remote collector arguments: ${unknown.join(', ')}`,
    'YOUTUBE_REPORT_REMOTE_COLLECTOR_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertYouTubeReportRemoteCollectorConfirmation(env = {}) {
  if (env.CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR
    !== YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION) {
    throw collectorError(
      `Execution requires CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR=${YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION}`,
      'YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION_REQUIRED',
    );
  }
  if (env.MKT_YOUTUBE_REPORT_REMOTE_INTERNAL_HANDOFF
    !== YOUTUBE_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF) {
    throw collectorError(
      'Direct execution is blocked; use the reviewed YouTube Remote readiness terminal',
      'YOUTUBE_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF_REQUIRED',
    );
  }
  return true;
}

export function assertSelectOnlySql(sql) {
  const text = requireText(sql, 'sql').trim();
  if (!/^(SELECT|WITH)\b/iu.test(text)) throw collectorError(
    'YouTube Report remote collector permits SELECT/WITH statements only',
    'YOUTUBE_REPORT_REMOTE_COLLECTOR_NON_SELECT_BLOCKED',
  );
  if (/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|VACUUM|ATTACH|DETACH)\b/iu.test(text)) {
    throw collectorError(
      'YouTube Report remote collector SQL contains a forbidden mutation token',
      'YOUTUBE_REPORT_REMOTE_COLLECTOR_NON_SELECT_BLOCKED',
    );
  }
  return text;
}

export function parseWranglerJson(value) {
  const text = String(value ?? '').trim();
  const starts = [text.indexOf('{'), text.indexOf('[')]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  for (const start of starts) {
    try { return JSON.parse(text.slice(start)); } catch { /* continue */ }
  }
  throw collectorError(
    'Wrangler output did not contain valid JSON',
    'YOUTUBE_REPORT_REMOTE_COLLECTOR_WRANGLER_JSON_INVALID',
  );
}

export function unwrapD1Rows(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => entry?.results ?? []);
  return Array.isArray(value?.results) ? value.results : [];
}

export function buildYouTubeRemoteReadinessEvidence(input = {}) {
  const catalog = requireObject(input.catalog, 'catalog');
  const worker = requireObject(input.worker, 'worker');
  const runtime = requireObject(input.runtime, 'runtime');
  const source = requireObject(input.source, 'source');
  const lark = requireObject(input.lark, 'lark');
  const windows = requireArray(input.windows, 'windows');

  return Object.freeze({
    target: Object.freeze({
      environment: 'development',
      customerProfile: 'integration_workspace',
      accountKey: 'chemistry_k',
      platformScope: 'youtube',
    }),
    catalog: Object.freeze({
      connectorStatus: optionalText(catalog.connectorStatus),
      jobStatus: optionalText(catalog.jobStatus),
      reportStatus: optionalText(catalog.reportStatus),
      adapterCapability: optionalText(catalog.adapterCapability),
      reportSettingsReady: catalog.reportSettingsReady === true,
    }),
    runtime: Object.freeze({
      allExecutionFlagsFalse: Array.isArray(worker.trueFlags) && worker.trueFlags.length === 0,
      bindingsMatch: worker.bindingsMatch === true,
      activeTrafficPercent: finiteOrZero(worker.activeTrafficPercent),
      pendingMigrationCount: nonNegativeInteger(runtime.pendingMigrationCount, 'pendingMigrationCount'),
      activeReportWorkCount: nonNegativeInteger(runtime.activeReportWorkCount, 'activeReportWorkCount'),
      activeReportLockCount: nonNegativeInteger(runtime.activeReportLockCount, 'activeReportLockCount'),
      openReportDlqCount: nonNegativeInteger(runtime.openReportDlqCount, 'openReportDlqCount'),
      openReportCriticalAlertCount: nonNegativeInteger(
        runtime.openReportCriticalAlertCount,
        'openReportCriticalAlertCount',
      ),
    }),
    source: Object.freeze({
      contentCoverageStatus: normalizeCompletedStatus(source.contentCoverageStatus),
      accountCoverageStatus: normalizeCompletedStatus(source.accountCoverageStatus),
      failureCount: nonNegativeInteger(source.failureCount, 'failureCount'),
      contentEntityCount: nonNegativeInteger(source.contentEntityCount, 'contentEntityCount'),
      contentStateCount: nonNegativeInteger(source.contentStateCount, 'contentStateCount'),
      observationCount: nonNegativeInteger(source.observationCount, 'observationCount'),
      accountFactCount: nonNegativeInteger(source.accountFactCount, 'accountFactCount'),
      watermarkDate: optionalText(source.watermarkDate),
      reportingTimezone: optionalText(source.reportingTimezone),
    }),
    lark: Object.freeze({
      tablesReady: lark.tablesReady === true,
      stableKeysReady: lark.stableKeysReady === true,
      windowFieldId: optionalText(lark.windowFieldId),
      windowOptions: Object.freeze(requireArray(lark.windowOptions, 'lark.windowOptions').map(Number)),
    }),
    windows: Object.freeze(windows.map((row) => Object.freeze({
      windowDays: positiveInteger(row.windowDays, 'windowDays'),
      d1MaterializationCount: nonNegativeInteger(row.d1MaterializationCount, 'd1MaterializationCount'),
      larkSnapshotCount: nonNegativeInteger(row.larkSnapshotCount, 'larkSnapshotCount'),
      d1MetricCount: nonNegativeInteger(row.d1MetricCount, 'd1MetricCount'),
      larkMetricCount: nonNegativeInteger(row.larkMetricCount, 'larkMetricCount'),
      d1TopContentCount: nonNegativeInteger(row.d1TopContentCount, 'd1TopContentCount'),
      larkTopContentCount: nonNegativeInteger(row.larkTopContentCount, 'larkTopContentCount'),
      payloadValid: row.payloadValid === true,
      baselineComplete: row.baselineComplete === true,
      parity: row.parity === true,
    }))),
  });
}

export function sanitizeYouTubeRemoteEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeYouTubeRemoteEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|secret|authorization|table.?id|database.?id|queue.?id|version.?id|uuid|raw)/iu.test(key))
    .map(([key, entry]) => [key, sanitizeYouTubeRemoteEvidence(entry)])));
}

function normalizeCompletedStatus(value) {
  const text = optionalText(value)?.toLowerCase() ?? null;
  if (text === 'complete') return 'completed';
  return text;
}
function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw collectorError(
    `${fieldName} must be a non-negative integer`,
    'YOUTUBE_REPORT_REMOTE_COLLECTOR_COUNT_INVALID',
    { fieldName },
  );
  return number;
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw collectorError(
    `${fieldName} must be a positive integer`,
    'YOUTUBE_REPORT_REMOTE_COLLECTOR_COUNT_INVALID',
    { fieldName },
  );
  return number;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw collectorError(
    `${fieldName} is required`,
    'YOUTUBE_REPORT_REMOTE_COLLECTOR_INPUT_INVALID',
    { fieldName },
  );
  return value.trim();
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw collectorError(
    `${fieldName} must be an object`,
    'YOUTUBE_REPORT_REMOTE_COLLECTOR_INPUT_INVALID',
    { fieldName },
  );
  return value;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw collectorError(
    `${fieldName} must be an array`,
    'YOUTUBE_REPORT_REMOTE_COLLECTOR_INPUT_INVALID',
    { fieldName },
  );
  return value;
}
function collectorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'YouTubeReportRemoteReadinessCollectorError';
  error.code = code;
  error.details = details;
  return error;
}
