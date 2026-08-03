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
  REPORT_RUNTIME_CLOSEOUT_CONFIRMATION,
  REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  assertReportRuntimeCloseoutCompletion,
  assertReportRuntimeCloseoutConfirmation,
  assertReportRuntimeCloseoutPreflight,
  assertReportRuntimeCloseoutReplay,
  assertReportRuntimeFinalizerEvidence,
  assertWooCommerceReportRuntimeCloseoutConfirmation,
  assertWooCommerceReportRuntimeCloseoutPreflight,
  buildReportRuntimeCloseoutCandidates,
  buildReportRuntimeCloseoutConfigWindow,
  parseReportRuntimeCloseoutArgs,
  resolveReportRuntimeCloseoutTarget,
  safeReportRuntimeCloseoutEvidence,
} from './lib/report-runtime-closeout-operator.js';
import {
  REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE,
  assertReportRuntimeCloseoutRecoveryEvidence,
  pollReportRuntimeLarkIntegrity,
  resolveReportRuntimeCloseoutRecoveryMode,
} from './lib/report-runtime-lark-integrity-recovery.js';
import {
  assertReportRuntimeOrganicIntegrity,
  assertReportRuntimeMetricIntegrity,
  assertReportRuntimeWindowChanged,
  assertReportRuntimeWindowTargetPrestate,
  selectReportRuntimeWindowTarget,
} from './lib/report-runtime-window-repair.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const target = resolveReportRuntimeCloseoutTarget(process.env);
const recoveryMode = resolveReportRuntimeCloseoutRecoveryMode(process.env);
const configPath = resolve(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
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
    recoveryMode,
    command: target.platformScope === 'woocommerce'
      ? 'CONFIRM_WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT=EXECUTE_WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT node scripts/woocommerce-report-runtime-closeout.mjs --execute'
      : `CONFIRM_REPORT_RUNTIME_CLOSEOUT=${REPORT_RUNTIME_CLOSEOUT_CONFIRMATION} node scripts/report-runtime-closeout-operator.mjs --execute`,
    scope: `${target.platformScope} ${target.capability} rolling preset materialization from D1 to Lark`,
    target: {
      operation: process.env.MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION ?? 'fresh',
      windowDays: process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS ?? null,
    },
    stages: recoveryMode
      ? [
        'repository-and-finalizer-evidence',
        'lark-and-d1-preflight',
        'validate-exact-first-materialization-evidence',
        'verify-current-d1-lark-integrity-read-only',
        'backup-before-missing-replay',
        'deploy-report-only-window-if-replay-not-recorded',
        'send-exact-missing-replay-once',
        'verify-idempotency',
        'restore-all-false',
        'closeout-summary',
      ]
      : [
        'repository-and-finalizer-evidence',
        'lark-and-d1-preflight',
        'remote-safe-preflight-and-backup',
        'deploy-report-only-window',
        'send-one-materialization',
        'verify-d1-lark-and-kpi-integrity',
        'replay-same-job',
        'verify-idempotency',
        'restore-all-false',
        'closeout-summary',
      ],
    activeTrueFlags: target.activeTrueFlags,
    safety: {
      connectorsEnabled: false,
      providerCalls: false,
      aiEnabled: false,
      schedulesEnabled: false,
      production: false,
      businessFactDeletion: false,
      manualLarkEditing: false,
      automaticSafeRestore: true,
      firstMaterializationRetry: false,
      replaySendAfterRecordedAttempt: false,
    },
  }, null, 2)}\n`);
}

async function executeCloseout() {
  const context = await prepareCloseoutContext();
  if (recoveryMode === REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE) {
    await executeRecoveryCloseout(context);
    return;
  }
  await executeNormalCloseout(context);
}

async function prepareCloseoutContext() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  if (target.platformScope === 'woocommerce') {
    assertWooCommerceReportRuntimeCloseoutConfirmation(env);
  } else {
    assertReportRuntimeCloseoutConfirmation(env);
  }
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });

  currentStage = 'repository-and-finalizer-evidence';
  const repository = await assertRepositoryState();
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository.head !== repository.head) throw failure(
    'Report closeout requires finalizer evidence from the current main HEAD',
    'REPORT_RUNTIME_CLOSEOUT_FINALIZER_HEAD_MISMATCH',
    { evidenceHead: finalizerEvidence.repository.head, repositoryHead: repository.head },
  );

  const sourceText = await readFile(configPath, 'utf8');
  const config = buildReportRuntimeCloseoutConfigWindow(sourceText, {
    activeTrueFlags: target.activeTrueFlags,
  });
  const auth = await resolveCloudflareSession(env, sourceText);
  const queue = await resolveQueue(auth.accountId, auth.token, config.mainQueueName);
  loaded = Object.freeze({ repository, env, config, auth, queue });

  currentStage = 'lark-and-d1-preflight';
  const client = createLarkBitableClientFromEnv(env);
  const larkPreflight = await verifyLarkInventory(client, config.tableIds);
  const d1Preflight = await readD1Preflight(config);
  if (target.platformScope === 'woocommerce') {
    assertWooCommerceReportRuntimeCloseoutPreflight(d1Preflight);
  } else {
    assertReportRuntimeCloseoutPreflight(d1Preflight);
  }

  currentStage = 'remote-safe-preflight-and-backup';
  const pendingMigrations = await readPendingMigrations();
  if (pendingMigrations.length > 0) throw failure(
    `Pending migrations block Report closeout: ${pendingMigrations.join(', ')}`,
    'REPORT_RUNTIME_CLOSEOUT_PENDING_MIGRATIONS',
    { pendingMigrations },
  );
  const safeBundle = await buildBundle(config.safeText, 'safe-preflight');
  const activeBundle = await buildBundle(config.activeText, 'active-preflight');
  const remoteSafe = await verifyRemoteDeployment(config, 'safe');

  return Object.freeze({
    repository,
    finalizerEvidence,
    config,
    auth,
    queue,
    client,
    larkPreflight,
    d1Preflight,
    pendingMigrations,
    safeBundle,
    activeBundle,
    remoteSafe,
  });
}

async function executeNormalCloseout(context) {
  const requestedAt = Date.now();
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt,
    periodEnd: context.d1Preflight.period_end,
    sourceWatermark: context.d1Preflight.source_watermark,
    timeZone: 'Asia/Bangkok',
    platformScope: target.platformScope,
    accountKey: target.accountKey,
    formulaVersion: target.formulaVersion,
  });
  const existingIds = await readExistingReportIds(context.config, candidates.map((candidate) => candidate.reportId));
  const selected = selectReportRuntimeWindowTarget(candidates, existingIds, process.env);
  const snapshotBefore = await readD1Snapshot(context.config, selected, requestedAt);
  const larkBefore = await readLarkReportState(context.client, context.config.tableIds, selected.reportId);
  assertReportRuntimeWindowTargetPrestate({
    operation: selected.operation,
    reportId: selected.reportId,
    d1: snapshotBefore,
    lark: larkBefore,
  });
  const backup = await createD1Backup(selected);

  let firstCompletion = null;
  let firstLark = null;
  let firstIntegrity = null;
  let firstLarkIntegrityPollAttempts = null;
  let replayCompletion = null;
  let replayLark = null;
  let replayIntegrity = null;
  let replayLarkIntegrityPollAttempts = null;
  let activeDeployment = null;
  let restoreDeployment = null;
  let primaryError = null;
  try {
    currentStage = 'deploy-report-only-window';
    await writeAttempt('deploy-active', {
      repositoryHead: context.repository.head,
      expectedActiveVersion: context.remoteSafe.activeVersion,
      configSha256: context.config.activeSha256,
      selectedReportId: selected.reportId,
      operation: selected.operation,
      windowDays: selected.windowDays,
    });
    activeDeployment = await deployConfig(context.config.activeText, 'report-closeout-active');
    activeDeploymentAttempted = true;
    await verifyRemoteDeployment(context.config, 'active', activeDeployment.versionId);

    currentStage = 'send-one-materialization';
    await writeAttempt('send-first', {
      reportId: selected.reportId,
      operation: selected.operation,
      jobSha256: sha256(stableJson(selected.job)),
      requestedAt,
    });
    await sendQueueMessage(context.auth, context.queue.queueId, selected.job);

    currentStage = 'verify-d1-lark-and-kpi-integrity';
    firstCompletion = await pollD1Completion(context.config, selected, requestedAt, 1);
    assertReportRuntimeCloseoutCompletion(firstCompletion, { reportId: selected.reportId });
    assertReportRuntimeWindowChanged({
      operation: selected.operation,
      before: snapshotBefore,
      after: firstCompletion,
    });
    const firstVerified = await pollLarkIntegrity(
      context.client,
      context.config.tableIds,
      selected.reportId,
      firstCompletion,
    );
    firstLark = firstVerified.state;
    firstIntegrity = firstVerified.integrity;
    firstLarkIntegrityPollAttempts = firstVerified.attemptCount;

    currentStage = 'replay-same-job';
    await writeAttempt('send-replay', {
      reportId: selected.reportId,
      operation: selected.operation,
      jobSha256: sha256(stableJson(selected.job)),
      requestedAt,
    });
    await sendQueueMessage(context.auth, context.queue.queueId, selected.job);

    currentStage = 'verify-idempotency';
    replayCompletion = await pollD1Completion(context.config, selected, requestedAt, 2);
    assertReportRuntimeCloseoutCompletion(replayCompletion, { reportId: selected.reportId });
    assertReportRuntimeCloseoutReplay(firstCompletion, replayCompletion);
    const replayVerified = await pollLarkIntegrity(
      context.client,
      context.config.tableIds,
      selected.reportId,
      replayCompletion,
    );
    replayLark = replayVerified.state;
    replayIntegrity = replayVerified.integrity;
    replayLarkIntegrityPollAttempts = replayVerified.attemptCount;
    assertLarkReplay(firstLark, replayLark);
    if (stableJson(firstIntegrity) !== stableJson(replayIntegrity)) throw failure(
      'Report closeout replay changed D1/Lark metric integrity evidence',
      'REPORT_RUNTIME_CLOSEOUT_REPLAY_INTEGRITY_DRIFT',
    );
  } catch (error) {
    primaryError = error;
  } finally {
    if (activeDeploymentAttempted) {
      currentStage = 'restore-all-false';
      try {
        await writeAttempt('restore-safe', {
          repositoryHead: context.repository.head,
          configSha256: context.config.safeSha256,
          activeVersion: activeDeployment?.versionId ?? null,
        });
        restoreDeployment = await deployConfig(context.config.safeText, 'report-closeout-safe-restore');
        await verifyRemoteDeployment(context.config, 'safe', restoreDeployment.versionId);
        safeRestoreVerified = true;
      } catch (restoreError) {
        if (primaryError) throw failure(
          'Report closeout failed and automatic all-false restore also failed',
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
  if (!safeRestoreVerified) throw failure(
    'Report closeout requires verified all-false restore',
    'REPORT_RUNTIME_CLOSEOUT_RESTORE_NOT_VERIFIED',
  );

  await writeCloseoutSummary({
    context,
    selected,
    snapshotBefore,
    larkBefore,
    requestedAt,
    backup,
    firstCompletion,
    firstLark,
    firstIntegrity,
    firstLarkIntegrityPollAttempts,
    replayCompletion,
    replayLark,
    replayIntegrity,
    replayLarkIntegrityPollAttempts,
    restoreDeployment,
    recovery: null,
  });
}

async function executeRecoveryCloseout(context) {
  if (target.platformScope !== 'tiktok') throw failure(
    'Exact first-materialization recovery is approved only for the Organic TikTok 3D incident',
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_TARGET_INVALID',
  );

  currentStage = 'validate-exact-first-materialization-evidence';
  const deployAttempt = await readRequiredJson(join(outputRoot, 'deploy-active.attempt.json'));
  const sendFirstAttempt = await readRequiredJson(join(outputRoot, 'send-first.attempt.json'));
  const restoreAttempt = await readRequiredJson(join(outputRoot, 'restore-safe.attempt.json'));
  const replayAttempt = await readJsonIfExists(join(outputRoot, 'send-replay.attempt.json'));
  const summaryExists = (await readJsonIfExists(join(outputRoot, 'report-runtime-closeout-summary.json'))) !== null;
  const requestedAt = Number(sendFirstAttempt.requestedAt);
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt,
    periodEnd: context.d1Preflight.period_end,
    sourceWatermark: context.d1Preflight.source_watermark,
    timeZone: 'Asia/Bangkok',
    platformScope: target.platformScope,
    accountKey: target.accountKey,
    formulaVersion: target.formulaVersion,
  });
  const candidate = candidates.find((item) => item.reportId === deployAttempt.selectedReportId);
  if (!candidate) throw failure(
    'Exact failed Report ID cannot be regenerated from current D1 coverage evidence',
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_CANDIDATE_MISSING',
  );
  const selected = Object.freeze({ ...candidate, operation: 'refresh' });
  const recoveryEvidence = assertReportRuntimeCloseoutRecoveryEvidence({
    deployAttempt,
    sendFirstAttempt,
    restoreAttempt,
    replayAttempt,
    summaryExists,
    candidate: selected,
    activeConfigSha256: context.config.activeSha256,
    safeConfigSha256: context.config.safeSha256,
    jobSha256: sha256(stableJson(selected.job)),
  });

  if (!recoveryEvidence.replayAttempted) {
    const priorRecoveryDeploy = await readJsonIfExists(join(outputRoot, 'recover-deploy-active.attempt.json'));
    const priorRecoveryRestore = await readJsonIfExists(join(outputRoot, 'recover-restore-safe.attempt.json'));
    if (priorRecoveryDeploy || priorRecoveryRestore) throw failure(
      'A prior recovery deployment attempt exists without a recorded replay; automatic repetition is disabled',
      'REPORT_RUNTIME_CLOSEOUT_RECOVERY_PARTIAL_MUTATION_BLOCKED',
      {
        recoveryDeployAttemptExists: priorRecoveryDeploy !== null,
        recoveryRestoreAttemptExists: priorRecoveryRestore !== null,
      },
    );
  }

  const originalBackup = await readExistingD1Backup(selected);
  const snapshotBefore = await readD1Snapshot(context.config, selected, requestedAt);
  const larkBefore = await readLarkReportState(context.client, context.config.tableIds, selected.reportId);

  currentStage = 'verify-current-d1-lark-integrity-read-only';
  const firstCompletion = await pollD1Completion(context.config, selected, requestedAt, 1);
  assertReportRuntimeCloseoutCompletion(firstCompletion, { reportId: selected.reportId });
  const firstVerified = await pollLarkIntegrity(
    context.client,
    context.config.tableIds,
    selected.reportId,
    firstCompletion,
  );
  const firstLark = firstVerified.state;
  const firstIntegrity = firstVerified.integrity;

  let backup = originalBackup;
  let replayCompletion = null;
  let replayLark = null;
  let replayIntegrity = null;
  let replayLarkIntegrityPollAttempts = null;
  let activeDeployment = null;
  let restoreDeployment = null;
  let replayMessageSent = false;
  let primaryError = null;

  if (recoveryEvidence.replayAttempted) {
    currentStage = 'verify-idempotency';
    replayCompletion = await pollD1Completion(context.config, selected, requestedAt, 2);
    assertReportRuntimeCloseoutCompletion(replayCompletion, { reportId: selected.reportId });
    assertReportRuntimeCloseoutReplay(firstCompletion, replayCompletion);
    const replayVerified = await pollLarkIntegrity(
      context.client,
      context.config.tableIds,
      selected.reportId,
      replayCompletion,
    );
    replayLark = replayVerified.state;
    replayIntegrity = replayVerified.integrity;
    replayLarkIntegrityPollAttempts = replayVerified.attemptCount;
    assertLarkReplay(firstLark, replayLark);
    if (stableJson(firstIntegrity) !== stableJson(replayIntegrity)) throw failure(
      'Recovered Report replay changed D1/Lark metric integrity evidence',
      'REPORT_RUNTIME_CLOSEOUT_REPLAY_INTEGRITY_DRIFT',
    );
    safeRestoreVerified = true;
    restoreDeployment = Object.freeze({ versionId: context.remoteSafe.activeVersion });
  } else {
    currentStage = 'backup-before-missing-replay';
    backup = await createD1Backup(selected, { label: 'recovery-before-replay', unique: true });
    try {
      currentStage = 'deploy-report-only-window-if-replay-not-recorded';
      await writeAttempt('recover-deploy-active', {
        repositoryHead: context.repository.head,
        originalRepositoryHead: recoveryEvidence.originalRepositoryHead,
        expectedActiveVersion: context.remoteSafe.activeVersion,
        configSha256: context.config.activeSha256,
        selectedReportId: selected.reportId,
        operation: selected.operation,
        windowDays: selected.windowDays,
      });
      activeDeployment = await deployConfig(context.config.activeText, 'report-closeout-recovery-active');
      activeDeploymentAttempted = true;
      await verifyRemoteDeployment(context.config, 'active', activeDeployment.versionId);

      currentStage = 'send-exact-missing-replay-once';
      await writeAttempt('send-replay', {
        reportId: selected.reportId,
        operation: selected.operation,
        jobSha256: recoveryEvidence.jobSha256,
        requestedAt,
        recoveryMode,
      });
      await sendQueueMessage(context.auth, context.queue.queueId, selected.job);
      replayMessageSent = true;

      currentStage = 'verify-idempotency';
      replayCompletion = await pollD1Completion(context.config, selected, requestedAt, 2);
      assertReportRuntimeCloseoutCompletion(replayCompletion, { reportId: selected.reportId });
      assertReportRuntimeCloseoutReplay(firstCompletion, replayCompletion);
      const replayVerified = await pollLarkIntegrity(
        context.client,
        context.config.tableIds,
        selected.reportId,
        replayCompletion,
      );
      replayLark = replayVerified.state;
      replayIntegrity = replayVerified.integrity;
      replayLarkIntegrityPollAttempts = replayVerified.attemptCount;
      assertLarkReplay(firstLark, replayLark);
      if (stableJson(firstIntegrity) !== stableJson(replayIntegrity)) throw failure(
        'Recovered Report replay changed D1/Lark metric integrity evidence',
        'REPORT_RUNTIME_CLOSEOUT_REPLAY_INTEGRITY_DRIFT',
      );
    } catch (error) {
      primaryError = error;
    } finally {
      if (activeDeploymentAttempted) {
        currentStage = 'restore-all-false';
        try {
          await writeAttempt('recover-restore-safe', {
            repositoryHead: context.repository.head,
            originalRepositoryHead: recoveryEvidence.originalRepositoryHead,
            configSha256: context.config.safeSha256,
            activeVersion: activeDeployment?.versionId ?? null,
          });
          restoreDeployment = await deployConfig(context.config.safeText, 'report-closeout-recovery-safe-restore');
          await verifyRemoteDeployment(context.config, 'safe', restoreDeployment.versionId);
          safeRestoreVerified = true;
        } catch (restoreError) {
          if (primaryError) throw failure(
            'Report recovery failed and automatic all-false restore also failed',
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
  }

  if (!safeRestoreVerified) throw failure(
    'Report recovery requires verified all-false restore',
    'REPORT_RUNTIME_CLOSEOUT_RESTORE_NOT_VERIFIED',
  );

  await writeCloseoutSummary({
    context,
    selected,
    snapshotBefore,
    larkBefore,
    requestedAt,
    backup,
    firstCompletion,
    firstLark,
    firstIntegrity,
    firstLarkIntegrityPollAttempts: firstVerified.attemptCount,
    replayCompletion,
    replayLark,
    replayIntegrity,
    replayLarkIntegrityPollAttempts,
    restoreDeployment,
    recovery: Object.freeze({
      mode: recoveryMode,
      originalRepositoryHead: recoveryEvidence.originalRepositoryHead,
      replayAttemptedBeforeRecovery: recoveryEvidence.replayAttempted,
      verificationOnly: recoveryEvidence.replayAttempted,
      replayMessageSent,
      firstMaterializationRetried: false,
      originalBackup,
    }),
  });
}

async function writeCloseoutSummary(input) {
  currentStage = 'closeout-summary';
  const summary = safeReportRuntimeCloseoutEvidence({
    ok: true,
    contractVersion: REPORT_RUNTIME_CLOSEOUT_CONTRACT_VERSION,
    decision: input.selected.operation === 'refresh' ? 'REPORT_WINDOW_REFRESHED' : 'REPORT_WINDOW_CREATED',
    repository: input.context.repository,
    finalizerEvidence: {
      contractVersion: input.context.finalizerEvidence.contractVersion,
      schemaReadbackActions: input.context.finalizerEvidence.schema.readbackActions,
      schemaConflicts: input.context.finalizerEvidence.schema.conflicts,
      canonicalSettingsActive: input.context.finalizerEvidence.settings.canonicalActive,
    },
    target: {
      environment: 'development',
      customerProfile: 'integration_workspace',
      platform: target.platformScope,
      accountKey: target.accountKey,
      operation: input.selected.operation,
      reportSettingKey: input.selected.reportSettingKey,
      reportId: input.selected.reportId,
      windowDays: input.selected.windowDays,
      period: input.selected.period,
      sourceWatermark: input.context.d1Preflight.source_watermark,
    },
    preflight: {
      lark: input.context.larkPreflight,
      targetRows: summarizeTargetState(input.snapshotBefore, input.larkBefore),
      d1: {
        coverageStatus: input.context.d1Preflight.coverage_status,
        ...(target.platformScope === 'woocommerce' ? {
          coverageScopeMode: input.context.d1Preflight.coverage_scope_mode,
          dailyFactCount: Number(input.context.d1Preflight.daily_fact_count),
          orderStateCount: Number(input.context.d1Preflight.order_state_count),
        } : {
          contentStateCount: Number(input.context.d1Preflight.content_state_count),
          observationCount: Number(input.context.d1Preflight.observation_count),
        }),
      },
      pendingMigrations: input.context.pendingMigrations,
      safeBundleSha256: input.context.safeBundle.sha256,
      activeBundleSha256: input.context.activeBundle.sha256,
      backup: input.backup,
    },
    materialization: {
      dataStatus: input.firstCompletion.data_status,
      payloadChecksum: input.firstCompletion.payload_checksum,
      d1MaterializationCount: Number(input.firstCompletion.materialization_count),
      firstSyncRunCount: Number(input.firstCompletion.successful_sync_count),
      larkRows: summarizeLarkState(input.firstLark),
      larkIntegrityPollAttempts: input.firstLarkIntegrityPollAttempts,
      integrity: input.firstIntegrity,
    },
    replay: {
      sameReportId: input.firstCompletion.report_id === input.replayCompletion.report_id,
      samePayloadChecksum: input.firstCompletion.payload_checksum === input.replayCompletion.payload_checksum,
      d1MaterializationCount: Number(input.replayCompletion.materialization_count),
      successfulSyncRunCount: Number(input.replayCompletion.successful_sync_count),
      larkRowsUnchanged: stableJson(input.firstLark) === stableJson(input.replayLark),
      integrityUnchanged: stableJson(input.firstIntegrity) === stableJson(input.replayIntegrity),
      larkIntegrityPollAttempts: input.replayLarkIntegrityPollAttempts,
    },
    ...(input.recovery ? { recovery: input.recovery } : {}),
    runtime: {
      activeTrueFlags: target.activeTrueFlags,
      restoredAllFalse: true,
      finalWorkerVersion: input.restoreDeployment.versionId,
      aiSummaryEnabled: false,
      dailyScheduleEnabled: false,
      weeklyScheduleEnabled: false,
      connectorFlagsEnabled: false,
      providerCalls: 0,
      production: false,
    },
  });
  const evidencePath = join(outputRoot, 'report-runtime-closeout-summary.json');
  await writePrivateJson(evidencePath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
}

async function pollLarkIntegrity(client, tableIds, reportId, d1) {
  return pollReportRuntimeLarkIntegrity({
    readState: () => readLarkReportState(client, tableIds, reportId),
    assertComplete: assertLarkCompletion,
    assertIntegrity: (state) => assertD1LarkIntegrity(d1, state),
  });
}

function assertD1LarkIntegrity(d1, lark) {
  let payload;
  try {
    payload = JSON.parse(String(d1.payload_json ?? ''));
  } catch {
    throw failure(
      'Report materialization payload_json is invalid',
      'REPORT_RUNTIME_CLOSEOUT_PAYLOAD_JSON_INVALID',
    );
  }
  if (lark.duplicateMetricKeys !== 0) throw failure(
    'Lark Report metric rows contain duplicate metric_key values',
    'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_DUPLICATE',
    { duplicateMetricKeys: lark.duplicateMetricKeys },
  );
  return target.platformScope === 'woocommerce'
    ? assertReportRuntimeMetricIntegrity({ payload, larkMetrics: lark.metricValues })
    : assertReportRuntimeOrganicIntegrity({ payload, larkMetrics: lark.metricValues });
}

function summarizeTargetState(d1, lark) {
  return Object.freeze({
    d1MaterializationCount: Number(d1.materialization_count ?? 0),
    larkSnapshots: Number(lark.snapshots ?? 0),
    larkMetrics: Number(lark.metrics ?? 0),
    larkTopContent: Number(lark.topContent ?? 0),
  });
}

function summarizeLarkState(lark) {
  return Object.freeze({
    snapshots: lark.snapshots,
    metrics: lark.metrics,
    topContent: lark.topContent,
    duplicateMetricKeys: lark.duplicateMetricKeys,
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
  const remoteIds = new Set(remoteTables
    .map((item) => String(item?.table_id ?? item?.tableId ?? item?.id ?? ''))
    .filter(Boolean));
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

async function readD1Preflight() {
  if (target.platformScope === 'woocommerce') return readD1Row(compactSql(`
    WITH coverage AS (
      SELECT status, scope_mode, period_start, period_end, source_watermark, completed_at
      FROM data_coverage_runs
      WHERE account_key = '${sqlText(target.accountKey)}'
        AND platform = 'woocommerce'
        AND dataset_key = 'woocommerce_orders'
        AND completed_at IS NOT NULL
      ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
    )
    SELECT
      (SELECT status FROM coverage) AS coverage_status,
      (SELECT scope_mode FROM coverage) AS coverage_scope_mode,
      (SELECT period_start FROM coverage) AS coverage_period_start,
      (SELECT period_end FROM coverage) AS coverage_period_end,
      (SELECT source_watermark FROM coverage) AS source_watermark,
      (SELECT MAX(metric_date) FROM commerce_daily_sales_facts
        WHERE account_key = '${sqlText(target.accountKey)}') AS period_end,
      (SELECT COUNT(*) FROM commerce_daily_sales_facts
        WHERE account_key = '${sqlText(target.accountKey)}') AS daily_fact_count,
      (SELECT COUNT(*) FROM commerce_order_state
        WHERE account_key = '${sqlText(target.accountKey)}') AS order_state_count,
      (SELECT COUNT(*) FROM sync_locks l
        JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = 'woocommerce' AND r.account_key = '${sqlText(target.accountKey)}'
          AND r.sync_type = 'dashboard_performance_report'
          AND l.expires_at > (unixepoch() * 1000)) AS active_report_locks,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = 'report.materialization.generate' AND status IN ('open', 'redrive_pending')) AS open_report_dlq;
  `));
  return readD1Row(compactSql(`
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
  `));
}

async function readExistingReportIds(_config, reportIds) {
  const quoted = reportIds.map((value) => `'${sqlText(value)}'`).join(', ');
  const rows = await readD1Rows(`SELECT report_id FROM report_materializations WHERE report_id IN (${quoted});`);
  return rows.map((row) => String(row.report_id));
}

async function readD1Snapshot(_config, selected, requestedAt) {
  const reportId = sqlText(selected.reportId);
  const platformScope = sqlText(target.platformScope);
  const accountKey = sqlText(target.accountKey);
  return readD1Row(compactSql(`
    SELECT
      (SELECT report_id FROM report_materializations WHERE report_id = '${reportId}') AS report_id,
      (SELECT data_status FROM report_materializations WHERE report_id = '${reportId}') AS data_status,
      (SELECT payload_checksum FROM report_materializations WHERE report_id = '${reportId}') AS payload_checksum,
      (SELECT payload_json FROM report_materializations WHERE report_id = '${reportId}') AS payload_json,
      (SELECT generated_at FROM report_materializations WHERE report_id = '${reportId}') AS generated_at,
      (SELECT COUNT(*) FROM report_materializations WHERE report_id = '${reportId}') AS materialization_count,
      (SELECT status FROM sync_runs
        WHERE platform = '${platformScope}' AND account_key = '${accountKey}'
          AND sync_type = 'dashboard_performance_report' AND started_at >= ${requestedAt}
        ORDER BY started_at DESC, sync_run_id DESC LIMIT 1) AS sync_status,
      (SELECT COUNT(*) FROM sync_runs
        WHERE platform = '${platformScope}' AND account_key = '${accountKey}'
          AND sync_type = 'dashboard_performance_report' AND status = 'success'
          AND started_at >= ${requestedAt}) AS successful_sync_count,
      (SELECT COUNT(*) FROM sync_locks l
        JOIN sync_runs r ON r.sync_run_id = l.owner_id
        WHERE r.platform = '${platformScope}' AND r.account_key = '${accountKey}'
          AND r.sync_type = 'dashboard_performance_report'
          AND r.started_at >= ${requestedAt}
          AND l.expires_at > (unixepoch() * 1000)) AS active_lock_count,
      (SELECT COUNT(*) FROM dead_letter_jobs
        WHERE job_type = 'report.materialization.generate' AND created_at >= ${requestedAt}) AS new_dlq_count;
  `));
}

async function pollD1Completion(config, selected, requestedAt, minimumSuccessfulRuns) {
  const maxPolls = positiveInteger(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS ?? 24, 'maxPolls');
  const intervalMs = positiveInteger(
    process.env.MKT_REPORT_RUNTIME_CLOSEOUT_POLL_INTERVAL_MS ?? 5_000,
    'pollIntervalMs',
  );
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
      'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_KEY_MISSING',
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
  if (state.snapshots !== 1 || state.metrics <= 0 || state.topContent < 0 || state.duplicateMetricKeys !== 0) {
    throw failure(
      'Report closeout Lark materialization is incomplete',
      'REPORT_RUNTIME_CLOSEOUT_LARK_INCOMPLETE',
      { state: summarizeLarkState(state) },
    );
  }
}

function assertLarkReplay(before, after) {
  if (stableJson(before) !== stableJson(after)) throw failure(
    'Report closeout replay changed Lark Stable-key rows or values',
    'REPORT_RUNTIME_CLOSEOUT_LARK_REPLAY_DRIFT',
    { before: summarizeLarkState(before), after: summarizeLarkState(after) },
  );
}

async function readPendingMigrations() {
  const output = await runText('npx', [
    'wrangler', 'd1', 'migrations', 'list', 'MKT_STATE_DB', '--remote', '--config', configPath,
  ], { env: loaded?.env });
  return [...new Set([...output.matchAll(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/gu)]
    .map((match) => match[0]))].sort();
}

async function createD1Backup(selected, options = {}) {
  const backupDir = join(outputRoot, 'backups');
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const label = String(options.label ?? 'before').replace(/[^a-z0-9-]/giu, '-');
  const suffix = options.unique === true ? `-${Date.now()}` : '';
  const path = options.unique === true
    ? join(backupDir, `report-closeout-${label}-${selected.operation}-${selected.windowDays}d${suffix}.sql`)
    : join(backupDir, `report-closeout-before-${selected.operation}-${selected.windowDays}d.sql`);
  await run('npx', [
    'wrangler', 'd1', 'export', 'MKT_STATE_DB', '--remote', '--config', configPath, '--output', path,
  ], { env: loaded?.env });
  await chmod(path, 0o600);
  const bytes = await readFile(path);
  if (bytes.length === 0) throw failure(
    'Report closeout D1 backup is empty',
    'REPORT_RUNTIME_CLOSEOUT_BACKUP_EMPTY',
  );
  return Object.freeze({
    file: relative(repositoryRoot, path),
    bytes: bytes.length,
    sha256: sha256(bytes),
    remoteMutationCount: 0,
  });
}

async function readExistingD1Backup(selected) {
  const path = join(
    outputRoot,
    'backups',
    `report-closeout-before-${selected.operation}-${selected.windowDays}d.sql`,
  );
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') throw failure(
      'Original Report closeout D1 backup is missing',
      'REPORT_RUNTIME_CLOSEOUT_RECOVERY_BACKUP_MISSING',
    );
    throw error;
  }
  if (bytes.length === 0) throw failure(
    'Original Report closeout D1 backup is empty',
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_BACKUP_INVALID',
  );
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
  const expectedTrue = mode === 'active' ? [...target.activeTrueFlags].sort() : [];
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
    throw failure(
      'Remote Worker Queue differs from the reviewed target',
      'REPORT_RUNTIME_CLOSEOUT_REMOTE_QUEUE_MISMATCH',
    );
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

async function readD1Row(sql) {
  const rows = await readD1Rows(sql);
  if (rows.length !== 1) throw failure(
    'Report closeout D1 query returned an unexpected row count',
    'REPORT_RUNTIME_CLOSEOUT_D1_QUERY_SHAPE_INVALID',
    { rowCount: rows.length },
  );
  return Object.freeze({ ...rows[0] });
}

async function readD1Rows(sql) {
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

async function readRequiredJson(path) {
  const value = await readJsonIfExists(path);
  if (value === null) throw failure(
    'Required Report closeout recovery evidence is missing',
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_EVIDENCE_MISSING',
    { fileName: path.split('/').at(-1) ?? null },
  );
  return value;
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw failure(
      'Report closeout recovery evidence JSON is invalid',
      'REPORT_RUNTIME_CLOSEOUT_RECOVERY_EVIDENCE_JSON_INVALID',
      { fileName: path.split('/').at(-1) ?? null },
    );
    throw error;
  }
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
    'Unable to resolve the exact deployed Worker Version ID',
    'REPORT_RUNTIME_CLOSEOUT_DEPLOY_VERSION_UNRESOLVED',
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
  if (value && typeof value === 'object') return normalizeLarkText(
    value.text ?? value.value ?? value.name ?? null,
  );
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
    'REPORT_RUNTIME_CLOSEOUT_LARK_METRIC_VALUE_INVALID',
  );
  return number;
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
