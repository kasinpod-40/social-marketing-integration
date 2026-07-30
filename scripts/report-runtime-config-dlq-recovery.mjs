#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
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
  assertReportRuntimeOrganicIntegrity,
} from './lib/report-runtime-window-repair.js';
import {
  assertReportRuntimeCloseoutRecoveryEvidence,
  pollReportRuntimeLarkIntegrity,
} from './lib/report-runtime-lark-integrity-recovery.js';
import {
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  assertReportRuntimeFinalizerEvidence,
  buildReportRuntimeCloseoutCandidates,
  buildReportRuntimeCloseoutConfigWindow,
  safeReportRuntimeCloseoutEvidence,
} from './lib/report-runtime-closeout-operator.js';
import {
  REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONFIRMATION,
  REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
  REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT,
  assertReportRuntimeConfigDlqClosed,
  assertReportRuntimeConfigDlqIncident,
  assertReportRuntimeConfigDlqInitialState,
  assertReportRuntimeConfigDlqMetricRepairSummary,
  assertReportRuntimeConfigDlqRecoveryConfirmation,
  assertReportRuntimeConfigDlqRetryCompletion,
  assertReportRuntimeConfigDlqStableDeployment,
  buildReportRuntimeConfigDlqClosureStatements,
  buildReportRuntimeConfigDlqEvidenceSql,
  buildReportRuntimeConfigDlqInitialStateSql,
  buildReportRuntimeConfigDlqRetryStateSql,
} from './lib/report-runtime-config-dlq-recovery.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR
    ?? 'outputs/report-runtime-window-repair/3d-refresh',
);
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? 'outputs/report-runtime-window-repair/finalizer/report-runtime-finalize-summary.json',
);
const metricRepairSummaryPath = join(outputRoot, 'metric-null-repair-summary.json');
const summaryPath = join(outputRoot, 'report-runtime-closeout-summary.json');
const deployAttemptPath = join(outputRoot, 'config-dlq-recover-deploy-active.attempt.json');
const sendAttemptPath = join(outputRoot, 'config-dlq-retry-send.attempt.json');
const restoreAttemptPath = join(outputRoot, 'config-dlq-recover-restore-safe.attempt.json');
const closureAttemptPath = join(outputRoot, 'config-dlq-closure.attempt.json');
const STABILITY_DELAYS_MS = Object.freeze([0, 10_000, 20_000]);
let currentStage = 'init';
let activeDeploymentAttempted = false;
let safeRestoreVerified = false;
let loaded = null;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: safeReportRuntimeCloseoutEvidence(error?.details ?? {}),
    activeDeploymentAttempted,
    safeRestoreVerified,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  assertReportRuntimeConfigDlqRecoveryConfirmation(process.env);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });

  const existingSummary = await readJsonIfExists(summaryPath);
  if (existingSummary) {
    assertCompletedSummary(existingSummary);
    process.stdout.write(`${JSON.stringify({ ...existingSummary, evidencePath: summaryPath }, null, 2)}\n`);
    return;
  }

  currentStage = 'repository-finalizer-config-and-safe-preflight';
  const repository = await assertRepositoryState();
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository?.head !== repository.head) throw failure(
    'Report replay DLQ recovery requires Finalizer evidence from current main',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_FINALIZER_HEAD_MISMATCH',
  );
  const metricRepairSummary = JSON.parse(await readFile(metricRepairSummaryPath, 'utf8'));
  assertReportRuntimeConfigDlqMetricRepairSummary(metricRepairSummary);

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const sourceText = await readFile(configPath, 'utf8');
  const config = buildReportRuntimeCloseoutConfigWindow(sourceText);
  const auth = await resolveCloudflareSession(env, sourceText);
  const queue = await resolveQueue(auth.accountId, auth.token, config.mainQueueName);
  loaded = Object.freeze({ repository, env, config, auth, queue });
  const remoteSafe = await verifyRemoteDeployment(config, 'safe');
  const pendingMigrations = await readPendingMigrations();
  if (pendingMigrations.length > 0) throw failure(
    'Pending migrations block exact Report replay DLQ recovery',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_PENDING_MIGRATIONS',
    { pendingMigrations },
  );

  currentStage = 'validate-exact-incident-and-original-evidence';
  const incidentBeforeRow = await readOneD1Row(buildReportRuntimeConfigDlqEvidenceSql());
  const incidentBefore = assertReportRuntimeConfigDlqIncident(incidentBeforeRow);
  const originalState = await readOneD1Row(buildReportRuntimeConfigDlqInitialStateSql());
  const sendAttempt = await readJsonIfExists(sendAttemptPath);
  if (!sendAttempt) assertReportRuntimeConfigDlqInitialState(originalState);
  else assertResumeD1Identity(originalState);

  const deployAttempt = await readRequiredJson(join(outputRoot, 'deploy-active.attempt.json'));
  const sendFirstAttempt = await readRequiredJson(join(outputRoot, 'send-first.attempt.json'));
  const restoreAttempt = await readRequiredJson(join(outputRoot, 'restore-safe.attempt.json'));
  const originalReplayAttempt = await readRequiredJson(join(outputRoot, 'send-replay.attempt.json'));
  const requestedAt = positiveInteger(sendFirstAttempt.requestedAt, 'requestedAt');
  const preflight = await readD1CoveragePreflight();
  const candidate = buildReportRuntimeCloseoutCandidates({
    requestedAt,
    periodEnd: preflight.period_end,
    sourceWatermark: preflight.source_watermark,
    timeZone: 'Asia/Bangkok',
    platformScope: 'tiktok',
    accountKey: 'chemistry_k',
    formulaVersion: 'tiktok-organic-v1',
  }).find((item) => item.reportId === REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.reportId);
  if (!candidate) throw failure(
    'Exact 3D Report candidate cannot be regenerated from current Coverage evidence',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CANDIDATE_MISSING',
  );
  const selected = Object.freeze({ ...candidate, operation: 'refresh' });
  const recoveryEvidence = assertReportRuntimeCloseoutRecoveryEvidence({
    deployAttempt,
    sendFirstAttempt,
    restoreAttempt,
    replayAttempt: originalReplayAttempt,
    summaryExists: false,
    candidate: selected,
    activeConfigSha256: config.activeSha256,
    safeConfigSha256: config.safeSha256,
    jobSha256: sha256(stableJson(selected.job)),
  });
  assertExactSelectedJob(selected, recoveryEvidence);

  currentStage = 'verify-current-d1-lark-parity-read-only';
  const firstMaterialization = await readD1Materialization(selected.reportId);
  const client = createLarkBitableClientFromEnv(env);
  const firstVerified = await pollLarkIntegrity(client, config.tableIds, selected.reportId, firstMaterialization);
  const firstLark = firstVerified.state;
  const firstIntegrity = firstVerified.integrity;

  let retryAttempt = sendAttempt;
  let retryCompletion = null;
  let replayLark = null;
  let replayIntegrity = null;
  let replayLarkPollAttempts = null;
  let activeDeployment = null;
  let restoreDeployment = Object.freeze({ versionId: remoteSafe.activeVersion });
  let backup = retryAttempt?.backup ?? null;
  let replayMessageSent = false;
  let primaryError = null;

  if (!retryAttempt) {
    const priorDeploy = await readJsonIfExists(deployAttemptPath);
    const priorRestore = await readJsonIfExists(restoreAttemptPath);
    if (priorDeploy || priorRestore) throw failure(
      'A prior config-DLQ recovery deployment exists without a recorded retry send',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_PARTIAL_DEPLOYMENT_BLOCKED',
      {
        deployAttemptExists: priorDeploy !== null,
        restoreAttemptExists: priorRestore !== null,
      },
    );
    currentStage = 'backup-before-exact-retry';
    backup = await createD1Backup('before-config-dlq-retry');
    try {
      currentStage = 'deploy-and-stabilize-report-only-window';
      await writePrivateJson(deployAttemptPath, {
        contractVersion: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
        repositoryHead: repository.head,
        reportId: selected.reportId,
        jobSha256: recoveryEvidence.jobSha256,
        configSha256: config.activeSha256,
        backup,
        attemptedAt: new Date().toISOString(),
      });
      activeDeployment = await deployConfig(config.activeText, 'report-config-dlq-recovery-active');
      activeDeploymentAttempted = true;
      const samples = [];
      for (const delayMs of STABILITY_DELAYS_MS) {
        if (delayMs > 0) await sleep(delayMs);
        const verified = await verifyRemoteDeployment(config, 'active', activeDeployment.versionId);
        samples.push(Object.freeze({
          versionId: verified.activeVersion,
          trueFlags: verified.trueFlags,
          mode: verified.mode,
        }));
      }
      const stability = assertReportRuntimeConfigDlqStableDeployment(samples, {
        versionId: activeDeployment.versionId,
        trueFlags: config.activeTrueFlags,
      });

      currentStage = 'send-exact-replay-retry-once';
      const retryRequestedAt = Date.now();
      retryAttempt = Object.freeze({
        contractVersion: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
        repositoryHead: repository.head,
        reportId: selected.reportId,
        jobSha256: recoveryEvidence.jobSha256,
        retryRequestedAt,
        originalDlqId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.dlqId,
        activeVersionId: activeDeployment.versionId,
        stability,
        backup,
        attemptedAt: new Date().toISOString(),
      });
      await writePrivateJson(sendAttemptPath, retryAttempt);
      await sendQueueMessage(auth, queue.queueId, selected.job);
      replayMessageSent = true;

      currentStage = 'verify-exact-retry-idempotency';
      retryCompletion = await pollRetryCompletion(retryAttempt.retryRequestedAt);
      assertReportRuntimeConfigDlqRetryCompletion(retryCompletion);
      const replayVerified = await pollLarkIntegrity(client, config.tableIds, selected.reportId, retryCompletion);
      replayLark = replayVerified.state;
      replayIntegrity = replayVerified.integrity;
      replayLarkPollAttempts = replayVerified.attemptCount;
      assertLarkReplay(firstLark, replayLark);
      if (stableJson(firstIntegrity) !== stableJson(replayIntegrity)) throw failure(
        'Exact Report replay retry changed D1/Lark integrity evidence',
        'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INTEGRITY_DRIFT',
      );
    } catch (error) {
      primaryError = error;
    } finally {
      if (activeDeploymentAttempted) {
        currentStage = 'restore-all-false';
        try {
          await writePrivateJson(restoreAttemptPath, {
            contractVersion: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
            repositoryHead: repository.head,
            reportId: selected.reportId,
            configSha256: config.safeSha256,
            activeVersionId: activeDeployment?.versionId ?? null,
            attemptedAt: new Date().toISOString(),
          });
          restoreDeployment = await deployConfig(config.safeText, 'report-config-dlq-recovery-safe');
          await verifyRemoteDeployment(config, 'safe', restoreDeployment.versionId);
          safeRestoreVerified = true;
        } catch (restoreError) {
          if (primaryError) throw failure(
            'Report replay retry failed and all-false restore also failed',
            'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_RESTORE_FAILED_AFTER_PRIMARY',
            {
              primaryCode: primaryError?.code ?? 'UNKNOWN',
              restoreCode: restoreError?.code ?? 'UNKNOWN',
            },
          );
          throw restoreError;
        }
      }
    }
    if (primaryError) throw primaryError;
  } else {
    assertRetryAttempt(retryAttempt, { repository, selected, recoveryEvidence });
    currentStage = 'verification-only-after-recorded-retry';
    retryCompletion = await pollRetryCompletion(retryAttempt.retryRequestedAt);
    assertReportRuntimeConfigDlqRetryCompletion(retryCompletion);
    const replayVerified = await pollLarkIntegrity(client, config.tableIds, selected.reportId, retryCompletion);
    replayLark = replayVerified.state;
    replayIntegrity = replayVerified.integrity;
    replayLarkPollAttempts = replayVerified.attemptCount;
    assertLarkReplay(firstLark, replayLark);
    if (stableJson(firstIntegrity) !== stableJson(replayIntegrity)) throw failure(
      'Recorded Report replay retry changed D1/Lark integrity evidence',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INTEGRITY_DRIFT',
    );
    safeRestoreVerified = true;
    const safe = await verifyRemoteDeployment(config, 'safe');
    restoreDeployment = Object.freeze({ versionId: safe.activeVersion });
    backup = retryAttempt.backup;
  }

  if (!safeRestoreVerified) throw failure(
    'Exact Report replay recovery requires verified all-false Worker restore',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_SAFE_RESTORE_REQUIRED',
  );

  currentStage = 'close-exact-retained-dlq-metadata';
  const currentIncidentRow = await readOneD1Row(buildReportRuntimeConfigDlqEvidenceSql());
  const currentIncident = assertReportRuntimeConfigDlqIncident(currentIncidentRow);
  if (!currentIncident.alreadyClosed) {
    const priorClosureAttempt = await readJsonIfExists(closureAttemptPath);
    if (!priorClosureAttempt) await writePrivateJson(closureAttemptPath, {
      contractVersion: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
      repositoryHead: repository.head,
      reportId: selected.reportId,
      retryRequestedAt: retryAttempt.retryRequestedAt,
      retryCompletion: summarizeCompletion(retryCompletion),
      originalDlqId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.dlqId,
      backup,
      attemptedAt: new Date().toISOString(),
    });
    else assertClosureAttempt(priorClosureAttempt, { repository, selected, retryAttempt });
    for (const statement of buildReportRuntimeConfigDlqClosureStatements()) await readD1Rows(statement);
  }
  const incidentAfterRow = await readOneD1Row(buildReportRuntimeConfigDlqEvidenceSql());
  assertReportRuntimeConfigDlqClosed(incidentAfterRow);
  const finalOpenDlq = await readOneD1Row(`
    SELECT COUNT(*) AS open_report_dlq FROM dead_letter_jobs
    WHERE job_type = 'report.materialization.generate' AND status IN ('open', 'redrive_pending');
  `);
  if (Number(finalOpenDlq.open_report_dlq) !== 0) throw failure(
    'Open Report DLQ rows remain after exact incident closure',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_OPEN_DLQ_REMAINS',
    { openReportDlq: Number(finalOpenDlq.open_report_dlq) },
  );

  currentStage = 'write-verified-3d-closeout-summary';
  const summary = Object.freeze({
    ok: true,
    contractVersion: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
    decision: 'REPORT_WINDOW_REFRESHED',
    repository,
    target: Object.freeze({
      environment: 'development',
      customerProfile: 'integration_workspace',
      platform: 'tiktok',
      accountKey: 'chemistry_k',
      operation: 'refresh',
      reportSettingKey: selected.reportSettingKey,
      reportId: selected.reportId,
      windowDays: selected.windowDays,
      period: selected.period,
      sourceWatermark: preflight.source_watermark,
    }),
    materialization: Object.freeze({
      dataStatus: firstMaterialization.data_status,
      payloadChecksum: firstMaterialization.payload_checksum,
      d1MaterializationCount: Number(firstMaterialization.materialization_count),
      firstSyncRunCount: 1,
      larkRows: summarizeLarkState(firstLark),
      larkIntegrityPollAttempts: firstVerified.attemptCount,
      integrity: firstIntegrity,
    }),
    replay: Object.freeze({
      sameReportId: retryCompletion.report_id === selected.reportId,
      samePayloadChecksum: retryCompletion.payload_checksum === firstMaterialization.payload_checksum,
      d1MaterializationCount: Number(retryCompletion.materialization_count),
      successfulSyncRunCount: Number(retryCompletion.successful_sync_count),
      larkRowsUnchanged: stableJson(firstLark) === stableJson(replayLark),
      integrityUnchanged: stableJson(firstIntegrity) === stableJson(replayIntegrity),
      larkIntegrityPollAttempts: replayLarkPollAttempts,
    }),
    recovery: Object.freeze({
      mode: 'exact_configuration_dlq_retry_v1',
      originalRepositoryHead: recoveryEvidence.originalRepositoryHead,
      firstMaterializationRetried: false,
      originalReplayMessageSent: true,
      originalReplayDlqId: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.dlqId,
      originalReplayErrorCode: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.errorCode,
      retryMessageSentThisRun: replayMessageSent,
      verificationOnly: !replayMessageSent,
      deploymentStabilizationSamples: Number(retryAttempt.stability?.sampleCount ?? 0),
      retainedDlqStatus: incidentAfterRow.status,
      retainedDlqRecoveryStatus: incidentAfterRow.recovery_status,
      backup,
    }),
    runtime: Object.freeze({
      activeTrueFlags: config.activeTrueFlags,
      restoredAllFalse: true,
      finalWorkerVersion: restoreDeployment.versionId,
      aiSummaryEnabled: false,
      dailyScheduleEnabled: false,
      weeklyScheduleEnabled: false,
      connectorFlagsEnabled: false,
      providerCalls: 0,
      production: false,
    }),
  });
  await writePrivateJson(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: summaryPath }, null, 2)}\n`);
}

function assertCompletedSummary(summary) {
  if (summary.ok !== true
    || summary.contractVersion !== REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION
    || summary.decision !== 'REPORT_WINDOW_REFRESHED'
    || summary.target?.reportId !== REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.reportId
    || Number(summary.target?.windowDays) !== 3
    || summary.replay?.sameReportId !== true
    || summary.replay?.samePayloadChecksum !== true
    || Number(summary.replay?.d1MaterializationCount) !== 1
    || summary.replay?.larkRowsUnchanged !== true
    || summary.replay?.integrityUnchanged !== true
    || summary.runtime?.restoredAllFalse !== true
    || summary.runtime?.production !== false) {
    throw failure(
      'Existing exact Report config-DLQ recovery summary is invalid',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_SUMMARY_INVALID',
    );
  }
}

function assertResumeD1Identity(row) {
  const incident = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;
  if (row.report_id !== incident.reportId
    || row.payload_checksum !== incident.payloadChecksum
    || Number(row.materialization_count) !== 1
    || Number(row.successful_sync_count) < 1
    || Number(row.active_lock_count) !== 0
    || Number(row.exact_incident_count) !== 1
    || Number(row.other_open_report_dlq) !== 0) {
    throw failure(
      'Recorded retry recovery D1 identity is no longer exact',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_RESUME_STATE_INVALID',
      { successfulSyncCount: Number(row.successful_sync_count ?? 0) },
    );
  }
}

function assertExactSelectedJob(selected, recoveryEvidence) {
  const incident = REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT;
  if (selected.reportId !== incident.reportId
    || selected.windowDays !== incident.windowDays
    || selected.operation !== incident.operation
    || selected.job?.type !== incident.jobType
    || selected.job?.trigger !== 'dashboard_preset'
    || selected.job?.periodKind !== 'rolling_days'
    || selected.job?.reportRequestId !== undefined
    || Date.parse(selected.job?.requestedAt) !== incident.originalRequestedAt
    || recoveryEvidence.replayAttempted !== true) {
    throw failure(
      'Reconstructed Report replay job differs from the exact failed configuration incident',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_JOB_INVALID',
    );
  }
}

function assertRetryAttempt(attempt, input) {
  if (attempt?.contractVersion !== REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION
    || attempt.repositoryHead !== input.repository.head
    || attempt.reportId !== input.selected.reportId
    || attempt.jobSha256 !== input.recoveryEvidence.jobSha256
    || attempt.originalDlqId !== REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.dlqId
    || !Number.isSafeInteger(Number(attempt.retryRequestedAt))
    || !attempt.backup?.sha256) {
    throw failure(
      'Recorded Report replay retry attempt differs from the exact incident',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_RETRY_ATTEMPT_INVALID',
    );
  }
}

function assertClosureAttempt(attempt, input) {
  if (attempt?.contractVersion !== REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION
    || attempt.repositoryHead !== input.repository.head
    || attempt.reportId !== input.selected.reportId
    || Number(attempt.retryRequestedAt) !== Number(input.retryAttempt.retryRequestedAt)
    || attempt.originalDlqId !== REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.dlqId) {
    throw failure(
      'Recorded Report DLQ closure attempt differs from the exact recovery',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CLOSURE_ATTEMPT_INVALID',
    );
  }
}

async function pollRetryCompletion(retryRequestedAt) {
  const maxPolls = positiveInteger(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS ?? 24, 'maxPolls');
  const intervalMs = positiveInteger(
    process.env.MKT_REPORT_RUNTIME_CLOSEOUT_POLL_INTERVAL_MS ?? 5_000,
    'pollIntervalMs',
  );
  let row = null;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    row = await readOneD1Row(buildReportRuntimeConfigDlqRetryStateSql(retryRequestedAt));
    try {
      assertReportRuntimeConfigDlqRetryCompletion(row);
      return row;
    } catch (error) {
      if (attempt === maxPolls || Number(row.new_dlq_count ?? 0) > 0) throw error;
      await sleep(intervalMs);
    }
  }
  return row;
}

async function pollLarkIntegrity(client, tableIds, reportId, d1) {
  return pollReportRuntimeLarkIntegrity({
    readState: () => readLarkReportState(client, tableIds, reportId),
    assertComplete: assertLarkCompletion,
    assertIntegrity: (state) => {
      let payload;
      try { payload = JSON.parse(String(d1.payload_json ?? '')); }
      catch { throw failure('Report payload_json is invalid', 'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_PAYLOAD_INVALID'); }
      return assertReportRuntimeOrganicIntegrity({ payload, larkMetrics: state.metricValues });
    },
  });
}

async function readLarkReportState(client, tableIds, reportId) {
  const recordsByName = {};
  for (const [name, key] of [
    ['snapshots', 'mktReportSnapshots'],
    ['metrics', 'mktReportMetricValues'],
    ['topContent', 'mktReportTopContent'],
  ]) {
    recordsByName[name] = await client.searchRecords({
      tableId: tableIds[key],
      filter: {
        conjunction: 'and',
        conditions: [{ field_name: 'report_id', operator: 'is', value: [reportId] }],
      },
      pageSize: 500,
      maxPages: 1_000,
    });
  }
  const metricValues = {};
  let duplicateMetricKeys = 0;
  for (const record of recordsByName.metrics) {
    const metricKey = normalizeLarkText(record?.fields?.metric_key);
    if (!metricKey) throw failure(
      'Lark Report metric row lacks metric_key',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_LARK_METRIC_KEY_MISSING',
    );
    if (Object.hasOwn(metricValues, metricKey)) duplicateMetricKeys += 1;
    metricValues[metricKey] = normalizeLarkNumber(record?.fields?.current_value);
  }
  return Object.freeze({
    snapshots: recordsByName.snapshots.length,
    metrics: recordsByName.metrics.length,
    topContent: recordsByName.topContent.length,
    duplicateMetricKeys,
    metricValues: Object.freeze(metricValues),
  });
}

function assertLarkCompletion(state) {
  if (state.snapshots !== 1 || state.metrics !== 10 || state.topContent !== 5 || state.duplicateMetricKeys !== 0) {
    throw failure(
      'Exact 3D Lark Report materialization shape is incomplete',
      'REPORT_RUNTIME_CLOSEOUT_LARK_INCOMPLETE',
      { state: summarizeLarkState(state) },
    );
  }
}

function assertLarkReplay(before, after) {
  if (stableJson(before) !== stableJson(after)) throw failure(
    'Exact Report replay retry changed Lark Stable-key rows or values',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_LARK_REPLAY_DRIFT',
    { before: summarizeLarkState(before), after: summarizeLarkState(after) },
  );
}

function summarizeLarkState(state) {
  return Object.freeze({
    snapshots: state.snapshots,
    metrics: state.metrics,
    topContent: state.topContent,
    duplicateMetricKeys: state.duplicateMetricKeys,
  });
}

function summarizeCompletion(row) {
  return Object.freeze({
    reportId: row.report_id,
    payloadChecksum: row.payload_checksum,
    materializationCount: Number(row.materialization_count),
    successfulSyncCount: Number(row.successful_sync_count),
    latestSyncStatus: row.latest_sync_status,
    activeLockCount: Number(row.active_lock_count),
    newDlqCount: Number(row.new_dlq_count),
  });
}

async function readD1CoveragePreflight() {
  return readOneD1Row(`
    WITH coverage AS (
      SELECT status, source_watermark, completed_at
      FROM data_coverage_runs
      WHERE customer_key = 'chemistry_k' AND platform = 'tiktok'
        AND account_key = 'chemistry_k' AND dataset_key = 'organic_content_cumulative'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, coverage_run_id ASC LIMIT 1
    )
    SELECT
      (SELECT status FROM coverage) AS coverage_status,
      (SELECT source_watermark FROM coverage) AS source_watermark,
      (SELECT MAX(metric_date) FROM organic_content_observations
        WHERE customer_key = 'chemistry_k' AND platform = 'tiktok' AND account_key = 'chemistry_k') AS period_end,
      (SELECT COUNT(*) FROM sync_locks l JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = 'tiktok' AND r.account_key = 'chemistry_k'
          AND r.sync_type = 'dashboard_performance_report'
          AND l.expires_at > (unixepoch() * 1000)) AS active_report_locks;
  `);
}

async function readD1Materialization(reportId) {
  const row = await readOneD1Row(`
    SELECT report_id, data_status, payload_checksum, payload_json, generated_at,
      (SELECT COUNT(*) FROM report_materializations WHERE report_id = '${sqlText(reportId)}') AS materialization_count
    FROM report_materializations WHERE report_id = '${sqlText(reportId)}' LIMIT 1;
  `);
  if (row.report_id !== reportId
    || row.payload_checksum !== REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.payloadChecksum
    || Number(row.materialization_count) !== 1) {
    throw failure(
      'Authoritative D1 Report materialization differs from the exact incident',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_MATERIALIZATION_INVALID',
    );
  }
  return row;
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
    'Report replay DLQ recovery requires clean current main equal to origin/main',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_REPOSITORY_INVALID',
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
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_QUEUE_READ_FAILED',
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
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_QUEUE_TARGET_INVALID',
    { matchCount: matches.length },
  );
  return Object.freeze(matches[0]);
}

async function readPendingMigrations() {
  const output = await runText('npx', [
    'wrangler', 'd1', 'migrations', 'list', 'MKT_STATE_DB', '--remote', '--config', configPath,
  ], { env: loaded?.env });
  return [...new Set([...output.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)]
    .map((match) => match[0]))].sort();
}

async function createD1Backup(label) {
  const path = join(outputRoot, 'backups', `report-${label}-${Date.now()}.sql`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await run('npx', [
    'wrangler', 'd1', 'export', 'MKT_STATE_DB', '--remote', '--config', configPath,
    '--output', path, '--skip-confirmation',
  ], { env: loaded?.env });
  await chmod(path, 0o600);
  const bytes = await readFile(path);
  if (bytes.length === 0) throw failure(
    'Report config-DLQ recovery D1 backup is empty',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_BACKUP_INVALID',
  );
  return Object.freeze({
    file: relative(repositoryRoot, path),
    bytes: bytes.length,
    sha256: sha256(bytes),
    remoteMutationCount: 0,
  });
}

async function deployConfig(configText, label) {
  const result = await withGeneratedConfig(configText, async (generatedPath) => runCapture('npx', [
    'wrangler', 'deploy', '--config', generatedPath,
    '--message', `${REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION} ${label} git=${loaded.repository.head}`,
  ], { env: loaded.env }));
  return Object.freeze({
    versionId: extractVersionId(result.stdout),
    stdoutSha256: sha256(result.stdout),
    label,
  });
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
  const expectedTrue = mode === 'active' ? [...config.activeTrueFlags].sort() : [];
  if (stableJson(trueFlags) !== stableJson(expectedTrue)) throw failure(
    'Remote Worker flags differ from exact Report replay recovery mode',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_REMOTE_FLAG_MISMATCH',
    { mode, expectedTrue, observedTrue: trueFlags },
  );
  const d1 = exactlyOne(bindings, (binding) => (
    readBindingName(binding) === 'MKT_STATE_DB' && normalizeBindingType(binding?.type) === 'd1'
  ), 'MKT_STATE_DB');
  const databaseId = String(d1.database_id ?? d1.databaseId ?? d1.id ?? '').toLowerCase();
  if (databaseId !== config.databaseId) throw failure(
    'Remote Worker D1 differs from exact Report replay target',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_REMOTE_D1_MISMATCH',
  );
  const queueBinding = exactlyOne(bindings, (binding) => (
    readBindingName(binding) === 'MKT_SYNC_QUEUE' && normalizeBindingType(binding?.type) === 'queue'
  ), 'MKT_SYNC_QUEUE');
  if (String(queueBinding.queue_name ?? queueBinding.queueName ?? queueBinding.queue ?? '') !== config.mainQueueName) {
    throw failure(
      'Remote Worker Queue differs from exact Report replay target',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_REMOTE_QUEUE_MISMATCH',
    );
  }
  for (const [key, envName] of Object.entries(REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES)) {
    const mapping = exactlyOne(bindings, (binding) => (
      readBindingName(binding) === envName && normalizeBindingType(binding?.type) === 'plain_text'
    ), envName);
    if (String(mapping.text ?? mapping.value ?? '').trim() !== config.tableIds[key]) throw failure(
      `Remote Worker Lark mapping differs for ${envName}`,
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_REMOTE_TABLE_MISMATCH',
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
    `Cloudflare Queue accepted no exact Report replay retry (HTTP ${response.status})`,
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_QUEUE_SEND_FAILED',
    { status: response.status },
  );
}

async function readOneD1Row(sql) {
  const rows = await readD1Rows(sql);
  if (rows.length !== 1) throw failure(
    'Report config-DLQ recovery D1 query returned an unexpected row count',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_D1_SHAPE_INVALID',
    { rowCount: rows.length },
  );
  return Object.freeze({ ...rows[0] });
}

async function readD1Rows(sql) {
  const output = await runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json', '--config', configPath, '--command', compactSql(sql),
  ], { env: loaded?.env });
  const parsed = JSON.parse(output);
  return Array.isArray(parsed)
    ? parsed.flatMap((item) => item?.results ?? [])
    : (parsed?.results ?? []);
}

async function withGeneratedConfig(configText, operation) {
  const directory = await mkdtemp(join(tmpdir(), 'report-config-dlq-recovery-'));
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

async function readRequiredJson(path) {
  const value = await readJsonIfExists(path);
  if (value === null) throw failure(
    'Required exact Report replay evidence is missing',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_EVIDENCE_MISSING',
    { fileName: path.split('/').at(-1) ?? null },
  );
  return value;
}

async function readJsonIfExists(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw failure(
      'Exact Report replay evidence JSON is invalid',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_EVIDENCE_JSON_INVALID',
      { fileName: path.split('/').at(-1) ?? null },
    );
    throw error;
  }
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await stat(path);
    throw failure(
      'Exact Report replay recovery evidence file already exists',
      'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_ATTEMPT_EXISTS',
      { fileName: path.split('/').at(-1) ?? null },
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(safeReportRuntimeCloseoutEvidence(value), null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function resolveActiveVersion(value, expectedVersionId) {
  const candidates = [];
  visit(value);
  const unique = [...new Set(candidates)];
  if (expectedVersionId && !unique.includes(expectedVersionId)) throw failure(
    'Expected exact Report replay deployment is not active at 100% traffic',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_DEPLOYMENT_NOT_ACTIVE',
    { expectedVersionId, activeVersions: unique },
  );
  if (unique.length !== 1) throw failure(
    'Exact Report replay recovery requires one Worker version at 100% traffic',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_TRAFFIC_INVALID',
    { activeVersions: unique },
  );
  return unique[0];

  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    const percentage = Number(nested.percentage ?? nested.traffic ?? nested.percent ?? Number.NaN);
    const versionId = String(nested.version_id ?? nested.versionId ?? '').trim();
    if (percentage === 100 && /^[0-9a-f-]{36}$/iu.test(versionId)) candidates.push(versionId);
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

function extractVersionId(stdout) {
  const labeled = String(stdout).match(/Version ID:\s*([0-9a-f-]{36})/iu)?.[1];
  if (labeled) return labeled;
  const matches = [...String(stdout).matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu)]
    .map((match) => match[0]);
  const unique = [...new Set(matches)];
  if (unique.length !== 1) throw failure(
    'Unable to resolve exact Report replay Worker Version ID',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_VERSION_UNRESOLVED',
    { matchCount: unique.length },
  );
  return unique[0];
}

function normalizeLarkText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const texts = value.map((item) => normalizeLarkText(item)).filter(Boolean);
    return texts.length === 0 ? null : texts.join('');
  }
  if (value && typeof value === 'object') return normalizeLarkText(value.text ?? value.value ?? value.name ?? null);
  return value === null || value === undefined ? null : String(value).trim() || null;
}

function normalizeLarkNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const candidate = scalar && typeof scalar === 'object' ? (scalar.value ?? scalar.text ?? null) : scalar;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const number = Number(candidate);
  if (!Number.isFinite(number)) throw failure(
    'Lark Report metric current_value is not finite or null',
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_LARK_VALUE_INVALID',
  );
  return number;
}

function exactlyOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) throw failure(
    `Remote Worker requires exactly one ${label} binding`,
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_REMOTE_BINDING_INVALID',
    { label, matchCount: matches.length },
  );
  return matches[0];
}

function readBindingName(binding) { return String(binding?.name ?? binding?.binding ?? '').trim() || null; }
function normalizeBindingType(value) { return String(value ?? '').trim().toLowerCase().replaceAll('-', '_'); }
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
    'REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_VALUE_INVALID',
    { fieldName },
  );
  return number;
}
function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
function failure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeConfigDlqRecoveryOperatorError';
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

export const REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_COMMAND = Object.freeze({
  confirmation: REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONFIRMATION,
  command: `CONFIRM_REPORT_RUNTIME_CONFIG_DLQ_RECOVERY=${REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONFIRMATION} node scripts/report-runtime-config-dlq-recovery.mjs`,
});
