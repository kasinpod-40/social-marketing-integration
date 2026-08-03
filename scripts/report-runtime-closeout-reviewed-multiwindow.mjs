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
  buildReportRuntimeCloseoutConfigWindow,
  parseReportRuntimeCloseoutArgs,
} from './lib/report-runtime-closeout-operator.js';
import {
  REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS,
  assertYouTubeReportRuntimeCloseoutPreflight,
  resolveReviewedReportRuntimeCloseoutTarget,
} from './lib/report-runtime-closeout-channel-binding.js';
import {
  buildReportRuntimeOrganicPreflightSql,
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
  if (target.platformScope !== 'youtube' || target.capability !== 'organic') throw closeoutFailure(
    'Reviewed multiwindow executor accepts YouTube Organic only',
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_TARGET_INVALID',
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
    activeDeploymentAttempted,
    safeRestoreVerified,
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
    executionContract: 'report_runtime_reviewed_multiwindow_v1',
    command: [
      'MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE=youtube',
      'MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF=<retained-sanitized-handoff.json>',
      `CONFIRM_REPORT_RUNTIME_CLOSEOUT=${REPORT_RUNTIME_CLOSEOUT_CONFIRMATION}`,
      'node scripts/report-runtime-closeout-operator.mjs --execute',
    ].join(' \\\n'),
    scope: 'youtube organic exact 1/3/7/30 reviewed materialization from D1 to Lark',
    windows: REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS,
    reviewedHandoffRequired: true,
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
  const config = buildReportRuntimeCloseoutConfigWindow(sourceText, {
    activeTrueFlags: target.activeTrueFlags,
  });
  const auth = await resolveReviewedCloudflareSession({ env, sourceText, runText: runner.runText });
  const queue = await resolveReviewedQueue({
    accountId: auth.accountId, token: auth.token, expectedName: config.mainQueueName,
  });
  const remote = createReviewedRemoteRuntime({
    ...runner,
    configPath,
    repositoryRoot,
    env,
    repositoryHead: repository.head,
    target,
    requiredTables: REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
    config,
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

  currentStage = 'lark-and-youtube-d1-preflight';
  const client = createLarkBitableClientFromEnv(env);
  const larkPreflight = await state.verifyLarkInventory(client, config.tableIds);
  const d1Preflight = await state.readD1Row(buildReportRuntimeOrganicPreflightSql({
    target: { ...target, customerKey: 'chemistry_k' },
  }));
  assertYouTubeReportRuntimeCloseoutPreflight(d1Preflight);
  if (d1Preflight.source_watermark !== reviewed.sourceWatermark) throw closeoutFailure(
    'Current YouTube Coverage watermark differs from retained reviewed readiness evidence',
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_WATERMARK_DRIFT',
    { watermarkMatched: false },
  );

  currentStage = 'remote-safe-preflight-and-backup';
  const pendingMigrations = await state.readPendingMigrations();
  if (pendingMigrations.length > 0) throw closeoutFailure(
    'Pending migrations block Report closeout',
    'REPORT_RUNTIME_CLOSEOUT_PENDING_MIGRATIONS',
    { pendingMigrationCount: pendingMigrations.length },
  );
  const safeBundle = await remote.buildBundle(config.safeText, 'youtube-safe-preflight');
  const activeBundle = await remote.buildBundle(config.activeText, 'youtube-active-preflight');
  const remoteSafe = await remote.verifyDeployment('safe');

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
  });
  const prestates = [];
  for (const selected of plan) {
    const d1 = await state.readD1Snapshot(selected, requestedAt);
    const lark = await state.readLarkReportState(client, config.tableIds, selected.reportId);
    assertReportRuntimeWindowTargetPrestate({
      operation: selected.operation === 'verify' ? 'refresh' : selected.operation,
      reportId: selected.reportId,
      d1,
      lark,
    });
    if (selected.operation === 'verify') assertD1LarkIntegrity(d1, lark);
    prestates.push(Object.freeze({ selected, d1, lark }));
  }

  const backup = await state.createD1Backup();
  const results = [];
  let activeDeployment = null;
  let restoreDeployment = null;
  let primaryError = null;
  let successfulRunFloor = 0;

  try {
    currentStage = 'deploy-report-only-window-once';
    await writeReviewedAttempt(outputRoot, 'youtube-deploy-active', {
      repositoryHead: repository.head,
      configSha256: config.activeSha256,
      windows: plan.map((row) => row.windowDays),
    });
    activeDeployment = await remote.deployConfig(
      config.activeText,
      'youtube-reviewed-multiwindow-active',
      REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
    );
    activeDeploymentAttempted = true;
    await remote.verifyDeployment('active', activeDeployment.versionId);

    for (const prestate of prestates) {
      currentStage = `execute-${prestate.selected.windowDays}d`;
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
      currentStage = 'restore-all-false';
      try {
        await writeReviewedAttempt(outputRoot, 'youtube-restore-safe', {
          repositoryHead: repository.head,
          configSha256: config.safeSha256,
          activeVersionFingerprint: activeDeployment ? sha256(activeDeployment.versionId) : null,
        });
        restoreDeployment = await remote.deployConfig(
          config.safeText,
          'youtube-reviewed-multiwindow-safe-restore',
          REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
        );
        await remote.verifyDeployment('safe', restoreDeployment.versionId);
        safeRestoreVerified = true;
      } catch (restoreError) {
        if (primaryError) throw closeoutFailure(
          'YouTube Report closeout failed and all-false restore also failed',
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
    'YouTube Report closeout requires verified all-false restore',
    'REPORT_RUNTIME_CLOSEOUT_RESTORE_NOT_VERIFIED',
  );
  if (results.length !== 4 || results.some((row) => row.zeroDrift !== true)) throw closeoutFailure(
    'YouTube Report closeout did not verify all four windows with zero drift',
    'REPORT_RUNTIME_CLOSEOUT_MULTIWINDOW_INCOMPLETE',
    { completedWindowCount: results.length },
  );

  currentStage = 'sanitized-closeout-summary';
  const summary = sanitizeReportLiveClosureEvidence({
    ok: true,
    contractVersion: REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
    executionContract: 'report_runtime_reviewed_multiwindow_v1',
    decision: 'YOUTUBE_REPORT_1_3_7_30_CLOSED',
    repository,
    target: {
      environment: 'development',
      customerProfile: 'integration_workspace',
      platform: target.platformScope,
      capability: target.capability,
      accountKey: target.accountKey,
      accountId: reviewed.accountId,
      sourceWatermark: d1Preflight.source_watermark,
      periodEnd: d1Preflight.period_end,
    },
    reviewedHandoff: {
      contractVersion: reviewed.handoff.contractVersion,
      metaRemoteLockReleased: reviewed.handoff.metaRemoteLock.released,
      readinessContractVersion: reviewed.handoff.youtubeReadiness.contractVersion,
      readyForLive: reviewed.handoff.youtubeReadiness.assessment.readyForLive,
    },
    preflight: {
      lark: larkPreflight,
      coverageStatus: d1Preflight.coverage_status,
      contentStateCount: Number(d1Preflight.content_state_count),
      observationCount: Number(d1Preflight.observation_count),
      pendingMigrations,
      safeBundleSha256: safeBundle.sha256,
      activeBundleSha256: activeBundle.sha256,
      backup,
      remoteSafeVersionFingerprint: sha256(remoteSafe.activeVersion),
    },
    windows: results,
    runtime: {
      activeTrueFlags: target.activeTrueFlags,
      restoredAllFalse: true,
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

  if (selected.operation !== 'verify') {
    await writeReviewedAttempt(outputRoot, `youtube-${selected.windowDays}d-send-first`, {
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
    assertReportRuntimeWindowChanged({ operation: selected.operation, before, after: first });
    const verified = await state.pollLarkIntegrity(client, config.tableIds, selected.reportId, first);
    firstLark = verified.state;
    firstIntegrity = verified.integrity;
    firstPollAttempts = verified.attemptCount;
  }

  await writeReviewedAttempt(outputRoot, `youtube-${selected.windowDays}d-send-replay`, {
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
    'YouTube Report replay changed D1/Lark integrity evidence',
    'REPORT_RUNTIME_CLOSEOUT_REPLAY_INTEGRITY_DRIFT',
    { windowDays: selected.windowDays },
  );

  return Object.freeze({
    successfulRunFloor,
    summary: Object.freeze({
      windowDays: selected.windowDays,
      action: selected.action,
      operation: selected.operation,
      reportSettingKey: selected.reportSettingKey,
      reportId: selected.reportId,
      dataStatus: replay.data_status,
      payloadChecksum: replay.payload_checksum,
      d1MaterializationCount: Number(replay.materialization_count),
      larkRows: summarizeLarkState(replayVerified.state),
      firstLarkIntegrityPollAttempts: firstPollAttempts,
      replayLarkIntegrityPollAttempts: replayVerified.attemptCount,
      sameInput: true,
      sameReportId: first.report_id === replay.report_id,
      samePayloadChecksum: first.payload_checksum === replay.payload_checksum,
      zeroDrift: stableJson(firstLark) === stableJson(replayVerified.state)
        && stableJson(firstIntegrity) === stableJson(replayVerified.integrity),
      queueMessagesSent,
    }),
  });
}
