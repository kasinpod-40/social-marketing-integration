#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  CHATWOOT_PREFLIGHT_CONFIRMATION,
  CHATWOOT_PREFLIGHT_CONTRACT_VERSION,
  CHATWOOT_PREFLIGHT_PHASES,
  assertChatwootPreflightConfirmation,
  createChatwootPreflightEvidence,
  extractRemotePlainTextVars,
  loadChatwootPreflightTarget,
  parseAppliedMigrations,
  parseChatwootPreflightArgs,
  parsePendingMigrations,
  parseQueueConsumers,
  parseSecretNames,
  sha256,
  stableStringify,
  validateActiveDeployment,
  validateChatwootRemoteConfig,
  validateMigrationLedger,
  validateQueueConsumers,
  validateRemoteTriggerState,
  validateSecretNames,
} from './lib/chatwoot-read-only-preflight-operator.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const evidenceRoot = join(repositoryRoot, 'outputs', 'chatwoot-read-only-preflight');

try {
  const options = parseChatwootPreflightArgs(process.argv.slice(2));
  if (options.phase === 'plan') {
    const plan = {
      contractVersion: CHATWOOT_PREFLIGHT_CONTRACT_VERSION,
      planOnly: true,
      phases: CHATWOOT_PREFLIGHT_PHASES,
      executableConfirmation: CHATWOOT_PREFLIGHT_CONFIRMATION,
      evidenceRoot: relative(repositoryRoot, evidenceRoot),
      allowedRemoteOperations: [
        'Worker deployment/status read',
        'Worker version metadata read',
        'Worker Secret-name list read',
        'D1 migration list read',
        'D1 applied-migration ledger SELECT',
        'Queue consumer metadata read',
        'Worker script/schedule/workers.dev metadata read',
      ],
      forbiddenOperations: [
        'Chatwoot Provider/API request',
        'Secret value read or rotation',
        'D1 backup, migration apply or Business write',
        'Lark API request or mutation',
        'Queue send, retry or DLQ action',
        'Worker deployment',
        'Schedule, route or workers.dev mutation',
        'Customer LIVE UAT or Production action',
      ],
      remoteMutationCount: 0,
      providerRequestCount: 0,
    };
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else if (!options.execute) {
    throw operatorFailure(
      'Preflight execution requires --execute and the exact confirmation token',
      'CHATWOOT_PREFLIGHT_EXECUTE_REQUIRED',
    );
  } else {
    await runPreflight();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'CHATWOOT_PREFLIGHT_FAILED',
    message: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function runPreflight() {
  assertChatwootPreflightConfirmation(process.env);
  const target = loadChatwootPreflightTarget(process.env);
  const repositoryHead = await gitText(['rev-parse', 'HEAD']);
  const workingTree = await gitText([
    'status', '--porcelain', '--untracked-files=all',
  ], { trim: false });
  if (repositoryHead !== target.repositoryHead || workingTree.trim() !== '') {
    throw operatorFailure(
      'Chatwoot preflight requires the exact reviewed HEAD and a clean Working Tree',
      'CHATWOOT_PREFLIGHT_REPOSITORY_STATE_INVALID',
    );
  }

  const configPath = resolveRepositoryFile(target.configPath);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  const [
    localBundle,
    deploymentRaw,
    versionRaw,
    pendingRaw,
    appliedRaw,
    secretsRaw,
    mainConsumersRaw,
    dlqConsumersRaw,
    triggerState,
  ] = await Promise.all([
    buildLocalBundle(configPath),
    wranglerJson([
      'deployments', 'status', '--name', target.workerName,
      '--config', configPath, '--json',
    ]),
    wranglerJson([
      'versions', 'view', target.expectedActiveVersion,
      '--name', target.workerName, '--config', configPath, '--json',
    ]),
    wranglerText([
      'd1', 'migrations', 'list', 'MKT_STATE_DB', '--remote',
      '--config', configPath,
    ]),
    wranglerJson([
      'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
      '--config', configPath,
      '--command', 'SELECT name FROM d1_migrations ORDER BY id;',
    ]),
    wranglerJson([
      'secret', 'list', '--name', target.workerName,
      '--config', configPath, '--format', 'json',
    ]),
    wranglerJson([
      'queues', 'consumer', 'list', target.mainQueueName, '--json',
    ]),
    wranglerJson([
      'queues', 'consumer', 'list', target.dlqName, '--json',
    ]),
    readRemoteTriggerState(target),
  ]);

  const deployment = validateActiveDeployment(deploymentRaw, target.expectedActiveVersion);
  const remoteVars = extractRemotePlainTextVars(versionRaw);
  const remoteConfig = validateChatwootRemoteConfig(remoteVars, target);
  const secrets = validateSecretNames(parseSecretNames(secretsRaw));
  const migrations = validateMigrationLedger({
    applied: parseAppliedMigrations(appliedRaw),
    pending: parsePendingMigrations(pendingRaw),
  });
  const queues = validateQueueConsumers({
    mainConsumers: parseQueueConsumers(mainConsumersRaw),
    dlqConsumers: parseQueueConsumers(dlqConsumersRaw),
    target,
  });
  const triggers = validateRemoteTriggerState({ ...triggerState, target });

  const evidence = createChatwootPreflightEvidence({
    repositoryHead,
    targetFingerprint: target.targetFingerprint,
    data: {
      activeVersion: deployment.versionId,
      activeTrafficPercentage: deployment.percentage,
      localBundleSha256: localBundle.sha256,
      localBundleFileCount: localBundle.fileCount,
      chatwootFlagFingerprint: remoteConfig.flagFingerprint,
      chatwootBaseUrlSha256: remoteConfig.baseUrlSha256,
      chatwootExternalAccountIdSha256: remoteConfig.externalAccountIdSha256,
      requiredSecretNameCount: secrets.requiredPresent,
      optionalSecretNameCount: secrets.optionalPresent,
      secretNameCount: secrets.secretNameCount,
      secretNameFingerprint: secrets.secretNameFingerprint,
      migration0017Applied: migrations.appliedMigrationPresent,
      migration0018Pending: migrations.pendingMigration,
      unexpectedPendingMigrations: migrations.unexpectedPending,
      mainQueueConsumerCount: queues.mainConsumerCount,
      dlqConsumerCount: queues.dlqConsumerCount,
      queueConsumerFingerprint: queues.consumerFingerprint,
      workerPresent: triggers.workerPresent,
      cronCount: triggers.cronCount,
      cronFingerprint: triggers.cronFingerprint,
      workersDevEnabled: triggers.workersDevEnabled,
      remoteReadCount: 10,
      remoteMutationCount: 0,
      providerRequestCount: 0,
      secretValueReadCount: 0,
    },
  });

  await writePrivateJson(join(evidenceRoot, 'preflight.json'), evidence);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    phase: 'preflight',
    repositoryHead,
    targetFingerprint: target.targetFingerprint,
    evidenceSha256: evidence.evidenceSha256,
    evidenceFile: relative(repositoryRoot, join(evidenceRoot, 'preflight.json')),
    data: evidence.data,
  }, null, 2)}\n`);
}

async function readRemoteTriggerState(target) {
  const apiToken = requiredEnv('CLOUDFLARE_API_TOKEN');
  const accountId = requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  const accountPath = `/accounts/${encodeURIComponent(accountId)}/workers`;
  const scriptPath = `${accountPath}/scripts/${encodeURIComponent(target.workerName)}`;
  const [scriptList, schedules, subdomain] = await Promise.all([
    readAllWorkerScripts(accountPath, apiToken),
    cloudflareApiJson(`${scriptPath}/schedules`, apiToken),
    cloudflareApiJson(`${scriptPath}/subdomain`, apiToken),
  ]);
  return { scriptList, schedules, subdomain };
}

async function readAllWorkerScripts(accountPath, apiToken) {
  const scripts = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await cloudflareApiJson(
      `${accountPath}/scripts?page=${page}&per_page=100`,
      apiToken,
    );
    if (!Array.isArray(response.result)) {
      throw operatorFailure(
        'Cloudflare Worker list returned an invalid result',
        'CHATWOOT_PREFLIGHT_REMOTE_CONTRACT_INVALID',
      );
    }
    scripts.push(...response.result);
    totalPages = Number(response.result_info?.total_pages ?? 1);
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 10_000) {
      throw operatorFailure(
        'Cloudflare Worker list returned invalid pagination',
        'CHATWOOT_PREFLIGHT_REMOTE_CONTRACT_INVALID',
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
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    throw operatorFailure(
      'Cloudflare read-only response was not JSON',
      'CHATWOOT_PREFLIGHT_REMOTE_CONTRACT_INVALID',
    );
  }
  if (!response.ok || parsed?.success !== true) {
    throw operatorFailure(
      `Cloudflare read-only request failed with HTTP ${response.status}`,
      'CHATWOOT_PREFLIGHT_REMOTE_CONTRACT_INVALID',
    );
  }
  return parsed;
}

async function buildLocalBundle(configPath) {
  const parent = join(evidenceRoot, 'bundles');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, 'preflight-'));
  await wranglerText([
    'deploy', '--dry-run', '--strict', '--config', configPath, '--outdir', directory,
  ]);
  const files = await listFiles(directory);
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(directory, file));
    hash.update(await readFile(file));
  }
  return { sha256: hash.digest('hex'), fileCount: files.length };
}

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

async function wranglerJson(args) {
  const output = await wranglerText(args);
  try {
    return JSON.parse(output);
  } catch {
    throw operatorFailure(
      'Wrangler read-only command returned non-JSON output',
      'CHATWOOT_PREFLIGHT_WRANGLER_JSON_INVALID',
    );
  }
}

async function wranglerText(args) {
  return (await runCommand(['npx', 'wrangler', ...args])).stdout;
}

async function gitText(args, options = {}) {
  const result = await execFileAsync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return options.trim === false ? result.stdout : result.stdout.trim();
}

async function runCommand(command) {
  if (!Array.isArray(command) || command.length < 2 || command.some((part) => typeof part !== 'string')) {
    throw operatorFailure('Operator command is invalid', 'CHATWOOT_PREFLIGHT_COMMAND_INVALID');
  }
  const [file, ...args] = command;
  const result = await execFileAsync(file, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, value);
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}${sep}`)) {
    throw operatorFailure(
      'Wrangler config must be inside the reviewed repository',
      'CHATWOOT_PREFLIGHT_CONFIG_PATH_INVALID',
    );
  }
  return path;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorFailure(`${name} is required`, 'CHATWOOT_PREFLIGHT_ENV_REQUIRED');
  }
  return value.trim();
}

function operatorFailure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
