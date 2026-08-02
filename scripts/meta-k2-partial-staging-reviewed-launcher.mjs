#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  META_HISTORY_2026_WINDOWS,
  injectMetaHistoryConfig,
} from './lib/meta-history-2026-finalizer.js';
import {
  META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION,
} from './lib/meta-k2-partial-staging-finalizer.js';
import {
  META_K2_PREACTIVATION_FAILURE_FILES,
  META_K2_PREACTIVATION_RETRY_CONFIRMATION,
  injectMetaK2ReviewedSourceMappings,
  resolveMetaK2ExactRecoveryUrl,
  validateMetaK2PreactivationRetry,
} from './lib/meta-k2-partial-staging-reviewed-launcher.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  META_K2_EXACT_RECOVERY_IDENTITY,
  META_K2_EXACT_RECOVERY_MODE,
  META_K2_EXACT_RECOVERY_MODE_ENV,
  META_K2_EXACT_RECOVERY_PATH,
} from '../packages/config/src/meta-k2-exact-recovery-contract.js';

const repositoryRoot = realpathSync.native(process.cwd());
const launcherPath = fileURLToPath(import.meta.url);
const finalizerPath = join(
  dirname(launcherPath),
  'meta-k2-partial-staging-finalizer.mjs',
);
const runtimeRoot = join(
  repositoryRoot,
  'outputs',
  'meta-k2-partial-staging-reviewed-runtime',
);
const runtimeConfigPath = join(runtimeRoot, 'wrangler.safe.absolute.jsonc');
const exactRecoveryRoot = join(
  repositoryRoot,
  'outputs',
  'meta-d1-only-rollout',
  META_K2_EXACT_RECOVERY_IDENTITY.targetKey,
  META_K2_EXACT_RECOVERY_IDENTITY.operationId,
  'exact-partial-staging-recovery-v1',
);

const execute = parseArgs(process.argv.slice(2));
if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    launcher: relative(repositoryRoot, launcherPath),
    finalizer: relative(repositoryRoot, finalizerPath),
    devVarsFileEnv: 'DEV_VARS_FILE',
    defaultDevVarsFile: '.dev.vars',
    baseWranglerConfigEnv: 'MKT_META_K2_RECOVERY_BASE_WRANGLER_CONFIG',
    defaultBaseWranglerConfig: 'wrangler.sync.jsonc',
    generatedRuntimeConfig: relative(repositoryRoot, runtimeConfigPath),
    runtimePathsAbsolutized: ['main', 'migrations_dir'],
    sourceMappingMaterialization: {
      keys: ['META_GRAPH_API_VERSION', 'META_AD_ACCOUNT_MAPPINGS'],
      secretsIncluded: false,
    },
    recoveryUrl: {
      explicitOverrideEnv: 'MKT_META_K2_EXACT_RECOVERY_URL',
      defaultOriginEnv: 'MKT_CONNECTION_PUBLIC_ORIGIN',
      exactPath: META_K2_EXACT_RECOVERY_PATH,
    },
    preactivationRetry: {
      confirmation: META_K2_PREACTIVATION_RETRY_CONFIRMATION,
      exactFiles: META_K2_PREACTIVATION_FAILURE_FILES,
      action: 'archive_local_evidence_then_retry',
      remoteMutationAllowed: false,
    },
    executeArgument: '--execute',
    confirmation: META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION,
    recoveryConfirmation: {
      envName: META_K2_EXACT_RECOVERY_MODE_ENV,
      value: META_K2_EXACT_RECOVERY_MODE,
    },
    remoteActionsPerformed: false,
  }, null, 2)}\n`);
  process.exit(0);
}

let materialized = false;
let preactivationArchive = null;
try {
  const devVarsPath = await resolveRepositoryFile(
    process.env.DEV_VARS_FILE ?? '.dev.vars',
    'DEV_VARS_FILE',
  );
  await assertPrivateFile(devVarsPath, 'DEV_VARS_FILE');
  const devVars = await readDevVars(devVarsPath);
  const mergedEnv = { ...devVars, ...process.env };
  const recoveryUrl = resolveMetaK2ExactRecoveryUrl({
    explicitUrl: process.env.MKT_META_K2_EXACT_RECOVERY_URL,
    publicOrigin:
      process.env.MKT_CONNECTION_PUBLIC_ORIGIN
      ?? devVars.MKT_CONNECTION_PUBLIC_ORIGIN,
  });

  const baseConfigPath = await resolveRepositoryFile(
    process.env.MKT_META_K2_RECOVERY_BASE_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
    'MKT_META_K2_RECOVERY_BASE_WRANGLER_CONFIG',
  );
  const source = await readFile(baseConfigPath, 'utf8');
  const absoluteConfig = injectMetaHistoryConfig(
    source,
    META_HISTORY_2026_WINDOWS.ads,
    { baseDirectory: dirname(baseConfigPath) },
  );
  const materializedSourceMappings = injectMetaK2ReviewedSourceMappings(
    absoluteConfig,
    mergedEnv,
  );
  await writePrivateText(runtimeConfigPath, materializedSourceMappings.configText);
  materialized = true;

  preactivationArchive = await archiveExactPreactivationFailureIfPresent(mergedEnv);
  if (preactivationArchive) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: 'archive-preactivation-failure',
      archived: true,
      archivePath: preactivationArchive.archivePath,
      backupSha256: preactivationArchive.backupSha256,
      remoteMutationCount: 0,
      activeDeploymentCount: 0,
      continuationCallCount: 0,
      queueMessageCount: 0,
      lifecycleSqlRepairCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }, null, 2)}\n`);
  }

  const child = spawnSync(process.execPath, [finalizerPath, '--execute'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DEV_VARS_FILE: devVarsPath,
      MKT_META_K2_EXACT_RECOVERY_URL: recoveryUrl,
      MKT_META_K2_RECOVERY_WRANGLER_CONFIG: runtimeConfigPath,
    },
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    const error = new Error('Meta K2 exact recovery finalizer failed');
    error.code = 'META_K2_REVIEWED_LAUNCHER_FINALIZER_FAILED';
    error.details = { exitCode: child.status };
    throw error;
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: materialized ? 'run-finalizer' : 'materialize-runtime-config',
    code: error?.code ?? 'META_K2_REVIEWED_LAUNCHER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
    preactivationArchive: preactivationArchive?.archivePath ?? null,
    runtimeConfigRemoved: false,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await rm(runtimeConfigPath, { force: true });
  await rm(runtimeRoot, { recursive: true, force: true });
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    const error = new Error('Unsupported Meta K2 reviewed launcher argument');
    error.code = 'META_K2_REVIEWED_LAUNCHER_ARGUMENT_INVALID';
    error.details = { unknown };
    throw error;
  }
  return args.includes('--execute');
}

async function archiveExactPreactivationFailureIfPresent(env) {
  try {
    const value = await stat(exactRecoveryRoot);
    if (!value.isDirectory()) {
      const error = new Error('Exact Meta K2 recovery root must be a directory');
      error.code = 'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_INVALID';
      throw error;
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  const entries = await readdir(exactRecoveryRoot, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    const error = new Error('Exact Meta K2 recovery root contains a non-file entry');
    error.code = 'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_INVALID';
    error.details = { fileNames: entries.map((entry) => entry.name).sort() };
    throw error;
  }
  const fileNames = entries.map((entry) => entry.name).sort();
  const retainedEvidence = await readJson(join(
    exactRecoveryRoot,
    'retained-evidence-admission.json',
  ));
  const stabilityEvidence = await readJson(join(
    exactRecoveryRoot,
    'read-only-stability.json',
  ));
  const backupEvidence = await readJson(join(exactRecoveryRoot, 'backup.json'));
  const backupPath = join(exactRecoveryRoot, 'meta-k2-before-recovery.sql');
  const backupBytes = await readFile(backupPath);
  const validation = validateMetaK2PreactivationRetry({
    fileNames,
    retainedEvidence,
    stabilityEvidence,
    backupEvidence,
    backupBytes,
    expectedBackupFile: relative(repositoryRoot, backupPath),
  }, env);

  const archivePath = `${exactRecoveryRoot}-preactivation-failed-${Date.now()}`;
  await rename(exactRecoveryRoot, archivePath);
  return Object.freeze({
    ...validation,
    archivePath: relative(repositoryRoot, archivePath),
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function resolveRepositoryFile(value, fieldName) {
  const input = requireText(value, fieldName);
  const candidate = resolve(repositoryRoot, input);
  const canonical = await realpath(candidate);
  if (canonical !== repositoryRoot && !canonical.startsWith(`${repositoryRoot}/`)) {
    const error = new Error(`${fieldName} must resolve inside the Repository`);
    error.code = 'META_K2_REVIEWED_LAUNCHER_PATH_INVALID';
    error.details = { fieldName };
    throw error;
  }
  const valueStat = await stat(canonical);
  if (!valueStat.isFile()) {
    const error = new Error(`${fieldName} must be a regular file`);
    error.code = 'META_K2_REVIEWED_LAUNCHER_FILE_INVALID';
    error.details = { fieldName };
    throw error;
  }
  return canonical;
}

async function assertPrivateFile(path, fieldName) {
  const valueStat = await stat(path);
  if ((valueStat.mode & 0o077) !== 0) {
    const error = new Error(`${fieldName} must not be readable by group or others`);
    error.code = 'META_K2_REVIEWED_LAUNCHER_PRIVATE_FILE_INVALID';
    error.details = { fieldName };
    throw error;
  }
}

async function writePrivateText(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${fieldName} is required`);
    error.code = 'META_K2_REVIEWED_LAUNCHER_INPUT_INVALID';
    error.details = { fieldName };
    throw error;
  }
  return value.trim();
}
