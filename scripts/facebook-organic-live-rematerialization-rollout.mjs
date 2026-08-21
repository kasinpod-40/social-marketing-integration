#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  assertReportRuntimeCloseoutCompletion,
  buildReportRuntimeCloseoutCandidates,
  buildReportRuntimeCloseoutConfigWindow,
} from './lib/report-runtime-closeout-operator.js';
import {
  assertReviewedReportRuntimeCloseoutPreflight,
  resolveReviewedReportRuntimeCloseoutTarget,
} from './lib/report-runtime-closeout-channel-binding.js';
import {
  buildReportRuntimePreflightSql,
} from './lib/report-runtime-closeout-reviewed-binding.js';
import {
  assertD1LarkIntegrity,
  createReviewedStateRuntime,
  summarizeLarkState,
} from './lib/report-runtime-closeout-reviewed-state.js';
import {
  createReviewedRemoteRuntime,
  resolveReviewedCloudflareSession,
  resolveReviewedQueue,
  sendReviewedQueueMessage,
} from './lib/report-runtime-closeout-reviewed-remote.js';
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
  assertReportRuntimeWindowChanged,
  assertReportRuntimeWindowTargetPrestate,
} from './lib/report-runtime-window-repair.js';
import {
  FACEBOOK_ORGANIC_AGGREGATION_REPAIR_SHA,
  FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONTRACT_VERSION,
  FACEBOOK_ORGANIC_LIVE_WINDOWS,
  assertExactRuntimeFlagRestoration,
  assertFacebookOrganicLiveRolloutConfirmation,
  assertNoRecordedMutationForExecute,
  assertRecoveryIsReadOnlyForReports,
  buildExactRuntimePreservingConfigs,
  buildFacebookRefreshPlan,
  collectWorkerBindings,
  diffExecutionFlagMaps,
  extractActiveWorkerVersion,
  extractRemoteExecutionFlagMap,
  fingerprintFlagMap,
  parseFacebookOrganicLiveRolloutArgs,
} from './lib/facebook-organic-live-rematerialization-rollout.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_FACEBOOK_ORGANIC_LIVE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const outputRoot = resolve(
  process.env.MKT_FACEBOOK_ORGANIC_LIVE_ROLLOUT_EVIDENCE_DIR
    ?? 'outputs/facebook-organic-live-rematerialization-rollout',
);
const summaryPath = join(outputRoot, 'facebook-organic-live-rematerialization-summary.json');
const target = resolveReviewedReportRuntimeCloseoutTarget({
  ...process.env,
  MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'facebook',
});
const REQUIRED_LARK_KEY_FIELDS = Object.freeze({
  mktReportSnapshots: 'report_id',
  mktReportMetricValues: 'report_metric_key',
  mktReportTopContent: 'report_content_key',
  mktReportTopAds: 'report_ad_key',
  mktSyncLog: 'sync_id',
  mktSystemAlerts: 'alert_id',
});
const WORKER_NAME = 'social-mkt-sync-worker';
let currentStage = 'init';
let overlayDeploymentAttempted = false;
let baselineRestoreVerified = false;

try {
  const args = parseFacebookOrganicLiveRolloutArgs(process.argv.slice(2));
  if (args.planOnly) printPlan();
  else if (args.recover) await recoverRollout();
  else await executeRollout();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONTRACT_VERSION,
    stage: currentStage,
    code: error?.code ?? 'FACEBOOK_ORGANIC_LIVE_ROLLOUT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    overlayDeploymentAttempted,
    baselineRestoreVerified,
    providerRequestCount: 0,
    customerProductionMutationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONTRACT_VERSION,
    platform: 'facebook',
    capability: 'organic',
    windows: FACEBOOK_ORGANIC_LIVE_WINDOWS,
    requiredAncestor: FACEBOOK_ORGANIC_AGGREGATION_REPAIR_SHA,
    behavior: {
      captureCurrentRuntimeFlags: true,
      deployCurrentMainWithExactCapturedFlags: true,
      temporaryReportOverlayOnlyWhenRequired: true,
      refreshStableReportIds: true,
      providerRefresh: false,
      manualLarkPatch: false,
      exactRuntimeRestore: true,
      blindRetry: false,
    },
    executeCommand: [
      'CONFIRM_FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION=EXECUTE_FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION',
      'node scripts/facebook-organic-live-rematerialization-rollout.mjs --execute',
    ].join(' \\\n'),
    recoveryCommand: [
      'CONFIRM_FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION_RECOVERY=RECOVER_FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION',
      'node scripts/facebook-organic-live-rematerialization-rollout.mjs --recover',
    ].join(' \\\n'),
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeRollout() {
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertFacebookOrganicLiveRolloutConfirmation(env, 'execute');
  const runner = createCommandRunner({ execFileAsync, cwd: repositoryRoot, baseEnv: process.env });

  currentStage = 'repository-release-gate';
  const repository = await assertReviewedRepositoryState(runner);
  await runner.run('git', ['merge-base', '--is-ancestor', FACEBOOK_ORGANIC_AGGREGATION_REPAIR_SHA, 'HEAD']);
  const existingSummary = await readJsonIfExists(summaryPath);
  if (existingSummary) throw rolloutFailure(
    'Facebook Organic live rematerialization already has a completed summary',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_ALREADY_COMPLETE',
    { repositoryHead: existingSummary.repository?.head ?? null },
  );
  const attemptState = await readAttemptState();
  assertNoRecordedMutationForExecute(attemptState);

  currentStage = 'local-config-and-current-runtime';
  const sourceText = await readFile(configPath, 'utf8');
  const topologyConfig = buildReportRuntimeCloseoutConfigWindow(sourceText, {
    activeTrueFlags: ['MKT_REPORT_D1_READ_ENABLED', 'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED'],
  });
  const auth = await resolveReviewedCloudflareSession({
    env,
    sourceText,
    runText: runner.runText,
  });
  const queue = await resolveReviewedQueue({
    accountId: auth.accountId,
    token: auth.token,
    expectedName: topologyConfig.mainQueueName,
  });
  const runtimeBefore = await readRemoteRuntime(runner, env);
  const preserved = buildExactRuntimePreservingConfigs(sourceText, runtimeBefore.flagMap);

  const baselineRuntime = createReviewedRemoteRuntime({
    ...runner,
    configPath,
    env,
    repositoryHead: repository.head,
    target: Object.freeze({ ...target, activeTrueFlags: preserved.baselineTrueFlags }),
    requiredTables: REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
    config: topologyConfig,
  });
  const overlayRuntime = createReviewedRemoteRuntime({
    ...runner,
    configPath,
    env,
    repositoryHead: repository.head,
    target: Object.freeze({ ...target, activeTrueFlags: preserved.overlayTrueFlags }),
    requiredTables: REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
    config: topologyConfig,
  });
  await baselineRuntime.verifyDeployment('active');

  currentStage = 'd1-lark-preflight';
  const state = createReviewedStateRuntime({
    ...runner,
    repositoryRoot,
    outputRoot,
    configPath,
    env,
    target,
    requiredLarkKeyFields: REQUIRED_LARK_KEY_FIELDS,
  });
  const client = createLarkBitableClientFromEnv(env);
  const larkPreflight = await state.verifyLarkInventory(client, topologyConfig.tableIds);
  const preflight = await readFacebookPreflight(state);
  const pendingMigrations = await state.readPendingMigrations();
  if (pendingMigrations.length !== 0) throw rolloutFailure(
    'Pending D1 migrations block Facebook live rematerialization',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_PENDING_MIGRATIONS',
    { pendingMigrationCount: pendingMigrations.length },
  );

  const planRequestedAt = Date.now();
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: planRequestedAt,
    periodEnd: preflight.period_end,
    sourceWatermark: preflight.source_watermark,
    timeZone: 'Asia/Bangkok',
    platformScope: target.platformScope,
    accountKey: target.accountKey,
    formulaVersion: target.formulaVersion,
  });
  const existingIds = await state.readExistingReportIds(candidates.map((row) => row.reportId));
  const plan = buildFacebookRefreshPlan(candidates, existingIds);
  const prestates = [];
  for (const selected of plan) {
    const d1 = await state.readD1Snapshot(selected, planRequestedAt);
    const lark = await state.readLarkReportState(client, topologyConfig.tableIds, selected.reportId);
    assertReportRuntimeWindowTargetPrestate({
      operation: 'refresh',
      reportId: selected.reportId,
      d1,
      lark,
    });
    assertD1LarkIntegrity(d1, lark);
    prestates.push(Object.freeze({ selected, d1, lark }));
  }

  currentStage = 'dry-run-bundles';
  const baselineBundle = await baselineRuntime.buildBundle(preserved.baselineText, 'facebook-live-baseline');
  const overlayBundle = preserved.overlayRequired
    ? await overlayRuntime.buildBundle(preserved.overlayText, 'facebook-live-report-overlay')
    : baselineBundle;

  await writeReviewedAttempt(outputRoot, 'deploy-baseline', {
    contractVersion: FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONTRACT_VERSION,
    repositoryHead: repository.head,
    previousWorkerVersion: runtimeBefore.versionId,
    baselineFlagMap: preserved.baselineFlagMap,
    baselineFlagFingerprint: preserved.flagVectorFingerprint,
    baselineConfigSha256: preserved.baselineSha256,
    overlayConfigSha256: preserved.overlaySha256,
    overlayRequired: preserved.overlayRequired,
    planRequestedAt,
    periodEnd: preflight.period_end,
    sourceWatermark: preflight.source_watermark,
    plan: prestates.map(({ selected, d1 }) => ({
      windowDays: selected.windowDays,
      reportId: selected.reportId,
      beforeChecksum: d1.payload_checksum,
      beforeGeneratedAt: d1.generated_at,
    })),
  });

  let baselineDeployment = null;
  let overlayDeployment = null;
  let restoreDeployment = null;
  let primaryError = null;
  const completedWindows = [];
  let executionRequestedAt = null;
  let backup = null;

  try {
    currentStage = 'deploy-current-main-preserved-baseline';
    baselineDeployment = await baselineRuntime.deployConfig(
      preserved.baselineText,
      'facebook-live-preserved-baseline',
      FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONTRACT_VERSION,
    );
    await baselineRuntime.verifyDeployment('active', baselineDeployment.versionId);

    if (preserved.overlayRequired) {
      currentStage = 'deploy-temporary-report-overlay';
      await writeReviewedAttempt(outputRoot, 'deploy-overlay', {
        repositoryHead: repository.head,
        baselineVersionId: baselineDeployment.versionId,
        baselineFlagFingerprint: preserved.flagVectorFingerprint,
        overlayTrueFlags: preserved.overlayTrueFlags,
        overlayConfigSha256: preserved.overlaySha256,
      });
      overlayDeploymentAttempted = true;
      overlayDeployment = await overlayRuntime.deployConfig(
        preserved.overlayText,
        'facebook-live-report-overlay',
        FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONTRACT_VERSION,
      );
      await overlayRuntime.verifyDeployment('active', overlayDeployment.versionId);
    }

    currentStage = 'backup-before-first-queue-mutation';
    backup = await state.createD1Backup('facebook-live-rematerialization');
    executionRequestedAt = Date.now();

    for (let index = 0; index < prestates.length; index += 1) {
      const { selected, d1: before } = prestates[index];
      currentStage = `send-facebook-${selected.windowDays}d-refresh`;
      await writeReviewedAttempt(outputRoot, `send-${selected.windowDays}d`, {
        repositoryHead: repository.head,
        reportId: selected.reportId,
        windowDays: selected.windowDays,
        operation: 'refresh',
        jobSha256: sha256(stableJson(selected.job)),
        executionRequestedAt,
      });
      await sendReviewedQueueMessage({ auth, queueId: queue.queueId, job: selected.job });

      currentStage = `verify-facebook-${selected.windowDays}d-d1-lark`;
      const after = await state.pollD1Completion(selected, executionRequestedAt, index + 1);
      assertReportRuntimeCloseoutCompletion(after, { reportId: selected.reportId });
      assertReportRuntimeWindowChanged({ operation: 'refresh', before, after });
      const larkVerified = await state.pollLarkIntegrity(
        client,
        topologyConfig.tableIds,
        selected.reportId,
        after,
      );
      const repairMetrics = assertFacebookObservedAggregateRepair(after);
      const safety = await readFacebookPreflight(state);
      completedWindows.push(Object.freeze({
        windowDays: selected.windowDays,
        reportId: selected.reportId,
        payloadChecksum: after.payload_checksum,
        generatedAt: after.generated_at,
        metricIntegrity: larkVerified.integrity,
        lark: summarizeLarkState(larkVerified.state),
        repairMetrics,
        safety: summarizeSafety(safety),
      }));
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (overlayDeploymentAttempted) {
      currentStage = 'restore-exact-captured-runtime-baseline';
      try {
        await writeReviewedAttempt(outputRoot, 'restore-baseline', {
          repositoryHead: repository.head,
          baselineFlagFingerprint: preserved.flagVectorFingerprint,
          baselineConfigSha256: preserved.baselineSha256,
          overlayVersionId: overlayDeployment?.versionId ?? null,
        });
        restoreDeployment = await baselineRuntime.deployConfig(
          preserved.baselineText,
          'facebook-live-exact-baseline-restore',
          FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONTRACT_VERSION,
        );
        await baselineRuntime.verifyDeployment('active', restoreDeployment.versionId);
        const restored = await readRemoteRuntime(runner, env);
        assertExactRuntimeFlagRestoration(runtimeBefore.flagMap, restored.flagMap);
        baselineRestoreVerified = true;
      } catch (restoreError) {
        if (primaryError) throw rolloutFailure(
          'Facebook rematerialization failed and exact runtime baseline restore also failed',
          'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RESTORE_FAILED_AFTER_PRIMARY',
          {
            primaryCode: primaryError?.code ?? 'UNKNOWN',
            restoreCode: restoreError?.code ?? 'UNKNOWN',
          },
        );
        throw restoreError;
      }
    } else if (baselineDeployment) {
      const restored = await readRemoteRuntime(runner, env);
      assertExactRuntimeFlagRestoration(runtimeBefore.flagMap, restored.flagMap);
      baselineRestoreVerified = true;
    }
  }

  if (primaryError) throw primaryError;
  if (!baselineRestoreVerified) throw rolloutFailure(
    'Facebook rollout requires verified exact runtime baseline restoration',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RESTORE_NOT_VERIFIED',
  );
  if (completedWindows.length !== FACEBOOK_ORGANIC_LIVE_WINDOWS.length) throw rolloutFailure(
    'Facebook rollout did not complete all four Report windows',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_WINDOWS_INCOMPLETE',
    { completedWindowCount: completedWindows.length },
  );

  currentStage = 'final-zero-drift-readback';
  const runtimeAfter = await readRemoteRuntime(runner, env);
  assertExactRuntimeFlagRestoration(runtimeBefore.flagMap, runtimeAfter.flagMap);
  const finalSafety = await readFacebookPreflight(state);
  const summary = Object.freeze({
    ok: true,
    contractVersion: FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONTRACT_VERSION,
    decision: 'FACEBOOK_ORGANIC_1_3_7_30_REMATERIALIZED_VERIFIED',
    repository,
    target: {
      environment: 'development',
      customerProfile: 'integration_workspace',
      platform: 'facebook',
      capability: 'organic',
      periodEnd: preflight.period_end,
      sourceWatermark: preflight.source_watermark,
    },
    runtime: {
      previousVersionId: runtimeBefore.versionId,
      baselineDeploymentVersionId: baselineDeployment.versionId,
      overlayRequired: preserved.overlayRequired,
      overlayDeploymentVersionId: overlayDeployment?.versionId ?? null,
      restoreDeploymentVersionId: restoreDeployment?.versionId ?? null,
      finalVersionId: runtimeAfter.versionId,
      preFlagFingerprint: fingerprintFlagMap(runtimeBefore.flagMap),
      postFlagFingerprint: fingerprintFlagMap(runtimeAfter.flagMap),
      exactFlagRestoration: true,
      changedFlagCount: diffExecutionFlagMaps(runtimeBefore.flagMap, runtimeAfter.flagMap).length,
    },
    preflight: {
      lark: larkPreflight,
      pendingMigrationCount: pendingMigrations.length,
      baselineBundleSha256: baselineBundle.sha256,
      overlayBundleSha256: overlayBundle.sha256,
      baselineFlagCount: preserved.localFlagCount,
      remoteFlagCount: preserved.remoteFlagCount,
      localOnlyFalseFlagCount: preserved.localOnlyFlags.length,
      safety: summarizeSafety(preflight),
      backup,
    },
    windows: completedWindows,
    finalSafety: summarizeSafety(finalSafety),
    mutationCounts: {
      providerRequests: 0,
      queueMessages: completedWindows.length,
      larkManualPatches: 0,
      customerProduction: 0,
    },
    production: 'BLOCKED',
  });
  await writePrivateJson(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: summaryPath }, null, 2)}\n`);
}

async function recoverRollout() {
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertFacebookOrganicLiveRolloutConfirmation(env, 'recover');
  assertRecoveryIsReadOnlyForReports({ queueSendCount: 0, providerRequestCount: 0 });
  const runner = createCommandRunner({ execFileAsync, cwd: repositoryRoot, baseEnv: process.env });

  currentStage = 'recovery-repository-and-attempt-evidence';
  const repository = await assertReviewedRepositoryState(runner);
  await runner.run('git', ['merge-base', '--is-ancestor', FACEBOOK_ORGANIC_AGGREGATION_REPAIR_SHA, 'HEAD']);
  const completedSummary = await readJsonIfExists(summaryPath);
  if (completedSummary) {
    process.stdout.write(`${JSON.stringify({ ...completedSummary, recoveryNoop: true, evidencePath: summaryPath }, null, 2)}\n`);
    return;
  }
  const deployAttempt = await readJsonIfExists(join(outputRoot, 'deploy-baseline.attempt.json'));
  if (!deployAttempt?.baselineFlagMap || !Array.isArray(deployAttempt?.plan)) throw rolloutFailure(
    'Recovery requires retained deploy-baseline attempt evidence',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RECOVERY_EVIDENCE_MISSING',
  );

  const sourceText = await readFile(configPath, 'utf8');
  const topologyConfig = buildReportRuntimeCloseoutConfigWindow(sourceText, {
    activeTrueFlags: ['MKT_REPORT_D1_READ_ENABLED', 'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED'],
  });
  const preserved = buildExactRuntimePreservingConfigs(sourceText, deployAttempt.baselineFlagMap);
  if (preserved.flagVectorFingerprint !== deployAttempt.baselineFlagFingerprint) throw rolloutFailure(
    'Recovery baseline flag evidence differs from the retained fingerprint',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RECOVERY_EVIDENCE_DRIFT',
  );

  const runtimeNow = await readRemoteRuntime(runner, env);
  const baselineDiff = diffExecutionFlagMaps(deployAttempt.baselineFlagMap, runtimeNow.flagMap);
  if (baselineDiff.length > 0) {
    const overlayDiff = diffExecutionFlagMaps(preserved.overlayFlagMap, runtimeNow.flagMap);
    if (overlayDiff.length !== 0) throw rolloutFailure(
      'Current Worker flags match neither retained baseline nor the approved Report overlay',
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RECOVERY_RUNTIME_AMBIGUOUS',
      { baselineChangedFlags: baselineDiff.map((row) => row.name) },
    );
    const recordedRestore = await readJsonIfExists(join(outputRoot, 'restore-baseline.attempt.json'));
    if (recordedRestore) throw rolloutFailure(
      'A baseline restore attempt is already recorded but remote flags still show the overlay; automatic redeploy is forbidden',
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RECOVERY_RESTORE_RETRY_FORBIDDEN',
    );

    currentStage = 'recovery-restore-exact-baseline';
    const baselineRuntime = createReviewedRemoteRuntime({
      ...runner,
      configPath,
      env,
      repositoryHead: repository.head,
      target: Object.freeze({ ...target, activeTrueFlags: preserved.baselineTrueFlags }),
      requiredTables: REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
      config: topologyConfig,
    });
    await writeReviewedAttempt(outputRoot, 'restore-baseline', {
      repositoryHead: repository.head,
      recovery: true,
      baselineFlagFingerprint: preserved.flagVectorFingerprint,
      baselineConfigSha256: preserved.baselineSha256,
      observedOverlayVersionId: runtimeNow.versionId,
    });
    const deployment = await baselineRuntime.deployConfig(
      preserved.baselineText,
      'facebook-live-recovery-baseline-restore',
      FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONTRACT_VERSION,
    );
    await baselineRuntime.verifyDeployment('active', deployment.versionId);
  }

  currentStage = 'recovery-read-only-report-verification';
  const runtimeRestored = await readRemoteRuntime(runner, env);
  assertExactRuntimeFlagRestoration(deployAttempt.baselineFlagMap, runtimeRestored.flagMap);
  baselineRestoreVerified = true;

  const state = createReviewedStateRuntime({
    ...runner,
    repositoryRoot,
    outputRoot,
    configPath,
    env,
    target,
    requiredLarkKeyFields: REQUIRED_LARK_KEY_FIELDS,
  });
  const client = createLarkBitableClientFromEnv(env);
  await state.verifyLarkInventory(client, topologyConfig.tableIds);
  const windows = [];
  for (const planned of deployAttempt.plan) {
    const selected = { reportId: planned.reportId, windowDays: planned.windowDays };
    const d1 = await state.readD1Snapshot(selected, Number(deployAttempt.planRequestedAt ?? 0));
    const lark = await state.readLarkReportState(client, topologyConfig.tableIds, planned.reportId);
    let parity = null;
    let repairMetrics = null;
    try {
      parity = assertD1LarkIntegrity(d1, lark);
      repairMetrics = assertFacebookObservedAggregateRepair(d1);
    } catch (error) {
      windows.push(Object.freeze({
        windowDays: planned.windowDays,
        reportId: planned.reportId,
        complete: false,
        reasonCode: error?.code ?? 'PARITY_NOT_COMPLETE',
      }));
      continue;
    }
    windows.push(Object.freeze({
      windowDays: planned.windowDays,
      reportId: planned.reportId,
      complete: d1.payload_checksum !== planned.beforeChecksum,
      payloadChecksum: d1.payload_checksum,
      metricIntegrity: parity,
      repairMetrics,
    }));
  }
  const finalSafety = await readFacebookPreflight(state);
  const allComplete = windows.length === 4 && windows.every((row) => row.complete === true);
  if (!allComplete) throw rolloutFailure(
    'Recovery restored the exact runtime baseline but not all four Facebook Report refreshes can be proven complete; no Queue resend was attempted',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RECOVERY_INCOMPLETE_NO_RESEND',
    {
      completedWindows: windows.filter((row) => row.complete).map((row) => row.windowDays),
      queueSendCount: 0,
      baselineRestored: true,
    },
  );

  const summary = Object.freeze({
    ok: true,
    contractVersion: FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONTRACT_VERSION,
    decision: 'FACEBOOK_ORGANIC_1_3_7_30_RECOVERED_VERIFIED',
    repository,
    recovery: true,
    runtime: {
      finalVersionId: runtimeRestored.versionId,
      exactFlagRestoration: true,
      finalFlagFingerprint: fingerprintFlagMap(runtimeRestored.flagMap),
    },
    windows,
    finalSafety: summarizeSafety(finalSafety),
    mutationCounts: {
      providerRequests: 0,
      queueMessagesDuringRecovery: 0,
      larkManualPatches: 0,
      customerProduction: 0,
    },
    production: 'BLOCKED',
  });
  await writePrivateJson(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: summaryPath }, null, 2)}\n`);
}

async function readFacebookPreflight(state) {
  const row = await state.readD1Row(buildReportRuntimePreflightSql({
    target: { ...target, customerKey: 'chemistry_k' },
  }));
  assertReviewedReportRuntimeCloseoutPreflight(row, target);
  assertSafetyZero(row);
  return row;
}

async function readRemoteRuntime(runner, env) {
  const statusOutput = await runner.runText('npx', [
    'wrangler', 'deployments', 'status', '--name', WORKER_NAME, '--config', configPath, '--json',
  ], { env });
  const status = JSON.parse(statusOutput);
  const versionId = extractActiveWorkerVersion(status);
  const versionOutput = await runner.runText('npx', [
    'wrangler', 'versions', 'view', versionId, '--name', WORKER_NAME, '--config', configPath, '--json',
  ], { env });
  const bindings = collectWorkerBindings(JSON.parse(versionOutput));
  const flagMap = extractRemoteExecutionFlagMap(bindings);
  return Object.freeze({
    versionId,
    flagMap,
    flagFingerprint: fingerprintFlagMap(flagMap),
    bindingCount: bindings.length,
  });
}

function assertFacebookObservedAggregateRepair(d1) {
  let payload;
  try { payload = JSON.parse(String(d1.payload_json ?? '')); } catch {
    throw rolloutFailure(
      'Facebook Report payload_json is invalid',
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_PAYLOAD_INVALID',
    );
  }
  if (payload.platformScope !== 'facebook' || payload.capability !== 'organic') throw rolloutFailure(
    'Rematerialized Report payload is not Facebook Organic',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_PAYLOAD_SCOPE_INVALID',
  );
  const keys = [
    'facebook:latest_total_likes',
    'facebook:latest_total_comments',
    'facebook:latest_total_shares',
    'facebook:latest_total_engagement',
  ];
  const values = Object.fromEntries(keys.map((key) => [key, readMetricCurrent(payload.metricPayload?.[key])]));
  const unavailable = Object.entries(values).filter(([, value]) => value === null).map(([key]) => key);
  if (unavailable.length > 0) throw rolloutFailure(
    'Facebook rematerialization still exposes null aggregate totals that have observed contributors',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_OBSERVED_AGGREGATE_NOT_REPAIRED',
    { unavailableMetricKeys: unavailable },
  );
  return Object.freeze({
    latestTotalLikes: values['facebook:latest_total_likes'],
    latestTotalComments: values['facebook:latest_total_comments'],
    latestTotalShares: values['facebook:latest_total_shares'],
    latestTotalEngagement: values['facebook:latest_total_engagement'],
    periodLikes: readMetricCurrent(payload.metricPayload?.['facebook:period_likes']),
    periodComments: readMetricCurrent(payload.metricPayload?.['facebook:period_comments']),
    periodShares: readMetricCurrent(payload.metricPayload?.['facebook:period_shares']),
    periodEngagement: readMetricCurrent(payload.metricPayload?.['facebook:period_engagement']),
    sourceNullsFabricatedAsZero: false,
  });
}

function readMetricCurrent(metric) {
  const value = metric?.current;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function assertSafetyZero(row) {
  const fields = [
    'active_report_work_count',
    'active_report_locks',
    'open_report_dlq',
    'open_report_critical_alerts',
  ];
  const nonZero = fields.filter((field) => Number(row?.[field] ?? 0) !== 0);
  if (nonZero.length > 0) throw rolloutFailure(
    'Facebook Report runtime safety counters are not zero',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RUNTIME_NOT_IDLE',
    { nonZeroFields: nonZero },
  );
  return true;
}

function summarizeSafety(row) {
  return Object.freeze({
    coverageStatus: row.coverage_status ?? null,
    sourceWatermark: row.source_watermark ?? null,
    activeReportWorkCount: Number(row.active_report_work_count ?? 0),
    activeReportLocks: Number(row.active_report_locks ?? 0),
    openReportDlq: Number(row.open_report_dlq ?? 0),
    openReportCriticalAlerts: Number(row.open_report_critical_alerts ?? 0),
  });
}

async function readAttemptState() {
  return Object.freeze({
    deployBaseline: await readJsonIfExists(join(outputRoot, 'deploy-baseline.attempt.json')),
    deployOverlay: await readJsonIfExists(join(outputRoot, 'deploy-overlay.attempt.json')),
    sendWindows: (await Promise.all(FACEBOOK_ORGANIC_LIVE_WINDOWS.map(
      (windowDays) => readJsonIfExists(join(outputRoot, `send-${windowDays}d.attempt.json`)),
    ))).filter(Boolean),
    restoreBaseline: await readJsonIfExists(join(outputRoot, 'restore-baseline.attempt.json')),
  });
}

async function readJsonIfExists(path) {
  try {
    await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|secret|authorization|password/iu.test(key)) continue;
    output[key] = sanitize(nested);
  }
  return output;
}

function rolloutFailure(message, code, details = {}) {
  return closeoutFailure(message, code, details);
}
