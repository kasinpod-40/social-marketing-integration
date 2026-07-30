#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  FINAL_DELIVERY_META_HEAD,
  FINAL_DELIVERY_META_OPERATION_ID,
  FINAL_DELIVERY_READINESS_CONFIRMATION,
  assertFinalDeliveryReadinessManifest,
  inspectMetaSession,
} from './lib/final-delivery-readiness.js';
import {
  validateWooCommerce2026FinalSummary,
} from './lib/woocommerce-2026-completion-one-command.js';

const repositoryRoot = resolve(process.cwd());
const confirmationName = 'CONFIRM_MKT_FINAL_DELIVERY_EXECUTION';
const confirmationValue = 'EXECUTE_FROM_READY_MANIFEST';
let currentStage = 'init';

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) printPlan();
  else await executeFromManifest();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'FINAL_DELIVERY_EXECUTION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeFromManifest() {
  requireExact(process.env[confirmationName], confirmationValue, confirmationName);
  currentStage = 'validate-exact-clean-main';
  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const branch = gitText(['branch', '--show-current']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (branch !== 'main' || repositoryHead !== originMain || dirty.trim() !== '') {
    throw executionError(
      'Final delivery executor requires exact clean main equal to origin/main',
      'FINAL_DELIVERY_EXECUTION_REPOSITORY_INVALID',
      { branch, repositoryHead, originMain, clean: dirty.trim() === '' },
    );
  }

  currentStage = 'validate-manifest-and-local-inputs';
  const manifestPath = resolveRequiredPath(
    process.env.MKT_FINAL_DELIVERY_READINESS_MANIFEST,
    'MKT_FINAL_DELIVERY_READINESS_MANIFEST',
  );
  await assertPrivateRegularFile(manifestPath, 'readiness manifest');
  const manifest = parseJson(await readFile(manifestPath, 'utf8'), 'readiness manifest');
  const devVarsPath = resolveRequiredPath(
    process.env.DEV_VARS_FILE ?? '.dev.vars',
    'DEV_VARS_FILE',
  );
  const configPath = resolveRequiredPath(
    process.env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
    'MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG',
  );
  await assertPrivateRegularFile(devVarsPath, 'DEV_VARS_FILE');
  await assertPrivateRegularFile(configPath, 'Wrangler config');
  const verified = assertFinalDeliveryReadinessManifest(manifest, {
    repositoryHead,
    devVarsSha256: digest(await readFile(devVarsPath)),
    wranglerConfigSha256: digest(await readFile(configPath)),
  });
  const fileEnv = await readDevVars(devVarsPath);
  const env = {
    ...fileEnv,
    ...process.env,
    DEV_VARS_FILE: devVarsPath,
    MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: configPath,
    CLOUDFLARE_ACCOUNT_ID: verified.cloudflare.accountId,
    MKT_WOOCOMMERCE_FINAL_QUEUE_ID: verified.cloudflare.queueId,
    MKT_WOOCOMMERCE_WORKERS_DEV_SUBDOMAIN:
      verified.cloudflare.workersDevSubdomain,
  };
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  const evidenceRoot = resolve(
    process.env.MKT_FINAL_DELIVERY_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'final-delivery', repositoryHead),
  );
  const wooRecoveryRoot = join(evidenceRoot, 'woocommerce-invalid-json-recovery');
  const wooCompletionRoot = join(evidenceRoot, 'woocommerce-2026-completion');
  const checkpointPath = join(evidenceRoot, 'checkpoint.json');
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  let checkpoint = await readCheckpoint(checkpointPath, repositoryHead);

  currentStage = 'woocommerce-recovery-and-completion';
  const completionSummaryPath = join(
    wooCompletionRoot,
    repositoryHead,
    'woocommerce-2026-completion-summary.json',
  );
  let wooCompleted = false;
  const existingSummary = await readJsonIfExists(completionSummaryPath);
  if (existingSummary) {
    validateCompletionSummary(existingSummary, repositoryHead);
    wooCompleted = true;
  }
  if (!wooCompleted) {
    runRequiredNode(
      'woocommerce-invalid-json-recovery-chain',
      ['scripts/woocommerce-invalid-json-recovery-chain.mjs', '--execute'],
      {
        ...env,
        CONFIRM_WOOCOMMERCE_INVALID_JSON_RECOVERY_CHAIN:
          'RECOVER_WOO_FINAL_FULL_5B56469100A9_AND_COMPLETE',
        MKT_WOOCOMMERCE_INVALID_JSON_RECOVERY_EVIDENCE_DIR: wooRecoveryRoot,
        MKT_WOOCOMMERCE_2026_COMPLETION_EVIDENCE_DIR: wooCompletionRoot,
      },
    );
    const summary = await readRequiredJson(completionSummaryPath, 'Woo completion summary');
    validateCompletionSummary(summary, repositoryHead);
  }
  checkpoint = await writeCheckpoint(checkpointPath, {
    ...checkpoint,
    repositoryHead,
    wooCompleted: true,
    wooCompletedAt: checkpoint.wooCompletedAt ?? new Date().toISOString(),
    metaCompleted: checkpoint.metaCompleted === true,
  });

  currentStage = 'meta-pinned-session';
  const metaSessionPath = verified.meta.sessionPath;
  const metaOverlayPath = verified.meta.overlayPath;
  const metaFinalizerPath = verified.meta.finalizerPath;
  const metaClonePath = verified.meta.clonePath;
  await assertPrivateRegularFile(metaSessionPath, 'Meta session');
  await assertPrivateRegularFile(metaOverlayPath, 'Meta overlay');
  await assertPrivateRegularFile(metaFinalizerPath, 'Meta finalizer');
  const sessionBefore = parseJson(await readFile(metaSessionPath, 'utf8'), 'Meta session');
  const inspectedBefore = inspectMetaSession(sessionBefore, {
    repositoryHead: FINAL_DELIVERY_META_HEAD,
    operationId: FINAL_DELIVERY_META_OPERATION_ID,
  });
  if (!inspectedBefore.sessionCompleted) {
    await installPrivateFile(devVarsPath, join(metaClonePath, '.dev.vars'));
    assertMetaClone(metaClonePath);
    runRequiredNode(
      'meta-finalizer',
      [metaFinalizerPath],
      {
        ...env,
        MKT_META_SAFE_CONFIG: metaOverlayPath,
        MKT_META_FINALIZE_SESSION_FILE: metaSessionPath,
        CONFIRM_META_FINALIZE_ALL: 'RUN_AUTHORIZED_META_REMAINING_LANES',
      },
      metaClonePath,
    );
  }
  const sessionAfter = parseJson(await readFile(metaSessionPath, 'utf8'), 'Meta session');
  const inspectedAfter = inspectMetaSession(sessionAfter, {
    repositoryHead: FINAL_DELIVERY_META_HEAD,
    operationId: FINAL_DELIVERY_META_OPERATION_ID,
  });
  if (!inspectedAfter.sessionCompleted) {
    throw executionError(
      'Meta finalizer exited without completing the pinned session',
      'FINAL_DELIVERY_EXECUTION_META_INCOMPLETE',
    );
  }
  checkpoint = await writeCheckpoint(checkpointPath, {
    ...checkpoint,
    repositoryHead,
    wooCompleted: true,
    metaCompleted: true,
    metaCompletedAt: checkpoint.metaCompletedAt ?? new Date().toISOString(),
  });

  currentStage = 'final-summary';
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: 'ALL_DELIVERY_WORK_COMPLETED',
    repositoryHead,
    manifestSha256: digest(await readFile(manifestPath)),
    wooCommerce: 'WOOCOMMERCE_2026_COMPLETED_SAFE',
    meta: 'META_WIDE_COMPLETED_AND_SAFELY_CLOSED',
    checkpoint: {
      wooCompleted: checkpoint.wooCompleted,
      metaCompleted: checkpoint.metaCompleted,
    },
    production: false,
  }, null, 2)}\n`);
  process.stdout.write('ALL_DELIVERY_WORK_COMPLETED\n');
}

function validateCompletionSummary(value, repositoryHead) {
  if (value?.ok !== true
    || value?.decision !== 'WOOCOMMERCE_2026_COMPLETED_SAFE') {
    throw executionError(
      'WooCommerce completion summary wrapper is invalid',
      'FINAL_DELIVERY_EXECUTION_WOO_SUMMARY_INVALID',
    );
  }
  validateWooCommerce2026FinalSummary(value.final ?? value, repositoryHead);
  if (Number(value.remote?.activeWork) !== 0
    || Number(value.remote?.activeLocks) !== 0
    || Number(value.remote?.activeQueueOperations) !== 0
    || value.remote?.executionFlagsAllFalse !== true
    || value.remote?.scheduleExecutionFlagsFalse !== true
    || value.safety?.production !== false) {
    throw executionError(
      'WooCommerce completion did not reach the exact Safe remote state',
      'FINAL_DELIVERY_EXECUTION_WOO_REMOTE_INVALID',
    );
  }
  return true;
}

function assertMetaClone(path) {
  const branch = gitText(['-C', path, 'branch', '--show-current']);
  const head = gitText(['-C', path, 'rev-parse', 'HEAD']);
  const originMain = gitText(['-C', path, 'rev-parse', 'origin/main']);
  const dirty = gitText([
    '-C', path,
    'status', '--porcelain', '--untracked-files=all',
  ], false);
  if (branch !== 'main'
    || head !== FINAL_DELIVERY_META_HEAD
    || originMain !== FINAL_DELIVERY_META_HEAD
    || dirty.trim() !== '') {
    throw executionError(
      'Meta pinned clone changed before execution',
      'FINAL_DELIVERY_EXECUTION_META_CLONE_INVALID',
      { branch, head, originMain, clean: dirty.trim() === '' },
    );
  }
}

function runRequiredNode(name, args, env, cwd = repositoryRoot) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw executionError(
      `Final delivery required step failed: ${name}`,
      'FINAL_DELIVERY_EXECUTION_REQUIRED_STEP_FAILED',
      { name, exitCode: result.status ?? 1 },
    );
  }
}

async function installPrivateFile(source, destination) {
  await copyFile(source, destination);
  await chmod(destination, 0o600);
}

async function readCheckpoint(path, repositoryHead) {
  const value = await readJsonIfExists(path);
  if (!value) return { repositoryHead, wooCompleted: false, metaCompleted: false };
  if (value.repositoryHead !== repositoryHead) throw executionError(
    'Final delivery checkpoint belongs to another Repository Head',
    'FINAL_DELIVERY_EXECUTION_CHECKPOINT_INVALID',
  );
  return value;
}

async function writeCheckpoint(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return value;
}

async function readJsonIfExists(path) {
  try {
    return parseJson(await readFile(path, 'utf8'), path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function readRequiredJson(path, label) {
  const value = await readJsonIfExists(path);
  if (!value) throw executionError(
    `${label} is missing`,
    'FINAL_DELIVERY_EXECUTION_EVIDENCE_MISSING',
    { label },
  );
  return value;
}

async function assertPrivateRegularFile(path, label) {
  const info = await lstat(path).catch(() => null);
  if (!info || !info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw executionError(
      `${label} must be a private regular non-symlink file`,
      'FINAL_DELIVERY_EXECUTION_LOCAL_FILE_INVALID',
      { label },
    );
  }
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) throw executionError(
    'Unsupported final delivery executor arguments',
    'FINAL_DELIVERY_EXECUTION_ARGUMENT_INVALID',
    { unknown },
  );
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    prerequisite: `${confirmationName}=${confirmationValue}`,
    requiresStatus: 'READY_TO_EXECUTE',
    stages: [
      'validate-unexpired-mode-0600-readiness-manifest',
      'validate-unchanged-local-input-hashes-and-exact-main',
      'resume-or-complete-woocommerce-from-checkpoint',
      'verify-woocommerce-safe-summary',
      'resume-exact-pinned-meta-session',
      'verify-meta-session-completed',
    ],
    discoveryDuringExecution: false,
    production: false,
  }, null, 2)}\n`);
}

function gitText(args, trim = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) throw executionError(
    'Git command failed during final delivery execution',
    'FINAL_DELIVERY_EXECUTION_GIT_FAILED',
    { status: result.status ?? 1 },
  );
  const output = String(result.stdout ?? '');
  return trim ? output.trim() : output;
}

function resolveRequiredPath(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw executionError(
    `${fieldName} is required`,
    'FINAL_DELIVERY_EXECUTION_INPUT_REQUIRED',
    { fieldName },
  );
  return resolve(value.trim());
}

function parseJson(value, label) {
  try {
    return JSON.parse(String(value));
  } catch {
    throw executionError(
      `${label} contains invalid JSON`,
      'FINAL_DELIVERY_EXECUTION_JSON_INVALID',
      { label },
    );
  }
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) throw executionError(
    `${fieldName} must equal ${expected}`,
    'FINAL_DELIVERY_EXECUTION_TARGET_INVALID',
    { fieldName },
  );
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:secret|token|authorization|password|accountId|queueId|subdomain|path)/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function executionError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'FinalDeliveryExecutionError';
  error.code = code;
  error.details = details;
  return error;
}
