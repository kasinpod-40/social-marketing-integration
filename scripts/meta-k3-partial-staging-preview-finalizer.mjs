#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readDevVars } from './lib/dev-vars.js';
import {
  materializeMetaHistoryLarkRuntimeConfig,
} from './lib/meta-history-runtime-authority.js';

const repositoryRoot = resolve(process.cwd());
const loaderUrl = pathToFileURL(resolve(
  repositoryRoot,
  'scripts/lib/meta-k3-exact-recovery-loader.mjs',
)).href;
const reviewedFinalizer = resolve(
  repositoryRoot,
  'scripts/meta-k2-partial-staging-preview-finalizer.mjs',
);
const execute = process.argv.slice(2).includes('--execute');
const operationId =
  'meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9';
const recoveryRoot = resolve(
  repositoryRoot,
  'outputs',
  'meta-d1-only-rollout',
  'chemistry_k3',
  operationId,
  'exact-partial-staging-recovery-v1',
);
const resumeConfirmation = Object.freeze({
  envName: 'MKT_META_K3_RESUME_PRE_MUTATION_CONFIG_FAILURE',
  value: 'RESUME_EXACT_K3_PRE_MUTATION_CONFIG_FAILURE',
});
const expectedPreMutationFiles = Object.freeze([
  'backup.json',
  'meta-k2-before-recovery.sql',
  'read-only-stability.json',
  'retained-evidence-admission.json',
]);

let generatedConfigPath = null;
let archivedPreMutationRoot = null;
let childEnv = {
  ...process.env,
  MKT_META_K3_EXACT_RECOVERY_ADAPTER: 'true',
};

try {
  if (execute) {
    const prepared = await prepareExecutionEnvironment(childEnv);
    childEnv = prepared.env;
    generatedConfigPath = prepared.generatedConfigPath;
    archivedPreMutationRoot = prepared.archivedPreMutationRoot;
  }

  const child = spawn(
    process.execPath,
    [
      '--no-warnings',
      '--experimental-loader',
      loaderUrl,
      reviewedFinalizer,
      ...process.argv.slice(2),
    ],
    {
      cwd: repositoryRoot,
      env: childEnv,
      stdio: 'inherit',
    },
  );

  child.once('error', async (error) => {
    await cleanupGeneratedConfig();
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: 'META_K3_FINALIZER_LAUNCH_FAILED',
      message: error instanceof Error ? error.message : String(error),
      archivedPreMutationEvidence: archivedPreMutationRoot !== null,
      queueMessageCount: 0,
      lifecycleSqlRepairCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }, null, 2)}\n`);
    process.exitCode = 1;
  });

  child.once('exit', async (code, signal) => {
    await cleanupGeneratedConfig();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
} catch (error) {
  await cleanupGeneratedConfig();
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'META_K3_FINALIZER_BOOTSTRAP_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    archivedPreMutationEvidence: archivedPreMutationRoot !== null,
    workerVersionUploadCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function prepareExecutionEnvironment(inputEnv) {
  const devVarsPath = resolve(
    repositoryRoot,
    inputEnv.DEV_VARS_FILE ?? '.dev.vars',
  );
  const fileEnv = await readDevVars(devVarsPath);
  const authorityEnv = mergeNonEmptyEnvironment(fileEnv, inputEnv);
  const sourceConfigPath = resolve(
    repositoryRoot,
    authorityEnv.MKT_META_K3_RECOVERY_WRANGLER_CONFIG
      ?? authorityEnv.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? authorityEnv.MKT_META_HISTORY_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
  );
  const sourceConfigText = await readFile(sourceConfigPath, 'utf8');
  const materializedText = materializeMetaHistoryLarkRuntimeConfig(
    sourceConfigText,
    authorityEnv,
  );
  assertPinnedGraphVersion(materializedText);

  const reviewedHead = requireFullSha(
    authorityEnv.MKT_META_HISTORY_REVIEW_WRAPPER_HEAD,
    'MKT_META_HISTORY_REVIEW_WRAPPER_HEAD',
  );
  const configDir = resolve(
    repositoryRoot,
    'outputs',
    'meta-history-2026',
    reviewedHead,
  );
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const runtimePath = resolve(
    configDir,
    `.wrangler.meta-k3-runtime-${process.pid}-${Date.now()}.jsonc`,
  );
  await writeFile(runtimePath, materializedText, { mode: 0o600 });
  await chmod(runtimePath, 0o600);

  const archived = await archiveAcceptedPreMutationFailure(authorityEnv);

  return {
    generatedConfigPath: runtimePath,
    archivedPreMutationRoot: archived,
    env: {
      ...authorityEnv,
      MKT_META_K3_EXACT_RECOVERY_ADAPTER: 'true',
      MKT_META_K3_RECOVERY_WRANGLER_CONFIG:
        relative(repositoryRoot, runtimePath),
    },
  };
}

async function archiveAcceptedPreMutationFailure(env) {
  let rootStat = null;
  try {
    rootStat = await stat(recoveryRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!rootStat.isDirectory()) {
    throw bootstrapError(
      'Exact K3 recovery root is not a directory',
      'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
    );
  }
  if (env[resumeConfirmation.envName] !== resumeConfirmation.value) {
    throw bootstrapError(
      `Exact K3 pre-mutation resume requires ${resumeConfirmation.envName}`,
      'META_K3_PRE_MUTATION_RESUME_CONFIRMATION_REQUIRED',
    );
  }

  const observedFiles = (await readdir(recoveryRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const observedDirectories = (await readdir(recoveryRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(observedFiles) !== JSON.stringify(expectedPreMutationFiles)
    || observedDirectories.length !== 0) {
    throw bootstrapError(
      'Existing K3 recovery evidence exceeds the accepted pre-mutation failure boundary',
      'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
      { observedFiles, observedDirectories },
    );
  }

  const admission = await readJson('retained-evidence-admission.json');
  const stability = await readJson('read-only-stability.json');
  const backup = await readJson('backup.json');
  const accepted = admission?.status === 'passed'
    && admission?.operationId === operationId
    && Number(admission?.data?.queueMessageCount) === 0
    && Number(admission?.data?.workerDeploymentCount) === 0
    && admission?.data?.productionTrafficChange === false
    && stability?.status === 'passed'
    && stability?.operationId === operationId
    && stability?.data?.executionFlagsAllFalse === true
    && stability?.data?.productionDeploymentUnchanged === true
    && backup?.status === 'passed'
    && backup?.operationId === operationId
    && Number(backup?.data?.remoteMutationCount) === 0;
  if (!accepted) {
    throw bootstrapError(
      'Existing K3 evidence does not prove a zero-mutation pre-Preview failure',
      'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
    );
  }

  const stamp = new Date().toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/u, 'Z');
  let archivePath = `${recoveryRoot}-pre-mutation-config-failure-${stamp}`;
  let suffix = 0;
  for (;;) {
    try {
      await rename(recoveryRoot, archivePath);
      return archivePath;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      suffix += 1;
      archivePath = `${recoveryRoot}-pre-mutation-config-failure-${stamp}-${suffix}`;
    }
  }
}

async function readJson(name) {
  return JSON.parse(await readFile(resolve(recoveryRoot, name), 'utf8'));
}

function mergeNonEmptyEnvironment(base, override) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === ''
      && typeof merged[key] === 'string' && merged[key].trim() !== '') {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function assertPinnedGraphVersion(configText) {
  if (!/(?:["']META_GRAPH_API_VERSION["']|META_GRAPH_API_VERSION)\s*:\s*["']v25\.0["']/u
    .test(configText)) {
    throw bootstrapError(
      'Materialized K3 config does not contain META_GRAPH_API_VERSION=v25.0',
      'META_K3_RUNTIME_AUTHORITY_INVALID',
      { key: 'META_GRAPH_API_VERSION' },
    );
  }
}

function requireFullSha(value, fieldName) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw bootstrapError(
      `${fieldName} must be a full SHA`,
      'META_K3_RUNTIME_AUTHORITY_INVALID',
      { fieldName },
    );
  }
  return text;
}

async function cleanupGeneratedConfig() {
  if (!generatedConfigPath) return;
  const path = generatedConfigPath;
  generatedConfigPath = null;
  await rm(path, { force: true });
  await rm(dirname(path), { recursive: false }).catch(() => {});
}

function sanitize(value, key = '') {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (typeof value !== 'object') {
    return /token|secret|authorization|password|cookie|subdomain|origin|url/iu.test(key)
      ? '[REDACTED]'
      : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
    nestedKey,
    sanitize(nestedValue, nestedKey),
  ]));
}

function bootstrapError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK3PartialStagingBootstrapError';
  error.code = code;
  error.details = details;
  return error;
}
