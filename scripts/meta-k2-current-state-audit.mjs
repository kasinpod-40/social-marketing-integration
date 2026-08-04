#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import {
  buildMetaD1OnlySnapshotSql,
  normalizeMetaD1OnlySnapshot,
} from './lib/meta-d1-only-rollout-operator.js';
import {
  classifyMetaK2CurrentState,
  compareMetaK2CurrentStateSnapshots,
} from './lib/meta-k2-current-state-audit.js';
import {
  META_K2_EXACT_RECOVERY_IDENTITY,
} from '../packages/config/src/meta-k2-exact-recovery-contract.js';

const repositoryRoot = realpathSync.native(process.cwd());
const branchName = 'integration/all-meta-end-to-end-completion-v1';
const databaseBinding = 'MKT_STATE_DB';
const execute = parseArgs(process.argv.slice(2));

if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    stage: 'meta-k2-current-state-read-only-audit',
    reads: 2,
    stabilityWindowMs: 31_000,
    recoveryAuthorized: false,
    previewSettingMutationCount: 0,
    workerVersionUploadCount: 0,
    workerDeploymentCount: 0,
    remoteMutationCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exit(0);
}

try {
  const repository = verifyRepository();
  const devVarsPath = await resolveRepositoryFile(
    process.env.DEV_VARS_FILE ?? '.dev.vars',
    'DEV_VARS_FILE',
  );
  await assertPrivateFile(devVarsPath, 'DEV_VARS_FILE');
  const baseConfigPath = await resolveRepositoryFile(
    process.env.MKT_META_K2_AUDIT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
    'MKT_META_K2_AUDIT_WRANGLER_CONFIG',
  );
  const devVars = await readDevVars(devVarsPath);
  const env = cleanCloudflareEnvironment({ ...devVars, ...process.env });

  const before = readSnapshot(env, baseConfigPath);
  await sleep(31_000);
  const after = readSnapshot(env, baseConfigPath);
  const stability = compareMetaK2CurrentStateSnapshots(before, after);
  const classification = classifyMetaK2CurrentState(after);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'meta-k2-current-state-read-only-audit',
    repository,
    targetKey: META_K2_EXACT_RECOVERY_IDENTITY.targetKey,
    operationId: META_K2_EXACT_RECOVERY_IDENTITY.operationId,
    stateStable: stability.stable,
    elapsedMs: stability.elapsedMs,
    changedFields: stability.changedFields,
    boundary: classification.boundary,
    recoveryAuthorized: false,
    queueIdentityUnchanged: classification.queueIdentityUnchanged,
    noDownstreamFacts: classification.noDownstreamFacts,
    operationWriteCount: classification.operationWriteCount,
    sourceComplete: classification.sourceComplete,
    sourceIncomplete: classification.sourceIncomplete,
    workOpen: classification.workOpen,
    lockFree: classification.lockFree,
    snapshot: classification.snapshot,
    previewSettingMutationCount: 0,
    workerVersionUploadCount: 0,
    workerDeploymentCount: 0,
    remoteMutationCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'meta-k2-current-state-read-only-audit',
    code: error?.code ?? 'META_K2_CURRENT_STATE_AUDIT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    recoveryAuthorized: false,
    previewSettingMutationCount: 0,
    workerVersionUploadCount: 0,
    workerDeploymentCount: 0,
    remoteMutationCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function readSnapshot(env, configPath) {
  const output = runText('npx', [
    'wrangler', 'd1', 'execute', databaseBinding,
    '--remote', '--json', '--config', configPath,
    '--command', buildMetaD1OnlySnapshotSql(META_K2_EXACT_RECOVERY_IDENTITY),
  ], env);
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw auditError(
      'Remote D1 audit response is not valid JSON',
      'META_K2_CURRENT_STATE_AUDIT_RESPONSE_INVALID',
      { responseSha256: sha256(output) },
    );
  }
  const row = Array.isArray(value)
    ? value.flatMap((entry) => entry?.results ?? [])[0]
    : value?.results?.[0];
  if (!row) {
    throw auditError(
      'Remote D1 audit query returned no row',
      'META_K2_CURRENT_STATE_AUDIT_EMPTY',
    );
  }
  return normalizeMetaD1OnlySnapshot(row);
}

function verifyRepository() {
  const branch = gitText(['branch', '--show-current']);
  const head = gitText(['rev-parse', 'HEAD']);
  const remoteHead = gitText(['rev-parse', `origin/${branchName}`]);
  const expectedHead = requireFullSha(
    process.env.MKT_META_K2_CURRENT_STATE_AUDIT_HEAD,
    'MKT_META_K2_CURRENT_STATE_AUDIT_HEAD',
  );
  const dirty = gitText(['status', '--porcelain', '--untracked-files=no'], false);
  if (branch !== branchName
    || head !== expectedHead
    || remoteHead !== expectedHead
    || dirty.trim() !== '') {
    throw auditError(
      'Meta K2 current-state audit requires the exact clean reviewed Head',
      'META_K2_CURRENT_STATE_AUDIT_REPOSITORY_INVALID',
      {
        branch,
        expectedBranch: branchName,
        head,
        remoteHead,
        expectedHead,
        clean: dirty.trim() === '',
      },
    );
  }
  return Object.freeze({ branch, head, clean: true });
}

async function resolveRepositoryFile(value, fieldName) {
  const input = requireText(value, fieldName);
  const candidate = resolve(repositoryRoot, input);
  const canonical = await realpath(candidate);
  if (canonical !== repositoryRoot && !canonical.startsWith(`${repositoryRoot}/`)) {
    throw auditError(
      `${fieldName} must resolve inside the Repository`,
      'META_K2_CURRENT_STATE_AUDIT_PATH_INVALID',
      { fieldName },
    );
  }
  const valueStat = await stat(canonical);
  if (!valueStat.isFile()) {
    throw auditError(
      `${fieldName} must be a regular file`,
      'META_K2_CURRENT_STATE_AUDIT_FILE_INVALID',
      { fieldName },
    );
  }
  return canonical;
}

async function assertPrivateFile(path, fieldName) {
  const valueStat = await stat(path);
  if ((valueStat.mode & 0o077) !== 0) {
    throw auditError(
      `${fieldName} must not be readable by group or others`,
      'META_K2_CURRENT_STATE_AUDIT_PRIVATE_FILE_INVALID',
      { fieldName },
    );
  }
}

function runText(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw auditError(
      `Read-only command failed: ${command} ${args.slice(0, 4).join(' ')}`,
      'META_K2_CURRENT_STATE_AUDIT_COMMAND_FAILED',
      {
        command,
        exitCode: result.status ?? null,
        stderrSha256: sha256(result.stderr ?? ''),
      },
    );
  }
  return String(result.stdout ?? '').trim();
}

function gitText(args, trim = true) {
  const value = runText('git', args, process.env);
  return trim ? value.trim() : value;
}

function cleanCloudflareEnvironment(env) {
  const output = { ...env };
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!String(output[key] ?? '').trim()) delete output[key];
  }
  return output;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw auditError(
      'Unsupported Meta K2 current-state audit argument',
      'META_K2_CURRENT_STATE_AUDIT_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function requireFullSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw auditError(
      `${fieldName} must be a full Git SHA`,
      'META_K2_CURRENT_STATE_AUDIT_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw auditError(
      `${fieldName} is required`,
      'META_K2_CURRENT_STATE_AUDIT_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function sanitize(value, key = '') {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (typeof value !== 'object') {
    return /token|authorization|account|hostname|subdomain|origin|url|secret|credential/iu.test(key)
      ? '[REDACTED]'
      : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
    nestedKey,
    sanitize(nestedValue, nestedKey),
  ]));
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function auditError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK2CurrentStateAuditError';
  error.code = code;
  error.details = details;
  return error;
}
