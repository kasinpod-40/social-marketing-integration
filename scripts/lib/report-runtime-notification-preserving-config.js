import { createHash } from 'node:crypto';

import {
  buildReportRuntimeCloseoutConfigWindow,
} from './report-runtime-closeout-operator.js';
import {
  REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS,
  loadReportRuntimeFinalizerEnvironment,
} from './report-runtime-finalizer-environment.js';

export const REPORT_RUNTIME_NOTIFICATION_REQUIRED_TABLES = Object.freeze({
  mktAiReportRuns: 'LARK_TABLE_MKT_AI_REPORT_RUNS',
  mktReportSnapshots: 'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  mktReportSettings: 'LARK_TABLE_MKT_REPORT_SETTINGS',
  mktNotificationLog: 'LARK_TABLE_MKT_NOTIFICATION_LOG',
});
const SHARED_REPORT_NOTIFICATION_TABLES = Object.freeze([
  'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  'LARK_TABLE_MKT_REPORT_SETTINGS',
]);

export function buildNotificationPreservingReportRuntimeConfigWindow(
  sourceText,
  options = {},
) {
  const finalizerEvidencePath = requireText(
    options.finalizerEvidencePath
      ?? process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
      ?? 'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
    'finalizerEvidencePath',
  );
  const finalizer = loadReportRuntimeFinalizerEnvironment({
    finalizerEvidencePath,
    ...(options.expectedRepositoryHead
      ? { expectedRepositoryHead: options.expectedRepositoryHead }
      : {}),
  });
  const base = buildReportRuntimeCloseoutConfigWindow(sourceText, {
    ...options,
    finalizerEvidencePath,
    finalizerEnvironment: finalizer.tableEnvironment,
  });
  const notification = finalizer.notificationRuntime;
  if (notification.state === 'inactive') {
    if (base.safeTrueFlags.length !== 0) {
      throw configError(
        'Inactive Notification Runtime requires an all-false Report baseline',
        'REPORT_RUNTIME_NOTIFICATION_BASELINE_INVALID',
      );
    }
    return Object.freeze({
      ...base,
      notificationRuntime: Object.freeze({
        state: 'inactive',
        mode: 'disabled',
        settingCount: 0,
        trueFlags: Object.freeze([]),
      }),
      workerTableIds: base.tableIds,
      workerRequiredTables: Object.freeze({}),
    });
  }

  for (const envName of SHARED_REPORT_NOTIFICATION_TABLES) {
    if (finalizer.tableEnvironment[envName]
      !== notification.tableEnvironment[envName]) {
      throw configError(
        'Report and Notification Runtime authorities disagree on a shared Lark table',
        'REPORT_RUNTIME_NOTIFICATION_SHARED_TABLE_MISMATCH',
        { envName },
      );
    }
  }

  const safe = parseConfig(base.safeText, 'safeText');
  const active = parseConfig(base.activeText, 'activeText');
  for (const config of [safe, active]) {
    config.vars = { ...(config.vars ?? {}) };
    for (const [envName, tableId] of Object.entries(notification.tableEnvironment)) {
      config.vars[envName] = requireText(tableId, envName);
    }
    for (const flag of REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS) {
      config.vars[flag] = 'true';
    }
    config.vars.MKT_NOTIFICATION_RUNTIME_MODE = 'runtime';
  }

  const safeTrueFlags = readTrueFlags(safe);
  const activeTrueFlags = readTrueFlags(active);
  const expectedSafe = [...REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS].sort();
  const expectedActive = [...new Set([
    ...base.activeTrueFlags,
    ...REPORT_RUNTIME_NOTIFICATION_TRUE_FLAGS,
  ])].sort();
  if (stableJson(safeTrueFlags) !== stableJson(expectedSafe)) {
    throw configError(
      'Report baseline does not preserve only the reviewed Notification Runtime flags',
      'REPORT_RUNTIME_NOTIFICATION_BASELINE_INVALID',
      { observedTrueFlagCount: safeTrueFlags.length },
    );
  }
  if (stableJson(activeTrueFlags) !== stableJson(expectedActive)) {
    throw configError(
      'Report Active window differs from Notification baseline plus Report-only flags',
      'REPORT_RUNTIME_NOTIFICATION_ACTIVE_WINDOW_INVALID',
      { observedTrueFlagCount: activeTrueFlags.length },
    );
  }
  for (const config of [safe, active]) {
    if (config.vars.MKT_REPORT_AI_SUMMARY_ENABLED !== 'false'
      || config.vars.MKT_SCHEDULE_DAILY_REPORT_ENABLED !== 'false'
      || config.vars.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED !== 'false') {
      throw configError(
        'Notification-preserving Report window must keep Report AI and schedules false',
        'REPORT_RUNTIME_NOTIFICATION_ACTIVE_WINDOW_INVALID',
      );
    }
  }

  const safeText = `${JSON.stringify(safe, null, 2)}\n`;
  const activeText = `${JSON.stringify(active, null, 2)}\n`;
  const workerTableIds = Object.freeze({
    ...base.tableIds,
    mktAiReportRuns: notification.tableEnvironment.LARK_TABLE_MKT_AI_REPORT_RUNS,
    mktReportSettings: notification.tableEnvironment.LARK_TABLE_MKT_REPORT_SETTINGS,
    mktNotificationLog: notification.tableEnvironment.LARK_TABLE_MKT_NOTIFICATION_LOG,
  });
  return Object.freeze({
    ...base,
    safeText,
    activeText,
    safeSha256: sha256(safeText),
    activeSha256: sha256(activeText),
    safeTrueFlags: Object.freeze(safeTrueFlags),
    activeTrueFlags: Object.freeze(activeTrueFlags),
    falseFlagNames: Object.freeze(base.flagNames.filter(
      (name) => !activeTrueFlags.includes(name),
    )),
    notificationRuntime: Object.freeze({
      state: 'active',
      mode: 'runtime',
      settingCount: notification.settingCount,
      trueFlags: Object.freeze(expectedSafe),
      destinationKeyHash: notification.destinationKeyHash,
      settingKeyFingerprint: notification.settingKeyFingerprint,
    }),
    workerTableIds,
    workerRequiredTables: REPORT_RUNTIME_NOTIFICATION_REQUIRED_TABLES,
  });
}

function parseConfig(value, fieldName) {
  try {
    const parsed = JSON.parse(requireText(value, fieldName));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw configError(
      `${fieldName} is not a generated Wrangler object`,
      'REPORT_RUNTIME_NOTIFICATION_CONFIG_INVALID',
    );
  }
}
function readTrueFlags(config) {
  return Object.entries(config.vars ?? {})
    .filter(([name, value]) => (
      /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
      && (value === true || String(value).trim().toLowerCase() === 'true')
    ))
    .map(([name]) => name)
    .sort();
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw configError(
      `${fieldName} is required`,
      'REPORT_RUNTIME_NOTIFICATION_CONFIG_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}
function stableJson(value) { return JSON.stringify(value); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function configError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeNotificationPreservingConfigError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
