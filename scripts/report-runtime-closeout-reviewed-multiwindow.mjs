#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { sanitizeReportLiveClosureEvidence } from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  assertReportRuntimeCloseoutCompletion,
  assertReportRuntimeCloseoutConfirmation,
  assertReportRuntimeCloseoutReplay,
  assertReportRuntimeFinalizerEvidence,
  buildReportRuntimeCloseoutCandidates,
  parseReportRuntimeCloseoutArgs,
} from './lib/report-runtime-closeout-operator.js';
import {
  buildNotificationPreservingReportRuntimeConfigWindow,
} from './lib/report-runtime-notification-preserving-config.js';
import {
  REPORT_RUNTIME_REVIEWED_CHANNELS,
  REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS,
  assertReviewedReportRuntimeCloseoutPreflight,
  resolveReviewedReportRuntimeCloseoutTarget,
} from './lib/report-runtime-closeout-channel-binding.js';
import {
  buildReportRuntimePreflightSql,
  buildReviewedReportRuntimeMultiwindowPlan,
  loadReviewedReportRuntimeCloseoutHandoff,
} from './lib/report-runtime-closeout-reviewed-binding.js';
import {
  assertReportRuntimeWindowChanged,
  assertReportRuntimeWindowTargetPrestate,
} from './lib/report-runtime-window-repair.js';
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

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const target = resolveReviewedReportRuntimeCloseoutTarget(process.env);
const configPath = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR ?? target.outputDirectory,
);
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

try {
  if (!REPORT_RUNTIME_REVIEWED_CHANNELS.includes(target.platformScope)) throw closeoutFailure(
    'Reviewed multiwindow executor target is unsupported',
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_TARGET_INVALID',
    { platformScope: target.platformScope, supportedPlatforms: REPORT_RUNTIME_REVIEWED_CHANNELS },
  );
  const options = parseReportRuntimeCloseoutArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeCloseout();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'REPORT_RUNTIME_CLOSEOUT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeReportLiveClosureEvidence(error?.details ?? {}),
    platformScope: target.platformScope,
    activeDeploymentAttempted,
    baselineRestoreVerified: safeRestoreVerified,
    providerRequestCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
    executionContract: 'report_runtime_reviewed_multiwindow_v2',
    command: [
      `MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE=${target.platformScope}`,
      'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=<retained-sanitized-handoff.json>',
      `CONFIRM_REPORT_RUNTIME_CLOSEOUT=${REPORT_RUNTIME_CLOSEOUT_CONFIRMATION}`,
      'node scripts/report-runtime-closeout-reviewed-multiwindow.mjs --execute',
    ].join(' \\\n'),
    scope: `${target.platformScope} ${target.capability} exact 1/3/7/30 reviewed materialization from D1 to Lark`,
    windows: REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS,
    reviewedHandoffRequired: true,
    notificationRuntimeBaselinePreserved: true,
    notificationAdmissionEnabled: false,
    providerRequests: false,
    schedulesEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeCloseout() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertReportRuntimeCloseoutConfirmation(env);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const runner = createCommandRunner({ execFileAsync, cwd: repositoryRoot, baseEnv: process.env });

  currentStage = 'repository-finalizer-and-reviewed-handoff';
  const repository = await assertReviewedRepositoryState(runner);
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository.head !== repository.head) throw closeoutFailure(
    'Report closeout requires finalizer evidence from the current main HEAD',
    'REPORT_RUNTIME_CLOSEOUT_FINALIZER_HEAD_MISMATCH',
    { evidenceHead: finalizerEvidence.repository.head, repositoryHead: repository.head },
  );
  const reviewed = await loadReviewedReportRuntimeCloseoutHandoff({ env, target, repository });

  const sourceText = await readFile(configPath, 'utf8');
  const config = buildNotificationPreservingReportRuntimeConfigWindow(sourceText, {
    activeTrueFlags: target.activeTrueFlags,
    finalizerEvidencePath,
    expectedRepositoryHead: repository.head,
  });
  const auth = await resolveReviewedCloudflareSession({ env, sourceText, runText: runner.runText });
  const queue = await resolveReviewedQueue({
    accountId: auth.accountId, token: auth.token, expectedName: config.mainQueueName,
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

  currentStage = `lark-and-${target.platformScope}-d1-preflight`;
  const client = createLarkBitableClientFromEnv(env);
  const larkPreflight = await state.verifyLarkInventory(client, config.tableIds);
  const d1Preflight = await state.readD1Row(buildReportRuntimePreflightSql({
    target: { ...target, customerKey: 'chemistry_k' },
  }));
  assertReviewedReportRuntimeCloseoutPreflight(d1Preflight, target);
  if (d1Preflight.source_watermark !== reviewed.sourceWatermark) throw closeoutFailure(
    `Current ${target.platformScope} Coverage watermark differs from retained reviewed readiness evidence`,
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_WATERMARK_DRIFT',
    { platformScope: target.platformScope, watermarkMatched: false },
  );

  currentStage = 'remote-baseline-preflight-and-backup';
  const pendingMigrations = await state.readPendingMigrations();
  if (pendingMigrations.length > 0) throw closeoutFailure(
    'Pending migrations block Report closeout',
    'REPORT_RUNTIME_CLOSEOUT_PENDING_MIGRATIONS',
    { pendingMigrationCount: pendingMigrations.length },
  );
  const safeBundle = await baselineRemote.buildBundle(
    config.safeText,
    `${target.platformScope}-baseline-preflight`,
  );
  const activeBundle = await activeRemote.buildBundle(
    config.activeText,
    `${target.platformScope}-active-preflight`,
  );
  const remoteBaseline = await baselineRemote.verifyDeployment('active');

  const requestedAt = Date.now();
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt,
    periodEnd: d1Preflight.period_end,
    sourceWatermark: d1Preflight.source_watermark,
    timeZone: 'Asia/Bangkok',
    platformScope: target.platformScope,
    accountKey: target.accountKey,
    formulaVersion: target.formulaVersion,
  }).filter((candidate) => REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS.includes(candidate.windowDays));
  const existingIds = await state.readExistingReportIds(candidates.map((candidate) => candidate.reportId));
  const plan = buildReviewedReportRuntimeMultiwindowPlan({
    candidates,
    existingReportIds: existingIds,
    reviewedHandoff: reviewed.handoff,
    platformScope: target.platformScope,
  });
  const prestates = [];
  for (const selected of plan) {
    const d1 = await state.readD1Snapshot(selected, requestedAt);
    const lark = await state.readLarkReportState(client, config.tableIds, selected.reportId);
    if (selected.operation === 'fresh') {
      assertReportRuntimeWindowTargetPrestate({
        operation: 'fresh', reportId: selected.reportId, d1, lark,
      });
    } else if (selected.operation === 'verify') {
      assertReportRuntimeWindowTargetPrestate({
        operation: 'refresh', reportId: selected.reportId, d1, lark,
      });
      assertD1LarkIntegrity(d1, lark);
    } else {
      assertRepairableWindowPrestate({ reportId: selected.reportId, d1, lark });
    }
    prestates.push(Object.freeze({ selected, d1, lark }));
  }

  const backup = await state.createD1Backup(`${target.platformScope}-before-multiwindow`);
  const results = [];
  let activeDeployment = null;
  let restoreDeployment = null;
  let primaryError = null;
  let successfulRunFloor = 0;

  try {
    currentStage = 'deploy-report-window-once';
    await writeReviewedAttempt(outputRoot, `${target.platformScope}-deploy-active`, {
      repositoryHead: repository.head,
      configSha256: config.activeSha256,
      baselineTrueFlagCount: config.safeTrueFlags.length,
      windows: plan.map((row) => row.windowDays),
    });
    activeDeployment = await activeRemote.deployConfig(
      config.activeText,
      `${target.platformScope}-reviewed-multiwindow-active`,
      REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
    );
    activeDeploymentAttempted = true;
    await activeRemote.verifyDeployment('active', activeDeployment.versionId);

    for (const prestate of prestates) {
      currentStage = `execute-${target.platformScope}-${prestate.selected.windowDays}d`;
      const result = await executeWindow({
        client,
        config,
        state,
        auth,
        queue,
        selected: prestate.selected,
        before: prestate.d1,
        larkBefore: prestate.lark,
        requestedAt,
        successfulRunFloor,
      });
      successfulRunFloor = result.successfulRunFloor;
      results.push(result.summary);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (activeDeploymentAttempted) {
      currentStage = 'restore-preserved-worker-baseline';
      try {
        await writeReviewedAttempt(outputRoot, `${target.platformScope}-restore-baseline`, {
          repositoryHead: repository.head,
          configSha256: config.safeSha256,
          notificationRuntimeState: config.notificationRuntime.state,
          activeVersionFingerprint: activeDeployment ? sha256(activeDeployment.versionId) : null,
        });
        restoreDeployment = await baselineRemote.deployConfig(
          config.safeText,
          `${target.platformScope}-reviewed-multiwindow-baseline-restore`,
          REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
        );
        await baselineRemote.verifyDeployment('active', restoreDeployment.versionId);
        safeRestoreVerified = true;
      } catch (restoreError) {
        if (primaryError) throw closeoutFailure(
          `${target.platformScope} Report closeout failed and preserved baseline restore also failed`,
          'REPORT_RUNTIME_CLOSEOUT_RESTORE_FAILED_AFTER_PRIMARY_ERROR',
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
  if (!safeRestoreVerified) throw closeoutFailure(
    `${target.platformScope} Report closeout requires verified Worker baseline restore`,
    'REPORT_RUNTIME_CLOSEOUT_RESTORE_NOT_VERIFIED',
  );
  if (results.length !== 4 || results.some((row) => row.zeroDrift !== true)) throw closeoutFailure(
    `${target.platformScope} Report closeout did not verify all four windows with zero drift`,
    'REPORT_RUNTIME_CLOSEOUT_MULTIWINDOW_INCOMPLETE',
    { completedWindowCount: results.length },
  );

  currentStage = 'sanitized-closeout-summary';
  const summary = sanitizeReportLiveClosureEvidence({
    ok: true,
    contractVersion: REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
    executionContract: 'report_runtime_reviewed_multiwindow_v2',
    decision: `${target.platformScope.toUpperCase()}_REPORT_1_3_7_30_CLOSED`,
    repository,
    target: {
      environment: 'development',
      customerProfile: 'integration_workspace',
      platform: target.platformScope,
      capability: target.capability,
      accountKey: target.accountKey,
      sourceWatermark: d1Preflight.source_watermark,
      periodEnd: d1Preflight.period_end,
    },
    reviewedHandoff: {
      contractVersion: reviewed.handoff.contractVersion,
      metaRemoteLockReleased: reviewed.handoff.metaRemoteLock.released,
      readinessContractVersion: reviewed.readiness.contractVersion,
      readyForLive: reviewed.readiness.assessment.readyForLive,
    },
    preflight: {
      lark: larkPreflight,
      coverageStatus: d1Preflight.coverage_status,
      coverageScopeMode: d1Preflight.coverage_scope_mode ?? null,
      contentStateCount: Number(d1Preflight.content_state_count ?? 0),
      observationCount: Number(d1Preflight.observation_count ?? 0),
      dailyFactCount: Number(d1Preflight.daily_fact_count ?? 0),
      orderStateCount: Number(d1Preflight.order_state_count ?? 0),
      conversationFactCount: Number(d1Preflight.conversation_fact_count ?? 0),
      accountFactCount: Number(d1Preflight.account_fact_count ?? 0),
      pendingMigrations,
      baselineBundleSha256: safeBundle.sha256,
      activeBundleSha256: activeBundle.sha256,
      backup,
      remoteBaselineVersionFingerprint: sha256(remoteBaseline.activeVersion),
    },
    windows: results,
    runtime: {
      reportActiveTrueFlags: target.activeTrueFlags,
      baselineTrueFlags: config.safeTrueFlags,
      activeTrueFlags: config.activeTrueFlags,
      notificationRuntimeState: config.notificationRuntime.state,
      notificationAdmissionEnabled: false,
      restoredBaseline: true,
      restoredAllFalse: config.safeTrueFlags.length === 0,
      finalWorkerVersionFingerprint: sha256(restoreDeployment.versionId),
      queueMessagesSent: results.reduce((total, row) => total + row.queueMessagesSent, 0),
      providerRequestCount: 0,
      aiSummaryEnabled: false,
      schedulesEnabled: false,
      production: false,
    },
  });
  const evidencePath = join(outputRoot, 'report-runtime-closeout-summary.json');
  await writePrivateJson(evidencePath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
}

async function executeWindow(input) {
  const { selected, before, larkBefore, requestedAt, state, client, config, auth, queue } = input;
  let successfulRunFloor = input.successfulRunFloor;
  let first = before;
  let firstLark = larkBefore;
  let firstIntegrity = selected.operation === 'verify'
    ? assertD1LarkIntegrity(first, firstLark)
    : null;
  let firstPollAttempts = 0;
  let queueMessagesSent = 0;

  if (selected.operation === 'verify') {
    await writeReviewedAttempt(outputRoot, `${target.platformScope}-${selected.windowDays}d-reuse-verified`, {
      reportId: selected.reportId,
      action: selected.action,
      operation: selected.operation,
      payloadChecksum: first.payload_checksum,
      requestedAt,
      queueMessagesSent: 0,
      replayExecuted: false,
    });
    return Object.freeze({
      successfulRunFloor,
      summary: Object.freeze({
        windowDays: selected.windowDays,
        action: selected.action,
        operation: selected.operation,
        executionMode: 'reuse_verified_materialization',
        reportSettingKey: selected.reportSettingKey,
        reportId: selected.reportId,
        dataStatus: first.data_status,
        payloadChecksum: first.payload_checksum,
        d1MaterializationCount: Number(first.materialization_count),
        larkRows: summarizeLarkState(firstLark),
        firstLarkIntegrityPollAttempts: 0,
        replayLarkIntegrityPollAttempts: 0,
        reusedExisting: true,
        replayExecuted: false,
        sameInput: null,
        sameReportId: true,
        samePayloadChecksum: true,
        zeroDrift: true,
        queueMessagesSent: 0,
      }),
    });
  }

  await writeReviewedAttempt(outputRoot, `${target.platformScope}-${selected.windowDays}d-send-first`, {
    reportId: selected.reportId,
    action: selected.action,
    jobSha256: sha256(stableJson(selected.job)),
    requestedAt,
  });
  await sendReviewedQueueMessage({ auth, queueId: queue.queueId, job: selected.job });
  queueMessagesSent += 1;
  successfulRunFloor += 1;
  first = await state.pollD1Completion(selected, requestedAt, successfulRunFloor);
  assertReportRuntimeCloseoutCompletion(first, { reportId: selected.reportId });
  if (selected.operation === 'fresh') {
    assertReportRuntimeWindowChanged({ operation: 'fresh', before, after: first });
  } else {
    assertRepairTransition({ reportId: selected.reportId, before, after: first });
  }
  const verified = await state.pollLarkIntegrity(client, config.tableIds, selected.reportId, first);
  firstLark = verified.state;
  firstIntegrity = verified.integrity;
  firstPollAttempts = verified.attemptCount;

  await writeReviewedAttempt(outputRoot, `${target.platformScope}-${selected.windowDays}d-send-replay`, {
    reportId: selected.reportId,
    action: selected.action,
    jobSha256: sha256(stableJson(selected.job)),
    requestedAt,
  });
  await sendReviewedQueueMessage({ auth, queueId: queue.queueId, job: selected.job });
  queueMessagesSent += 1;
  successfulRunFloor += 1;
  const replay = await state.pollD1Completion(selected, requestedAt, successfulRunFloor);
  assertReportRuntimeCloseoutCompletion(replay, { reportId: selected.reportId });
  assertReportRuntimeCloseoutReplay(first, replay);
  const replayVerified = await state.pollLarkIntegrity(client, config.tableIds, selected.reportId, replay);
  assertLarkReplay(firstLark, replayVerified.state);
  if (stableJson(firstIntegrity) !== stableJson(replayVerified.integrity)) throw closeoutFailure(
    `${target.platformScope} Report replay changed D1/Lark integrity evidence`,
    'REPORT_RUNTIME_CLOSEOUT_REPLAY_INTEGRITY_DRIFT',
    { windowDays: selected.windowDays },
  );

  return Object.freeze({
    successfulRunFloor,
    summary: Object.freeze({
      windowDays: selected.windowDays,
      action: selected.action,
      operation: selected.operation,
      executionMode: 'materialize_and_replay',
      reportSettingKey: selected.reportSettingKey,
      reportId: selected.reportId,
      dataStatus: replay.data_status,
      payloadChecksum: replay.payload_checksum,
      d1MaterializationCount: Number(replay.materialization_count),
      larkRows: summarizeLarkState(replayVerified.state),
      firstLarkIntegrityPollAttempts: firstPollAttempts,
      replayLarkIntegrityPollAttempts: replayVerified.attemptCount,
      reusedExisting: false,
      replayExecuted: true,
      sameInput: true,
      sameReportId: first.report_id === replay.report_id,
      samePayloadChecksum: first.payload_checksum === replay.payload_checksum,
      zeroDrift: stableJson(firstLark) === stableJson(replayVerified.state)
        && stableJson(firstIntegrity) === stableJson(replayVerified.integrity),
      queueMessagesSent,
    }),
  });
}

function assertRepairableWindowPrestate({ reportId, d1, lark }) {
  if (Number(d1.materialization_count ?? 0) !== 1
    || d1.report_id !== reportId
    || typeof d1.payload_checksum !== 'string'
    || d1.payload_checksum.trim() === ''
    || Number(lark.snapshots ?? 0) > 1
    || Number(lark.duplicateMetricKeys ?? 0) !== 0) throw closeoutFailure(
    'Report repair target has duplicate or incomplete D1 identity',
    'REPORT_RUNTIME_CLOSEOUT_REPAIR_PRESTATE_INVALID',
    {
      reportIdMatched: d1.report_id === reportId,
      materializationCount: Number(d1.materialization_count ?? 0),
      larkSnapshots: Number(lark.snapshots ?? 0),
      duplicateMetricKeys: Number(lark.duplicateMetricKeys ?? 0),
    },
  );
}

function assertRepairTransition({ reportId, before, after }) {
  if (Number(before.materialization_count ?? 0) !== 1
    || Number(after.materialization_count ?? 0) !== 1
    || before.report_id !== reportId
    || after.report_id !== reportId
    || typeof after.payload_checksum !== 'string'
    || after.payload_checksum.trim() === '') throw closeoutFailure(
    'Report repair did not preserve one Stable D1 materialization identity',
    'REPORT_RUNTIME_CLOSEOUT_REPAIR_TRANSITION_INVALID',
    { reportIdMatched: after.report_id === reportId },
  );
}
