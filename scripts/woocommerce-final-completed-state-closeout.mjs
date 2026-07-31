#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import {
  buildWooCommerceConfigWindows,
  buildWooCommerceFinalJob,
  buildWooCommerceFinalSnapshotSql,
  buildWooCommerceWatermarkSql,
  compareWooCommerceParity,
  listWooCommerceTableBindings,
} from './lib/woocommerce-final-rollout-operator.js';
import {
  classifyWooCommercePendingMigrations,
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
  resolveWooCommerceQueueId,
} from './lib/woocommerce-final-one-command.js';
import {
  assertWooCommerce2026RemoteSafeFlags,
  collectEnabledMktFlags,
  selectExactlyOneActiveWorkerVersion,
} from './lib/woocommerce-2026-completion-one-command.js';
import {
  assertWooCommerceQueueConsumerTopology,
} from './lib/woocommerce-queue-consumer-topology.js';
import {
  WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONFIRMATION,
  WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONTRACT_VERSION,
  WOOCOMMERCE_COMPLETED_STATE_HISTORY_START,
  WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
  assertWooCommerceCompletedStateCloseoutConfirmation,
  classifyWooCommerceCompletedStatePoll,
  compareWooCommerceCompletedStateReplay,
  parseWooCommerceCompletedStateCloseoutArgs,
  sanitizeWooCommerceCompletedStateEvidence,
  selectWooCommerceCompletedState,
  validateWooCommerceCompletedStateLarkTables,
  validateWooCommerceCompletedStateRemotePreflight,
} from './lib/woocommerce-final-completed-state-closeout.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_WOOCOMMERCE_COMPLETED_STATE_EVIDENCE_DIR
    ?? 'outputs/woocommerce-completed-state-closeout-v1',
);
const REQUIRED_SECRET_NAMES = Object.freeze([
  'WOOCOMMERCE_CONSUMER_KEY',
  'WOOCOMMERCE_CONSUMER_SECRET',
  'LARK_APP_SECRET',
]);
const D1_READ_DELAYS_MS = Object.freeze([0, 1_000, 2_000, 5_000, 10_000]);
const VERIFY_INTERVAL_MS = 5_000;
const VERIFY_MAX_POLLS = 2_160;
const REPLAY_CHECKPOINT = '05-idempotent-replay';
const INCREMENTAL_CHECKPOINT = '06-incremental-uat';
let target = null;
let latestSafeConfig = null;
let currentStage = 'init';

try {
  const options = parseWooCommerceCompletedStateCloseoutArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeCloseout();
} catch (error) {
  let automaticSafeRestore = null;
  if (latestSafeConfig && target) {
    try {
      automaticSafeRestore = await deployAndVerify(
        latestSafeConfig,
        [],
        'automatic-safe-restore',
      );
    } catch (restoreError) {
      automaticSafeRestore = Object.freeze({
        ok: false,
        code: restoreError?.code ?? 'WOOCOMMERCE_COMPLETED_STATE_RESTORE_FAILED',
        message: restoreError instanceof Error
          ? restoreError.message
          : String(restoreError),
      });
    }
  }
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeWooCommerceCompletedStateEvidence(error?.details ?? {}),
    automaticSafeRestore,
    metaExecutionCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONTRACT_VERSION,
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    requiredEntry: 'scripts/woocommerce-final-completed-state-closeout-launcher.mjs',
    confirmation: {
      envName: 'CONFIRM_WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT',
      value: WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONFIRMATION,
    },
    stages: [
      'local-and-remote-readiness',
      'exact-completed-state-admission',
      'fresh-d1-backup',
      'manual-uat-window',
      'd1-lark-parity',
      'same-completed-operation-idempotent-replay',
      'incremental-uat',
      'all-false-safe-closeout',
      'zero-active-reliability-verification',
    ],
    safety: {
      exactHeadEvidence: true,
      replacementFullOperation: false,
      initialFullQueueMessage: false,
      orphanRecoveryRepeated: false,
      businessFactDelete: false,
      directD1Mutation: false,
      directLarkMutation: false,
      queueAcceptedWithoutCheckpointResend: false,
      scheduleEnabled: false,
      metaStarted: false,
      production: false,
    },
  }, null, 2)}\n`);
}

async function executeCloseout() {
  const env = Object.freeze({
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  });
  assertWooCommerceCompletedStateCloseoutConfirmation(env);
  requireExact(
    env.MKT_WOOCOMMERCE_COMPLETED_STATE_PUBLIC_LAUNCHER,
    '1',
    'MKT_WOOCOMMERCE_COMPLETED_STATE_PUBLIC_LAUNCHER',
  );
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  currentStage = 'repository-and-local-verification';
  await assertRepositoryState();
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await runLocalVerification();
  await assertRepositoryState();

  const configPath = resolveRepositoryFile(
    env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const configText = await readFile(configPath, 'utf8');
  const parsedConfig = parseJsoncObject(configText);
  const runtimeConfig = Object.freeze({ ...(parsedConfig.vars ?? {}), ...env });
  const databaseName = env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME
    ?? 'social-mkt-state-dev';
  const workerName = env.MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME
    ?? 'social-mkt-sync-worker';
  const mainQueueName = env.MKT_MAIN_QUEUE_NAME ?? 'social-mkt-sync-jobs';
  const dlqName = env.MKT_DLQ_QUEUE_NAME ?? 'social-mkt-sync-dlq';
  const baseWranglerEnv = compactCloudflareEnv(env);
  const whoamiOutput = await wranglerText(['whoami', '--json'], {
    env: baseWranglerEnv,
  });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    configText,
    whoamiOutput,
    preferredAccount: env.MKT_WOOCOMMERCE_ROLLOUT_ACCOUNT,
  });
  const selectedEnv = Object.freeze({
    ...baseWranglerEnv,
    CLOUDFLARE_ACCOUNT_ID: accountId,
  });
  await wranglerText(['whoami', '--account', accountId, '--json'], {
    env: selectedEnv,
  });
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: env.CLOUDFLARE_API_TOKEN,
    authOutput: optionalText(env.CLOUDFLARE_API_TOKEN)
      ? null
      : await wranglerText(['auth', 'token', '--json'], { env: selectedEnv }),
  });
  const authenticatedEnv = Object.freeze({
    ...selectedEnv,
    CLOUDFLARE_API_TOKEN: auth.token,
  });
  const queueId = env.MKT_WOOCOMMERCE_FINAL_QUEUE_ID
    ?? resolveWooCommerceQueueId(
      await wranglerText(['queues', 'list', '--json'], { env: authenticatedEnv }),
      mainQueueName,
    );

  target = Object.freeze({
    env: authenticatedEnv,
    runtimeConfig,
    configPath,
    configText,
    databaseName,
    workerName,
    mainQueueName,
    dlqName,
    accountId,
    queueId,
    repositoryHead: await gitText(['rev-parse', 'HEAD']),
    accountKey: 'chemistry_k',
    orderHistoryStart: Date.parse(WOOCOMMERCE_COMPLETED_STATE_HISTORY_START),
  });
  assertEvidenceHeadBinding(target.repositoryHead);

  currentStage = 'local-and-remote-readiness';
  const readiness = await readRemoteReadiness();
  validateWooCommerceCompletedStateRemotePreflight(readiness.state);
  const safeBefore = assertWooCommerce2026RemoteSafeFlags(readiness.versionView);
  const missingSecrets = REQUIRED_SECRET_NAMES.filter(
    (name) => !readiness.secretNames.includes(name),
  );
  if (missingSecrets.length > 0) {
    throw closeoutError(
      'WooCommerce completed-state closeout is missing required Worker Secret names',
      'WOOCOMMERCE_COMPLETED_STATE_SECRET_MISSING',
      { missingSecrets },
    );
  }
  const migrationState = classifyWooCommercePendingMigrations(readiness.migrations);
  if (migrationState.migration0017Pending) {
    throw closeoutError(
      'WooCommerce Migration 0017 must already be applied',
      'WOOCOMMERCE_COMPLETED_STATE_MIGRATION_PENDING',
      { pending: migrationState.pending },
    );
  }

  currentStage = 'exact-completed-state-admission';
  const completedBefore = selectWooCommerceCompletedState({
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    snapshot: await readSnapshot(WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID),
    fullReconciliation: true,
    requireCurrentSourceParity: true,
  });
  const lark = createLarkBitableClientFromEnv(env);
  const tableIds = validateWooCommerceCompletedStateLarkTables({
    env: runtimeConfig,
    liveTables: await lark.listTables(),
  });
  await writeEvidence('01-completed-state-preflight', {
    operationId: completedBefore.operationId,
    requestedAt: completedBefore.requestedAt,
    priorQueueAttempts: completedBefore.priorQueueAttempts,
    completionFingerprint: completedBefore.completionFingerprint,
    datasetSummary: completedBefore.datasetSummary,
    workerAllFalse: safeBefore.allFalse,
    activeWorkerVersion: readiness.activeVersion,
    remoteMutationCount: 0,
  });

  const windows = buildWooCommerceConfigWindows({ configText, tableIds });
  assertExactFlags(windows.safeTrueFlags, []);
  assertExactFlags(windows.uatTrueFlags, [
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED',
    'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
  ]);
  assertExactFlags(windows.closeoutTrueFlags, []);

  currentStage = 'fresh-d1-backup';
  const backup = await backupD1();
  await writeEvidence('02-d1-backup', backup);
  latestSafeConfig = windows.safe;

  currentStage = 'manual-uat-window';
  const uatDeployment = await deployAndVerify(
    windows.uat,
    windows.uatTrueFlags,
    'completed-state-manual-uat',
  );
  await writeEvidence('03-uat-deployment', uatDeployment);

  currentStage = 'd1-lark-parity';
  const parity = await verifyParity(lark, tableIds, completedBefore.snapshot.counts);
  await writeEvidence('04-d1-lark-parity', parity);

  currentStage = 'same-completed-operation-idempotent-replay';
  const replay = await ensureIdempotentReplay({
    lark,
    tableIds,
    completedBefore,
  });

  currentStage = 'incremental-uat';
  const incremental = await ensureIncrementalUat({ lark, tableIds });

  currentStage = 'all-false-safe-closeout';
  const safeCloseout = await deployAndVerify(
    windows.closeout,
    windows.closeoutTrueFlags,
    'completed-state-safe-closeout',
  );
  latestSafeConfig = null;
  await writeEvidence('07-safe-closeout', safeCloseout);

  currentStage = 'zero-active-reliability-verification';
  const finalReadiness = await readRemoteReadiness();
  const finalRemote = validateWooCommerceCompletedStateRemotePreflight(
    finalReadiness.state,
  );
  const finalSafe = assertWooCommerce2026RemoteSafeFlags(
    finalReadiness.versionView,
  );
  const finalCompleted = selectWooCommerceCompletedState({
    operationId: completedBefore.operationId,
    snapshot: await readSnapshot(completedBefore.operationId),
    fullReconciliation: true,
    requireCurrentSourceParity: false,
  });
  if (finalCompleted.completionFingerprint !== completedBefore.completionFingerprint) {
    throw closeoutError(
      'WooCommerce original Full completion changed during closeout',
      'WOOCOMMERCE_COMPLETED_STATE_FINAL_FINGERPRINT_DRIFT',
    );
  }

  currentStage = 'final-summary';
  const summary = Object.freeze({
    accepted: true,
    decision: 'WOOCOMMERCE_2026_COMPLETED_SAFE',
    closeoutDecision: 'WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE',
    contractVersion: WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONTRACT_VERSION,
    repositoryHead: target.repositoryHead,
    workerVersion: safeCloseout.activeVersion,
    d1Backup: backup,
    fullReconciliation: Object.freeze({
      operationId: completedBefore.operationId,
      requestedAt: completedBefore.requestedAt,
      reusedCompletedOperation: true,
      initialFullQueueMessageSent: false,
      completionFingerprint: completedBefore.completionFingerprint,
      totalRows: sumCounts(completedBefore.snapshot.counts),
    }),
    orderHistoryWindow: Object.freeze({
      start: WOOCOMMERCE_COMPLETED_STATE_HISTORY_START,
      end: new Date(completedBefore.requestedAt).toISOString(),
      scopeMode: 'report_range',
    }),
    parityVerified: true,
    idempotentRerunVerified: replay.verified,
    idempotentRerunReusedCheckpoint: replay.reusedCheckpoint,
    incrementalVerified: incremental.verified,
    incrementalReusedCheckpoint: incremental.reusedCheckpoint,
    executionFlagsAllFalse: finalSafe.allFalse,
    scheduleEnabled: false,
    production: false,
    remote: finalRemote,
    safety: Object.freeze({
      replacementFullOperation: false,
      orphanRecoveryRepeated: false,
      businessFactDelete: false,
      manualD1OrLarkEditing: false,
      queueAcceptedWithoutCheckpointResend: false,
      metaExecutionCount: 0,
    }),
    nextStep: 'resume_pinned_meta_finalizer',
  });
  await writeEvidence('08-summary', summary);
  await writePrivateJson(join(outputRoot, '11-summary.json'), summary);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    ...summary,
    evidenceRoot: relative(repositoryRoot, outputRoot),
    WooCommerce: 'WOOCOMMERCE_2026_COMPLETED_SAFE',
    ExactCompletedStateCloseout: true,
    marker: 'WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE',
  }, null, 2)}\n`);
}

async function ensureIdempotentReplay(input) {
  const checkpoint = await readEvidenceData(REPLAY_CHECKPOINT);
  if (checkpoint) {
    assertCheckpointHead(checkpoint);
    requireExact(
      checkpoint.operationId,
      input.completedBefore.operationId,
      'replayCheckpoint.operationId',
    );
    requireExact(
      checkpoint.completionFingerprint,
      input.completedBefore.completionFingerprint,
      'replayCheckpoint.completionFingerprint',
    );
    const minimumQueueAttempts = requirePositiveInteger(
      checkpoint.minimumQueueAttempts,
      'replayCheckpoint.minimumQueueAttempts',
    );
    const current = selectWooCommerceCompletedState({
      operationId: input.completedBefore.operationId,
      snapshot: await readSnapshot(input.completedBefore.operationId),
      fullReconciliation: true,
      requireCurrentSourceParity: false,
    });
    if (current.priorQueueAttempts < minimumQueueAttempts
      || current.completionFingerprint !== checkpoint.completionFingerprint) {
      throw closeoutError(
        'WooCommerce replay checkpoint no longer matches durable state',
        'WOOCOMMERCE_COMPLETED_STATE_REPLAY_CHECKPOINT_INVALID',
        {
          currentQueueAttempts: current.priorQueueAttempts,
          minimumQueueAttempts,
          completionFingerprintMatches:
            current.completionFingerprint === checkpoint.completionFingerprint,
        },
      );
    }
    const parity = await verifyParity(input.lark, input.tableIds, current.snapshot.counts);
    return Object.freeze({
      verified: true,
      reusedCheckpoint: true,
      minimumQueueAttempts,
      parity,
    });
  }

  const minimumQueueAttempts = input.completedBefore.priorQueueAttempts + 1;
  const job = buildWooCommerceFinalJob({
    operationId: input.completedBefore.operationId,
    requestedAt: input.completedBefore.requestedAt,
    trigger: 'manual_uat',
    fullReconciliation: true,
    orderCreatedAfter: target.orderHistoryStart,
    orderCreatedBefore: input.completedBefore.requestedAt,
  });
  const send = await sendQueueMessage(job, {
    attemptKey: `${input.completedBefore.operationId}:completed-state-replay`,
    operationId: input.completedBefore.operationId,
    minimumQueueAttempts,
  });
  if (send.reusedEvidence) {
    throw closeoutError(
      'WooCommerce replay Queue acceptance exists without a verified stage checkpoint',
      'WOOCOMMERCE_COMPLETED_STATE_QUEUE_ACCEPTED_REVIEW_REQUIRED',
      { stage: REPLAY_CHECKPOINT, operationId: input.completedBefore.operationId },
    );
  }
  const after = await pollCompletedState({
    operationId: input.completedBefore.operationId,
    fullReconciliation: true,
    requireCurrentSourceParity: true,
    minimumQueueAttempts,
  });
  const replay = compareWooCommerceCompletedStateReplay(
    {
      operationId: input.completedBefore.operationId,
      snapshot: input.completedBefore.snapshot,
      fullReconciliation: true,
      requireCurrentSourceParity: true,
    },
    {
      operationId: input.completedBefore.operationId,
      snapshot: after.snapshot,
      fullReconciliation: true,
      requireCurrentSourceParity: true,
    },
  );
  const parity = await verifyParity(input.lark, input.tableIds, after.snapshot.counts);
  await writeEvidence(REPLAY_CHECKPOINT, {
    accepted: true,
    repositoryHead: target.repositoryHead,
    operationId: input.completedBefore.operationId,
    minimumQueueAttempts,
    completionFingerprint: input.completedBefore.completionFingerprint,
    businessCountsFingerprint: fingerprint(after.snapshot.counts),
    coverageRunCount: after.snapshot.coverageRunCount,
    invalidCoverageCount: after.snapshot.invalidCoverageCount,
    replay,
    parity,
  });
  return Object.freeze({
    verified: true,
    reusedCheckpoint: false,
    minimumQueueAttempts,
    parity,
  });
}

async function ensureIncrementalUat(input) {
  const checkpoint = await readEvidenceData(INCREMENTAL_CHECKPOINT);
  if (checkpoint) {
    assertCheckpointHead(checkpoint);
    const operationId = requireOperationId(checkpoint.operationId);
    const minimumQueueAttempts = requirePositiveInteger(
      checkpoint.minimumQueueAttempts,
      'incrementalCheckpoint.minimumQueueAttempts',
    );
    const current = selectWooCommerceCompletedState({
      operationId,
      snapshot: await readSnapshot(operationId),
      fullReconciliation: false,
      requireCurrentSourceParity: false,
    });
    if (current.priorQueueAttempts < minimumQueueAttempts
      || current.completionFingerprint !== checkpoint.completionFingerprint) {
      throw closeoutError(
        'WooCommerce Incremental checkpoint no longer matches durable state',
        'WOOCOMMERCE_COMPLETED_STATE_INCREMENTAL_CHECKPOINT_INVALID',
        {
          operationId,
          currentQueueAttempts: current.priorQueueAttempts,
          minimumQueueAttempts,
          completionFingerprintMatches:
            current.completionFingerprint === checkpoint.completionFingerprint,
        },
      );
    }
    const parity = await verifyParity(input.lark, input.tableIds, current.snapshot.counts);
    return Object.freeze({
      verified: true,
      reusedCheckpoint: true,
      operationId,
      parity,
    });
  }

  const currentWatermark = await readWatermark();
  const operation = await readOrCreateIncrementalOperation(currentWatermark);
  const job = buildWooCommerceFinalJob({
    operationId: operation.operationId,
    requestedAt: operation.requestedAt,
    trigger: 'manual_uat',
    fullReconciliation: false,
    modifiedAfter: operation.modifiedAfter,
    orderCreatedAfter: target.orderHistoryStart,
    orderCreatedBefore: operation.requestedAt,
  });
  const send = await sendQueueMessage(job, {
    attemptKey: `${operation.operationId}:incremental-uat`,
    operationId: operation.operationId,
    minimumQueueAttempts: operation.minimumQueueAttempts,
  });
  if (send.reusedEvidence) {
    throw closeoutError(
      'WooCommerce Incremental Queue acceptance exists without a verified stage checkpoint',
      'WOOCOMMERCE_COMPLETED_STATE_QUEUE_ACCEPTED_REVIEW_REQUIRED',
      { stage: INCREMENTAL_CHECKPOINT, operationId: operation.operationId },
    );
  }
  const completed = await pollCompletedState({
    operationId: operation.operationId,
    fullReconciliation: false,
    requireCurrentSourceParity: false,
    minimumQueueAttempts: operation.minimumQueueAttempts,
  });
  const parity = await verifyParity(input.lark, input.tableIds, completed.snapshot.counts);
  await writeEvidence(INCREMENTAL_CHECKPOINT, {
    accepted: true,
    repositoryHead: target.repositoryHead,
    operationId: operation.operationId,
    requestedAt: operation.requestedAt,
    modifiedAfter: operation.modifiedAfter,
    minimumQueueAttempts: operation.minimumQueueAttempts,
    completionFingerprint: completed.completionFingerprint,
    parity,
  });
  return Object.freeze({
    verified: true,
    reusedCheckpoint: false,
    operationId: operation.operationId,
    parity,
  });
}

async function runLocalVerification() {
  const steps = [
    ['npm', ['ci']],
    ['npm', ['run', 'check']],
    ['node', [
      '--test',
      'tests/application/woocommerce-final-completed-state-closeout.test.js',
      'tests/application/woocommerce-final-completed-state-launcher.test.js',
      'tests/application/woocommerce-final-rollout-operator.test.js',
      'tests/application/woocommerce-runtime-wiring.test.js',
    ]],
    ['npm', ['test']],
    ['npm', ['run', 'test:report-reliability']],
    ['npm', ['audit', '--audit-level=high']],
    ['npm', ['run', 'deploy:dry-run']],
  ];
  for (const [commandName, args] of steps) {
    await command(commandName, args, { timeout: 900_000 });
  }
}

async function assertRepositoryState() {
  await gitText(['fetch', 'origin', 'main', '--quiet']);
  const branch = await gitText(['branch', '--show-current']);
  const head = await gitText(['rev-parse', 'HEAD']);
  const originMain = await gitText(['rev-parse', 'origin/main']);
  const status = await gitText(['status', '--porcelain', '--untracked-files=all']);
  if (branch !== 'main' || head !== originMain || status.trim() !== '') {
    throw closeoutError(
      'WooCommerce completed-state closeout requires clean current main',
      'WOOCOMMERCE_COMPLETED_STATE_REPOSITORY_INVALID',
      {
        branch,
        headMatchesOriginMain: head === originMain,
        workingTreeClean: status.trim() === '',
      },
    );
  }
}

function assertEvidenceHeadBinding(repositoryHead) {
  const relativeOutput = relative(repositoryRoot, outputRoot).split('\\').join('/');
  if (!relativeOutput.split('/').includes(repositoryHead)) {
    throw closeoutError(
      'WooCommerce completed-state evidence directory is not bound to exact Repository Head',
      'WOOCOMMERCE_COMPLETED_STATE_EVIDENCE_HEAD_MISMATCH',
      { repositoryHead },
    );
  }
}

async function readRemoteReadiness() {
  const [deploymentRaw, migrations, secretsRaw, state] = await Promise.all([
    wranglerJson([
      'deployments', 'status',
      '--name', target.workerName,
      '--config', target.configPath,
      '--json',
    ]),
    wranglerText([
      'd1', 'migrations', 'list', target.databaseName,
      '--remote', '--config', target.configPath,
    ]),
    wranglerJson([
      'secret', 'list',
      '--name', target.workerName,
      '--config', target.configPath,
      '--format', 'json',
    ]),
    readD1Row(buildRemoteReadinessSql()),
  ]);
  const deployment = Array.isArray(deploymentRaw) ? deploymentRaw[0] : deploymentRaw;
  const activeVersion = selectExactlyOneActiveWorkerVersion(deployment);
  const versionView = await wranglerJson([
    'versions', 'view', activeVersion,
    '--name', target.workerName,
    '--config', target.configPath,
    '--json',
  ]);
  return Object.freeze({
    activeVersion,
    versionView,
    migrations,
    secretNames: parseSecretNames(secretsRaw),
    state,
  });
}

function buildRemoteReadinessSql() {
  const historyStart = Date.parse(WOOCOMMERCE_COMPLETED_STATE_HISTORY_START);
  return `SELECT
    (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status='active') AS active_work,
    (SELECT COUNT(*) FROM sync_locks
      WHERE expires_at > unixepoch('now') * 1000) AS active_locks,
    (SELECT COUNT(DISTINCT q.operation_id)
      FROM queue_operation_attempts q
      JOIN sync_work_runs w ON w.work_key=q.work_key
      WHERE w.lifecycle_status='active') AS active_queue_operations,
    (SELECT COUNT(*) FROM raw_commerce_order_items
      WHERE account_key='chemistry_k' AND raw_order_key IN (
        SELECT raw_order_key FROM raw_commerce_orders
        WHERE account_key='chemistry_k' AND source_created_at < ${historyStart}
      )) AS old_raw_order_items,
    (SELECT COUNT(*) FROM raw_commerce_refunds
      WHERE account_key='chemistry_k' AND raw_order_key IN (
        SELECT raw_order_key FROM raw_commerce_orders
        WHERE account_key='chemistry_k' AND source_created_at < ${historyStart}
      )) AS old_raw_refunds,
    (SELECT COUNT(*) FROM raw_commerce_orders
      WHERE account_key='chemistry_k' AND source_created_at < ${historyStart}) AS old_raw_orders,
    (SELECT COUNT(*) FROM commerce_order_status_observations
      WHERE account_key='chemistry_k' AND order_key IN (
        SELECT order_key FROM commerce_order_state
        WHERE account_key='chemistry_k' AND source_created_at < ${historyStart}
      )) AS old_order_status_observations,
    (SELECT COUNT(*) FROM commerce_order_line_facts
      WHERE account_key='chemistry_k' AND order_key IN (
        SELECT order_key FROM commerce_order_state
        WHERE account_key='chemistry_k' AND source_created_at < ${historyStart}
      )) AS old_order_line_facts,
    (SELECT COUNT(*) FROM commerce_order_state
      WHERE account_key='chemistry_k' AND source_created_at < ${historyStart}) AS old_order_state,
    (SELECT COUNT(*) FROM commerce_daily_sales_facts
      WHERE account_key='chemistry_k' AND metric_date < '2026-01-01') AS old_daily,
    (SELECT COUNT(*) FROM commerce_product_daily_facts
      WHERE account_key='chemistry_k' AND metric_date < '2026-01-01') AS old_product_daily;`;
}

async function readSnapshot(operationId) {
  return readD1Row(buildWooCommerceFinalSnapshotSql({
    accountKey: target.accountKey,
    operationId,
  }));
}

async function pollCompletedState(input) {
  for (let poll = 0; poll < VERIFY_MAX_POLLS; poll += 1) {
    const snapshot = await readSnapshot(input.operationId);
    const classification = classifyWooCommerceCompletedStatePoll({
      ...input,
      snapshot,
    });
    if (classification.complete) return classification.selected;
    if (classification.terminalFailure) {
      throw closeoutError(
        'WooCommerce closeout operation reached permanent terminal failure',
        'WOOCOMMERCE_COMPLETED_STATE_OPERATION_TERMINAL_FAILURE',
        {
          operationId: input.operationId,
          syncRunStatus: classification.snapshot.syncRunStatus,
          syncRunErrorCode: classification.snapshot.syncRunErrorCode,
          queueOperationAttempts: classification.snapshot.queueOperationAttempts,
        },
      );
    }
    if (poll + 1 < VERIFY_MAX_POLLS) await sleep(VERIFY_INTERVAL_MS);
  }
  throw closeoutError(
    'WooCommerce completed-state operation exceeded bounded verification',
    'WOOCOMMERCE_COMPLETED_STATE_VERIFY_TIMEOUT',
    { operationId: input.operationId },
  );
}

async function verifyParity(client, tableIds, d1Counts) {
  const larkCounts = {};
  for (const binding of listWooCommerceTableBindings()) {
    const records = await client.listRecords({
      tableId: tableIds[binding.tableKey],
      pageSize: 500,
    });
    larkCounts[binding.tableKey] = records.filter(
      (record) => normalizeLarkScalar(record.fields?.account_key) === target.accountKey,
    ).length;
  }
  return compareWooCommerceParity({ d1Counts, larkCounts });
}

async function readWatermark() {
  const row = await readD1Row(buildWooCommerceWatermarkSql(target.accountKey));
  const order = Number(row.order_watermark);
  const product = Number(row.product_watermark);
  if (!Number.isSafeInteger(order) || !Number.isSafeInteger(product)) {
    throw closeoutError(
      'WooCommerce incremental watermark is unavailable',
      'WOOCOMMERCE_COMPLETED_STATE_WATERMARK_MISSING',
      {
        orderWatermarkAvailable: Number.isSafeInteger(order),
        productWatermarkAvailable: Number.isSafeInteger(product),
      },
    );
  }
  return Math.min(order, product);
}

async function readOrCreateIncrementalOperation(currentWatermark) {
  const path = join(outputRoot, 'incremental-operation.json');
  const existing = await readJsonIfExists(path);
  if (existing) {
    assertCheckpointHead(existing);
    return Object.freeze({
      operationId: requireOperationId(existing.operationId),
      requestedAt: requireTimestamp(existing.requestedAt, 'incremental.requestedAt'),
      modifiedAfter: requireTimestamp(existing.modifiedAfter, 'incremental.modifiedAfter'),
      minimumQueueAttempts: requirePositiveInteger(
        existing.minimumQueueAttempts,
        'incremental.minimumQueueAttempts',
      ),
    });
  }
  const requestedAt = Date.now();
  const suffix = createHash('sha256')
    .update(`${target.repositoryHead}:completed-state-incremental:${requestedAt}`)
    .digest('hex')
    .slice(0, 12);
  const operation = Object.freeze({
    repositoryHead: target.repositoryHead,
    operationId: `woo-final-incremental-${suffix}`,
    requestedAt,
    modifiedAfter: requireTimestamp(currentWatermark, 'currentWatermark'),
    minimumQueueAttempts: 1,
  });
  await writePrivateJson(path, operation);
  return operation;
}

async function sendQueueMessage(job, options = {}) {
  const attemptKey = requireText(options.attemptKey, 'attemptKey');
  const operationId = requireOperationId(options.operationId);
  const minimumQueueAttempts = requirePositiveInteger(
    options.minimumQueueAttempts,
    'minimumQueueAttempts',
  );
  const jobSha256 = fingerprint(job);
  const path = join(outputRoot, 'queue-attempts', `${safeFile(attemptKey)}.json`);
  const existing = await readJsonIfExists(path);
  if (existing) {
    assertCheckpointHead(existing);
    const matches = existing.attemptKey === attemptKey
      && existing.operationId === operationId
      && Number(existing.minimumQueueAttempts) === minimumQueueAttempts
      && existing.jobSha256 === jobSha256;
    if (!matches) {
      throw closeoutError(
        'WooCommerce Queue attempt evidence differs from the current exact job',
        'WOOCOMMERCE_COMPLETED_STATE_QUEUE_EVIDENCE_DRIFT',
        { attemptKey, operationId },
      );
    }
    if (existing.accepted !== true) {
      throw closeoutError(
        'A prior Queue attempt was recorded without verified acceptance; blind resend is blocked',
        'WOOCOMMERCE_COMPLETED_STATE_QUEUE_ATTEMPT_UNCERTAIN',
        { attemptKey, operationId },
      );
    }
    return Object.freeze({
      accepted: true,
      reusedEvidence: true,
      minimumQueueAttempts,
      jobSha256,
    });
  }
  const evidence = {
    repositoryHead: target.repositoryHead,
    attemptKey,
    operationId,
    accepted: false,
    minimumQueueAttempts,
    jobSha256,
    attemptedAt: new Date().toISOString(),
  };
  await writePrivateJson(path, evidence);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.accountId)}/queues/${encodeURIComponent(target.queueId)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${target.env.CLOUDFLARE_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body: job, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw closeoutError(
      `Cloudflare Queue rejected WooCommerce closeout operation (HTTP ${response.status})`,
      'WOOCOMMERCE_COMPLETED_STATE_QUEUE_SEND_FAILED',
      { operationId },
    );
  }
  const accepted = Object.freeze({ ...evidence, accepted: true });
  await writePrivateJson(path, accepted);
  return Object.freeze({
    accepted: true,
    reusedEvidence: false,
    minimumQueueAttempts,
    jobSha256,
  });
}

async function backupD1() {
  const directory = join(outputRoot, 'backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(
    directory,
    `social-mkt-state-dev-before-completed-state-${Date.now()}.sql`,
  );
  await wranglerText([
    'd1', 'export', target.databaseName,
    '--remote', '--config', target.configPath,
    '--output', path, '--skip-confirmation',
  ], { timeout: 600_000 });
  await chmod(path, 0o600);
  const bytes = await readFile(path);
  if (bytes.length === 0) {
    throw closeoutError(
      'WooCommerce completed-state D1 backup is empty',
      'WOOCOMMERCE_COMPLETED_STATE_BACKUP_EMPTY',
    );
  }
  return Object.freeze({
    file: relative(repositoryRoot, path),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

async function deployAndVerify(configText, expectedTrueFlags, label) {
  await withGeneratedConfig(configText, async (configPath) => {
    await wranglerText([
      'deploy', '--config', configPath,
      '--message', `${WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONTRACT_VERSION} stage=${label} git=${target.repositoryHead}`,
    ], { timeout: 600_000 });
  });
  const deploymentRaw = await wranglerJson([
    'deployments', 'status',
    '--name', target.workerName,
    '--config', target.configPath,
    '--json',
  ]);
  const deployment = Array.isArray(deploymentRaw) ? deploymentRaw[0] : deploymentRaw;
  const activeVersion = selectExactlyOneActiveWorkerVersion(deployment);
  const versionView = await wranglerJson([
    'versions', 'view', activeVersion,
    '--name', target.workerName,
    '--config', target.configPath,
    '--json',
  ]);
  const observedTrueFlags = collectEnabledMktFlags(versionView);
  assertExactFlags(observedTrueFlags, expectedTrueFlags);
  if (expectedTrueFlags.length === 0) {
    assertWooCommerce2026RemoteSafeFlags(versionView);
  }
  const [mainConsumersRaw, dlqConsumersRaw] = await Promise.all([
    wranglerJson(['queues', 'consumer', 'list', target.mainQueueName, '--json']),
    wranglerJson(['queues', 'consumer', 'list', target.dlqName, '--json']),
  ]);
  assertWooCommerceQueueConsumerTopology(
    consumerEntries(mainConsumersRaw),
    target.mainQueueName,
    {
      maxConcurrency: 1,
      maxBatchSize: 10,
      maxBatchTimeout: 30,
      maxRetries: 5,
      deadLetterQueue: target.dlqName,
    },
  );
  assertWooCommerceQueueConsumerTopology(
    consumerEntries(dlqConsumersRaw),
    target.dlqName,
    {
      maxConcurrency: 1,
      maxBatchSize: 10,
      maxBatchTimeout: 30,
      maxRetries: 10,
      deadLetterQueue: null,
    },
  );
  return Object.freeze({
    label,
    activeVersion,
    configSha256: fingerprint(configText),
    expectedTrueFlags: Object.freeze([...expectedTrueFlags].sort()),
  });
}

async function withGeneratedConfig(configText, callback) {
  const path = join(
    repositoryRoot,
    `.woocommerce-completed-state-${process.pid}-${Date.now()}.jsonc`,
  );
  await writeFile(path, configText, { mode: 0o600, flag: 'wx' });
  try {
    return await callback(path);
  } finally {
    await rm(path, { force: true });
  }
}

async function readD1Row(sql) {
  let lastError = null;
  for (const delayMs of D1_READ_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      const parsed = await wranglerJson([
        'd1', 'execute', target.databaseName,
        '--remote', '--json', '--config', target.configPath,
        '--command', sql,
      ], { timeout: 120_000 });
      const row = Array.isArray(parsed)
        ? parsed.flatMap((entry) => entry?.results ?? [])[0]
        : parsed?.results?.[0];
      if (!row) {
        throw closeoutError(
          'Remote D1 query returned no row',
          'WOOCOMMERCE_COMPLETED_STATE_D1_QUERY_EMPTY',
        );
      }
      return row;
    } catch (error) {
      lastError = error;
    }
  }
  throw closeoutError(
    'Remote D1 read failed after bounded retries',
    'WOOCOMMERCE_COMPLETED_STATE_D1_READ_FAILED',
    { causeCode: lastError?.code ?? null },
  );
}

async function wranglerJson(args, options = {}) {
  const text = await wranglerText(args, options);
  try {
    return JSON.parse(text);
  } catch {
    throw closeoutError(
      'Wrangler returned invalid JSON',
      'WOOCOMMERCE_COMPLETED_STATE_WRANGLER_JSON_INVALID',
      { commandClass: args[0] ?? null },
    );
  }
}

async function wranglerText(args, options = {}) {
  return commandText('npx', ['wrangler', ...args], {
    env: options.env ?? target?.env ?? process.env,
    timeout: options.timeout ?? 180_000,
  });
}

async function command(commandName, args, options = {}) {
  const result = await commandText(commandName, args, options);
  if (result) process.stdout.write(`${result}\n`);
}

async function commandText(commandName, args, options = {}) {
  try {
    const result = await execFileAsync(commandName, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      encoding: 'utf8',
      timeout: options.timeout ?? 180_000,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (result.stderr) process.stderr.write(result.stderr);
    return String(result.stdout ?? '').trim();
  } catch (cause) {
    throw closeoutError(
      `Command failed during WooCommerce completed-state closeout: ${commandName}`,
      'WOOCOMMERCE_COMPLETED_STATE_COMMAND_FAILED',
      {
        commandClass: commandName === 'npx' ? args[1] ?? args[0] : commandName,
        exitCode: cause?.code ?? cause?.exitCode ?? 1,
        killed: cause?.killed === true,
        signal: cause?.signal ?? null,
      },
    );
  }
}

async function gitText(args) {
  return commandText('git', args, { timeout: 60_000 });
}

function consumerEntries(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.result)) return value.result;
  if (Array.isArray(value?.consumers)) return value.consumers;
  throw closeoutError(
    'WooCommerce completed-state Queue consumer output has no supported collection',
    'WOOCOMMERCE_COMPLETED_STATE_QUEUE_CONSUMER_SHAPE_INVALID',
  );
}

function parseSecretNames(value) {
  const entries = Array.isArray(value) ? value : (value?.result ?? []);
  return Object.freeze(entries.map((item) => item?.name).filter(Boolean).sort());
}

function assertExactFlags(actual, expected) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw closeoutError(
      'WooCommerce completed-state Worker flags differ from the exact window contract',
      'WOOCOMMERCE_COMPLETED_STATE_FLAGS_INVALID',
      { expected: right, observed: left },
    );
  }
  return true;
}

function compactCloudflareEnv(env) {
  const output = { ...env };
  for (const name of [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
    'CF_API_TOKEN',
    'CF_API_KEY',
    'CF_EMAIL',
  ]) {
    if (!optionalText(env[name])) delete output[name];
  }
  return output;
}

function normalizeLarkScalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return normalizeLarkScalar(value[0]);
  if (typeof value === 'object') {
    return normalizeLarkScalar(value.text ?? value.value ?? value.name ?? null);
  }
  return String(value);
}

async function writeEvidence(name, value) {
  await writePrivateJson(join(outputRoot, `${name}.json`), {
    contractVersion: WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONTRACT_VERSION,
    writtenAt: new Date().toISOString(),
    data: sanitizeWooCommerceCompletedStateEvidence(value),
  });
}

async function readEvidenceData(name) {
  const value = await readJsonIfExists(join(outputRoot, `${name}.json`));
  if (!value) return null;
  if (value.contractVersion !== WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONTRACT_VERSION
    || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) {
    throw closeoutError(
      'WooCommerce completed-state stage checkpoint has invalid contract metadata',
      'WOOCOMMERCE_COMPLETED_STATE_CHECKPOINT_INVALID',
      { stage: name },
    );
  }
  return value.data;
}

function assertCheckpointHead(value) {
  requireExact(value.repositoryHead, target.repositoryHead, 'checkpoint.repositoryHead');
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function readJsonIfExists(path) {
  try {
    await stat(path);
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, requireText(value, 'repositoryFile'));
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}/`)) {
    throw closeoutError(
      'WooCommerce completed-state repository file escapes the repository root',
      'WOOCOMMERCE_COMPLETED_STATE_PATH_INVALID',
    );
  }
  return path;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw closeoutError(
      `WooCommerce completed-state ${fieldName} must equal ${expected}`,
      'WOOCOMMERCE_COMPLETED_STATE_TARGET_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw closeoutError(
      `WooCommerce completed-state requires ${fieldName}`,
      'WOOCOMMERCE_COMPLETED_STATE_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireOperationId(value) {
  const text = requireText(value, 'operationId').toLowerCase();
  if (!/^woo-final-(?:full|incremental)-[0-9a-f]{12}$/u.test(text)) {
    throw closeoutError(
      'WooCommerce completed-state operation ID is invalid',
      'WOOCOMMERCE_COMPLETED_STATE_OPERATION_INVALID',
    );
  }
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2020, 0, 1)) {
    throw closeoutError(
      `WooCommerce completed-state ${fieldName} is invalid`,
      'WOOCOMMERCE_COMPLETED_STATE_TIMESTAMP_INVALID',
      { fieldName },
    );
  }
  return number;
}

function requirePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw closeoutError(
      `WooCommerce completed-state ${fieldName} must be a positive integer`,
      'WOOCOMMERCE_COMPLETED_STATE_VALUE_INVALID',
      { fieldName },
    );
  }
  return number;
}

function sumCounts(value = {}) {
  return Object.values(value).reduce((sum, item) => sum + Number(item ?? 0), 0);
}

function fingerprint(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
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

function safeFile(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function closeoutError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceCompletedStateCloseoutOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
