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
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readDevVars } from './lib/dev-vars.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import {
  buildWooCommerceConfigWindows,
  buildWooCommerceFinalJob,
  buildWooCommerceFinalSnapshotSql,
  buildWooCommerceWatermarkSql,
  compareWooCommerceParity,
  createWooCommerceLarkSchemaContract,
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
  selectExactlyOneActiveWorkerVersion,
} from './lib/woocommerce-2026-completion-one-command.js';
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
      replacementFullOperation: false,
      initialFullQueueMessage: false,
      orphanRecoveryRepeated: false,
      businessFactDelete: false,
      directD1Mutation: false,
      directLarkMutation: false,
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
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  await assertRepositoryState();
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await runLocalVerification();

  const configPath = resolveRepositoryFile(
    env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const configText = await readFile(configPath, 'utf8');
  const config = parseJsoncObject(configText);
  const runtimeConfig = Object.freeze({ ...(config.vars ?? {}), ...env });
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
  latestSafeConfig = windows.safe;

  currentStage = 'fresh-d1-backup';
  const backup = await backupD1();
  await writeEvidence('02-d1-backup', backup);

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
  const replayMinimumAttempts = completedBefore.priorQueueAttempts + 1;
  const replayJob = buildWooCommerceFinalJob({
    operationId: completedBefore.operationId,
    requestedAt: completedBefore.requestedAt,
    trigger: 'manual_uat',
    fullReconciliation: true,
    orderCreatedAfter: target.orderHistoryStart,
    orderCreatedBefore: completedBefore.requestedAt,
  });
  const replaySend = await sendQueueMessage(replayJob, {
    attemptKey: `${completedBefore.operationId}:completed-state-replay`,
    minimumQueueAttempts: replayMinimumAttempts,
  });
  const completedAfterReplay = await pollCompletedState({
    operationId: completedBefore.operationId,
    fullReconciliation: true,
    minimumQueueAttempts: replayMinimumAttempts,
  });
  const replay = compareWooCommerceCompletedStateReplay(
    {
      operationId: completedBefore.operationId,
      snapshot: completedBefore.snapshot,
      fullReconciliation: true,
    },
    {
      operationId: completedBefore.operationId,
      snapshot: completedAfterReplay.snapshot,
      fullReconciliation: true,
    },
  );
  const replayParity = await verifyParity(
    lark,
    tableIds,
    completedAfterReplay.snapshot.counts,
  );
  await writeEvidence('05-idempotent-replay', {
    operationId: completedBefore.operationId,
    send: replaySend,
    replay,
    parity: replayParity,
  });

  currentStage = 'incremental-uat';
  const watermark = await readWatermark();
  const incremental = await readOrCreateIncrementalOperation();
  const incrementalMinimumAttempts = incremental.minimumQueueAttempts;
  const incrementalJob = buildWooCommerceFinalJob({
    operationId: incremental.operationId,
    requestedAt: incremental.requestedAt,
    trigger: 'manual_uat',
    fullReconciliation: false,
    modifiedAfter: watermark,
    orderCreatedAfter: target.orderHistoryStart,
    orderCreatedBefore: incremental.requestedAt,
  });
  const incrementalSend = await sendQueueMessage(incrementalJob, {
    attemptKey: `${incremental.operationId}:incremental-uat`,
    minimumQueueAttempts: incrementalMinimumAttempts,
  });
  const incrementalCompleted = await pollCompletedState({
    operationId: incremental.operationId,
    fullReconciliation: false,
    minimumQueueAttempts: incrementalMinimumAttempts,
  });
  const incrementalParity = await verifyParity(
    lark,
    tableIds,
    incrementalCompleted.snapshot.counts,
  );
  await writeEvidence('06-incremental-uat', {
    operationId: incremental.operationId,
    modifiedAfter: watermark,
    send: incrementalSend,
    completionFingerprint: incrementalCompleted.completionFingerprint,
    parity: incrementalParity,
  });

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
    idempotentRerunVerified: true,
    incrementalVerified: true,
    executionFlagsAllFalse: finalSafe.allFalse,
    scheduleEnabled: false,
    production: false,
    remote: finalRemote,
    safety: Object.freeze({
      replacementFullOperation: false,
      orphanRecoveryRepeated: false,
      businessFactDelete: false,
      manualD1OrLarkEditing: false,
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

async function runLocalVerification() {
  await command('npm', ['run', 'check'], { timeout: 600_000 });
  await command('node', [
    '--test',
    'tests/application/woocommerce-final-completed-state-closeout.test.js',
    'tests/application/woocommerce-final-rollout-operator.test.js',
    'tests/application/woocommerce-runtime-wiring.test.js',
  ], { timeout: 600_000 });
  await command('npm', ['run', 'deploy:dry-run'], { timeout: 600_000 });
}

async function assertRepositoryState() {
  const branch = await gitText(['branch', '--show-current']);
  const head = await gitText(['rev-parse', 'HEAD']);
  const originMain = await gitText(['rev-parse', 'origin/main']);
  const status = await gitText(['status', '--porcelain', '--untracked-files=all'], false);
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
  let latest = null;
  for (let poll = 0; poll < VERIFY_MAX_POLLS; poll += 1) {
    latest = await readSnapshot(input.operationId);
    const classification = classifyWooCommerceCompletedStatePoll({
      ...input,
      snapshot: latest,
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
      { orderWatermarkAvailable: Number.isSafeInteger(order), productWatermarkAvailable: Number.isSafeInteger(product) },
    );
  }
  return Math.min(order, product);
}

async function readOrCreateIncrementalOperation() {
  const path = join(outputRoot, 'incremental-operation.json');
  const existing = await readJsonIfExists(path);
  if (existing) {
    return Object.freeze({
      operationId: requireOperationId(existing.operationId),
      requestedAt: requireTimestamp(existing.requestedAt, 'incremental.requestedAt'),
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
    operationId: `woo-final-incremental-${suffix}`,
    requestedAt,
    minimumQueueAttempts: 1,
  });
  await writePrivateJson(path, operation);
  return operation;
}

async function sendQueueMessage(job, options = {}) {
  const attemptKey = requireText(options.attemptKey, 'attemptKey');
  const path = join(outputRoot, 'queue-attempts', `${safeFile(attemptKey)}.json`);
  const existing = await readJsonIfExists(path);
  if (existing) {
    if (existing.accepted !== true) {
      throw closeoutError(
        'A prior Queue attempt was recorded without verified acceptance; blind resend is blocked',
        'WOOCOMMERCE_COMPLETED_STATE_QUEUE_ATTEMPT_UNCERTAIN',
        { attemptKey },
      );
    }
    return Object.freeze({
      accepted: true,
      reusedEvidence: true,
      minimumQueueAttempts: existing.minimumQueueAttempts,
      jobSha256: existing.jobSha256,
    });
  }
  const evidence = {
    attemptKey,
    accepted: false,
    minimumQueueAttempts: requirePositiveInteger(
      options.minimumQueueAttempts,
      'minimumQueueAttempts',
    ),
    jobSha256: sha256(JSON.stringify(job)),
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
    );
  }
  const accepted = Object.freeze({ ...evidence, accepted: true });
  await writePrivateJson(path, accepted);
  return Object.freeze({
    accepted: true,
    reusedEvidence: false,
    minimumQueueAttempts: accepted.minimumQueueAttempts,
    jobSha256: accepted.jobSha256,
  });
}

async function backupD1() {
  const directory = join(outputRoot, 'backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `social-mkt-state-dev-before-completed-state-${Date.now()}.sql`);
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
  assertExactFlags(
    assertWooCommerce2026RemoteSafeFlagsOrExpected(versionView, expectedTrueFlags),
    expectedTrueFlags,
  );
  const [mainConsumers, dlqConsumers] = await Promise.all([
    wranglerJson(['queues', 'consumer', 'list', target.mainQueueName, '--json']),
    wranglerJson(['queues', 'consumer', 'list', target.dlqName, '--json']),
  ]);
  assertQueueConsumer(mainConsumers, target.mainQueueName, {
    maxConcurrency: 1,
    maxBatchSize: 10,
    maxBatchTimeout: 30,
    maxRetries: 5,
    deadLetterQueue: target.dlqName,
  });
  assertQueueConsumer(dlqConsumers, target.dlqName, {
    maxConcurrency: 1,
    maxBatchSize: 10,
    maxBatchTimeout: 30,
    maxRetries: 10,
    deadLetterQueue: null,
  });
  return Object.freeze({
    label,
    activeVersion,
    configSha256: sha256(configText),
    expectedTrueFlags: Object.freeze([...expectedTrueFlags].sort()),
  });
}

function assertWooCommerce2026RemoteSafeFlagsOrExpected(versionView, expected) {
  if (expected.length === 0) {
    assertWooCommerce2026RemoteSafeFlags(versionView);
    return [];
  }
  const flags = collectRemoteTrueFlags(versionView);
  return flags;
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
    env: target?.env ?? options.env ?? process.env,
    timeout: options.timeout ?? 180_000,
  });
}

async function command(commandName, args, options = {}) {
  await commandText(commandName, args, { ...options, inherit: true });
}

async function commandText(commandName, args, options = {}) {
  try {
    const result = await execFileAsync(commandName, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      encoding: 'utf8',
      timeout: options.timeout ?? 180_000,
      maxBuffer: 128 * 1024 * 1024,
      ...(options.inherit ? {} : {}),
    });
    if (options.inherit) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
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

async function gitText(args, requireSuccess = true) {
  try {
    return await commandText('git', args, { timeout: 60_000 });
  } catch (error) {
    if (requireSuccess) throw error;
    return '';
  }
}

function parseSecretNames(value) {
  const entries = Array.isArray(value) ? value : (value?.result ?? []);
  return Object.freeze(entries.map((item) => item?.name).filter(Boolean).sort());
}

function collectRemoteTrueFlags(value) {
  const flags = new Map();
  visit(value);
  return Object.freeze([...flags.entries()]
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .sort());

  function visit(node) {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, nested] of Object.entries(node)) {
      if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) {
        flags.set(key, booleanLike(nested));
      }
      visit(nested);
    }
    if (typeof node.name === 'string'
      && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(node.name)) {
      flags.set(node.name, booleanLike(node.text ?? node.value ?? node.json ?? node.data));
    }
  }
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

function assertQueueConsumer(value, queueName, expected) {
  const entries = Array.isArray(value) ? value : (value?.result ?? value?.consumers ?? []);
  const matches = entries.filter((item) => (
    (item?.queue_name ?? item?.queueName ?? queueName) === queueName
  ));
  const consumer = matches.length === 1 ? matches[0] : entries.length === 1 ? entries[0] : null;
  const settings = consumer?.settings ?? consumer ?? {};
  const deadLetter = settings.dead_letter_queue
    ?? settings.deadLetterQueue
    ?? settings.dead_letter_queue_name
    ?? null;
  const accepted = consumer
    && Number(settings.max_concurrency ?? settings.maxConcurrency) === expected.maxConcurrency
    && Number(settings.max_batch_size ?? settings.maxBatchSize) === expected.maxBatchSize
    && Number(settings.max_batch_timeout ?? settings.maxBatchTimeout) === expected.maxBatchTimeout
    && Number(settings.max_retries ?? settings.maxRetries) === expected.maxRetries
    && (expected.deadLetterQueue === null
      ? deadLetter === null || deadLetter === undefined || deadLetter === ''
      : String(deadLetter) === expected.deadLetterQueue);
  if (!accepted) {
    throw closeoutError(
      'WooCommerce completed-state Queue consumer contract drifted',
      'WOOCOMMERCE_COMPLETED_STATE_QUEUE_CONSUMER_INVALID',
      { queueName, matchCount: matches.length },
    );
  }
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

async function writePrivateJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 }).catch(async () => {
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  });
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

function booleanLike(value) {
  return value === true
    || value === 1
    || String(value ?? '').trim().toLowerCase() === 'true';
}

function sumCounts(value = {}) {
  return Object.values(value).reduce((sum, item) => sum + Number(item ?? 0), 0);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
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
