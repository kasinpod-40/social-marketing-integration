export const REPORT_CHANNEL_REMOTE_READINESS_CONFIRMATION =
  'RUN_REPORT_CHANNEL_REMOTE_READINESS';
export const REPORT_CHANNEL_REMOTE_READINESS_CONTRACT =
  'report_channel_remote_readiness_reviewed_terminal_v1';
export const REPORT_CHANNEL_REMOTE_READINESS_WINDOWS = Object.freeze([1, 3, 7, 30]);

const WINDOW_ACTIONS = new Set([
  'create_materialization',
  'refresh_or_repair_materialization',
  'reuse_or_idempotent_verify',
]);

export function parseReportChannelReadinessArgs(argv = []) {
  let execute = false;
  let platformScope = null;
  for (const argument of argv) {
    if (argument === '--execute') {
      execute = true;
      continue;
    }
    if (argument.startsWith('--platform=')) {
      platformScope = argument.slice('--platform='.length).trim().toLowerCase();
      continue;
    }
    throw readinessError(
      `Unsupported Report channel readiness argument: ${argument}`,
      'REPORT_CHANNEL_REMOTE_READINESS_ARGUMENT_INVALID',
      { argument },
    );
  }
  return Object.freeze({ execute, platformScope });
}

export function buildReportChannelWindowAssessment(input = {}) {
  const windowDays = positiveInteger(input.windowDays, 'windowDays');
  if (!REPORT_CHANNEL_REMOTE_READINESS_WINDOWS.includes(windowDays)) throw readinessError(
    'Report channel readiness window must be 1/3/7/30',
    'REPORT_CHANNEL_REMOTE_READINESS_WINDOW_INVALID',
    { windowDays },
  );
  const d1 = input.d1 ?? {};
  const lark = input.lark ?? {};
  const d1MaterializationCount = nonNegativeInteger(
    d1.materialization_count ?? input.d1MaterializationCount ?? 0,
    'd1MaterializationCount',
  );
  const larkSnapshotCount = nonNegativeInteger(
    lark.snapshots ?? input.larkSnapshotCount ?? 0,
    'larkSnapshotCount',
  );
  const larkMetricCount = nonNegativeInteger(
    lark.metrics ?? input.larkMetricCount ?? 0,
    'larkMetricCount',
  );
  const larkTopContentCount = nonNegativeInteger(
    lark.topContent ?? input.larkTopContentCount ?? 0,
    'larkTopContentCount',
  );
  const larkTopAdsCount = nonNegativeInteger(
    lark.topAds ?? input.larkTopAdsCount ?? 0,
    'larkTopAdsCount',
  );
  const duplicateMetricKeys = nonNegativeInteger(
    lark.duplicateMetricKeys ?? input.duplicateMetricKeys ?? 0,
    'duplicateMetricKeys',
  );
  const larkRows = larkSnapshotCount + larkMetricCount
    + larkTopContentCount + larkTopAdsCount;
  const integrityOk = input.integrityOk === true;

  let action = null;
  let blocker = null;
  const duplicateIdentity = d1MaterializationCount > 1
    || larkSnapshotCount > 1
    || duplicateMetricKeys > 0;
  if (duplicateIdentity || (d1MaterializationCount === 0 && larkRows > 0)) {
    blocker = Object.freeze({
      code: 'REPORT_CHANNEL_REMOTE_READINESS_WINDOW_PRESTATE_INVALID',
      windowDays,
      d1MaterializationCount,
      larkSnapshotCount,
      duplicateMetricKeys,
      larkRows,
    });
  } else if (d1MaterializationCount === 0 && larkRows === 0) {
    action = 'create_materialization';
  } else if (d1MaterializationCount === 1
    && larkSnapshotCount === 1
    && larkMetricCount > 0
    && integrityOk) {
    action = 'reuse_or_idempotent_verify';
  } else if (d1MaterializationCount === 1) {
    action = 'refresh_or_repair_materialization';
  } else {
    blocker = Object.freeze({
      code: 'REPORT_CHANNEL_REMOTE_READINESS_WINDOW_PRESTATE_INVALID',
      windowDays,
      d1MaterializationCount,
      larkRows,
    });
  }

  return Object.freeze({
    windowDays,
    action,
    ready: WINDOW_ACTIONS.has(action) && blocker === null,
    d1MaterializationCount,
    larkSnapshotCount,
    larkMetricCount,
    larkTopContentCount,
    larkTopAdsCount,
    duplicateMetricKeys,
    integrityOk,
    blocker,
  });
}

export function assessReportChannelRemoteReadiness(input = {}) {
  const repository = input.repository ?? {};
  const runtime = input.runtime ?? {};
  const source = input.source ?? {};
  const lark = input.lark ?? {};
  const windows = Array.isArray(input.windows) ? input.windows : [];
  const blockers = [];

  const repositoryReady = repository.branch === 'main'
    && repository.clean === true
    && isCommitSha(repository.head)
    && repository.head === repository.reviewedHead;
  if (!repositoryReady) blockers.push(blocker('REPORT_CHANNEL_REMOTE_READINESS_REPOSITORY_INVALID'));

  const runtimeReady = runtime.executionBaselineVerified === true
    && ['inactive', 'active'].includes(runtime.notificationRuntimeState)
    && Number.isSafeInteger(Number(runtime.baselineTrueFlagCount))
    && Number(runtime.baselineTrueFlagCount) >= 0
    && Number(runtime.pendingMigrationCount ?? -1) === 0
    && Number(runtime.activeReportWorkCount ?? -1) === 0
    && Number(runtime.activeReportLockCount ?? -1) === 0
    && Number(runtime.openReportDlqCount ?? -1) === 0
    && Number(runtime.openReportCriticalAlertCount ?? -1) === 0;
  if (!runtimeReady) blockers.push(blocker('REPORT_CHANNEL_REMOTE_READINESS_RUNTIME_NOT_SAFE'));

  const sourceReady = source.ready === true
    && typeof source.sourceWatermark === 'string'
    && source.sourceWatermark.trim() !== ''
    && /^\d{4}-\d{2}-\d{2}$/u.test(String(source.watermarkDate ?? ''));
  if (!sourceReady) blockers.push(blocker('REPORT_CHANNEL_REMOTE_READINESS_SOURCE_NOT_READY'));

  const larkReady = lark.tablesReady === true && lark.stableKeysReady === true;
  if (!larkReady) blockers.push(blocker('REPORT_CHANNEL_REMOTE_READINESS_LARK_NOT_READY'));

  const indexed = new Map();
  for (const row of windows) {
    const windowDays = Number(row?.windowDays);
    if (!REPORT_CHANNEL_REMOTE_READINESS_WINDOWS.includes(windowDays)
      || indexed.has(windowDays)
      || row?.ready !== true
      || !WINDOW_ACTIONS.has(row?.action)) {
      blockers.push(blocker('REPORT_CHANNEL_REMOTE_READINESS_WINDOW_INVALID', { windowDays }));
      continue;
    }
    indexed.set(windowDays, row);
    if (row.blocker) blockers.push(row.blocker);
  }
  const windowsReady = REPORT_CHANNEL_REMOTE_READINESS_WINDOWS.every((windowDays) => indexed.has(windowDays));
  if (!windowsReady) blockers.push(blocker('REPORT_CHANNEL_REMOTE_READINESS_WINDOWS_INCOMPLETE'));

  return Object.freeze({
    readyForLive: blockers.length === 0,
    repositoryReady,
    runtimeReady,
    sourceReady,
    larkReady,
    windowsReady,
    windows: Object.freeze(REPORT_CHANNEL_REMOTE_READINESS_WINDOWS
      .map((windowDays) => indexed.get(windowDays))
      .filter(Boolean)
      .map((row) => Object.freeze({
        windowDays: row.windowDays,
        action: row.action,
        ready: row.ready,
      }))),
    blockerCount: blockers.length,
    blockers: Object.freeze(blockers),
  });
}

function blocker(code, details = {}) { return Object.freeze({ code, ...details }); }
function isCommitSha(value) { return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value); }
function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw readinessError(
    `${field} must be a non-negative integer`,
    'REPORT_CHANNEL_REMOTE_READINESS_VALUE_INVALID',
    { field },
  );
  return number;
}
function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw readinessError(
    `${field} must be a positive integer`,
    'REPORT_CHANNEL_REMOTE_READINESS_VALUE_INVALID',
    { field },
  );
  return number;
}
function readinessError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportChannelRemoteReadinessError';
  error.code = code;
  error.details = details;
  return error;
}
