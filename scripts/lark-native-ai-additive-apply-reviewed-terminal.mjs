#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  applyLarkNativeAiAdditiveSchema,
  validateLarkNativeAiRemoteInventoryEvidence,
} from '../packages/application/src/reports/apply-lark-native-ai-additive-schema.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  assertLarkNativeAiSchemaApplyConfirmation,
  assertLarkNativeAiSchemaApplyRepository,
  createLarkNativeAiSchemaApplyFetchGuard,
  LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION,
  LARK_NATIVE_AI_SCHEMA_APPLY_TERMINAL_VERSION,
  parseLarkNativeAiSchemaApplyArgs,
  requireExactSha,
  requireSha256,
  sanitizeLarkNativeAiSchemaApplyError,
  schemaApplyError,
} from './lib/lark-native-ai-additive-apply.js';

const repositoryRoot = resolve(process.cwd());
const configPath = resolve(process.env.MKT_LARK_NATIVE_AI_SCHEMA_APPLY_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const outputPath = resolve(
  process.env.MKT_LARK_NATIVE_AI_SCHEMA_APPLY_OUTPUT
    ?? 'outputs/lark-native-ai-schema-apply/apply-summary.json',
);

let stage = 'init';
let options = Object.freeze({ execute: false });
let fetchGuard = null;
let repository = null;
let evidence = null;
const completedActions = [];

try {
  options = parseLarkNativeAiSchemaApplyArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeReviewedApply();
} catch (error) {
  const remote = fetchGuard?.snapshot() ?? emptyRemoteCounts();
  const failure = {
    ok: false,
    contractVersion: LARK_NATIVE_AI_SCHEMA_APPLY_TERMINAL_VERSION,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_SCHEMA_APPLY_FAILED',
    message: sanitizeLarkNativeAiSchemaApplyError(error),
    repository,
    evidenceIdentity: evidence ? {
      repositoryHead: evidence.repository?.head ?? null,
      inventorySha256: evidence.inventory?.sourceSha256 ?? null,
    } : null,
    completedActions: [...completedActions],
    remote,
    safety: safetyState(remote),
  };
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  if (options.execute) await writePrivateJson(outputPath, failure).catch(() => undefined);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: LARK_NATIVE_AI_SCHEMA_APPLY_TERMINAL_VERSION,
    command: `CONFIRM_LARK_NATIVE_AI_SCHEMA_APPLY=${LARK_NATIVE_AI_SCHEMA_APPLY_CONFIRMATION} MKT_LARK_NATIVE_AI_SCHEMA_APPLY_REVIEWED_HEAD=<exact-reviewed-main-sha> MKT_LARK_NATIVE_AI_SCHEMA_EVIDENCE_HEAD=<exact-evidence-head> MKT_LARK_NATIVE_AI_REMOTE_INVENTORY_EVIDENCE=<inventory-summary.json> MKT_LARK_NATIVE_AI_EXPECTED_BASE_IDENTITY_HASH=<sha256> MKT_LARK_NATIVE_AI_EXPECTED_INVENTORY_SHA256=<sha256> node scripts/lark-native-ai-additive-apply-reviewed-terminal.mjs --execute`,
    repositoryGate: {
      branch: 'main',
      clean: true,
      headEqualsReviewedHead: true,
      evidenceHeadIsAncestor: true,
    },
    evidenceGate: {
      exactEvidenceHead: true,
      exactBaseIdentityHash: true,
      exactInitialInventorySha256: true,
      expectedActions: 31,
      additiveOnly: true,
      blockers: 0,
    },
    mutationScope: {
      addFields: 23,
      extendSelectFields: 2,
      createViews: 6,
      renameDeleteTypeChange: 0,
      recordReads: 0,
    },
    replayRequired: 'zero_drift',
    executeAuthorized: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeReviewedApply() {
  stage = 'confirmation';
  assertLarkNativeAiSchemaApplyConfirmation(process.env);
  const reviewedHead = requireExactSha(
    process.env.MKT_LARK_NATIVE_AI_SCHEMA_APPLY_REVIEWED_HEAD,
    'MKT_LARK_NATIVE_AI_SCHEMA_APPLY_REVIEWED_HEAD',
  );
  const evidenceHead = requireExactSha(
    process.env.MKT_LARK_NATIVE_AI_SCHEMA_EVIDENCE_HEAD,
    'MKT_LARK_NATIVE_AI_SCHEMA_EVIDENCE_HEAD',
  );
  const expectedBaseHash = requireSha256(
    process.env.MKT_LARK_NATIVE_AI_EXPECTED_BASE_IDENTITY_HASH,
    'MKT_LARK_NATIVE_AI_EXPECTED_BASE_IDENTITY_HASH',
  );
  const expectedInventoryHash = requireSha256(
    process.env.MKT_LARK_NATIVE_AI_EXPECTED_INVENTORY_SHA256,
    'MKT_LARK_NATIVE_AI_EXPECTED_INVENTORY_SHA256',
  );

  stage = 'repository-read-only-preflight';
  repository = assertLarkNativeAiSchemaApplyRepository(collectRepositoryState({
    reviewedHead,
    evidenceHead,
  }));

  stage = 'load-reviewed-inventory-evidence';
  const evidencePath = requirePath(
    process.env.MKT_LARK_NATIVE_AI_REMOTE_INVENTORY_EVIDENCE,
    'MKT_LARK_NATIVE_AI_REMOTE_INVENTORY_EVIDENCE',
  );
  evidence = validateLarkNativeAiRemoteInventoryEvidence(
    parseJsonObject(await readFile(evidencePath, 'utf8'), 'Remote inventory evidence'),
  );
  if (evidence.repository?.head !== evidenceHead || evidence.repository?.reviewedHead !== evidenceHead
    || evidence.repository?.clean !== true || evidence.repository?.branch !== 'main') {
    throw schemaApplyError(
      'Remote inventory evidence repository identity is invalid',
      'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_REPOSITORY_INVALID',
    );
  }
  if (evidence.baseIdentityHash !== expectedBaseHash) throw schemaApplyError(
    'Remote inventory evidence Base identity hash does not match the reviewed value',
    'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_BASE_HASH_MISMATCH',
  );
  if (evidence.inventory?.sourceSha256 !== expectedInventoryHash) throw schemaApplyError(
    'Remote inventory evidence inventory hash does not match the reviewed value',
    'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_INVENTORY_HASH_MISMATCH',
  );
  if (evidence.remote?.blockedRequestCount !== 0 || evidence.safety?.remoteLarkWriteCount !== 0
    || evidence.safety?.recordReadCount !== 0 || evidence.safety?.applyAuthorized !== false) {
    throw schemaApplyError(
      'Remote inventory evidence safety state is invalid',
      'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_SAFETY_INVALID',
    );
  }

  stage = 'load-local-lark-config';
  const config = parseJsoncObject(await readFile(configPath, 'utf8'));
  const devVars = await readOptionalDevVars(devVarsPath);
  const env = Object.freeze({ ...(config.vars ?? {}), ...devVars, ...process.env });
  const appToken = requireCredential(
    env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN,
    'LARK_APP_TOKEN or LARK_BASE_APP_TOKEN',
  );
  requireCredential(env.LARK_APP_ID, 'LARK_APP_ID');
  requireCredential(env.LARK_APP_SECRET, 'LARK_APP_SECRET');
  const observedBaseHash = createHash('sha256').update(appToken).digest('hex');
  if (observedBaseHash !== expectedBaseHash) throw schemaApplyError(
    'Local Lark Base credential does not match the reviewed evidence',
    'LARK_NATIVE_AI_SCHEMA_APPLY_LOCAL_BASE_HASH_MISMATCH',
  );

  stage = 'remote-additive-schema-apply';
  fetchGuard = createLarkNativeAiSchemaApplyFetchGuard(globalThis.fetch?.bind(globalThis));
  const client = createLarkBitableClientFromEnv(env, {
    fetchImpl: fetchGuard.fetchImpl,
    onRequest: () => undefined,
  });
  const result = await applyLarkNativeAiAdditiveSchema({
    client,
    evidence,
    onAction: ({ key }) => completedActions.push(key),
  });
  const remote = fetchGuard.snapshot();
  if (remote.blockedRequestCount !== 0 || remote.recordReadCount !== 0
    || remote.tableMutationCount !== 0 || remote.deleteCount !== 0) {
    throw schemaApplyError(
      'Network guard recorded an out-of-scope request',
      'LARK_NATIVE_AI_SCHEMA_APPLY_REQUEST_GUARD_DRIFT',
      { remote },
    );
  }
  if (remote.fieldCreateCount > 23 || remote.fieldUpdateCount > 2
    || remote.viewCreateCount > 6 || remote.viewUpdateCount > 5) {
    throw schemaApplyError(
      'Observed additive mutation counts exceed the reviewed contract',
      'LARK_NATIVE_AI_SCHEMA_APPLY_MUTATION_COUNT_EXCEEDED',
      { remote },
    );
  }

  stage = 'write-private-apply-evidence';
  const summary = {
    ok: true,
    contractVersion: LARK_NATIVE_AI_SCHEMA_APPLY_TERMINAL_VERSION,
    repository,
    sourceEvidence: {
      repositoryHead: evidenceHead,
      baseIdentityHash: expectedBaseHash,
      inventorySha256: expectedInventoryHash,
      collectedAt: evidence.collectedAt ?? null,
    },
    result,
    remote,
    safety: safetyState(remote),
    completedAt: new Date().toISOString(),
  };
  await writePrivateJson(outputPath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, outputPath }, null, 2)}\n`);
}

function collectRepositoryState({ reviewedHead, evidenceHead }) {
  const branch = runGit(['branch', '--show-current']);
  const head = runGit(['rev-parse', 'HEAD']);
  const clean = runGit(['status', '--porcelain', '--untracked-files=all'], false).trim() === '';
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', evidenceHead, reviewedHead], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (ancestor.error || ![0, 1].includes(ancestor.status)) throw schemaApplyError(
    'Unable to verify Remote inventory evidence ancestry',
    'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_ANCESTRY_READ_FAILED',
    { status: ancestor.status },
  );
  return Object.freeze({
    branch,
    head,
    reviewedHead,
    evidenceHead,
    clean,
    evidenceHeadAncestor: ancestor.status === 0,
  });
}

function runGit(args, trim = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw schemaApplyError(
    `Unable to read repository state: git ${args.join(' ')}`,
    'LARK_NATIVE_AI_SCHEMA_APPLY_REPOSITORY_READ_FAILED',
    { status: result.status },
  );
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
async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
function parseJsonObject(value, label) {
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError();
    return parsed;
  } catch {
    throw schemaApplyError(
      `${label} must contain one JSON object`,
      'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_JSON_INVALID',
    );
  }
}
function requirePath(value, fieldName) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw schemaApplyError(
    `${fieldName} is required`,
    'LARK_NATIVE_AI_SCHEMA_APPLY_EVIDENCE_PATH_REQUIRED',
  );
  return resolve(text);
}
function requireCredential(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw schemaApplyError(
    `${fieldName} is required`,
    'LARK_NATIVE_AI_SCHEMA_APPLY_CREDENTIAL_REQUIRED',
    { fieldName },
  );
  return value.trim();
}
function emptyRemoteCounts() {
  return Object.freeze({
    tokenRequestCount: 0,
    metadataReadCount: 0,
    fieldCreateCount: 0,
    fieldUpdateCount: 0,
    viewCreateCount: 0,
    viewUpdateCount: 0,
    schemaWriteCount: 0,
    blockedRequestCount: 0,
    recordReadCount: 0,
    tableMutationCount: 0,
    deleteCount: 0,
  });
}
function safetyState(remote) {
  return Object.freeze({
    schemaWriteCount: remote.schemaWriteCount ?? 0,
    renameFieldCount: 0,
    deleteFieldCount: 0,
    changeFieldTypeCount: 0,
    deleteViewCount: 0,
    recordReadCount: 0,
    automationCreateCount: 0,
    notificationSendCount: 0,
    aiCallCount: 0,
    remoteD1QueueWorkerProviderCount: 0,
    production: 'BLOCKED',
  });
}
