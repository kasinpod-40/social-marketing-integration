#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { collectLarkNativeAiSchemaInventory } from '../packages/application/src/reports/collect-lark-native-ai-schema-inventory.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  assertLarkNativeAiRemoteInventoryConfirmation,
  assertLarkNativeAiReviewedRepository,
  createLarkNativeAiReadOnlyFetchGuard,
  LARK_NATIVE_AI_REMOTE_INVENTORY_CONFIRMATION,
  LARK_NATIVE_AI_REMOTE_INVENTORY_CONTRACT,
  parseLarkNativeAiRemoteInventoryArgs,
  remoteInventoryError,
  requireLarkNativeAiReviewedHead,
  sanitizeLarkNativeAiRemoteErrorMessage,
} from './lib/lark-native-ai-remote-inventory.js';

const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_LARK_NATIVE_AI_REMOTE_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const evidencePath = resolve(
  process.env.MKT_LARK_NATIVE_AI_REMOTE_INVENTORY_EVIDENCE
    ?? 'outputs/lark-native-ai-remote-inventory/inventory-summary.json',
);

let stage = 'init';
let fetchGuard = null;

try {
  const options = parseLarkNativeAiRemoteInventoryArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeReviewedInventory();
} catch (error) {
  const remote = fetchGuard?.snapshot() ?? Object.freeze({
    tokenRequestCount: 0,
    metadataReadCount: 0,
    blockedRequestCount: 0,
  });
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_REMOTE_INVENTORY_FAILED',
    message: sanitizeLarkNativeAiRemoteErrorMessage(error),
    remote,
    remoteLarkWriteCount: 0,
    recordReadCount: 0,
    automationCreateCount: 0,
    notificationSendCount: 0,
    aiCallCount: 0,
    remoteD1QueueWorkerProviderCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: LARK_NATIVE_AI_REMOTE_INVENTORY_CONTRACT,
    command: `CONFIRM_LARK_NATIVE_AI_REMOTE_INVENTORY=${LARK_NATIVE_AI_REMOTE_INVENTORY_CONFIRMATION} MKT_LARK_NATIVE_AI_REMOTE_REVIEWED_HEAD=<exact-reviewed-main-sha> node scripts/lark-native-ai-remote-inventory-reviewed-terminal.mjs --execute`,
    repositoryGate: {
      branch: 'main',
      clean: true,
      headEqualsReviewedHead: true,
    },
    allowedRemoteRequests: [
      'POST tenant_access_token authentication',
      'GET Base table metadata',
      'GET target table field metadata',
      'GET target table view metadata',
    ],
    persistedRemoteIds: 0,
    recordReadCount: 0,
    remoteLarkWriteCount: 0,
    automationCreateCount: 0,
    notificationSendCount: 0,
    aiCallCount: 0,
    remoteD1QueueWorkerProviderCount: 0,
    applyAuthorized: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeReviewedInventory() {
  stage = 'confirmation';
  assertLarkNativeAiRemoteInventoryConfirmation(process.env);
  const reviewedHead = requireLarkNativeAiReviewedHead(
    process.env.MKT_LARK_NATIVE_AI_REMOTE_REVIEWED_HEAD,
  );

  stage = 'repository-read-only-preflight';
  const repository = assertLarkNativeAiReviewedRepository(collectRepositoryState(reviewedHead));

  stage = 'load-local-config';
  const configSource = await readFile(configPath, 'utf8');
  const parsedConfig = parseJsoncObject(configSource);
  const devVars = await readOptionalDevVars(devVarsPath);
  const env = Object.freeze({
    ...(parsedConfig.vars ?? {}),
    ...devVars,
    ...process.env,
  });
  const appToken = requireLarkCredential(
    env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN,
    'LARK_APP_TOKEN or LARK_BASE_APP_TOKEN',
  );
  requireLarkCredential(env.LARK_APP_ID, 'LARK_APP_ID');
  requireLarkCredential(env.LARK_APP_SECRET, 'LARK_APP_SECRET');

  stage = 'remote-lark-metadata-read-only';
  fetchGuard = createLarkNativeAiReadOnlyFetchGuard(globalThis.fetch?.bind(globalThis));
  const client = createLarkBitableClientFromEnv(env, {
    fetchImpl: fetchGuard.fetchImpl,
    onRequest: () => undefined,
  });
  const result = await collectLarkNativeAiSchemaInventory({
    client,
    baseName: env.MKT_LARK_BASE_NAME ?? null,
  });
  const remote = fetchGuard.snapshot();
  if (remote.blockedRequestCount !== 0) {
    throw remoteInventoryError(
      'Read-only request guard recorded a blocked request',
      'LARK_NATIVE_AI_REMOTE_REQUEST_GUARD_DRIFT',
      { blockedRequestCount: remote.blockedRequestCount },
    );
  }
  if (remote.metadataReadCount < result.metadataReadOperations) {
    throw remoteInventoryError(
      'Observed Lark metadata reads are fewer than the collector contract',
      'LARK_NATIVE_AI_REMOTE_READ_COUNT_INVALID',
      { observed: remote.metadataReadCount, minimum: result.metadataReadOperations },
    );
  }

  stage = 'write-private-sanitized-evidence';
  const summary = Object.freeze({
    ok: result.ok,
    contractVersion: LARK_NATIVE_AI_REMOTE_INVENTORY_CONTRACT,
    repository,
    baseIdentityHash: createHash('sha256').update(appToken).digest('hex'),
    collectedAt: new Date().toISOString(),
    inventory: result.inventory,
    preview: result.preview,
    remote,
    safety: Object.freeze({
      persistedRemoteIds: 0,
      recordReadCount: 0,
      remoteLarkWriteCount: 0,
      automationCreateCount: 0,
      notificationSendCount: 0,
      aiCallCount: 0,
      remoteD1QueueWorkerProviderCount: 0,
      applyAuthorized: false,
      production: 'BLOCKED',
    }),
  });
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  await chmod(evidencePath, 0o600);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

function collectRepositoryState(reviewedHead) {
  return Object.freeze({
    branch: runGit(['branch', '--show-current']),
    head: runGit(['rev-parse', 'HEAD']),
    reviewedHead,
    clean: runGit(['status', '--porcelain', '--untracked-files=all'], false).trim() === '',
  });
}

function runGit(args, trim = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw remoteInventoryError(
      `Unable to read repository state: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_REMOTE_REPOSITORY_READ_FAILED',
      { status: result.status },
    );
  }
  const value = String(result.stdout ?? '');
  return trim ? value.trim() : value;
}

async function readOptionalDevVars(path) {
  try {
    return await readDevVars(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({});
    throw error;
  }
}
function requireLarkCredential(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw remoteInventoryError(
      `${fieldName} is required`,
      'LARK_NATIVE_AI_REMOTE_CREDENTIAL_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}
