import { createHash } from 'node:crypto';
import { buildDashboardPresetJob } from '../../packages/application/src/reports/dashboard-report-request.js';
import { resolveReportPeriod } from '../../packages/application/src/reports/report-period.js';
import { createReportId } from '../../packages/application/src/storage/marketing-history-contract.js';
import {
  DASHBOARD_REPORT_PLATFORM_SCOPES,
  DASHBOARD_REPORT_PRESET_DAYS,
} from '../../packages/config/src/report-settings.seed.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';
import {
  REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT,
  REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES,
  loadReportRuntimeFinalizerEnvironment,
} from './report-runtime-finalizer-environment.js';

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
const EXPECTED_CRONS = Object.freeze(['*/5 * * * *', '50 0 * * *']);
const GENERATED_FALSE_FLAG_NAMES = new Set([
  'MKT_WOOCOMMERCE_REPORT_READ_ENABLED',
]);
const REQUIRED_FINALIZER_TABLE_ENV_NAMES = Object.freeze(
  REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES.filter((envName) => (
    Object.values(REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES).includes(envName)
  )),
);
const DEFAULT_FINALIZER_EVIDENCE_PATH =
  'outputs/report-runtime-finalize/report-runtime-finalize-summary.json';
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
    || value.schema?.privateEnvironmentContractVersion
      !== REPORT_RUNTIME_FINALIZER_ENVIRONMENT_CONTRACT
    || Number(value.schema?.privateEnvironmentUpdateCount ?? -1)
      !== REPORT_RUNTIME_FINALIZER_TABLE_ENV_NAMES.length
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
  source.vars = { ...(source.vars ?? {}) };
  const reviewedActiveTrueFlags = normalizeActiveTrueFlags(
    options.activeTrueFlags ?? REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  );
  const finalizerTableEnvironment = resolveFinalizerTableEnvironment(source, options);
  for (const envName of REQUIRED_FINALIZER_TABLE_ENV_NAMES) {
    if (hasText(finalizerTableEnvironment[envName])) {
      source.vars[envName] = finalizerTableEnvironment[envName].trim();
    }
  }
  for (const flagName of reviewedActiveTrueFlags) {
    if (!Object.hasOwn(source.vars, flagName) && GENERATED_FALSE_FLAG_NAMES.has(flagName)) {
      source.vars[flagName] = 'false';
    }
  }

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
  const periodEnd = requireDate(input.periodEnd, 'periodEnd');
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const sourceWatermark = requireText(input.sourceWatermark, 'sourceWatermark');
  const timeZone = requireExact(input.timeZone ?? 'Asia/Bangkok', 'Asia/Bangkok', 'timeZone');
  const platformScope = requireText(input.platformScope ?? 'tiktok', 'platformScope');
  const accountKey = requireText(input.accountKey ?? 'chemistry_k', 'accountKey');
  const formulaVersion = requireText(input.formulaVersion ?? 'tiktok-organic-v1', 'formulaVersion');
  return Object.freeze(REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS.map((windowDays) => {
    const period = resolveReportPeriod({
      periodKind: 'rolling_days',
      windowDays,
      periodEnd,
      comparisonMode: 'previous_period',
      timeZone,
      now: new Date(requestedAt),
    });
    const reportSettingKey = `integration_workspace:${platformScope}:rolling:${windowDays}d`;
    const job = buildDashboardPresetJob({
      requestedAt,
      reportSettingKey,
      platformScope,
      windowDays,
      periodEnd,
      comparisonMode: 'previous_period',
      timeZone,
      sourceWatermark,
    });
    const reportId = createReportId({
      report_setting_key: reportSettingKey,
      account_key: accountKey,
      period_kind: 'rolling_days',
      period_start: period.periodStart,
      period_end: period.periodEnd,
      formula_version: formulaVersion,
    });
    return Object.freeze({ windowDays, reportSettingKey, reportId, period, job });
  }));
}

export function selectFreshReportRuntimeCloseoutCandidate(candidates, existingReportIds = [], env = process.env) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw closeoutError(
    'Report closeout candidate list is empty',
    'REPORT_RUNTIME_CLOSEOUT_CANDIDATE_INVALID',
  );
  const existing = new Set(existingReportIds.map(String));
  const preferred = optionalWindowDays(env.MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS);
  if (preferred !== null) {
    const selected = candidates.find((candidate) => candidate.windowDays === preferred);
    if (!selected) throw closeoutError(
      `Requested Report closeout window is not available: ${preferred}D`,
      'REPORT_RUNTIME_CLOSEOUT_WINDOW_UNAVAILABLE',
      { windowDays: preferred },
    );
    if (existing.has(selected.reportId)) throw closeoutError(
      `Requested Report closeout window already exists for the selected period: ${preferred}D`,
      'REPORT_RUNTIME_CLOSEOUT_FRESH_PRESET_UNAVAILABLE',
      { windowDays: preferred },
    );
    return selected;
  }
  const selected = candidates.find((candidate) => !existing.has(candidate.reportId));
  if (!selected) throw closeoutError(
    'Every reviewed Report closeout preset already has a materialization for the selected period',
    'REPORT_RUNTIME_CLOSEOUT_FRESH_PRESET_UNAVAILABLE',
    { candidateCount: candidates.length },
  );
  return selected;
}

export function assertReportRuntimeCloseoutPreflight(row = {}) {
  if (row.coverage_status === null
    || !['complete', 'partial', 'revisable', 'no_data_confirmed'].includes(String(row.coverage_status))
    || typeof row.source_watermark !== 'string'
    || row.source_watermark.trim() === ''
    || !/^\d{4}-\d{2}-\d{2}$/u.test(String(row.period_end ?? ''))
    || Number(row.content_state_count ?? 0) <= 0
    || Number(row.observation_count ?? 0) <= 0
    || Number(row.active_report_locks ?? 0) !== 0
    || Number(row.open_report_dlq ?? 0) !== 0) {
    throw closeoutError(
      'TikTok D1 historical facts are not ready for Report closeout materialization',
      'REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_NOT_READY',
      {
        coverageStatus: row.coverage_status ?? null,
        contentStateCount: Number(row.content_state_count ?? 0),
        observationCount: Number(row.observation_count ?? 0),
        activeReportLocks: Number(row.active_report_locks ?? 0),
        openReportDlq: Number(row.open_report_dlq ?? 0),
      },
    );
  }
  return true;
}

export function assertWooCommerceReportRuntimeCloseoutPreflight(row = {}) {
  if (!['complete', 'partial', 'revisable', 'no_data_confirmed'].includes(String(row.coverage_status))
    || !['full_inventory', 'recent_window', 'report_range'].includes(String(row.coverage_scope_mode))
    || typeof row.source_watermark !== 'string'
    || row.source_watermark.trim() === ''
    || !/^\d{4}-\d{2}-\d{2}$/u.test(String(row.period_end ?? ''))
    || Number(row.daily_fact_count ?? 0) <= 0
    || Number(row.order_state_count ?? 0) <= 0
    || Number(row.active_report_locks ?? 0) !== 0
    || Number(row.open_report_dlq ?? 0) !== 0) {
    throw closeoutError(
      'WooCommerce D1 Commerce facts are not ready for Report closeout materialization',
      'WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_NOT_READY',
      {
        coverageStatus: row.coverage_status ?? null,
        coverageScopeMode: row.coverage_scope_mode ?? null,
        dailyFactCount: Number(row.daily_fact_count ?? 0),
        orderStateCount: Number(row.order_state_count ?? 0),
        activeReportLocks: Number(row.active_report_locks ?? 0),
        openReportDlq: Number(row.open_report_dlq ?? 0),
      },
    );
  }
  return true;
}

export function assertReportRuntimeCloseoutCompletion(row = {}, expected = {}) {
  const status = String(row.data_status ?? '');
  if (row.report_id !== expected.reportId
    || !['complete', 'partial', 'revisable', 'no_data_confirmed'].includes(status)
    || typeof row.payload_checksum !== 'string'
    || row.payload_checksum.trim() === ''
    || Number(row.materialization_count ?? 0) !== 1
    || String(row.sync_status ?? '') !== 'success'
    || Number(row.active_lock_count ?? 0) !== 0
    || Number(row.new_dlq_count ?? 0) !== 0) {
    throw closeoutError(
      'Report closeout did not reach a completed D1 materialization state',
      'REPORT_RUNTIME_CLOSEOUT_COMPLETION_INCOMPLETE',
      {
        reportIdMatched: row.report_id === expected.reportId,
        dataStatus: status || null,
        materializationCount: Number(row.materialization_count ?? 0),
        syncStatus: row.sync_status ?? null,
        activeLockCount: Number(row.active_lock_count ?? 0),
        newDlqCount: Number(row.new_dlq_count ?? 0),
      },
    );
  }
  return true;
}

export function assertReportRuntimeCloseoutReplay(before = {}, after = {}) {
  if (before.report_id !== after.report_id
    || before.payload_checksum !== after.payload_checksum
    || Number(after.materialization_count ?? 0) !== 1
    || Number(after.active_lock_count ?? 0) !== 0
    || Number(after.new_dlq_count ?? 0) !== 0) {
    throw closeoutError(
      'Report closeout replay changed Stable materialization identity or payload',
      'REPORT_RUNTIME_CLOSEOUT_REPLAY_DRIFT',
    );
  }
  return true;
}

export function safeReportRuntimeCloseoutEvidence(value) {
  if (Array.isArray(value)) return value.map(safeReportRuntimeCloseoutEvidence);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:token|secret|authorization|cookie|password|consumer_key|consumer_secret)/iu.test(key)) continue;
    output[key] = safeReportRuntimeCloseoutEvidence(nested);
  }
  return output;
}

function resolveFinalizerTableEnvironment(source, options) {
  if (options.finalizerEnvironment !== undefined) {
    return normalizeFinalizerTableEnvironment(options.finalizerEnvironment);
  }
  const configuredEvidencePath = options.finalizerEvidencePath
    ?? process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE;
  const missingMapping = REQUIRED_FINALIZER_TABLE_ENV_NAMES.some(
    (envName) => !hasText(source.vars?.[envName]),
  );
  if (!configuredEvidencePath && !missingMapping) return Object.freeze({});
  const loaded = loadReportRuntimeFinalizerEnvironment({
    finalizerEvidencePath: configuredEvidencePath ?? DEFAULT_FINALIZER_EVIDENCE_PATH,
  });
  return loaded.tableEnvironment;
}

function normalizeFinalizerTableEnvironment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw closeoutError(
    'Report closeout finalizer environment must be an object',
    'REPORT_RUNTIME_CLOSEOUT_FINALIZER_ENVIRONMENT_INVALID',
  );
  const normalized = {};
  for (const envName of REQUIRED_FINALIZER_TABLE_ENV_NAMES) {
    normalized[envName] = requireRealMapping(value[envName], envName);
  }
  return Object.freeze(normalized);
}

function optionalWindowDays(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || !REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS.includes(number)) throw closeoutError(
    `MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS must be one of ${REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS.join(', ')}`,
    'REPORT_RUNTIME_CLOSEOUT_WINDOW_INVALID',
    { windowDays: value },
  );
  return number;
}

function normalizeActiveTrueFlags(value) {
  if (!Array.isArray(value) || value.length === 0) throw closeoutError(
    'Report closeout requires at least one reviewed active execution flag',
    'REPORT_RUNTIME_CLOSEOUT_ACTIVE_FLAG_INVALID',
  );
  const normalized = [...new Set(value.map((name) => requireText(name, 'activeTrueFlag')))].sort();
  if (normalized.some((name) => !/^MKT_[A-Z0-9_]+_ENABLED$/u.test(name))) throw closeoutError(
    'Report closeout active execution flag name is invalid',
    'REPORT_RUNTIME_CLOSEOUT_ACTIVE_FLAG_INVALID',
    { activeTrueFlags: normalized },
  );
  return normalized;
}

function assertQueueSettings(actual, expected) {
  const observed = Object.fromEntries(Object.keys(expected).map((key) => [key, actual?.[key] ?? null]));
  if (stableJson(observed) !== stableJson(expected)) throw closeoutError(
    'Report closeout Queue topology differs from the reviewed shared Queue contract',
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_TOPOLOGY_INVALID',
    { queue: actual?.queue ?? null },
  );
}

function readTrueFlags(config) {
  return Object.entries(config.vars ?? {})
    .filter(([name, value]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && readBoolean(value) === true)
    .map(([name]) => name)
    .sort();
}

function exactlyOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) throw closeoutError(
    `Report closeout requires exactly one ${label}`,
    'REPORT_RUNTIME_CLOSEOUT_CONFIG_BINDING_INVALID',
    { label, matchCount: matches.length },
  );
  return matches[0];
}

function requireRealMapping(value, fieldName) {
  const text = requireText(value, fieldName);
  if (/^replace-with-/u.test(text)) throw closeoutError(
    `${fieldName} is still a placeholder`,
    'REPORT_RUNTIME_CLOSEOUT_TABLE_MAPPING_INVALID',
    { fieldName },
  );
  return text;
}

function requireUuid(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!UUID.test(text)) throw closeoutError(
    `${fieldName} must be a UUID`,
    'REPORT_RUNTIME_CLOSEOUT_CONFIG_UUID_INVALID',
    { fieldName },
  );
  return text.toLowerCase();
}

function requireExact(value, expected, fieldName) {
  const text = requireText(value, fieldName);
  if (text !== expected) throw closeoutError(
    `${fieldName} must equal ${expected}`,
    'REPORT_RUNTIME_CLOSEOUT_TARGET_INVALID',
    { fieldName, expected, actual: text },
  );
  return text;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw closeoutError(`${fieldName} must be YYYY-MM-DD`, 'REPORT_RUNTIME_CLOSEOUT_VALUE_INVALID', { fieldName });
  }
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw closeoutError(
    `${fieldName} must be an epoch millisecond`,
    'REPORT_RUNTIME_CLOSEOUT_VALUE_INVALID',
    { fieldName },
  );
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw closeoutError(
    `${fieldName} is required`,
    'REPORT_RUNTIME_CLOSEOUT_VALUE_INVALID',
    { fieldName },
  );
  return value.trim();
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function readBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function stableJson(value) { return JSON.stringify(value); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function closeoutError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeCloseoutError';
  error.code = code;
  error.details = details;
  return error;
}
