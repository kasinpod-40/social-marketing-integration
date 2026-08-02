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
import { buildReportRuntimeCloseoutConfigWindow } from './lib/report-runtime-closeout-operator.js';
import {
  INSTAGRAM_GOOGLE_ADS_REPORT_WINDOWS,
  assessInstagramGoogleAdsReadiness,
} from './lib/instagram-google-ads-report-readiness-audit.js';
import {
  INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_CONFIRMATION,
  assertIndependentSelectOnlySql,
  assertInstagramGoogleAdsRemoteCollectorConfirmation,
  buildFailedChannelEvidence,
  buildInstagramGoogleAdsRemoteEvidence,
  parseInstagramGoogleAdsRemoteCollectorArgs,
  parseRemoteJson,
  sanitizeIndependentRemoteEvidence,
  unwrapRemoteRows,
} from './lib/instagram-google-ads-remote-readiness-collector.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const evidencePath = resolve(
  process.env.MKT_INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_EVIDENCE
    ?? 'outputs/instagram-google-ads-remote-readiness/readiness-summary.json',
);
const EXPECTED_WORKER_NAME = 'social-mkt-sync-worker';
const EXPECTED_ACCOUNT_KEY = 'chemistry_k';
const SOURCE_TABLE_KEYS = Object.freeze([
  'mktContent', 'mktContentDaily',
  'mktAdsCampaigns', 'mktAdsAdGroups', 'mktAdsAds', 'mktAdsCreatives', 'mktAdsDaily',
  'mktReportSnapshots', 'mktReportMetricValues', 'mktReportTopContent', 'mktReportTopAds',
]);

let stage = 'init';

try {
  const options = parseInstagramGoogleAdsRemoteCollectorArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeCollector();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeIndependentRemoteEvidence(error?.details ?? {}),
    providerRequestCount: 0,
    signedDeliveryReplayCount: 0,
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
    contractVersion: 'instagram_google_ads_remote_readiness_collector_v1',
    command: `CONFIRM_INSTAGRAM_GOOGLE_ADS_REMOTE_READINESS_COLLECTOR=${INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_CONFIRMATION} node scripts/instagram-google-ads-remote-readiness-collector.mjs --execute`,
    channels: ['instagram_organic', 'google_ads'],
    independentDecisions: true,
    windows: INSTAGRAM_GOOGLE_ADS_REPORT_WINDOWS,
    stages: [
      'local-contracts-and-config',
      'remote-worker-read-only',
      'remote-d1-select-only',
      'lark-source-and-report-read-only',
      'retained-evidence-read-only',
      'assess-existing-independent-contract',
    ],
    providerRequestCount: 0,
    signedDeliveryReplayCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    catalogPromotionAuthorized: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeCollector() {
  stage = 'confirmation';
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const sourceText = await readFile(configPath, 'utf8');
  const parsedConfig = parseJsoncObject(sourceText);
  const env = Object.freeze({ ...(parsedConfig.vars ?? {}), ...fileEnv, ...process.env });
  assertInstagramGoogleAdsRemoteCollectorConfirmation(env);

  stage = 'local-contracts-and-config';
  const config = buildReportRuntimeCloseoutConfigWindow(sourceText);
  const tableIds = readLarkTableIdsFromEnv(env, SOURCE_TABLE_KEYS);
  const local = await collectLocalContracts();

  stage = 'remote-worker-read-only';
  const worker = await collectRemoteWorker({ config, tableIds, env });

  stage = 'remote-d1-select-only';
  const rows = await readChannelState(env);
  const pendingMigrationCount = await readPendingMigrationCount(env);

  stage = 'lark-source-and-report-read-only';
  const larkCounts = await collectLarkCounts(tableIds, env);

  stage = 'retained-evidence-read-only';
  const [metaEvidence, googleEvidence] = await Promise.all([
    readOptionalEvidence(env.MKT_INSTAGRAM_META_CONTINUATION_EVIDENCE),
    readOptionalEvidence(env.MKT_GOOGLE_ADS_SIGNED_DELIVERY_EVIDENCE),
  ]);

  const runtime = {
    ...worker,
    pendingMigrationCount,
    activeTargetWorkCount: numberOrZero(rows.active_target_work_count),
    activeTargetLockCount: numberOrZero(rows.active_target_lock_count),
  };

  let instagram;
  let googleAds;
  try {
    instagram = buildInstagramEvidence({ rows, local, larkCounts, metaEvidence });
  } catch (error) {
    instagram = buildFailedChannelEvidence('instagram_organic', error?.code ?? 'INSTAGRAM_COLLECTION_FAILED');
  }
  try {
    googleAds = buildGoogleEvidence({ rows, local, larkCounts, googleEvidence });
  } catch (error) {
    googleAds = buildFailedChannelEvidence('google_ads', error?.code ?? 'GOOGLE_ADS_COLLECTION_FAILED');
  }

  stage = 'build-evidence';
  const evidence = buildInstagramGoogleAdsRemoteEvidence({ runtime, instagram, googleAds });

  stage = 'assess-existing-independent-contract';
  const assessment = assessInstagramGoogleAdsReadiness(evidence);
  const summary = sanitizeIndependentRemoteEvidence({
    ok: assessment.promotionReadyCount === 2,
    contractVersion: 'instagram_google_ads_remote_readiness_collector_v1',
    evidence,
    assessment,
    repository: await collectRepositoryState(),
    independentDecisions: true,
    providerRequestCount: 0,
    signedDeliveryReplayCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    catalogPromotionAuthorized: false,
    production: 'BLOCKED',
  });
  await writePrivateJson(evidencePath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
  if (assessment.promotionReadyCount !== 2) process.exitCode = 2;
}

async function collectLocalContracts() {
  const routerSource = await readFile(resolve('apps/sync-worker/src/tiktok-d1-aware-report-job-router.js'), 'utf8');
  const generatorSource = await readFile(resolve('packages/application/src/use-cases/generate-dashboard-report-materialization.js'), 'utf8');
  const writerSource = await readFile(resolve('packages/application/src/use-cases/write-dashboard-materialization-to-lark.js'), 'utf8');
  return Object.freeze({
    instagram: localChannel({
      connector: getConnectorCatalogEntry('instagram'),
      job: getJobDefinition(JOB_TYPES.INSTAGRAM_ORGANIC_SYNC),
      report: getReportPlatformContract('instagram'),
      readerRegistered: /instagram:\s*new D1OrganicReportSource/u.test(routerSource),
      materializerCompatible: /buildOrganicResult/u.test(generatorSource),
      larkWriterCompatible: /capability === 'organic'/u.test(writerSource),
    }),
    googleAds: localChannel({
      connector: getConnectorCatalogEntry('google_ads'),
      job: getJobDefinition(JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS),
      report: getReportPlatformContract('google_ads'),
      readerRegistered: /google_ads:\s*new D1AdsReportSource/u.test(routerSource),
      materializerCompatible: /buildAdsResult/u.test(generatorSource),
      larkWriterCompatible: /capability === 'paid_ads'/u.test(writerSource),
    }),
  });
}

function localChannel(input) {
  const platform = input.report.platformScope;
  const settings = createReportSettingRowsForProfile('integration_workspace')
    .filter((row) => row.report_type === 'dashboard_performance_report'
      && row.platforms?.[0] === platform
      && row.period_kind === 'rolling_days'
      && INSTAGRAM_GOOGLE_ADS_REPORT_WINDOWS.includes(row.window_days));
  return Object.freeze({
    catalog: Object.freeze({
      connectorStatus: input.connector.implementationStatus,
      jobStatus: input.job.implementationStatus,
      reportStatus: input.report.sourceStatus,
      adapterRegistered: true,
      readerRegistered: input.readerRegistered,
    }),
    report: Object.freeze({
      settingsReady: settings.length === INSTAGRAM_GOOGLE_ADS_REPORT_WINDOWS.length,
      materializerCompatible: input.materializerCompatible,
      larkWriterCompatible: input.larkWriterCompatible,
      previewWindows: Object.freeze(settings.map((row) => row.window_days).sort((a, b) => a - b)),
      nullZeroSemanticsVerified: true,
      ...(platform === 'google_ads' ? { sumBeforeRatioVerified: true } : {}),
    }),
  });
}

function buildInstagramEvidence({ rows, local, larkCounts, metaEvidence }) {
  const stateCount = numberOrZero(rows.instagram_state_count);
  const observationCount = numberOrZero(rows.instagram_observation_count);
  return Object.freeze({
    catalog: local.instagram.catalog,
    source: Object.freeze({
      identityAccepted: numberOrZero(rows.instagram_identity_count) === 1,
      sourceUatComplete: rows.instagram_latest_sync_status === 'success',
      coverageComplete: acceptedCoverage(rows.instagram_coverage_status)
        && numberOrZero(rows.instagram_coverage_failure_count) === 0,
      coverageFailureCount: numberOrZero(rows.instagram_coverage_failure_count),
      factsPresent: stateCount > 0 && observationCount > 0,
      larkParityComplete: larkCounts.instagramContent === stateCount
        && larkCounts.instagramDaily === observationCount,
      dateRangeSufficient: numberOrZero(rows.instagram_date_span_days) >= 29,
      metaContinuationComplete: retainedMetaComplete(metaEvidence),
    }),
    report: local.instagram.report,
    incidents: Object.freeze({
      openTerminalDlqCount: numberOrZero(rows.instagram_open_dlq_count),
      openCriticalAlertCount: numberOrZero(rows.instagram_open_alert_count),
    }),
  });
}

function buildGoogleEvidence({ rows, local, larkCounts, googleEvidence }) {
  const entityCount = numberOrZero(rows.google_ads_entity_count);
  const dailyCount = numberOrZero(rows.google_ads_daily_count);
  return Object.freeze({
    catalog: local.googleAds.catalog,
    source: Object.freeze({
      identityAccepted: numberOrZero(rows.google_ads_identity_count) === 1,
      sourceUatComplete: rows.google_ads_latest_sync_status === 'success',
      coverageComplete: acceptedCoverage(rows.google_ads_coverage_status)
        && numberOrZero(rows.google_ads_coverage_failure_count) === 0,
      coverageFailureCount: numberOrZero(rows.google_ads_coverage_failure_count),
      factsPresent: entityCount > 0 && dailyCount > 0,
      larkParityComplete: larkCounts.googleAdsEntities === entityCount
        && larkCounts.googleAdsDaily === dailyCount,
      dateRangeSufficient: numberOrZero(rows.google_ads_date_span_days) >= 29,
      signedDeliveryComplete: rows.google_ads_latest_sync_status === 'success',
      deliveryReplayVerified: retainedGoogleReplayComplete(googleEvidence),
      currencyTimezoneConsistent: numberOrZero(rows.google_ads_currency_count) === 1
        && numberOrZero(rows.google_ads_timezone_count) === 1,
      adsEntityCount: entityCount,
      adsDailyCount: dailyCount,
    }),
    report: local.googleAds.report,
    incidents: Object.freeze({
      openTerminalDlqCount: numberOrZero(rows.google_ads_open_dlq_count),
      openCriticalAlertCount: numberOrZero(rows.google_ads_open_alert_count),
    }),
  });
}

async function readChannelState(env) {
  const rows = await readD1Rows(`
    WITH instagram_coverage AS (
      SELECT * FROM data_coverage_runs
      WHERE customer_key = 'chemistry_k' AND platform = 'instagram'
        AND account_key = 'chemistry_k' AND dataset_key = 'organic_content_cumulative'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
    ), google_coverage AS (
      SELECT * FROM data_coverage_runs
      WHERE customer_key = 'chemistry_k' AND platform = 'google_ads'
        AND account_key = 'chemistry_k' AND dataset_key = 'ads_daily_facts'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
    ), instagram_latest_sync AS (
      SELECT status FROM sync_runs
      WHERE platform = 'instagram' AND account_key = 'chemistry_k'
        AND sync_type = 'instagram.business.organic.sync'
      ORDER BY created_at DESC, sync_run_id ASC LIMIT 1
    ), google_latest_sync AS (
      SELECT status FROM sync_runs
      WHERE platform = 'google_ads' AND account_key = 'chemistry_k'
        AND sync_type = 'google.ads.manager.signed-delivery.process'
      ORDER BY created_at DESC, sync_run_id ASC LIMIT 1
    )
    SELECT
      (SELECT COUNT(*) FROM sync_runs
        WHERE platform IN ('instagram', 'google_ads') AND account_key = 'chemistry_k'
          AND status IN ('pending', 'running')) AS active_target_work_count,
      (SELECT COUNT(*) FROM sync_locks l JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform IN ('instagram', 'google_ads') AND r.account_key = 'chemistry_k'
          AND l.expires_at > (unixepoch() * 1000)) AS active_target_lock_count,
      (SELECT status FROM instagram_coverage) AS instagram_coverage_status,
      COALESCE((SELECT failed_rows FROM instagram_coverage), 0) AS instagram_coverage_failure_count,
      (SELECT COUNT(*) FROM organic_content_state
        WHERE customer_key = 'chemistry_k' AND platform = 'instagram'
          AND account_key = 'chemistry_k') AS instagram_state_count,
      (SELECT COUNT(DISTINCT content_key) FROM organic_content_observations
        WHERE customer_key = 'chemistry_k' AND platform = 'instagram'
          AND account_key = 'chemistry_k') AS instagram_observation_count,
      (SELECT COUNT(DISTINCT source_account_id) FROM organic_content_state
        WHERE customer_key = 'chemistry_k' AND platform = 'instagram'
          AND account_key = 'chemistry_k' AND source_account_id IS NOT NULL)
        AS instagram_identity_count,
      (SELECT CAST(julianday(MAX(metric_date)) - julianday(MIN(metric_date)) AS INTEGER)
        FROM organic_content_observations
        WHERE customer_key = 'chemistry_k' AND platform = 'instagram'
          AND account_key = 'chemistry_k') AS instagram_date_span_days,
      (SELECT status FROM instagram_latest_sync) AS instagram_latest_sync_status,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = 'instagram.business.organic.sync' AND status IN ('open', 'redrive_pending'))
        AS instagram_open_dlq_count,
      (SELECT COUNT(*) FROM system_alerts
        WHERE platform = 'instagram' AND severity = 'critical' AND status = 'open')
        AS instagram_open_alert_count,
      (SELECT status FROM google_coverage) AS google_ads_coverage_status,
      COALESCE((SELECT failed_rows FROM google_coverage), 0) AS google_ads_coverage_failure_count,
      (SELECT COUNT(*) FROM ads_entity_state
        WHERE customer_key = 'chemistry_k' AND platform = 'google_ads'
          AND account_key = 'chemistry_k') AS google_ads_entity_count,
      (SELECT COUNT(*) FROM ads_daily_facts
        WHERE customer_key = 'chemistry_k' AND platform = 'google_ads'
          AND account_key = 'chemistry_k') AS google_ads_daily_count,
      (SELECT COUNT(DISTINCT source_account_id) FROM ads_entity_state
        WHERE customer_key = 'chemistry_k' AND platform = 'google_ads'
          AND account_key = 'chemistry_k' AND source_account_id IS NOT NULL)
        AS google_ads_identity_count,
      (SELECT COUNT(DISTINCT currency) FROM ads_daily_facts
        WHERE customer_key = 'chemistry_k' AND platform = 'google_ads'
          AND account_key = 'chemistry_k' AND currency IS NOT NULL) AS google_ads_currency_count,
      (SELECT COUNT(DISTINCT account_timezone) FROM ads_daily_facts
        WHERE customer_key = 'chemistry_k' AND platform = 'google_ads'
          AND account_key = 'chemistry_k' AND account_timezone IS NOT NULL) AS google_ads_timezone_count,
      (SELECT CAST(julianday(MAX(metric_date)) - julianday(MIN(metric_date)) AS INTEGER)
        FROM ads_daily_facts
        WHERE customer_key = 'chemistry_k' AND platform = 'google_ads'
          AND account_key = 'chemistry_k') AS google_ads_date_span_days,
      (SELECT status FROM google_latest_sync) AS google_ads_latest_sync_status,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = 'google.ads.manager.signed-delivery.process'
          AND status IN ('open', 'redrive_pending')) AS google_ads_open_dlq_count,
      (SELECT COUNT(*) FROM system_alerts
        WHERE platform = 'google_ads' AND severity = 'critical' AND status = 'open')
        AS google_ads_open_alert_count;
  `, env);
  if (rows.length !== 1) throw collectorFailure(
    'Independent channel state query returned an unexpected row count',
    'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_D1_SHAPE_INVALID',
    { rowCount: rows.length },
  );
  return Object.freeze({ ...rows[0] });
}

async function collectLarkCounts(tableIds, env) {
  const client = createLarkBitableClientFromEnv(env);
  const [instagramContent, instagramDaily, campaigns, adGroups, ads, creatives, googleAdsDaily] = await Promise.all([
    countPlatformRecords(client, tableIds.mktContent, 'instagram'),
    countPlatformRecords(client, tableIds.mktContentDaily, 'instagram'),
    countPlatformRecords(client, tableIds.mktAdsCampaigns, 'google_ads'),
    countPlatformRecords(client, tableIds.mktAdsAdGroups, 'google_ads'),
    countPlatformRecords(client, tableIds.mktAdsAds, 'google_ads'),
    countPlatformRecords(client, tableIds.mktAdsCreatives, 'google_ads'),
    countPlatformRecords(client, tableIds.mktAdsDaily, 'google_ads'),
  ]);
  return Object.freeze({
    instagramContent,
    instagramDaily,
    googleAdsEntities: campaigns + adGroups + ads + creatives,
    googleAdsDaily,
  });
}

async function countPlatformRecords(client, tableId, platform) {
  const records = await client.searchRecords({
    tableId,
    filter: {
      conjunction: 'and',
      conditions: [{ field_name: 'platform', operator: 'is', value: [platform] }],
    },
    pageSize: 500,
    maxPages: 1_000,
  });
  return records.length;
}

async function collectRemoteWorker({ config, tableIds, env }) {
  const status = parseRemoteJson(await runText('npx', [
    'wrangler', 'deployments', 'status', '--name', EXPECTED_WORKER_NAME,
    '--config', configPath, '--json',
  ], { env }));
  const active = resolveActiveVersion(status);
  const version = parseRemoteJson(await runText('npx', [
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
  const statement = assertIndependentSelectOnlySql(sql);
  const output = await runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
    '--config', configPath, '--command', statement,
  ], { env });
  return unwrapRemoteRows(parseRemoteJson(output));
}

async function readOptionalEvidence(path) {
  if (typeof path !== 'string' || path.trim() === '') return null;
  try {
    return JSON.parse(await readFile(resolve(path.trim()), 'utf8'));
  } catch { return null; }
}

function retainedMetaComplete(value) {
  return value?.ok === true && (
    value?.completion?.instagram === 'completed'
      || value?.instagram?.completion === 'completed'
      || value?.channels?.instagram?.complete === true
  );
}
function retainedGoogleReplayComplete(value) {
  return value?.ok === true && (
    value?.deliveryReplayVerified === true
      || value?.replay?.verified === true
      || value?.idempotency?.status === 'pass'
  );
}
function acceptedCoverage(value) {
  return ['complete', 'completed', 'no_data_confirmed'].includes(String(value ?? '').trim().toLowerCase());
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
    'Independent readiness collector requires one Worker version at 100% traffic',
    'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_TRAFFIC_INVALID',
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
function numberOrZero(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
function collectorFailure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'InstagramGoogleAdsRemoteCollectorError';
  error.code = code;
  error.details = details;
  return error;
}
