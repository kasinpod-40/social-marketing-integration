#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  buildWooCommerceFinalSnapshotSql,
  safeWooCommerceFinalEvidence,
} from './lib/woocommerce-final-rollout-operator.js';
import {
  classifyWooCommerceD1ReadCommand,
  wooCommerceD1ReadMaxAttempts,
  wooCommerceD1ReadRetryDelay,
} from './lib/woocommerce-d1-read-retry.js';
import {
  classifyWooCommerceFinalOperationInspection,
} from './lib/woocommerce-final-operation-inspector.js';

const repositoryRoot = resolve(process.cwd());

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'woocommerce-final-operation-inspection',
    code: error?.code ?? 'WOOCOMMERCE_FINAL_OPERATION_INSPECTION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: safeWooCommerceFinalEvidence(error?.details ?? {}),
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
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

  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  const workingTree = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (workingTree.trim() !== '') {
    throw inspectionError(
      'WooCommerce operation inspection requires a clean Working Tree',
      'WOOCOMMERCE_FINAL_OPERATION_INSPECTION_REPOSITORY_DIRTY',
    );
  }

  const configPath = resolveRepositoryFile(
    env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const databaseName = env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME
    ?? 'social-mkt-state-dev';
  const sql = buildWooCommerceFinalSnapshotSql({
    accountKey: 'chemistry_k',
    operationId: options.operationId,
  });
  const args = [
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
  const classification = classifyWooCommerceD1ReadCommand(args);
  if (!classification.eligible) {
    throw inspectionError(
      'Generated WooCommerce inspection command is not provably read-only',
      'WOOCOMMERCE_FINAL_OPERATION_INSPECTION_NOT_READ_ONLY',
    );
  }

  const execution = runReadOnlyD1(args, env);
  const row = parseFirstD1Row(execution.stdout);
  const inspection = classifyWooCommerceFinalOperationInspection(row, {
    fullReconciliation: options.operationId.startsWith('woo-final-full-'),
  });
  const snapshot = inspection.snapshot;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-final-operation-inspection',
    repositoryHead,
    operationId: options.operationId,
    decision: inspection.decision,
    complete: inspection.complete,
    nextAction: inspection.nextAction,
    syncRunStatus: snapshot.syncRunStatus,
    syncRunFinishedAt: snapshot.syncRunFinishedAt,
    syncRunErrorCode: snapshot.syncRunErrorCode,
    workLifecycleStatus: snapshot.workLifecycleStatus,
    workCompletedAt: snapshot.workCompletedAt,
    phaseComplete: snapshot.phaseComplete,
    activeLockCount: snapshot.activeLockCount,
    queueOperationAttempts: snapshot.queueOperationAttempts,
    coverageRunCount: snapshot.coverageRunCount,
    invalidCoverageCount: snapshot.invalidCoverageCount,
    counts: snapshot.counts,
    state: safeWooCommerceFinalEvidence(snapshot.state),
    completion: safeWooCommerceFinalEvidence(snapshot.completion),
    remoteReadAttempts: execution.attempts,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
  }, null, 2)}\n`);
}

function printPlan(operationId) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    stage: 'woocommerce-final-operation-inspection-plan',
    operationId,
    command: `node scripts/woocommerce-final-operation-inspect.mjs --operation-id ${operationId} --execute`,
    remoteAction: 'one bounded read-only D1 snapshot with retry',
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    larkRequestCount: 0,
  }, null, 2)}\n`);
}

function parseArgs(args) {
  let execute = false;
  let operationId = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg === '--operation-id') {
      operationId = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--operation-id=')) {
      operationId = arg.slice('--operation-id='.length);
      continue;
    }
    throw inspectionError(
      `Unknown WooCommerce operation inspection argument: ${arg}`,
      'WOOCOMMERCE_FINAL_OPERATION_INSPECTION_ARGUMENT_INVALID',
    );
  }
  if (!/^woo-final-(?:full|incremental)-[0-9a-f]{12}$/u.test(operationId ?? '')) {
    throw inspectionError(
      'A valid --operation-id is required',
      'WOOCOMMERCE_FINAL_OPERATION_INSPECTION_ID_INVALID',
    );
  }
  return Object.freeze({ execute, operationId });
}

function runReadOnlyD1(args, env) {
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
    process.stderr.write(`${JSON.stringify({
      ok: true,
      stage: 'woocommerce-final-operation-inspection-read-retry',
      attempt,
      maxAttempts,
      delayMs,
      exitStatus: result.status ?? null,
      businessMutationCount: 0,
    })}\n`);
    wait(delayMs);
  }
  throw inspectionError(
    'Remote D1 read failed after bounded retries',
    'WOOCOMMERCE_FINAL_OPERATION_INSPECTION_D1_READ_FAILED',
    {
      status: result?.status ?? null,
      attempts: maxAttempts,
      stderrSha256: createHash('sha256')
        .update(String(result?.stderr ?? ''))
        .digest('hex'),
    },
  );
}

function parseFirstD1Row(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw inspectionError(
      'Remote D1 inspection returned invalid JSON',
      'WOOCOMMERCE_FINAL_OPERATION_INSPECTION_D1_JSON_INVALID',
      { stdoutSha256: createHash('sha256').update(output).digest('hex') },
    );
  }
  const row = Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])[0]
    : parsed?.results?.[0];
  if (!row) {
    throw inspectionError(
      'Remote D1 inspection returned no row',
      'WOOCOMMERCE_FINAL_OPERATION_INSPECTION_D1_EMPTY',
    );
  }
  return row;
}

function gitText(args, check = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || (check && result.status !== 0)) {
    throw inspectionError(
      `git ${args.join(' ')} failed`,
      'WOOCOMMERCE_FINAL_OPERATION_INSPECTION_GIT_FAILED',
      { status: result.status ?? null },
    );
  }
  return String(result.stdout ?? '').trim();
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, String(value));
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}/`)) {
    throw inspectionError(
      'Wrangler config path must remain inside Repository',
      'WOOCOMMERCE_FINAL_OPERATION_INSPECTION_PATH_INVALID',
    );
  }
  return path;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw inspectionError(
      `${fieldName} must equal ${expected}`,
      'WOOCOMMERCE_FINAL_OPERATION_INSPECTION_TARGET_INVALID',
      { fieldName, expected },
    );
  }
}

function wait(milliseconds) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, milliseconds);
}

function inspectionError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceFinalOperationInspectionError';
  error.code = code;
  error.details = details;
  return error;
}
