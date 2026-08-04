#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getJobDefinition, JOB_TYPES } from '../packages/application/src/jobs/job-catalog.js';
import { assertReportRuntimeMetricIntegrity } from './lib/report-runtime-window-repair.js';
import { getReportPlatformContract } from '../packages/application/src/reports/report-platform-adapter-registry.js';
import { getConnectorCatalogEntry } from '../packages/config/src/connector-catalog.js';
import { createReportSettingRowsForProfile } from '../packages/config/src/report-settings.seed.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  buildReportRuntimeCloseoutCandidates,
  buildReportRuntimeCloseoutConfigWindow,
} from './lib/report-runtime-closeout-operator.js';
import {
  assessYouTubeReportLiveReadiness,
  YOUTUBE_REPORT_WINDOWS,
} from './lib/youtube-report-live-readiness-audit.js';
import {
  YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
  assertSelectOnlySql,
  assertYouTubeReportRemoteCollectorConfirmation,
  buildYouTubeRemoteReadinessEvidence,
  parseWranglerJson,
  parseYouTubeReportRemoteCollectorArgs,
  sanitizeYouTubeRemoteEvidence,
  unwrapD1Rows,
} from './lib/youtube-report-remote-readiness-collector.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_YOUTUBE_REPORT_REMOTE_COLLECTOR_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const evidencePath = resolve(
  process.env.MKT_YOUTUBE_REPORT_REMOTE_COLLECTOR_EVIDENCE
    ?? 'outputs/youtube-report-remote-readiness/readiness-summary.json',
);
const EXPECTED_WORKER_NAME = 'social-mkt-sync-worker';
const EXPECTED_ACCOUNT_KEY = 'chemistry_k';
const REQUIRED_LARK_KEYS = Object.freeze({
  mktReportSnapshots: 'report_id',
  mktReportMetricValues: 'report_metric_key',
  mktReportTopContent: 'report_content_key',
  mktSyncLog: 'sync_id',
  mktSystemAlerts: 'alert_id',
});

let stage = 'init';

try {
  const options = parseYouTubeReportRemoteCollectorArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeCollector();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'YOUTUBE_REPORT_REMOTE_COLLECTOR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeYouTubeRemoteEvidence(error?.details ?? {}),
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: 'youtube_report_remote_readiness_collector_v1',
    command: `CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR=${YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION} node scripts/youtube-report-remote-readiness-collector.mjs --execute`,
    stages: [
      'local-catalog-and-config',
      'remote-worker-read-only',
      'remote-d1-select-only',
      'pending-migrations-read-only',
      'lark-schema-and-record-read-only',
      'assess-existing-readiness-contract',
    ],
    windows: YOUTUBE_REPORT_WINDOWS,
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    liveMaterializationAuthorized: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeCollector() {
  stage = 'confirmation';
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertYouTubeReportRemoteCollectorConfirmation(env);

  stage = 'local-catalog-and-config';
  const sourceText = await readFile(configPath, 'utf8');
  const config = buildReportRuntimeCloseoutConfigWindow(sourceText);
  const catalog = collectLocalCatalog();

  stage = 'remote-worker-read-only';
  const worker = await collectRemoteWorker(config, env);

  stage = 'remote-d1-select-only';
  const sourceRuntime = await readSourceAndRuntime(env);

  stage = 'pending-migrations-read-only';
  const pendingMigrationCount = await readPendingMigrationCount(env);

  const periodEnd = textOrNull(sourceRuntime.watermark_date);
  const sourceWatermark = textOrNull(sourceRuntime.source_watermark);
  const candidates = isDate(periodEnd) && sourceWatermark
    ? buildReportRuntimeCloseoutCandidates({
      requestedAt: Date.now(),
      periodEnd,
      sourceWatermark,
      timeZone: 'Asia/Bangkok',
      platformScope: 'youtube',
      accountKey: EXPECTED_ACCOUNT_KEY,
      formulaVersion: 'youtube-organic-v1',
    }).filter((candidate) => YOUTUBE_REPORT_WINDOWS.includes(candidate.windowDays))
    : [];
  const d1Windows = candidates.length > 0
    ? await readD1Windows(candidates, env)
    : YOUTUBE_REPORT_WINDOWS.map(emptyD1Window);

  stage = 'lark-schema-and-record-read-only';
  const lark = await collectLark(config.tableIds, candidates, d1Windows, env);

  stage = 'build-evidence';
  const evidence = buildYouTubeRemoteReadinessEvidence({
    catalog,
    worker,
    runtime: {
      pendingMigrationCount,
      activeReportWorkCount: numberOrZero(sourceRuntime.active_report_work_count),
      activeReportLockCount: numberOrZero(sourceRuntime.active_report_lock_count),
      openReportDlqCount: numberOrZero(sourceRuntime.open_report_dlq_count),
      openReportCriticalAlertCount: numberOrZero(sourceRuntime.open_report_critical_alert_count),
    },
    source: {
      contentCoverageStatus: sourceRuntime.content_coverage_status,
      accountCoverageStatus: sourceRuntime.account_coverage_status,
      failureCount: numberOrZero(sourceRuntime.failure_count),
      contentEntityCount: numberOrZero(sourceRuntime.content_entity_count),
      contentStateCount: numberOrZero(sourceRuntime.content_state_count),
      observationCount: numberOrZero(sourceRuntime.observation_count),
      accountFactCount: numberOrZero(sourceRuntime.account_fact_count),
      sourceWatermark,
      watermarkDate: periodEnd,
      reportingTimezone: sourceRuntime.reporting_timezone,
    },
    lark: lark.schema,
    windows: lark.windows,
  });

  stage = 'assess-existing-readiness-contract';
  const assessment = assessYouTubeReportLiveReadiness(evidence);
  const summary = sanitizeYouTubeRemoteEvidence({
    ok: assessment.readyForLive,
    contractVersion: 'youtube_report_remote_readiness_collector_v1',
    evidence,
    assessment,
    repository: await collectRepositoryState(),
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    liveMaterializationAuthorized: false,
    production: 'BLOCKED',
  });
  await writePrivateJson(evidencePath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
  if (!assessment.readyForLive) process.exitCode = 2;
}

function collectLocalCatalog() {
  const connector = getConnectorCatalogEntry('youtube');
  const job = getJobDefinition(JOB_TYPES.YOUTUBE_ORGANIC_SYNC);
  const report = getReportPlatformContract('youtube');
  const settings = createReportSettingRowsForProfile('integration_workspace')
    .filter((row) => row.report_type === 'dashboard_performance_report'
      && row.platforms?.[0] === 'youtube'
      && row.period_kind === 'rolling_days'
      && YOUTUBE_REPORT_WINDOWS.includes(row.window_days));
  return Object.freeze({
    connectorStatus: connector.implementationStatus,
    jobStatus: job.implementationStatus,
    reportStatus: report.sourceStatus,
    adapterCapability: report.capability,
    reportSettingsReady: settings.length === YOUTUBE_REPORT_WINDOWS.length
      && YOUTUBE_REPORT_WINDOWS.every((windowDays) => settings.some((row) => row.window_days === windowDays)),
  });
}

async function collectRemoteWorker(config, env) {
  const status = parseWranglerJson(await runText('npx', [
    'wrangler', 'deployments', 'status', '--name', EXPECTED_WORKER_NAME,
    '--config', configPath, '--json',
  ], { env }));
  const active = resolveActiveVersion(status);
  const version = parseWranglerJson(await runText('npx', [
    'wrangler', 'versions', 'view', active.versionId, '--name', EXPECTED_WORKER_NAME,
    '--config', configPath, '--json',
  ], { env }));
  const bindings = collectBindings(version);
  const trueFlags = bindings
    .filter((binding) => normalizeBindingType(binding?.type) === 'plain_text')
    .map((binding) => [readBindingName(binding), readRemoteBoolean(binding?.text ?? binding?.value)])
    .filter(([name, enabled]) => name && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && enabled === true)
    .map(([name]) => name)
    .sort();
  const d1Match = exactlyOneMatch(bindings, (binding) => (
    readBindingName(binding) === 'MKT_STATE_DB' && normalizeBindingType(binding?.type) === 'd1'
  ), (binding) => String(binding.database_id ?? binding.databaseId ?? binding.id ?? '').toLowerCase()
      === config.databaseId);
  const queueMatch = exactlyOneMatch(bindings, (binding) => (
    readBindingName(binding) === 'MKT_SYNC_QUEUE' && normalizeBindingType(binding?.type) === 'queue'
  ), (binding) => String(binding.queue_name ?? binding.queueName ?? binding.queue ?? '')
      === config.mainQueueName);
  const tableMatch = Object.entries(REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES).every(([key, envName]) => (
    exactlyOneMatch(bindings, (binding) => (
      readBindingName(binding) === envName && normalizeBindingType(binding?.type) === 'plain_text'
    ), (binding) => String(binding.text ?? binding.value ?? '').trim() === config.tableIds[key])
  ));
  return Object.freeze({
    activeTrafficPercent: active.trafficPercent,
    trueFlags: Object.freeze(trueFlags),
    bindingsMatch: d1Match && queueMatch && tableMatch,
  });
}

async function readSourceAndRuntime(env) {
  const rows = await readD1Rows(`
    WITH content_coverage AS (
      SELECT * FROM data_coverage_runs
      WHERE customer_key = 'chemistry_k' AND platform = 'youtube'
        AND account_key = 'chemistry_k'
        AND dataset_key = 'organic_content_cumulative'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
    ), latest_account_fact AS (
      SELECT * FROM organic_account_daily_facts
      WHERE customer_key = 'chemistry_k' AND platform = 'youtube'
        AND account_key = 'chemistry_k'
      ORDER BY metric_date DESC, updated_at DESC, account_daily_key ASC LIMIT 1
    ), account_coverage AS (
      SELECT c.* FROM data_coverage_runs c
      JOIN latest_account_fact a ON a.coverage_run_id = c.coverage_run_id
      LIMIT 1
    )
    SELECT
      (SELECT status FROM content_coverage) AS content_coverage_status,
      (SELECT status FROM account_coverage) AS account_coverage_status,
      COALESCE((SELECT failed_rows FROM content_coverage), 0)
        + COALESCE((SELECT failed_rows FROM account_coverage), 0) AS failure_count,
      (SELECT COUNT(*) FROM data_coverage_entities
        WHERE coverage_run_id = (SELECT coverage_run_id FROM content_coverage)
          AND entity_type = 'content' AND observation_status = 'observed') AS content_entity_count,
      (SELECT COUNT(*) FROM organic_content_state
        WHERE customer_key = 'chemistry_k' AND platform = 'youtube'
          AND account_key = 'chemistry_k') AS content_state_count,
      (SELECT COUNT(DISTINCT content_key) FROM organic_content_observations
        WHERE customer_key = 'chemistry_k' AND platform = 'youtube'
          AND account_key = 'chemistry_k') AS observation_count,
      (SELECT COUNT(*) FROM organic_account_daily_facts
        WHERE customer_key = 'chemistry_k' AND platform = 'youtube'
          AND account_key = 'chemistry_k') AS account_fact_count,
      (SELECT MAX(metric_date) FROM organic_content_observations
        WHERE customer_key = 'chemistry_k' AND platform = 'youtube'
          AND account_key = 'chemistry_k') AS watermark_date,
      (SELECT source_watermark FROM content_coverage) AS source_watermark,
      COALESCE(
        (SELECT source_timezone FROM content_coverage),
        (SELECT account_timezone FROM latest_account_fact)
      ) AS reporting_timezone,
      (SELECT COUNT(*) FROM sync_runs
        WHERE platform = 'youtube' AND account_key = 'chemistry_k'
          AND sync_type = 'dashboard_performance_report'
          AND status IN ('pending', 'running')) AS active_report_work_count,
      (SELECT COUNT(*) FROM sync_locks l
        JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = 'youtube' AND r.account_key = 'chemistry_k'
          AND r.sync_type = 'dashboard_performance_report'
          AND l.expires_at > (unixepoch() * 1000)) AS active_report_lock_count,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = 'report.materialization.generate'
          AND status IN ('open', 'redrive_pending')) AS open_report_dlq_count,
      (SELECT COUNT(*) FROM system_alerts
        WHERE platform = 'youtube' AND severity = 'critical' AND status = 'open')
        AS open_report_critical_alert_count;
  `, env);
  if (rows.length !== 1) throw collectorFailure(
    'YouTube readiness source/runtime query returned an unexpected row count',
    'YOUTUBE_REPORT_REMOTE_COLLECTOR_D1_SHAPE_INVALID',
    { rowCount: rows.length },
  );
  return Object.freeze({ ...rows[0] });
}

async function readPendingMigrationCount(env) {
  const output = await runText('npx', [
    'wrangler', 'd1', 'migrations', 'list', 'MKT_STATE_DB',
    '--remote', '--config', configPath,
  ], { env });
  return new Set([...output.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)]
    .map((match) => match[0])).size;
}

async function readD1Windows(candidates, env) {
  const ids = candidates.map((candidate) => `'${sqlText(candidate.reportId)}'`).join(', ');
  const rows = await readD1Rows(`
    SELECT report_id, data_status, payload_json
    FROM report_materializations
    WHERE report_id IN (${ids})
    ORDER BY report_id ASC;
  `, env);
  return candidates.map((candidate) => {
    const matches = rows.filter((row) => row.report_id === candidate.reportId);
    const payload = matches.length === 1 ? parsePayload(matches[0].payload_json) : null;
    return Object.freeze({
      windowDays: candidate.windowDays,
      reportId: candidate.reportId,
      d1MaterializationCount: matches.length,
      d1MetricCount: payload ? Object.keys(payload.metricPayload ?? {}).length : 0,
      d1TopContentCount: Array.isArray(payload?.topContent) ? payload.topContent.length : 0,
      payloadValid: payload?.platformScope === 'youtube'
        && payload?.capability === 'organic'
        && payload?.period?.windowDays === candidate.windowDays,
      baselineComplete: payload?.dataStatus === 'complete',
      payload,
    });
  });
}

async function collectLark(tableIds, candidates, d1Windows, env) {
  const client = createLarkBitableClientFromEnv(env);
  const remoteTables = await client.listTables();
  const remoteIds = new Set(remoteTables.map((table) => table.tableId).filter(Boolean));
  const fieldsByKey = {};
  let tablesReady = true;
  let stableKeysReady = true;
  for (const [key, tableId] of Object.entries(tableIds)) {
    if (!remoteIds.has(tableId)) {
      tablesReady = false;
      fieldsByKey[key] = [];
      continue;
    }
    const fields = await client.listFields({ tableId });
    fieldsByKey[key] = fields;
    if (!fields.some((field) => field.fieldName === REQUIRED_LARK_KEYS[key])) stableKeysReady = false;
  }
  const metricFields = fieldsByKey.mktReportMetricValues ?? [];
  const windowField = metricFields.find((field) => field.fieldId === 'fldMlTUP3Z') ?? null;
  const windowOptions = (windowField?.property?.options ?? [])
    .map((option) => Number(option?.name ?? option?.value))
    .filter(Number.isFinite);

  const windows = [];
  for (const windowDays of YOUTUBE_REPORT_WINDOWS) {
    const candidate = candidates.find((entry) => entry.windowDays === windowDays);
    const d1 = d1Windows.find((entry) => entry.windowDays === windowDays) ?? emptyD1Window(windowDays);
    if (!candidate) {
      windows.push(Object.freeze({
        ...d1,
        larkSnapshotCount: 0,
        larkMetricCount: 0,
        larkTopContentCount: 0,
        parity: false,
      }));
      continue;
    }
    const [snapshots, metrics, topContent] = await Promise.all([
      searchReportRecords(client, tableIds.mktReportSnapshots, candidate.reportId),
      searchReportRecords(client, tableIds.mktReportMetricValues, candidate.reportId),
      searchReportRecords(client, tableIds.mktReportTopContent, candidate.reportId),
    ]);
    const larkMetrics = {};
    let duplicateMetricKeys = 0;
    for (const record of metrics) {
      const metricKey = normalizeLarkText(record?.fields?.metric_key);
      if (!metricKey) continue;
      if (Object.hasOwn(larkMetrics, metricKey)) duplicateMetricKeys += 1;
      larkMetrics[metricKey] = normalizeLarkNumber(record?.fields?.current_value);
    }
    let parity = false;
    if (d1.payload && duplicateMetricKeys === 0) {
      try {
        assertReportRuntimeMetricIntegrity({ payload: d1.payload, larkMetrics });
        parity = true;
      } catch { parity = false; }
    }
    windows.push(Object.freeze({
      ...d1,
      larkSnapshotCount: snapshots.length,
      larkMetricCount: metrics.length,
      larkTopContentCount: topContent.length,
      parity,
    }));
  }
  return Object.freeze({
    schema: Object.freeze({
      tablesReady,
      stableKeysReady,
      windowFieldId: windowField?.fieldId ?? null,
      windowOptions: Object.freeze(windowOptions),
    }),
    windows: Object.freeze(windows),
  });
}

async function searchReportRecords(client, tableId, reportId) {
  return client.searchRecords({
    tableId,
    filter: {
      conjunction: 'and',
      conditions: [{ field_name: 'report_id', operator: 'is', value: [reportId] }],
    },
    pageSize: 500,
    maxPages: 1_000,
  });
}

async function readD1Rows(sql, env) {
  const statement = assertSelectOnlySql(sql);
  const output = await runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
    '--config', configPath, '--command', statement,
  ], { env });
  return unwrapD1Rows(parseWranglerJson(output));
}

async function collectRepositoryState() {
  const [branch, head, dirty] = await Promise.all([
    runText('git', ['branch', '--show-current']),
    runText('git', ['rev-parse', 'HEAD']),
    runText('git', ['status', '--porcelain', '--untracked-files=all'], { trim: false }),
  ]);
  return Object.freeze({ branch, head, clean: dirty.trim() === '' });
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function runText(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: repositoryRoot,
    env: options.env ?? process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  const value = String(result.stdout ?? '');
  return options.trim === false ? value : value.trim();
}

function resolveActiveVersion(value) {
  const candidates = [];
  visit(value);
  const unique = [...new Map(candidates.map((entry) => [entry.versionId, entry])).values()];
  if (unique.length !== 1) throw collectorFailure(
    'YouTube readiness requires one Worker version at 100% traffic',
    'YOUTUBE_REPORT_REMOTE_COLLECTOR_TRAFFIC_INVALID',
    { activeVersionCount: unique.length },
  );
  return unique[0];
  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    const trafficPercent = Number(nested.percentage ?? nested.traffic ?? nested.percent ?? Number.NaN);
    const versionId = String(nested.version_id ?? nested.versionId ?? '').trim();
    if (trafficPercent === 100 && /^[0-9a-f-]{36}$/iu.test(versionId)) {
      candidates.push({ versionId, trafficPercent });
    }
    Object.values(nested).forEach(visit);
  }
}
function collectBindings(value) {
  const arrays = [];
  visit(value);
  return arrays.find((items) => items.some((item) => readBindingName(item))) ?? [];
  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    if (Array.isArray(nested.bindings)) arrays.push(nested.bindings);
    Object.values(nested).forEach(visit);
  }
}
function exactlyOneMatch(values, predicate, verifier) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  return matches.length === 1 && verifier(matches[0]) === true;
}
function readBindingName(binding) {
  return String(binding?.name ?? binding?.binding ?? '').trim() || null;
}
function normalizeBindingType(value) {
  return String(value ?? '').trim().toLowerCase();
}
function readRemoteBoolean(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}
function parsePayload(value) {
  try { return JSON.parse(String(value ?? '')); } catch { return null; }
}
function emptyD1Window(value) {
  const windowDays = typeof value === 'object' ? value.windowDays : value;
  return Object.freeze({
    windowDays,
    d1MaterializationCount: 0,
    d1MetricCount: 0,
    d1TopContentCount: 0,
    payloadValid: false,
    baselineComplete: false,
    payload: null,
  });
}
function normalizeLarkText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return value.map(normalizeLarkText).filter(Boolean).join('') || null;
  if (value && typeof value === 'object') return normalizeLarkText(value.text ?? value.value ?? value.name);
  return value == null ? null : String(value).trim() || null;
}
function normalizeLarkNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const candidate = scalar && typeof scalar === 'object' ? scalar.value ?? scalar.text : scalar;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : null;
}
function numberOrZero(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}
function sqlText(value) {
  return String(value).replaceAll("'", "''");
}
function collectorFailure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'YouTubeReportRemoteCollectorError';
  error.code = code;
  error.details = details;
  return error;
}
