#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
} from './lib/meta-d1-only-rollout-operator.js';
import {
  applyMetaHistoryCustomerRuntimeEnvironment,
} from './lib/meta-history-runtime-authority.js';
import {
  META_HISTORY_2026_CONTRACT_VERSION,
  assertMetaHistory2026Confirmation,
  createMetaHistory2026Plan,
} from './lib/meta-history-2026-finalizer.js';

const repositoryRoot = resolve(process.cwd());
const childPath = join(repositoryRoot, 'scripts', 'meta-history-2026-one-command.mjs');
let currentStage = 'init';

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) printPlan();
  else await executeTerminalEntry();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_HISTORY_2026_TERMINAL_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeTerminalEntry() {
  assertMetaHistory2026Confirmation(process.env);
  currentStage = 'validate-exact-clean-main';
  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const branch = gitText(['branch', '--show-current']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (branch !== 'main' || repositoryHead !== originMain || dirty.trim() !== '') {
    throw terminalError(
      'Meta history Terminal entry requires exact clean main equal to origin/main',
      'META_HISTORY_2026_TERMINAL_REPOSITORY_INVALID',
      { branch, repositoryHead, originMain, clean: dirty.trim() === '' },
    );
  }

  currentStage = 'persist-exact-operation-plan';
  const planPath = join(
    repositoryRoot,
    'outputs',
    'meta-history-2026',
    repositoryHead,
    'runtime-plan.json',
  );
  const plan = await loadOrCreateIsoPlan(planPath, repositoryHead);

  currentStage = 'materialize-safe-child-environment';
  const childEnvironment = buildMetaHistorySafeEnvironment(process.env);

  currentStage = 'execute-guarded-one-command';
  const child = spawnSync(process.execPath, [childPath, '--execute'], {
    cwd: repositoryRoot,
    env: childEnvironment,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: 'inherit',
  });
  if (child.error || child.status !== 0) {
    throw terminalError(
      'Meta history guarded one-command child failed',
      'META_HISTORY_2026_TERMINAL_CHILD_FAILED',
      {
        exitCode: child.status ?? 1,
        repositoryHead,
        operationCount: plan.operations.length,
      },
    );
  }
}

export function buildMetaHistorySafeEnvironment(env = {}) {
  const result = {
    ...applyMetaHistoryCustomerRuntimeEnvironment(env),
  };
  for (const key of Object.keys(result)) {
    if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) result[key] = 'false';
  }
  for (const key of META_D1_ONLY_REQUIRED_FALSE_FLAGS) result[key] = 'false';
  return Object.freeze(result);
}

export async function loadOrCreateIsoPlan(path, repositoryHead, options = {}) {
  const existing = await readJsonIfExists(path);
  if (existing) return validateIsoPlan(existing, repositoryHead);

  const now = typeof options.now === 'function' ? options.now() : Date.now();
  if (!Number.isSafeInteger(now) || now < Date.UTC(2000, 0, 1)) {
    throw terminalError(
      'Meta history plan clock is invalid',
      'META_HISTORY_2026_TERMINAL_CLOCK_INVALID',
    );
  }
  const base = createMetaHistory2026Plan(repositoryHead);
  const plan = {
    ...base,
    createdAt: new Date(now).toISOString(),
    operations: base.operations.map((operation, index) => ({
      ...operation,
      originalRequestedAt: new Date(now + index).toISOString(),
    })),
  };
  validateIsoPlan(plan, repositoryHead);
  await writePrivateJson(path, plan);
  return plan;
}

export function validateIsoPlan(value, repositoryHead) {
  const expected = createMetaHistory2026Plan(repositoryHead);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw terminalError(
      'Persisted Meta history plan is invalid',
      'META_HISTORY_2026_TERMINAL_PLAN_INVALID',
    );
  }
  if (value.contractVersion !== META_HISTORY_2026_CONTRACT_VERSION
    || value.repositoryHead !== repositoryHead
    || !Array.isArray(value.operations)
    || value.operations.length !== expected.operations.length) {
    throw terminalError(
      'Persisted Meta history plan does not match the exact Repository Head',
      'META_HISTORY_2026_TERMINAL_PLAN_INVALID',
    );
  }

  const observed = new Set();
  for (let index = 0; index < expected.operations.length; index += 1) {
    const operation = value.operations[index];
    const authority = expected.operations[index];
    for (const field of ['target', 'periodStart', 'periodEnd', 'operationId', 'mode']) {
      if (operation?.[field] !== authority[field]) {
        throw terminalError(
          'Persisted Meta history operation differs from the reviewed plan',
          'META_HISTORY_2026_TERMINAL_OPERATION_DRIFT',
          { index, field },
        );
      }
    }
    const requestedAt = requireIsoTimestamp(operation.originalRequestedAt, index);
    if (observed.has(requestedAt)) {
      throw terminalError(
        'Meta history operations require unique requested-at generations',
        'META_HISTORY_2026_TERMINAL_GENERATION_DUPLICATE',
        { index },
      );
    }
    observed.add(requestedAt);
  }
  requireIsoTimestamp(value.createdAt, 'createdAt');
  return value;
}

function requireIsoTimestamp(value, fieldName) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw terminalError(
      'Meta history requested-at generation must be an ISO timestamp',
      'META_HISTORY_2026_TERMINAL_TIMESTAMP_INVALID',
      { fieldName },
    );
  }
  return value;
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw terminalError(
        'Persisted Meta history plan contains invalid JSON',
        'META_HISTORY_2026_TERMINAL_PLAN_JSON_INVALID',
      );
    }
    throw error;
  }
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
  const info = await stat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) {
    throw terminalError(
      'Persisted Meta history plan is not a private regular file',
      'META_HISTORY_2026_TERMINAL_PLAN_FILE_INVALID',
    );
  }
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw terminalError(
      'Unsupported Meta history Terminal arguments',
      'META_HISTORY_2026_TERMINAL_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: META_HISTORY_2026_CONTRACT_VERSION,
    confirmation: 'CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND',
    persistsIsoRequestedAtBeforeRemoteAction: true,
    materializesExplicitAllFalseChildEnvironment: true,
    materializesExactCustomerRuntimeAuthority: true,
    child: 'scripts/meta-history-2026-one-command.mjs',
    scheduleEnabled: false,
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
  if (result.error || result.status !== 0) {
    throw terminalError(
      'Git command failed during Meta history Terminal entry',
      'META_HISTORY_2026_TERMINAL_GIT_FAILED',
      { exitCode: result.status ?? 1 },
    );
  }
  const output = String(result.stdout ?? '');
  return trim ? output.trim() : output;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/token|secret|authorization/iu.test(key))
      .map(([key, nested]) => [key, sanitize(nested)]),
  );
}

function terminalError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'MetaHistory2026TerminalError';
  error.code = code;
  error.details = details;
  return error;
}
