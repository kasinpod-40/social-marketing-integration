#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { lstat, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { readChatwootExecutionFlags } from './lib/chatwoot-controller-evidence-arbitration.js';
import { parseChatwootWranglerJsonOutput } from './lib/chatwoot-final-source-config-recovery.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  assertChatwootSafeBaselineCurrentHeadClear,
} from './lib/chatwoot-safe-baseline-current-head-guard.js';
import {
  loadChatwootSafeBaselinePriorAttempt,
} from './lib/chatwoot-safe-baseline-prior-attempt.js';

const WRAPPER_HEAD_ENV = 'MKT_CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_EXACT_HEAD';
const PRIOR_HEAD_ENV = 'MKT_CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_HEAD';
const CHILD_HEAD_ENV = 'MKT_CHATWOOT_SAFE_BASELINE_EXACT_HEAD';
const CONFIRMATION_ENV = 'CONFIRM_CHATWOOT_INITIAL_FAILURE_RECOVERY';
const CONFIRMATION_VALUE = 'RECOVER_EXACT_CHATWOOT_INITIAL_TO_LARK_PARITY';
const CHILD = 'scripts/chatwoot-controller-safe-baseline-exact-terminal.mjs';
const OUTPUT_ROOT = 'chatwoot-controller-safe-baseline-resume';
const SOURCE_CONFIG = 'wrangler.sync.jsonc';
const WORKER_NAME = 'social-mkt-sync-worker';
const SUCCESS_MARKER = 'CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_COMPLETED_SAFE';
const CONTRACT_VERSION = 'chatwoot_safe_baseline_prior_attempt_terminal_v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const repositoryRoot = resolve(process.cwd());
let stage = 'init';
let childStarted = false;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
  } else {
    stage = 'confirm-chatwoot-prior-attempt';
    assertConfirmation(process.env);

    stage = 'verify-chatwoot-prior-attempt-checkout';
    const repository = verifyWrapperCheckout(process.env);
    const priorHead = requireSha(process.env[PRIOR_HEAD_ENV], PRIOR_HEAD_ENV);
    if (priorHead === repository.currentHead
        || !gitSuccess(['merge-base', '--is-ancestor', priorHead, repository.currentHead])) {
      throw terminalError(
        'Prior Chatwoot attempt Head must be a strict ancestor of the reviewed wrapper Head',
        'CHATWOOT_SAFE_BASELINE_PRIOR_HEAD_INVALID',
        { priorHead, currentHead: repository.currentHead },
      );
    }

    stage = 'load-chatwoot-prior-attempt-runtime';
    const assets = await verifyLocalAssets();
    const fileEnv = await readDevVars(assets.devVars);
    const runtimeEnv = Object.freeze({ ...fileEnv, ...process.env });

    stage = 'read-current-chatwoot-prior-attempt-worker';
    const currentWorker = readCurrentWorker(runtimeEnv, assets.sourceConfig);

    stage = 'verify-chatwoot-prior-attempt-evidence';
    const prior = await loadChatwootSafeBaselinePriorAttempt({
      directory: join(assets.outputs, OUTPUT_ROOT, priorHead),
      priorHead,
      currentWorker,
    });

    stage = 'verify-chatwoot-prior-attempt-current-head-clear';
    await assertChatwootSafeBaselineCurrentHeadClear({
      outputs: assets.outputs,
      repositoryHead: repository.currentHead,
    });

    stage = 'run-chatwoot-prior-attempt-exact-authority';
    childStarted = true;
    const child = spawnSync(
      process.execPath,
      [join(repositoryRoot, CHILD), '--execute'],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          [CHILD_HEAD_ENV]: repository.currentHead,
        },
        stdio: 'inherit',
      },
    );
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
    if (child.status === 0) {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        marker: SUCCESS_MARKER,
        repositoryHead: repository.currentHead,
        priorAttemptHead: prior.priorHead,
        priorAttemptValidated: true,
        priorSafeRestoreValidated: true,
        priorCurrentWorkerAllFlagsFalse: true,
        priorEvidenceFileCount: prior.fileCount,
        child: CHILD,
        retainedEvidenceMutation: false,
        secondInitialAdmission: false,
        scheduleEnabled: false,
        webhookEnabled: false,
        production: 'BLOCKED',
      }, null, 2)}\n`);
    }
  }
} catch (error) {
  const failure = {
    ok: false,
    stage,
    code: error?.code ?? 'CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_TERMINAL_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: scrub(error?.details ?? {}),
    safeRestore: childStarted
      ? 'OWNED_BY_SAFE_BASELINE_INNER_AFTER_CHILD_START'
      : 'NOT_REQUIRED_BEFORE_CHILD_START',
    scheduleEnabled: false,
    webhookEnabled: false,
    production: 'BLOCKED',
  };
  if (!childStarted) {
    Object.assign(failure, {
      providerRequests: 0,
      queueActions: 0,
      remoteD1Mutations: 0,
      remoteLarkMutations: 0,
      workerDeployments: 0,
      incidentClosureActions: 0,
    });
  }
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const unknown = args.filter((argument) => argument !== '--execute');
  if (unknown.length > 0) {
    throw terminalError(
      'Chatwoot prior-attempt terminal accepts only --execute',
      'CHATWOOT_SAFE_BASELINE_PRIOR_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: CONTRACT_VERSION,
    wrapperHeadEnv: WRAPPER_HEAD_ENV,
    priorHeadEnv: PRIOR_HEAD_ENV,
    confirmation: `${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
    priorAttemptRequiredFiles: [
      '01-active-window.attempt.json',
      '02-safe-restore.json',
    ],
    priorAttemptSummaryAllowed: false,
    priorWorkerRequiredState: 'all_execution_flags_false_and_version_fingerprint_match',
    currentHeadEvidenceGuard: 'required_before_child',
    child: CHILD,
    retainedEvidenceMutation: false,
    secondInitialAdmissionAllowed: false,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: 'BLOCKED',
    remoteActionsPerformed: false,
  }, null, 2)}\n`);
}

function assertConfirmation(env) {
  if (env[CONFIRMATION_ENV] !== CONFIRMATION_VALUE) {
    throw terminalError(
      `Chatwoot prior-attempt terminal requires ${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
      'CHATWOOT_SAFE_BASELINE_PRIOR_CONFIRMATION_REQUIRED',
      { envName: CONFIRMATION_ENV },
    );
  }
}

function verifyWrapperCheckout(env) {
  const expectedHead = requireSha(env[WRAPPER_HEAD_ENV], WRAPPER_HEAD_ENV);
  const currentHead = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const branch = gitText(['branch', '--show-current'], false);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (currentHead !== expectedHead || dirty.trim() !== '') {
    throw terminalError(
      'Chatwoot prior-attempt terminal requires the exact clean reviewed commit',
      'CHATWOOT_SAFE_BASELINE_PRIOR_CHECKOUT_INVALID',
      {
        expectedHead,
        currentHead,
        originMain,
        branch: branch || '(detached)',
        clean: dirty.trim() === '',
      },
    );
  }
  if (!gitSuccess(['merge-base', '--is-ancestor', currentHead, originMain])) {
    throw terminalError(
      'Reviewed Chatwoot prior-attempt terminal is not contained in origin/main history',
      'CHATWOOT_SAFE_BASELINE_PRIOR_ANCESTRY_INVALID',
      { currentHead, originMain },
    );
  }
  const conflicts = Object.keys(env).filter(
    (key) => /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key),
  );
  if (conflicts.length > 0) {
    throw terminalError(
      'Chatwoot prior-attempt terminal refuses caller-provided Git config overrides',
      'CHATWOOT_SAFE_BASELINE_PRIOR_GIT_CONFIG_ENV_INVALID',
      { conflicts: conflicts.sort() },
    );
  }
  return Object.freeze({ currentHead, originMain, branch: branch || '(detached)' });
}

async function verifyLocalAssets() {
  const outputs = join(repositoryRoot, 'outputs');
  const devVars = join(repositoryRoot, '.dev.vars');
  const sourceConfig = join(repositoryRoot, SOURCE_CONFIG);
  await assertDirectory(outputs, 'outputs');
  await assertPrivateRegularFile(devVars, '.dev.vars');
  await assertRegularFile(sourceConfig, SOURCE_CONFIG);
  return Object.freeze({ outputs, devVars, sourceConfig });
}

function readCurrentWorker(env, sourceConfig) {
  const wranglerEnv = buildWranglerOAuthEnvironment(env);
  const status = parseChatwootWranglerJsonOutput(runText('npx', [
    'wrangler', 'deployments', 'status',
    '--name', WORKER_NAME,
    '--config', sourceConfig,
    '--json',
  ], wranglerEnv), 'Chatwoot Worker deployment status');
  const item = Array.isArray(status) ? status[0] : status;
  const active = (item?.versions ?? []).filter((version) => Number(version?.percentage) === 100);
  if (active.length !== 1) {
    throw terminalError(
      'Chatwoot Worker does not have exactly one active version',
      'CHATWOOT_SAFE_BASELINE_PRIOR_WORKER_UNSAFE',
      { activeVersionCount: active.length },
    );
  }
  const activeVersion = requireVersionId(active[0]?.version_id ?? active[0]?.id);
  const view = parseChatwootWranglerJsonOutput(runText('npx', [
    'wrangler', 'versions', 'view', activeVersion,
    '--name', WORKER_NAME,
    '--config', sourceConfig,
    '--json',
  ], wranglerEnv), 'Chatwoot Worker version view');
  return Object.freeze({
    activeVersion,
    enabledFlags: readChatwootExecutionFlags(view),
  });
}

async function assertDirectory(path, field) {
  try {
    const link = await lstat(path);
    const info = await stat(path);
    if (!link.isSymbolicLink() && info.isDirectory()) return;
  } catch {
    // normalized below
  }
  throw terminalError(
    `Required local ${field} directory is missing`,
    'CHATWOOT_SAFE_BASELINE_PRIOR_LOCAL_ASSET_MISSING',
    { field },
  );
}

async function assertRegularFile(path, field) {
  try {
    const link = await lstat(path);
    const info = await stat(path);
    if (!link.isSymbolicLink() && info.isFile()) return;
  } catch {
    // normalized below
  }
  throw terminalError(
    `Required local ${field} file is missing`,
    'CHATWOOT_SAFE_BASELINE_PRIOR_LOCAL_ASSET_MISSING',
    { field },
  );
}

async function assertPrivateRegularFile(path, field) {
  try {
    const link = await lstat(path);
    const info = await stat(path);
    if (!link.isSymbolicLink() && info.isFile() && (info.mode & 0o077) === 0) return;
  } catch {
    // normalized below
  }
  throw terminalError(
    `Required local ${field} must be a private regular file`,
    'CHATWOOT_SAFE_BASELINE_PRIOR_LOCAL_PRIVATE_FILE_INVALID',
    { field },
  );
}

function requireSha(value, field) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw terminalError(
      `${field} must be an exact Git SHA`,
      'CHATWOOT_SAFE_BASELINE_PRIOR_HEAD_INVALID',
      { field },
    );
  }
  return text;
}

function requireVersionId(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!UUID.test(text)) {
    throw terminalError(
      'Current Worker version identity is invalid',
      'CHATWOOT_SAFE_BASELINE_PRIOR_WORKER_UNSAFE',
    );
  }
  return text;
}

function runText(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw terminalError(
      `Read-only command failed: ${command}`,
      'CHATWOOT_SAFE_BASELINE_PRIOR_READ_COMMAND_FAILED',
      { command, exitCode: result.status ?? null },
    );
  }
  return String(result.stdout ?? '');
}

function gitText(args, required = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && required) {
    throw terminalError(
      `Git read failed: git ${args.join(' ')}`,
      'CHATWOOT_SAFE_BASELINE_PRIOR_GIT_READ_FAILED',
      { exitCode: result.status ?? null },
    );
  }
  return String(result.stdout ?? '').trim();
}

function gitSuccess(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return !result.error && result.status === 0;
}

function scrub(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|password|cookie|tableId|accountId|queueId|versionId/iu.test(key))
    .map(([key, nested]) => [key, scrub(nested)]));
}

function terminalError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootSafeBaselinePriorAttemptTerminalError';
  error.code = code;
  error.details = details;
  return error;
}
