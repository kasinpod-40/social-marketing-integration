#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  META_K2_EXACT_LARK_TABLE_KEYS,
  META_K2_EXACT_RECOVERY_ATTESTATION_HEADER,
  META_K2_EXACT_RECOVERY_IDENTITY,
  META_K2_EXACT_RECOVERY_MODE,
  META_K2_EXACT_RECOVERY_MODE_ENV,
  META_K2_EXACT_RECOVERY_PATH,
} from '../packages/config/src/meta-k2-exact-recovery-contract.js';
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
  validateMetaK2ExactPartialStagingStability,
} from './lib/meta-d1-only-partial-staging-recovery.js';
import {
  META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION,
  META_K2_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
  META_K2_PARTIAL_STAGING_FINALIZER_DECISION,
  META_K2_RETAINED_OPERATION_HEAD,
  assertMetaK2PartialStagingFinalizerConfirmation,
  buildMetaK2ExactContinuationConfig,
  compareMetaK2DirectLarkSnapshots,
  createMetaK2CanonicalD1Summary,
  createMetaK2RecoveryEvidence,
  parseMetaK2PartialStagingFinalizerArgs,
  validateMetaK2ContinuationHttpResponse,
  validateMetaK2RecoveryEvidenceSequence,
  validateMetaK2RetainedEvidence,
  validateMetaK2ReviewedRepositoryState,
} from './lib/meta-k2-partial-staging-finalizer.js';

const EXACT = META_K2_EXACT_RECOVERY_IDENTITY;
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
let currentStage = 'init';
let emergencyRestoreAttempted = false;
let emergencyRestoreVerified = false;

try {
  const options = parseMetaK2PartialStagingFinalizerArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await execute();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_K2_PARTIAL_STAGING_FINALIZER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    emergencyRestoreAttempted,
    emergencyRestoreVerified,
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
    contractVersion: META_K2_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
    target: EXACT.targetKey,
    operationId: EXACT.operationId,
    workKey: EXACT.workKey,
    syncRunId: EXACT.syncRunId,
    periodStart: EXACT.periodStart,
    periodEnd: EXACT.periodEnd,
    retainedOperationHead: META_K2_RETAINED_OPERATION_HEAD,
    confirmation: META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION,
    recoveryConfirmation: {
      envName: META_K2_EXACT_RECOVERY_MODE_ENV,
      value: META_K2_EXACT_RECOVERY_MODE,
    },
    executionModel: 'exact_direct_use_case_continuation_without_queue_delivery',
    d1Window: 'source_checkpoint_then_d1_and_coverage',
    larkWindow: META_K2_EXACT_LARK_TABLE_KEYS,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    providerReplay: false,
    schedules: false,
    production: false,
    remoteActionsPerformed: false,
  }, null, 2)}\n`);
}

async function execute() {
  assertMetaK2PartialStagingFinalizerConfirmation(process.env);
  const repository = verifyReviewedRepository();
  verifyExactHeadCi(repository.repositoryHead);

  currentStage = 'load-environment';
  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  await assertPrivateRegularFile(devVarsPath, 'DEV_VARS_FILE');
  const fileEnv = await readDevVars(devVarsPath);
  const baseEnv = closeExecutionFlags({
    ...fileEnv,
    ...process.env,
    DEV_VARS_FILE: devVarsPath,
  });
  requireExact(baseEnv.MKT_ENV, EXACT.environment, 'MKT_ENV');
  requireExact(baseEnv.MKT_CUSTOMER_PROFILE, EXACT.customerProfile, 'MKT_CUSTOMER_PROFILE');
  requireExact(baseEnv.MKT_CONNECTION_CUSTOMER_KEY, EXACT.customerKey, 'MKT_CONNECTION_CUSTOMER_KEY');
  const configPath = await resolveRepositoryFile(
    baseEnv.MKT_META_K2_RECOVERY_WRANGLER_CONFIG
      ?? baseEnv.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? baseEnv.MKT_META_HISTORY_WRANGLER_CONFIG,
    'MKT_META_K2_RECOVERY_WRANGLER_CONFIG',
  );
  const recoveryUrl = requireRecoveryUrl(baseEnv.MKT_META_K2_EXACT_RECOVERY_URL);

  currentStage = 'retained-evidence-admission';
  await assertFreshRecoveryRoot();
  await mkdir(recoveryRoot, { recursive: true, mode: 0o700 });
  const retained = validateMetaK2RetainedEvidence({
    sendAttempt: await readJson(join(d1Root, 'send-one-d1-only.attempt.json')),
    send: await readJson(join(d1Root, 'send-one-d1-only.json')),
    restore: await readJson(join(d1Root, 'restore-all-false.json')),
    verifyRestore: await readJson(join(d1Root, 'verify-restore.json')),
  });
  const safeConfigText = await readFile(configPath, 'utf8');
  const activeVersion = await readActiveVersion(baseEnv, configPath);
  const target = loadMetaD1OnlyTarget({
    ...baseEnv,
    MKT_META_D1_ONLY_TARGET: EXACT.targetKey,
    MKT_META_D1_ONLY_REPOSITORY_HEAD: repository.repositoryHead,
    MKT_META_D1_ONLY_OPERATION_ID: EXACT.operationId,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: String(retained.originalRequestedAt),
    MKT_META_D1_ONLY_PERIOD_START: EXACT.periodStart,
    MKT_META_D1_ONLY_PERIOD_END: EXACT.periodEnd,
    MKT_META_D1_ONLY_ACCOUNT_KEY: EXACT.accountKey,
    MKT_META_D1_ONLY_WORKER_NAME: workerName,
    MKT_META_D1_ONLY_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_META_D1_ONLY_MAIN_QUEUE: 'social-mkt-sync-jobs',
    MKT_META_D1_ONLY_DLQ: 'social-mkt-sync-dlq',
    MKT_META_D1_ONLY_EXPECTED_ACTIVE_VERSION: activeVersion,
    MKT_META_D1_ONLY_WRANGLER_CONFIG: relative(repositoryRoot, configPath),
    MKT_META_D1_ONLY_READ_ONLY_SUMMARY:
      baseEnv.MKT_META_D1_ONLY_READ_ONLY_SUMMARY
      ?? 'outputs/meta-read-only-validation/summary.json',
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY: META_K2_EXACT_RECOVERY_MODE,
  });
  const evidence = createEvidenceWriter({
    repositoryHead: repository.repositoryHead,
    retainedAnchorSha256: retained.retainedEvidenceSha256,
  });
  await evidence.write('retained-evidence-admission', {
    retained,
    reviewedRepository: repository,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
  });

  currentStage = 'local-full-gates';
  runLocalGates(baseEnv);

  currentStage = 'all-false-preflight';
  await verifyDeploymentFlags(baseEnv, configPath, activeVersion, []);
  const unrelated = await readReliabilityState(baseEnv, configPath, { final: false });
  assertInitialReliabilityBoundary(unrelated);

  currentStage = 'read-only-stability';
  const stabilityBefore = await readD1Snapshot(baseEnv, configPath, target);
  await sleep(30_000);
  const stabilityAfter = await readD1Snapshot(baseEnv, configPath, target);
  const stability = validateMetaK2ExactPartialStagingStability(
    stabilityBefore,
    stabilityAfter,
  );
  await evidence.write('read-only-stability', {
    stability,
    unrelatedReliability: unrelated,
    workerActiveVersion: activeVersion,
    executionFlagsAllFalse: true,
  });

  currentStage = 'backup';
  const backup = await backupD1(baseEnv, configPath);
  await evidence.write('backup', backup);

  const d1Window = await runD1Window({
    baseEnv,
    configPath,
    safeConfigText,
    recoveryUrl,
    target,
    evidence,
    snapshotBefore: stability.snapshot,
  });

  const d1Chain = validateMetaK2RecoveryEvidenceSequence(
    evidence.items,
    retained.retainedEvidenceSha256,
  );
  const d1Summary = createMetaK2CanonicalD1Summary({
    target,
    recovery: d1Chain,
  });
  await writePrivateJson(join(d1Root, 'summary.json'), d1Summary);

  currentStage = 'lark-preflight';
  const larkInventory = await preflightExactLark(baseEnv);
  await evidence.write('lark-preflight', larkInventory);

  const larkWindow = await runLarkWindow({
    baseEnv,
    configPath,
    safeConfigText,
    recoveryUrl,
    target,
    evidence,
  });

  currentStage = 'final-safe-verification';
  const finalVersion = await readActiveVersion(baseEnv, configPath);
  await verifyDeploymentFlags(baseEnv, configPath, finalVersion, []);
  const remote = await readReliabilityState(baseEnv, configPath, { final: true });
  assertFinalReliabilityBoundary(remote);

  const completedBeforeSummary = validateMetaK2RecoveryEvidenceSequence(
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
    larkTableKeys: META_K2_EXACT_LARK_TABLE_KEYS,
    executionFlagsAllFalse: true,
    remote,
    priorEvidenceChainHeadSha256: completedBeforeSummary.evidenceChainHeadSha256,
    scheduleEnabled: false,
    production: false,
  });
  const finalChain = validateMetaK2RecoveryEvidenceSequence(
    evidence.items,
    retained.retainedEvidenceSha256,
  );
  const summary = {
    ok: true,
    accepted: true,
    contractVersion: META_K2_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
    decision: META_K2_PARTIAL_STAGING_FINALIZER_DECISION,
    repositoryHead: repository.repositoryHead,
    retainedOperationHead: META_K2_RETAINED_OPERATION_HEAD,
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
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    larkTableKeys: META_K2_EXACT_LARK_TABLE_KEYS,
    evidenceChainHeadSha256: finalChain.evidenceChainHeadSha256,
    retainedEvidenceSha256: finalChain.retainedAnchorSha256,
    scheduleEnabled: false,
    production: false,
    marker: META_K2_PARTIAL_STAGING_FINALIZER_DECISION,
  };
  const output = join(
    historyRoot,
    repository.repositoryHead,
    'meta-history-2026-chemistry_k2-summary.json',
  );
  await writePrivateJson(output, summary);
  process.stdout.write(`${JSON.stringify({
    ...summary,
    evidenceRoot: recoveryRoot,
    summaryPath: output,
  }, null, 2)}\n`);
  process.stdout.write(`${META_K2_PARTIAL_STAGING_FINALIZER_DECISION}\n`);
}

async function runD1Window(input) {
  const {
    baseEnv,
    configPath,
    safeConfigText,
    recoveryUrl,
    target,
    evidence,
    snapshotBefore,
  } = input;
  const credentials = createEphemeralCredentials('d1', target.repositoryHead);
  const config = buildMetaK2ExactContinuationConfig(safeConfigText, target, {
    phase: 'd1',
    tokenSha256: credentials.tokenSha256,
    attestation: credentials.attestation,
  });
  const activePath = join(recoveryRoot, 'wrangler.meta-k2-d1.active.jsonc');
  const safePath = join(recoveryRoot, 'wrangler.meta-k2.safe.jsonc');
  await writePrivateText(activePath, config.activeText);
  await writePrivateText(safePath, config.safeText);
  let activated = false;
  let completed = false;
  let invocationCount = 0;
  let finalSnapshot = null;
  try {
    currentStage = 'deploy-d1-continuation';
    const deployed = await deploy(baseEnv, activePath, 'meta-k2-exact-d1-continuation');
    activated = true;
    await evidence.write('deploy-d1-continuation', {
      ...deployed,
      configSha256: config.activeSha256,
      trueFlags: config.activeTrueFlags,
      queueMessageCount: 0,
    });

    currentStage = 'verify-d1-continuation';
    await verifyDeploymentFlags(baseEnv, activePath, deployed.activeVersion, config.activeTrueFlags);
    await evidence.write('verify-d1-continuation', {
      activeVersion: deployed.activeVersion,
      expectedTrueFlags: config.activeTrueFlags,
      routeAttestation: credentials.attestation,
      queueMessageCount: 0,
    });

    currentStage = 'continue-d1';
    const maxInvocations = positiveInteger(
      baseEnv.MKT_META_K2_D1_MAX_DIRECT_INVOCATIONS,
      100,
    );
    const statuses = [];
    for (let index = 0; index < maxInvocations; index += 1) {
      const response = await invokeExactContinuation({
        url: recoveryUrl,
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
        'Bounded direct D1 continuation did not complete',
        'META_K2_DIRECT_D1_CONTINUATION_TIMEOUT',
        { invocationCount },
      );
    }
    await evidence.write('continue-d1', {
      invocationCount,
      statuses,
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
      url: recoveryUrl,
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
      const restored = await deploy(baseEnv, safePath, 'meta-k2-restore-after-d1');
      await evidence.write('restore-after-d1', {
        ...restored,
        mode: 'safe',
        expectedTrueFlags: [],
      });
      currentStage = 'verify-restore-after-d1';
      await verifyDeploymentFlags(baseEnv, safePath, restored.activeVersion, []);
      emergencyRestoreVerified = !completed;
      await evidence.write('verify-restore-after-d1', {
        activeVersion: restored.activeVersion,
        mode: 'safe',
        expectedTrueFlags: [],
        executionFlagsAllFalse: true,
      });
    }
    await rm(activePath, { force: true });
    await rm(safePath, { force: true });
  }
  return { invocationCount, finalSnapshot };
}

async function runLarkWindow(input) {
  const { baseEnv, safeConfigText, recoveryUrl, target, evidence } = input;
  const credentials = createEphemeralCredentials('lark', target.repositoryHead);
  const config = buildMetaK2ExactContinuationConfig(safeConfigText, target, {
    phase: 'lark',
    tokenSha256: credentials.tokenSha256,
    attestation: credentials.attestation,
  });
  const activePath = join(recoveryRoot, 'wrangler.meta-k2-lark.active.jsonc');
  const safePath = join(recoveryRoot, 'wrangler.meta-k2.safe-lark.jsonc');
  await writePrivateText(activePath, config.activeText);
  await writePrivateText(safePath, config.safeText);
  const snapshotBefore = await readLarkSnapshot(baseEnv, safePath, target);
  let activated = false;
  let completed = false;
  let invocationCount = 0;
  let finalSnapshot = null;
  try {
    currentStage = 'deploy-lark-continuation';
    const deployed = await deploy(baseEnv, activePath, 'meta-k2-exact-lark-continuation');
    activated = true;
    await evidence.write('deploy-lark-continuation', {
      ...deployed,
      configSha256: config.activeSha256,
      trueFlags: config.activeTrueFlags,
      queueMessageCount: 0,
    });

    currentStage = 'verify-lark-continuation';
    await verifyDeploymentFlags(baseEnv, activePath, deployed.activeVersion, config.activeTrueFlags);
    await evidence.write('verify-lark-continuation', {
      activeVersion: deployed.activeVersion,
      expectedTrueFlags: config.activeTrueFlags,
      routeAttestation: credentials.attestation,
      queueMessageCount: 0,
    });

    currentStage = 'continue-lark';
    const maxInvocations = positiveInteger(
      baseEnv.MKT_META_K2_LARK_MAX_DIRECT_INVOCATIONS,
      20,
    );
    const statuses = [];
    for (let index = 0; index < maxInvocations; index += 1) {
      const response = await invokeExactContinuation({
        url: recoveryUrl,
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
        'Bounded direct Lark continuation did not complete',
        'META_K2_DIRECT_LARK_CONTINUATION_TIMEOUT',
        { invocationCount },
      );
    }
    await evidence.write('continue-lark', {
      invocationCount,
      statuses,
      queueMessageCount: 0,
      queueOperationAttemptMutationCount: 0,
    });

    currentStage = 'verify-lark';
    const comparison = compareMetaK2DirectLarkSnapshots(
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
      url: recoveryUrl,
      token: credentials.token,
      attestation: credentials.attestation,
      activeVersion: deployed.activeVersion,
      phase: 'lark',
    });
    const rerunSnapshot = await readLarkSnapshot(baseEnv, activePath, target);
    const rerun = compareMetaK2DirectLarkSnapshots(
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
      const restored = await deploy(baseEnv, safePath, 'meta-k2-restore-after-lark');
      await evidence.write('restore-after-lark', {
        ...restored,
        mode: 'safe',
        expectedTrueFlags: [],
      });
      currentStage = 'verify-restore-after-lark';
      await verifyDeploymentFlags(baseEnv, safePath, restored.activeVersion, []);
      emergencyRestoreVerified = !completed;
      await evidence.write('verify-restore-after-lark', {
        activeVersion: restored.activeVersion,
        mode: 'safe',
        expectedTrueFlags: [],
        executionFlagsAllFalse: true,
      });
    }
    await rm(activePath, { force: true });
    await rm(safePath, { force: true });
  }
  return { invocationCount, finalSnapshot };
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
  return validateMetaK2ReviewedRepositoryState({
    branch,
    repositoryHead,
    reviewedHead,
    originReviewedHead,
    retainedHead: META_K2_RETAINED_OPERATION_HEAD,
    retainedHeadIsAncestor: gitSucceeds([
      'merge-base', '--is-ancestor', META_K2_RETAINED_OPERATION_HEAD, repositoryHead,
    ]),
    reviewBaseIsAncestor: gitSucceeds([
      'merge-base', '--is-ancestor', reviewBase, repositoryHead,
    ]) && gitSucceeds(['merge-base', '--is-ancestor', reviewBase, originMain]),
    clean: dirty.trim() === '',
  });
}

function verifyExactHeadCi(repositoryHead) {
  currentStage = 'exact-head-ci-attestation';
  requireExact(process.env.MKT_META_K2_EXACT_HEAD_CI, 'PASS', 'MKT_META_K2_EXACT_HEAD_CI');
  requireExact(
    process.env.MKT_META_K2_EXACT_HEAD_CI_SHA,
    repositoryHead,
    'MKT_META_K2_EXACT_HEAD_CI_SHA',
  );
}

function runLocalGates(env) {
  runVisible('npm', ['ci'], env);
  runVisible('npm', ['run', 'check'], env);
  runVisible(process.execPath, [
    '--test',
    'tests/application/meta-d1-only-rollout-operator.test.js',
    'tests/application/meta-d1-only-partial-staging-recovery.test.js',
    'tests/application/meta-k2-partial-staging-running.test.js',
    'tests/application/meta-d1-only-partial-staging-recovery-http.test.js',
    'tests/application/meta-ads-lark-scope.test.js',
    'tests/application/meta-k2-partial-staging-finalizer.test.js',
  ], env);
  runVisible('npm', ['test'], env);
  runVisible('npm', ['run', 'test:report-reliability'], env);
  runVisible('npm', ['audit', '--audit-level=high'], env);
  runVisible('npm', ['run', 'deploy:dry-run'], env);
}

async function preflightExactLark(env) {
  const contracts = expectedLarkContracts('meta_ads');
  const contractKeys = contracts.map((entry) => entry.tableKey);
  if (stableJson(contractKeys) !== stableJson(META_K2_EXACT_LARK_TABLE_KEYS)) {
    throw finalizerFailure(
      'Meta Ads Lark contract is not the exact Account/Campaign/AdSet/Ad scope',
      'META_K2_LARK_SCOPE_INVALID',
      { contractKeys },
    );
  }
  const tableIds = readLarkTableIdsFromEnv(env, META_K2_EXACT_LARK_TABLE_KEYS);
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
        'META_K2_LARK_PREFLIGHT_INCOMPLETE',
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
        'META_K2_LARK_PREFLIGHT_INCOMPLETE',
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
      },
      body: '{}',
      signal: controller.signal,
    });
    const value = await response.json().catch(() => null);
    if (!response.ok || !value) {
      throw finalizerFailure(
        `Meta exact continuation failed with HTTP ${response.status}`,
        'META_K2_DIRECT_CONTINUATION_HTTP_FAILED',
        { phase: input.phase, status: response.status },
      );
    }
    requireExact(
      response.headers.get(META_K2_EXACT_RECOVERY_ATTESTATION_HEADER),
      input.attestation,
      META_K2_EXACT_RECOVERY_ATTESTATION_HEADER,
    );
    requireExact(
      response.headers.get('x-mkt-worker-version-id'),
      input.activeVersion,
      'x-mkt-worker-version-id',
    );
    return validateMetaK2ContinuationHttpResponse(value, { phase: input.phase });
  } finally {
    clearTimeout(timer);
  }
}

function createEphemeralCredentials(phase, repositoryHead) {
  const token = randomBytes(48).toString('base64url');
  const tokenSha256 = sha256(token);
  const attestation = sha256(stableJson({
    contractVersion: META_K2_PARTIAL_STAGING_FINALIZER_CONTRACT_VERSION,
    repositoryHead,
    retainedOperationHead: META_K2_RETAINED_OPERATION_HEAD,
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
  const backupPath = join(recoveryRoot, 'meta-k2-before-recovery.sql');
  runText('npx', [
    'wrangler', 'd1', 'export', databaseBinding, '--remote',
    '--config', configPath, '--output', backupPath,
  ], env);
  await chmod(backupPath, 0o600);
  const bytes = await readFile(backupPath);
  if (bytes.length === 0) {
    throw finalizerFailure(
      'Meta K2 D1 backup is empty',
      'META_K2_PARTIAL_STAGING_BACKUP_EMPTY',
    );
  }
  return {
    backupFile: relative(repositoryRoot, backupPath),
    backupBytes: bytes.length,
    backupSha256: sha256(bytes),
    remoteMutationCount: 0,
  };
}

async function deploy(env, configPath, message) {
  runText('npx', [
    'wrangler', 'deploy', '--config', configPath,
    '--message', `${message} git=${gitText(['rev-parse', 'HEAD'])}`,
  ], env);
  const activeVersion = await readActiveVersion(env, configPath);
  return {
    activeVersion,
    repositoryHead: gitText(['rev-parse', 'HEAD']),
    commandExitCode: 0,
  };
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
      'Worker does not have exactly one 100% active version',
      'META_K2_ACTIVE_VERSION_INVALID',
    );
  }
  return active[0].version_id;
}

async function verifyDeploymentFlags(env, configPath, versionId, expectedTrueFlags) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', versionId,
    '--name', workerName, '--config', configPath, '--json',
  ], env));
  const observed = readEnabledFlags(value);
  if (stableJson(observed) !== stableJson([...expectedTrueFlags].sort())) {
    throw finalizerFailure(
      'Worker execution flags differ from the exact reviewed window',
      'META_K2_WORKER_FLAG_DRIFT',
      { observed, expected: expectedTrueFlags },
    );
  }
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
      'Meta K2 initial Reliability boundary is not exact and idle',
      'META_K2_INITIAL_RELIABILITY_DRIFT',
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
      'Meta K2 final Reliability boundary is not idle',
      'META_K2_FINAL_RELIABILITY_DRIFT',
      value,
    );
  }
}

function assertExactQueueAttempts(snapshot) {
  if (snapshot.queueOperationAttempts !== EXACT.queueOperationAttempts
    || snapshot.mainQueueAttempts !== EXACT.mainQueueAttempts) {
    throw finalizerFailure(
      'Meta K2 direct continuation changed Queue attempts',
      'META_K2_DIRECT_CONTINUATION_QUEUE_DRIFT',
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
      'META_K2_D1_QUERY_EMPTY',
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
      const evidence = createMetaK2RecoveryEvidence({
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
        'Exact Meta K2 recovery evidence already exists; automatic rerun is blocked',
        'META_K2_RECOVERY_ALREADY_ATTEMPTED',
      );
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function requireRecoveryUrl(value) {
  const url = new URL(requireText(value, 'MKT_META_K2_EXACT_RECOVERY_URL'));
  if (url.protocol !== 'https:' || url.pathname !== META_K2_EXACT_RECOVERY_PATH) {
    throw finalizerFailure(
      'MKT_META_K2_EXACT_RECOVERY_URL must be the exact HTTPS recovery route',
      'META_K2_RECOVERY_URL_INVALID',
    );
  }
  return url.toString();
}

async function resolveRepositoryFile(value, fieldName) {
  const input = requireText(value, fieldName);
  const path = resolve(repositoryRoot, input);
  const canonical = await realpath(path);
  if (canonical !== repositoryRoot && !canonical.startsWith(`${repositoryRoot}/`)) {
    throw finalizerFailure(
      `${fieldName} must resolve inside the Repository`,
      'META_K2_PATH_INVALID',
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
      'META_K2_PRIVATE_FILE_INVALID',
      { fieldName },
    );
  }
}

async function assertRegularFile(path, fieldName) {
  const value = await stat(path);
  if (!value.isFile()) {
    throw finalizerFailure(
      `${fieldName} must be a regular file`,
      'META_K2_FILE_INVALID',
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
      'META_K2_LOCAL_GATE_FAILED',
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
      'META_K2_COMMAND_FAILED',
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
      'Meta K2 invocation limit must be a positive integer',
      'META_K2_INVOCATION_LIMIT_INVALID',
    );
  }
  return number;
}

function requireFullSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw finalizerFailure(`${fieldName} must be a full SHA`, 'META_K2_INPUT_INVALID');
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw finalizerFailure(`${fieldName} is required`, 'META_K2_INPUT_INVALID');
  }
  return value.trim();
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw finalizerFailure(
      `${fieldName} does not match the exact reviewed value`,
      'META_K2_EXACT_VALUE_MISMATCH',
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
    return /token|secret|authorization|password|cookie/iu.test(key) ? '[REDACTED]' : value;
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
  error.name = 'MetaK2PartialStagingFinalizerError';
  error.code = code;
  error.details = details;
  return error;
}
