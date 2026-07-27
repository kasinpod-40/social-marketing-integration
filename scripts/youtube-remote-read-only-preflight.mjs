#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  compareYouTubeDryRunConfigs,
} from './lib/youtube-dry-run-rollout-operator.js';
import {
  validateLiveRemoteYouTubeDeploymentContract,
} from './lib/youtube-live-remote-contract-parser.js';
import {
  assertStableActiveDeployment,
  classifyYouTubeRemoteReadOnlyPreflight,
  normalizeYouTubeRemotePreflightDecision,
  parsePendingMigrationNames,
  parseSingleActiveDeployment,
  readYouTubeD1MigrationListWithRetry,
} from './lib/youtube-remote-read-only-preflight.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const CONFIRMATION_ENV = 'CONFIRM_YOUTUBE_REMOTE_READ_ONLY_PREFLIGHT';
const CONFIRMATION_VALUE = 'RUN_YOUTUBE_REMOTE_READ_ONLY_PREFLIGHT';
const DEFAULT_OUTPUT = 'outputs/youtube-remote-read-only-preflight/summary.json';

try {
  const options = parseArgs(process.argv.slice(2));
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      planOnly: true,
      remoteActionsPerformed: false,
      command: 'npm run preflight:youtube-remote-read-only:run',
      confirmation: `${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
      requiredEnvironment: [
        'MKT_YOUTUBE_DRY_RUN_SAFE_WRANGLER_CONFIG',
        'MKT_YOUTUBE_DRY_RUN_ACTIVE_WRANGLER_CONFIG',
        'MKT_YOUTUBE_DRY_RUN_EXPECTED_CHANNEL_ID',
        'CLOUDFLARE_ACCOUNT_ID',
        'CLOUDFLARE_API_TOKEN',
      ],
      reads: [
        'Git main/clean state',
        'Wrangler authentication',
        'Worker deployment status twice',
        'Worker version metadata',
        'Main Queue and DLQ consumer metadata',
        'Cron, routes and workers.dev metadata',
        'D1 pending migration list with bounded transient-read retry',
        'reviewed safe/active local config fingerprints',
      ],
      forbidden: [
        'Worker deploy/upload/rollback',
        'Queue send/Ack/Retry/DLQ mutation',
        'D1 execute/write/migration apply',
        'YouTube or Lark request',
        'Cron/route/workers.dev/Secret mutation',
        'Production action',
      ],
    }, null, 2)}\n`);
    process.exitCode = 0;
  } else {
    assertConfirmation(process.env);
    const safeConfigPath = resolveRepositoryFile(requiredEnv(
      'MKT_YOUTUBE_DRY_RUN_SAFE_WRANGLER_CONFIG',
    ));
    const activeConfigPath = resolveRepositoryFile(requiredEnv(
      'MKT_YOUTUBE_DRY_RUN_ACTIVE_WRANGLER_CONFIG',
    ));
    const channelId = requiredEnv('MKT_YOUTUBE_DRY_RUN_EXPECTED_CHANNEL_ID');
    const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
    const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
    const workerName = exactOrDefault(
      process.env.MKT_YOUTUBE_DRY_RUN_WORKER_NAME,
      'social-mkt-sync-worker',
      'MKT_YOUTUBE_DRY_RUN_WORKER_NAME',
    );
    const databaseName = exactOrDefault(
      process.env.MKT_YOUTUBE_DRY_RUN_DATABASE_NAME,
      'social-mkt-state-dev',
      'MKT_YOUTUBE_DRY_RUN_DATABASE_NAME',
    );
    const mainQueueName = exactOrDefault(
      process.env.MKT_YOUTUBE_DRY_RUN_MAIN_QUEUE,
      'social-mkt-sync-jobs',
      'MKT_YOUTUBE_DRY_RUN_MAIN_QUEUE',
    );
    const dlqName = exactOrDefault(
      process.env.MKT_YOUTUBE_DRY_RUN_DLQ,
      'social-mkt-sync-dlq',
      'MKT_YOUTUBE_DRY_RUN_DLQ',
    );

    const branch = await gitText(['branch', '--show-current']);
    if (branch !== 'main') {
      throw preflightError(
        'YouTube Remote preflight must run from main',
        'YOUTUBE_REMOTE_PREFLIGHT_MAIN_REQUIRED',
        { branch },
      );
    }
    const workingTree = await gitText([
      'status', '--porcelain', '--untracked-files=all',
    ], { trim: false });
    if (workingTree.trim() !== '') {
      throw preflightError(
        'YouTube Remote preflight requires a clean Working Tree',
        'YOUTUBE_REMOTE_PREFLIGHT_WORKING_TREE_DIRTY',
      );
    }
    await gitText(['fetch', 'origin', 'main', '--quiet']);
    const repositoryHead = await gitText(['rev-parse', 'HEAD']);
    const originMainHead = await gitText(['rev-parse', 'origin/main']);
    if (repositoryHead !== originMainHead) {
      throw preflightError(
        'Local main differs from origin/main',
        'BLOCKED_MAIN_CHANGED',
        { repositoryHead, originMainHead },
      );
    }

    await wranglerText(['whoami']);
    const [safeConfig, activeConfig] = await Promise.all([
      readFile(safeConfigPath, 'utf8'),
      readFile(activeConfigPath, 'utf8'),
    ]);
    const comparison = compareYouTubeDryRunConfigs(safeConfig, activeConfig, { channelId });
    const expected = comparison.safe;
    const expectedFalseFlagNames = [...new Set([
      ...expected.falseFlags,
      ...comparison.active.trueFlags,
    ])].sort();

    const deploymentBefore = await readDeploymentStatus(activeConfigPath, workerName);
    const activeBefore = parseSingleActiveDeployment(deploymentBefore);
    const accountPath = `/accounts/${encodeURIComponent(accountId)}/workers`;
    const scriptPath = `${accountPath}/scripts/${encodeURIComponent(workerName)}`;
    const [
      versionsView,
      mainConsumers,
      dlqConsumers,
      scriptList,
      schedules,
      subdomain,
      migrationsRead,
    ] = await Promise.all([
      readVersionView(activeConfigPath, workerName, activeBefore.versionId),
      readQueueConsumers(mainQueueName),
      readQueueConsumers(dlqName),
      readAllCloudflareWorkerScripts(accountPath, apiToken),
      cloudflareApiJson(`${scriptPath}/schedules`, apiToken),
      cloudflareApiJson(`${scriptPath}/subdomain`, apiToken),
      readYouTubeD1MigrationListWithRetry({
        run: () => wranglerText([
          'd1', 'migrations', 'list', 'MKT_STATE_DB', '--remote',
          '--config', activeConfigPath,
        ]),
      }),
    ]);
    const deploymentAfter = await readDeploymentStatus(activeConfigPath, workerName);
    const stable = assertStableActiveDeployment(deploymentBefore, deploymentAfter);

    const contract = validateLiveRemoteYouTubeDeploymentContract({
      versionsView,
      deploymentStatus: deploymentAfter,
      queueConsumerContexts: [
        { expectedQueueName: mainQueueName, response: mainConsumers },
        { expectedQueueName: dlqName, response: dlqConsumers },
      ],
      expectedD1BindingName: 'MKT_STATE_DB',
      expectedDatabaseId: expected.databaseId,
      expectedDatabaseName: databaseName,
      expectedFalseFlagNames,
      workerName,
      scriptList,
      schedules,
      subdomain,
      active: false,
      expectedRemoteFingerprint: expected.remoteContractFingerprint,
    });
    const migration = classifyYouTubeRemoteReadOnlyPreflight({
      pendingMigrations: parsePendingMigrationNames(migrationsRead.text),
    });
    const summary = Object.freeze({
      ok: migration.decision === 'PASS_READ_ONLY_PREFLIGHT',
      decision: migration.decision,
      repositoryHead,
      originMainHead,
      workingTreeClean: true,
      wranglerAuth: 'AUTHENTICATED',
      activeVersion: stable.versionId,
      activeTraffic: stable.traffic,
      activeVersionStable: stable.stable,
      remoteFingerprint: contract.remoteFingerprint,
      expectedRemoteFingerprint: expected.remoteContractFingerprint,
      remoteFingerprintMatch: contract.remoteFingerprint === expected.remoteContractFingerprint,
      secretNameCount: contract.secretNameCount,
      observedSecretNameCount: contract.observedSecretNameCount,
      additionalSecretNameCount: contract.additionalSecretNameCount,
      expectedFalseFlagCount: contract.expectedFalseFlagCount,
      materializedFalseFlagCount: contract.materializedFalseFlagCount,
      queueConsumerCount: contract.queueConsumerCount,
      migrationReadAttempts: migrationsRead.attempts,
      migrationReadTransientRetries: migrationsRead.transientRetries,
      pendingMigrations: migration.pendingMigrations,
      migration0017: migration.migration0017,
      migration0018: migration.migration0018,
      remoteMutation: 'NONE',
      providerCall: 'NOT_RUN',
      queueMessage: 'NOT_SENT',
      d1Write: 'NONE',
      larkRequest: 'NOT_RUN',
      workerDeployment: 'NOT_RUN',
      scheduleMutation: 'NONE',
      production: 'BLOCKED',
    });
    const outputPath = resolveRepositoryFile(
      process.env.MKT_YOUTUBE_REMOTE_PREFLIGHT_OUTPUT ?? DEFAULT_OUTPUT,
    );
    await writePrivateJson(outputPath, summary);
    process.stdout.write(`${JSON.stringify({
      ...summary,
      outputFile: relative(repositoryRoot, outputPath),
    }, null, 2)}\n`);
    process.exitCode = summary.ok ? 0 : 2;
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    decision: normalizeYouTubeRemotePreflightDecision(error?.code),
    message: error instanceof Error ? error.message : String(error),
    diagnostic: sanitizeDiagnostic(error?.details),
    remoteMutation: 'NONE',
    providerCall: 'NOT_RUN',
    queueMessage: 'NOT_SENT',
    d1Write: 'NONE',
    larkRequest: 'NOT_RUN',
    workerDeployment: 'NOT_RUN',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  let execute = false;
  for (const arg of args) {
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    throw preflightError(
      `Unknown YouTube Remote preflight argument: ${arg}`,
      'YOUTUBE_REMOTE_PREFLIGHT_ARGUMENT_INVALID',
    );
  }
  return Object.freeze({ execute });
}

function assertConfirmation(env) {
  if (env?.[CONFIRMATION_ENV] !== CONFIRMATION_VALUE) {
    throw preflightError(
      `YouTube Remote preflight requires ${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
      'YOUTUBE_REMOTE_PREFLIGHT_CONFIRMATION_REQUIRED',
    );
  }
}

async function readDeploymentStatus(configPath, workerName) {
  const parsed = JSON.parse(await wranglerText([
    'deployments', 'status', '--name', workerName,
    '--config', configPath, '--json',
  ]));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function readVersionView(configPath, workerName, versionId) {
  return JSON.parse(await wranglerText([
    'versions', 'view', versionId, '--name', workerName,
    '--config', configPath, '--json',
  ]));
}

async function readQueueConsumers(queueName) {
  return JSON.parse(await wranglerText([
    'queues', 'consumer', 'list', queueName, '--json',
  ]));
}

async function readAllCloudflareWorkerScripts(accountPath, apiToken) {
  const scripts = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await cloudflareApiJson(
      `${accountPath}/scripts?page=${page}&per_page=100`,
      apiToken,
    );
    if (!Array.isArray(response.result)) {
      throw preflightError(
        'Cloudflare Worker list returned an invalid result',
        'YOUTUBE_REMOTE_PREFLIGHT_RESPONSE_INVALID',
      );
    }
    scripts.push(...response.result);
    totalPages = Number(response.result_info?.total_pages ?? 1);
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 10_000) {
      throw preflightError(
        'Cloudflare Worker list returned invalid pagination',
        'YOUTUBE_REMOTE_PREFLIGHT_RESPONSE_INVALID',
      );
    }
    page += 1;
  } while (page <= totalPages);
  return { success: true, result: scripts };
}

async function cloudflareApiJson(path, apiToken) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok || parsed?.success !== true) {
    throw preflightError(
      'Cloudflare read-only metadata request failed',
      'YOUTUBE_REMOTE_PREFLIGHT_RESPONSE_INVALID',
      { status: response.status },
    );
  }
  return parsed;
}

async function wranglerText(args) {
  return (await execFileAsync('npx', ['wrangler', ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })).stdout;
}

async function gitText(args, options = {}) {
  const result = await execFileAsync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return options.trim === false ? result.stdout : result.stdout.trim();
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, value);
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}${sep}`)) {
    throw preflightError(
      'YouTube Remote preflight path must stay inside the repository',
      'YOUTUBE_REMOTE_PREFLIGHT_PATH_INVALID',
    );
  }
  return path;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw preflightError(`${name} is required`, 'YOUTUBE_REMOTE_PREFLIGHT_ENV_REQUIRED', { name });
  }
  return value.trim();
}

function exactOrDefault(value, expected, name) {
  const observed = typeof value === 'string' && value.trim() ? value.trim() : expected;
  if (observed !== expected) {
    throw preflightError(
      `${name} must equal ${expected}`,
      'YOUTUBE_REMOTE_PREFLIGHT_TARGET_INVALID',
      { name },
    );
  }
  return observed;
}

function sanitizeDiagnostic(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const allowed = new Set([
    'expectedFingerprint',
    'remoteFingerprint',
    'missing',
    'fieldName',
    'expectedQueueName',
    'observedQueueName',
    'matchCount',
    'name',
    'status',
    'attempts',
    'transientRetries',
    'cloudflareCode',
    'retryable',
  ]);
  const sanitized = Object.fromEntries(
    Object.entries(details)
      .filter(([name]) => allowed.has(name))
      .map(([name, value]) => [name, Array.isArray(value) ? [...value] : value]),
  );
  return Object.keys(sanitized).length > 0 ? Object.freeze(sanitized) : undefined;
}

function preflightError(message, code, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = Object.freeze({ ...details });
  return error;
}
