#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  applyLarkNativeAiSchemaAdditive,
  assertAcceptedLarkNativeAiSchemaApplyEvidence,
} from '../packages/application/src/reports/apply-lark-native-ai-schema.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_BASE_IDENTITY_HASH,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
  LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_SHA256,
  LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION,
  LARK_NATIVE_AI_SCHEMA_APPLY_CONTRACT_VERSION,
  assertLarkNativeAiSchemaApplyConfirmation,
  assertLarkNativeAiSchemaApplyRemoteCounters,
  assertLarkNativeAiSchemaApplyRepository,
  createLarkNativeAiSchemaApplyFetchGuard,
  parseLarkNativeAiSchemaApplyArgs,
  requireLarkNativeAiSchemaApplyReviewedHead,
  sanitizeLarkNativeAiSchemaApplyMessage,
  sanitizeLarkNativeAiSchemaApplyValue,
  schemaApplyError,
} from './lib/lark-native-ai-schema-apply.js';

const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_LARK_NATIVE_AI_SCHEMA_APPLY_WRANGLER_CONFIG
    ?? 'wrangler.sync.jsonc',
);
const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const retainedEvidencePath = resolve(
  process.env.MKT_LARK_NATIVE_AI_SCHEMA_APPLY_SOURCE_EVIDENCE
    ?? 'outputs/lark-native-ai-remote-inventory/inventory-summary.json',
);
const applyEvidencePath = resolve(
  process.env.MKT_LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE
    ?? 'outputs/lark-native-ai-schema-apply/apply-summary.json',
);

let stage = 'init';
let fetchGuard = null;
let repository = null;
let executionStarted = false;

try {
  const options = parseLarkNativeAiSchemaApplyArgs(process.argv.slice(2));
  if (!options.execute) {
    printPlan();
  } else {
    await executeReviewedApply();
  }
} catch (error) {
  const remote = fetchGuard?.snapshot() ?? Object.freeze({
    tokenRequestCount: 0,
    metadataReadCount: 0,
    fieldCreateCount: 0,
    fieldUpdateCount: 0,
    viewCreateCount: 0,
    viewUpdateCount: 0,
    blockedRequestCount: 0,
    totalWriteCount: 0,
  });
  const failure = Object.freeze({
    ok: false,
    contractVersion: LARK_NATIVE_AI_SCHEMA_APPLY_CONTRACT_VERSION,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_SCHEMA_APPLY_FAILED',
    message: sanitizeLarkNativeAiSchemaApplyMessage(error),
    details: sanitizeLarkNativeAiSchemaApplyValue(error?.details ?? {}),
    repository,
    acceptedInventoryHead: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
    acceptedInventorySha256: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_SHA256,
    remote,
    recordReadCount: 0,
    tableCreateCount: 0,
    tableRenameCount: 0,
    fieldDeleteCount: 0,
    viewDeleteCount: 0,
    automationCreateCount: 0,
    notificationSendCount: 0,
    aiCallCount: 0,
    remoteD1QueueWorkerProviderCount: 0,
    production: 'BLOCKED',
  });
  if (executionStarted) {
    try {
      await writePrivateEvidence(applyEvidencePath, failure);
    } catch {
      // Preserve the primary failure; inability to persist diagnostics is reported by stderr output.
    }
  }
  process.stderr.write(`${JSON.stringify({
    ...failure,
    ...(executionStarted ? { evidencePath: applyEvidencePath } : {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: LARK_NATIVE_AI_SCHEMA_APPLY_CONTRACT_VERSION,
    command: [
      `CONFIRM_LARK_NATIVE_AI_SCHEMA_APPLY=${LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION}`,
      'MKT_LARK_NATIVE_AI_SCHEMA_APPLY_REVIEWED_HEAD=<exact-reviewed-main-sha>',
      'node scripts/lark-native-ai-schema-apply-reviewed-terminal.mjs --execute',
    ].join(' '),
    retainedEvidence: {
      defaultPath: 'outputs/lark-native-ai-remote-inventory/inventory-summary.json',
      acceptedHead: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
      acceptedInventorySha256: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_SHA256,
      acceptedBaseIdentityHash: LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_BASE_IDENTITY_HASH,
    },
    repositoryGate: {
      branch: 'main',
      clean: true,
      headEqualsReviewedHead: true,
      retainedInventoryHeadIsAncestor: true,
    },
    acceptedLogicalActions: {
      addField: 23,
      extendSelectOptions: 2,
      createView: 6,
      total: 31,
    },
    maximumRemoteWriteRequests: 36,
    partialRetry: 'supported_by_current_additive_subset_and_exact_view_filter_repair',
    finalGate: 'zero_drift_and_exact_view_filter_parity',
    recordReadCount: 0,
    tableCreateCount: 0,
    tableRenameCount: 0,
    fieldDeleteCount: 0,
    viewDeleteCount: 0,
    automationCreateCount: 0,
    notificationSendCount: 0,
    aiCallCount: 0,
    remoteD1QueueWorkerProviderCount: 0,
    applyExecuted: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeReviewedApply() {
  stage = 'confirmation';
  assertLarkNativeAiSchemaApplyConfirmation(process.env);
  const reviewedHead = requireLarkNativeAiSchemaApplyReviewedHead(
    process.env.MKT_LARK_NATIVE_AI_SCHEMA_APPLY_REVIEWED_HEAD,
  );

  stage = 'repository-preflight';
  repository = assertLarkNativeAiSchemaApplyRepository(
    collectRepositoryState(reviewedHead),
  );
  assertRetainedHeadIsAncestor(
    LARK_NATIVE_AI_SCHEMA_APPLY_ACCEPTED_INVENTORY_HEAD,
    repository.head,
  );
  executionStarted = true;

  stage = 'load-retained-read-only-evidence';
  await assertPrivateEvidenceMode(retainedEvidencePath);
  const retainedEvidence = parseJson(
    await readFile(retainedEvidencePath, 'utf8'),
    'retained Remote inventory evidence',
  );
  const accepted = await assertAcceptedLarkNativeAiSchemaApplyEvidence(
    retainedEvidence,
  );

  stage = 'load-local-config';
  const configSource = await readFile(configPath, 'utf8');
  const parsedConfig = parseJsoncObject(configSource);
  const devVars = await readOptionalDevVars(devVarsPath);
  const env = Object.freeze({
    ...(parsedConfig.vars ?? {}),
    ...devVars,
    ...process.env,
  });
  const appToken = requireCredential(
    env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN,
    'LARK_APP_TOKEN or LARK_BASE_APP_TOKEN',
  );
  requireCredential(env.LARK_APP_ID, 'LARK_APP_ID');
  requireCredential(env.LARK_APP_SECRET, 'LARK_APP_SECRET');
  const currentBaseIdentityHash = createHash('sha256').update(appToken).digest('hex');
  if (currentBaseIdentityHash !== accepted.baseIdentityHash) {
    throw schemaApplyError(
      'Current Lark Base identity does not match the accepted Remote inventory',
      'LARK_NATIVE_AI_SCHEMA_APPLY_BASE_IDENTITY_INVALID',
      {
        currentMatchesAccepted: false,
      },
    );
  }

  stage = 'remote-additive-schema-apply';
  fetchGuard = createLarkNativeAiSchemaApplyFetchGuard(
    globalThis.fetch?.bind(globalThis),
  );
  const client = createLarkBitableClientFromEnv(env, {
    fetchImpl: fetchGuard.fetchImpl,
    onRequest: process.env.MKT_LARK_NATIVE_AI_SCHEMA_APPLY_VERBOSE === 'true'
      ? (event) => process.stderr.write(`${JSON.stringify(
        sanitizeLarkNativeAiSchemaApplyValue(event),
      )}\n`)
      : undefined,
  });
  const result = await applyLarkNativeAiSchemaAdditive({
    client,
    retainedEvidence,
    baseName: null,
    onProgress: process.env.MKT_LARK_NATIVE_AI_SCHEMA_APPLY_VERBOSE === 'true'
      ? (event) => process.stderr.write(`${JSON.stringify(event)}\n`)
      : undefined,
  });

  stage = 'verify-remote-request-boundary';
  const remote = fetchGuard.snapshot();
  assertLarkNativeAiSchemaApplyRemoteCounters(remote);
  if (result.verification?.status !== 'zero_drift'
    || Number(result.verification?.remainingLogicalActionCount) !== 0) {
    throw schemaApplyError(
      'Schema Apply result did not prove final zero drift',
      'LARK_NATIVE_AI_SCHEMA_APPLY_VERIFICATION_FAILED',
    );
  }

  stage = 'write-private-sanitized-evidence';
  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_SCHEMA_APPLY_CONTRACT_VERSION,
    repository,
    retainedAuthority: {
      head: accepted.retainedHead,
      inventorySha256: accepted.inventorySha256,
      baseIdentityHashMatches: currentBaseIdentityHash === accepted.baseIdentityHash,
    },
    result,
    remote,
    safety: {
      persistedRemoteIds: 0,
      recordReadCount: 0,
      tableCreateCount: 0,
      tableRenameCount: 0,
      fieldDeleteCount: 0,
      viewDeleteCount: 0,
      automationCreateCount: 0,
      notificationSendCount: 0,
      aiCallCount: 0,
      remoteD1QueueWorkerProviderCount: 0,
      production: 'BLOCKED',
    },
  });
  await writePrivateEvidence(applyEvidencePath, summary);
  process.stdout.write(`${JSON.stringify({
    ...summary,
    evidencePath: applyEvidencePath,
  }, null, 2)}\n`);
}

function collectRepositoryState(reviewedHead) {
  return Object.freeze({
    branch: runGit(['branch', '--show-current']),
    head: runGit(['rev-parse', 'HEAD']),
    reviewedHead,
    clean: runGit(
      ['status', '--porcelain', '--untracked-files=all'],
      { trim: false },
    ).trim() === '',
  });
}

function assertRetainedHeadIsAncestor(retainedHead, currentHead) {
  const result = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', retainedHead, currentHead],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.status === 0) return true;
  if (result.status === 1) {
    throw schemaApplyError(
      'Accepted Remote inventory Head is not an ancestor of the reviewed Apply Head',
      'LARK_NATIVE_AI_SCHEMA_APPLY_RETAINED_HEAD_NOT_ANCESTOR',
      {
        retainedHead,
        currentHead,
      },
    );
  }
  throw schemaApplyError(
    'Unable to verify retained inventory ancestry',
    'LARK_NATIVE_AI_SCHEMA_APPLY_REPOSITORY_READ_FAILED',
    { status: result.status },
  );
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw schemaApplyError(
      `Unable to read repository state: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_SCHEMA_APPLY_REPOSITORY_READ_FAILED',
      { status: result.status },
    );
  }
  const value = String(result.stdout ?? '');
  return options.trim === false ? value : value.trim();
}

async function assertPrivateEvidenceMode(path) {
  const details = await stat(path);
  if (!details.isFile()) {
    throw schemaApplyError(
      'Retained Remote inventory evidence is not a regular file',
      'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_FILE_INVALID',
    );
  }
  if ((details.mode & 0o077) !== 0) {
    throw schemaApplyError(
      'Retained Remote inventory evidence must not be group/world accessible',
      'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_PERMISSIONS_INVALID',
      { expectedMode: '0600' },
    );
  }
}

async function writePrivateEvidence(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    `${JSON.stringify(sanitizeLarkNativeAiSchemaApplyValue(value), null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(path, 0o600);
}

async function readOptionalDevVars(path) {
  try {
    return await readDevVars(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({});
    throw error;
  }
}

function parseJson(value, fieldName) {
  try {
    return JSON.parse(String(value));
  } catch {
    throw schemaApplyError(
      `${fieldName} is not valid JSON`,
      'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_JSON_INVALID',
    );
  }
}

function requireCredential(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw schemaApplyError(
      `${fieldName} is required`,
      'LARK_NATIVE_AI_SCHEMA_APPLY_CREDENTIAL_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}
