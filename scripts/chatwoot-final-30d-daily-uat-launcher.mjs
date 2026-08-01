#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { resolveChatwootFinalLarkAutoMappings } from './lib/chatwoot-final-lark-auto-mapping.js';
import { rebaseGeneratedWranglerConfigPaths } from './lib/rebase-generated-wrangler-config-paths.js';
import { bootstrapWooCommerceFinalQueueId } from './lib/woocommerce-final-queue-bootstrap.js';
import {
  assertChatwootFinalWorkerSecrets,
  parseChatwootWorkerSecretNames,
  resolveChatwootFinalSecretBootstrap,
  serializeChatwootFinalSecretsFile,
  summarizeChatwootFinalSecretPlan,
} from './lib/chatwoot-final-secret-bootstrap.js';
import {
  CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS,
  CHATWOOT_FINAL_UAT_CONFIRMATION,
  CHATWOOT_FINAL_UAT_LOCKED_VARS,
  CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
  sha256,
} from './lib/chatwoot-final-30d-daily-uat.js';

const ROOT = resolve(process.cwd());
const EXECUTE_ARGUMENT = '--execute';
const LOCK_SCOPE = 'integration_workspace:chatwoot:chemistry_k:%';
const DATABASE_NAME = 'social-mkt-state-dev';
const MAIN_QUEUE_NAME = 'social-mkt-sync-jobs';
const QUEUE_DISCOVERY_SOURCE = 'cloudflare_queue_rest';
const SECRET_BOOTSTRAP_MESSAGE = 'chatwoot-final-secret-bootstrap-safe';
const UNSAFE_TARGET_OVERRIDES = new Set([
  'MKT_CHATWOOT_FINAL_UAT_DATABASE_NAME',
  'MKT_CHATWOOT_FINAL_UAT_QUEUE_ID',
]);
const SAFE_COMPATIBILITY_LIMITS = Object.freeze({
  CHATWOOT_API_MAX_PAGES: '1000',
  CHATWOOT_MAX_REPORTING_EVENTS: '100000',
});
let normalizedConfigPath = null;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'CHATWOOT_FINAL_UAT_LAUNCHER_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (normalizedConfigPath) await rm(normalizedConfigPath, { force: true }).catch(() => undefined);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== EXECUTE_ARGUMENT)) {
    throw launcherError('Unknown Chatwoot final UAT launcher argument', 'CHATWOOT_FINAL_UAT_ARGUMENT_INVALID');
  }
  if (!args.includes(EXECUTE_ARGUMENT)) {
    runCore([], { stdio: 'inherit' });
    process.stdout.write(`${JSON.stringify({
      authoritativeCommand: `${CHATWOOT_FINAL_UAT_CONFIRMATION.envName}=${CHATWOOT_FINAL_UAT_CONFIRMATION.value} node scripts/chatwoot-final-30d-daily-uat-launcher.mjs --execute`,
      exactLockScope: LOCK_SCOPE,
      exactDatabaseName: DATABASE_NAME,
      exactQueueName: MAIN_QUEUE_NAME,
      queueDiscovery: QUEUE_DISCOVERY_SOURCE,
      ignoredConfigNormalization: true,
      autoResolveChatwootLarkMappings: true,
      autoStageMissingChatwootSecret: true,
      remoteActionsPerformed: false,
    }, null, 2)}\n`);
    return;
  }

  const sourceEnv = Object.freeze({
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  });
  if (sourceEnv[CHATWOOT_FINAL_UAT_CONFIRMATION.envName] !== CHATWOOT_FINAL_UAT_CONFIRMATION.value) {
    throw launcherError(
      `Chatwoot final UAT requires ${CHATWOOT_FINAL_UAT_CONFIRMATION.envName}=${CHATWOOT_FINAL_UAT_CONFIRMATION.value}`,
      'CHATWOOT_FINAL_UAT_CONFIRMATION_REQUIRED',
    );
  }

  await ensurePinnedWranglerInstalled();
  const larkMappings = await resolveLarkTableMappings(sourceEnv);
  normalizedConfigPath = await createNormalizedRuntimeConfig(sourceEnv, larkMappings);
  const safeSourceEnv = Object.fromEntries(
    Object.entries(sourceEnv).filter(([name]) => !UNSAFE_TARGET_OVERRIDES.has(name)
      && name !== 'CHATWOOT_API_ACCESS_TOKEN'),
  );
  const queueBootstrapEnv = {
    ...safeSourceEnv,
    MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: normalizedConfigPath,
    MKT_MAIN_QUEUE_NAME: MAIN_QUEUE_NAME,
  };
  // The shared bootstrap supports a Woo-specific explicit override for its own operator. This
  // Chatwoot entrypoint never accepts it: exact-name REST discovery remains authoritative.
  delete queueBootstrapEnv.MKT_WOOCOMMERCE_FINAL_QUEUE_ID;
  const queueBootstrap = await bootstrapWooCommerceFinalQueueId({
    env: queueBootstrapEnv,
    repositoryRoot: ROOT,
  });
  if (queueBootstrap.source !== QUEUE_DISCOVERY_SOURCE) {
    throw launcherError(
      'Chatwoot final UAT Queue must be resolved by the reviewed Cloudflare REST discovery',
      'CHATWOOT_FINAL_UAT_QUEUE_DISCOVERY_INVALID',
      { source: queueBootstrap.source ?? null },
    );
  }
  const env = Object.freeze({
    ...safeSourceEnv,
    MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG: normalizedConfigPath,
    MKT_CHATWOOT_FINAL_UAT_QUEUE_ID: queueBootstrap.queueId,
  });

  const before = readExactActiveLockCount(env);
  const controllerResume = Boolean(sourceEnv.MKT_CHATWOOT_FINAL_UAT_RESUME_EVIDENCE_DIR);
  if ((!controllerResume && before !== 0) || (controllerResume && before > 1)) {
    throw launcherError(
      'Exact Chatwoot Shared Reliability lock scope is active before UAT',
      'CHATWOOT_FINAL_UAT_ACTIVE_LOCK_BLOCKED',
      { activeLockCount: before, controllerResume },
    );
  }

  const secretBootstrap = await ensureChatwootWorkerSecret({
    env,
    sourceEnv,
    configPath: normalizedConfigPath,
    controllerResume,
  });

  runCore([EXECUTE_ARGUMENT], { env, stdio: 'inherit' });

  const after = readExactActiveLockCount(env);
  if (after !== 0) {
    throw launcherError(
      'Exact Chatwoot Shared Reliability lock remains active after Safe closeout',
      'CHATWOOT_FINAL_UAT_POST_CLOSEOUT_LOCK_ACTIVE',
      { activeLockCount: after },
    );
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    marker: CHATWOOT_FINAL_UAT_SUCCESS_MARKER,
    exactLockScopeVerified: true,
    exactDatabaseVerified: true,
    exactQueueResolvedByName: true,
    queueDiscoverySource: QUEUE_DISCOVERY_SOURCE,
    larkTableMappingsResolved: larkMappings.tableCount,
    larkStaleMappingRepairs: larkMappings.staleMappingRepairCount,
    chatwootWorkerSecretVerified: true,
    chatwootSecretBootstrap: secretBootstrap,
    activeLockCount: 0,
    ignoredConfigNormalized: true,
    controllerResumed: controllerResume,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

async function ensurePinnedWranglerInstalled() {
  const executable = inside(join(
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
  ));
  if (await isRegularFile(executable)) return;
  run('npm', ['ci'], { stdio: 'inherit' });
  if (!await isRegularFile(executable)) {
    throw launcherError(
      'Repository-pinned Wrangler is unavailable after locked dependency installation',
      'CHATWOOT_FINAL_UAT_PINNED_WRANGLER_MISSING',
    );
  }
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw launcherError(
      'Repository-pinned Wrangler could not be inspected',
      'CHATWOOT_FINAL_UAT_PINNED_WRANGLER_INVALID',
      { errorCode: error?.code ?? null },
    );
  }
}

async function resolveLarkTableMappings(env) {
  const sourcePath = inside(env.MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
  const sourceText = await readFile(sourcePath, 'utf8');
  const sourceConfig = parseJsoncObject(sourceText);
  const discoveryEnv = Object.freeze({
    ...(sourceConfig.vars ?? {}),
    ...env,
  });
  const client = createLarkBitableClientFromEnv(discoveryEnv);
  const remoteTables = await client.listTables();
  return resolveChatwootFinalLarkAutoMappings({
    env: discoveryEnv,
    remoteTables,
  });
}

async function createNormalizedRuntimeConfig(env, larkMappings) {
  const sourcePath = inside(env.MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
  const sourceText = await readFile(sourcePath, 'utf8');
  const config = parseJsoncObject(sourceText);
  config.vars ??= {};

  // Table IDs are resolved from exact reviewed Blueprint names/aliases and written only into this
  // private ignored config. The user's .dev.vars and wrangler.sync.jsonc are never edited.
  Object.assign(config.vars, larkMappings.values);

  // The ignored local config may predate the merged Runtime wiring. Populate the reviewed Safe
  // names in the private generated config only; the inner operator later opens exactly these four.
  for (const name of CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS) config.vars[name] = 'false';

  for (const [name, expected] of Object.entries(CHATWOOT_FINAL_UAT_LOCKED_VARS)) {
    const existing = config.vars[name];
    if (existing !== null && existing !== undefined && existing !== '' && String(existing) !== expected) {
      throw launcherError(
        `${name} conflicts with the locked Chatwoot runtime contract`,
        'CHATWOOT_FINAL_UAT_LOCAL_CONFIG_CONFLICT',
        { fieldName: name },
      );
    }
    config.vars[name] = expected;
  }

  // Replace retired local pagination limits in the private generated config only. These exact
  // bounds are already reviewed in the merged Runtime examples and are required by the verified
  // 304 Conversation / 1,125 Reporting page inventories.
  Object.assign(config.vars, SAFE_COMPATIBILITY_LIMITS);

  for (const [name, expected] of [
    ['MKT_SCHEDULE_CHATWOOT_ENABLED', 'false'],
    ['MKT_CHATWOOT_WEBHOOK_ENABLED', 'false'],
  ]) {
    const existing = config.vars[name];
    if (existing !== null && existing !== undefined && existing !== ''
        && String(existing).toLowerCase() !== expected) {
      throw launcherError(
        `${name} must remain false`,
        'CHATWOOT_FINAL_UAT_LOCAL_CONFIG_CONFLICT',
        { fieldName: name },
      );
    }
    config.vars[name] = expected;
  }

  delete config.vars.CHATWOOT_INCREMENTAL_OVERLAP_HOURS;

  const directory = inside(join('outputs', 'chatwoot-final-30d-daily-uat', '.launcher'));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `wrangler-normalized-${Date.now()}-${process.pid}.json`);
  const normalizedText = `${JSON.stringify(config, null, 2)}\n`;
  const rebased = rebaseGeneratedWranglerConfigPaths(normalizedText, {
    sourceDirectory: dirname(sourcePath),
    outputDirectory: directory,
  });
  await writeFile(path, rebased.text, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

function readExactActiveLockCount(env) {
  const configPath = env.MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc';
  const sql = [
    'SELECT COUNT(*) AS active_chatwoot_locks',
    'FROM sync_locks',
    `WHERE lock_key LIKE '${LOCK_SCOPE}'`,
    "AND expires_at > unixepoch('now') * 1000;",
  ].join(' ');
  const output = run('npx', [
    'wrangler', 'd1', 'execute', DATABASE_NAME,
    '--remote', '--json', '--config', configPath,
    '--command', sql,
  ], { env });
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (cause) {
    throw launcherError(
      'Exact Chatwoot lock read returned invalid JSON',
      'CHATWOOT_FINAL_UAT_LOCK_READ_INVALID',
      { outputFingerprint: sha256(output), cause: cause?.message ?? 'JSON_PARSE_FAILED' },
    );
  }
  const row = Array.isArray(parsed)
    ? parsed.flatMap((item) => item?.results ?? [])[0]
    : parsed?.results?.[0];
  const count = Number(row?.active_chatwoot_locks);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw launcherError(
      'Exact Chatwoot lock count is invalid',
      'CHATWOOT_FINAL_UAT_LOCK_READ_INVALID',
    );
  }
  return count;
}


async function ensureChatwootWorkerSecret({ env, sourceEnv, configPath, controllerResume = false }) {
  const config = parseJsoncObject(await readFile(configPath, 'utf8'));
  const workerName = requiredText(config.name, 'Worker name is missing from normalized config');
  const localTrueFlags = Object.entries(config.vars ?? {})
    .filter(([name, value]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
      && (value === true || String(value).toLowerCase() === 'true'))
    .map(([name]) => name)
    .sort();
  if (localTrueFlags.length) {
    throw launcherError(
      'Secret bootstrap config must keep every execution flag false',
      'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_CONFIG_UNSAFE',
      { trueFlags: localTrueFlags },
    );
  }

  if (controllerResume) {
    // The core immediately revalidates the exact active version against retained
    // controller evidence. While that version owns the live window, this wrapper may
    // verify existing Secret names but must never bootstrap or deploy a replacement.
    const remoteSecretNames = readWorkerSecretNames(env, configPath, workerName);
    assertChatwootFinalWorkerSecrets(remoteSecretNames);
    const plan = resolveChatwootFinalSecretBootstrap({
      remoteSecretNames,
      readLocalAccessToken: () => {
        throw launcherError(
          'Controller resume cannot bootstrap a missing Chatwoot Worker Secret',
          'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_RESUME_BLOCKED',
        );
      },
    });
    return Object.freeze({
      ...summarizeChatwootFinalSecretPlan(plan),
      safeVersion: null,
      activeVersionVerification: 'exact_controller_resume',
      remoteMutationCount: 0,
    });
  }

  const safeVersionBefore = assertRemoteWorkerAllFlagsFalse(env, configPath, workerName);
  const remoteSecretNames = readWorkerSecretNames(env, configPath, workerName);
  const plan = resolveChatwootFinalSecretBootstrap({
    remoteSecretNames,
    readLocalAccessToken: () => sourceEnv.CHATWOOT_API_ACCESS_TOKEN,
  });
  const summary = summarizeChatwootFinalSecretPlan(plan);
  if (!plan.provision) {
    assertChatwootFinalWorkerSecrets(remoteSecretNames);
    return Object.freeze({
      ...summary,
      safeVersion: safeVersionBefore,
      remoteMutationCount: 0,
    });
  }

  const head = run('git', ['rev-parse', 'HEAD']).trim();
  const evidenceDirectory = inside(join('outputs', 'chatwoot-final-30d-daily-uat', head));
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const attemptPath = join(evidenceDirectory, 'secret-bootstrap.attempt.json');
  if (await isRegularFile(attemptPath)) {
    throw launcherError(
      'A prior Secret bootstrap attempt exists while the remote Secret is still absent',
      'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_UNCERTAIN',
      { secretName: plan.secretName },
    );
  }
  await writePrivateLauncherJson(attemptPath, {
    contract: SECRET_BOOTSTRAP_MESSAGE,
    repositoryHead: head,
    secretName: plan.secretName,
    safeVersionBefore,
    attemptedAt: new Date().toISOString(),
    executionFlags: 'all_false',
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
  });

  const secretDirectory = inside(join('outputs', 'chatwoot-final-30d-daily-uat', '.launcher'));
  await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
  const secretFilePath = join(secretDirectory, `chatwoot-secrets-${Date.now()}-${process.pid}.json`);
  await writeFile(secretFilePath, serializeChatwootFinalSecretsFile(plan), { mode: 0o600 });
  await chmod(secretFilePath, 0o600);

  let deployOutput;
  try {
    deployOutput = run('npx', [
      'wrangler', 'deploy',
      '--config', configPath,
      '--secrets-file', secretFilePath,
      '--strict',
      '--message', `${SECRET_BOOTSTRAP_MESSAGE} git=${head}`,
    ], {
      env,
      unsetEnv: ['CHATWOOT_API_ACCESS_TOKEN'],
    });
  } finally {
    await rm(secretFilePath, { force: true });
  }

  const remoteAfter = readWorkerSecretNames(env, configPath, workerName);
  assertChatwootFinalWorkerSecrets(remoteAfter);
  const safeVersion = assertRemoteWorkerAllFlagsFalse(env, configPath, workerName);
  const completed = {
    ...summary,
    safeVersion,
    remoteMutationCount: 1,
    deployOutputFingerprint: sha256(deployOutput),
  };
  await writePrivateLauncherJson(
    join(evidenceDirectory, 'secret-bootstrap.json'),
    completed,
  );
  return Object.freeze(completed);
}

function readWorkerSecretNames(env, configPath, workerName) {
  const output = run('npx', [
    'wrangler', 'secret', 'list',
    '--name', workerName,
    '--config', configPath,
    '--format', 'json',
  ], { env });
  return parseChatwootWorkerSecretNames(output);
}

function assertRemoteWorkerAllFlagsFalse(env, configPath, workerName) {
  const status = JSON.parse(run('npx', [
    'wrangler', 'deployments', 'status',
    '--name', workerName,
    '--config', configPath,
    '--json',
  ], { env }));
  const statusItem = Array.isArray(status) ? status[0] : status;
  const active = (statusItem?.versions ?? [])
    .filter((version) => Number(version.percentage) === 100);
  if (active.length !== 1) {
    throw launcherError(
      'Secret bootstrap requires one 100% active Worker version',
      'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_ACTIVE_VERSION_INVALID',
    );
  }
  const versionId = String(active[0].version_id ?? active[0].id ?? '');
  if (!/^[0-9a-f-]{36}$/u.test(versionId)) {
    throw launcherError(
      'Secret bootstrap active Worker version ID is invalid',
      'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_ACTIVE_VERSION_INVALID',
    );
  }
  const view = JSON.parse(run('npx', [
    'wrangler', 'versions', 'view', versionId,
    '--name', workerName,
    '--config', configPath,
    '--json',
  ], { env }));
  const viewItem = Array.isArray(view) ? view[0] : view;
  const bindings = viewItem?.bindings ?? viewItem?.resources?.bindings ?? [];
  const trueFlags = bindings.filter((binding) => {
    const name = String(binding.name ?? binding.binding ?? '');
    const value = binding.text ?? binding.value;
    return /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
      && (value === true || String(value).toLowerCase() === 'true');
  }).map((binding) => String(binding.name ?? binding.binding)).sort();
  if (trueFlags.length) {
    throw launcherError(
      'Secret bootstrap requires an all-flags-false Worker',
      'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_REMOTE_UNSAFE',
      { trueFlags },
    );
  }
  return versionId;
}

async function writePrivateLauncherJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function requiredText(value, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw launcherError(message, 'CHATWOOT_FINAL_UAT_SECRET_BOOTSTRAP_CONFIG_INVALID');
  }
  return value.trim();
}

function runCore(args, options = {}) {
  return run('node', ['scripts/chatwoot-final-30d-daily-uat.mjs', ...args], options);
}

function run(command, args, options = {}) {
  const commandEnv = { ...process.env, ...(options.env ?? {}) };
  for (const name of options.unsetEnv ?? []) delete commandEnv[name];
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      env: commandEnv,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    });
  } catch (cause) {
    throw launcherError(
      `Command failed: ${command} ${args.join(' ')}`,
      'CHATWOOT_FINAL_UAT_COMMAND_FAILED',
      {
        command,
        exitCode: cause?.status ?? null,
        stderrFingerprint: cause?.stderr ? sha256(String(cause.stderr)) : null,
      },
    );
  }
}

function inside(value) {
  const path = resolve(ROOT, value);
  if (relative(ROOT, path).startsWith('..')) {
    throw launcherError('Path leaves Repository', 'CHATWOOT_FINAL_UAT_PATH_INVALID');
  }
  return path;
}

function launcherError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootFinalUatLauncherError';
  error.code = code;
  error.details = details;
  return error;
}
