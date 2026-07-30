#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { secureLocalSecretFile } from './lib/local-secret-file-policy.js';
import {
  assertReportRuntimeSealedHead,
  buildReportRuntimeSealedChildEnvironment,
  buildReportRuntimeSealedCloneArgs,
  readReportRuntimeSealedContext,
  sanitizeReportRuntimeGitEnvironment,
} from './lib/report-runtime-sealed-execution.js';
import {
  buildWooCommerceFinalSnapshotSql,
  selectWooCommerceFullOperation,
} from './lib/woocommerce-final-rollout-operator.js';
import {
  WOOCOMMERCE_2026_COMPLETION_CONFIRMATION,
  WOOCOMMERCE_2026_COMPLETION_CONTRACT_VERSION,
  WOOCOMMERCE_2026_COMPLETION_SEALED_HEAD,
  WOOCOMMERCE_2026_COMPLETION_SEALED_MARKER,
  WOOCOMMERCE_2026_COMPLETION_SEALED_VALUE,
  WOOCOMMERCE_2026_HISTORY_START,
  assertWooCommerce2026CompletionConfirmation,
  assertWooCommerce2026RemoteSafeFlags,
  parseWooCommerce2026CompletionArgs,
  requireWooCommerce2026CompletionHead,
  selectExactlyOneActiveWorkerVersion,
  validateWooCommerce2026CleanupPostState,
  validateWooCommerce2026CleanupPreflight,
  validateWooCommerce2026CompletionFinalRemote,
  validateWooCommerce2026FinalSummary,
} from './lib/woocommerce-2026-completion-one-command.js';

const repositoryRoot = resolve(process.cwd());
const OLD_OPERATION_ID = 'woo-final-full-e2372e56d52d';
const OLD_WORK_KEY = `woocommerce:${OLD_OPERATION_ID}`;
const HISTORY_START_MS = Date.parse(WOOCOMMERCE_2026_HISTORY_START);
const DEFAULT_DATABASE = 'social-mkt-state-dev';
const DEFAULT_WORKER = 'social-mkt-sync-worker';

try {
  const options = parseWooCommerce2026CompletionArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else if (process.env[WOOCOMMERCE_2026_COMPLETION_SEALED_MARKER]
    === WOOCOMMERCE_2026_COMPLETION_SEALED_VALUE) {
    await executeSealed();
  } else {
    await executeOuter();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'WOOCOMMERCE_2026_COMPLETION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: WOOCOMMERCE_2026_COMPLETION_CONTRACT_VERSION,
    command: `CONFIRM_WOOCOMMERCE_2026_COMPLETION=${WOOCOMMERCE_2026_COMPLETION_CONFIRMATION} node scripts/woocommerce-2026-completion-one-command.mjs --execute`,
    stages: [
      'secure-local-secret-input',
      'snapshot-current-origin-main',
      'execute-in-canonical-sealed-main-clone',
      'full-local-verification',
      'verify-worker-all-false',
      'resume-or-complete-pre-2026-cleanup',
      'verify-zero-old-rows-and-close-old-operation',
      'discover-exact-2026-continuation-or-create-new-operation',
      'full-reconciliation-to-d1-and-lark',
      'd1-lark-parity',
      'same-operation-replay',
      'incremental-uat',
      'safe-all-false-closeout',
      'verify-zero-active-work-locks-and-queue-operations',
    ],
    safety: {
      exactMainPinnedAtStart: true,
      canonicalMacOsPathIdentity: true,
      mutableSourceCheckoutUsedForExecution: false,
      cleanupBackupFirst: true,
      cleanupStatementsIdempotent: true,
      exactContinuationDiscovery: true,
      replacementFullOperationWhileActive: false,
      businessFactsBefore2026Only: true,
      workerAllFalseBeforeCleanup: true,
      workerAllFalseAfterCompletion: true,
      scheduleExecutionFlagsEnabled: false,
      production: false,
    },
  }, null, 2)}\n`);
}

async function executeOuter() {
  assertWooCommerce2026CompletionConfirmation(process.env);
  const devVars = await secureDevVars();
  const gitEnv = sanitizeReportRuntimeGitEnvironment(process.env);
  const baseEvidenceRoot = resolve(
    process.env.MKT_WOOCOMMERCE_2026_COMPLETION_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'woocommerce-2026-completion'),
  );
  await mkdir(baseEvidenceRoot, { recursive: true, mode: 0o700 });

  runGit(['fetch', 'origin', 'main', '--quiet'], { env: gitEnv });
  const originUrl = runGitText(['remote', 'get-url', 'origin'], { env: gitEnv });
  const pinnedHead = requireWooCommerce2026CompletionHead(
    runGitText(['rev-parse', 'origin/main'], { env: gitEnv }),
  );
  const evidenceRoot = join(baseEvidenceRoot, pinnedHead);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  const sourceConfigPath = resolve(
    repositoryRoot,
    process.env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'mkt-woocommerce-2026-completion-'));
  const cloneRoot = join(sandboxRoot, 'repository');

  try {
    runCommand('git', buildReportRuntimeSealedCloneArgs(originUrl, cloneRoot), {
      cwd: repositoryRoot,
      env: gitEnv,
      code: 'WOOCOMMERCE_2026_COMPLETION_SEALED_CLONE_FAILED',
    });
    runGit(['checkout', '--force', '-B', 'main', pinnedHead], { cwd: cloneRoot, env: gitEnv });
    runGit(['remote', 'set-url', 'origin', '.'], { cwd: cloneRoot, env: gitEnv });
    runGit(['fetch', 'origin', 'main', '--quiet'], { cwd: cloneRoot, env: gitEnv });
    assertSealedRepository(cloneRoot, pinnedHead, gitEnv);

    const sealedDevVars = join(cloneRoot, '.dev.vars');
    const sealedConfig = join(cloneRoot, 'wrangler.sync.jsonc');
    await snapshotPrivateFile(devVars.resolvedPath, sealedDevVars, '.dev.vars');
    await snapshotPrivateFile(sourceConfigPath, sealedConfig, 'wrangler.sync.jsonc');
    assertSealedRepository(cloneRoot, pinnedHead, gitEnv);

    const reportSealedEnv = buildReportRuntimeSealedChildEnvironment(
      process.env,
      {
        root: cloneRoot,
        head: pinnedHead,
        evidenceDir: evidenceRoot,
        devVarsFile: sealedDevVars,
        wranglerConfigFile: sealedConfig,
      },
    );
    const childEnv = sanitizeReportRuntimeGitEnvironment({
      ...reportSealedEnv,
      CONFIRM_WOOCOMMERCE_2026_COMPLETION:
        WOOCOMMERCE_2026_COMPLETION_CONFIRMATION,
      [WOOCOMMERCE_2026_COMPLETION_SEALED_MARKER]:
        WOOCOMMERCE_2026_COMPLETION_SEALED_VALUE,
      [WOOCOMMERCE_2026_COMPLETION_SEALED_HEAD]: pinnedHead,
      DEV_VARS_FILE: sealedDevVars,
      MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: sealedConfig,
      MKT_WOOCOMMERCE_2026_COMPLETION_EVIDENCE_DIR: evidenceRoot,
      MKT_WOOCOMMERCE_2026_CLEANUP_EVIDENCE_DIR: join(evidenceRoot, 'cleanup'),
      MKT_WOOCOMMERCE_FINAL_EVIDENCE_DIR: join(evidenceRoot, 'final'),
      MKT_WOOCOMMERCE_ORDER_HISTORY_START: WOOCOMMERCE_2026_HISTORY_START,
    });
    delete childEnv.MKT_WOOCOMMERCE_FINAL_RESUME_OPERATION_ID;

    runRequiredNodeStep(
      'sealed-woocommerce-2026-completion',
      ['scripts/woocommerce-2026-completion-one-command.mjs', '--execute'],
      childEnv,
      cloneRoot,
    );
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}

async function executeSealed() {
  assertWooCommerce2026CompletionConfirmation(process.env);
  const sealedContext = readReportRuntimeSealedContext(process.env, repositoryRoot);
  if (!sealedContext) throw failure(
    'WooCommerce completion requires the canonical sealed execution context',
    'WOOCOMMERCE_2026_COMPLETION_SEALED_CONTEXT_MISSING',
  );
  const pinnedHead = requireWooCommerce2026CompletionHead(
    requiredEnv(WOOCOMMERCE_2026_COMPLETION_SEALED_HEAD),
  );
  if (sealedContext.expectedHead !== pinnedHead) throw failure(
    'WooCommerce and shared sealed contexts disagree on the pinned main SHA',
    'WOOCOMMERCE_2026_COMPLETION_SEALED_HEAD_MISMATCH',
    { expectedHead: pinnedHead, sharedExpectedHead: sealedContext.expectedHead },
  );
  assertSealedRepository(repositoryRoot, pinnedHead, process.env, sealedContext);

  const evidenceRoot = resolve(requiredEnv(
    'MKT_WOOCOMMERCE_2026_COMPLETION_EVIDENCE_DIR',
  ));
  const cleanupEvidenceRoot = resolve(requiredEnv(
    'MKT_WOOCOMMERCE_2026_CLEANUP_EVIDENCE_DIR',
  ));
  const finalEvidenceRoot = resolve(requiredEnv(
    'MKT_WOOCOMMERCE_FINAL_EVIDENCE_DIR',
  ));
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  await mkdir(cleanupEvidenceRoot, { recursive: true, mode: 0o700 });
  await mkdir(finalEvidenceRoot, { recursive: true, mode: 0o700 });

  runLocalVerification();
  assertSealedRepository(repositoryRoot, pinnedHead, process.env, sealedContext);

  const env = Object.freeze({
    ...await readDevVars(process.env.DEV_VARS_FILE),
    ...process.env,
  });
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  const historyStart = new Date(env.MKT_WOOCOMMERCE_ORDER_HISTORY_START);
  if (!Number.isFinite(historyStart.getTime())) throw failure(
    'MKT_WOOCOMMERCE_ORDER_HISTORY_START is not a valid timestamp',
    'WOOCOMMERCE_2026_COMPLETION_HISTORY_START_INVALID',
  );
  requireExact(
    historyStart.toISOString(),
    WOOCOMMERCE_2026_HISTORY_START,
    'MKT_WOOCOMMERCE_ORDER_HISTORY_START',
  );

  const configPath = resolve(requiredEnv('MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG'));
  const databaseName = env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME ?? DEFAULT_DATABASE;
  const workerName = env.MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME ?? DEFAULT_WORKER;

  const safeBefore = readRemoteWorkerSafe({ env, configPath, workerName });
  const cleanupBefore = readCleanupState({ env, configPath, databaseName });
  const cleanupDecision = validateWooCommerce2026CleanupPreflight(cleanupBefore);
  let cleanupExecuted = false;

  if (cleanupDecision.pendingExactCleanup) {
    runRequiredNodeStep(
      'woocommerce-2026-history-cleanup',
      ['scripts/woocommerce-2026-history-cleanup.mjs', '--execute'],
      {
        ...env,
        CONFIRM_WOOCOMMERCE_2026_HISTORY_CLEANUP:
          'DELETE_WOOCOMMERCE_PRE_2026_ONLY',
        MKT_WOOCOMMERCE_2026_CLEANUP_EVIDENCE_DIR: cleanupEvidenceRoot,
      },
      repositoryRoot,
    );
    cleanupExecuted = true;
  }

  const cleanupAfter = readCleanupState({ env, configPath, databaseName });
  if (cleanupExecuted) validateWooCommerce2026CleanupPostState(cleanupAfter);
  else validateWooCommerce2026CleanupPreflight(cleanupAfter);
  const safeAfterCleanup = readRemoteWorkerSafe({ env, configPath, workerName });

  const finalEvidencePath = join(finalEvidenceRoot, '11-summary.json');
  const existingFinalEvidence = await readJsonIfExists(finalEvidencePath);
  let finalSummary;
  let finalReused = false;
  let resumeOperationId = null;

  if (existingFinalEvidence) {
    finalSummary = validateWooCommerce2026FinalSummary(
      existingFinalEvidence.data ?? existingFinalEvidence,
      pinnedHead,
    );
    finalReused = true;
  } else {
    resumeOperationId = await discoverExactResumeOperation({
      env,
      configPath,
      databaseName,
    });
    const finalEnv = {
      ...env,
      CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT: 'EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT',
      MKT_WOOCOMMERCE_FINAL_EVIDENCE_DIR: finalEvidenceRoot,
      MKT_WOOCOMMERCE_ORDER_HISTORY_START: WOOCOMMERCE_2026_HISTORY_START,
    };
    if (resumeOperationId) {
      finalEnv.MKT_WOOCOMMERCE_FINAL_RESUME_OPERATION_ID = resumeOperationId;
    } else {
      delete finalEnv.MKT_WOOCOMMERCE_FINAL_RESUME_OPERATION_ID;
    }
    runRequiredNodeStep(
      'woocommerce-final-one-command',
      ['scripts/woocommerce-final-one-command.mjs', '--execute'],
      finalEnv,
      repositoryRoot,
    );
    const evidence = await readRequiredJson(finalEvidencePath);
    finalSummary = validateWooCommerce2026FinalSummary(
      evidence.data ?? evidence,
      pinnedHead,
    );
  }

  const finalRemote = validateWooCommerce2026CompletionFinalRemote(
    readFinalRemoteState({ env, configPath, databaseName }),
  );
  const safeFinal = readRemoteWorkerSafe({ env, configPath, workerName });
  assertSealedRepository(repositoryRoot, pinnedHead, process.env, sealedContext);

  const summary = Object.freeze({
    ok: true,
    decision: 'WOOCOMMERCE_2026_COMPLETED_SAFE',
    contractVersion: WOOCOMMERCE_2026_COMPLETION_CONTRACT_VERSION,
    repositoryHead: pinnedHead,
    cleanup: Object.freeze({
      executed: cleanupExecuted,
      reusedCompletedState: !cleanupExecuted,
      oldRows: 0,
      replacedOperationId: OLD_OPERATION_ID,
      replacedOperationClosed: true,
    }),
    final: Object.freeze({
      reused: finalReused,
      resumedExactOperation: resumeOperationId !== null,
      operationId: finalSummary.operationId,
      historyStart: WOOCOMMERCE_2026_HISTORY_START,
      parityVerified: true,
      idempotentRerunVerified: true,
      incrementalVerified: true,
    }),
    remote: Object.freeze({
      activeWork: finalRemote.activeWork,
      activeLocks: finalRemote.activeLocks,
      activeQueueOperations: finalRemote.activeQueueOperations,
      executionFlagsAllFalse: safeFinal.allFalse,
      scheduleExecutionFlagsFalse: safeFinal.enabledFlags.length === 0,
      activeWorkerVersion: safeFinal.activeVersion,
    }),
    safety: Object.freeze({
      sealedMain: true,
      canonicalRootIdentity: true,
      sourceCheckoutUsedForExecution: false,
      workerSafeBeforeCleanup: safeBefore.allFalse,
      workerSafeAfterCleanup: safeAfterCleanup.allFalse,
      workerSafeAfterFinal: safeFinal.allFalse,
      scheduleEnabled: false,
      production: false,
      manualD1OrLarkEditing: false,
    }),
    nextStep: 'resume_pinned_meta_finalizer',
  });
  const summaryPath = join(evidenceRoot, 'woocommerce-2026-completion-summary.json');
  await writePrivateJson(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: summaryPath }, null, 2)}\n`);
}

function runLocalVerification() {
  const steps = [
    ['npm-ci', 'npm', ['ci']],
    ['repository-check', 'npm', ['run', 'check']],
    ['full-tests', 'npm', ['test']],
    ['report-reliability', 'npm', ['run', 'test:report-reliability']],
    ['dependency-audit', 'npm', ['audit', '--audit-level=high']],
    ['wrangler-dry-run', 'npm', ['run', 'deploy:dry-run']],
  ];
  for (const [name, command, args] of steps) {
    runCommand(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
      code: 'WOOCOMMERCE_2026_COMPLETION_LOCAL_GATE_FAILED',
      details: { name },
    });
  }
}

function readRemoteWorkerSafe(input) {
  const deploymentRaw = runWranglerJson([
    'deployments', 'status',
    '--name', input.workerName,
    '--config', input.configPath,
    '--json',
  ], input.env);
  const deployment = Array.isArray(deploymentRaw) ? deploymentRaw[0] : deploymentRaw;
  const activeVersion = selectExactlyOneActiveWorkerVersion(deployment);
  const versionView = runWranglerJson([
    'versions', 'view', activeVersion,
    '--name', input.workerName,
    '--config', input.configPath,
    '--json',
  ], input.env);
  const safe = assertWooCommerce2026RemoteSafeFlags(versionView);
  return Object.freeze({ ...safe, activeVersion });
}

function readCleanupState(input) {
  return firstRow(runD1(buildCleanupStateSql(), input));
}

function readFinalRemoteState(input) {
  return firstRow(runD1(`SELECT
    (SELECT COUNT(*) FROM sync_work_runs
      WHERE lifecycle_status='active') AS active_work,
    (SELECT COUNT(*) FROM sync_locks
      WHERE expires_at > unixepoch('now') * 1000) AS active_locks,
    (SELECT COUNT(DISTINCT q.operation_id)
      FROM queue_operation_attempts q
      JOIN sync_work_runs w ON w.work_key=q.work_key
      WHERE w.lifecycle_status='active') AS active_queue_operations;`, input));
}

async function discoverExactResumeOperation(input) {
  const maxPolls = 7;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    const active = rows(runD1(`SELECT work_key
      FROM sync_work_runs
      WHERE lifecycle_status='active'
      ORDER BY work_key;`, input));
    if (active.length === 0) return null;
    if (active.length !== 1) throw failure(
      'WooCommerce completion found multiple active durable work identities',
      'WOOCOMMERCE_2026_COMPLETION_RESUME_AMBIGUOUS',
      { activeWorkCount: active.length },
    );
    const workKey = String(active[0]?.work_key ?? '');
    const match = /^woocommerce:(woo-final-full-[0-9a-f]{12})$/u.exec(workKey);
    if (!match || match[1] === OLD_OPERATION_ID) throw failure(
      'WooCommerce completion found a foreign or obsolete active work identity',
      'WOOCOMMERCE_2026_COMPLETION_RESUME_INVALID',
      { workKeyClass: workKey.startsWith('woocommerce:') ? 'woocommerce' : 'foreign' },
    );
    const operationId = match[1];
    const snapshot = firstRow(runD1(buildWooCommerceFinalSnapshotSql({
      accountKey: 'chemistry_k',
      operationId,
    }), input));
    const syncStatus = String(snapshot.sync_run_status ?? '');
    const activeLockCount = Number(snapshot.active_lock_count ?? 0);
    if ((syncStatus === 'running' || activeLockCount > 0) && attempt < maxPolls) {
      await sleep(5_000);
      continue;
    }
    selectWooCommerceFullOperation({
      resumeOperationId: operationId,
      snapshot,
      orderHistoryStart: HISTORY_START_MS,
    });
    return operationId;
  }
  throw failure(
    'WooCommerce active operation did not settle within bounded resume discovery',
    'WOOCOMMERCE_2026_COMPLETION_RESUME_TIMEOUT',
  );
}

function buildCleanupStateSql() {
  return `SELECT
    (SELECT COUNT(*) FROM raw_commerce_order_items
      WHERE account_key='chemistry_k' AND raw_order_key IN (
        SELECT raw_order_key FROM raw_commerce_orders
        WHERE account_key='chemistry_k' AND source_created_at < ${HISTORY_START_MS}
      )) AS old_raw_order_items,
    (SELECT COUNT(*) FROM raw_commerce_refunds
      WHERE account_key='chemistry_k' AND raw_order_key IN (
        SELECT raw_order_key FROM raw_commerce_orders
        WHERE account_key='chemistry_k' AND source_created_at < ${HISTORY_START_MS}
      )) AS old_raw_refunds,
    (SELECT COUNT(*) FROM raw_commerce_orders
      WHERE account_key='chemistry_k' AND source_created_at < ${HISTORY_START_MS}) AS old_raw_orders,
    (SELECT COUNT(*) FROM commerce_order_status_observations
      WHERE account_key='chemistry_k' AND order_key IN (
        SELECT order_key FROM commerce_order_state
        WHERE account_key='chemistry_k' AND source_created_at < ${HISTORY_START_MS}
      )) AS old_order_status_observations,
    (SELECT COUNT(*) FROM commerce_order_line_facts
      WHERE account_key='chemistry_k' AND order_key IN (
        SELECT order_key FROM commerce_order_state
        WHERE account_key='chemistry_k' AND source_created_at < ${HISTORY_START_MS}
      )) AS old_order_line_facts,
    (SELECT COUNT(*) FROM commerce_order_state
      WHERE account_key='chemistry_k' AND source_created_at < ${HISTORY_START_MS}) AS old_order_state,
    (SELECT COUNT(*) FROM commerce_customer_aggregates
      WHERE account_key='chemistry_k') AS old_customer_aggregates,
    (SELECT COUNT(*) FROM commerce_daily_sales_facts
      WHERE account_key='chemistry_k' AND metric_date < '2026-01-01') AS old_daily,
    (SELECT COUNT(*) FROM commerce_product_daily_facts
      WHERE account_key='chemistry_k' AND metric_date < '2026-01-01') AS old_product_daily,
    (SELECT COUNT(*) FROM sync_work_runs
      WHERE lifecycle_status='active') AS active_work,
    (SELECT COUNT(*) FROM sync_work_runs
      WHERE lifecycle_status='active' AND work_key='${OLD_WORK_KEY}') AS replaced_active_work,
    (SELECT COUNT(*) FROM sync_work_runs
      WHERE lifecycle_status='active' AND work_key<>'${OLD_WORK_KEY}') AS other_active_work,
    (SELECT COUNT(*) FROM sync_locks
      WHERE expires_at > unixepoch('now') * 1000) AS active_locks,
    (SELECT lifecycle_status FROM sync_work_runs
      WHERE work_key='${OLD_WORK_KEY}') AS replaced_work_status,
    (SELECT status FROM sync_runs
      WHERE sync_run_id='${OLD_WORK_KEY}') AS replaced_sync_status,
    (SELECT error_code FROM sync_runs
      WHERE sync_run_id='${OLD_WORK_KEY}') AS replaced_sync_error_code;`;
}

function runD1(sql, input) {
  return runWranglerJson([
    'd1', 'execute', input.databaseName,
    '--remote', '--json', '--config', input.configPath,
    '--command', sql,
  ], input.env);
}

function runWranglerJson(args, env) {
  const result = runCommand('npx', ['wrangler', ...args], {
    cwd: repositoryRoot,
    env,
    stdio: 'pipe',
    code: 'WOOCOMMERCE_2026_COMPLETION_WRANGLER_FAILED',
  });
  try {
    return JSON.parse(String(result.stdout ?? '').trim());
  } catch {
    throw failure(
      'Wrangler returned invalid JSON during WooCommerce completion',
      'WOOCOMMERCE_2026_COMPLETION_WRANGLER_JSON_INVALID',
      { stdoutLength: String(result.stdout ?? '').length },
    );
  }
}

function rows(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => entry?.results ?? []);
  return Array.isArray(value?.results) ? value.results : [];
}

function firstRow(value) {
  const row = rows(value)[0];
  if (!row) throw failure(
    'Remote D1 query returned no row during WooCommerce completion',
    'WOOCOMMERCE_2026_COMPLETION_D1_EMPTY',
  );
  return row;
}

function assertSealedRepository(root, expectedHead, env, sealedContext = null) {
  const branch = runGitText(['branch', '--show-current'], { cwd: root, env });
  const head = runGitText(['rev-parse', 'HEAD'], { cwd: root, env });
  const originMain = runGitText(['rev-parse', 'origin/main'], { cwd: root, env });
  const dirty = runGitText(
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: root, env, trim: false },
  );
  if (sealedContext) assertReportRuntimeSealedHead(sealedContext, head);
  if (branch !== 'main'
    || head !== expectedHead
    || originMain !== expectedHead
    || dirty.trim() !== '') {
    throw failure(
      'WooCommerce completion sealed repository is not exact and clean',
      'WOOCOMMERCE_2026_COMPLETION_REPOSITORY_INVALID',
      { branch, head, originMain, expectedHead, clean: dirty.trim() === '' },
    );
  }
}

async function secureDevVars() {
  const requested = resolve(process.env.DEV_VARS_FILE ?? join(repositoryRoot, '.dev.vars'));
  try {
    const inspected = await secureLocalSecretFile(requested, {
      expectedBasename: basename(requested),
    });
    if (!inspected.exists || !inspected.resolvedPath) throw failure(
      'Required local .dev.vars file is missing',
      'WOOCOMMERCE_2026_COMPLETION_DEV_VARS_INVALID',
    );
    return inspected;
  } catch (error) {
    if (error?.name === 'WooCommerce2026CompletionCommandError') throw error;
    throw failure(
      error instanceof Error ? error.message : 'Unable to secure local .dev.vars',
      'WOOCOMMERCE_2026_COMPLETION_DEV_VARS_INVALID',
    );
  }
}

async function snapshotPrivateFile(sourcePath, destinationPath, label) {
  let before;
  try {
    before = await stat(sourcePath, { bigint: true });
  } catch {
    throw failure(
      `Required local ${label} file cannot be read`,
      'WOOCOMMERCE_2026_COMPLETION_LOCAL_INPUT_INVALID',
      { label },
    );
  }
  if (!before.isFile()) throw failure(
    `Required local ${label} target must be a regular file`,
    'WOOCOMMERCE_2026_COMPLETION_LOCAL_INPUT_INVALID',
    { label },
  );
  const bytes = await readFile(sourcePath);
  const after = await stat(sourcePath, { bigint: true });
  if (before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs
    || before.ctimeNs !== after.ctimeNs) {
    throw failure(
      `Required local ${label} changed while being copied`,
      'WOOCOMMERCE_2026_COMPLETION_LOCAL_INPUT_CHANGED',
      { label },
    );
  }
  await writeFile(destinationPath, bytes, { mode: 0o600, flag: 'wx' });
  await chmod(destinationPath, 0o600);
}

function runRequiredNodeStep(name, args, env, cwd) {
  runCommand(process.execPath, args, {
    cwd,
    env,
    stdio: 'inherit',
    code: 'WOOCOMMERCE_2026_COMPLETION_REQUIRED_STEP_FAILED',
    details: { name },
  });
}

function runCommand(command, args, options = {}) {
  const stdio = options.stdio ?? 'pipe';
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio,
    encoding: stdio === 'inherit' ? undefined : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw failure(
    `Command failed during WooCommerce completion: ${command}`,
    options.code ?? 'WOOCOMMERCE_2026_COMPLETION_COMMAND_FAILED',
    {
      ...(options.details ?? {}),
      exitCode: result.status ?? 1,
      stdoutLength: String(result.stdout ?? '').length,
      stderrLength: String(result.stderr ?? '').length,
    },
  );
  return result;
}

function runGit(args, options = {}) {
  return runCommand('git', args, {
    ...options,
    env: sanitizeReportRuntimeGitEnvironment(options.env ?? process.env),
    stdio: options.stdio ?? 'pipe',
    code: 'WOOCOMMERCE_2026_COMPLETION_GIT_FAILED',
  });
}

function runGitText(args, options = {}) {
  const text = String(runGit(args, options).stdout ?? '');
  return options.trim === false ? text : text.trim();
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw failure(
      'WooCommerce completion evidence JSON is invalid',
      'WOOCOMMERCE_2026_COMPLETION_EVIDENCE_JSON_INVALID',
      { evidenceFile: basename(path) },
    );
    throw error;
  }
}

async function readRequiredJson(path) {
  const value = await readJsonIfExists(path);
  if (!value) throw failure(
    'Required WooCommerce completion evidence is missing',
    'WOOCOMMERCE_2026_COMPLETION_EVIDENCE_MISSING',
    { evidenceFile: basename(path) },
  );
  return value;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') throw failure(
    `WooCommerce completion requires ${name}`,
    'WOOCOMMERCE_2026_COMPLETION_INPUT_REQUIRED',
    { name },
  );
  return value.trim();
}

function requireExact(value, expected, name) {
  if (value !== expected) throw failure(
    `${name} must equal ${expected}`,
    'WOOCOMMERCE_2026_COMPLETION_TARGET_INVALID',
    { name },
  );
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:token|secret|authorization|cookie|password|accountId|queueId|tableId|fieldId|recordId|originUrl|path)$/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function sleep(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function failure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerce2026CompletionCommandError';
  error.code = code;
  error.details = details;
  return error;
}
