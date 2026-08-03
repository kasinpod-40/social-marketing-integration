#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  LARK_NOTIFICATION_LOG_APPLY_CONFIRMATION,
  LARK_NOTIFICATION_LOG_FIELDS,
  LARK_NOTIFICATION_LOG_OUTPUT_ROOT,
  LARK_NOTIFICATION_LOG_SCHEMA_CONTRACT_VERSION,
  LARK_NOTIFICATION_LOG_TABLE_NAME,
  LARK_NOTIFICATION_LOG_VIEWS,
} from '../packages/config/src/lark-notification-log-schema-contract.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  applyLarkNotificationLogSchema,
  createLarkNotificationLogSchemaFetchGuard,
  schemaError,
} from './lib/lark-notification-log-schema.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(process.env.MKT_LARK_NOTIFICATION_LOG_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const outputRoot = resolve(
  process.env.MKT_LARK_NOTIFICATION_LOG_OUTPUT_ROOT ?? LARK_NOTIFICATION_LOG_OUTPUT_ROOT,
);
const lockPath = resolve(outputRoot, '.schema-apply.lock');

let stage = 'init';
let repository = null;
let attemptDirectory = null;
let lockHandle = null;
let remote = null;
let summaryWritten = false;

try {
  const execute = process.argv.slice(2).includes('--execute');
  if (!execute) printPlan();
  else await executeSchemaApply();
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    contractVersion: LARK_NOTIFICATION_LOG_SCHEMA_CONTRACT_VERSION,
    stage,
    code: error?.code ?? 'LARK_NOTIFICATION_LOG_SCHEMA_TERMINAL_FAILED',
    message: sanitizeText(error?.message ?? String(error)),
    details: sanitizeValue(error?.details ?? {}),
    repository,
    remote: remote?.snapshot?.() ?? null,
    attemptDirectory: attemptDirectory ? relative(repositoryRoot, attemptDirectory) : null,
    recordReadCount: 0,
    recordWriteCount: 0,
    automationCount: 0,
    notificationCount: 0,
    webhookActionCount: 0,
    remoteD1ActionCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerActionCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  if (attemptDirectory && !summaryWritten) {
    try {
      await writePrivateJson(resolve(attemptDirectory, 'failure-summary.json'), failure);
      summaryWritten = true;
    } catch {
      // Preserve the primary failure.
    }
  }
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (lockHandle) {
    try { await lockHandle.close(); } catch { /* no-op */ }
    try { await unlink(lockPath); } catch { /* preserve primary result */ }
  }
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: LARK_NOTIFICATION_LOG_SCHEMA_CONTRACT_VERSION,
    objective: 'create_or_complete_one_guarded_lark_notification_log_table',
    exactCommand: [
      'cd /Users/wasanjantawong/Git/social-marketing-integration &&',
      'git fetch --quiet origin main &&',
      'git switch main &&',
      'git pull --ff-only origin main &&',
      `CONFIRM_LARK_NOTIFICATION_LOG_SCHEMA=${LARK_NOTIFICATION_LOG_APPLY_CONFIRMATION}`,
      'node scripts/lark-notification-log-schema-terminal.mjs --execute',
    ].join(' '),
    tableName: LARK_NOTIFICATION_LOG_TABLE_NAME,
    iconMode: 'emoji_prefix_in_table_name',
    fieldCount: LARK_NOTIFICATION_LOG_FIELDS.length,
    viewCount: LARK_NOTIFICATION_LOG_VIEWS.length,
    viewFiltersConfigured: LARK_NOTIFICATION_LOG_VIEWS.length - 1,
    automaticRename: false,
    deleteActionCount: 0,
    fieldTypeChangeCount: 0,
    optionRemovalCount: 0,
    recordReadCount: 0,
    recordWriteCount: 0,
    automationCount: 0,
    notificationCount: 0,
    webhookActionCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    executed: false,
  }, null, 2)}\n`);
}

async function executeSchemaApply() {
  stage = 'confirmation';
  if (process.env.CONFIRM_LARK_NOTIFICATION_LOG_SCHEMA !== LARK_NOTIFICATION_LOG_APPLY_CONFIRMATION) {
    throw schemaError(
      'Exact Notification Log schema confirmation is missing',
      'LARK_NOTIFICATION_LOG_CONFIRMATION_INVALID',
    );
  }
  if (Number(process.versions.node.split('.')[0]) < 22) throw schemaError(
    'Node.js 22 or newer is required',
    'LARK_NOTIFICATION_LOG_NODE_VERSION_UNSUPPORTED',
    { major: Number(process.versions.node.split('.')[0]) },
  );

  stage = 'fetch-origin-main';
  await runGit(['fetch', '--quiet', 'origin', 'main']);
  stage = 'repository-preflight';
  repository = Object.freeze({
    branch: await gitText(['branch', '--show-current']),
    head: await gitText(['rev-parse', 'HEAD']),
    originMain: await gitText(['rev-parse', 'origin/main']),
    clean: (await gitText(['status', '--porcelain'])) === '',
  });
  if (repository.branch !== 'main' || repository.clean !== true
    || repository.head !== repository.originMain || !/^[a-f0-9]{40}$/u.test(repository.head)) {
    throw schemaError(
      'Notification Log schema Apply requires clean current main',
      'LARK_NOTIFICATION_LOG_REPOSITORY_INVALID',
      repository,
    );
  }

  stage = 'local-preflight';
  const runtime = await loadAndValidateRuntime();

  stage = 'acquire-local-lock';
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await chmod(outputRoot, 0o700);
  lockHandle = await acquireLock();

  stage = 'create-immutable-attempt-directory';
  attemptDirectory = await createAttemptDirectory();

  stage = 'apply-lark-notification-log-schema';
  remote = createLarkNotificationLogSchemaFetchGuard(globalThis.fetch.bind(globalThis));
  const client = createLarkBitableClientFromEnv(Object.freeze({
    ...runtime.env,
    LARK_MAX_ATTEMPTS: '1',
    LARK_MAX_PAGES: '20',
    LARK_MAX_FILTER_CONDITIONS: '50',
    LARK_REQUEST_TIMEOUT_MS: '30000',
    LARK_MIN_REQUEST_INTERVAL_MS: '150',
  }), {
    fetchImpl: remote.fetchImpl,
    onRequest: (event) => process.stderr.write(`${JSON.stringify({
      stage: 'lark_schema',
      event: sanitizeValue(event),
    })}\n`),
  });

  const result = await applyLarkNotificationLogSchema({
    client,
    onProgress: (event) => process.stderr.write(`${JSON.stringify({
      stage: 'lark_schema_progress',
      event: sanitizeValue(event),
    })}\n`),
  });

  stage = 'write-summary';
  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_NOTIFICATION_LOG_SCHEMA_CONTRACT_VERSION,
    stage: 'complete',
    repository,
    tableName: LARK_NOTIFICATION_LOG_TABLE_NAME,
    iconMode: 'emoji_prefix_in_table_name',
    result,
    remote: remote.snapshot(),
    fieldCount: LARK_NOTIFICATION_LOG_FIELDS.length,
    viewCount: LARK_NOTIFICATION_LOG_VIEWS.length,
    recordReadCount: 0,
    recordWriteCount: 0,
    automationCount: 0,
    notificationCount: 0,
    webhookActionCount: 0,
    remoteD1ActionCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerActionCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    attemptDirectory: relative(repositoryRoot, attemptDirectory),
  });
  await writePrivateJson(resolve(attemptDirectory, 'summary.json'), summary);
  summaryWritten = true;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function loadAndValidateRuntime() {
  const blockers = [];
  let config;
  try {
    config = parseJsoncObject(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw schemaError(
      'wrangler.sync.jsonc could not be loaded',
      'LARK_NOTIFICATION_LOG_CONFIG_INVALID',
      { code: error?.code ?? null },
    );
  }
  const devVars = await readOptionalPrivateDevVars(devVarsPath, blockers);
  const env = Object.freeze({ ...(config.vars ?? {}), ...devVars, ...process.env });
  if (config.name !== 'social-mkt-sync-worker') blockers.push({ code: 'WORKER_NAME_INVALID' });
  if (config.workers_dev !== false) blockers.push({ code: 'WORKERS_DEV_NOT_DISABLED' });
  if (env.MKT_ENV !== 'development') blockers.push({ code: 'MKT_ENV_INVALID' });
  if (env.MKT_CUSTOMER_PROFILE !== 'integration_workspace') blockers.push({
    code: 'CUSTOMER_PROFILE_INVALID',
  });
  for (const field of ['LARK_APP_ID', 'LARK_APP_SECRET']) {
    if (typeof env[field] !== 'string' || env[field].trim() === '') blockers.push({
      code: 'REQUIRED_ENV_MISSING', field,
    });
  }
  const appToken = env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN;
  if (typeof appToken !== 'string' || appToken.trim() === '') blockers.push({
    code: 'REQUIRED_ENV_MISSING', field: 'LARK_APP_TOKEN|LARK_BASE_APP_TOKEN',
  });
  const enabledFlags = Object.entries(env)
    .filter(([name, value]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
      && String(value).toLowerCase() === 'true')
    .map(([name]) => name)
    .sort();
  if (enabledFlags.length > 0) blockers.push({
    code: 'LOCAL_EXECUTION_FLAGS_NOT_ALL_FALSE', fields: enabledFlags,
  });
  if (blockers.length > 0) throw schemaError(
    'Notification Log local preflight found blockers',
    'LARK_NOTIFICATION_LOG_LOCAL_PREFLIGHT_BLOCKED',
    { blockerCount: blockers.length, blockers },
  );
  return Object.freeze({ config, env });
}

async function readOptionalPrivateDevVars(path, blockers) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      blockers.push({ code: 'DEV_VARS_FILE_TYPE_INVALID' });
      return {};
    }
    if ((metadata.mode & 0o077) !== 0) await chmod(path, 0o600);
    return await readDevVars(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    blockers.push({ code: 'DEV_VARS_READ_FAILED', sourceCode: error?.code ?? null });
    return {};
  }
}

async function acquireLock() {
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({
      contractVersion: LARK_NOTIFICATION_LOG_SCHEMA_CONTRACT_VERSION,
      head: repository.head,
      pid: process.pid,
      createdAt: Date.now(),
    })}\n`, 'utf8');
    await chmod(lockPath, 0o600);
    return handle;
  } catch (error) {
    if (error?.code === 'EEXIST') throw schemaError(
      'A Notification Log schema lock already exists and is never deleted automatically',
      'LARK_NOTIFICATION_LOG_LOCK_EXISTS',
      { lockPath: relative(repositoryRoot, lockPath) },
    );
    throw error;
  }
}

async function createAttemptDirectory() {
  const timestamp = new Date().toISOString().replace(/[-:.]/gu, '');
  const path = resolve(outputRoot, `${timestamp}-${repository.head.slice(0, 12)}-${process.pid}`);
  await mkdir(path, { recursive: false, mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(path, 0o600);
}

async function runGit(args) {
  await gitCommand(args, false);
}

async function gitText(args) {
  return gitCommand(args, true);
}

async function gitCommand(args, returnText) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return returnText ? String(result.stdout ?? '').trim() : undefined;
  } catch (error) {
    throw schemaError(
      `Git command failed: git ${args.join(' ')}`,
      'LARK_NOTIFICATION_LOG_GIT_FAILED',
      { exitCode: Number.isInteger(error?.code) ? error.code : null },
    );
  }
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitizeText(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    /token|secret|password|authorization|webhook|group.?id/iu.test(key)
      ? '[redacted]'
      : sanitizeValue(nested),
  ]));
}

function sanitizeText(value) {
  return String(value)
    .replace(/https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]+/gu, '[redacted-webhook]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, 'Bearer [redacted]')
    .slice(0, 1000);
}
