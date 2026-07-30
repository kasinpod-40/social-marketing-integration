#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  parseWranglerD1Rows,
  verifyWooCommerceFailedWorkRecovery,
} from './lib/woocommerce-final-failed-work-recovery.js';
import {
  WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION,
  assertWooCommerceFinalRecoveryOnlyConfirmation,
  buildWooCommerceFinalRecoveryOnlyMutationSql,
  buildWooCommerceFinalRecoveryOnlySnapshotSql,
  parseWooCommerceFinalRecoveryOnlyArgs,
  verifyWooCommerceFinalRecoveryOnlyEligibility,
  verifyWooCommerceFinalRecoveryOnlyPostState,
} from './lib/woocommerce-final-recovery-only.js';
import {
  classifyWooCommerceD1ReadCommand,
  wooCommerceD1ReadMaxAttempts,
  wooCommerceD1ReadRetryDelay,
} from './lib/woocommerce-d1-read-retry.js';

const repositoryRoot = resolve(process.cwd());

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'woocommerce-final-recovery-only',
    code: error?.code ?? 'WOOCOMMERCE_RECOVERY_ONLY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    durableLifecycleMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const options = parseWooCommerceFinalRecoveryOnlyArgs(process.argv.slice(2));
  if (!options.execute) {
    printPlan(options.operationId);
    return;
  }

  const env = Object.freeze({
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  });
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  assertWooCommerceFinalRecoveryOnlyConfirmation(env);

  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  requireExact(gitText(['branch', '--show-current']), 'main', 'git branch');
  const workingTree = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (workingTree.trim() !== '') {
    throw operatorError(
      'WooCommerce recovery-only execution requires a clean Working Tree',
      'WOOCOMMERCE_RECOVERY_ONLY_REPOSITORY_DIRTY',
    );
  }

  const configPath = resolveRepositoryFile(
    env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const databaseName = env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME
    ?? 'social-mkt-state-dev';
  const snapshotSql = buildWooCommerceFinalRecoveryOnlySnapshotSql({
    accountKey: 'chemistry_k',
    operationId: options.operationId,
  });

  const beforeRead = runReadOnlyD1({ databaseName, configPath, sql: snapshotSql, env });
  const beforeRow = parseSingleRow(beforeRead.stdout, 'preflight');
  const eligibility = verifyWooCommerceFinalRecoveryOnlyEligibility(beforeRow, {
    operationId: options.operationId,
  });

  const auditReference = `woocommerce-final-recovery:${repositoryHead}`;
  const mutationSql = buildWooCommerceFinalRecoveryOnlyMutationSql({
    operationId: options.operationId,
    auditReference,
  });
  const mutation = runMutationOnce({ databaseName, configPath, sql: mutationSql, env });
  const mutationRows = parseWranglerD1Rows(mutation.stdout);
  const recovery = verifyWooCommerceFailedWorkRecovery({
    expectedWorkKey: eligibility.workKey,
    row: mutationRows.at(-1),
  });

  const afterRead = runReadOnlyD1({ databaseName, configPath, sql: snapshotSql, env });
  const afterRow = parseSingleRow(afterRead.stdout, 'post-verification');
  const post = verifyWooCommerceFinalRecoveryOnlyPostState(afterRow, {
    operationId: options.operationId,
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-final-recovery-only',
    repositoryHead,
    operationId: options.operationId,
    decision: 'RECOVERED_TERMINAL',
    nextAction: 'run_read_only_inspector_then_authorize_guarded_final_rollout',
    syncRunStatus: post.snapshot.syncRunStatus,
    syncRunErrorCode: post.snapshot.syncRunErrorCode,
    workLifecycleStatus: post.snapshot.workLifecycleStatus,
    activeLockCount: post.snapshot.activeLockCount,
    queueOperationAttempts: post.snapshot.queueOperationAttempts,
    coverageRunCount: post.snapshot.coverageRunCount,
    incidentBusinessRowsBefore: eligibility.incidentBusinessRows,
    incidentBusinessRowsAfter: post.incidentBusinessRows,
    retainedBusinessRowsBefore: eligibility.retainedBusinessRows,
    retainedBusinessRowsAfter: post.retainedBusinessRows,
    workKeyFingerprint: recovery.workKeyFingerprint,
    auditReferenceFingerprint: recovery.auditReferenceFingerprint,
    remoteReadAttempts: beforeRead.attempts + afterRead.attempts,
    durableLifecycleMutationCount: 1,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
  }, null, 2)}\n`);
}

function printPlan(operationId) {
  const { envName, value } = WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    stage: 'woocommerce-final-recovery-only-plan',
    operationId,
    confirmation: `${envName}=${value}`,
    remoteAction: 'one exact guarded sync_work_runs lifecycle update with read-only pre/post verification',
    durableLifecycleMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
  }, null, 2)}\n`);
}

function runReadOnlyD1({ databaseName, configPath, sql, env }) {
  const args = wranglerArgs({ databaseName, configPath, sql });
  const classification = classifyWooCommerceD1ReadCommand(args);
  if (!classification.eligible) {
    throw operatorError(
      'WooCommerce recovery-only snapshot command is not provably read-only',
      'WOOCOMMERCE_RECOVERY_ONLY_READ_NOT_ELIGIBLE',
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
      return Object.freeze({ stdout: String(result.stdout ?? ''), attempts: attempt });
    }
    const delayMs = wooCommerceD1ReadRetryDelay(attempt);
    if (delayMs === null) break;
    wait(delayMs);
  }
  throw operatorError(
    'WooCommerce recovery-only read failed after bounded retries',
    'WOOCOMMERCE_RECOVERY_ONLY_READ_FAILED',
    {
      status: result?.status ?? null,
      attempts: maxAttempts,
      stderrSha256: sha256(String(result?.stderr ?? '')),
    },
  );
}

function runMutationOnce({ databaseName, configPath, sql, env }) {
  const result = spawnSync('npx', wranglerArgs({ databaseName, configPath, sql }), {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw operatorError(
      'WooCommerce recovery-only mutation failed and was not retried',
      'WOOCOMMERCE_RECOVERY_ONLY_MUTATION_FAILED',
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
      `WooCommerce recovery-only ${stage} returned an unexpected row count`,
      'WOOCOMMERCE_RECOVERY_ONLY_SNAPSHOT_INVALID',
      { stage, rowCount: rows.length },
    );
  }
  return rows[0];
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
      'WOOCOMMERCE_RECOVERY_ONLY_GIT_FAILED',
      { status: result.status ?? null },
    );
  }
  return String(result.stdout ?? '').trim();
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, String(value));
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}/`)) {
    throw operatorError(
      'WooCommerce recovery-only config path must remain inside Repository',
      'WOOCOMMERCE_RECOVERY_ONLY_PATH_INVALID',
    );
  }
  return path;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw operatorError(
      `${fieldName} must equal ${expected}`,
      'WOOCOMMERCE_RECOVERY_ONLY_TARGET_INVALID',
      { fieldName, expected },
    );
  }
}

function wait(milliseconds) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, milliseconds);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitize(nested)]));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function operatorError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'WooCommerceFinalRecoveryOnlyOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
