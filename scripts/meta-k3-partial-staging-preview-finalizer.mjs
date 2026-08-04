#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  META_K3_EXACT_LARK_TABLE_KEYS,
  META_K3_EXACT_RECOVERY_ATTESTATION_HEADER,
  META_K3_EXACT_RECOVERY_IDENTITY,
  META_K3_EXACT_RECOVERY_MODE,
  META_K3_EXACT_RECOVERY_MODE_ENV,
} from '../packages/config/src/meta-k3-exact-recovery-contract.js';
import { readLarkTableIdsFromEnv } from '../packages/config/src/lark-table-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  buildMetaD1OnlySnapshotSql,
  classifyMetaD1OnlyCompletion,
  loadMetaD1OnlyTarget,
  normalizeMetaD1OnlySnapshot,
} from './lib/meta-d1-only-rollout-operator.js';
import {
  buildMetaLarkSnapshotSql,
  classifyMetaLarkCompletion,
  expectedLarkContracts,
  normalizeMetaLarkSnapshot,
} from './lib/meta-lark-parity-rollout-operator.js';
import {
  compareMetaD1OnlyDirectContinuationSnapshots,
} from './lib/meta-d1-only-partial-staging-recovery.js';
import {
  materializeMetaHistoryLarkRuntimeConfig,
} from './lib/meta-history-runtime-authority.js';
import {
  META_K3_PARTIAL_STAGING_FINALIZER_CONFIRMATION,
  META_K3_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
  META_K3_PARTIAL_STAGING_FINALIZER_DECISION,
  META_K3_RETAINED_OPERATION_HEAD,
  assertMetaK3PartialStagingFinalizerConfirmation,
  buildMetaK3ExactContinuationConfig,
  compareMetaK3DirectLarkSnapshots,
  createMetaK3CanonicalD1Summary,
  createMetaK3RecoveryEvidence,
  parseMetaK3PartialStagingFinalizerArgs,
  validateMetaK3ContinuationHttpResponse,
  validateMetaK3ExactPartialStagingStability,
  validateMetaK3RecoveryEvidenceSequence,
  validateMetaK3RetainedEvidence,
  validateMetaK3ReviewedRepositoryState,
} from './lib/meta-k3-partial-staging-finalizer.js';
import {
  buildMetaK3PreviewRuntimeConfig,
  parseMetaK3PreviewUpload,
  validateMetaK3PreviewTransport,
} from './lib/meta-k3-preview-recovery.js';
import {
  identifyMetaK3RecoveryResumeProfile,
  validateMetaK3RecoveryResumeEvidence,
} from './lib/meta-k3-recovery-resume-boundary.js';

const EXACT = META_K3_EXACT_RECOVERY_IDENTITY;
const repositoryRoot = realpathSync.native(process.cwd());
const d1Root = join(
  repositoryRoot,
  'outputs',
  'meta-d1-only-rollout',
  EXACT.targetKey,
  EXACT.operationId,
);
const recoveryRoot = join(d1Root, 'exact-partial-staging-recovery-v1');
const historyRoot = join(repositoryRoot, 'outputs', 'meta-history-2026');
const workerName = 'social-mkt-sync-worker';
const databaseBinding = 'MKT_STATE_DB';
const retainedForensicWorkKey =
  'meta_ads:chemistry_k2:meta-chemistry_k2-history-20260501-20260731-a22a21bea8ba';
const resumeConfirmation = Object.freeze({
  envName: 'MKT_META_K3_RESUME_PRE_MUTATION_CONFIG_FAILURE',
  value: 'RESUME_EXACT_K3_PRE_MUTATION_CONFIG_FAILURE',
});

let currentStage = 'init';
let emergencyRestoreAttempted = false;
let emergencyRestoreVerified = false;
let productionBaselineVersion = null;
let previewAlias = null;
let accountWorkersDevSubdomain = null;
let workerVersionUploadCount = 0;
let archivedPriorEvidenceRoot = null;

try {
  const options = parseMetaK3PartialStagingFinalizerArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await execute();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_K3_PARTIAL_STAGING_PREVIEW_FINALIZER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    archivedPriorEvidenceRoot: archivedPriorEvidenceRoot
      ? relative(repositoryRoot, archivedPriorEvidenceRoot)
      : null,
    emergencyRestoreAttempted,
    emergencyRestoreVerified,
    executionTransport: 'preview_version_upload',
    workerDeploymentCount: 0,
    workerVersionUploadCount,
    productionTrafficChange: false,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: META_K3_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
    target: EXACT.targetKey,
    operationId: EXACT.operationId,
    workKey: EXACT.workKey,
    syncRunId: EXACT.syncRunId,
    periodStart: EXACT.periodStart,
    periodEnd: EXACT.periodEnd,
    retainedOperationHead: META_K3_RETAINED_OPERATION_HEAD,
    confirmation: META_K3_PARTIAL_STAGING_FINALIZER_CONFIRMATION,
    recoveryConfirmation: {
      envName: META_K3_EXACT_RECOVERY_MODE_ENV,
      value: META_K3_EXACT_RECOVERY_MODE,
    },
    executionModel: 'dedicated_k3_exact_direct_continuation_without_loader_or_queue',
    executionTransport: 'preview_version_upload',
    previewEntrypoint: 'apps/sync-worker/src/meta-k3-exact-recovery-preview-entry.js',
    previewUrlAuthority: 'wrangler_version_upload_record',
    productionWorkerDeployment: false,
    productionTrafficChange: false,
    previewSafeCloseAfterEachWindow: true,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    providerReplay: false,
    schedules: false,
    production: false,
    remoteActionsPerformed: false,
  }, null, 2)}\n`);
}

async function execute() {
  assertMetaK3PartialStagingFinalizerConfirmation(process.env);
  const repository = verifyReviewedRepository();
  verifyExactHeadCi(repository.repositoryHead);

  currentStage = 'load-environment';
  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  await assertPrivateRegularFile(devVarsPath, 'DEV_VARS_FILE');
  const fileEnv = await readDevVars(devVarsPath);
  const authorityEnv = mergeNonEmptyEnvironment(fileEnv, process.env);
  const baseEnv = closeExecutionFlags({
    ...authorityEnv,
    DEV_VARS_FILE: devVarsPath,
  });
  requireExact(baseEnv.MKT_ENV, EXACT.environment, 'MKT_ENV');
  requireExact(baseEnv.MKT_CUSTOMER_PROFILE, EXACT.customerProfile, 'MKT_CUSTOMER_PROFILE');
  requireExact(baseEnv.MKT_CONNECTION_CUSTOMER_KEY, EXACT.customerKey, 'MKT_CONNECTION_CUSTOMER_KEY');
  const configPath = await resolveRepositoryFile(
    baseEnv.MKT_META_K3_RECOVERY_WRANGLER_CONFIG
      ?? baseEnv.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? baseEnv.MKT_META_HISTORY_WRANGLER_CONFIG,
    'MKT_META_K3_RECOVERY_WRANGLER_CONFIG',
  );
  previewAlias = requireText(baseEnv.MKT_META_K3_PREVIEW_ALIAS, 'MKT_META_K3_PREVIEW_ALIAS');
  accountWorkersDevSubdomain = requireText(
    baseEnv.MKT_META_K3_PREVIEW_SUBDOMAIN,
    'MKT_META_K3_PREVIEW_SUBDOMAIN',
  );

  const sourceConfigText = await readFile(configPath, 'utf8');
  const materializedRuntimeText = materializeMetaHistoryLarkRuntimeConfig(
    sourceConfigText,
    authorityEnv,
  );
  const previewRuntime = buildMetaK3PreviewRuntimeConfig(
    materializedRuntimeText,
    { repositoryRoot },
  );
  if (previewRuntime.trueFlags.length !== 0
    || previewRuntime.previewUrlsEnabled !== true
    || previewRuntime.workersDevEnabled !== false
    || previewRuntime.routesCopied !== 0
    || previewRuntime.scheduleTriggersCopied !== 0) {
    throw finalizerFailure(
      'Dedicated K3 Preview base config is not all-false and isolated',
      'META_K3_PREVIEW_CONFIG_INVALID',
    );
  }

  currentStage = 'archive-safe-prior-attempt';
  archivedPriorEvidenceRoot = await archiveAcceptedPriorAttempt(baseEnv);

  currentStage = 'retained-evidence-admission';
  await assertFreshRecoveryRoot();
  await mkdir(recoveryRoot, { recursive: true, mode: 0o700 });
  const retained = validateMetaK3RetainedEvidence({
    sendAttempt: await readJson(join(d1Root, 'send-one-d1-only.attempt.json')),
    send: await readJson(join(d1Root, 'send-one-d1-only.json')),
    restore: await readJson(join(d1Root, 'restore-all-false.json')),
    verifyRestore: await readJson(join(d1Root, 'verify-restore.json')),
  });

  productionBaselineVersion = await readActiveVersion(baseEnv, configPath);
  requireExact(
    baseEnv.MKT_META_K3_PRODUCTION_BASELINE_VERSION,
    productionBaselineVersion,
    'MKT_META_K3_PRODUCTION_BASELINE_VERSION',
  );
  const target = loadMetaD1OnlyTarget({
    ...baseEnv,
    MKT_META_D1_ONLY_TARGET: EXACT.targetKey,
    MKT_META_D1_ONLY_REPOSITORY_HEAD: repository.repositoryHead,
    MKT_META_D1_ONLY_OPERATION_ID: EXACT.operationId,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: retained.originalRequestedAt,
    MKT_META_D1_ONLY_PERIOD_START: EXACT.periodStart,
    MKT_META_D1_ONLY_PERIOD_END: EXACT.periodEnd,
    MKT_META_D1_ONLY_ACCOUNT_KEY: EXACT.accountKey,
    MKT_META_D1_ONLY_WORKER_NAME: workerName,
    MKT_META_D1_ONLY_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_META_D1_ONLY_MAIN_QUEUE: 'social-mkt-sync-jobs',
    MKT_META_D1_ONLY_DLQ: 'social-mkt-sync-dlq',
    MKT_META_D1_ONLY_EXPECTED_ACTIVE_VERSION: productionBaselineVersion,
    MKT_META_D1_ONLY_WRANGLER_CONFIG: relative(repositoryRoot, configPath),
    MKT_META_D1_ONLY_READ_ONLY_SUMMARY:
      baseEnv.MKT_META_D1_ONLY_READ_ONLY_SUMMARY
      ?? 'outputs/meta-read-only-validation/summary.json',
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY: META_K3_EXACT_RECOVERY_MODE,
  });
  const evidence = createEvidenceWriter({
    repositoryHead: repository.repositoryHead,
    retainedAnchorSha256: retained.retainedEvidenceSha256,
  });
  await evidence.write('retained-evidence-admission', {
    retained,
    reviewedRepository: repository,
    dedicatedFinalizer: true,
    loaderUsed: false,
    previewRuntimeSha256: previewRuntime.sha256,
    previewEntrypoint: relative(repositoryRoot, previewRuntime.previewEntrypoint),
    executionTransport: 'preview_version_upload',
    productionBaselineVersion,
    workerDeploymentCount: 0,
    productionTrafficChange: false,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
  });

  currentStage = 'local-full-gates';
  runLocalGates(baseEnv);

  currentStage = 'all-false-preflight';
  await verifyVersionFlags(baseEnv, configPath, productionBaselineVersion, []);
  const unrelated = await readReliabilityState(baseEnv, configPath, { final: false });
  assertInitialReliabilityBoundary(unrelated);

  currentStage = 'read-only-stability';
  const stabilityBefore = await readD1Snapshot(baseEnv, configPath, target);
  await sleep(30_000);
  const stabilityAfter = await readD1Snapshot(baseEnv, configPath, target);
  const stability = validateMetaK3ExactPartialStagingStability(
    stabilityBefore,
    stabilityAfter,
  );
  await evidence.write('read-only-stability', {
    stability,
    unrelatedReliability: unrelated,
    workerActiveVersion: productionBaselineVersion,
    executionFlagsAllFalse: true,
    productionDeploymentUnchanged: true,
  });

  currentStage = 'backup';
  const backup = await backupD1(baseEnv, configPath);
  await evidence.write('backup', backup);

  const d1Window = await runD1Window({
    baseEnv,
    safePreviewText: previewRuntime.text,
    target,
    evidence,
    snapshotBefore: stability.snapshot,
  });

  const d1Chain = validateMetaK3RecoveryEvidenceSequence(
    evidence.items,
    retained.retainedEvidenceSha256,
  );
  const d1Summary = createMetaK3CanonicalD1Summary({
    target,
    recovery: d1Chain,
  });
  await writePrivateJson(join(d1Root, 'summary.json'), d1Summary);

  currentStage = 'lark-preflight';
  const larkInventory = await preflightExactLark(baseEnv);
  await evidence.write('lark-preflight', larkInventory);

  const larkWindow = await runLarkWindow({
    baseEnv,
    safePreviewText: previewRuntime.text,
    target,
    evidence,
  });

  currentStage = 'final-safe-verification';
  const finalProductionVersion = await readActiveVersion(baseEnv, configPath);
  requireExact(finalProductionVersion, productionBaselineVersion, 'productionActiveVersion');
  await verifyVersionFlags(baseEnv, configPath, finalProductionVersion, []);
  const remote = await readReliabilityState(baseEnv, configPath, { final: true });
  assertFinalReliabilityBoundary(remote);

  const completedBeforeSummary = validateMetaK3RecoveryEvidenceSequence(
    evidence.items,
    retained.retainedEvidenceSha256,
  );
  await evidence.write('summary', {
    accepted: true,
    target: EXACT.targetKey,
    operationId: EXACT.operationId,
    periodStart: EXACT.periodStart,
    periodEnd: EXACT.periodEnd,
    d1Completed: true,
    larkCompleted: true,
    idempotentRerunVerified: true,
    d1InvocationCount: d1Window.invocationCount,
    larkInvocationCount: larkWindow.invocationCount,
    queueMessageCount: 0,
    queueAttemptsUnchanged: true,
    larkTableKeys: META_K3_EXACT_LARK_TABLE_KEYS,
    executionFlagsAllFalse: true,
    executionTransport: 'preview_version_upload',
    productionBaselineVersion,
    productionCurrentVersion: finalProductionVersion,
    productionDeploymentUnchanged: true,
    productionTrafficChange: false,
    workerDeploymentCount: 0,
    workerVersionUploadCount,
    remote,
    priorEvidenceChainHeadSha256: completedBeforeSummary.evidenceChainHeadSha256,
    scheduleEnabled: false,
    production: false,
  });
  const finalChain = validateMetaK3RecoveryEvidenceSequence(
    evidence.items,
    retained.retainedEvidenceSha256,
  );
  const summary = {
    ok: true,
    accepted: true,
    contractVersion: META_K3_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
    decision: META_K3_PARTIAL_STAGING_FINALIZER_DECISION,
    repositoryHead: repository.repositoryHead,
    retainedOperationHead: META_K3_RETAINED_OPERATION_HEAD,
    target: EXACT.targetKey,
    periodStart: EXACT.periodStart,
    periodEnd: EXACT.periodEnd,
    operationId: EXACT.operationId,
    workKey: EXACT.workKey,
    syncRunId: EXACT.syncRunId,
    d1Completed: true,
    larkCompleted: true,
    idempotentRerunVerified: true,
    executionFlagsAllFalse: true,
    activeWork: remote.activeWork,
    activeLocks: remote.activeLocks,
    activeQueueOperations: remote.activeQueueOperations,
    retainedForensicWork: remote.retainedForensicWork,
    executionTransport: 'preview_version_upload',
    dedicatedFinalizer: true,
    loaderUsed: false,
    productionDeploymentUnchanged: true,
    productionTrafficChange: false,
    workerDeploymentCount: 0,
    workerVersionUploadCount,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    larkTableKeys: META_K3_EXACT_LARK_TABLE_KEYS,
    evidenceChainHeadSha256: finalChain.evidenceChainHeadSha256,
    retainedEvidenceSha256: finalChain.retainedAnchorSha256,
    scheduleEnabled: false,
    production: false,
    marker: META_K3_PARTIAL_STAGING_FINALIZER_DECISION,
  };
  const output = join(
    historyRoot,
    repository.repositoryHead,
    'meta-history-2026-chemistry_k3-summary.json',
  );
  await writePrivateJson(output, summary);
  process.stdout.write(`${JSON.stringify({
    ...summary,
    evidenceRoot: recoveryRoot,
    summaryPath: output,
  }, null, 2)}\n`);
  process.stdout.write(`${META_K3_PARTIAL_STAGING_FINALIZER_DECISION}\n`);
}

async function runD1Window(input) {
  const {
    baseEnv,
    safePreviewText,
    target,
    evidence,
    snapshotBefore,
  } = input;
  const credentials = createEphemeralCredentials('d1', target.repositoryHead);
  const config = buildMetaK3ExactContinuationConfig(safePreviewText, target, {
    phase: 'd1',
    tokenSha256: credentials.tokenSha256,
    attestation: credentials.attestation,
  });
  const activePath = join(recoveryRoot, 'wrangler.meta-k3-d1.preview.jsonc');
  const safePath = join(recoveryRoot, 'wrangler.meta-k3.safe-preview.jsonc');
  await writePrivateText(activePath, config.activeText);
  await writePrivateText(safePath, config.safeText);
  let activated = false;
  let completed = false;
  let invocationCount = 0;
  let finalSnapshot = null;
  try {
    currentStage = 'deploy-d1-continuation';
    const deployed = await uploadPreviewVersion(
      baseEnv,
      activePath,
      'meta-k3-exact-d1-preview-continuation',
    );
    activated = true;
    await evidence.write('deploy-d1-continuation', {
      ...deployed,
      configSha256: config.activeSha256,
      trueFlags: config.activeTrueFlags,
      queueMessageCount: 0,
    });

    currentStage = 'verify-d1-continuation';
    await verifyVersionFlags(baseEnv, activePath, deployed.activeVersion, config.activeTrueFlags);
    await evidence.write('verify-d1-continuation', {
      activeVersion: deployed.activeVersion,
      expectedTrueFlags: config.activeTrueFlags,
      routeAttestation: credentials.attestation,
      previewOriginFingerprint: deployed.previewOriginFingerprint,
      executionTransport: 'preview_version_upload',
      productionDeploymentUnchanged: true,
      queueMessageCount: 0,
    });

    currentStage = 'continue-d1';
    const maxInvocations = positiveInteger(
      baseEnv.MKT_META_K3_D1_MAX_DIRECT_INVOCATIONS,
      100,
    );
    const statuses = [];
    for (let index = 0; index < maxInvocations; index += 1) {
      const response = await invokeExactContinuation({
        url: deployed.recoveryUrl,
        token: credentials.token,
        attestation: credentials.attestation,
        activeVersion: deployed.activeVersion,
        phase: 'd1',
      });
      invocationCount += 1;
      statuses.push(response.status);
      finalSnapshot = await readD1Snapshot(baseEnv, activePath, target);
      assertExactQueueAttempts(finalSnapshot);
      if (classifyMetaD1OnlyCompletion(finalSnapshot).complete) {
        completed = true;
        break;
      }
    }
    if (!completed) {
      throw finalizerFailure(
        'Bounded direct K3 D1 Preview continuation did not complete',
        'META_K3_DIRECT_D1_CONTINUATION_TIMEOUT',
        { invocationCount },
      );
    }
    await evidence.write('continue-d1', {
      invocationCount,
      statuses,
      executionTransport: 'preview_version_upload',
      queueMessageCount: 0,
      queueOperationAttemptMutationCount: 0,
    });

    currentStage = 'verify-d1';
    const comparison = compareMetaD1OnlyDirectContinuationSnapshots(
      snapshotBefore,
      finalSnapshot,
    );
    await evidence.write('verify-d1', {
      comparison,
      snapshotAfter: finalSnapshot,
      queueMessageCount: 0,
    });

    currentStage = 'verify-d1-idempotency';
    const rerunResponse = await invokeExactContinuation({
      url: deployed.recoveryUrl,
      token: credentials.token,
      attestation: credentials.attestation,
      activeVersion: deployed.activeVersion,
      phase: 'd1',
    });
    const rerunSnapshot = await readD1Snapshot(baseEnv, activePath, target);
    const rerun = compareMetaD1OnlyDirectContinuationSnapshots(
      finalSnapshot,
      rerunSnapshot,
      { rerun: true },
    );
    await evidence.write('verify-d1-idempotency', {
      response: rerunResponse,
      comparison: rerun,
      snapshotAfter: rerunSnapshot,
      queueMessageCount: 0,
    });
    finalSnapshot = rerunSnapshot;
  } finally {
    if (activated) {
      currentStage = 'restore-after-d1';
      emergencyRestoreAttempted = !completed;
      const restored = await uploadPreviewVersion(
        baseEnv,
        safePath,
        'meta-k3-preview-safe-close-after-d1',
      );
      await evidence.write('restore-after-d1', {
        ...restored,
        mode: 'safe',
        expectedTrueFlags: [],
      });
      currentStage = 'verify-restore-after-d1';
      await verifyVersionFlags(baseEnv, safePath, restored.activeVersion, []);
      emergencyRestoreVerified = !completed;
      await evidence.write('verify-restore-after-d1', {
        activeVersion: restored.activeVersion,
        mode: 'safe',
        expectedTrueFlags: [],
        executionTransport: 'preview_version_upload',
        productionDeploymentUnchanged: true,
        executionFlagsAllFalse: true,
      });
    }
    await rm(activePath, { force: true });
    await rm(safePath, { force: true });
  }
  return { invocationCount, finalSnapshot };
}

async function runLarkWindow(input) {
  const { baseEnv, safePreviewText, target, evidence } = input;
  const credentials = createEphemeralCredentials('lark', target.repositoryHead);
  const config = buildMetaK3ExactContinuationConfig(safePreviewText, target, {
    phase: 'lark',
    tokenSha256: credentials.tokenSha256,
    attestation: credentials.attestation,
  });
  const activePath = join(recoveryRoot, 'wrangler.meta-k3-lark.preview.jsonc');
  const safePath = join(recoveryRoot, 'wrangler.meta-k3.safe-lark-preview.jsonc');
  await writePrivateText(activePath, config.activeText);
  await writePrivateText(safePath, config.safeText);
  const snapshotBefore = await readLarkSnapshot(baseEnv, safePath, target);
  let activated = false;
  let completed = false;
  let invocationCount = 0;
  let finalSnapshot = null;
  try {
    currentStage = 'deploy-lark-continuation';
    const deployed = await uploadPreviewVersion(
      baseEnv,
      activePath,
      'meta-k3-exact-lark-preview-continuation',
    );
    activated = true;
    await evidence.write('deploy-lark-continuation', {
      ...deployed,
      configSha256: config.activeSha256,
      trueFlags: config.activeTrueFlags,
      queueMessageCount: 0,
    });

    currentStage = 'verify-lark-continuation';
    await verifyVersionFlags(baseEnv, activePath, deployed.activeVersion, config.activeTrueFlags);
    await evidence.write('verify-lark-continuation', {
      activeVersion: deployed.activeVersion,
      expectedTrueFlags: config.activeTrueFlags,
      routeAttestation: credentials.attestation,
      previewOriginFingerprint: deployed.previewOriginFingerprint,
      executionTransport: 'preview_version_upload',
      productionDeploymentUnchanged: true,
      queueMessageCount: 0,
    });

    currentStage = 'continue-lark';
    const maxInvocations = positiveInteger(
      baseEnv.MKT_META_K3_LARK_MAX_DIRECT_INVOCATIONS,
      20,
    );
    const statuses = [];
    for (let index = 0; index < maxInvocations; index += 1) {
      const response = await invokeExactContinuation({
        url: deployed.recoveryUrl,
        token: credentials.token,
        attestation: credentials.attestation,
        activeVersion: deployed.activeVersion,
        phase: 'lark',
      });
      invocationCount += 1;
      statuses.push(response.status);
      finalSnapshot = await readLarkSnapshot(baseEnv, activePath, target);
      assertExactQueueAttempts(finalSnapshot);
      if (classifyMetaLarkCompletion(finalSnapshot, target).complete) {
        completed = true;
        break;
      }
    }
    if (!completed) {
      throw finalizerFailure(
        'Bounded direct K3 Lark Preview continuation did not complete',
        'META_K3_DIRECT_LARK_CONTINUATION_TIMEOUT',
        { invocationCount },
      );
    }
    await evidence.write('continue-lark', {
      invocationCount,
      statuses,
      executionTransport: 'preview_version_upload',
      queueMessageCount: 0,
      queueOperationAttemptMutationCount: 0,
    });

    currentStage = 'verify-lark';
    const comparison = compareMetaK3DirectLarkSnapshots(
      snapshotBefore,
      finalSnapshot,
      target,
    );
    await evidence.write('verify-lark', {
      comparison,
      snapshotAfter: finalSnapshot,
      queueMessageCount: 0,
    });

    currentStage = 'verify-lark-idempotency';
    const rerunResponse = await invokeExactContinuation({
      url: deployed.recoveryUrl,
      token: credentials.token,
      attestation: credentials.attestation,
      activeVersion: deployed.activeVersion,
      phase: 'lark',
    });
    const rerunSnapshot = await readLarkSnapshot(baseEnv, activePath, target);
    const rerun = compareMetaK3DirectLarkSnapshots(
      finalSnapshot,
      rerunSnapshot,
      target,
      { rerun: true },
    );
    await evidence.write('verify-lark-idempotency', {
      response: rerunResponse,
      comparison: rerun,
      snapshotAfter: rerunSnapshot,
      queueMessageCount: 0,
    });
    finalSnapshot = rerunSnapshot;
  } finally {
    if (activated) {
      currentStage = 'restore-after-lark';
      emergencyRestoreAttempted = !completed;
      const restored = await uploadPreviewVersion(
        baseEnv,
        safePath,
        'meta-k3-preview-safe-close-after-lark',
      );
      await evidence.write('restore-after-lark', {
        ...restored,
        mode: 'safe',
        expectedTrueFlags: [],
      });
      currentStage = 'verify-restore-after-lark';
      await verifyVersionFlags(baseEnv, safePath, restored.activeVersion, []);
      emergencyRestoreVerified = !completed;
      await evidence.write('verify-restore-after-lark', {
        activeVersion: restored.activeVersion,
        mode: 'safe',
        expectedTrueFlags: [],
        executionTransport: 'preview_version_upload',
        productionDeploymentUnchanged: true,
        executionFlagsAllFalse: true,
      });
    }
    await rm(activePath, { force: true });
    await rm(safePath, { force: true });
  }
  return { invocationCount, finalSnapshot };
}

async function archiveAcceptedPriorAttempt(env) {
  let rootStat = null;
  try {
    rootStat = await stat(recoveryRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!rootStat.isDirectory()) {
    throw finalizerFailure(
      'Existing K3 recovery root is not a directory',
      'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
    );
  }
  requireExact(
    env[resumeConfirmation.envName],
    resumeConfirmation.value,
    resumeConfirmation.envName,
  );
  const entries = await readdir(recoveryRoot, { withFileTypes: true });
  const observedFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const observedDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const unsupportedEntries = entries
    .filter((entry) => !entry.isFile() && !entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (unsupportedEntries.length > 0) {
    throw finalizerFailure(
      'K3 recovery root contains unsupported filesystem entries',
      'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
      { unsupportedEntries },
    );
  }
  const profile = identifyMetaK3RecoveryResumeProfile(
    observedFiles,
    observedDirectories,
  );
  const evidence = {
    admission: await readJson(join(recoveryRoot, 'retained-evidence-admission.json')),
  };
  if (profile !== 'post_admission_pre_stability') {
    evidence.stability = await readJson(join(recoveryRoot, 'read-only-stability.json'));
    evidence.backup = await readJson(join(recoveryRoot, 'backup.json'));
  }
  if (profile === 'post_d1_preview_http_404_safe_restored') {
    evidence.deployD1 = await readJson(join(recoveryRoot, 'deploy-d1-continuation.json'));
    evidence.verifyD1 = await readJson(join(recoveryRoot, 'verify-d1-continuation.json'));
    evidence.restoreD1 = await readJson(join(recoveryRoot, 'restore-after-d1.json'));
    evidence.verifyRestoreD1 = await readJson(join(recoveryRoot, 'verify-restore-after-d1.json'));
  }
  validateMetaK3RecoveryResumeEvidence(profile, evidence);
  const stamp = new Date().toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/u, 'Z');
  let archivePath = `${recoveryRoot}-${profile}-${stamp}`;
  let suffix = 0;
  for (;;) {
    try {
      await rename(recoveryRoot, archivePath);
      return archivePath;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      suffix += 1;
      archivePath = `${recoveryRoot}-${profile}-${stamp}-${suffix}`;
    }
  }
}

function verifyReviewedRepository() {
  currentStage = 'exact-clean-reviewed-head';
  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  const branch = gitText(['branch', '--show-current']);
  const originReviewedHead = gitText([
    'rev-parse',
    'origin/integration/all-meta-end-to-end-completion-v1',
  ]);
  const reviewedHead = requireFullSha(
    process.env.MKT_META_HISTORY_REVIEW_WRAPPER_HEAD,
    'MKT_META_HISTORY_REVIEW_WRAPPER_HEAD',
  );
  const reviewBase = requireFullSha(
    process.env.MKT_META_HISTORY_REVIEW_BASE_MAIN_HEAD,
    'MKT_META_HISTORY_REVIEW_BASE_MAIN_HEAD',
  );
  const originMain = gitText(['rev-parse', 'origin/main']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  return validateMetaK3ReviewedRepositoryState({
    branch,
    repositoryHead,
    reviewedHead,
    originReviewedHead,
    retainedHead: META_K3_RETAINED_OPERATION_HEAD,
    retainedHeadIsAncestor: gitSucceeds([
      'merge-base', '--is-ancestor', META_K3_RETAINED_OPERATION_HEAD, repositoryHead,
    ]),
    reviewBaseIsAncestor: gitSucceeds([
      'merge-base', '--is-ancestor', reviewBase, repositoryHead,
    ]) && gitSucceeds(['merge-base', '--is-ancestor', reviewBase, originMain]),
    clean: dirty.trim() === '',
  });
}

function verifyExactHeadCi(repositoryHead) {
  currentStage = 'exact-head-ci-attestation';
  requireExact(process.env.MKT_META_K3_EXACT_HEAD_CI, 'PASS', 'MKT_META_K3_EXACT_HEAD_CI');
  requireExact(
    process.env.MKT_META_K3_EXACT_HEAD_CI_SHA,
    repositoryHead,
    'MKT_META_K3_EXACT_HEAD_CI_SHA',
  );
}

function runLocalGates(env) {
  runVisible('npm', ['ci'], env);
  runVisible('npm', ['run', 'check'], env);
  runVisible(process.execPath, [
    '--test',
    'tests/application/meta-d1-only-rollout-operator.test.js',
    'tests/application/meta-d1-only-partial-staging-recovery.test.js',
    'tests/application/meta-ads-lark-scope.test.js',
    'tests/application/meta-k3-exact-partial-staging-recovery.test.js',
    'tests/application/meta-k3-dedicated-finalizer.test.js',
    'tests/application/meta-k3-preview-recovery.test.js',
    'tests/application/meta-k3-recovery-resume-boundary.test.js',
  ], env);
  runVisible('npm', ['test'], env);
  runVisible('npm', ['run', 'test:report-reliability'], env);
  runVisible('npm', ['audit', '--audit-level=high'], env);
  runVisible('npm', ['run', 'deploy:dry-run'], env);
}

async function preflightExactLark(env) {
  const contracts = expectedLarkContracts('meta_ads');
  const contractKeys = contracts.map((entry) => entry.tableKey);
  if (stableJson(contractKeys) !== stableJson(META_K3_EXACT_LARK_TABLE_KEYS)) {
    throw finalizerFailure(
      'Meta Ads Lark contract is not the exact Account/Campaign/AdSet/Ad scope',
      'META_K3_LARK_SCOPE_INVALID',
      { contractKeys },
    );
  }
  const tableIds = readLarkTableIdsFromEnv(env, META_K3_EXACT_LARK_TABLE_KEYS);
  const client = createLarkBitableClientFromEnv(env);
  const remoteTables = await client.listTables();
  const remoteIds = new Set(remoteTables.map((entry) => (
    entry?.tableId ?? entry?.table_id ?? entry?.id
  )).filter(Boolean));
  const fieldCounts = {};
  for (const contract of contracts) {
    const tableId = tableIds[contract.tableKey];
    if (!remoteIds.has(tableId)) {
      throw finalizerFailure(
        'Exact Meta Ads Lark table is missing',
        'META_K3_LARK_PREFLIGHT_INCOMPLETE',
        { tableKey: contract.tableKey },
      );
    }
    const fields = await client.listFields({ tableId });
    fieldCounts[contract.tableKey] = fields.length;
    const names = fields.map((field) => (
      field?.fieldName ?? field?.field_name ?? field?.name
    ));
    if (!names.includes(contract.keyField)) {
      throw finalizerFailure(
        'Exact Meta Ads Lark stable key field is missing',
        'META_K3_LARK_PREFLIGHT_INCOMPLETE',
        { tableKey: contract.tableKey, keyField: contract.keyField },
      );
    }
  }
  return {
    accepted: true,
    tableKeys: contractKeys,
    tableCount: contractKeys.length,
    fieldCounts,
    larkRequestCount: 1 + contractKeys.length,
    larkMutationCount: 0,
    rawAdsMirrored: false,
    creativeMirrored: false,
    detailedDailyMirrored: false,
  };
}

async function invokeExactContinuation(input) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(input.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.token}`,
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: '{}',
      redirect: 'manual',
      signal: controller.signal,
    });
    const value = await response.json().catch(() => null);
    if (!response.ok || !value) {
      throw finalizerFailure(
        `Meta K3 exact Preview continuation failed with HTTP ${response.status}`,
        'META_K3_DIRECT_CONTINUATION_HTTP_FAILED',
        {
          phase: input.phase,
          status: response.status,
          attestationMatched:
            response.headers.get(META_K3_EXACT_RECOVERY_ATTESTATION_HEADER)
              === input.attestation,
          versionMatched:
            response.headers.get('x-mkt-worker-version-id')
              === input.activeVersion,
        },
      );
    }
    requireExact(
      response.headers.get(META_K3_EXACT_RECOVERY_ATTESTATION_HEADER),
      input.attestation,
      META_K3_EXACT_RECOVERY_ATTESTATION_HEADER,
    );
    requireExact(
      response.headers.get('x-mkt-worker-version-id'),
      input.activeVersion,
      'x-mkt-worker-version-id',
    );
    return validateMetaK3ContinuationHttpResponse(value, { phase: input.phase });
  } finally {
    clearTimeout(timer);
  }
}

function createEphemeralCredentials(phase, repositoryHead) {
  const token = randomBytes(48).toString('base64url');
  const tokenSha256 = sha256(token);
  const attestation = sha256(stableJson({
    contractVersion: META_K3_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
    repositoryHead,
    retainedOperationHead: META_K3_RETAINED_OPERATION_HEAD,
    operationId: EXACT.operationId,
    phase,
    nonce: randomBytes(32).toString('hex'),
  }));
  return { token, tokenSha256, attestation };
}

async function readD1Snapshot(env, configPath, target) {
  return normalizeMetaD1OnlySnapshot(await readD1Row(
    env,
    configPath,
    buildMetaD1OnlySnapshotSql(target),
  ));
}

async function readLarkSnapshot(env, configPath, target) {
  return normalizeMetaLarkSnapshot(await readD1Row(
    env,
    configPath,
    buildMetaLarkSnapshotSql(target),
  ));
}

async function backupD1(env, configPath) {
  const backupPath = join(recoveryRoot, 'meta-k3-before-recovery.sql');
  runText('npx', [
    'wrangler', 'd1', 'export', databaseBinding, '--remote',
    '--config', configPath, '--output', backupPath,
  ], env);
  await chmod(backupPath, 0o600);
  const bytes = await readFile(backupPath);
  if (bytes.length === 0) {
    throw finalizerFailure(
      'Meta K3 D1 backup is empty',
      'META_K3_PARTIAL_STAGING_BACKUP_EMPTY',
    );
  }
  return {
    backupFile: relative(repositoryRoot, backupPath),
    backupBytes: bytes.length,
    backupSha256: sha256(bytes),
    remoteMutationCount: 0,
  };
}

async function uploadPreviewVersion(env, configPath, message) {
  const outputPath = join(
    recoveryRoot,
    `.wrangler-preview-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.ndjson`,
  );
  try {
    const stdout = runText('npx', [
      'wrangler', 'versions', 'upload', '--config', configPath,
      '--preview-alias', previewAlias,
      '--message', `${message} git=${gitText(['rev-parse', 'HEAD'])}`,
    ], {
      ...env,
      WRANGLER_OUTPUT_FILE_PATH: outputPath,
    });
    workerVersionUploadCount += 1;
    const outputText = await readFile(outputPath, 'utf8').catch(() => '');
    const upload = parseMetaK3PreviewUpload(outputText, stdout, {
      previewAlias,
      accountWorkersDevSubdomain,
    });
    const productionCurrentVersion = await readActiveVersion(env, configPath);
    const transport = validateMetaK3PreviewTransport({
      productionBaselineVersion,
      productionCurrentVersion,
      previewVersion: upload.versionId,
    });
    return {
      activeVersion: upload.versionId,
      recoveryUrl: upload.recoveryUrl,
      repositoryHead: gitText(['rev-parse', 'HEAD']),
      commandExitCode: 0,
      executionTransport: transport.executionTransport,
      productionBaselineVersion,
      productionCurrentVersion,
      productionDeploymentUnchanged: true,
      productionTrafficChange: false,
      workerDeploymentCount: 0,
      workerVersionUploadCount: 1,
      previewOriginFingerprint: upload.previewOriginFingerprint,
      wranglerPreviewUrlCrossCheckCount: upload.wranglerPreviewUrlCrossCheckCount,
      aliasedPreviewUrlCount: upload.aliasedPreviewUrlCount,
      versionedPreviewUrlCount: upload.versionedPreviewUrlCount,
    };
  } finally {
    await rm(outputPath, { force: true });
  }
}

async function readActiveVersion(env, configPath) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status', '--name', workerName,
    '--config', configPath, '--json',
  ], env));
  const status = Array.isArray(value) ? value[0] : value;
  const active = (Array.isArray(status?.versions) ? status.versions : [])
    .filter((entry) => Number(entry?.percentage) === 100);
  if (active.length !== 1 || !active[0]?.version_id) {
    throw finalizerFailure(
      'Worker does not have exactly one 100% active Production version',
      'META_K3_ACTIVE_VERSION_INVALID',
    );
  }
  return active[0].version_id;
}

async function verifyVersionFlags(env, configPath, versionId, expectedTrueFlags) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', versionId,
    '--name', workerName, '--config', configPath, '--json',
  ], env));
  const observed = readEnabledFlags(value);
  if (stableJson(observed) !== stableJson([...expectedTrueFlags].sort())) {
    throw finalizerFailure(
      'Worker Preview execution flags differ from the exact K3 window',
      'META_K3_WORKER_FLAG_DRIFT',
      { observed, expected: expectedTrueFlags },
    );
  }
  const currentProductionVersion = await readActiveVersion(env, configPath);
  requireExact(currentProductionVersion, productionBaselineVersion, 'productionActiveVersion');
  return true;
}

function readEnabledFlags(value) {
  const flags = new Map();
  walk(value, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, nested] of Object.entries(node)) {
      if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) flags.set(key, booleanLike(nested));
    }
    if (typeof node.name === 'string' && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(node.name)) {
      flags.set(node.name, booleanLike(node.text ?? node.value ?? node.json ?? node.data));
    }
  });
  return [...flags.entries()]
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .sort();
}

async function readReliabilityState(env, configPath, options = {}) {
  const currentExclusion = options.final
    ? ''
    : ` AND work_key <> ${sqlText(EXACT.workKey)}`;
  const currentJoinedExclusion = options.final
    ? ''
    : ` AND w.work_key <> ${sqlText(EXACT.workKey)}`;
  const row = await readD1Row(env, configPath, `SELECT
    (SELECT COUNT(*) FROM sync_work_runs
      WHERE lifecycle_status = 'active'
        AND work_key <> ${sqlText(retainedForensicWorkKey)}${currentExclusion}) AS active_work,
    (SELECT COUNT(*) FROM sync_locks
      WHERE expires_at > (unixepoch() * 1000)) AS active_locks,
    (SELECT COUNT(DISTINCT q.operation_id) FROM queue_operation_attempts q
      JOIN sync_work_runs w ON w.work_key = q.work_key
      WHERE w.lifecycle_status = 'active'
        AND w.work_key <> ${sqlText(retainedForensicWorkKey)}${currentJoinedExclusion})
      AS active_queue_operations,
    (SELECT COUNT(*) FROM sync_work_runs
      WHERE lifecycle_status = 'active'
        AND work_key = ${sqlText(retainedForensicWorkKey)}) AS retained_forensic_work,
    (SELECT COUNT(*) FROM sync_work_runs
      WHERE lifecycle_status = 'active'
        AND work_key = ${sqlText(EXACT.workKey)}) AS exact_active_work;`);
  return {
    activeWork: Number(row.active_work ?? 0),
    activeLocks: Number(row.active_locks ?? 0),
    activeQueueOperations: Number(row.active_queue_operations ?? 0),
    retainedForensicWork: Number(row.retained_forensic_work ?? 0),
    exactActiveWork: Number(row.exact_active_work ?? 0),
  };
}

function assertInitialReliabilityBoundary(value) {
  if (value.activeWork !== 0
    || value.activeLocks !== 0
    || value.activeQueueOperations !== 0
    || value.exactActiveWork !== 1
    || ![0, 1].includes(value.retainedForensicWork)) {
    throw finalizerFailure(
      'Meta K3 initial Reliability boundary is not exact and idle',
      'META_K3_INITIAL_RELIABILITY_DRIFT',
      value,
    );
  }
}

function assertFinalReliabilityBoundary(value) {
  if (value.activeWork !== 0
    || value.activeLocks !== 0
    || value.activeQueueOperations !== 0
    || value.exactActiveWork !== 0
    || ![0, 1].includes(value.retainedForensicWork)) {
    throw finalizerFailure(
      'Meta K3 final Reliability boundary is not idle',
      'META_K3_FINAL_RELIABILITY_DRIFT',
      value,
    );
  }
}

function assertExactQueueAttempts(snapshot) {
  if (snapshot.queueOperationAttempts !== EXACT.queueOperationAttempts
    || snapshot.mainQueueAttempts !== EXACT.mainQueueAttempts) {
    throw finalizerFailure(
      'Meta K3 direct Preview continuation changed Queue attempts',
      'META_K3_DIRECT_CONTINUATION_QUEUE_DRIFT',
      {
        queueOperationAttempts: snapshot.queueOperationAttempts,
        mainQueueAttempts: snapshot.mainQueueAttempts,
      },
    );
  }
}

async function readD1Row(env, configPath, sql) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'd1', 'execute', databaseBinding, '--remote', '--json',
    '--config', configPath, '--command', sql,
  ], env));
  const row = Array.isArray(value)
    ? value.flatMap((entry) => entry?.results ?? [])[0]
    : value?.results?.[0];
  if (!row) {
    throw finalizerFailure(
      'Remote D1 query returned no row',
      'META_K3_D1_QUERY_EMPTY',
    );
  }
  return row;
}

function createEvidenceWriter(input) {
  const items = [];
  let previousEvidenceSha256 = input.retainedAnchorSha256;
  return {
    items,
    async write(phase, data) {
      const evidence = createMetaK3RecoveryEvidence({
        phase,
        repositoryHead: input.repositoryHead,
        previousEvidenceSha256,
        data,
      });
      await writePrivateJson(join(recoveryRoot, `${phase}.json`), evidence);
      items.push(evidence);
      previousEvidenceSha256 = evidence.evidenceSha256;
      return evidence;
    },
  };
}

async function assertFreshRecoveryRoot() {
  try {
    const value = await stat(recoveryRoot);
    if (value.isDirectory()) {
      throw finalizerFailure(
        'Exact Meta K3 recovery evidence already exists; automatic rerun is blocked',
        'META_K3_RECOVERY_ALREADY_ATTEMPTED',
      );
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function resolveRepositoryFile(value, fieldName) {
  const input = requireText(value, fieldName);
  const path = resolve(repositoryRoot, input);
  const canonical = await realpath(path);
  if (canonical !== repositoryRoot && !canonical.startsWith(`${repositoryRoot}/`)) {
    throw finalizerFailure(
      `${fieldName} must resolve inside the Repository`,
      'META_K3_PATH_INVALID',
      { fieldName },
    );
  }
  await assertRegularFile(canonical, fieldName);
  return canonical;
}

async function assertPrivateRegularFile(path, fieldName) {
  const value = await stat(path);
  if (!value.isFile() || (value.mode & 0o077) !== 0) {
    throw finalizerFailure(
      `${fieldName} must be a private regular file`,
      'META_K3_PRIVATE_FILE_INVALID',
      { fieldName },
    );
  }
}

async function assertRegularFile(path, fieldName) {
  const value = await stat(path);
  if (!value.isFile()) {
    throw finalizerFailure(
      `${fieldName} must be a regular file`,
      'META_K3_FILE_INVALID',
      { fieldName },
    );
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writePrivateJson(path, value) {
  await writePrivateText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writePrivateText(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, value, { mode: 0o600 });
  await rename(temp, path);
  await chmod(path, 0o600);
}

function mergeNonEmptyEnvironment(base, override) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === ''
      && typeof merged[key] === 'string' && merged[key].trim() !== '') {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function closeExecutionFlags(env) {
  const result = { ...env };
  for (const key of Object.keys(result)) {
    if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) result[key] = 'false';
  }
  return result;
}

function runVisible(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw finalizerFailure(
      `Command failed: ${command} ${args.join(' ')}`,
      'META_K3_LOCAL_GATE_FAILED',
      { command, exitCode: result.status },
    );
  }
}

function runText(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw finalizerFailure(
      `Command failed: ${command} ${args.join(' ')}`,
      'META_K3_COMMAND_FAILED',
      {
        command,
        exitCode: result.status,
        stderrSha256: sha256(result.stderr ?? ''),
      },
    );
  }
  return String(result.stdout ?? '').trim();
}

function gitText(args, trim = true) {
  const value = runText('git', args, process.env);
  return trim ? value.trim() : value;
}

function gitSucceeds(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function walk(value, callback) {
  callback(value);
  if (Array.isArray(value)) {
    for (const nested of value) walk(nested, callback);
  } else if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) walk(nested, callback);
  }
}

function booleanLike(value) {
  if (value === true || value === false) return value;
  if (value && typeof value === 'object') {
    return booleanLike(value.text ?? value.value ?? value.json ?? value.data);
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return false;
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 10_000) {
    throw finalizerFailure(
      'Meta K3 invocation limit must be a positive integer',
      'META_K3_INVOCATION_LIMIT_INVALID',
    );
  }
  return number;
}

function requireFullSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw finalizerFailure(`${fieldName} must be a full SHA`, 'META_K3_INPUT_INVALID');
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw finalizerFailure(`${fieldName} is required`, 'META_K3_INPUT_INVALID');
  }
  return value.trim();
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw finalizerFailure(
      `${fieldName} does not match the exact reviewed value`,
      'META_K3_EXACT_VALUE_MISMATCH',
      { fieldName },
    );
  }
  return value;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sanitize(value, key = '') {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (typeof value !== 'object') {
    return /token|secret|authorization|password|cookie|subdomain|origin|url/iu.test(key)
      ? '[REDACTED]'
      : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
    nestedKey,
    sanitize(nestedValue, nestedKey),
  ]));
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function finalizerFailure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK3PartialStagingPreviewFinalizerError';
  error.code = code;
  error.details = details;
  return error;
}
