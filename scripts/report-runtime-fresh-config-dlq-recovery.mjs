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
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  assertReportRuntimeFinalizerEvidence,
  buildReportRuntimeCloseoutCandidates,
  buildReportRuntimeCloseoutConfigWindow,
  safeReportRuntimeCloseoutEvidence,
} from './lib/report-runtime-closeout-operator.js';
import {
  REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT,
  REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
  assertReportRuntimeFreshConfigDlqClosed,
  assertReportRuntimeFreshConfigDlqCompletion,
  assertReportRuntimeFreshConfigDlqEvidence,
  assertReportRuntimeFreshConfigDlqIncident,
  assertReportRuntimeFreshConfigDlqInitialState,
  assertReportRuntimeFreshConfigDlqPreflight,
  assertReportRuntimeStableActiveDeployment,
  buildReportRuntimeFreshConfigDlqClosureStatements,
  buildReportRuntimeFreshConfigDlqCompletionSql,
  buildReportRuntimeFreshConfigDlqEvidenceSql,
  buildReportRuntimeFreshConfigDlqInitialStateSql,
} from './lib/report-runtime-fresh-config-dlq-recovery.js';
import { pollReportRuntimeLarkIntegrity } from './lib/report-runtime-lark-integrity-recovery.js';
import { assertReportRuntimeOrganicIntegrity } from './lib/report-runtime-window-repair.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';

const CONFIRMATION = 'RECOVER_EXACT_REPORT_1D_CONFIG_DLQ_AND_CONTINUE';
const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR
    ?? 'outputs/report-runtime-window-repair/1d-fresh',
);
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? 'outputs/report-runtime-window-repair/finalizer/report-runtime-finalize-summary.json',
);
const sevenDaySummaryPath = resolve(outputRoot, '..', '7d-refresh', 'report-runtime-closeout-summary.json');
const summaryPath = join(outputRoot, 'report-runtime-closeout-summary.json');
const deployAttemptPath = join(outputRoot, 'fresh-config-dlq-recover-deploy-active.attempt.json');
const firstRetryAttemptPath = join(outputRoot, 'fresh-config-dlq-first-retry-send.attempt.json');
const replayAttemptPath = join(outputRoot, 'fresh-config-dlq-replay-send.attempt.json');
const restoreAttemptPath = join(outputRoot, 'fresh-config-dlq-recover-restore-safe.attempt.json');
const closureAttemptPath = join(outputRoot, 'fresh-config-dlq-closure.attempt.json');
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
    code: error?.code ?? 'REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: safeReportRuntimeCloseoutEvidence(error?.details ?? {}),
    activeDeploymentAttempted,
    safeRestoreVerified,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  if (process.env.CONFIRM_REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY !== CONFIRMATION) {
    throw failure(
      `Execution requires CONFIRM_REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY=${CONFIRMATION}`,
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_CONFIRMATION_REQUIRED',
    );
  }
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });

  const existingSummary = await readJsonIfExists(summaryPath);
  if (existingSummary) {
    assertCompletedSummary(existingSummary);
    process.stdout.write(`${JSON.stringify({ ...existingSummary, evidencePath: summaryPath }, null, 2)}\n`);
    return;
  }

  currentStage = 'repository-finalizer-and-safe-preflight';
  const repository = await assertRepositoryState();
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository?.head !== repository.head) throw failure(
    'Fresh Report recovery requires Finalizer evidence from current main',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_FINALIZER_HEAD_MISMATCH',
  );

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
    'Pending migrations block exact 1D Report recovery',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_PENDING_MIGRATIONS',
    { pendingMigrations },
  );
  const client = createLarkBitableClientFromEnv(env);
  const larkPreflight = await verifyLarkInventory(client, config.tableIds);
  const d1Preflight = await readD1Preflight();
  assertReportRuntimeFreshConfigDlqPreflight(d1Preflight);

  currentStage = 'validate-exact-1d-incident-and-original-evidence';
  const sevenDaySummary = JSON.parse(await readFile(sevenDaySummaryPath, 'utf8'));
  assertSevenDaySummary(sevenDaySummary);
  const originalDeployAttempt = await readRequiredJson(join(outputRoot, 'deploy-active.attempt.json'));
  const originalSendFirstAttempt = await readRequiredJson(join(outputRoot, 'send-first.attempt.json'));
  const originalRestoreAttempt = await readRequiredJson(join(outputRoot, 'restore-safe.attempt.json'));
  const originalReplayAttempt = await readJsonIfExists(join(outputRoot, 'send-replay.attempt.json'));
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT.originalRequestedAt,
    periodEnd: sevenDaySummary.target.period.periodEnd,
    sourceWatermark: sevenDaySummary.target.sourceWatermark,
    timeZone: 'Asia/Bangkok',
    platformScope: 'tiktok',
    accountKey: 'chemistry_k',
    formulaVersion: 'tiktok-organic-v1',
  });
  const candidate = candidates.find((item) => (
    item.reportId === REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT.reportId
  ));
  if (!candidate) throw failure(
    'Exact failed 1D Report candidate cannot be regenerated from retained evidence',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_CANDIDATE_MISSING',
  );
  const selected = Object.freeze({ ...candidate, operation: 'fresh' });
  const evidence = assertReportRuntimeFreshConfigDlqEvidence({
    deployAttempt: originalDeployAttempt,
    sendFirstAttempt: originalSendFirstAttempt,
    restoreAttempt: originalRestoreAttempt,
    replayAttempt: originalReplayAttempt,
    summaryExists: false,
    candidate: selected,
    activeConfigSha256: originalDeployAttempt.configSha256,
    safeConfigSha256: originalRestoreAttempt.configSha256,
    jobSha256: sha256(stableJson(selected.job)),
  });
  await assertAncestor(evidence.originalRepositoryHead, repository.head);

  const incidentBeforeRow = await readOneD1Row(buildReportRuntimeFreshConfigDlqEvidenceSql());
  const incidentBefore = assertReportRuntimeFreshConfigDlqIncident(incidentBeforeRow);
  const initialState = await readOneD1Row(buildReportRuntimeFreshConfigDlqInitialStateSql());
  assertReportRuntimeFreshConfigDlqInitialState(initialState);
  const larkBefore = await readLarkReportState(client, config.tableIds, selected.reportId);
  assertEmptyLarkTarget(larkBefore);

  let firstAttempt = await readJsonIfExists(firstRetryAttemptPath);
  let replayAttempt = await readJsonIfExists(replayAttemptPath);
  let firstCompletion = null;
  let replayCompletion = null;
  let firstLark = null;
  let replayLark = null;
  let firstIntegrity = null;
  let replayIntegrity = null;
  let firstPollAttempts = null;
  let replayPollAttempts = null;
  let activeDeployment = null;
  let restoreDeployment = Object.freeze({ versionId: remoteSafe.activeVersion });
  let backup = firstAttempt?.backup ?? null;
  let firstMessageSentThisRun = false;
  let replayMessageSentThisRun = false;
  let primaryError = null;

  if (!firstAttempt && !replayAttempt) {
    const priorDeploy = await readJsonIfExists(deployAttemptPath);
    const priorRestore = await readJsonIfExists(restoreAttemptPath);
    if (priorDeploy || priorRestore) throw failure(
      'A prior 1D recovery deployment exists without a recorded Queue send',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_PARTIAL_DEPLOYMENT_BLOCKED',
      {
        deployAttemptExists: priorDeploy !== null,
        restoreAttemptExists: priorRestore !== null,
      },
    );

    currentStage = 'backup-before-exact-1d-retry';
    backup = await createD1Backup('before-fresh-config-dlq-retry');
    try {
      currentStage = 'deploy-and-stabilize-report-only-window';
      await writePrivateJson(deployAttemptPath, {
        contractVersion: REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
        repositoryHead: repository.head,
        reportId: selected.reportId,
        jobSha256: evidence.jobSha256,
        configSha256: config.activeSha256,
        backup,
        attemptedAt: new Date().toISOString(),
      });
      activeDeployment = await deployConfig(config.activeText, 'fresh-config-dlq-recovery-active');
      activeDeploymentAttempted = true;
      const stability = await verifyStableActiveDeployment(
        config,
        activeDeployment.versionId,
      );

      currentStage = 'send-exact-1d-first-materialization-retry-once';
      const retryRequestedAt = Date.now();
      firstAttempt = Object.freeze({
        contractVersion: REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
        repositoryHead: repository.head,
        reportId: selected.reportId,
        jobSha256: evidence.jobSha256,
        originalDlqId: REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT.dlqId,
        retryRequestedAt,
        activeVersionId: activeDeployment.versionId,
        stability,
        backup,
        attemptedAt: new Date().toISOString(),
      });
      await writePrivateJson(firstRetryAttemptPath, firstAttempt);
      await sendQueueMessage(auth, queue.queueId, selected.job);
      firstMessageSentThisRun = true;

      currentStage = 'verify-exact-1d-first-materialization';
      firstCompletion = await pollCompletion(retryRequestedAt, 1);
      assertReportRuntimeFreshConfigDlqCompletion(firstCompletion, 1);
      const firstVerified = await pollLarkIntegrity(
        client,
        config.tableIds,
        selected.reportId,
        firstCompletion,
      );
      firstLark = firstVerified.state;
      firstIntegrity = firstVerified.integrity;
      firstPollAttempts = firstVerified.attemptCount;

      currentStage = 'send-exact-1d-replay-once';
      replayAttempt = Object.freeze({
        contractVersion: REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
        repositoryHead: repository.head,
        reportId: selected.reportId,
        jobSha256: evidence.jobSha256,
        originalDlqId: REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT.dlqId,
        retryRequestedAt,
        activeVersionId: activeDeployment.versionId,
        firstPayloadChecksum: firstCompletion.payload_checksum,
        attemptedAt: new Date().toISOString(),
      });
      await writePrivateJson(replayAttemptPath, replayAttempt);
      await sendQueueMessage(auth, queue.queueId, selected.job);
      replayMessageSentThisRun = true;

      currentStage = 'verify-exact-1d-replay-idempotency';
      replayCompletion = await pollCompletion(retryRequestedAt, 2);
      assertReportRuntimeFreshConfigDlqCompletion(replayCompletion, 2);
      assertCompletionReplay(firstCompletion, replayCompletion);
      const replayVerified = await pollLarkIntegrity(
        client,
        config.tableIds,
        selected.reportId,
        replayCompletion,
      );
      replayLark = replayVerified.state;
      replayIntegrity = replayVerified.integrity;
      replayPollAttempts = replayVerified.attemptCount;
      assertLarkReplay(firstLark, replayLark);
      if (stableJson(firstIntegrity) !== stableJson(replayIntegrity)) throw failure(
        'Exact 1D replay changed D1/Lark metric integrity evidence',
        'REPORT_RUNTIME_FRESH_CONFIG_DLQ_INTEGRITY_DRIFT',
      );
    } catch (error) {
      primaryError = error;
    } finally {
      if (activeDeploymentAttempted) {
        currentStage = 'restore-all-false';
        try {
          await writePrivateJson(restoreAttemptPath, {
            contractVersion: REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
            repositoryHead: repository.head,
            reportId: selected.reportId,
            configSha256: config.safeSha256,
            activeVersionId: activeDeployment?.versionId ?? null,
            attemptedAt: new Date().toISOString(),
          });
          restoreDeployment = await deployConfig(
            config.safeText,
            'fresh-config-dlq-recovery-safe',
          );
          await verifyRemoteDeployment(config, 'safe', restoreDeployment.versionId);
          safeRestoreVerified = true;
        } catch (restoreError) {
          if (primaryError) throw failure(
            'Exact 1D recovery failed and all-false restore also failed',
            'REPORT_RUNTIME_FRESH_CONFIG_DLQ_RESTORE_FAILED_AFTER_PRIMARY',
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
  } else if (firstAttempt && replayAttempt) {
    currentStage = 'verification-only-after-recorded-1d-retry-and-replay';
    await assertRecoveryAttempt(firstAttempt, evidence, repository.head, 'first');
    await assertRecoveryAttempt(replayAttempt, evidence, repository.head, 'replay');
    if (Number(firstAttempt.retryRequestedAt) !== Number(replayAttempt.retryRequestedAt)) {
      throw failure(
        'Recorded 1D retry and replay timestamps differ',
        'REPORT_RUNTIME_FRESH_CONFIG_DLQ_ATTEMPT_MISMATCH',
      );
    }
    const safe = await verifyRemoteDeployment(config, 'safe');
    restoreDeployment = Object.freeze({ versionId: safe.activeVersion });
    safeRestoreVerified = true;
    backup = firstAttempt.backup;
    firstCompletion = await pollCompletion(firstAttempt.retryRequestedAt, 1);
    replayCompletion = await pollCompletion(firstAttempt.retryRequestedAt, 2);
    assertReportRuntimeFreshConfigDlqCompletion(firstCompletion, 1);
    assertReportRuntimeFreshConfigDlqCompletion(replayCompletion, 2);
    assertCompletionReplay(firstCompletion, replayCompletion);
    const firstVerified = await pollLarkIntegrity(
      client,
      config.tableIds,
      selected.reportId,
      firstCompletion,
    );
    const replayVerified = await pollLarkIntegrity(
      client,
      config.tableIds,
      selected.reportId,
      replayCompletion,
    );
    firstLark = firstVerified.state;
    replayLark = replayVerified.state;
    firstIntegrity = firstVerified.integrity;
    replayIntegrity = replayVerified.integrity;
    firstPollAttempts = firstVerified.attemptCount;
    replayPollAttempts = replayVerified.attemptCount;
    assertLarkReplay(firstLark, replayLark);
    if (stableJson(firstIntegrity) !== stableJson(replayIntegrity)) throw failure(
      'Recorded exact 1D replay changed D1/Lark metric integrity evidence',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_INTEGRITY_DRIFT',
    );
  } else {
    throw failure(
      'Partial 1D Queue-send evidence requires operator inspection before continuation',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_PARTIAL_SEND_BLOCKED',
      {
        firstRetryAttemptExists: firstAttempt !== null,
        replayAttemptExists: replayAttempt !== null,
      },
    );
  }

  if (!safeRestoreVerified) throw failure(
    'Exact 1D recovery requires verified all-false Worker restore',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_SAFE_RESTORE_REQUIRED',
  );

  currentStage = 'close-exact-retained-1d-dlq-metadata';
  const currentIncidentRow = await readOneD1Row(buildReportRuntimeFreshConfigDlqEvidenceSql());
  const currentIncident = assertReportRuntimeFreshConfigDlqIncident(currentIncidentRow);
  if (!currentIncident.alreadyClosed) {
    const priorClosureAttempt = await readJsonIfExists(closureAttemptPath);
    if (!priorClosureAttempt) await writePrivateJson(closureAttemptPath, {
      contractVersion: REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
      repositoryHead: repository.head,
      reportId: selected.reportId,
      retryRequestedAt: firstAttempt.retryRequestedAt,
      originalDlqId: REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT.dlqId,
      backup,
      attemptedAt: new Date().toISOString(),
    });
    else await assertClosureAttempt(priorClosureAttempt, evidence, repository.head, firstAttempt);
    for (const statement of buildReportRuntimeFreshConfigDlqClosureStatements()) {
      await readD1Rows(statement);
    }
  }
  const incidentAfterRow = await readOneD1Row(buildReportRuntimeFreshConfigDlqEvidenceSql());
  assertReportRuntimeFreshConfigDlqClosed(incidentAfterRow);
  const finalOpenDlq = await readOneD1Row(`
    SELECT COUNT(*) AS open_report_dlq FROM dead_letter_jobs
    WHERE job_type = 'report.materialization.generate'
      AND status IN ('open', 'redrive_pending');
  `);
  if (Number(finalOpenDlq.open_report_dlq) !== 0) throw failure(
    'Open Report DLQ rows remain after exact 1D incident closure',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_OPEN_DLQ_REMAINS',
    { openReportDlq: Number(finalOpenDlq.open_report_dlq) },
  );

  currentStage = 'write-verified-1d-closeout-summary';
  const summary = Object.freeze({
    ok: true,
    contractVersion: REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION,
    decision: 'REPORT_WINDOW_CREATED',
    repository,
    finalizerEvidence: Object.freeze({
      contractVersion: finalizerEvidence.contractVersion,
      schemaReadbackActions: Number(finalizerEvidence.schema?.readbackActions ?? 0),
      schemaConflicts: Number(finalizerEvidence.schema?.conflicts ?? 0),
      canonicalSettingsActive: Number(finalizerEvidence.settings?.canonicalActive ?? 0),
    }),
    target: Object.freeze({
      environment: 'development',
      customerProfile: 'integration_workspace',
      platform: 'tiktok',
      accountKey: 'chemistry_k',
      operation: 'fresh',
      reportSettingKey: selected.reportSettingKey,
      reportId: selected.reportId,
      windowDays: selected.windowDays,
      period: selected.period,
      sourceWatermark: sevenDaySummary.target.sourceWatermark,
    }),
    preflight: Object.freeze({
      lark: larkPreflight,
      targetRows: summarizeLarkState(larkBefore),
      d1: Object.freeze({
        coverageStatus: d1Preflight.coverage_status,
        contentStateCount: Number(d1Preflight.content_state_count),
        observationCount: Number(d1Preflight.observation_count),
      }),
      pendingMigrations,
      safeBundleSha256: config.safeSha256,
      activeBundleSha256: config.activeSha256,
      backup,
    }),
    materialization: Object.freeze({
      dataStatus: firstCompletion.data_status,
      payloadChecksum: firstCompletion.payload_checksum,
      d1MaterializationCount: Number(firstCompletion.materialization_count),
      firstSyncRunCount: Number(firstCompletion.successful_sync_count),
      larkRows: summarizeLarkState(firstLark),
      larkIntegrityPollAttempts: firstPollAttempts,
      integrity: firstIntegrity,
    }),
    replay: Object.freeze({
      sameReportId: firstCompletion.report_id === replayCompletion.report_id,
      samePayloadChecksum:
        firstCompletion.payload_checksum === replayCompletion.payload_checksum,
      d1MaterializationCount: Number(replayCompletion.materialization_count),
      successfulSyncRunCount: Number(replayCompletion.successful_sync_count),
      larkRowsUnchanged: stableJson(firstLark) === stableJson(replayLark),
      integrityUnchanged: stableJson(firstIntegrity) === stableJson(replayIntegrity),
      larkIntegrityPollAttempts: replayPollAttempts,
    }),
    recovery: Object.freeze({
      mode: 'exact_fresh_materialization_config_dlq_v1',
      originalRepositoryHead: evidence.originalRepositoryHead,
      originalFirstMaterializationFailedBeforeAdmission: true,
      originalDlqId: REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT.dlqId,
      originalErrorCode: REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT.errorCode,
      firstRetryMessageSentThisRun: firstMessageSentThisRun,
      replayMessageSentThisRun,
      verificationOnly: !firstMessageSentThisRun && !replayMessageSentThisRun,
      deploymentStabilizationSamples: Number(firstAttempt.stability?.sampleCount ?? 0),
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

function assertSevenDaySummary(summary) {
  if (summary.ok !== true
    || summary.decision !== 'REPORT_WINDOW_REFRESHED'
    || summary.target?.platform !== 'tiktok'
    || Number(summary.target?.windowDays) !== 7
    || summary.target?.period?.periodEnd !== '2026-07-28'
    || !String(summary.target?.sourceWatermark ?? '').trim()
    || Number(summary.materialization?.d1MaterializationCount) !== 1
    || Number(summary.replay?.d1MaterializationCount) !== 1
    || summary.replay?.samePayloadChecksum !== true
    || summary.runtime?.restoredAllFalse !== true
    || summary.runtime?.production !== false) {
    throw failure(
      'Verified 7D evidence does not authorize exact 1D recovery',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_7D_EVIDENCE_INVALID',
    );
  }
}

function assertCompletedSummary(summary) {
  if (summary.ok !== true
    || summary.decision !== 'REPORT_WINDOW_CREATED'
    || summary.target?.reportId !== REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT.reportId
    || Number(summary.target?.windowDays) !== 1
    || Number(summary.materialization?.d1MaterializationCount) !== 1
    || Number(summary.replay?.d1MaterializationCount) !== 1
    || summary.replay?.sameReportId !== true
    || summary.replay?.samePayloadChecksum !== true
    || summary.replay?.larkRowsUnchanged !== true
    || summary.replay?.integrityUnchanged !== true
    || summary.runtime?.restoredAllFalse !== true
    || summary.runtime?.production !== false) {
    throw failure(
      'Existing exact 1D Report recovery summary is invalid',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_SUMMARY_INVALID',
    );
  }
}

async function verifyStableActiveDeployment(config, versionId) {
  const samples = [];
  for (const delayMs of STABILITY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    const verified = await verifyRemoteDeployment(config, 'active', versionId);
    samples.push(Object.freeze({
      versionId: verified.activeVersion,
      trueFlags: verified.trueFlags,
      mode: verified.mode,
    }));
  }
  return assertReportRuntimeStableActiveDeployment(samples, {
    versionId,
    trueFlags: config.activeTrueFlags,
  });
}

async function pollCompletion(retryRequestedAt, minimumSuccessfulRuns) {
  const maxPolls = positiveInteger(
    process.env.MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS ?? 24,
    'maxPolls',
  );
  const intervalMs = positiveInteger(
    process.env.MKT_REPORT_RUNTIME_CLOSEOUT_POLL_INTERVAL_MS ?? 5_000,
    'pollIntervalMs',
  );
  let row = null;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    row = await readOneD1Row(
      buildReportRuntimeFreshConfigDlqCompletionSql(retryRequestedAt),
    );
    try {
      assertReportRuntimeFreshConfigDlqCompletion(row, minimumSuccessfulRuns);
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
      catch {
        throw failure(
          'Report payload_json is invalid',
          'REPORT_RUNTIME_FRESH_CONFIG_DLQ_PAYLOAD_INVALID',
        );
      }
      return assertReportRuntimeOrganicIntegrity({
        payload,
        larkMetrics: state.metricValues,
      });
    },
  });
}

function assertEmptyLarkTarget(state) {
  if (state.snapshots !== 0
    || state.metrics !== 0
    || state.topContent !== 0
    || state.duplicateMetricKeys !== 0) {
    throw failure(
      'Exact 1D recovery requires zero pre-existing Lark Report rows',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_LARK_PRESTATE_INVALID',
      { state: summarizeLarkState(state) },
    );
  }
}

function assertLarkCompletion(state) {
  if (state.snapshots !== 1
    || state.metrics !== 10
    || state.topContent !== 5
    || state.duplicateMetricKeys !== 0) {
    throw failure(
      'Exact 1D Lark Report materialization is incomplete',
      'REPORT_RUNTIME_CLOSEOUT_LARK_INCOMPLETE',
      { state: summarizeLarkState(state) },
    );
  }
}

function assertCompletionReplay(before, after) {
  if (before.report_id !== after.report_id
    || before.payload_checksum !== after.payload_checksum
    || Number(before.materialization_count) !== 1
    || Number(after.materialization_count) !== 1
    || Number(after.successful_sync_count) < 2) {
    throw failure(
      'Exact 1D replay changed the D1 materialization identity',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_REPLAY_DRIFT',
    );
  }
}

function assertLarkReplay(before, after) {
  if (stableJson(before) !== stableJson(after)) throw failure(
    'Exact 1D replay changed Lark Stable-key rows or values',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_LARK_REPLAY_DRIFT',
    { before: summarizeLarkState(before), after: summarizeLarkState(after) },
  );
}

async function assertRecoveryAttempt(attempt, evidence, currentHead, kind) {
  if (attempt?.contractVersion !== REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION
    || attempt.reportId !== evidence.reportId
    || attempt.jobSha256 !== evidence.jobSha256
    || attempt.originalDlqId !== REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT.dlqId
    || !Number.isSafeInteger(Number(attempt.retryRequestedAt))) {
    throw failure(
      `Recorded 1D ${kind} attempt differs from the exact incident`,
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_ATTEMPT_MISMATCH',
      { kind },
    );
  }
  await assertAncestor(attempt.repositoryHead, currentHead);
}

async function assertClosureAttempt(attempt, evidence, currentHead, firstAttempt) {
  if (attempt?.contractVersion !== REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION
    || attempt.reportId !== evidence.reportId
    || Number(attempt.retryRequestedAt) !== Number(firstAttempt.retryRequestedAt)
    || attempt.originalDlqId !== REPORT_RUNTIME_FRESH_CONFIG_DLQ_INCIDENT.dlqId) {
    throw failure(
      'Recorded exact 1D DLQ closure attempt differs from the recovery',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_CLOSURE_ATTEMPT_INVALID',
    );
  }
  await assertAncestor(attempt.repositoryHead, currentHead);
}

async function assertAncestor(ancestor, head) {
  if (!/^[0-9a-f]{40}$/u.test(String(ancestor ?? ''))
    || !/^[0-9a-f]{40}$/u.test(String(head ?? ''))) {
    throw failure(
      'Exact 1D recovery requires full Git SHAs for ancestry verification',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_GIT_HEAD_INVALID',
    );
  }
  try {
    await run('git', ['merge-base', '--is-ancestor', ancestor, head]);
  } catch {
    throw failure(
      'Original exact 1D evidence is not an ancestor of current main',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_GIT_ANCESTRY_INVALID',
      { ancestor, head },
    );
  }
}

async function readD1Preflight() {
  return readOneD1Row(`
    WITH coverage AS (
      SELECT status, source_watermark, completed_at
      FROM data_coverage_runs
      WHERE customer_key = 'chemistry_k' AND platform = 'tiktok'
        AND account_key = 'chemistry_k'
        AND dataset_key = 'organic_content_cumulative'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, coverage_run_id ASC LIMIT 1
    )
    SELECT
      (SELECT status FROM coverage) AS coverage_status,
      (SELECT source_watermark FROM coverage) AS source_watermark,
      (SELECT MAX(metric_date) FROM organic_content_observations
        WHERE customer_key = 'chemistry_k' AND platform = 'tiktok'
          AND account_key = 'chemistry_k') AS period_end,
      (SELECT COUNT(*) FROM organic_content_state
        WHERE customer_key = 'chemistry_k' AND platform = 'tiktok'
          AND account_key = 'chemistry_k') AS content_state_count,
      (SELECT COUNT(*) FROM organic_content_observations
        WHERE customer_key = 'chemistry_k' AND platform = 'tiktok'
          AND account_key = 'chemistry_k') AS observation_count,
      (SELECT COUNT(*) FROM sync_locks l JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = 'tiktok' AND r.account_key = 'chemistry_k'
          AND r.sync_type = 'dashboard_performance_report'
          AND l.expires_at > (unixepoch() * 1000)) AS active_report_locks,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = 'report.materialization.generate'
          AND status IN ('open', 'redrive_pending')) AS open_report_dlq;
  `);
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
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_LARK_METRIC_KEY_MISSING',
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

async function verifyLarkInventory(client, tableIds) {
  const tables = await client.listTables();
  const remoteIds = new Set(tables.map((item) => String(
    item?.table_id ?? item?.tableId ?? item?.id ?? '',
  )).filter(Boolean));
  const fieldCounts = {};
  for (const [key, tableId] of Object.entries(tableIds)) {
    if (!remoteIds.has(tableId)) throw failure(
      `Report Lark table is missing: ${key}`,
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_LARK_TABLE_MISSING',
      { tableKey: key },
    );
    const fields = await client.listFields({ tableId });
    fieldCounts[key] = fields.length;
  }
  return Object.freeze({
    tableCount: Object.keys(tableIds).length,
    fieldCountFingerprint: sha256(stableJson(fieldCounts)),
    metadataMutationCount: 0,
  });
}

function summarizeLarkState(state) {
  return Object.freeze({
    snapshots: Number(state?.snapshots ?? 0),
    metrics: Number(state?.metrics ?? 0),
    topContent: Number(state?.topContent ?? 0),
    duplicateMetricKeys: Number(state?.duplicateMetricKeys ?? 0),
  });
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
    'Exact 1D recovery requires clean current main equal to origin/main',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_REPOSITORY_INVALID',
    { branch, head, originMainHead, clean: dirty.trim() === '' },
  );
  return Object.freeze({ branch, head, originMainHead, clean: true });
}

async function resolveCloudflareSession(env, sourceText) {
  const cleanEnv = { ...env };
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!String(cleanEnv[key] ?? '').trim()) delete cleanEnv[key];
  }
  const whoami = await runText('npx', ['wrangler', 'whoami', '--json'], { env: cleanEnv });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: cleanEnv.CLOUDFLARE_ACCOUNT_ID,
    configText: sourceText,
    whoamiOutput: whoami,
  });
  const selectedEnv = { ...cleanEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
  await runText('npx', [
    'wrangler', 'whoami', '--account', accountId, '--json',
  ], { env: selectedEnv });
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
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true || !Array.isArray(body.result)) throw failure(
      `Cloudflare Queue inventory read failed (HTTP ${response.status})`,
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_QUEUE_READ_FAILED',
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
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_QUEUE_TARGET_INVALID',
    { matchCount: matches.length },
  );
  return Object.freeze(matches[0]);
}

async function readPendingMigrations() {
  const output = await runText('npx', [
    'wrangler', 'd1', 'migrations', 'list', 'MKT_STATE_DB',
    '--remote', '--config', configPath,
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
    'Exact 1D recovery D1 backup is empty',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_BACKUP_INVALID',
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
    '--message', `${REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_CONTRACT_VERSION} ${label} git=${loaded.repository.head}`,
  ], { env: loaded.env }));
  return Object.freeze({
    versionId: extractVersionId(result.stdout),
    stdoutSha256: sha256(result.stdout),
    label,
  });
}

async function verifyRemoteDeployment(config, mode, expectedVersionId = null) {
  const status = JSON.parse(await runText('npx', [
    'wrangler', 'deployments', 'status', '--name', 'social-mkt-sync-worker',
    '--config', configPath, '--json',
  ], { env: loaded?.env }));
  const activeVersion = resolveActiveVersion(status, expectedVersionId);
  const versionView = JSON.parse(await runText('npx', [
    'wrangler', 'versions', 'view', activeVersion, '--name', 'social-mkt-sync-worker',
    '--config', configPath, '--json',
  ], { env: loaded?.env }));
  const bindings = collectBindings(versionView);
  const trueFlags = bindings
    .filter((binding) => normalizeBindingType(binding?.type) === 'plain_text')
    .map((binding) => [readBindingName(binding), readRemoteBoolean(
      binding?.text ?? binding?.value,
    )])
    .filter(([name, enabled]) => (
      name && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && enabled
    ))
    .map(([name]) => name)
    .sort();
  const expectedTrue = mode === 'active' ? [...config.activeTrueFlags].sort() : [];
  if (stableJson(trueFlags) !== stableJson(expectedTrue)) throw failure(
    'Remote Worker flags differ from exact 1D recovery mode',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_REMOTE_FLAG_MISMATCH',
    { mode, expectedTrue, observedTrue: trueFlags },
  );
  const d1 = exactlyOne(bindings, (binding) => (
    readBindingName(binding) === 'MKT_STATE_DB'
      && normalizeBindingType(binding?.type) === 'd1'
  ), 'MKT_STATE_DB');
  const databaseId = String(d1.database_id ?? d1.databaseId ?? d1.id ?? '').toLowerCase();
  if (databaseId !== config.databaseId) throw failure(
    'Remote Worker D1 differs from exact 1D recovery target',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_REMOTE_D1_MISMATCH',
  );
  const queueBinding = exactlyOne(bindings, (binding) => (
    readBindingName(binding) === 'MKT_SYNC_QUEUE'
      && normalizeBindingType(binding?.type) === 'queue'
  ), 'MKT_SYNC_QUEUE');
  if (String(
    queueBinding.queue_name ?? queueBinding.queueName ?? queueBinding.queue ?? '',
  ) !== config.mainQueueName) throw failure(
    'Remote Worker Queue differs from exact 1D recovery target',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_REMOTE_QUEUE_MISMATCH',
  );
  for (const [key, envName] of Object.entries(REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES)) {
    const mapping = exactlyOne(bindings, (binding) => (
      readBindingName(binding) === envName
        && normalizeBindingType(binding?.type) === 'plain_text'
    ), envName);
    if (String(mapping.text ?? mapping.value ?? '').trim() !== config.tableIds[key]) {
      throw failure(
        `Remote Worker Lark mapping differs for ${envName}`,
        'REPORT_RUNTIME_FRESH_CONFIG_DLQ_REMOTE_TABLE_MISMATCH',
        { envName },
      );
    }
  }
  return Object.freeze({ activeVersion, trueFlags: Object.freeze(trueFlags), mode });
}

async function sendQueueMessage(auth, queueId, job) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(auth.accountId)}/queues/${encodeURIComponent(queueId)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body: job, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) throw failure(
    `Cloudflare Queue accepted no exact 1D Report message (HTTP ${response.status})`,
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_QUEUE_SEND_FAILED',
    { status: response.status },
  );
}

async function readOneD1Row(sql) {
  const rows = await readD1Rows(sql);
  if (rows.length !== 1) throw failure(
    'Exact 1D recovery D1 query returned an unexpected row count',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_D1_SHAPE_INVALID',
    { rowCount: rows.length },
  );
  return Object.freeze({ ...rows[0] });
}

async function readD1Rows(sql) {
  const output = await runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
    '--config', configPath, '--command', compactSql(sql),
  ], { env: loaded?.env });
  const parsed = JSON.parse(output);
  return Array.isArray(parsed)
    ? parsed.flatMap((item) => item?.results ?? [])
    : (parsed?.results ?? []);
}

async function withGeneratedConfig(configText, operation) {
  const directory = await mkdtemp(join(tmpdir(), 'report-fresh-config-dlq-recovery-'));
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
    'Required exact 1D Report evidence is missing',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_EVIDENCE_MISSING',
    { fileName: path.split('/').at(-1) ?? null },
  );
  return value;
}

async function readJsonIfExists(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw failure(
      'Exact 1D Report evidence JSON is invalid',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_EVIDENCE_JSON_INVALID',
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
      'Exact 1D recovery evidence file already exists',
      'REPORT_RUNTIME_FRESH_CONFIG_DLQ_ATTEMPT_EXISTS',
      { fileName: path.split('/').at(-1) ?? null },
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporary = `${path}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify(safeReportRuntimeCloseoutEvidence(value), null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function resolveActiveVersion(value, expectedVersionId) {
  const candidates = [];
  visit(value);
  const unique = [...new Set(candidates)];
  if (expectedVersionId && !unique.includes(expectedVersionId)) throw failure(
    'Expected exact 1D recovery deployment is not active at 100% traffic',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_DEPLOYMENT_NOT_ACTIVE',
    { expectedVersionId, activeVersions: unique },
  );
  if (unique.length !== 1) throw failure(
    'Exact 1D recovery requires one Worker version at 100% traffic',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_TRAFFIC_INVALID',
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
  const unique = [...new Set([...String(stdout).matchAll(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
  )].map((match) => match[0]))];
  if (unique.length !== 1) throw failure(
    'Unable to resolve exact 1D recovery Worker Version ID',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_VERSION_UNRESOLVED',
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
  if (value && typeof value === 'object') {
    return normalizeLarkText(value.text ?? value.value ?? value.name ?? null);
  }
  return value === null || value === undefined ? null : String(value).trim() || null;
}

function normalizeLarkNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const candidate = scalar && typeof scalar === 'object'
    ? (scalar.value ?? scalar.text ?? null)
    : scalar;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const number = Number(candidate);
  if (!Number.isFinite(number)) throw failure(
    'Lark Report metric current_value is not finite or null',
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_LARK_VALUE_INVALID',
  );
  return number;
}

function exactlyOne(values, predicate, label) {
  const matches = Array.isArray(values) ? values.filter(predicate) : [];
  if (matches.length !== 1) throw failure(
    `Remote Worker requires exactly one ${label} binding`,
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_REMOTE_BINDING_INVALID',
    { label, matchCount: matches.length },
  );
  return matches[0];
}

function readBindingName(binding) {
  return String(binding?.name ?? binding?.binding ?? '').trim() || null;
}

function normalizeBindingType(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('-', '_');
}

function readRemoteBoolean(value) {
  if (value === true || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || String(value).trim().toLowerCase() === 'false') return false;
  return null;
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function stableJson(value) {
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw failure(
    `${fieldName} must be a positive integer`,
    'REPORT_RUNTIME_FRESH_CONFIG_DLQ_VALUE_INVALID',
    { fieldName },
  );
  return number;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function failure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeFreshConfigDlqRecoveryOperatorError';
  error.code = code;
  error.details = details;
  return error;
}

async function run(command, args, options = {}) {
  await runCapture(command, args, options);
}

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
