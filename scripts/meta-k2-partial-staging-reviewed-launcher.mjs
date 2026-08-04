#!/usr/bin/env node

import { createHash } from 'node:crypto';
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
  META_K2_POST_ACTIVATION_FAILURE_FILES,
  META_K2_POST_ACTIVATION_RETRY_CONFIRMATION,
  META_K2_PREACTIVATION_FAILURE_FILES,
  META_K2_PREACTIVATION_RETRY_CONFIRMATION,
  injectMetaK2ReviewedRuntimeConfig,
  resolveMetaK2ExactRecoveryUrl,
  validateMetaK2PostActivationRetry,
  validateMetaK2PreactivationRetry,
  validateMetaK2SafeRouteProbe,
} from './lib/meta-k2-partial-staging-reviewed-launcher.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
  buildMetaD1OnlySnapshotSql,
  normalizeMetaD1OnlySnapshot,
} from './lib/meta-d1-only-rollout-operator.js';
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
const databaseBinding = 'MKT_STATE_DB';
const workerName = 'social-mkt-sync-worker';

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
    runtimeConfigMaterialization: {
      sourceMappingKeys: ['META_GRAPH_API_VERSION', 'META_AD_ACCOUNT_MAPPINGS'],
      allFalseFlagCount: META_D1_ONLY_REQUIRED_FALSE_FLAGS.length,
      allFalseFlags: META_D1_ONLY_REQUIRED_FALSE_FLAGS,
      secretsIncluded: false,
    },
    recoveryUrlAuthority: {
      acceptedOriginInputs: [
        'MKT_CONNECTION_PUBLIC_ORIGIN',
        'MKT_GOOGLE_ADS_REDIRECT_URI',
        'MKT_YOUTUBE_REDIRECT_URI',
        'MKT_META_K2_EXACT_RECOVERY_URL',
      ],
      allAvailableOriginsMustAgree: true,
      safeRouteProbeBeforeArchiveOrDeployment: true,
      exactPath: META_K2_EXACT_RECOVERY_PATH,
    },
    retryContracts: {
      preactivation: {
        confirmation: META_K2_PREACTIVATION_RETRY_CONFIRMATION,
        exactFiles: META_K2_PREACTIVATION_FAILURE_FILES,
      },
      postActivationNoBusiness: {
        confirmation: META_K2_POST_ACTIVATION_RETRY_CONFIRMATION,
        exactFiles: META_K2_POST_ACTIVATION_FAILURE_FILES,
        requiresCurrentAllFalseWorker: true,
        requiresUnchangedExactD1Checkpoint: true,
        requiresSafeRouteProbe: true,
      },
      action: 'archive_local_evidence_then_retry',
      evidenceDeletionAllowed: false,
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

let currentStage = 'init';
let materialized = false;
let recoveryArchive = null;
try {
  currentStage = 'load-private-environment';
  const devVarsPath = await resolveRepositoryFile(
    process.env.DEV_VARS_FILE ?? '.dev.vars',
    'DEV_VARS_FILE',
  );
  await assertPrivateFile(devVarsPath, 'DEV_VARS_FILE');
  const devVars = await readDevVars(devVarsPath);
  const mergedEnv = { ...devVars, ...process.env };

  currentStage = 'resolve-recovery-authority';
  const recoveryUrl = resolveMetaK2ExactRecoveryUrl({
    explicitUrl: process.env.MKT_META_K2_EXACT_RECOVERY_URL,
    publicOrigin:
      process.env.MKT_CONNECTION_PUBLIC_ORIGIN
      ?? devVars.MKT_CONNECTION_PUBLIC_ORIGIN,
    googleAdsRedirectUri:
      process.env.MKT_GOOGLE_ADS_REDIRECT_URI
      ?? devVars.MKT_GOOGLE_ADS_REDIRECT_URI,
    youtubeRedirectUri:
      process.env.MKT_YOUTUBE_REDIRECT_URI
      ?? devVars.MKT_YOUTUBE_REDIRECT_URI,
  });

  currentStage = 'materialize-runtime-config';
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
  const reviewedRuntime = injectMetaK2ReviewedRuntimeConfig(
    absoluteConfig,
    mergedEnv,
  );
  await writePrivateText(runtimeConfigPath, reviewedRuntime.configText);
  materialized = true;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'materialize-runtime-config',
    sourceMappingKeys: reviewedRuntime.sourceMappingKeys,
    allFalseFlagCount: reviewedRuntime.allFalseFlagCount,
    allFalseFlagFingerprint: reviewedRuntime.allFalseFlagFingerprint,
    recoveryOriginFingerprint: sha256(new URL(recoveryUrl).origin),
    secretsIncluded: false,
    remoteMutationCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);

  currentStage = 'probe-safe-recovery-route';
  const safeRouteProbe = await probeSafeRecoveryRoute(recoveryUrl);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'probe-safe-recovery-route',
    ...safeRouteProbe,
    recoveryOriginFingerprint: sha256(new URL(recoveryUrl).origin),
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);

  currentStage = 'archive-retryable-failure';
  recoveryArchive = await archiveExactRetryableFailureIfPresent(
    mergedEnv,
    safeRouteProbe,
  );
  if (recoveryArchive) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: 'archive-retryable-failure',
      archived: true,
      retryClass: recoveryArchive.retryClass,
      archivePath: recoveryArchive.archivePath,
      backupSha256: recoveryArchive.backupSha256,
      remoteMutationCount: recoveryArchive.remoteMutationCount,
      activeDeploymentCount: recoveryArchive.activeDeploymentCount,
      safeRestoreDeploymentCount: recoveryArchive.safeRestoreDeploymentCount,
      continuationHttpAttemptCount: recoveryArchive.continuationHttpAttemptCount,
      directUseCaseInvocationCount: recoveryArchive.directUseCaseInvocationCount,
      queueMessageCount: recoveryArchive.queueMessageCount,
      lifecycleSqlRepairCount: recoveryArchive.lifecycleSqlRepairCount,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }, null, 2)}\n`);
  }

  currentStage = 'run-finalizer';
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
    stage: currentStage,
    code: error?.code ?? 'META_K2_REVIEWED_LAUNCHER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
    recoveryArchive: recoveryArchive?.archivePath ?? null,
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

async function probeSafeRecoveryRoute(recoveryUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(recoveryUrl, {
      method: 'POST',
      headers: {
        authorization: 'Bearer meta-k2-safe-route-probe-only',
        'content-type': 'application/json',
      },
      body: '{}',
      redirect: 'manual',
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return validateMetaK2SafeRouteProbe({
      status: response.status,
      redirected: response.redirected,
      body,
    });
  } catch (error) {
    if (error?.code) throw error;
    const wrapped = new Error('Meta K2 safe recovery route probe failed');
    wrapped.code = 'META_K2_REVIEWED_LAUNCHER_SAFE_ROUTE_PROBE_FAILED';
    wrapped.details = {
      errorName: error instanceof Error ? error.name : typeof error,
    };
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

async function archiveExactRetryableFailureIfPresent(env, safeRouteProbe) {
  try {
    const value = await stat(exactRecoveryRoot);
    if (!value.isDirectory()) {
      const error = new Error('Exact Meta K2 recovery root must be a directory');
      error.code = 'META_K2_REVIEWED_LAUNCHER_RETRY_INVALID';
      throw error;
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  const entries = await readdir(exactRecoveryRoot, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    const error = new Error('Exact Meta K2 recovery root contains a non-file entry');
    error.code = 'META_K2_REVIEWED_LAUNCHER_RETRY_INVALID';
    error.details = { fileNames: entries.map((entry) => entry.name).sort() };
    throw error;
  }
  const fileNames = entries.map((entry) => entry.name).sort();
  const backupPath = join(exactRecoveryRoot, 'meta-k2-before-recovery.sql');
  const common = {
    fileNames,
    retainedEvidence: await readJson(join(
      exactRecoveryRoot,
      'retained-evidence-admission.json',
    )),
    stabilityEvidence: await readJson(join(
      exactRecoveryRoot,
      'read-only-stability.json',
    )),
    backupEvidence: await readJson(join(exactRecoveryRoot, 'backup.json')),
    backupBytes: await readFile(backupPath),
    expectedBackupFile: relative(repositoryRoot, backupPath),
  };

  let validation;
  let archiveLabel;
  if (sameFileNames(fileNames, META_K2_PREACTIVATION_FAILURE_FILES)) {
    validation = validateMetaK2PreactivationRetry(common, env);
    archiveLabel = 'preactivation-failed';
  } else if (sameFileNames(fileNames, META_K2_POST_ACTIVATION_FAILURE_FILES)) {
    const activeVersion = readActiveVersion(env);
    const currentActiveTrueFlags = readActiveTrueFlags(env, activeVersion);
    const currentSnapshot = readD1Snapshot(env);
    validation = validateMetaK2PostActivationRetry({
      ...common,
      deployEvidence: await readJson(join(
        exactRecoveryRoot,
        'deploy-d1-continuation.json',
      )),
      verifyDeployEvidence: await readJson(join(
        exactRecoveryRoot,
        'verify-d1-continuation.json',
      )),
      restoreEvidence: await readJson(join(
        exactRecoveryRoot,
        'restore-after-d1.json',
      )),
      verifyRestoreEvidence: await readJson(join(
        exactRecoveryRoot,
        'verify-restore-after-d1.json',
      )),
      currentSnapshot,
      currentActiveTrueFlags,
      safeRouteProbe,
    }, env);
    archiveLabel = 'postactivation-no-business-failed';
  } else {
    const error = new Error('Exact Meta K2 recovery root is not a reviewed retry footprint');
    error.code = 'META_K2_REVIEWED_LAUNCHER_RETRY_INVALID';
    error.details = { fileNames };
    throw error;
  }

  const archivePath = `${exactRecoveryRoot}-${archiveLabel}-${Date.now()}`;
  await rename(exactRecoveryRoot, archivePath);
  return Object.freeze({
    ...validation,
    archivePath: relative(repositoryRoot, archivePath),
  });
}

function readD1Snapshot(env) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'd1', 'execute', databaseBinding, '--remote', '--json',
    '--config', runtimeConfigPath,
    '--command', buildMetaD1OnlySnapshotSql(META_K2_EXACT_RECOVERY_IDENTITY),
  ], env));
  const row = Array.isArray(value)
    ? value.flatMap((entry) => entry?.results ?? [])[0]
    : value?.results?.[0];
  if (!row) {
    const error = new Error('Remote D1 recovery retry query returned no row');
    error.code = 'META_K2_REVIEWED_LAUNCHER_D1_QUERY_EMPTY';
    throw error;
  }
  return normalizeMetaD1OnlySnapshot(row);
}

function readActiveVersion(env) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status',
    '--name', workerName,
    '--config', runtimeConfigPath,
    '--json',
  ], env));
  const status = Array.isArray(value) ? value[0] : value;
  const active = (Array.isArray(status?.versions) ? status.versions : [])
    .filter((entry) => Number(entry?.percentage) === 100);
  if (active.length !== 1 || !active[0]?.version_id) {
    const error = new Error('Worker does not have exactly one active safe version');
    error.code = 'META_K2_REVIEWED_LAUNCHER_ACTIVE_VERSION_INVALID';
    throw error;
  }
  return active[0].version_id;
}

function readActiveTrueFlags(env, versionId) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', versionId,
    '--name', workerName,
    '--config', runtimeConfigPath,
    '--json',
  ], env));
  const flags = new Map();
  walk(value, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, nested] of Object.entries(node)) {
      if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) {
        flags.set(key, booleanLike(nested));
      }
    }
    if (typeof node.name === 'string'
      && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(node.name)) {
      flags.set(
        node.name,
        booleanLike(node.text ?? node.value ?? node.json ?? node.data),
      );
    }
  });
  return [...flags.entries()]
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .sort();
}

function runText(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const error = new Error(`Command failed: ${command} ${args.join(' ')}`);
    error.code = 'META_K2_REVIEWED_LAUNCHER_COMMAND_FAILED';
    error.details = {
      command,
      exitCode: result.status,
      stderrSha256: sha256(result.stderr ?? ''),
    };
    throw error;
  }
  return String(result.stdout ?? '').trim();
}

function walk(value, callback) {
  callback(value);
  if (Array.isArray(value)) {
    for (const nested of value) walk(nested, callback);
  } else if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) walk(nested, callback);
  }
}

function booleanLike(value) {
  if (value === true || value === false) return value;
  if (value && typeof value === 'object') {
    return booleanLike(value.text ?? value.value ?? value.json ?? value.data);
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return false;
}

function sameFileNames(observed, expected) {
  return JSON.stringify([...observed].sort()) === JSON.stringify([...expected].sort());
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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
