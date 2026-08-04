import { createHash } from 'node:crypto';
import { buildDashboardPresetJob } from '../../packages/application/src/reports/dashboard-report-request.js';
import { resolveReportPeriod } from '../../packages/application/src/reports/report-period.js';
import { createReportId } from '../../packages/application/src/storage/marketing-history-contract.js';
import {
  DASHBOARD_REPORT_PLATFORM_SCOPES,
  DASHBOARD_REPORT_PRESET_DAYS,
} from '../../packages/config/src/report-settings.seed.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

export const REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION = 'report_runtime_closeout_uat_v1';
export const REPORT_RUNTIME_CLOSEOUT_CONFIRMATION = 'EXECUTE_REPORT_RUNTIME_CLOSEOUT';
export const WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_CONFIRMATION =
  'EXECUTE_WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT';
export const REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS = Object.freeze([
  'MKT_REPORT_D1_READ_ENABLED',
  'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
]);
export const WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS = Object.freeze([
  ...REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  'MKT_WOOCOMMERCE_REPORT_READ_ENABLED',
]);
export const REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS = DASHBOARD_REPORT_PRESET_DAYS;
export const REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT = 2
  + (DASHBOARD_REPORT_PLATFORM_SCOPES.length * (DASHBOARD_REPORT_PRESET_DAYS.length + 1));
export const REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES = Object.freeze({
  mktReportSnapshots: 'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  mktReportMetricValues: 'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
  mktReportTopContent: 'LARK_TABLE_MKT_REPORT_TOP_CONTENT',
  mktReportTopAds: 'LARK_TABLE_MKT_REPORT_TOP_ADS',
  mktSyncLog: 'LARK_TABLE_MKT_SYNC_LOG',
  mktSystemAlerts: 'LARK_TABLE_MKT_SYSTEM_ALERTS',
});

const EXPECTED_WORKER_NAME = 'social-mkt-sync-worker';
const EXPECTED_DATABASE_NAME = 'social-mkt-state-dev';
const EXPECTED_MAIN_QUEUE = 'social-mkt-sync-jobs';
const EXPECTED_DLQ = 'social-mkt-sync-dlq';
const EXPECTED_CRONS = Object.freeze(['*/5 * * * *', '50 0,6,12,18 * * *']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseReportRuntimeCloseoutArgs(argv = []) {
  const unknown = argv.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) throw closeoutError(
    `Unsupported Report closeout arguments: ${unknown.join(', ')}`,
    'REPORT_RUNTIME_CLOSEOUT_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertReportRuntimeCloseoutConfirmation(env = {}) {
  if (env.CONFIRM_REPORT_RUNTIME_CLOSEOUT !== REPORT_RUNTIME_CLOSEOUT_CONFIRMATION) {
    throw closeoutError(
      `Execution requires CONFIRM_REPORT_RUNTIME_CLOSEOUT=${REPORT_RUNTIME_CLOSEOUT_CONFIRMATION}`,
      'REPORT_RUNTIME_CLOSEOUT_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assertWooCommerceReportRuntimeCloseoutConfirmation(env = {}) {
  if (env.CONFIRM_WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT
    !== WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_CONFIRMATION) {
    throw closeoutError(
      `Execution requires CONFIRM_WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT=${WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_CONFIRMATION}`,
      'WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function resolveReportRuntimeCloseoutTarget(env = {}) {
  const platformScope = String(env.MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE ?? 'tiktok')
    .trim()
    .toLowerCase();
  if (platformScope === 'tiktok') return Object.freeze({
    platformScope,
    accountKey: 'chemistry_k',
    formulaVersion: 'tiktok-organic-v1',
    capability: 'organic',
    activeTrueFlags: REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
    outputDirectory: 'outputs/report-runtime-closeout',
  });
  if (platformScope === 'woocommerce') return Object.freeze({
    platformScope,
    accountKey: 'chemistry_k',
    formulaVersion: 'woocommerce-commerce-v1',
    capability: 'commerce',
    activeTrueFlags: WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
    outputDirectory: 'outputs/woocommerce-report-runtime-closeout',
  });
  throw closeoutError(
    `Unsupported Report closeout platform scope: ${platformScope}`,
    'REPORT_RUNTIME_CLOSEOUT_PLATFORM_UNSUPPORTED',
    { platformScope },
  );
}

export function assertReportRuntimeFinalizerEvidence(value = {}) {
  const gates = Array.isArray(value.gates) ? value.gates : [];
  const allGatesPassed = gates.length >= 6 && gates.every((gate) => gate?.status === 'pass');
  if (value.ok !== true
    || value.contractVersion !== 'report_runtime_finalize_v1'
    || value.repository?.branch !== 'main'
    || value.repository?.clean !== true
    || !allGatesPassed
    || Number(value.schema?.readbackActions ?? -1) !== 0
    || Number(value.schema?.conflicts ?? -1) !== 0
    || Number(value.settings?.canonicalActive ?? -1) !== REPORT_RUNTIME_CLOSEOUT_CANONICAL_SETTING_COUNT
    || Number(value.settings?.activeLegacySettings ?? -1) !== 0
    || Number(value.settings?.readbackCreates ?? -1) !== 0
    || Number(value.settings?.readbackUpdates ?? -1) !== 0
    || value.runtime?.reportD1ReadEnabled !== false
    || value.runtime?.presetMaterializationEnabled !== false
    || value.runtime?.aiSummaryEnabled !== false
    || value.runtime?.schedulesEnabled !== false) {
    throw closeoutError(
      'Report Schema/Settings finalizer evidence is incomplete or not safe-closed',
      'REPORT_RUNTIME_CLOSEOUT_FINALIZER_EVIDENCE_INVALID',
    );
  }
  return true;
}

export function buildReportRuntimeCloseoutConfigWindow(sourceText, options = {}) {
  const source = parseJsoncObject(requireText(sourceText, 'sourceText'));
  const reviewedActiveTrueFlags = normalizeActiveTrueFlags(
    options.activeTrueFlags ?? REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  );
  if (source.name !== EXPECTED_WORKER_NAME
    || source.workers_dev !== false
    || source.vars?.MKT_ENV !== 'development'
    || source.vars?.MKT_CUSTOMER_PROFILE !== 'integration_workspace') {
    throw closeoutError(
      'Report closeout requires the reviewed Integration Workspace Sync Worker config',
      'REPORT_RUNTIME_CLOSEOUT_CONFIG_TARGET_INVALID',
    );
  }
  const flagNames = Object.keys(source.vars ?? {})
    .filter((name) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name))
    .sort();
  for (const required of [
    ...reviewedActiveTrueFlags,
    'MKT_REPORT_AI_SUMMARY_ENABLED',
    'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
    'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
  ]) {
    if (!flagNames.includes(required)) throw closeoutError(
      `Report closeout config lacks ${required}`,
      'REPORT_RUNTIME_CLOSEOUT_CONFIG_FLAG_MISSING',
      { flag: required },
    );
  }

  const safe = structuredClone(source);
  safe.workers_dev = false;
  safe.vars = { ...safe.vars, ...Object.fromEntries(flagNames.map((name) => [name, 'false'])) };
  const active = structuredClone(safe);
  for (const name of reviewedActiveTrueFlags) active.vars[name] = 'true';

  const safeTrueFlags = readTrueFlags(safe);
  const activeTrueFlags = readTrueFlags(active);
  if (safeTrueFlags.length !== 0) throw closeoutError(
    'Report closeout Safe config contains an enabled execution flag',
    'REPORT_RUNTIME_CLOSEOUT_SAFE_FLAG_INVALID',
  );
  if (stableJson(activeTrueFlags) !== stableJson(reviewedActiveTrueFlags)) {
    throw closeoutError(
      'Report closeout Active config contains an unapproved execution flag',
      'REPORT_RUNTIME_CLOSEOUT_ACTIVE_FLAG_INVALID',
      { activeTrueFlags: readTrueFlags(active) },
    );
  }
  if (active.vars.MKT_REPORT_AI_SUMMARY_ENABLED !== 'false'
    || active.vars.MKT_SCHEDULE_DAILY_REPORT_ENABLED !== 'false'
    || active.vars.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED !== 'false') {
    throw closeoutError(
      'Report closeout must keep AI and Report schedules disabled',
      'REPORT_RUNTIME_CLOSEOUT_AI_OR_SCHEDULE_ENABLED',
    );
  }

  const d1 = exactlyOne(source.d1_databases, (item) => item?.binding === 'MKT_STATE_DB', 'MKT_STATE_DB');
  const producer = exactlyOne(
    source.queues?.producers,
    (item) => item?.binding === 'MKT_SYNC_QUEUE' && item?.queue === EXPECTED_MAIN_QUEUE,
    'MKT_SYNC_QUEUE',
  );
  const consumers = Array.isArray(source.queues?.consumers) ? source.queues.consumers : [];
  const mainConsumer = exactlyOne(consumers, (item) => item?.queue === EXPECTED_MAIN_QUEUE, EXPECTED_MAIN_QUEUE);
  const dlqConsumer = exactlyOne(consumers, (item) => item?.queue === EXPECTED_DLQ, EXPECTED_DLQ);
  assertQueueSettings(mainConsumer, {
    max_concurrency: 1,
    max_batch_size: 10,
    max_batch_timeout: 30,
    max_retries: 5,
    dead_letter_queue: EXPECTED_DLQ,
  });
  assertQueueSettings(dlqConsumer, {
    max_concurrency: 1,
    max_batch_size: 10,
    max_batch_timeout: 30,
    max_retries: 10,
  });
  const crons = [...(source.triggers?.crons ?? [])].sort();
  if (stableJson(crons) !== stableJson([...EXPECTED_CRONS].sort())) throw closeoutError(
    'Report closeout Cron topology differs from the reviewed shared Worker contract',
    'REPORT_RUNTIME_CLOSEOUT_CRON_TOPOLOGY_INVALID',
    { crons },
  );

  const tableIds = Object.freeze(Object.fromEntries(
    Object.entries(REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES)
      .map(([key, envName]) => [key, requireRealMapping(source.vars?.[envName], envName)]),
  ));
  const safeText = `${JSON.stringify(safe, null, 2)}\n`;
  const activeText = `${JSON.stringify(active, null, 2)}\n`;
  return Object.freeze({
    safeText,
    activeText,
    safeSha256: sha256(safeText),
    activeSha256: sha256(activeText),
    safeTrueFlags: Object.freeze(safeTrueFlags),
    activeTrueFlags: Object.freeze(readTrueFlags(active)),
    falseFlagNames: Object.freeze(flagNames.filter((name) => !activeTrueFlags.includes(name))),
    tableIds,
    tableIdFingerprint: sha256(stableJson(tableIds)),
    databaseName: requireExact(d1.database_name, EXPECTED_DATABASE_NAME, 'database_name'),
    databaseId: requireUuid(d1.database_id, 'database_id'),
    mainQueueName: producer.queue,
    dlqName: EXPECTED_DLQ,
    flagNames: Object.freeze(flagNames),
    bindingFingerprint: sha256(stableJson({
      d1: { binding: d1.binding, databaseName: d1.database_name, databaseId: d1.database_id },
      queues: source.queues,
      crons,
      workersDev: source.workers_dev,
    })),
  });
}

export function buildReportRuntimeCloseoutCandidates(input = {}) {
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const periodEnd = requireDate(input.periodEnd, 'periodEnd');
  const sourceWatermark = requireText(input.sourceWatermark, 'sourceWatermark');
  const timeZone = requireText(input.timeZone ?? 'Asia/Bangkok', 'timeZone');
  const platformScope = requireDashboardPlatformScope(input.platformScope ?? 'tiktok');
  const accountKey = requireText(input.accountKey ?? 'chemistry_k', 'accountKey');
  const formulaVersion = requireText(input.formulaVersion ?? formulaVersionFor(platformScope), 'formulaVersion');
  const days = DASHBOARD_REPORT_PRESET_DAYS;
  const candidates = days.map((windowDays) => {
    const period = resolveReportPeriod({
      periodKind: 'rolling_days',
      windowDays,
      periodEnd,
      comparisonMode: 'previous_period',
      timeZone,
    });
    const reportSettingKey = `integration_workspace:${platformScope}:rolling:${windowDays}d`;
    return Object.freeze({
      windowDays,
      reportSettingKey,
      reportId: createReportId({
        customerKey: 'chemistry_k',
        accountKey,
        platformScope,
        reportSettingKey,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        formulaVersion,
        sourceWatermark,
      }),
      period,
      job: buildDashboardPresetJob({
        requestedAt,
        customerKey: 'chemistry_k',
        accountKey,
        platformScope,
        reportSettingKey,
        windowDays,
        periodEnd,
        sourceWatermark,
        timeZone,
      }),
    });
  });
  return Object.freeze(candidates);
}

export function assertReportRuntimeCloseoutCompletion(value = {}, expected = {}) {
  if (value.reportId !== expected.reportId
    || value.dataStatus === 'source_unavailable'
    || value.dataStatus === 'partial'
    || !isSha256(value.payloadChecksum)
    || Number(value.materializationCount ?? 0) !== 1
    || value.syncStatus !== 'success'
    || Number(value.activeLockCount ?? -1) !== 0
    || Number(value.newDlqCount ?? -1) !== 0) throw closeoutError(
    'Report closeout did not complete with one eligible materialization',
    'REPORT_RUNTIME_CLOSEOUT_COMPLETION_INVALID',
    { expectedReportId: expected.reportId, observedReportId: value.reportId ?? null },
  );
  return true;
}

export function assertReportRuntimeCloseoutReplay(before = {}, after = {}) {
  if (before.reportId !== after.reportId
    || before.payloadChecksum !== after.payloadChecksum
    || before.dataStatus !== after.dataStatus
    || Number(after.materializationCount ?? 0) !== 1
    || Number(after.activeLockCount ?? -1) !== 0
    || Number(after.newDlqCount ?? -1) !== 0) throw closeoutError(
    'Report closeout replay changed the existing materialization or runtime safety',
    'REPORT_RUNTIME_CLOSEOUT_REPLAY_DRIFT',
  );
  return true;
}

function formulaVersionFor(platformScope) {
  return ({
    facebook: 'facebook-organic-v1',
    instagram: 'instagram-organic-v1',
    tiktok: 'tiktok-organic-v1',
    youtube: 'youtube-organic-v1',
    meta_ads: 'meta-ads-v1',
    google_ads: 'google-ads-v1',
    tiktok_ads: 'tiktok-ads-v1',
    woocommerce: 'woocommerce-commerce-v1',
    chatwoot: 'chatwoot-customer-service-v1',
  })[platformScope];
}

function normalizeActiveTrueFlags(value) {
  if (!Array.isArray(value) || value.length === 0) throw closeoutError(
    'Report closeout Active flags must be a non-empty array',
    'REPORT_RUNTIME_CLOSEOUT_ACTIVE_FLAG_INVALID',
  );
  const flags = [...new Set(value.map((item) => requireText(item, 'activeTrueFlag')))];
  if (flags.length !== value.length || flags.some((name) => !/^MKT_[A-Z0-9_]+_ENABLED$/u.test(name))) {
    throw closeoutError(
      'Report closeout Active flags are invalid',
      'REPORT_RUNTIME_CLOSEOUT_ACTIVE_FLAG_INVALID',
    );
  }
  return Object.freeze(flags.sort());
}
function readTrueFlags(value) {
  return Object.entries(value?.vars ?? {})
    .filter(([name, enabled]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && enabled === 'true')
    .map(([name]) => name)
    .sort();
}
function requireDashboardPlatformScope(value) {
  const platformScope = requireText(value, 'platformScope');
  if (!DASHBOARD_REPORT_PLATFORM_SCOPES.includes(platformScope)) throw closeoutError(
    `Unsupported Dashboard report platform scope: ${platformScope}`,
    'REPORT_RUNTIME_CLOSEOUT_PLATFORM_UNSUPPORTED',
  );
  return platformScope;
}
function assertQueueSettings(value, expected) {
  for (const [key, required] of Object.entries(expected)) {
    if (value?.[key] !== required) throw closeoutError(
      `Report closeout Queue setting ${key} differs from the reviewed contract`,
      'REPORT_RUNTIME_CLOSEOUT_QUEUE_TOPOLOGY_INVALID',
      { key, expected: required, observed: value?.[key] ?? null },
    );
  }
}
function exactlyOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) throw closeoutError(
    `Report closeout requires exactly one ${label}`,
    'REPORT_RUNTIME_CLOSEOUT_CONFIG_TARGET_INVALID',
    { label, matches: matches.length },
  );
  return matches[0];
}
function requireRealMapping(value, field) {
  const text = requireText(value, field);
  if (/replace|placeholder|example|todo|changeme/iu.test(text)) throw closeoutError(
    `Report closeout requires a real ${field} mapping`,
    'REPORT_RUNTIME_CLOSEOUT_CONFIG_MAPPING_PLACEHOLDER',
    { field },
  );
  return text;
}
function requireExact(value, expected, field) {
  if (value !== expected) throw closeoutError(
    `Report closeout ${field} must equal ${expected}`,
    'REPORT_RUNTIME_CLOSEOUT_CONFIG_TARGET_INVALID',
    { field, expected, observed: value ?? null },
  );
  return value;
}
function requireUuid(value, field) {
  const text = requireText(value, field);
  if (!UUID.test(text)) throw closeoutError(
    `Report closeout ${field} must be a UUID`,
    'REPORT_RUNTIME_CLOSEOUT_CONFIG_TARGET_INVALID',
    { field },
  );
  return text.toLowerCase();
}
function requireDate(value, field) {
  const text = requireText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw closeoutError(
      `Report closeout ${field} must be YYYY-MM-DD`,
      'REPORT_RUNTIME_CLOSEOUT_INPUT_INVALID',
      { field },
    );
  }
  return text;
}
function requireTimestamp(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw closeoutError(
    `Report closeout ${field} must be epoch milliseconds`,
    'REPORT_RUNTIME_CLOSEOUT_INPUT_INVALID',
    { field },
  );
  return number;
}
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw closeoutError(
    `Report closeout ${field} is required`,
    'REPORT_RUNTIME_CLOSEOUT_INPUT_INVALID',
    { field },
  );
  return value.trim();
}
function isSha256(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function closeoutError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeCloseoutError';
  error.code = code;
  error.details = details;
  return error;
}
