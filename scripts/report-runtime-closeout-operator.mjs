#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import { rebaseGeneratedWranglerConfigPaths } from './lib/rebase-generated-wrangler-config-paths.js';
import {
  REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
  REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  assertReportRuntimeCloseoutCompletion,
  assertReportRuntimeCloseoutConfirmation,
  assertReportRuntimeCloseoutPreflight,
  assertReportRuntimeCloseoutReplay,
  assertReportRuntimeFinalizerEvidence,
  buildReportRuntimeCloseoutCandidates,
  buildReportRuntimeCloseoutConfigWindow,
  parseReportRuntimeCloseoutArgs,
  safeReportRuntimeCloseoutEvidence,
  selectFreshReportRuntimeCloseoutCandidate,
} from './lib/report-runtime-closeout-operator.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
const outputRoot = resolve(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR ?? 'outputs/report-runtime-closeout');
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? 'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
);
const REQUIRED_LARK_KEY_FIELDS = Object.freeze({
  mktReportSnapshots: 'report_id',
  mktReportMetricValues: 'report_metric_key',
  mktReportTopContent: 'report_content_key',
  mktSyncLog: 'sync_id',
  mktSystemAlerts: 'alert_id',
});
let currentStage = 'init';
let activeDeploymentAttempted = false;
let safeRestoreVerified = false;
let loaded = null;

try {
  const options = parseReportRuntimeCloseoutArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeCloseout();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'REPORT_RUNTIME_CLOSEOUT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: safeReportRuntimeCloseoutEvidence(error?.details ?? {}),
    activeDeploymentAttempted,
    safeRestoreVerified,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
    command: `CONFIRM_REPORT_RUNTIME_CLOSEOUT=${REPORT_RUNTIME_CLOSEOUT_CONFIRMATION} node scripts/report-runtime-closeout-operator.mjs --execute`,
    scope: 'TikTok Organic rolling preset materialization from D1 to Lark',
    stages: [
      'repository-and-finalizer-evidence',
      'lark-and-d1-preflight',
      'remote-safe-preflight-and-backup',
      'deploy-report-only-window',
      'send-one-materialization',
      'verify-d1-and-lark',
      'replay-same-job',
      'verify-idempotency',
      'restore-all-false',
      'closeout-summary',
    ],
    activeTrueFlags: REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
    safety: {
      connectorsEnabled: false,
      providerCalls: false,
      aiEnabled: false,
      schedulesEnabled: false,
      production: false,
      businessFactDeletion: false,
      automaticSafeRestore: true,
    },
  }, null, 2)}\n`);
}

async function executeCloseout() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertReportRuntimeCloseoutConfirmation(env);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });

  currentStage = 'repository-and-finalizer-evidence';
  const repository = await assertRepositoryState();
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository.head !== repository.head) {
    throw failure(
      'Report closeout requires finalizer evidence from the current main HEAD',
      'REPORT_RUNTIME_CLOSEOUT_FINALIZER_HEAD_MISMATCH',
      { evidenceHead: finalizerEvidence.repository.head, repositoryHead: repository.head },
    );
  }

  const sourceText = await readFile(configPath, 'utf8');
  const config = buildReportRuntimeCloseoutConfigWindow(sourceText);
  const auth = await resolveCloudflareSession(env, sourceText);
  const queue = await resolveQueue(auth.accountId, auth.token, config.mainQueueName);
  loaded = Object.freeze({ repository, env, config, auth, queue });

  currentStage = 'lark-and-d1-preflight';
  const client = createLarkBitableClientFromEnv(env);
  const larkPreflight = await verifyLarkInventory(client, config.tableIds);
  const d1Preflight = await readD1Preflight(config);
  assertReportRuntimeCloseoutPreflight(d1Preflight);
  const requestedAt = Date.now();
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt,
    periodEnd: d1Preflight.period_end,
    sourceWatermark: d1Preflight.source_watermark,
    timeZone: 'Asia/Bangkok',
  });
  const existingIds = await readExistingReportIds(config, candidates.map((candidate) => candidate.reportId));
  const selected = selectFreshReportRuntimeCloseoutCandidate(candidates, existingIds);
  const snapshotBefore = await readD1Snapshot(config, selected, requestedAt);
  if (Number(snapshotBefore.materialization_count ?? 0) !== 0) {
    throw failure(
      'Selected Report closeout materialization is not fresh',
      'REPORT_RUNTIME_CLOSEOUT_SNAPSHOT_NOT_FRESH',
      { reportId: selected.reportId },
    );
  }
  const larkBefore = await readLarkReportCounts(client, config.tableIds, selected.reportId);
  if (larkBefore.snapshots !== 0 || larkBefore.metrics !== 0 || larkBefore.topContent !== 0) {
    throw failure(
      'Selected Report closeout identity already exists in Lark',
      'REPORT_RUNTIME_CLOSEOUT_LARK_SNAPSHOT_NOT_FRESH',
      { reportId: selected.reportId, counts: larkBefore },
    );
  }

  currentStage = 'remote-safe-preflight-and-backup';
  const pendingMigrations = await readPendingMigrations(config);
  if (pendingMigrations.length > 0) throw failure(
    `Pending migrations block Report closeout: ${pendingMigrations.join(', ')}`,
    'REPORT_RUNTIME_CLOSEOUT_PENDING_MIGRATIONS',
    { pendingMigrations },
  );
  const safeBundle = await buildBundle(config.safeText, 'safe-preflight');
  const activeBundle = await buildBundle(config.activeText, 'active-preflight');
  const remoteSafe = await verifyRemoteDeployment(config, 'safe');
  const backup = await createD1Backup(config, selected);

  let firstCompletion = null;
  let firstLark = null;
  let replayCompletion = null;
  let replayLark = null;
  let activeDeployment = null;
  let restoreDeployment = null;
  let primaryError = null;
  try {
    currentStage = 'deploy-report-only-window';
    await writeAttempt('deploy-active', {
      repositoryHead: repository.head,
      expectedActiveVersion: remoteSafe.activeVersion,
      configSha256: config.activeSha256,
      selectedReportId: selected.reportId,
    });
    activeDeployment = await deployConfig(config.activeText, 'report-closeout-active');
    activeDeploymentAttempted = true;
    await verifyRemoteDeployment(config, 'active', activeDeployment.versionId);

    currentStage = 'send-one-materialization';
    await writeAttempt('send-first', {
      reportId: selected.reportId,
      jobSha256: sha256(stableJson(selected.job)),
      requestedAt,
    });
    await sendQueueMessage(auth, queue.queueId, selected.job);

    currentStage = 'verify-d1-and-lark';
    firstCompletion = await pollD1Completion(config, selected, requestedAt, 1);
    assertReportRuntimeCloseoutCompletion(firstCompletion, { reportId: selected.reportId });
    firstLark = await pollLarkCompletion(client, config.tableIds, selected.reportId);
    assertLarkCompletion(firstLark);

    currentStage = 'replay-same-job';
    await writeAttempt('send-replay', {
      reportId: selected.reportId,
      jobSha256: sha256(stableJson(selected.job)),
      requestedAt,
    });
    await sendQueueMessage(auth, queue.queueId, selected.job);

    currentStage = 'verify-idempotency';
    replayCompletion = await pollD1Completion(config, selected, requestedAt, 2);
    assertReportRuntimeCloseoutCompletion(replayCompletion, { reportId: selected.reportId });
    assertReportRuntimeCloseoutReplay(firstCompletion, replayCompletion);
    replayLark = await pollLarkCompletion(client, config.tableIds, selected.reportId);
    assertLarkReplay(firstLark, replayLark);
  } catch (error) {
    primaryError = error;
  } finally {
    if (activeDeploymentAttempted) {
      currentStage = 'restore-all-false';
      try {
        await writeAttempt('restore-safe', {
          repositoryHead: repository.head,
          configSha256: config.safeSha256,
          activeVersion: activeDeployment?.versionId ?? null,
        });
        restoreDeployment = await deployConfig(config.safeText, 'report-closeout-safe-restore');
        await verifyRemoteDeployment(config, 'safe', restoreDeployment.versionId);
        safeRestoreVerified = true;
      } catch (restoreError) {
        if (primaryError) {
          throw failure(
            'Report closeout failed and automatic all-false restore also failed',
            'REPORT_RUNTIME_CLOSEOUT_RESTORE_FAILED_AFTER_PRIMARY_ERROR',
            {
              primaryCode: primaryError?.code ?? 'UNKNOWN',
              restoreCode: restoreError?.code ?? 'UNKNOWN',
            },
          );
        }
        throw restoreError;
      }
    }
  }
  if (primaryError) throw primaryError;
  if (!safeRestoreVerified) throw failure(
    'Report closeout requires verified all-false restore',
    'REPORT_RUNTIME_CLOSEOUT_RESTORE_NOT_VERIFIED',
  );

  currentStage = 'closeout-summary';
  const summary = safeReportRuntimeCloseoutEvidence({
    ok: true,
    contractVersion: REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
    decision: 'REPORT_WORKSTREAM_CLOSED',
    repository,
    finalizerEvidence: {
      contractVersion: finalizerEvidence.contractVersion,
      schemaReadbackActions: finalizerEvidence.schema.readbackActions,
      schemaConflicts: finalizerEvidence.schema.conflicts,
      canonicalSettingsActive: finalizerEvidence.settings.canonicalActive,
    },
    target: {
      environment: 'development',
      customerProfile: 'integration_workspace',
      platform: 'tiktok',
      accountKey: 'chemistry_k',
      reportSettingKey: selected.reportSettingKey,
      reportId: selected.reportId,
      windowDays: selected.windowDays,
      period: selected.period,
      sourceWatermark: d1Preflight.source_watermark,
    },
    preflight: {
      lark: larkPreflight,
      d1: {
        coverageStatus: d1Preflight.coverage_status,
        contentStateCount: Number(d1Preflight.content_state_count),
        observationCount: Number(d1Preflight.observation_count),
      },
      pendingMigrations,
      safeBundleSha256: safeBundle.sha256,
      activeBundleSha256: activeBundle.sha256,
      backup,
    },
    materialization: {
      dataStatus: firstCompletion.data_status,
      payloadChecksum: firstCompletion.payload_checksum,
      d1MaterializationCount: Number(firstCompletion.materialization_count),
      firstSyncRunCount: Number(firstCompletion.successful_sync_count),
      larkRows: firstLark,
    },
    replay: {
      sameReportId: firstCompletion.report_id === replayCompletion.report_id,
      samePayloadChecksum: firstCompletion.payload_checksum === replayCompletion.payload_checksum,
      d1MaterializationCount: Number(replayCompletion.materialization_count),
      successfulSyncRunCount: Number(replayCompletion.successful_sync_count),
      larkRowsUnchanged: stableJson(firstLark) === stableJson(replayLark),
    },
    runtime: {
      activeTrueFlags: REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS,
      restoredAllFalse: true,
      finalWorkerVersion: restoreDeployment.versionId,
      aiSummaryEnabled: false,
      dailyScheduleEnabled: false,
      weeklyScheduleEnabled: false,
      connectorFlagsEnabled: false,
      providerCalls: 0,
      production: false,
    },
    scopeBoundary: {
      activeSourceVerified: 'tiktok',
      uatPendingSourcesRemainConnectorGated: ['facebook', 'instagram', 'meta_ads', 'google_ads'],
      plannedSourcesRemainUnavailable: ['tiktok_ads'],
      schedulesAndAiAreNotRequiredToCloseReportCore: true,
    },
  });
  const evidencePath = join(outputRoot, 'report-runtime-closeout-summary.json');
  await writePrivateJson(evidencePath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
}

async function assertRepositoryState() {
  await run('git', ['fetch', 'origin', 'main', '--quiet']);
  const [branch, head, originMainHead, dirty] = await Promise.all([
    runText('git', ['branch', '--show-current']),
    runText('git', ['rev-parse', 'HEAD']),
    runText('git', ['rev-parse', 'origin/main']),
    runText('git', ['status', '--porcelain', '--untracked-files=all'], { trim: false }),
  ]);
  if (branch !== 'main' || head !== originMainHead || dirty.trim() !== '') throw failure(
    'Report closeout requires a clean current main checkout equal to origin/main',
    'REPORT_RUNTIME_CLOSEOUT_REPOSITORY_STATE_INVALID',
    { branch, head, originMainHead, clean: dirty.trim() === '' },
  );
  return Object.freeze({ branch, head, originMainHead, clean: true });
}

async function resolveCloudflareSession(env, sourceText) {
  const cleanEnv = { ...env };
  for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL']) {
    if (!String(cleanEnv[key] ?? '').trim()) delete cleanEnv[key];
  }
  const whoami = await runText('npx', ['wrangler', 'whoami', '--json'], { env: cleanEnv });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: cleanEnv.CLOUDFLARE_ACCOUNT_ID,
    configText: sourceText,
    whoamiOutput: whoami,
  });
  const selectedEnv = { ...cleanEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
  await runText('npx', ['wrangler', 'whoami', '--account', accountId, '--json'], { env: selectedEnv });
  const authOutput = selectedEnv.CLOUDFLARE_API_TOKEN
    ? null
    : await runText('npx', ['wrangler', 'auth', 'token', '--json'], { env: selectedEnv });
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: selectedEnv.CLOUDFLARE_API_TOKEN,
    authOutput,
  });
  return Object.freeze({ accountId, token: auth.token, source: auth.source });
}

async function resolveQueue(accountId, token, expectedName) {
  const matches = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/queues?page=${page}&per_page=100`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true || !Array.isArray(body.result)) throw failure(
      `Cloudflare Queue inventory read failed (HTTP ${response.status})`,
      'REPORT_RUNTIME_CLOSEOUT_QUEUE_READ_FAILED',
      { status: response.status },
    );
    for (const item of body.result) {
      const name = String(item.queue_name ?? item.name ?? '').trim();
      if (name === expectedName) matches.push({
        queueId: String(item.queue_id ?? item.id ?? '').trim(),
        queueName: name,
      });
    }
    totalPages = Number(body.result_info?.total_pages ?? 1);
    page += 1;
  } while (page <= totalPages);
  if (matches.length !== 1 || !matches[0].queueId) throw failure(
    `Expected exactly one Cloudflare Queue named ${expectedName}`,
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_TARGET_INVALID',
    { matchCount: matches.length },
  );
  return Object.freeze(matches[0]);
}

async function verifyLarkInventory(client, tableIds) {
  const remoteTables = await client.listTables();
  const remoteIds = new Set(remoteTables.map((item) => String(item?.table_id ?? item?.tableId ?? item?.id ?? '')).filter(Boolean));
  const fieldCounts = {};
  for (const [key, tableId] of Object.entries(tableIds)) {
    if (!remoteIds.has(tableId)) throw failure(
      `Report closeout Lark table is missing: ${key}`,
      'REPORT_RUNTIME_CLOSEOUT_LARK_TABLE_MISSING',
      { tableKey: key },
    );
    const fields = await client.listFields({ tableId });
    fieldCounts[key] = fields.length;
    const keyField = REQUIRED_LARK_KEY_FIELDS[key];
    if (!fields.some((field) => (field?.field_name ?? field?.fieldName ?? field?.name) === keyField)) throw failure(
      `Report closeout Lark key field is missing: ${key}.${keyField}`,
      'REPORT_RUNTIME_CLOSEOUT_LARK_KEY_FIELD_MISSING',
      { tableKey: key, fieldName: keyField },
    );
  }
  return Object.freeze({
    tableCount: Object.keys(tableIds).length,
    fieldCountFingerprint: sha256(stableJson(fieldCounts)),
    metadataMutationCount: 0,
  });
}

async function readD1Preflight(config) {
  const sql = compactSql(`
    WITH coverage AS (
      SELECT status, source_watermark, completed_at
      FROM data_coverage_runs
      WHERE customer_key = 'chemistry_k'
        AND platform = 'tiktok'
        AND account_key = 'chemistry_k'
        AND dataset_key = 'organic_content_cumulative'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, coverage_run_id ASC LIMIT 1
    )
    SELECT
      (SELECT status FROM coverage) AS coverage_status,
      (SELECT source_watermark FROM coverage) AS source_watermark,
      (SELECT MAX(metric_date) FROM organic_content_observations
        WHERE customer_key = 'chemistry_k' AND platform = 'tiktok' AND account_key = 'chemistry_k') AS period_end,
      (SELECT COUNT(*) FROM organic_content_state
        WHERE customer_key = 'chemistry_k' AND platform = 'tiktok' AND account_key = 'chemistry_k') AS content_state_count,
      (SELECT COUNT(*) FROM organic_content_observations
        WHERE customer_key = 'chemistry_k' AND platform = 'tiktok' AND account_key = 'chemistry_k') AS observation_count,
      (SELECT COUNT(*) FROM sync_locks l
        JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = 'tiktok' AND r.account_key = 'chemistry_k'
          AND r.sync_type = 'dashboard_performance_report'
          AND l.expires_at > (unixepoch() * 1000)) AS active_report_locks,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = 'report.materialization.generate' AND status IN ('open', 'redrive_pending')) AS open_report_dlq;
  `);
  return readD1Row(config, sql);
}

async function readExistingReportIds(config, reportIds) {
  const quoted = reportIds.map((value) => `'${sqlText(value)}'`).join(', ');
  const rows = await readD1Rows(config, `SELECT report_id FROM report_materializations WHERE report_id IN (${quoted});`);
  return rows.map((row) => String(row.report_id));
}

async function readD1Snapshot(config, selected, requestedAt) {
  const reportId = sqlText(selected.reportId);
  return readD1Row(config, compactSql(`
    SELECT
      (SELECT report_id FROM report_materializations WHERE report_id = '${reportId}') AS report_id,
      (SELECT data_status FROM report_materializations WHERE report_id = '${reportId}') AS data_status,
      (SELECT payload_checksum FROM report_materializations WHERE report_id = '${reportId}') AS payload_checksum,
      (SELECT generated_at FROM report_materializations WHERE report_id = '${reportId}') AS generated_at,
      (SELECT COUNT(*) FROM report_materializations WHERE report_id = '${reportId}') AS materialization_count,
      (SELECT status FROM sync_runs
        WHERE platform = 'tiktok' AND account_key = 'chemistry_k'
          AND sync_type = 'dashboard_performance_report' AND started_at >= ${requestedAt}
        ORDER BY started_at DESC, sync_run_id DESC LIMIT 1) AS sync_status,
      (SELECT COUNT(*) FROM sync_runs
        WHERE platform = 'tiktok' AND account_key = 'chemistry_k'
          AND sync_type = 'dashboard_performance_report' AND status = 'success'
          AND started_at >= ${requestedAt}) AS successful_sync_count,
      (SELECT COUNT(*) FROM sync_locks l
        JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = 'tiktok' AND r.account_key = 'chemistry_k'
          AND r.sync_type = 'dashboard_performance_report'
          AND r.started_at >= ${requestedAt}
          AND l.expires_at > (unixepoch() * 1000)) AS active_lock_count,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = 'report.materialization.generate' AND created_at >= ${requestedAt}) AS new_dlq_count;
  `));
}

async function pollD1Completion(config, selected, requestedAt, minimumSuccessfulRuns) {
  const maxPolls = positiveInteger(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS ?? 24, 'maxPolls');
  const intervalMs = positiveInteger(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_POLL_INTERVAL_MS ?? 5_000, 'pollIntervalMs');
  let row = null;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    row = await readD1Snapshot(config, selected, requestedAt);
    if (row.report_id === selected.reportId
      && row.sync_status === 'success'
      && Number(row.successful_sync_count ?? 0) >= minimumSuccessfulRuns
      && Number(row.active_lock_count ?? 0) === 0) return row;
    if (attempt < maxPolls) await sleep(intervalMs);
  }
  throw failure(
    'Bounded verification did not observe completed Report materialization',
    'REPORT_RUNTIME_CLOSEOUT_VERIFY_TIMEOUT',
    { minimumSuccessfulRuns, lastSnapshot: safeReportRuntimeCloseoutEvidence(row ?? {}) },
  );
}

async function readLarkReportCounts(client, tableIds, reportId) {
  const counts = {};
  for (const [name, key] of [
    ['snapshots', 'mktReportSnapshots'],
    ['metrics', 'mktReportMetricValues'],
    ['topContent', 'mktReportTopContent'],
  ]) {
    const records = await client.searchRecords({
      tableId: tableIds[key],
      filter: {
        conjunction: 'and',
        conditions: [{ field_name: 'report_id', operator: 'is', value: [reportId] }],
      },
      pageSize: 500,
      maxPages: 1_000,
    });
    counts[name] = records.length;
  }
  return Object.freeze(counts);
}

async function pollLarkCompletion(client, tableIds, reportId) {
  const maxPolls = positiveInteger(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_LARK_MAX_POLLS ?? 12, 'larkMaxPolls');
  const intervalMs = positiveInteger(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_LARK_POLL_INTERVAL_MS ?? 2_500, 'larkPollIntervalMs');
  let counts = null;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    counts = await readLarkReportCounts(client, tableIds, reportId);
    if (counts.snapshots === 1 && counts.metrics > 0) return counts;
    if (attempt < maxPolls) await sleep(intervalMs);
  }
  throw failure(
    'Bounded verification did not observe Report rows in Lark',
    'REPORT_RUNTIME_CLOSEOUT_LARK_VERIFY_TIMEOUT',
    { counts },
  );
}

function assertLarkCompletion(counts) {
  if (counts.snapshots !== 1 || counts.metrics <= 0 || counts.topContent < 0) throw failure(
    'Report closeout Lark materialization is incomplete',
    'REPORT_RUNTIME_CLOSEOUT_LARK_INCOMPLETE',
    { counts },
  );
}
function assertLarkReplay(before, after) {
  if (stableJson(before) !== stableJson(after)) throw failure(
    'Report closeout replay changed Lark Stable-key row counts',
    'REPORT_RUNTIME_CLOSEOUT_LARK_REPLAY_DRIFT',
    { before, after },
  );
}

async function readPendingMigrations(config) {
  const output = await runText('npx', [
    'wrangler', 'd1', 'migrations', 'list', 'MKT_STATE_DB', '--remote', '--config', configPath,
  ], { env: loaded?.env });
  return [...new Set([...output.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)].map((match) => match[0]))].sort();
}

async function createD1Backup(config, selected) {
  const backupDir = join(outputRoot, 'backups');
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const path = join(backupDir, `report-closeout-before-${selected.windowDays}d.sql`);
  await run('npx', [
    'wrangler', 'd1', 'export', 'MKT_STATE_DB', '--remote', '--config', configPath, '--output', path,
  ], { env: loaded?.env });
  await chmod(path, 0o600);
  const bytes = await readFile(path);
  if (bytes.length === 0) throw failure('Report closeout D1 backup is empty', 'REPORT_RUNTIME_CLOSEOUT_BACKUP_EMPTY');
  return Object.freeze({
    file: relative(repositoryRoot, path),
    bytes: bytes.length,
    sha256: sha256(bytes),
    remoteMutationCount: 0,
  });
}

async function buildBundle(configText, label) {
  const outdir = await mkdtemp(join(tmpdir(), `report-closeout-${label}-`));
  try {
    const result = await withGeneratedConfig(configText, async (generatedPath) => runCapture('npx', [
      'wrangler', 'deploy', '--dry-run', '--outdir', outdir, '--config', generatedPath,
    ], { env: loaded?.env }));
    const files = await collectFiles(outdir);
    const hash = createHash('sha256');
    for (const file of files) {
      hash.update(relative(outdir, file));
      hash.update(await readFile(file));
    }
    hash.update(result.stdout);
    return Object.freeze({ sha256: hash.digest('hex'), fileCount: files.length });
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}

async function deployConfig(configText, label) {
  const result = await withGeneratedConfig(configText, async (generatedPath) => runCapture('npx', [
    'wrangler', 'deploy', '--config', generatedPath,
    '--message', `${REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION} ${label} git=${loaded.repository.head}`,
  ], { env: loaded.env }));
  const versionId = extractVersionId(result.stdout);
  return Object.freeze({ versionId, stdoutSha256: sha256(result.stdout), label });
}

async function verifyRemoteDeployment(config, mode, expectedVersionId = null) {
  const status = JSON.parse(await runText('npx', [
    'wrangler', 'deployments', 'status', '--name', 'social-mkt-sync-worker', '--config', configPath, '--json',
  ], { env: loaded?.env }));
  const activeVersion = resolveActiveVersion(status, expectedVersionId);
  const versionView = JSON.parse(await runText('npx', [
    'wrangler', 'versions', 'view', activeVersion, '--name', 'social-mkt-sync-worker', '--config', configPath, '--json',
  ], { env: loaded?.env }));
  const bindings = collectBindings(versionView);
  const trueFlags = bindings
    .filter((binding) => normalizeBindingType(binding?.type) === 'plain_text')
    .map((binding) => [readBindingName(binding), readRemoteBoolean(binding?.text ?? binding?.value)])
    .filter(([name, enabled]) => name && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && enabled)
    .map(([name]) => name)
    .sort();
  const expectedTrue = mode === 'active' ? [...REPORT_RUNTIME_CLOSEOUT_ACTIVE_TRUE_FLAGS].sort() : [];
  if (stableJson(trueFlags) !== stableJson(expectedTrue)) throw failure(
    'Remote Worker execution flags differ from the reviewed Report closeout window',
    'REPORT_RUNTIME_CLOSEOUT_REMOTE_FLAG_MISMATCH',
    { mode, expectedTrue, observedTrue: trueFlags },
  );
  const d1 = exactlyOne(bindings, (binding) => (
    readBindingName(binding) === 'MKT_STATE_DB' && normalizeBindingType(binding?.type) === 'd1'
  ), 'MKT_STATE_DB');
  const databaseId = String(d1.database_id ?? d1.databaseId ?? d1.id ?? '').toLowerCase();
  if (databaseId !== config.databaseId) throw failure(
    'Remote Worker D1 UUID differs from the reviewed Report closeout target',
    'REPORT_RUNTIME_CLOSEOUT_REMOTE_D1_MISMATCH',
  );
  const queueBinding = exactlyOne(bindings, (binding) => (
    readBindingName(binding) === 'MKT_SYNC_QUEUE' && normalizeBindingType(binding?.type) === 'queue'
  ), 'MKT_SYNC_QUEUE');
  if (String(queueBinding.queue_name ?? queueBinding.queueName ?? queueBinding.queue ?? '') !== config.mainQueueName) {
    throw failure('Remote Worker Queue differs from the reviewed target', 'REPORT_RUNTIME_CLOSEOUT_REMOTE_QUEUE_MISMATCH');
  }
  for (const [key, envName] of Object.entries(REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES)) {
    const mapping = exactlyOne(bindings, (binding) => (
      readBindingName(binding) === envName && normalizeBindingType(binding?.type) === 'plain_text'
    ), envName);
    if (String(mapping.text ?? mapping.value ?? '').trim() !== config.tableIds[key]) throw failure(
      `Remote Worker Lark mapping differs for ${envName}`,
      'REPORT_RUNTIME_CLOSEOUT_REMOTE_TABLE_MAPPING_MISMATCH',
      { envName },
    );
  }
  return Object.freeze({ activeVersion, trueFlags: Object.freeze(trueFlags), mode });
}

async function sendQueueMessage(auth, queueId, job) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(auth.accountId)}/queues/${encodeURIComponent(queueId)}/messages`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: job, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) throw failure(
    `Cloudflare Queue accepted no Report closeout message (HTTP ${response.status})`,
    'REPORT_RUNTIME_CLOSEOUT_QUEUE_SEND_FAILED',
    { status: response.status },
  );
  return true;
}

async function readD1Row(config, sql) {
  const rows = await readD1Rows(config, sql);
  if (rows.length !== 1) throw failure(
    'Report closeout D1 query returned an unexpected row count',
    'REPORT_RUNTIME_CLOSEOUT_D1_QUERY_SHAPE_INVALID',
    { rowCount: rows.length },
  );
  return Object.freeze({ ...rows[0] });
}

async function readD1Rows(config, sql) {
  const output = await runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json', '--config', configPath, '--command', sql,
  ], { env: loaded?.env });
  const parsed = JSON.parse(output);
  return Array.isArray(parsed)
    ? parsed.flatMap((item) => item?.results ?? [])
    : (parsed?.results ?? []);
}

async function withGeneratedConfig(configText, operation) {
  const directory = await mkdtemp(join(tmpdir(), 'report-closeout-config-'));
  try {
    const rebased = rebaseGeneratedWranglerConfigPaths(configText, {
      sourceDirectory: dirname(configPath),
      outputDirectory: directory,
    });
    const generatedPath = join(directory, 'wrangler.generated.json');
    await writeFile(generatedPath, rebased.text, { mode: 0o600 });
    await chmod(generatedPath, 0o600);
    return await operation(generatedPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeAttempt(name, value) {
  const path = join(outputRoot, `${name}.attempt.json`);
  try {
    await stat(path);
    throw failure(
      `A prior Report closeout ${name} attempt exists; automatic repetition is disabled`,
      'REPORT_RUNTIME_CLOSEOUT_ATTEMPT_ALREADY_EXISTS',
      { name },
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writePrivateJson(path, { ...value, attemptedAt: new Date().toISOString() });
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function collectFiles(root) {
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  await walk(root);
  return files.sort();
}

function resolveActiveVersion(value, expectedVersionId) {
  const candidates = [];
  visit(value);
  const unique = [...new Set(candidates)];
  if (expectedVersionId && !unique.includes(expectedVersionId)) throw failure(
    'Expected Report closeout deployment is not active at 100% traffic',
    'REPORT_RUNTIME_CLOSEOUT_DEPLOYMENT_NOT_ACTIVE',
    { expectedVersionId, activeVersions: unique },
  );
  if (unique.length !== 1) throw failure(
    'Report closeout requires exactly one Worker version at 100% traffic',
    'REPORT_RUNTIME_CLOSEOUT_TRAFFIC_INVALID',
    { activeVersions: unique },
  );
  return unique[0];

  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    const percentage = Number(nested.percentage ?? nested.traffic ?? nested.percent ?? NaN);
    const versionId = String(nested.version_id ?? nested.versionId ?? '').trim();
    if (percentage === 100 && /^[0-9a-f-]{36}$/iu.test(versionId)) candidates.push(versionId);
    Object.values(nested).forEach(visit);
  }
}

function collectBindings(value) {
  const arrays = [];
  visit(value);
  const selected = arrays.find((items) => items.some((item) => readBindingName(item))) ?? [];
  return selected;
  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    if (Array.isArray(nested.bindings)) arrays.push(nested.bindings);
    Object.values(nested).forEach(visit);
  }
}

function extractVersionId(stdout) {
  const labeled = String(stdout).match(/Version ID:\s*([0-9a-f-]{36})/iu)?.[1];
  if (labeled) return labeled;
  const matches = [...String(stdout).matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu)]
    .map((match) => match[0]);
  const unique = [...new Set(matches)];
  if (unique.length !== 1) throw failure(
    'Unable to resolve the exact deployed Worker Version ID',
    'REPORT_RUNTIME_CLOSEOUT_DEPLOY_VERSION_UNRESOLVED',
    { matchCount: unique.length },
  );
  return unique[0];
}

function exactlyOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) throw failure(
    `Remote Worker requires exactly one ${label} binding`,
    'REPORT_RUNTIME_CLOSEOUT_REMOTE_BINDING_INVALID',
    { label, matchCount: matches.length },
  );
  return matches[0];
}
function readBindingName(binding) { return String(binding?.name ?? binding?.binding ?? '').trim() || null; }
function normalizeBindingType(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('-', '_');
}
function readRemoteBoolean(value) {
  if (value === true || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || String(value).trim().toLowerCase() === 'false') return false;
  return null;
}
function compactSql(value) { return String(value).replace(/\s+/gu, ' ').trim(); }
function sqlText(value) { return String(value).replaceAll("'", "''"); }
function stableJson(value) { return JSON.stringify(value); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw failure(
    `${fieldName} must be a positive integer`,
    'REPORT_RUNTIME_CLOSEOUT_VALUE_INVALID',
    { fieldName },
  );
  return number;
}
function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
function failure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeCloseoutError';
  error.code = code;
  error.details = details;
  return error;
}
async function run(command, args, options = {}) { await runCapture(command, args, options); }
async function runText(command, args, options = {}) {
  const result = await runCapture(command, args, options);
  return options.trim === false ? result.stdout : result.stdout.trim();
}
async function runCapture(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
}
