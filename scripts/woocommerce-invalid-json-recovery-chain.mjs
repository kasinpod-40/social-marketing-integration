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
  buildWooCommerceFinalRecoveryOnlySnapshotSql,
  classifyWooCommerceFinalRecoveryOnlyState,
  WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION,
} from './lib/woocommerce-final-recovery-only.js';
import {
  parseWranglerD1Rows,
} from './lib/woocommerce-final-failed-work-recovery.js';
import {
  classifyWooCommerceD1ReadCommand,
  wooCommerceD1ReadMaxAttempts,
  wooCommerceD1ReadRetryDelay,
} from './lib/woocommerce-d1-read-retry.js';
import {
  WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIRMATION,
} from './lib/woocommerce-worker-provider-diagnostics.js';
import {
  WOOCOMMERCE_2026_COMPLETION_CONFIRMATION,
} from './lib/woocommerce-2026-completion-one-command.js';

const repositoryRoot = resolve(process.cwd());
const INCIDENT_OPERATION_ID = 'woo-final-full-5b56469100a9';
const CHAIN_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_WOOCOMMERCE_INVALID_JSON_RECOVERY_CHAIN',
  value: 'RECOVER_WOO_FINAL_FULL_5B56469100A9_AND_COMPLETE',
});
const DEFAULT_DATABASE = 'social-mkt-state-dev';

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'woocommerce-invalid-json-recovery-chain',
    code: error?.code ?? 'WOOCOMMERCE_INVALID_JSON_RECOVERY_CHAIN_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
    return;
  }

  const env = Object.freeze({
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  });
  requireExact(env[CHAIN_CONFIRMATION.envName], CHAIN_CONFIRMATION.value, CHAIN_CONFIRMATION.envName);
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  requireExact(gitText(['branch', '--show-current']), 'main', 'git branch');
  const workingTree = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (workingTree.trim() !== '') {
    throw chainError(
      'WooCommerce invalid-JSON recovery chain requires a clean Working Tree',
      'WOOCOMMERCE_INVALID_JSON_RECOVERY_REPOSITORY_DIRTY',
    );
  }

  const configPath = resolveRepositoryFile(
    env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const databaseName = env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME ?? DEFAULT_DATABASE;
  const evidenceRoot = resolve(
    env.MKT_WOOCOMMERCE_INVALID_JSON_RECOVERY_EVIDENCE_DIR
      ?? join('outputs', 'woocommerce-invalid-json-recovery-chain', repositoryHead),
  );
  const completionEvidenceRoot = resolve(
    env.MKT_WOOCOMMERCE_2026_COMPLETION_EVIDENCE_DIR
      ?? join(evidenceRoot, 'completion'),
  );
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  const before = readIncidentState({ env, configPath, databaseName });
  const classified = classifyWooCommerceFinalRecoveryOnlyState(before.row, {
    operationId: INCIDENT_OPERATION_ID,
  });
  await writePrivateJson(join(evidenceRoot, '01-incident-preflight.json'), {
    repositoryHead,
    operationIdFingerprint: sha256(INCIDENT_OPERATION_ID),
    state: classified.state,
    syncRunStatus: classified.result.snapshot.syncRunStatus,
    syncRunErrorCode: classified.result.snapshot.syncRunErrorCode,
    workLifecycleStatus: classified.result.snapshot.workLifecycleStatus,
    activeLockCount: classified.result.snapshot.activeLockCount,
    queueOperationAttempts: classified.result.snapshot.queueOperationAttempts,
    coverageRunCount: classified.result.snapshot.coverageRunCount,
    incidentBusinessRows: classified.result.incidentBusinessRows,
    retainedBusinessRows: classified.result.retainedBusinessRows,
    remoteReadAttempts: before.attempts,
    production: false,
  });

  runRequiredNodeStep(
    'woocommerce-worker-provider-diagnostics',
    ['scripts/woocommerce-worker-provider-diagnostics.mjs', '--execute'],
    {
      ...env,
      [WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIRMATION.envName]:
        WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIRMATION.value,
      MKT_WOOCOMMERCE_WORKER_DIAGNOSTICS_EVIDENCE_DIR:
        join(evidenceRoot, 'provider-diagnostics'),
    },
  );

  let recoveryExecuted = false;
  if (classified.state === 'active_recovery_required') {
    runRequiredNodeStep(
      'woocommerce-final-recovery-only',
      [
        'scripts/woocommerce-final-recovery-only.mjs',
        '--operation-id',
        INCIDENT_OPERATION_ID,
        '--execute',
      ],
      {
        ...env,
        [WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION.envName]:
          WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION.value,
      },
    );
    recoveryExecuted = true;
  }

  const after = readIncidentState({ env, configPath, databaseName });
  const recovered = classifyWooCommerceFinalRecoveryOnlyState(after.row, {
    operationId: INCIDENT_OPERATION_ID,
  });
  if (recovered.state !== 'terminal_recovery_complete') {
    throw chainError(
      'WooCommerce invalid-JSON incident did not reach the exact terminal recovery state',
      'WOOCOMMERCE_INVALID_JSON_RECOVERY_POST_STATE_INVALID',
      { state: recovered.state },
    );
  }
  await writePrivateJson(join(evidenceRoot, '02-recovery-summary.json'), {
    repositoryHead,
    operationIdFingerprint: sha256(INCIDENT_OPERATION_ID),
    recoveryExecuted,
    state: recovered.state,
    syncRunStatus: recovered.result.snapshot.syncRunStatus,
    syncRunErrorCode: recovered.result.snapshot.syncRunErrorCode,
    workLifecycleStatus: recovered.result.snapshot.workLifecycleStatus,
    activeLockCount: recovered.result.snapshot.activeLockCount,
    queueOperationAttempts: recovered.result.snapshot.queueOperationAttempts,
    coverageRunCount: recovered.result.snapshot.coverageRunCount,
    incidentBusinessRows: recovered.result.incidentBusinessRows,
    retainedBusinessRows: recovered.result.retainedBusinessRows,
    remoteReadAttempts: after.attempts,
    providerDiagnosticsPassed: true,
    production: false,
  });

  runRequiredNodeStep(
    'woocommerce-2026-completion-canonical',
    ['scripts/woocommerce-2026-completion-canonical-launcher.mjs', '--execute'],
    {
      ...env,
      CONFIRM_WOOCOMMERCE_2026_COMPLETION:
        WOOCOMMERCE_2026_COMPLETION_CONFIRMATION,
      MKT_WOOCOMMERCE_2026_COMPLETION_EVIDENCE_DIR:
        completionEvidenceRoot,
    },
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-invalid-json-recovery-chain',
    repositoryHead,
    operationId: INCIDENT_OPERATION_ID,
    providerDiagnosticsPassed: true,
    recoveryExecuted,
    incidentTerminalized: true,
    completionDelegated: true,
    nextStep: 'verify_woocommerce_completion_then_resume_pinned_meta',
    production: false,
    evidenceRoot,
    completionEvidenceRoot,
  }, null, 2)}\n`);
}

function parseArgs(args) {
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') execute = true;
    else throw chainError(
      `Unknown WooCommerce invalid-JSON recovery argument: ${arg}`,
      'WOOCOMMERCE_INVALID_JSON_RECOVERY_ARGUMENT_INVALID',
    );
  }
  return execute;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    stage: 'woocommerce-invalid-json-recovery-chain-plan',
    confirmation: `${CHAIN_CONFIRMATION.envName}=${CHAIN_CONFIRMATION.value}`,
    exactOperationId: INCIDENT_OPERATION_ID,
    phases: [
      'exact-read-only-incident-preflight',
      'guarded-provider-get-only-diagnostics',
      'exact-zero-fact-lifecycle-only-recovery',
      'verified-terminal-post-state',
      'existing-woocommerce-2026-canonical-completion',
    ],
    forbidden: [
      'resume-terminal-invalid-json-operation',
      'generic-invalid-json-retry-classification',
      'manual-business-row-edit',
      'production-deployment',
      'schedule-enable',
    ],
    production: false,
  }, null, 2)}\n`);
}

function readIncidentState({ env, configPath, databaseName }) {
  const sql = buildWooCommerceFinalRecoveryOnlySnapshotSql({
    accountKey: 'chemistry_k',
    operationId: INCIDENT_OPERATION_ID,
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
    throw chainError(
      'WooCommerce invalid-JSON incident snapshot command is not provably read-only',
      'WOOCOMMERCE_INVALID_JSON_RECOVERY_READ_NOT_ELIGIBLE',
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
      const rows = parseWranglerD1Rows(String(result.stdout ?? ''));
      if (rows.length !== 1) {
        throw chainError(
          'WooCommerce invalid-JSON incident snapshot returned an unexpected row count',
          'WOOCOMMERCE_INVALID_JSON_RECOVERY_SNAPSHOT_INVALID',
          { rowCount: rows.length },
        );
      }
      return Object.freeze({ row: rows[0], attempts: attempt });
    }
    const delayMs = wooCommerceD1ReadRetryDelay(attempt);
    if (delayMs === null) break;
    wait(delayMs);
  }
  throw chainError(
    'WooCommerce invalid-JSON incident read failed after bounded retries',
    'WOOCOMMERCE_INVALID_JSON_RECOVERY_READ_FAILED',
    {
      attempts: maxAttempts,
      status: result?.status ?? null,
      stderrSha256: sha256(String(result?.stderr ?? '')),
    },
  );
}

function runRequiredNodeStep(name, args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw chainError(
      `Command failed during WooCommerce invalid-JSON recovery chain: ${name}`,
      'WOOCOMMERCE_INVALID_JSON_RECOVERY_REQUIRED_STEP_FAILED',
      { name, exitCode: result.status ?? null },
    );
  }
}

function gitText(args, check = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || (check && result.status !== 0)) {
    throw chainError(
      `git ${args.join(' ')} failed`,
      'WOOCOMMERCE_INVALID_JSON_RECOVERY_GIT_FAILED',
      { status: result.status ?? null },
    );
  }
  return String(result.stdout ?? '').trim();
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, String(value));
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}/`)) {
    throw chainError(
      'WooCommerce invalid-JSON recovery config path must remain inside Repository',
      'WOOCOMMERCE_INVALID_JSON_RECOVERY_PATH_INVALID',
    );
  }
  return path;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw chainError(
      `${fieldName} must equal ${expected}`,
      'WOOCOMMERCE_INVALID_JSON_RECOVERY_TARGET_INVALID',
      { fieldName, expected },
    );
  }
}

function wait(milliseconds) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, milliseconds);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:secret|token|authorization|password)/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function chainError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'WooCommerceInvalidJsonRecoveryChainError';
  error.code = code;
  error.details = details;
  return error;
}
