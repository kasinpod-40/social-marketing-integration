#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { sanitizeReportLiveClosureEvidence } from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import { readDevVars } from './lib/dev-vars.js';
import {
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
  REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT,
  assertReviewedConfigDlqAttempt,
  assertReviewedConfigDlqCandidate,
  assertReviewedConfigDlqClosed,
  assertReviewedConfigDlqIncident,
  assertReviewedConfigDlqInitialState,
  assertReviewedConfigDlqPreflight,
  buildReviewedConfigDlqClosureStatements,
  buildReviewedConfigDlqIncidentSql,
  resolveReviewedConfigDlqIncident,
} from './lib/report-runtime-reviewed-config-dlq-recovery.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const incident = resolveReviewedConfigDlqIncident(
  process.env.MKT_REPORT_RUNTIME_CONFIG_DLQ_INCIDENT,
);
const target = resolveReviewedReportRuntimeCloseoutTarget({
  MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: incident.platformScope,
});
const configPath = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_EVIDENCE_DIR
    ?? incident.evidenceDirectory,
);
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? 'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
);
const originalOutputRoot = resolve(incident.originalOutputRoot);
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
    incidentKey: incident.key,
    platformScope: incident.platformScope,
    windowDays: incident.windowDays,
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
  if (process.env.CONFIRM_REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY !== incident.confirmation) {
    throw closeoutFailure(
      `Execution requires CONFIRM_REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY=${incident.confirmation}`,
      'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_CONFIRMATION_REQUIRED',
      { incidentKey: incident.key },
    );
  }
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const existingSummary = await readJsonIfExists(summaryPath);
  if (existingSummary) {
    if (existingSummary.ok !== true
      || existingSummary.contractVersion !== REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT
      || existingSummary.incident?.dlqId !== incident.dlqId
      || existingSummary.runtime?.restoredBaseline !== true
      || existingSummary.runtime?.notificationAdmissionEnabled !== false) throw closeoutFailure(
      `Existing ${incident.label} Report DLQ recovery summary is incomplete`,
      'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_SUMMARY_INVALID',
      { incidentKey: incident.key },
    );
    process.stdout.write(`${JSON.stringify({ ...existingSummary, evidencePath: summaryPath }, null, 2)}\n`);
    return;
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({
    ...fileEnv,
    ...process.env,
    MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS:
      process.env.MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS ?? '120',
  });
  const runner = createCommandRunner({ execFileAsync, cwd: repositoryRoot, baseEnv: process.env });

  currentStage = 'repository-finalizer-and-retained-incident';
  const repository = await assertReviewedRepositoryState(runner);
  await runner.run('git', [
    'merge-base', '--is-ancestor',
    incident.originalRepositoryHead,
    repository.head,
  ]);
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository?.head !== repository.head) throw closeoutFailure(
    `${incident.label} Report DLQ recovery requires Finalizer evidence from current main`,
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_FINALIZER_HEAD_MISMATCH',
    {
      incidentKey: incident.key,
      evidenceHead: finalizerEvidence.repository?.head ?? null,
      repositoryHead: repository.head,
    },
  );
  const originalAttempt = JSON.parse(await readFile(
    join(originalOutputRoot, incident.originalAttemptFile),
    'utf8',
  ));
  assertReviewedConfigDlqAttempt(originalAttempt, incident);

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
    `Pending migrations block ${incident.label} Report DLQ recovery`,
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_PENDING_MIGRATIONS',
    { incidentKey: incident.key, pendingMigrationCount: pendingMigrations.length },
  );
  const preflight = await state.readD1Row(buildReportRuntimePreflightSql({
    target: { ...target, customerKey: 'chemistry_k' },
  }));
  assertReviewedConfigDlqPreflight(preflight, incident);
  const incidentRow = await state.readD1Row(buildReviewedConfigDlqIncidentSql(incident));
  const incidentEvidence = assertReviewedConfigDlqIncident(incidentRow, incident);
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: incident.requestedAt,
    periodEnd: incident.periodEnd,
    sourceWatermark: incident.sourceWatermark,
    timeZone: 'Asia/Bangkok',
    platformScope: incident.platformScope,
    accountKey: incident.accountKey,
    formulaVersion: incident.formulaVersion,
  });
  const selected = candidates.find((candidate) => candidate.windowDays === incident.windowDays);
  assertReviewedConfigDlqCandidate(selected, incident);
  if (stableJson(selected.job) !== stableJson(incidentEvidence.replayPayload)) throw closeoutFailure(
    `Regenerated ${incident.label} Queue job differs byte-for-byte from retained replay payload`,
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_REPLAY_PAYLOAD_MISMATCH',
    { incidentKey: incident.key },
  );
  const client = createLarkBitableClientFromEnv(env);
  const larkPreflight = await state.verifyLarkInventory(client, config.tableIds);
  const initialD1 = await state.readD1Snapshot(selected, incident.requestedAt);
  const initialLark = await state.readLarkReportState(client, config.tableIds, selected.reportId);
  assertReviewedConfigDlqInitialState({ d1: initialD1, lark: initialLark }, incident);
  const remoteBaseline = await baselineRemote.verifyDeployment('active');
  const backup = await state.createD1Backup(
    `${incident.platformScope}-${incident.windowDays}d-before-config-dlq-recovery`,
  );

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
  const attemptPrefix = `${incident.platformScope}-${incident.windowDays}d-config-dlq`;

  try {
    currentStage = 'deploy-and-stabilize-reviewed-report-window';
    await writeReviewedAttempt(outputRoot, `${attemptPrefix}-deploy-active`, {
      incidentKey: incident.key,
      repositoryHead: repository.head,
      originalRepositoryHead: incident.originalRepositoryHead,
      reportId: selected.reportId,
      configSha256: config.activeSha256,
      jobSha256: incident.jobSha256,
      backup,
    });
    activeDeployment = await activeRemote.deployConfig(
      config.activeText,
      `${attemptPrefix}-recovery-active`,
      REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT,
    );
    activeDeploymentAttempted = true;
    activeStability = await activeRemote.verifyDeployment('active', activeDeployment.versionId);
    if (activeStability.stabilitySampleCount !== 3) throw closeoutFailure(
      `${incident.label} Report recovery requires three stable Active Worker samples`,
      'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_ACTIVE_NOT_STABLE',
      { incidentKey: incident.key, sampleCount: activeStability.stabilitySampleCount ?? 0 },
    );

    currentStage = `send-exact-${incident.platformScope}-${incident.windowDays}d-first-materialization-retry-once`;
    await writeReviewedAttempt(outputRoot, `${attemptPrefix}-send-first-retry`, {
      incidentKey: incident.key,
      reportId: selected.reportId,
      jobSha256: incident.jobSha256,
      retryRequestedAt,
      originalDlqId: incident.dlqId,
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

    currentStage = `send-exact-${incident.platformScope}-${incident.windowDays}d-replay-once`;
    await writeReviewedAttempt(outputRoot, `${attemptPrefix}-send-replay`, {
      incidentKey: incident.key,
      reportId: selected.reportId,
      jobSha256: incident.jobSha256,
      retryRequestedAt,
      originalDlqId: incident.dlqId,
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
      `${incident.label} Report recovery replay changed D1/Lark integrity evidence`,
      'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_INTEGRITY_DRIFT',
      { incidentKey: incident.key },
    );
  } catch (error) {
    primaryError = error;
  } finally {
    if (activeDeploymentAttempted) {
      currentStage = 'restore-preserved-notification-worker-baseline';
      try {
        await writeReviewedAttempt(outputRoot, `${attemptPrefix}-restore-baseline`, {
          incidentKey: incident.key,
          repositoryHead: repository.head,
          reportId: selected.reportId,
          configSha256: config.safeSha256,
          notificationRuntimeState: config.notificationRuntime.state,
          activeVersionFingerprint: activeDeployment ? sha256(activeDeployment.versionId) : null,
        });
        restoreDeployment = await baselineRemote.deployConfig(
          config.safeText,
          `${attemptPrefix}-recovery-baseline`,
          REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT,
        );
        const restoreStability = await baselineRemote.verifyDeployment(
          'active',
          restoreDeployment.versionId,
        );
        baselineRestoreVerified = restoreStability.stabilitySampleCount === 3;
      } catch (restoreError) {
        if (primaryError) throw closeoutFailure(
          `${incident.label} Report recovery failed and preserved baseline restore also failed`,
          'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RESTORE_FAILED_AFTER_PRIMARY',
          {
            incidentKey: incident.key,
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
    `${incident.label} Report recovery requires verified preserved Worker baseline restore`,
    'REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RESTORE_NOT_VERIFIED',
    { incidentKey: incident.key },
  );

  currentStage = 'close-exact-retained-dlq';
  await writeReviewedAttempt(outputRoot, `${attemptPrefix}-close`, {
    incidentKey: incident.key,
    repositoryHead: repository.head,
    dlqId: incident.dlqId,
    closureReference: incident.closureReference,
    reportId: selected.reportId,
    payloadChecksum: replay.payload_checksum,
  });
  for (const statement of buildReviewedConfigDlqClosureStatements(Date.now(), incident)) {
    await runner.runText('npx', [
      'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
      '--config', configPath, '--command', statement,
    ], { env });
  }
  const closedIncident = await state.readD1Row(buildReviewedConfigDlqIncidentSql(incident));
  assertReviewedConfigDlqClosed(closedIncident, incident);

  currentStage = 'sanitized-recovery-summary';
  const summary = sanitizeReportLiveClosureEvidence({
    ok: true,
    contractVersion: REPORT_RUNTIME_REVIEWED_CONFIG_DLQ_RECOVERY_CONTRACT,
    decision: incident.decision,
    repository,
    incident: {
      incidentKey: incident.key,
      dlqId: incident.dlqId,
      originalRepositoryHead: incident.originalRepositoryHead,
      platformScope: incident.platformScope,
      windowDays: incident.windowDays,
      errorCode: incident.errorCode,
      retryCount: incident.retryCount,
      reportId: selected.reportId,
      jobSha256: incident.jobSha256,
      firstMaterializationRetried: true,
      replaySent: true,
      closed: true,
    },
    preflight: {
      coverageStatus: preflight.coverage_status,
      coverageDatasetKey: preflight.coverage_dataset_key,
      sourceScope: preflight.source_scope,
      sourceWatermark: preflight.source_watermark,
      sourceFactCount: Number(preflight[incident.sourceFactField] ?? 0),
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
