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
  LARK_NATIVE_AI_TARGET_GROUP_NAME,
  LARK_NATIVE_AI_WORKFLOW_READINESS_CONFIRMATION,
  LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS,
  LARK_NATIVE_AI_WORKFLOW_READINESS_OUTPUT_ROOT,
  LARK_NATIVE_AI_WORKFLOW_READINESS_VERSION,
} from '../packages/config/src/lark-native-ai-workflow-readiness-contract.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  inspectLarkNativeAiWorkflowReadiness,
  readinessError,
} from './lib/lark-native-ai-workflow-readiness.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_LARK_NATIVE_AI_WORKFLOW_READINESS_WRANGLER_CONFIG
    ?? 'wrangler.sync.jsonc',
);
const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const outputRoot = resolve(
  process.env.MKT_LARK_NATIVE_AI_WORKFLOW_READINESS_OUTPUT_ROOT
    ?? LARK_NATIVE_AI_WORKFLOW_READINESS_OUTPUT_ROOT,
);
const lockPath = resolve(outputRoot, '.workflow-readiness.lock');

let stage = 'init';
let repository = null;
let remote = null;
let attemptDirectory = null;
let lockHandle = null;
let summaryWritten = false;

try {
  const execute = process.argv.slice(2).includes('--execute');
  if (!execute) printPlan();
  else await executeReadiness();
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    contractVersion: LARK_NATIVE_AI_WORKFLOW_READINESS_VERSION,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_WORKFLOW_READINESS_FAILED',
    message: sanitizeValue(error?.message ?? String(error)),
    details: sanitizeValue(error?.details ?? {}),
    repository,
    remote: remote?.snapshot?.() ?? null,
    attemptDirectory: attemptDirectory ? relative(repositoryRoot, attemptDirectory) : null,
    recordWriteCount: 0,
    workflowCreateCount: 0,
    workflowUpdateCount: 0,
    workflowStatusChangeCount: 0,
    automationEnabled: false,
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
    contractVersion: LARK_NATIVE_AI_WORKFLOW_READINESS_VERSION,
    objective: 'inspect_exact_disabled_workflow_and_group_destination_readiness_without_mutation',
    exactCommand: [
      'cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag &&',
      'git fetch --quiet origin main &&',
      'git pull --ff-only origin main &&',
      'MKT_CONNECTOR_TIKTOK_ENABLED=false',
      'MKT_YOUTUBE_ANALYTICS_ENABLED=false',
      `CONFIRM_LARK_NATIVE_AI_WORKFLOW_READINESS=${LARK_NATIVE_AI_WORKFLOW_READINESS_CONFIRMATION}`,
      'node scripts/lark-native-ai-workflow-readiness-terminal.mjs --execute',
    ].join(' '),
    targetGroupName: LARK_NATIVE_AI_TARGET_GROUP_NAME,
    mutationBoundary: 'read_only',
    recordWriteCount: 0,
    workflowCreateCount: 0,
    workflowUpdateCount: 0,
    workflowStatusChangeCount: 0,
    automationEnabled: false,
    notificationCount: 0,
    webhookActionCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    executed: false,
  }, null, 2)}\n`);
}

async function executeReadiness() {
  stage = 'confirmation';
  if (process.env.CONFIRM_LARK_NATIVE_AI_WORKFLOW_READINESS
    !== LARK_NATIVE_AI_WORKFLOW_READINESS_CONFIRMATION) {
    throw readinessError(
      'Exact Lark Native AI workflow readiness confirmation is missing',
      'LARK_NATIVE_AI_WORKFLOW_READINESS_CONFIRMATION_INVALID',
    );
  }
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) throw readinessError(
    'Node.js 22 or newer is required',
    'LARK_NATIVE_AI_WORKFLOW_READINESS_NODE_VERSION_UNSUPPORTED',
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
    || repository.head !== repository.originMain || !/^[a-f0-9]{40}$/u.test(repository.head)) {
    throw readinessError(
      'Workflow readiness requires clean current main',
      'LARK_NATIVE_AI_WORKFLOW_READINESS_REPOSITORY_INVALID',
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

  stage = 'read-live-workflow-readiness';
  remote = createReadOnlyFetchGuard(globalThis.fetch.bind(globalThis));
  const rawClient = createLarkBitableClientFromEnv(Object.freeze({
    ...runtime.env,
    LARK_MAX_ATTEMPTS: '1',
    LARK_MAX_PAGES: '20',
    LARK_MAX_FILTER_CONDITIONS: '50',
    LARK_REQUEST_TIMEOUT_MS: '30000',
    LARK_MIN_REQUEST_INTERVAL_MS: '150',
  }), {
    fetchImpl: remote.fetchImpl,
    onRequest: (event) => process.stderr.write(`${JSON.stringify({
      stage: 'lark_readiness_read',
      event: sanitizeValue(event),
    })}\n`),
  });
  const client = createReadOnlyWorkflowClient(rawClient);
  const readiness = await inspectLarkNativeAiWorkflowReadiness({ client });

  stage = 'write-readiness-summary';
  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_WORKFLOW_READINESS_VERSION,
    stage: 'complete',
    status: readiness.status,
    repository,
    readiness,
    remote: remote.snapshot(),
    attemptDirectory: relative(repositoryRoot, attemptDirectory),
    recordWriteCount: 0,
    workflowCreateCount: 0,
    workflowUpdateCount: 0,
    workflowStatusChangeCount: 0,
    automationEnabled: false,
    notificationCount: 0,
    webhookActionCount: 0,
    remoteD1ActionCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerActionCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
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
    throw readinessError(
      'Reviewed wrangler.sync.jsonc could not be loaded',
      'LARK_NATIVE_AI_WORKFLOW_READINESS_CONFIG_INVALID',
      { code: error?.code ?? null },
    );
  }
  const devVars = await readOptionalPrivateDevVars(devVarsPath, blockers);
  const env = Object.freeze({ ...(config.vars ?? {}), ...devVars, ...process.env });
  if (config.name !== 'social-mkt-sync-worker') blockers.push({
    code: 'WORKER_NAME_INVALID', field: 'name',
  });
  if (config.workers_dev !== false) blockers.push({
    code: 'WORKERS_DEV_NOT_DISABLED', field: 'workers_dev',
  });
  if (env.MKT_ENV !== 'development') blockers.push({
    code: 'MKT_ENV_INVALID', field: 'MKT_ENV',
  });
  if (env.MKT_CUSTOMER_PROFILE !== 'integration_workspace') blockers.push({
    code: 'CUSTOMER_PROFILE_INVALID', field: 'MKT_CUSTOMER_PROFILE',
  });
  for (const field of ['LARK_APP_ID', 'LARK_APP_SECRET']) {
    if (typeof env[field] !== 'string' || env[field].trim() === '') blockers.push({
      code: 'REQUIRED_ENV_MISSING', field,
    });
  }
  if (typeof (env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN) !== 'string'
    || (env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN).trim() === '') blockers.push({
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
  if (blockers.length > 0) throw readinessError(
    'Workflow readiness local preflight found blockers',
    'LARK_NATIVE_AI_WORKFLOW_READINESS_LOCAL_PREFLIGHT_BLOCKED',
    { blockerCount: blockers.length, blockers },
  );
  return Object.freeze({ config, env });
}

function createReadOnlyWorkflowClient(rawClient) {
  let tablePromise = null;
  return Object.freeze({
    listTables() {
      if (!tablePromise) tablePromise = rawClient.listTables();
      return tablePromise;
    },
    listFields: rawClient.listFields.bind(rawClient),
    listViews: rawClient.listViews.bind(rawClient),
    getView: rawClient.getView.bind(rawClient),
    listRecords: rawClient.listRecords.bind(rawClient),
    listWorkflows: () => listWorkflows(rawClient),
    getWorkflow: ({ workflowId }) => getWorkflow(rawClient, workflowId),
    listChats: () => listChats(rawClient),
  });
}

async function listWorkflows(client) {
  const items = [];
  let pageToken = null;
  for (let page = 1; page <= LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS.maximumWorkflowListReads; page += 1) {
    const body = { page_size: 100, ...(pageToken ? { page_token: pageToken } : {}) };
    const response = await client.requestBitableJson(
      `/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/workflows/list`,
      { method: 'POST', body },
    );
    const data = response?.data ?? response ?? {};
    const pageItems = data.items ?? data.workflows ?? data.workflow_list ?? [];
    if (!Array.isArray(pageItems)) throw readinessError(
      'Lark workflow inventory returned invalid items',
      'LARK_NATIVE_AI_WORKFLOW_INVENTORY_INVALID',
    );
    items.push(...pageItems.map(normalizeWorkflow));
    const next = optionalText(data.page_token ?? data.next_page_token);
    if (data.has_more !== true) return Object.freeze(items);
    if (!next || next === pageToken) throw readinessError(
      'Lark workflow inventory returned invalid pagination',
      'LARK_NATIVE_AI_WORKFLOW_PAGINATION_INVALID',
      { page },
    );
    pageToken = next;
  }
  throw readinessError(
    'Lark workflow inventory exceeded the reviewed page limit',
    'LARK_NATIVE_AI_WORKFLOW_PAGE_LIMIT_EXCEEDED',
  );
}

async function getWorkflow(client, workflowId) {
  const id = requireText(workflowId, 'workflowId');
  const response = await client.requestBitableJson(
    `/open-apis/base/v3/bases/${encodeURIComponent(client.appToken)}/workflows/${encodeURIComponent(id)}`,
    { method: 'GET' },
  );
  return normalizeWorkflow(response?.data?.workflow ?? response?.data ?? response);
}

async function listChats(client) {
  const items = [];
  let pageToken = null;
  for (let page = 1; page <= LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS.maximumChatListReads; page += 1) {
    const params = new URLSearchParams({ page_size: '100' });
    if (pageToken) params.set('page_token', pageToken);
    const response = await client.requestBitableJson(
      `/open-apis/im/v1/chats?${params.toString()}`,
      { method: 'GET' },
    );
    const data = response?.data ?? response ?? {};
    const pageItems = data.items ?? [];
    if (!Array.isArray(pageItems)) throw readinessError(
      'Lark chat inventory returned invalid items',
      'LARK_NATIVE_AI_CHAT_INVENTORY_INVALID',
    );
    items.push(...pageItems.map((item) => Object.freeze({
      chatId: requireText(item?.chat_id ?? item?.chatId, 'chat.chatId'),
      name: requireText(item?.name, 'chat.name'),
    })));
    const next = optionalText(data.page_token ?? data.next_page_token);
    if (data.has_more !== true) return Object.freeze(items);
    if (!next || next === pageToken) throw readinessError(
      'Lark chat inventory returned invalid pagination',
      'LARK_NATIVE_AI_CHAT_PAGINATION_INVALID',
      { page },
    );
    pageToken = next;
  }
  throw readinessError(
    'Lark chat inventory exceeded the reviewed page limit',
    'LARK_NATIVE_AI_CHAT_PAGE_LIMIT_EXCEEDED',
  );
}

function normalizeWorkflow(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.freeze({
    workflowId: requireText(
      source.workflow_id ?? source.workflowId ?? source.id,
      'workflow.workflowId',
    ),
    title: requireText(source.title ?? source.name, 'workflow.title'),
    status: optionalText(source.status ?? source.state) ?? 'unknown',
  });
}

function createReadOnlyFetchGuard(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const counters = {
    token: 0,
    tableRead: 0,
    fieldRead: 0,
    viewListRead: 0,
    viewGetRead: 0,
    recordRead: 0,
    workflowListRead: 0,
    workflowGetRead: 0,
    chatListRead: 0,
    blocked: 0,
  };
  const limits = {
    token: 2,
    tableRead: LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS.maximumTableReads,
    fieldRead: LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS.maximumFieldReads,
    viewListRead: LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS.maximumViewListReads,
    viewGetRead: LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS.maximumViewGetReads,
    recordRead: LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS.maximumRecordReads,
    workflowListRead: LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS.maximumWorkflowListReads,
    workflowGetRead: LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS.maximumWorkflowGetReads,
    chatListRead: LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS.maximumChatListReads,
  };
  const authPath = '/open-apis/auth/v3/tenant_access_token/internal';
  const tablesPath = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables$/u;
  const fieldsPath = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/fields$/u;
  const viewsPath = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/views$/u;
  const viewPath = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/views\/[^/]+$/u;
  const recordsPath = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records$/u;
  const workflowListPath = /^\/open-apis\/base\/v3\/bases\/[^/]+\/workflows\/list$/u;
  const workflowGetPath = /^\/open-apis\/base\/v3\/bases\/[^/]+\/workflows\/[^/]+$/u;
  const chatsPath = '/open-apis/im/v1/chats';

  async function guardedFetch(url, options = {}) {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = String(options.method ?? 'GET').toUpperCase();
    let kind = null;
    if (method === 'POST' && path === authPath) kind = 'token';
    else if (method === 'GET' && tablesPath.test(path)) kind = 'tableRead';
    else if (method === 'GET' && fieldsPath.test(path)) kind = 'fieldRead';
    else if (method === 'GET' && viewsPath.test(path)) kind = 'viewListRead';
    else if (method === 'GET' && viewPath.test(path)) kind = 'viewGetRead';
    else if (method === 'GET' && recordsPath.test(path)) kind = 'recordRead';
    else if (method === 'POST' && workflowListPath.test(path)) kind = 'workflowListRead';
    else if (method === 'GET' && workflowGetPath.test(path)) kind = 'workflowGetRead';
    else if (method === 'GET' && path === chatsPath) kind = 'chatListRead';

    if (!kind) {
      counters.blocked += 1;
      throw readinessError(
        'Workflow readiness request is outside the reviewed read-only allowlist',
        'LARK_NATIVE_AI_WORKFLOW_READINESS_REQUEST_BLOCKED',
        { method, path: sanitizePath(path) },
      );
    }
    counters[kind] += 1;
    if (counters[kind] > limits[kind]) {
      counters.blocked += 1;
      throw readinessError(
        'Workflow readiness read limit exceeded',
        'LARK_NATIVE_AI_WORKFLOW_READINESS_REQUEST_LIMIT_EXCEEDED',
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

async function readOptionalPrivateDevVars(path, blockers) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      blockers.push({ code: 'DEV_VARS_FILE_TYPE_INVALID', field: '.dev.vars' });
      return {};
    }
    if ((metadata.mode & 0o077) !== 0) await chmod(path, 0o600);
    return await readDevVars(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    blockers.push({ code: 'DEV_VARS_READ_FAILED', field: '.dev.vars', sourceCode: error?.code ?? null });
    return {};
  }
}

async function acquireLock() {
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({
      contractVersion: LARK_NATIVE_AI_WORKFLOW_READINESS_VERSION,
      head: repository.head,
      pid: process.pid,
      createdAt: Date.now(),
    })}\n`, 'utf8');
    await chmod(lockPath, 0o600);
    return handle;
  } catch (error) {
    if (error?.code === 'EEXIST') throw readinessError(
      'A workflow readiness lock already exists and is never deleted automatically',
      'LARK_NATIVE_AI_WORKFLOW_READINESS_LOCK_EXISTS',
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
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw readinessError(
      `Git command failed: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_WORKFLOW_READINESS_GIT_FAILED',
      { exitCode: Number.isInteger(error?.code) ? error.code : null },
    );
  }
}

async function gitText(args) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return String(result.stdout ?? '').trim();
  } catch (error) {
    throw readinessError(
      `Git command failed: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_WORKFLOW_READINESS_GIT_FAILED',
      { exitCode: Number.isInteger(error?.code) ? error.code : null },
    );
  }
}

function sanitizePath(path) {
  return String(path)
    .replace(/\/apps\/[^/]+/u, '/apps/[redacted]')
    .replace(/\/bases\/[^/]+/u, '/bases/[redacted]')
    .replace(/\/tables\/[^/]+/u, '/tables/[redacted]')
    .replace(/\/views\/[^/]+/u, '/views/[redacted]')
    .replace(/\/workflows\/[^/]+/u, '/workflows/[redacted]');
}
function sanitizeValue(value) {
  if (typeof value === 'string') return value
    .replace(/https:\/\/open\.larksuite\.com\/[^\s"']+/gu, '[redacted-lark-url]')
    .replace(/\b(?:oc|cli|app|tbl|rec|vew)_[A-Za-z0-9_-]+\b/gu, '[redacted-id]')
    .slice(0, 1000);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeValue(nested)]));
  }
  return value;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function requireText(value, field) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}
