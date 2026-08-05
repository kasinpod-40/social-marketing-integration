#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { sanitizeReportLiveClosureEvidence } from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  assertReportRuntimeCloseoutCompletion,
  assertReportRuntimeCloseoutReplay,
  assertReportRuntimeFinalizerEvidence,
  buildReportRuntimeCloseoutCandidates,
} from './lib/report-runtime-closeout-operator.js';
import {
  resolveReviewedReportRuntimeCloseoutTarget,
} from './lib/report-runtime-closeout-channel-binding.js';
import {
  buildReportRuntimePreflightSql,
} from './lib/report-runtime-closeout-reviewed-binding.js';
import {
  assertReportRuntimeWindowChanged,
} from './lib/report-runtime-window-repair.js';
import {
  buildNotificationPreservingReportRuntimeConfigWindow,
} from './lib/report-runtime-notification-preserving-config.js';
import {
  assertReviewedRepositoryState,
  closeoutFailure,
  createCommandRunner,
  sha256,
  stableJson,
  writePrivateJson,
  writeReviewedAttempt,
} from './lib/report-runtime-closeout-reviewed-process.js';
import {
  createReviewedRemoteRuntime,
  resolveReviewedCloudflareSession,
  resolveReviewedQueue,
  sendReviewedQueueMessage,
} from './lib/report-runtime-closeout-reviewed-remote.js';
import {
  assertD1LarkIntegrity,
  assertLarkReplay,
  createReviewedStateRuntime,
  summarizeLarkState,
} from './lib/report-runtime-closeout-reviewed-state.js';
import {
  REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT,
  REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT,
  assertReviewedConfigDlqAttempt,
  assertReviewedConfigDlqCandidate,
  assertReviewedConfigDlqClosed,
  assertReviewedConfigDlqIncident,
  assertReviewedConfigDlqInitialState,
  assertReviewedConfigDlqPreflight,
  buildReviewedConfigDlqClosureStatements,
  buildReviewedConfigDlqIncidentSql,
} from './lib/report-runtime-reviewed-config-dlq-recovery.js';

const CONFIRMATION = 'RECOVER_EXACT_FACEBOOK_REPORT_CONFIG_DLQ';
const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const target = resolveReviewedReportRuntimeCloseoutTarget({
  MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'facebook',
});
const configPath = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_EVIDENCE_DIR
    ?? 'outputs/facebook-report-config-dlq-recovery',
);
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? 'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
);
const originalOutputRoot = resolve('outputs/facebook-report-runtime-closeout');
const summaryPath = join(outputRoot, 'report-runtime-config-dlq-recovery-summary.json');
const REQUIRED_LARK_KEY_FIELDS = Object.freeze({
  mktReportSnapshots: 'report_id',
  mktReportMetricValues: 'report_metric_key',
  mktReportTopContent: 'report_content_key',
  mktReportTopAds: 'report_ad_key',
  mktSyncLog: 'sync_id',
  mktSystemAlerts: 'alert_id',
});

let currentStage = 'init';
let activeDeploymentAttempted = false;
let baselineRestoreVerified = false;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeReportLiveClosureEvidence(error?.details ?? {}),
    platformScope: 'facebook',
    activeDeploymentAttempted,
    baselineRestoreVerified,
    providerRequestCount: 0,
    scheduleEnabled: false,
    notificationAdmissionEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  if (process.env.CONFIRM_REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY !== CONFIRMATION) {
    throw closeoutFailure(
      `Execution requires CONFIRM_REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY=${CONFIRMATION}`,
      'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_CONFIRMATION_REQUIRED',
    );
  }
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const existingSummary = await readJsonIfExists(summaryPath);
  if (existingSummary) {
    if (existingSummary.ok !== true
      || existingSummary.contractVersion !== REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT
      || existingSummary.incident?.dlqId !== REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.dlqId
      || existingSummary.runtime?.restoredBaseline !== true
      || existingSummary.runtime?.notificationAdmissionEnabled !== false) throw closeoutFailure(
      'Existing Facebook Report DLQ recovery summary is incomplete',
      'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_SUMMARY_INVALID',
    );
    process.stdout.write(`${JSON.stringify({ ...existingSummary, evidencePath: summaryPath }, null, 2)}\n`);
    return;
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const runner = createCommandRunner({ execFileAsync, cwd: repositoryRoot, baseEnv: process.env });

  currentStage = 'repository-finalizer-and-retained-incident';
  const repository = await assertReviewedRepositoryState(runner);
  await runner.run('git', [
    'merge-base', '--is-ancestor',
    REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.originalRepositoryHead,
    repository.head,
  ]);
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository?.head !== repository.head) throw closeoutFailure(
    'Facebook Report DLQ recovery requires Finalizer evidence from current main',
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_FINALIZER_HEAD_MISMATCH',
    {
      evidenceHead: finalizerEvidence.repository?.head ?? null,
      repositoryHead: repository.head,
    },
  );
  const originalAttempt = JSON.parse(await readFile(
    join(originalOutputRoot, 'facebook-1d-send-first.attempt.json'),
    'utf8',
  ));
  assertReviewedConfigDlqAttempt(originalAttempt);

  const sourceText = await readFile(configPath, 'utf8');
  const config = buildNotificationPreservingReportRuntimeConfigWindow(sourceText, {
    activeTrueFlags: target.activeTrueFlags,
    finalizerEvidencePath,
    expectedRepositoryHead: repository.head,
  });
  const auth = await resolveReviewedCloudflareSession({ env, sourceText, runText: runner.runText });
  const queue = await resolveReviewedQueue({
    accountId: auth.accountId,
    token: auth.token,
    expectedName: config.mainQueueName,
  });
  const remoteInput = {
    ...runner,
    configPath,
    repositoryRoot,
    env,
    repositoryHead: repository.head,
    requiredTables: Object.freeze({
      ...REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
      ...config.workerRequiredTables,
    }),
    config: Object.freeze({ ...config, tableIds: config.workerTableIds }),
  };
  const baselineRemote = createReviewedRemoteRuntime({
    ...remoteInput,
    target: Object.freeze({ ...target, activeTrueFlags: config.safeTrueFlags }),
  });
  const activeRemote = createReviewedRemoteRuntime({
    ...remoteInput,
    target: Object.freeze({ ...target, activeTrueFlags: config.activeTrueFlags }),
  });
  const state = createReviewedStateRuntime({
    ...runner,
    repositoryRoot,
    outputRoot,
    configPath,
    env,
    target,
    requiredLarkKeyFields: REQUIRED_LARK_KEY_FIELDS,
  });

  currentStage = 'exact-remote-incident-read-only-preflight';
  const pendingMigrations = await state.readPendingMigrations();
  if (pendingMigrations.length !== 0) throw closeoutFailure(
    'Pending migrations block Facebook Report DLQ recovery',
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_PENDING_MIGRATIONS',
    { pendingMigrationCount: pendingMigrations.length },
  );
  const preflight = await state.readD1Row(buildReportRuntimePreflightSql({
    target: { ...target, customerKey: 'chemistry_k' },
  }));
  assertReviewedConfigDlqPreflight(preflight);
  const incidentRow = await state.readD1Row(buildReviewedConfigDlqIncidentSql());
  const incidentEvidence = assertReviewedConfigDlqIncident(incidentRow);
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.requestedAt,
    periodEnd: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.periodEnd,
    sourceWatermark: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.sourceWatermark,
    timeZone: 'Asia/Bangkok',
    platformScope: 'facebook',
    accountKey: 'chemistry_k',
    formulaVersion: 'facebook-organic-v1',
  });
  const selected = candidates.find((candidate) => candidate.windowDays === 1);
  assertReviewedConfigDlqCandidate(selected);
  if (stableJson(selected.job) !== stableJson(incidentEvidence.replayPayload)) throw closeoutFailure(
    'Regenerated Facebook Queue job differs byte-for-byte from retained replay payload',
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_REPLAY_PAYLOAD_MISMATCH',
  );
  const client = createLarkBitableClientFromEnv(env);
  const larkPreflight = await state.verifyLarkInventory(client, config.tableIds);
  const initialD1 = await state.readD1Snapshot(
    selected,
    REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.requestedAt,
  );
  const initialLark = await state.readLarkReportState(client, config.tableIds, selected.reportId);
  assertReviewedConfigDlqInitialState({ d1: initialD1, lark: initialLark });
  const remoteBaseline = await baselineRemote.verifyDeployment('active');
  const backup = await state.createD1Backup('facebook-before-config-dlq-recovery');

  let activeDeployment = null;
  let activeStability = null;
  let restoreDeployment = null;
  let first = null;
  let firstLark = null;
  let firstIntegrity = null;
  let replay = null;
  let replayLark = null;
  let replayIntegrity = null;
  let primaryError = null;
  const retryRequestedAt = Date.now();

  try {
    currentStage = 'deploy-and-stabilize-reviewed-report-window';
    await writeReviewedAttempt(outputRoot, 'facebook-config-dlq-deploy-active', {
      repositoryHead: repository.head,
      originalRepositoryHead: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.originalRepositoryHead,
      reportId: selected.reportId,
      configSha256: config.activeSha256,
      jobSha256: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.jobSha256,
      backup,
    });
    activeDeployment = await activeRemote.deployConfig(
      config.activeText,
      'facebook-config-dlq-recovery-active',
      REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT,
    );
    activeDeploymentAttempted = true;
    activeStability = await activeRemote.verifyDeployment('active', activeDeployment.versionId);
    if (activeStability.stabilitySampleCount !== 3) throw closeoutFailure(
      'Facebook Report recovery requires three stable Active Worker samples',
      'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_ACTIVE_NOT_STABLE',
      { sampleCount: activeStability.stabilitySampleCount ?? 0 },
    );

    currentStage = 'send-exact-facebook-first-materialization-retry-once';
    await writeReviewedAttempt(outputRoot, 'facebook-config-dlq-send-first-retry', {
      reportId: selected.reportId,
      jobSha256: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.jobSha256,
      retryRequestedAt,
      originalDlqId: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.dlqId,
      activeVersionFingerprint: sha256(activeDeployment.versionId),
    });
    await sendReviewedQueueMessage({ auth, queueId: queue.queueId, job: selected.job });
    first = await state.pollD1Completion(selected, retryRequestedAt, 1);
    assertReportRuntimeCloseoutCompletion(first, { reportId: selected.reportId });
    assertReportRuntimeWindowChanged({ operation: 'fresh', before: initialD1, after: first });
    const firstVerified = await state.pollLarkIntegrity(
      client,
      config.tableIds,
      selected.reportId,
      first,
    );
    firstLark = firstVerified.state;
    firstIntegrity = firstVerified.integrity;

    currentStage = 'send-exact-facebook-replay-once';
    await writeReviewedAttempt(outputRoot, 'facebook-config-dlq-send-replay', {
      reportId: selected.reportId,
      jobSha256: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.jobSha256,
      retryRequestedAt,
      originalDlqId: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.dlqId,
      firstPayloadChecksum: first.payload_checksum,
    });
    await sendReviewedQueueMessage({ auth, queueId: queue.queueId, job: selected.job });
    replay = await state.pollD1Completion(selected, retryRequestedAt, 2);
    assertReportRuntimeCloseoutCompletion(replay, { reportId: selected.reportId });
    assertReportRuntimeCloseoutReplay(first, replay);
    const replayVerified = await state.pollLarkIntegrity(
      client,
      config.tableIds,
      selected.reportId,
      replay,
    );
    replayLark = replayVerified.state;
    replayIntegrity = replayVerified.integrity;
    assertLarkReplay(firstLark, replayLark);
    if (stableJson(firstIntegrity) !== stableJson(replayIntegrity)) throw closeoutFailure(
      'Facebook Report recovery replay changed D1/Lark integrity evidence',
      'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INTEGRITY_DRIFT',
    );
  } catch (error) {
    primaryError = error;
  } finally {
    if (activeDeploymentAttempted) {
      currentStage = 'restore-preserved-notification-worker-baseline';
      try {
        await writeReviewedAttempt(outputRoot, 'facebook-config-dlq-restore-baseline', {
          repositoryHead: repository.head,
          reportId: selected.reportId,
          configSha256: config.safeSha256,
          notificationRuntimeState: config.notificationRuntime.state,
          activeVersionFingerprint: activeDeployment ? sha256(activeDeployment.versionId) : null,
        });
        restoreDeployment = await baselineRemote.deployConfig(
          config.safeText,
          'facebook-config-dlq-recovery-baseline',
          REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT,
        );
        const restoreStability = await baselineRemote.verifyDeployment(
          'active',
          restoreDeployment.versionId,
        );
        baselineRestoreVerified = restoreStability.stabilitySampleCount === 3;
      } catch (restoreError) {
        if (primaryError) throw closeoutFailure(
          'Facebook Report recovery failed and preserved baseline restore also failed',
          'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RESTORE_FAILED_AFTER_PRIMARY',
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
  if (!baselineRestoreVerified) throw closeoutFailure(
    'Facebook Report recovery requires verified preserved Worker baseline restore',
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RESTORE_NOT_VERIFIED',
  );

  currentStage = 'close-exact-retained-dlq';
  await writeReviewedAttempt(outputRoot, 'facebook-config-dlq-close', {
    repositoryHead: repository.head,
    dlqId: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.dlqId,
    closureReference: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.closureReference,
    reportId: selected.reportId,
    payloadChecksum: replay.payload_checksum,
  });
  for (const statement of buildReviewedConfigDlqClosureStatements()) {
    await runner.runText('npx', [
      'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
      '--config', configPath, '--command', statement,
    ], { env });
  }
  const closedIncident = await state.readD1Row(buildReviewedConfigDlqIncidentSql());
  assertReviewedConfigDlqClosed(closedIncident);

  currentStage = 'sanitized-recovery-summary';
  const summary = sanitizeReportLiveClosureEvidence({
    ok: true,
    contractVersion: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT,
    decision: 'FACEBOOK_REPORT_1D_CONFIG_DLQ_RECOVERED',
    repository,
    incident: {
      dlqId: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.dlqId,
      originalRepositoryHead: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.originalRepositoryHead,
      errorCode: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.errorCode,
      retryCount: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.retryCount,
      reportId: selected.reportId,
      jobSha256: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INCIDENT.jobSha256,
      firstMaterializationRetried: true,
      replaySent: true,
      closed: true,
    },
    preflight: {
      coverageStatus: preflight.coverage_status,
      coverageDatasetKey: preflight.coverage_dataset_key,
      sourceScope: preflight.source_scope,
      sourceWatermark: preflight.source_watermark,
      accountFactCount: Number(preflight.account_fact_count ?? 0),
      pendingMigrations,
      lark: larkPreflight,
      backup,
      remoteBaselineVersionFingerprint: sha256(remoteBaseline.activeVersion),
      activeStabilitySampleCount: activeStability.stabilitySampleCount,
      activeStabilityWindowMs: activeStability.stabilityWindowMs,
    },
    materialization: {
      reportId: first.report_id,
      payloadChecksum: first.payload_checksum,
      dataStatus: first.data_status,
      d1MaterializationCount: Number(first.materialization_count),
      larkRows: summarizeLarkState(firstLark),
      integrity: firstIntegrity,
    },
    replay: {
      sameInput: true,
      sameReportId: first.report_id === replay.report_id,
      samePayloadChecksum: first.payload_checksum === replay.payload_checksum,
      d1MaterializationCount: Number(replay.materialization_count),
      successfulSyncRunCount: Number(replay.successful_sync_count),
      larkRowsUnchanged: stableJson(firstLark) === stableJson(replayLark),
      integrityUnchanged: stableJson(firstIntegrity) === stableJson(replayIntegrity),
    },
    runtime: {
      notificationRuntimeState: config.notificationRuntime.state,
      baselineTrueFlags: config.safeTrueFlags,
      activeTrueFlags: config.activeTrueFlags,
      restoredBaseline: true,
      finalWorkerVersionFingerprint: sha256(restoreDeployment.versionId),
      queueMessagesSent: 2,
      providerRequestCount: 0,
      notificationAdmissionEnabled: false,
      aiSummaryEnabled: false,
      schedulesEnabled: false,
      production: false,
    },
  });
  await writePrivateJson(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: summaryPath }, null, 2)}\n`);
}

async function readJsonIfExists(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
