#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  assertChatwootSafeBaselineCurrentHeadClear,
} from './lib/chatwoot-safe-baseline-current-head-guard.js';

const WRAPPER_HEAD_ENV = 'MKT_CHATWOOT_SAFE_BASELINE_EXACT_HEAD';
const PINNED_WRAPPER_HEAD_ENV = 'MKT_CHATWOOT_SAFE_BASELINE_PINNED_ORIGIN_HEAD';
const CONFIRMATION_ENV = 'CONFIRM_CHATWOOT_INITIAL_FAILURE_RECOVERY';
const CONFIRMATION_VALUE = 'RECOVER_EXACT_CHATWOOT_INITIAL_TO_LARK_PARITY';
const CHILD = 'scripts/chatwoot-controller-safe-baseline-pinned-origin-terminal.mjs';
const SUCCESS_MARKER = 'CHATWOOT_SAFE_BASELINE_EXACT_TERMINAL_COMPLETED_SAFE';
const CONTRACT_VERSION = 'chatwoot_safe_baseline_exact_terminal_v1';

const repositoryRoot = resolve(process.cwd());
let stage = 'init';
let childStarted = false;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
  } else {
    stage = 'confirm-chatwoot-safe-baseline-exact-terminal';
    assertConfirmation(process.env);

    stage = 'verify-chatwoot-safe-baseline-exact-checkout';
    const repository = verifyWrapperCheckout(process.env);

    stage = 'verify-chatwoot-safe-baseline-current-head';
    const outputs = join(repositoryRoot, 'outputs');
    await assertDirectory(outputs, 'outputs');
    await assertChatwootSafeBaselineCurrentHeadClear({
      outputs,
      repositoryHead: repository.currentHead,
    });

    stage = 'run-chatwoot-safe-baseline-pinned-origin';
    childStarted = true;
    const child = spawnSync(
      process.execPath,
      [join(repositoryRoot, CHILD), '--execute'],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          [PINNED_WRAPPER_HEAD_ENV]: repository.currentHead,
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
        child: CHILD,
        blindRerunBlocked: true,
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
    code: error?.code ?? 'CHATWOOT_SAFE_BASELINE_EXACT_TERMINAL_FAILED',
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
    throw exactError(
      'Chatwoot safe-baseline exact terminal accepts only --execute',
      'CHATWOOT_SAFE_BASELINE_EXACT_ARGUMENT_INVALID',
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
    confirmation: `${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
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
    throw exactError(
      `Chatwoot safe-baseline exact terminal requires ${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
      'CHATWOOT_SAFE_BASELINE_EXACT_CONFIRMATION_REQUIRED',
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
    throw exactError(
      'Chatwoot safe-baseline exact terminal requires the exact clean reviewed commit',
      'CHATWOOT_SAFE_BASELINE_EXACT_CHECKOUT_INVALID',
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
    throw exactError(
      'Reviewed Chatwoot safe-baseline exact terminal is not contained in current origin/main history',
      'CHATWOOT_SAFE_BASELINE_EXACT_ANCESTRY_INVALID',
      { currentHead, originMain },
    );
  }
  const conflicts = Object.keys(env).filter(
    (key) => /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key),
  );
  if (conflicts.length > 0) {
    throw exactError(
      'Chatwoot safe-baseline exact terminal refuses caller-provided Git config overrides',
      'CHATWOOT_SAFE_BASELINE_EXACT_GIT_CONFIG_ENV_INVALID',
      { conflicts: conflicts.sort() },
    );
  }
  return Object.freeze({ currentHead, originMain, branch: branch || '(detached)' });
}

async function assertDirectory(path, field) {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch {
    // normalized below
  }
  throw exactError(
    `Required local ${field} directory is missing`,
    'CHATWOOT_SAFE_BASELINE_EXACT_LOCAL_ASSET_MISSING',
    { field },
  );
}

function requireSha(value, field) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw exactError(
      `${field} must be an exact 40-character Git SHA`,
      'CHATWOOT_SAFE_BASELINE_EXACT_HEAD_ENV_INVALID',
      { field },
    );
  }
  return text;
}

function gitText(args, required = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && required) {
    throw exactError(
      `Git read failed: git ${args.join(' ')}`,
      'CHATWOOT_SAFE_BASELINE_EXACT_GIT_READ_FAILED',
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

function exactError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootSafeBaselineExactTerminalError';
  error.code = code;
  error.details = details;
  return error;
}
