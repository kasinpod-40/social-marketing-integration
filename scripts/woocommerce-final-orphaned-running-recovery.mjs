#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  parseWranglerD1Rows,
} from './lib/woocommerce-final-failed-work-recovery.js';
import {
  classifyWooCommerceD1ReadCommand,
  wooCommerceD1ReadMaxAttempts,
  wooCommerceD1ReadRetryDelay,
} from './lib/woocommerce-d1-read-retry.js';
import {
  WOOCOMMERCE_ORPHANED_RUNNING_CONFIRMATION,
  WOOCOMMERCE_ORPHANED_RUNNING_OPERATION_ID,
  assertWooCommerceOrphanedRunningRecoveryConfirmation,
  buildWooCommerceOrphanedRunningRecoverySql,
  buildWooCommerceOrphanedRunningSnapshotSql,
  getWooCommerceOrphanedRunningStabilityWindowMs,
  parseWooCommerceOrphanedRunningRecoveryArgs,
  verifyWooCommerceOrphanedRunningEligibility,
  verifyWooCommerceOrphanedRunningMutation,
  verifyWooCommerceOrphanedRunningPostState,
  verifyWooCommerceOrphanedRunningStable,
} from './lib/woocommerce-final-orphaned-running-recovery.js';

const repositoryRoot = resolve(process.cwd());
let syncRunMutationCount = 0;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'woocommerce-final-orphaned-running-recovery',
    code: error?.code ?? 'WOOCOMMERCE_ORPHANED_RUNNING_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    syncRunMutationCount,
    durableWorkMutationCount: 0,
    businessMutationCount: 0,
    coverageMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const options = parseWooCommerceOrphanedRunningRecoveryArgs(
    process.argv.slice(2),
  );
  if (!options.execute) {
    printPlan(options.operationId);
    return;
  }

  const env = Object.freeze({
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  });
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(
    env.MKT_CUSTOMER_PROFILE,
    'integration_workspace',
    'MKT_CUSTOMER_PROFILE',
  );
  requireExact(
    env.MKT_CONNECTION_CUSTOMER_KEY,
    'chemistry_k',
    'MKT_CONNECTION_CUSTOMER_KEY',
  );
  assertWooCommerceOrphanedRunningRecoveryConfirmation(env);

  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  requireExact(gitText(['branch', '--show-current']), 'main', 'git branch');
  const workingTree = gitText(
    ['status', '--porcelain', '--untracked-files=all'],
    false,
  );
  if (workingTree.trim() !== '') {
    throw operatorError(
      'Orphaned-running recovery requires a clean Working Tree',
      'WOOCOMMERCE_ORPHANED_RUNNING_REPOSITORY_DIRTY',
    );
  }

  const configPath = resolveRepositoryFile(
    env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const databaseName = env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME
    ?? 'social-mkt-state-dev';
  const evidenceRoot = resolve(
    env.MKT_WOOCOMMERCE_ORPHANED_RUNNING_EVIDENCE_DIR
      ?? join(
        'outputs',
        'woocommerce-orphaned-running-recovery',
        repositoryHead,
      ),
  );
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  const snapshotSql = buildWooCommerceOrphanedRunningSnapshotSql({
    accountKey: 'chemistry_k',
    operationId: options.operationId,
  });

  const beforeRead = runReadOnlyD1({
    databaseName,
    configPath,
    sql: snapshotSql,
    env,
  });
  const beforeRow = parseSingleRow(beforeRead.stdout, 'initial-preflight');
  const before = verifyWooCommerceOrphanedRunningEligibility(beforeRow);
  await writePrivateJson(join(evidenceRoot, '01-initial-preflight.json'), {
    repositoryHead,
    operationIdFingerprint: sha256(options.operationId),
    immutableFingerprint: before.immutableFingerprint,
    snapshot: sanitizedSnapshot(before.evidence),
    remoteReadAttempts: beforeRead.attempts,
    remoteMutationCount: 0,
    production: false,
  });

  const stabilityWindowMs = getWooCommerceOrphanedRunningStabilityWindowMs();
  await sleep(stabilityWindowMs);

  const stableRead = runReadOnlyD1({
    databaseName,
    configPath,
    sql: snapshotSql,
    env,
  });
  const stableRow = parseSingleRow(stableRead.stdout, 'stability-preflight');
  const stableEligibility = verifyWooCommerceOrphanedRunningEligibility(stableRow);
  const stability = verifyWooCommerceOrphanedRunningStable(
    before,
    stableEligibility,
  );
  await writePrivateJson(join(evidenceRoot, '02-stability-preflight.json'), {
    repositoryHead,
    operationIdFingerprint: sha256(options.operationId),
    immutableFingerprint: stability.immutableFingerprint,
    elapsedMs: stability.elapsedMs,
    snapshot: sanitizedSnapshot(stability.evidence),
    remoteReadAttempts: stableRead.attempts,
    remoteMutationCount: 0,
    production: false,
  });

  const auditReference = `woocommerce-orphan-recovery:${repositoryHead}`;
  const mutationSql = buildWooCommerceOrphanedRunningRecoverySql({
    stability,
    auditReference,
  });
  const mutation = runMutationOnce({
    databaseName,
    configPath,
    sql: mutationSql,
    env,
  });
  const mutationRows = parseWranglerD1Rows(mutation.stdout);
  const mutationEvidence = verifyWooCommerceOrphanedRunningMutation(
    mutationRows.at(-1),
    { auditReference },
  );
  syncRunMutationCount = 1;

  const afterRead = runReadOnlyD1({
    databaseName,
    configPath,
    sql: snapshotSql,
    env,
  });
  const afterRow = parseSingleRow(afterRead.stdout, 'post-verification');
  const post = verifyWooCommerceOrphanedRunningPostState(afterRow, {
    immutableFingerprint: stability.immutableFingerprint,
    auditReference,
  });
  await writePrivateJson(join(evidenceRoot, '03-recovery-summary.json'), {
    repositoryHead,
    operationIdFingerprint: sha256(options.operationId),
    decision: 'ORPHANED_SYNC_MARKED_RETRYABLE',
    immutableFingerprint: post.immutableFingerprint,
    snapshot: sanitizedSnapshot(post.evidence),
    workKeyFingerprint: mutationEvidence.workKeyFingerprint,
    auditReferenceFingerprint: mutationEvidence.auditReferenceFingerprint,
    remoteReadAttempts:
      beforeRead.attempts + stableRead.attempts + afterRead.attempts,
    syncRunMutationCount: 1,
    durableWorkMutationCount: 0,
    businessMutationCount: 0,
    coverageMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
    production: false,
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-final-orphaned-running-recovery',
    repositoryHead,
    operationId: options.operationId,
    decision: 'ORPHANED_SYNC_MARKED_RETRYABLE',
    nextAction: 'resume_same_operation_through_canonical_completion',
    syncRunStatus: post.evidence.snapshot.syncRunStatus,
    syncRunErrorCode: post.evidence.snapshot.syncRunErrorCode,
    syncRunRetryable: post.evidence.snapshot.syncRunRetryable,
    workLifecycleStatus: post.evidence.snapshot.workLifecycleStatus,
    phaseComplete: post.evidence.snapshot.phaseComplete,
    activeLockCount: post.evidence.snapshot.activeLockCount,
    queueOperationAttempts: post.evidence.snapshot.queueOperationAttempts,
    coverageRunCount: post.evidence.snapshot.coverageRunCount,
    invalidCoverageCount: post.evidence.snapshot.invalidCoverageCount,
    immutableFingerprint: post.immutableFingerprint,
    remoteReadAttempts:
      beforeRead.attempts + stableRead.attempts + afterRead.attempts,
    syncRunMutationCount: 1,
    durableWorkMutationCount: 0,
    businessMutationCount: 0,
    coverageMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
    production: false,
    evidenceRoot,
  }, null, 2)}\n`);
}

function printPlan(operationId) {
  const { envName, value } = WOOCOMMERCE_ORPHANED_RUNNING_CONFIRMATION;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    stage: 'woocommerce-final-orphaned-running-recovery-plan',
    operationId,
    confirmation: `${envName}=${value}`,
    phases: [
      'exact-read-only-preflight',
      'thirty-second-read-only-stability-proof',
      'one-guarded-sync-run-state-transition',
      'read-only-post-verification',
    ],
    remoteMutation:
      'one exact sync_runs row: running to retryable failed; durable work remains active',
    syncRunMutationCount: 0,
    durableWorkMutationCount: 0,
    businessMutationCount: 0,
    coverageMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
    scheduleEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

function runReadOnlyD1({ databaseName, configPath, sql, env }) {
  const args = wranglerArgs({ databaseName, configPath, sql });
  const classification = classifyWooCommerceD1ReadCommand(args);
  if (!classification.eligible) {
    throw operatorError(
      'Orphaned-running snapshot command is not provably read-only',
      'WOOCOMMERCE_ORPHANED_RUNNING_READ_NOT_ELIGIBLE',
    );
  }
  const maxAttempts = wooCommerceD1ReadMaxAttempts();
  let result = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = spawnSync('npx', args, {
      cwd: repositoryRoot,
      env,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!result.error && result.status === 0) {
      return Object.freeze({
        stdout: String(result.stdout ?? ''),
        attempts: attempt,
      });
    }
    const delayMs = wooCommerceD1ReadRetryDelay(attempt);
    if (delayMs === null) break;
    wait(delayMs);
  }
  throw operatorError(
    'Orphaned-running read failed after bounded retries',
    'WOOCOMMERCE_ORPHANED_RUNNING_READ_FAILED',
    {
      status: result?.status ?? null,
      attempts: maxAttempts,
      stderrSha256: sha256(String(result?.stderr ?? '')),
    },
  );
}

function runMutationOnce({ databaseName, configPath, sql, env }) {
  const result = spawnSync('npx', wranglerArgs({
    databaseName,
    configPath,
    sql,
  }), {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw operatorError(
      'Orphaned-running mutation failed and was not retried',
      'WOOCOMMERCE_ORPHANED_RUNNING_MUTATION_FAILED',
      {
        status: result.status ?? null,
        stderrSha256: sha256(String(result.stderr ?? '')),
      },
    );
  }
  return Object.freeze({ stdout: String(result.stdout ?? '') });
}

function wranglerArgs({ databaseName, configPath, sql }) {
  return [
    'wrangler',
    'd1',
    'execute',
    databaseName,
    '--remote',
    '--json',
    '--config',
    configPath,
    '--command',
    sql,
  ];
}

function parseSingleRow(output, stage) {
  const rows = parseWranglerD1Rows(output);
  if (rows.length !== 1) {
    throw operatorError(
      `Orphaned-running ${stage} returned an unexpected row count`,
      'WOOCOMMERCE_ORPHANED_RUNNING_SNAPSHOT_INVALID',
      { stage, rowCount: rows.length },
    );
  }
  return rows[0];
}

function sanitizedSnapshot(evidence) {
  const snapshot = evidence.snapshot;
  return Object.freeze({
    syncRunStatus: snapshot.syncRunStatus,
    syncRunFinishedAtPresent: snapshot.syncRunFinishedAt !== null,
    syncRunErrorCode: snapshot.syncRunErrorCode,
    syncRunRetryable: snapshot.syncRunRetryable,
    workLifecycleStatus: snapshot.workLifecycleStatus,
    workCompletedAtPresent: snapshot.workCompletedAt !== null,
    completionPresent: snapshot.completion !== null,
    phaseComplete: snapshot.phaseComplete,
    datasetIndex: snapshot.state?.datasetIndex ?? null,
    page: snapshot.state?.page ?? null,
    activeLockCount: snapshot.activeLockCount,
    queueOperationAttempts: snapshot.queueOperationAttempts,
    coverageRunCount: snapshot.coverageRunCount,
    invalidCoverageCount: snapshot.invalidCoverageCount,
    counts: snapshot.counts,
  });
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function gitText(args, check = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || (check && result.status !== 0)) {
    throw operatorError(
      `git ${args.join(' ')} failed`,
      'WOOCOMMERCE_ORPHANED_RUNNING_GIT_FAILED',
      { status: result.status ?? null },
    );
  }
  return String(result.stdout ?? '').trim();
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, String(value));
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}/`)) {
    throw operatorError(
      'Orphaned-running config path must remain inside Repository',
      'WOOCOMMERCE_ORPHANED_RUNNING_PATH_INVALID',
    );
  }
  return path;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw operatorError(
      `${fieldName} must equal ${expected}`,
      'WOOCOMMERCE_ORPHANED_RUNNING_TARGET_INVALID',
      { fieldName, expected },
    );
  }
}

function wait(milliseconds) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, milliseconds);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:secret|token|authorization|password)/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function operatorError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'WooCommerceOrphanedRunningRecoveryOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
