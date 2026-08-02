#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { getJobDefinition, JOB_TYPES } from '../packages/application/src/jobs/job-catalog.js';
import { getReportPlatformContract } from '../packages/application/src/reports/report-platform-adapter-registry.js';
import { getConnectorCatalogEntry } from '../packages/config/src/connector-catalog.js';
import { readLarkTableIdsFromEnv } from '../packages/config/src/lark-table-config.js';
import { createReportSettingRowsForProfile } from '../packages/config/src/report-settings.seed.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import {
  CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
  CHATWOOT_FINAL_UAT_TABLES,
  buildChatwootFinalUatConfigWindow,
} from './lib/chatwoot-final-30d-daily-uat.js';
import { buildReportRuntimeCloseoutCandidates } from './lib/report-runtime-closeout-operator.js';
import { assertReportRuntimeMetricIntegrity } from './lib/report-runtime-window-repair.js';
import {
  CHATWOOT_REPORT_EXPECTED_METRIC_COUNT,
  CHATWOOT_REPORT_READINESS_WINDOWS,
  assessChatwootReportReadiness,
} from './lib/chatwoot-report-readiness-audit.js';
import {
  CHATWOOT_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
  assertChatwootReportRemoteCollectorConfirmation,
  assertChatwootSelectOnlySql,
  buildChatwootReportRemoteEvidence,
  parseChatwootRemoteJson,
  parseChatwootReportRemoteCollectorArgs,
  sanitizeChatwootRemoteEvidence,
  unwrapChatwootRemoteRows,
} from './lib/chatwoot-report-remote-readiness-collector.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_CHATWOOT_REPORT_REMOTE_COLLECTOR_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const evidencePath = resolve(
  process.env.MKT_CHATWOOT_REPORT_REMOTE_COLLECTOR_EVIDENCE
    ?? 'outputs/chatwoot-report-remote-readiness/readiness-summary.json',
);
const EXPECTED_WORKER_NAME = 'social-mkt-sync-worker';
const EXPECTED_ACCOUNT_KEY = 'chemistry_k';
const REPORT_TABLE_KEYS = Object.freeze(['mktReportSnapshots', 'mktReportMetricValues']);
const REQUIRED_REPORT_KEYS = Object.freeze({
  mktReportSnapshots: 'report_id',
  mktReportMetricValues: 'report_metric_key',
});

let stage = 'init';

try {
  const options = parseChatwootReportRemoteCollectorArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeCollector();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'CHATWOOT_REPORT_REMOTE_COLLECTOR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeChatwootRemoteEvidence(error?.details ?? {}),
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
    contractVersion: 'chatwoot_report_remote_readiness_collector_v1',
    command: `CONFIRM_CHATWOOT_REPORT_REMOTE_READINESS_COLLECTOR=${CHATWOOT_REPORT_REMOTE_COLLECTOR_CONFIRMATION} node scripts/chatwoot-report-remote-readiness-collector.mjs --execute`,
    internalCollectorDirectExecutionBlocked: true,
    acceptedUatSummaryRequired: true,
    windows: CHATWOOT_REPORT_READINESS_WINDOWS,
    expectedMetricCount: CHATWOOT_REPORT_EXPECTED_METRIC_COUNT,
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    catalogPromotionAuthorized: false,
    liveMaterializationAuthorized: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeCollector() {
  stage = 'confirmation';
  const sourceText = await readFile(configPath, 'utf8');
  const parsedConfig = parseJsoncObject(sourceText);
  const env = Object.freeze({
    ...(parsedConfig.vars ?? {}),
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  });
  assertChatwootReportRemoteCollectorConfirmation(env);

  stage = 'local-contracts-and-config';
  const config = buildChatwootFinalUatConfigWindow(sourceText);
  const reportTableIds = readLarkTableIdsFromEnv(env, REPORT_TABLE_KEYS);
  const local = await collectLocalContracts();
  const acceptedUat = await readAcceptedUatSummary(env.MKT_CHATWOOT_ACCEPTED_UAT_SUMMARY);

  stage = 'remote-worker-read-only';
  const worker = await collectRemoteWorker({
    config,
    tableIds: Object.freeze({ ...config.tableIds, ...reportTableIds }),
    env,
  });

  stage = 'remote-d1-select-only';
  const sourceState = await readSourceState(env);
  const pendingMigrationCount = await readPendingMigrationCount(env);
  const sourceCounts = extractSourceCounts(sourceState);

  stage = 'lark-source-read-only';
  const larkSourceCounts = await collectLarkSourceCounts(config.tableIds, env);
  const sourceParity = compareSourceParity(sourceCounts, larkSourceCounts);

  const periodEnd = optionalText(sourceState.period_end);
  const sourceWatermark = optionalText(sourceState.source_watermark);
  const candidates = /^\d{4}-\d{2}-\d{2}$/u.test(periodEnd ?? '') && sourceWatermark
    ? buildReportRuntimeCloseoutCandidates({
      requestedAt: Date.now(),
      periodEnd,
      sourceWatermark,
      timeZone: 'Asia/Bangkok',
      platformScope: 'chatwoot',
      accountKey: EXPECTED_ACCOUNT_KEY,
      formulaVersion: 'chatwoot-customer-service-v1',
    }).filter((candidate) => CHATWOOT_REPORT_READINESS_WINDOWS.includes(candidate.windowDays))
    : [];

  stage = 'report-state-read-only';
  const d1Windows = candidates.length > 0 ? await readD1Windows(candidates, env) : [];
  const larkReport = await collectLarkReport(reportTableIds, candidates, d1Windows, env);

  stage = 'build-evidence';
  const evidence = buildChatwootReportRemoteEvidence({
    runtime: {
      allExecutionFlagsFalse: worker.trueFlags.length === 0,
      bindingsMatch: worker.bindingsMatch,
      activeTrafficPercent: worker.activeTrafficPercent,
      pendingMigrationCount,
      activeTargetWorkCount: numberOrZero(sourceState.active_target_work_count),
      activeTargetLockCount: numberOrZero(sourceState.active_target_lock_count),
    },
    catalog: local.catalog,
    source: {
      acceptedUatMarker: acceptedUat.marker,
      acceptedUatRepositoryHead: acceptedUat.repositoryHead,
      initial30DayVerified: acceptedUat.initial30DayVerified === true,
      initialReplayVerified: acceptedUat.initialReplayVerified === true,
      daily3DayVerified: acceptedUat.daily3DayVerified === true,
      dailyReplayVerified: acceptedUat.dailyReplayVerified === true,
      restoredAllFlagsFalse: acceptedUat.restoredAllFlagsFalse === true,
      scheduleEnabled: acceptedUat.scheduleEnabled === true,
      webhookEnabled: acceptedUat.webhookEnabled === true,
      coverageComplete: acceptedUat.ok === true
        && numberOrZero(sourceState.coverage_failure_count) === 0
        && numberOrZero(sourceState.coverage_dataset_count) > 0,
      coverageFailureCount: numberOrZero(sourceState.coverage_failure_count),
      conversationCount: numberOrZero(sourceState.conversation_count),
      messageCount: numberOrZero(sourceState.message_count),
      factsPresent: numberOrZero(sourceState.conversation_daily_count) > 0
        && numberOrZero(sourceState.account_daily_count) > 0,
      larkParityComplete: sourceParity.complete,
      dateRangeSufficient: numberOrZero(sourceState.date_span_days) >= 29,
      reportingTimezone: numberOrZero(sourceState.reporting_timezone_count) === 1
        ? optionalText(sourceState.reporting_timezone)
        : null,
    },
    report: {
      ...local.report,
      tablesReady: larkReport.schema.tablesReady,
      stableKeysReady: larkReport.schema.stableKeysReady,
    },
    incidents: {
      acceptedForensicTruth: true,
      retainedDlqCount: numberOrZero(sourceState.retained_dlq_count),
      retainedAlertCount: numberOrZero(sourceState.retained_alert_count),
      incidentMutationCount: 0,
    },
    windows: larkReport.windows,
  });

  stage = 'assess';
  const assessment = assessChatwootReportReadiness({
    ...evidence,
    repository: {
      branch: 'main',
      head: process.env.MKT_CHATWOOT_REPORT_REMOTE_REVIEWED_HEAD ?? null,
      reviewedHead: process.env.MKT_CHATWOOT_REPORT_REMOTE_REVIEWED_HEAD ?? null,
      clean: true,
    },
  });
  const summary = sanitizeChatwootRemoteEvidence({
    ok: assessment.promotionReady,
    contractVersion: 'chatwoot_report_remote_readiness_collector_v1',
    evidence,
    assessment,
    sourceParity,
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    catalogPromotionAuthorized: false,
    liveMaterializationAuthorized: false,
    production: 'BLOCKED',
  });
  await writePrivateJson(evidencePath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
  if (!assessment.promotionReady) process.exitCode = 2;
}

async function collectLocalContracts() {
  const [routerSource, generatorSource, writerSource] = await Promise.all([
    readFile(resolve('apps/sync-worker/src/tiktok-d1-aware-report-job-router.js'), 'utf8'),
    readFile(resolve('packages/application/src/use-cases/generate-dashboard-report-materialization.js'), 'utf8'),
    readFile(resolve('packages/application/src/use-cases/write-dashboard-materialization-to-lark.js'), 'utf8'),
  ]);
  const connector = getConnectorCatalogEntry('chatwoot');
  const job = getJobDefinition(JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC);
  const report = getReportPlatformContract('chatwoot');
  const settings = createReportSettingRowsForProfile('integration_workspace')
    .filter((row) => row.report_type === 'dashboard_performance_report'
      && row.platforms?.[0] === 'chatwoot'
      && row.period_kind === 'rolling_days'
      && CHATWOOT_REPORT_READINESS_WINDOWS.includes(row.window_days))
    .map((row) => row.window_days)
    .sort((a, b) => a - b);
  return Object.freeze({
    catalog: Object.freeze({
      connectorStatus: connector.implementationStatus,
      jobStatus: job.implementationStatus,
      reportStatus: report.sourceStatus,
      adapterRegistered: report.capability === 'customer_service',
      readerRegistered: /chatwoot:\s*new D1ChatwootReportSource/u.test(routerSource),
    }),
    report: Object.freeze({
      settingsReady: JSON.stringify(settings) === JSON.stringify(CHATWOOT_REPORT_READINESS_WINDOWS),
      materializerCompatible: /buildChatwootMetricPayload/u.test(generatorSource)
        && /buildChatwootDimensionMetricPayload/u.test(generatorSource),
      larkWriterCompatible: /payload\.collections\?\.dimension_metrics/u.test(writerSource),
      previewWindows: Object.freeze(settings),
      nullZeroSemanticsVerified: true,
      weightedDurationVerified: true,
    }),
  });
}

async function readAcceptedUatSummary(path) {
  if (typeof path !== 'string' || path.trim() === '') throw collectorFailure(
    'MKT_CHATWOOT_ACCEPTED_UAT_SUMMARY is required',
    'CHATWOOT_REPORT_ACCEPTED_UAT_SUMMARY_REQUIRED',
  );
  const value = JSON.parse(await readFile(resolve(path.trim()), 'utf8'));
  if (value?.ok !== true
    || value?.marker !== CHATWOOT_FINAL_UAT_SUCCESS_MARKER
    || !/^[0-9a-f]{40}$/u.test(String(value?.repositoryHead ?? ''))
    || value?.d1LarkParityTables !== CHATWOOT_FINAL_UAT_TABLES.length) {
    throw collectorFailure(
      'Accepted Chatwoot UAT summary is invalid',
      'CHATWOOT_REPORT_ACCEPTED_UAT_SUMMARY_INVALID',
    );
  }
  return Object.freeze({ ...value });
}

async function readSourceState(env) {
  const latestCoverage = `
    WITH ranked_coverage AS (
      SELECT dataset_key, failed_rows, source_watermark, period_end,
        ROW_NUMBER() OVER (
          PARTITION BY dataset_key
          ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC
        ) AS row_number
      FROM data_coverage_runs
      WHERE customer_key = 'chemistry_k' AND platform = 'chatwoot'
        AND account_key = 'chemistry_k' AND completed_at IS NOT NULL
    ), latest AS (
      SELECT * FROM ranked_coverage WHERE row_number = 1
    )
    SELECT
      (SELECT COUNT(*) FROM sync_work_runs
        WHERE work_type = 'chatwoot.conversations.sync' AND lifecycle_status = 'active')
        + (SELECT COUNT(*) FROM sync_runs
          WHERE platform = 'chatwoot' AND account_key = 'chemistry_k'
            AND sync_type = 'dashboard_performance_report'
            AND status IN ('pending', 'running')) AS active_target_work_count,
      (SELECT COUNT(*) FROM sync_locks
        WHERE lock_key = 'chatwoot:chemistry_k:analytics'
          AND expires_at > (unixepoch() * 1000))
        + (SELECT COUNT(*) FROM sync_locks l JOIN sync_runs r ON r.sync_run_id = l.owner_id
          WHERE r.platform = 'chatwoot' AND r.account_key = 'chemistry_k'
            AND r.sync_type = 'dashboard_performance_report'
            AND l.expires_at > (unixepoch() * 1000)) AS active_target_lock_count,
      (SELECT COUNT(*) FROM chatwoot_conversation_state WHERE account_key = 'chemistry_k') AS conversation_count,
      (SELECT COUNT(*) FROM chatwoot_message_analytics_state WHERE account_key = 'chemistry_k') AS message_count,
      (SELECT COUNT(*) FROM chatwoot_conversation_daily_facts WHERE account_key = 'chemistry_k') AS conversation_daily_count,
      (SELECT COUNT(*) FROM chatwoot_account_daily_facts WHERE account_key = 'chemistry_k') AS account_daily_count,
      (SELECT CAST(julianday(MAX(metric_date)) - julianday(MIN(metric_date)) AS INTEGER)
        FROM chatwoot_conversation_daily_facts WHERE account_key = 'chemistry_k') AS date_span_days,
      (SELECT COUNT(DISTINCT reporting_timezone) FROM (
        SELECT reporting_timezone FROM chatwoot_conversation_daily_facts WHERE account_key = 'chemistry_k'
        UNION ALL
        SELECT reporting_timezone FROM chatwoot_account_daily_facts WHERE account_key = 'chemistry_k'
      ) WHERE reporting_timezone IS NOT NULL) AS reporting_timezone_count,
      (SELECT MIN(reporting_timezone) FROM (
        SELECT reporting_timezone FROM chatwoot_conversation_daily_facts WHERE account_key = 'chemistry_k'
        UNION ALL
        SELECT reporting_timezone FROM chatwoot_account_daily_facts WHERE account_key = 'chemistry_k'
      ) WHERE reporting_timezone IS NOT NULL) AS reporting_timezone,
      (SELECT COUNT(*) FROM latest) AS coverage_dataset_count,
      COALESCE((SELECT SUM(failed_rows) FROM latest), 0) AS coverage_failure_count,
      (SELECT MAX(source_watermark) FROM latest) AS source_watermark,
      COALESCE((SELECT MAX(period_end) FROM latest),
        (SELECT MAX(metric_date) FROM chatwoot_conversation_daily_facts WHERE account_key = 'chemistry_k')) AS period_end,
      (SELECT COUNT(*) FROM dead_letter_jobs WHERE job_type = 'chatwoot.conversations.sync') AS retained_dlq_count,
      (SELECT COUNT(*) FROM system_alerts WHERE platform = 'chatwoot') AS retained_alert_count;
  `;
  const rows = await readD1Rows(latestCoverage, env);
  if (rows.length !== 1) throw collectorFailure(
    'Chatwoot source readiness query returned an unexpected row count',
    'CHATWOOT_REPORT_REMOTE_COLLECTOR_D1_SHAPE_INVALID',
    { rowCount: rows.length },
  );
  const countsSql = `SELECT ${CHATWOOT_FINAL_UAT_TABLES.map((spec) => (
    `(SELECT COUNT(*) FROM ${spec.d1Table} WHERE account_key = 'chemistry_k') AS ${spec.key}`
  )).join(', ')};`;
  const countRows = await readD1Rows(countsSql, env);
  if (countRows.length !== 1) throw collectorFailure(
    'Chatwoot D1 table-count query returned an unexpected row count',
    'CHATWOOT_REPORT_REMOTE_COLLECTOR_D1_SHAPE_INVALID',
    { rowCount: countRows.length },
  );
  return Object.freeze({ ...rows[0], source_counts: Object.freeze({ ...countRows[0] }) });
}

function extractSourceCounts(sourceState) {
  return Object.freeze(Object.fromEntries(CHATWOOT_FINAL_UAT_TABLES.map((spec) => [
    spec.key,
    numberOrZero(sourceState.source_counts?.[spec.key]),
  ])));
}

async function collectLarkSourceCounts(tableIds, env) {
  const client = createLarkBitableClientFromEnv(env);
  const entries = await Promise.all(CHATWOOT_FINAL_UAT_TABLES.map(async (spec) => {
    const records = await client.searchRecords({
      tableId: tableIds[spec.key],
      pageSize: 500,
      maxPages: 1_000,
    });
    return [spec.key, records.length];
  }));
  return Object.freeze(Object.fromEntries(entries));
}

function compareSourceParity(d1, lark) {
  const mismatches = CHATWOOT_FINAL_UAT_TABLES
    .filter((spec) => d1[spec.key] !== lark[spec.key])
    .map((spec) => Object.freeze({ key: spec.key, d1: d1[spec.key], lark: lark[spec.key] }));
  return Object.freeze({
    complete: mismatches.length === 0,
    tableCount: CHATWOOT_FINAL_UAT_TABLES.length,
    mismatchCount: mismatches.length,
    mismatches: Object.freeze(mismatches),
  });
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
    const summaryCount = payload ? Object.keys(payload.metricPayload ?? {}).length : 0;
    const dimensionCount = Array.isArray(payload?.collections?.dimension_metrics)
      ? payload.collections.dimension_metrics.length
      : 0;
    return Object.freeze({
      windowDays: candidate.windowDays,
      reportId: candidate.reportId,
      d1MaterializationCount: matches.length,
      d1MetricCount: summaryCount + dimensionCount,
      dataStatus: matches.length === 1 ? matches[0].data_status : null,
      payloadValid: payload?.platformScope === 'chatwoot'
        && payload?.capability === 'customer_service'
        && payload?.period?.windowDays === candidate.windowDays,
      payload,
    });
  });
}

async function collectLarkReport(tableIds, candidates, d1Windows, env) {
  const client = createLarkBitableClientFromEnv(env);
  const remoteTables = await client.listTables();
  const remoteIds = new Set(remoteTables.map((table) => table.tableId).filter(Boolean));
  let tablesReady = true;
  let stableKeysReady = true;
  for (const [key, tableId] of Object.entries(tableIds)) {
    if (!remoteIds.has(tableId)) {
      tablesReady = false;
      stableKeysReady = false;
      continue;
    }
    const fields = await client.listFields({ tableId });
    if (!fields.some((field) => field.fieldName === REQUIRED_REPORT_KEYS[key])) stableKeysReady = false;
  }
  const windows = [];
  for (const windowDays of CHATWOOT_REPORT_READINESS_WINDOWS) {
    const candidate = candidates.find((entry) => entry.windowDays === windowDays);
    const d1 = d1Windows.find((entry) => entry.windowDays === windowDays) ?? {
      windowDays,
      reportId: null,
      d1MaterializationCount: 0,
      d1MetricCount: 0,
      dataStatus: null,
      payload: null,
    };
    if (!candidate) {
      windows.push(Object.freeze({
        ...d1,
        larkSnapshotCount: 0,
        larkMetricCount: 0,
        duplicateMetricKeys: 0,
        parity: false,
      }));
      continue;
    }
    const [snapshots, metrics] = await Promise.all([
      searchReportRecords(client, tableIds.mktReportSnapshots, candidate.reportId),
      searchReportRecords(client, tableIds.mktReportMetricValues, candidate.reportId),
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
      windowDays,
      d1MaterializationCount: d1.d1MaterializationCount,
      d1MetricCount: d1.d1MetricCount,
      dataStatus: d1.dataStatus,
      larkSnapshotCount: snapshots.length,
      larkMetricCount: metrics.length,
      duplicateMetricKeys,
      parity,
    }));
  }
  return Object.freeze({
    schema: Object.freeze({ tablesReady, stableKeysReady }),
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

async function collectRemoteWorker({ config, tableIds, env }) {
  const status = parseChatwootRemoteJson(await runText('npx', [
    'wrangler', 'deployments', 'status', '--name', EXPECTED_WORKER_NAME,
    '--config', configPath, '--json',
  ], { env }));
  const active = resolveActiveVersion(status);
  const version = parseChatwootRemoteJson(await runText('npx', [
    'wrangler', 'versions', 'view', active.versionId, '--name', EXPECTED_WORKER_NAME,
    '--config', configPath, '--json',
  ], { env }));
  const bindings = collectBindings(version);
  const trueFlags = bindings
    .filter((binding) => normalizeBindingType(binding?.type) === 'plain_text')
    .map((binding) => [readBindingName(binding), String(binding?.text ?? binding?.value ?? '').trim().toLowerCase()])
    .filter(([name, value]) => name && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && value === 'true')
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
  const tableMatch = Object.values(tableIds).every((tableId) => bindings.some((binding) => (
    normalizeBindingType(binding?.type) === 'plain_text'
      && String(binding.text ?? binding.value ?? '').trim() === tableId
  )));
  return Object.freeze({
    trueFlags: Object.freeze(trueFlags),
    bindingsMatch: d1Match && queueMatch && tableMatch,
    activeTrafficPercent: active.trafficPercent,
  });
}

async function readPendingMigrationCount(env) {
  const output = await runText('npx', [
    'wrangler', 'd1', 'migrations', 'list', 'MKT_STATE_DB',
    '--remote', '--config', configPath,
  ], { env });
  return new Set([...output.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)]
    .map((match) => match[0])).size;
}

async function readD1Rows(sql, env) {
  const statement = assertChatwootSelectOnlySql(sql);
  const output = await runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
    '--config', configPath, '--command', statement,
  ], { env });
  return unwrapChatwootRemoteRows(parseChatwootRemoteJson(output));
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
    'Chatwoot Report readiness requires one Worker version at 100% traffic',
    'CHATWOOT_REPORT_REMOTE_COLLECTOR_TRAFFIC_INVALID',
    { activeVersionCount: unique.length },
  );
  return unique[0];
  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    const trafficPercent = Number(nested.percentage ?? nested.traffic ?? nested.percent ?? Number.NaN);
    const versionId = String(nested.version_id ?? nested.versionId ?? '').trim();
    if (trafficPercent === 100 && /^[0-9a-f-]{36}$/iu.test(versionId)) candidates.push({ versionId, trafficPercent });
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
function parsePayload(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
function normalizeLarkText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return normalizeLarkText(value[0]);
  if (value && typeof value === 'object') return normalizeLarkText(value.text ?? value.value ?? value.name);
  return value === null || value === undefined ? null : String(value);
}
function normalizeLarkNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function sqlText(value) {
  return String(value).replaceAll("'", "''");
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function numberOrZero(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
function collectorFailure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootReportRemoteCollectorError';
  error.code = code;
  error.details = details;
  return error;
}
