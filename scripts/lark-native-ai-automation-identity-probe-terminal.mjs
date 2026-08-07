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
  LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_CONFIRMATION,
  LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_LIMITS,
  LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_OUTPUT_ROOT,
  LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_VERSION,
} from '../packages/config/src/lark-native-ai-automation-identity-probe-contract.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  inspectLarkNativeAiAutomationIdentity,
  probeError,
} from './lib/lark-native-ai-automation-identity-probe.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_LARK_NATIVE_AI_AUTOMATION_PROBE_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const outputRoot = resolve(
  process.env.MKT_LARK_NATIVE_AI_AUTOMATION_PROBE_OUTPUT_ROOT
    ?? LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_OUTPUT_ROOT,
);
const lockPath = resolve(outputRoot, '.automation-identity-probe.lock');

let stage = 'init';
let repository = null;
let remote = null;
let attemptDirectory = null;
let lockHandle = null;
let summaryWritten = false;

try {
  const args = process.argv.slice(2);
  if (args.length === 0) printPlan();
  else if (args.length === 1 && args[0] === '--execute') await executeProbe();
  else throw probeError(
    'Only --execute is supported',
    'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_ARGUMENT_UNSUPPORTED',
    { argumentCount: args.length },
  );
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    contractVersion: LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_VERSION,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_FAILED',
    message: sanitizeText(error?.message ?? String(error)),
    details: sanitizeValue(error?.details ?? {}),
    repository,
    remote: remote?.snapshot?.() ?? null,
    attemptDirectory: attemptDirectory ? relative(repositoryRoot, attemptDirectory) : null,
    automationCreateCount: 0,
    automationUpdateCount: 0,
    automationStatusChangeCount: 0,
    recordWriteCount: 0,
    nativeAiCallCount: 0,
    notificationCount: 0,
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
    contractVersion: LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_VERSION,
    objective: 'resolve_existing_lark_base_ui_automation_identities_without_mutation',
    exactCommand: [
      'cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag &&',
      'git fetch --quiet origin main &&',
      'git switch main &&',
      'git pull --ff-only origin main &&',
      `CONFIRM_LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE=${LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_CONFIRMATION}`,
      'node scripts/lark-native-ai-automation-identity-probe-terminal.mjs --execute',
    ].join(' '),
    readBoundary: Object.freeze([
      'tenant_access_token',
      'bitable_v1_list_automations',
      'base_v3_get_exact_workflow',
    ]),
    automationCreateCount: 0,
    automationUpdateCount: 0,
    automationStatusChangeCount: 0,
    recordWriteCount: 0,
    nativeAiCallCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    executed: false,
  }, null, 2)}\n`);
}

async function executeProbe() {
  stage = 'confirmation';
  if (process.env.CONFIRM_LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE
    !== LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_CONFIRMATION) throw probeError(
    'Exact Lark Native AI Automation identity confirmation is missing',
    'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_CONFIRMATION_INVALID',
  );
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) throw probeError(
    'Node.js 22 or newer is required',
    'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_NODE_VERSION_UNSUPPORTED',
    { nodeMajor },
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
    || repository.head !== repository.originMain || !/^[a-f0-9]{40}$/u.test(repository.head)) throw probeError(
    'Automation identity probe requires clean current main',
    'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_REPOSITORY_INVALID',
    repository,
  );

  stage = 'local-preflight';
  const runtime = await loadAndValidateRuntime();

  stage = 'acquire-local-lock';
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await chmod(outputRoot, 0o700);
  lockHandle = await acquireLock();

  stage = 'create-immutable-attempt-directory';
  attemptDirectory = await createAttemptDirectory();

  stage = 'read-live-automation-identities';
  remote = createReadOnlyFetchGuard(globalThis.fetch.bind(globalThis));
  const rawClient = createLarkBitableClientFromEnv(Object.freeze({
    ...runtime.env,
    LARK_MAX_ATTEMPTS: '1',
    LARK_REQUEST_TIMEOUT_MS: '30000',
    LARK_MIN_REQUEST_INTERVAL_MS: '150',
  }), {
    fetchImpl: remote.fetchImpl,
    onRequest: (event) => process.stderr.write(`${JSON.stringify({
      stage: 'lark_automation_identity_read',
      event: sanitizeValue(event),
    })}\n`),
  });
  const client = createAutomationIdentityClient(rawClient);
  const probe = await inspectLarkNativeAiAutomationIdentity({ client });

  stage = 'write-private-authority';
  const privateAuthority = Object.freeze({
    contractVersion: LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_VERSION,
    repository,
    collectedAt: new Date().toISOString(),
    status: probe.status,
    blockerCount: probe.blockerCount,
    items: await Promise.all(probe.items.map(async (item) => Object.freeze({
      title: item.title,
      state: item.state,
      count: item.count,
      workflowId: item.workflowId ?? null,
      workflowIdSha256: item.workflowId ? await sha256Hex(item.workflowId) : null,
      status: item.status ?? null,
      topology: item.topology ?? null,
    }))),
    remote: remote.snapshot(),
    mutationCount: 0,
  });
  const authorityPath = resolve(attemptDirectory, 'automation-authority.json');
  await writePrivateJson(authorityPath, privateAuthority);

  stage = 'write-summary';
  const publicItems = await Promise.all(probe.items.map(async (item) => Object.freeze({
    title: item.title,
    state: item.state,
    count: item.count,
    workflowIdSha256: item.workflowId ? await sha256Hex(item.workflowId) : null,
    status: item.status ?? null,
    topology: item.topology ?? null,
  })));
  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_VERSION,
    stage: 'complete',
    status: probe.status,
    repository,
    inventoryCount: probe.inventoryCount,
    resolvedTargetCount: probe.resolvedTargetCount,
    inactiveTargetCount: probe.inactiveTargetCount,
    items: publicItems,
    blockerCount: probe.blockerCount,
    blockers: sanitizeValue(probe.blockers),
    remote: remote.snapshot(),
    authorityPath: relative(repositoryRoot, authorityPath),
    attemptDirectory: relative(repositoryRoot, attemptDirectory),
    automationCreateCount: 0,
    automationUpdateCount: 0,
    automationStatusChangeCount: 0,
    recordWriteCount: 0,
    nativeAiCallCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    nextStep: probe.blockerCount === 0
      ? 'review_exact_inactive_ai_materialization_definition_before_prompt_v2_configuration'
      : 'stop_without_mutation_and_review_blockers',
  });
  await writePrivateJson(resolve(attemptDirectory, 'summary.json'), summary);
  summaryWritten = true;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function createAutomationIdentityClient(rawClient) {
  return Object.freeze({
    async listAutomations() {
      const response = await rawClient.requestBitableJson(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(rawClient.appToken)}/workflows`,
        { method: 'GET' },
      );
      const workflows = response?.data?.workflows ?? response?.data?.items ?? response?.workflows ?? [];
      if (!Array.isArray(workflows)) throw probeError(
        'Lark List automations returned an invalid collection',
        'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_INVENTORY_INVALID',
      );
      return Object.freeze(workflows.map((item) => Object.freeze({
        workflowId: item?.workflow_id ?? item?.workflowId ?? item?.id,
        title: item?.title ?? item?.name,
        status: item?.status ?? item?.state,
      })));
    },
    async getWorkflow({ workflowId }) {
      const id = requireWorkflowId(workflowId);
      const response = await rawClient.requestBitableJson(
        `/open-apis/base/v3/bases/${encodeURIComponent(rawClient.appToken)}/workflows/${encodeURIComponent(id)}`,
        { method: 'GET' },
      );
      return response?.data?.workflow ?? response?.data ?? response;
    },
  });
}

function createReadOnlyFetchGuard(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const counters = {
    token: 0,
    automationListRead: 0,
    workflowGetRead: 0,
    blocked: 0,
  };
  const authPath = '/open-apis/auth/v3/tenant_access_token/internal';
  const automationListPath = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/workflows$/u;
  const workflowGetPath = /^\/open-apis\/base\/v3\/bases\/[^/]+\/workflows\/[^/]+$/u;
  const limits = {
    token: LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_LIMITS.maximumTokenReads,
    automationListRead: LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_LIMITS.maximumAutomationListReads,
    workflowGetRead: LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_LIMITS.maximumWorkflowGetReads,
  };

  async function guardedFetch(url, options = {}) {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = String(options.method ?? 'GET').toUpperCase();
    let kind = null;
    if (method === 'POST' && path === authPath) kind = 'token';
    else if (method === 'GET' && automationListPath.test(path)) kind = 'automationListRead';
    else if (method === 'GET' && workflowGetPath.test(path)) kind = 'workflowGetRead';
    if (!kind) {
      counters.blocked += 1;
      throw probeError(
        'Automation identity probe request is outside the read-only allowlist',
        'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_REQUEST_BLOCKED',
        { method, path: sanitizePath(path) },
      );
    }
    counters[kind] += 1;
    if (counters[kind] > limits[kind]) {
      counters.blocked += 1;
      throw probeError(
        'Automation identity probe read limit exceeded',
        'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_REQUEST_LIMIT_EXCEEDED',
        { kind, observed: counters[kind], maximum: limits[kind] },
      );
    }
    return fetchImpl(url, options);
  }

  return Object.freeze({
    fetchImpl: guardedFetch,
    snapshot: () => Object.freeze({ ...counters }),
  });
}

async function loadAndValidateRuntime() {
  let config;
  try {
    config = parseJsoncObject(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw probeError(
      'Reviewed wrangler.sync.jsonc could not be loaded',
      'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_CONFIG_INVALID',
      { code: error?.code ?? null },
    );
  }
  const devVars = await readOptionalPrivateDevVars(devVarsPath);
  const env = Object.freeze({ ...(config.vars ?? {}), ...devVars, ...process.env });
  const blockers = [];
  if (config.name !== 'social-mkt-sync-worker') blockers.push({ code: 'WORKER_NAME_INVALID' });
  if (env.MKT_ENV !== 'development') blockers.push({ code: 'MKT_ENV_INVALID' });
  if (env.MKT_CUSTOMER_PROFILE !== 'integration_workspace') blockers.push({ code: 'CUSTOMER_PROFILE_INVALID' });
  for (const field of ['LARK_APP_ID', 'LARK_APP_SECRET']) {
    if (!optionalText(env[field])) blockers.push({ code: 'REQUIRED_ENV_MISSING', field });
  }
  if (!optionalText(env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN)) blockers.push({
    code: 'REQUIRED_ENV_MISSING', field: 'LARK_APP_TOKEN|LARK_BASE_APP_TOKEN',
  });
  if (blockers.length > 0) throw probeError(
    'Automation identity probe local preflight found blockers',
    'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_LOCAL_PREFLIGHT_BLOCKED',
    { blockerCount: blockers.length, blockers },
  );
  return Object.freeze({ config, env });
}

async function readOptionalPrivateDevVars(path) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw probeError(
      '.dev.vars must be a regular non-symlink file',
      'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_DEV_VARS_INVALID',
    );
    if ((metadata.mode & 0o077) !== 0) await chmod(path, 0o600);
    return await readDevVars(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function acquireLock() {
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({
      contractVersion: LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_VERSION,
      head: repository.head,
      pid: process.pid,
      createdAt: Date.now(),
    })}\n`, 'utf8');
    await chmod(lockPath, 0o600);
    return handle;
  } catch (error) {
    if (error?.code === 'EEXIST') throw probeError(
      'An Automation identity probe lock already exists and is never deleted automatically',
      'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_LOCK_EXISTS',
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
    encoding: 'utf8', mode: 0o600, flag: 'wx',
  });
  await chmod(path, 0o600);
}

async function runGit(args) {
  try {
    await execFileAsync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    });
  } catch (error) {
    throw probeError(
      `Git command failed: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_GIT_FAILED',
      { exitCode: Number.isInteger(error?.code) ? error.code : null },
    );
  }
}
async function gitText(args) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    });
    return String(result.stdout ?? '').trim();
  } catch (error) {
    throw probeError(
      `Git command failed: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_GIT_FAILED',
      { exitCode: Number.isInteger(error?.code) ? error.code : null },
    );
  }
}

async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
function requireWorkflowId(value) {
  const text = optionalText(value);
  if (!text || !/^wkf[A-Za-z0-9_-]{4,}$/u.test(text)) throw probeError(
    'Lark Automation returned an unsupported workflow ID',
    'LARK_NATIVE_AI_AUTOMATION_WORKFLOW_ID_INVALID',
  );
  return text;
}
function sanitizePath(path) {
  return String(path)
    .replace(/\/apps\/[^/]+/u, '/apps/[redacted]')
    .replace(/\/bases\/[^/]+/u, '/bases/[redacted]')
    .replace(/\/workflows\/[^/]+/u, '/workflows/[redacted]');
}
function sanitizeText(value) {
  return String(value ?? '')
    .replace(/https:\/\/open\.larksuite\.com\/[^\s"']+/gu, '[redacted-lark-url]')
    .replace(/\b(?:wkf|oc|cli|app|tbl|rec|vew|fld|opt)[A-Za-z0-9_-]+\b/gu, '[redacted-id]')
    .slice(0, 1000);
}
function sanitizeValue(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeValue(nested)]));
  }
  return value;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
