#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { readDevVars } from './lib/dev-vars.js';
import {
  META_PAID_LARK_RUNTIME_BLOCKER_DIAGNOSIS_CONTRACT_VERSION,
  META_PAID_LARK_RUNTIME_STABILITY_WINDOW_MS,
  buildMetaPaidLarkRuntimeDiagnosisQueries,
  classifyMetaPaidLarkRuntimeDiagnosis,
} from './lib/meta-paid-lark-runtime-blocker-diagnosis.js';

const confirmation = Object.freeze({
  envName: 'CONFIRM_META_PAID_LARK_RUNTIME_DIAGNOSIS',
  value: 'READ_ONLY_META_PAID_LARK_RUNTIME_DIAGNOSIS',
});
const repositoryRoot = resolve(process.cwd());
let currentStage = 'init';

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      planOnly: true,
      contractVersion: META_PAID_LARK_RUNTIME_BLOCKER_DIAGNOSIS_CONTRACT_VERSION,
      confirmation: `${confirmation.envName}=${confirmation.value}`,
      action: 'two_snapshot_remote_reliability_diagnosis',
      stabilityWindowMs: META_PAID_LARK_RUNTIME_STABILITY_WINDOW_MS,
      d1ReadOnly: true,
      workerDeployCount: 0,
      queueSendCount: 0,
      d1MutationCount: 0,
      larkMutationCount: 0,
      remoteMutationPerformed: false,
    }, null, 2)}\n`);
  } else {
    await executeDiagnosis();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_PAID_LARK_RUNTIME_DIAGNOSIS_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    workerDeployCount: 0,
    queueSendCount: 0,
    d1MutationCount: 0,
    larkMutationCount: 0,
    remoteMutationPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeDiagnosis() {
  if (process.env[confirmation.envName] !== confirmation.value) {
    throw diagnosisError(
      `Runtime diagnosis requires ${confirmation.envName}=${confirmation.value}`,
      'META_PAID_LARK_RUNTIME_DIAGNOSIS_CONFIRMATION_REQUIRED',
    );
  }

  currentStage = 'exact-clean-main';
  const branch = gitText(['branch', '--show-current']);
  const head = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false).trim();
  if (branch !== 'main' || head !== originMain || dirty !== '') {
    throw diagnosisError(
      'Runtime diagnosis requires exact clean main equal to origin/main',
      'META_PAID_LARK_RUNTIME_DIAGNOSIS_REPOSITORY_INVALID',
      { branch, head, originMain, clean: dirty === '' },
    );
  }

  currentStage = 'load-dev-runtime';
  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const fileEnv = await readDevVars(devVarsPath);
  const env = Object.freeze({ ...fileEnv, ...process.env });
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  const configPath = resolve(
    env.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
  );
  const configInfo = await stat(configPath).catch(() => null);
  if (!configInfo?.isFile()) {
    throw diagnosisError(
      'Runtime diagnosis Wrangler config must be a regular file',
      'META_PAID_LARK_RUNTIME_DIAGNOSIS_CONFIG_INVALID',
      { configPath },
    );
  }

  const queries = buildMetaPaidLarkRuntimeDiagnosisQueries();
  currentStage = 'snapshot-before';
  const before = await readSnapshot(env, configPath, queries);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'snapshot-before',
    observedAt: before.observedAt,
    activeWork: before.work.length,
    activeQueueOperations: before.queue.length,
    activeLocks: before.locks.length,
    remoteMutationPerformed: false,
  }, null, 2)}\n`);

  currentStage = 'stability-window';
  await sleep(META_PAID_LARK_RUNTIME_STABILITY_WINDOW_MS);

  currentStage = 'snapshot-after';
  const after = await readSnapshot(env, configPath, queries);
  const diagnosis = classifyMetaPaidLarkRuntimeDiagnosis(before, after);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'complete',
    repositoryHead: head,
    ...diagnosis,
    workerDeployCount: 0,
    queueSendCount: 0,
    d1MutationCount: 0,
    larkMutationCount: 0,
  }, null, 2)}\n`);
}

async function readSnapshot(env, configPath, queries) {
  const observedAt = Date.now();
  const [work, queue, locks, phases] = await Promise.all([
    readD1Rows(env, configPath, queries.work),
    readD1Rows(env, configPath, queries.queue),
    readD1Rows(env, configPath, queries.locks),
    readD1Rows(env, configPath, queries.phases),
  ]);
  return Object.freeze({ observedAt, work, queue, locks, phases });
}

function readD1Rows(env, configPath, sql) {
  const stdout = runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB',
    '--remote', '--json', '--config', configPath,
    '--command', sql,
  ], env);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw diagnosisError(
      'Runtime diagnosis could not parse Wrangler D1 JSON',
      'META_PAID_LARK_RUNTIME_DIAGNOSIS_D1_JSON_INVALID',
    );
  }
  const rows = Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])
    : parsed?.results ?? [];
  if (!Array.isArray(rows)) {
    throw diagnosisError(
      'Runtime diagnosis D1 response has no results array',
      'META_PAID_LARK_RUNTIME_DIAGNOSIS_D1_RESULT_INVALID',
    );
  }
  return rows;
}

function runText(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw diagnosisError(
      `Required read-only command failed: ${command} ${args.slice(0, 3).join(' ')}`,
      'META_PAID_LARK_RUNTIME_DIAGNOSIS_COMMAND_FAILED',
      { command, exitCode: result.status ?? 1 },
    );
  }
  return String(result.stdout ?? '').trim();
}

function gitText(args, requireOk = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (requireOk && (result.error || result.status !== 0)) {
    throw diagnosisError(
      `Git command failed: git ${args.join(' ')}`,
      'META_PAID_LARK_RUNTIME_DIAGNOSIS_GIT_FAILED',
    );
  }
  return String(result.stdout ?? '').trim();
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length !== 0) {
    throw diagnosisError(
      'Unsupported runtime diagnosis arguments',
      'META_PAID_LARK_RUNTIME_DIAGNOSIS_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw diagnosisError(
      `Runtime diagnosis requires ${fieldName}=${expected}`,
      'META_PAID_LARK_RUNTIME_DIAGNOSIS_TARGET_INVALID',
      { fieldName },
    );
  }
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|payload|state_json|completion_json/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function diagnosisError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidLarkRuntimeDiagnosisError';
  error.code = code;
  error.details = details;
  return error;
}
