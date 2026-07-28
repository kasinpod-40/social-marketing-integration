#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { rebaseGeneratedWranglerConfigPaths } from './lib/rebase-generated-wrangler-config-paths.js';
import {
  buildYouTubeLarkUatConfigWindow,
  validateYouTubeLarkUatEvidence,
} from './lib/youtube-lark-full-sync-uat-operator.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';

const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_YOUTUBE_LARK_UAT_EVIDENCE_DIR
    ?? 'outputs/youtube-lark-full-sync-uat',
);
const sessionPath = resolve(
  process.env.MKT_YOUTUBE_LARK_UAT_SESSION_FILE
    ?? join(outputRoot, 'session.json'),
);
const confirmationName = 'CONFIRM_YOUTUBE_LARK_UAT_EMERGENCY_RESTORE';
const confirmationValue = 'EMERGENCY_RESTORE_YOUTUBE_LARK_UAT';

try {
  if (process.env[confirmationName] !== confirmationValue) {
    throw restoreError(
      `Emergency restore requires ${confirmationName}=${confirmationValue}`,
      'YOUTUBE_LARK_UAT_EMERGENCY_CONFIRMATION_REQUIRED',
    );
  }
  await restore();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'YOUTUBE_LARK_UAT_EMERGENCY_RESTORE_FAILED',
    message: error instanceof Error ? error.message : String(error),
    tokenPrinted: false,
    queueMessage: 'NOT_SENT',
    d1Write: 'NONE',
    larkRequest: 'NOT_RUN',
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function restore() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const baseEnv = { ...fileEnv, ...process.env };
  const dirty = runText('git', ['status', '--porcelain', '--untracked-files=all'], {
    env: baseEnv,
    trim: false,
  });
  if (dirty.trim() !== '') {
    throw restoreError(
      'Emergency restore requires a clean Working Tree',
      'YOUTUBE_LARK_UAT_EMERGENCY_WORKING_TREE_DIRTY',
    );
  }

  const session = readSession(JSON.parse(await readFile(sessionPath, 'utf8')));
  const evidenceRoot = join(outputRoot, session.operationId);
  const remote = await readEvidence(evidenceRoot, 'remote-preflight', session);
  const activation = await readActivationEvidence(evidenceRoot, session);
  const sourceText = await readFile('wrangler.sync.jsonc', 'utf8');
  const config = buildYouTubeLarkUatConfigWindow(sourceText, {
    channelId: session.channelId,
  });
  if (config.safeSha256 !== remote.data.safeConfigSha256) {
    throw restoreError(
      'Current safe config differs from the reviewed preflight config',
      'YOUTUBE_LARK_UAT_EMERGENCY_SAFE_CONFIG_CHANGED',
    );
  }

  const auth = await resolveCloudflareSession(baseEnv, sourceText);
  if (auth.accountId !== session.cloudflareAccountId) {
    throw restoreError(
      'Authenticated Cloudflare account differs from the pinned UAT session',
      'YOUTUBE_LARK_UAT_EMERGENCY_ACCOUNT_CHANGED',
    );
  }

  const current = readActiveVersion(session, auth.env);
  const baselineVersion = String(remote.data.activeVersion ?? '');
  const activatedVersion = String(
    activation.data.activeVersion ?? activation.data.deploymentVersionId ?? '',
  );

  if (current === baselineVersion) {
    const trueFlags = readRemoteTrueFlags(session, current, auth.env);
    if (trueFlags.length !== 0) {
      throw restoreError(
        'Baseline version contains an unexpected true execution flag',
        'YOUTUBE_LARK_UAT_EMERGENCY_BASELINE_NOT_SAFE',
      );
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      decision: 'ALREADY_SAFE_NO_DEPLOYMENT',
      activeVersion: current,
      trueFlagCount: 0,
      workerDeployment: 'NOT_RUN',
      queueMessage: 'NOT_SENT',
      d1Write: 'NONE',
      larkRequest: 'NOT_RUN',
      tokenPrinted: false,
    }, null, 2)}\n`);
    return;
  }

  if (!activatedVersion || current !== activatedVersion) {
    throw restoreError(
      'Active Worker version differs from both baseline and reviewed UAT activation',
      'YOUTUBE_LARK_UAT_EMERGENCY_ACTIVE_VERSION_CHANGED',
    );
  }

  const attemptPath = join(evidenceRoot, 'emergency-restore.attempt.json');
  await assertAbsent(attemptPath);
  await writePrivateJson(attemptPath, {
    contractVersion: 'youtube_lark_full_sync_uat_emergency_restore_v1',
    operationId: session.operationId,
    repositoryHead: session.repositoryHead,
    expectedActivatedVersion: activatedVersion,
    baselineVersion,
    safeConfigSha256: config.safeSha256,
    attemptedAt: new Date().toISOString(),
  });

  const result = await withGeneratedConfig(config.safeText, async (configPath) => run(
    'npx',
    [
      'wrangler', 'deploy', '--config', configPath,
      '--message', `youtube_lark_uat_emergency_restore operation=${session.operationId}`,
    ],
    { env: auth.env },
  ));
  const restoredVersion = extractVersionId(result.stdout);
  const observed = readActiveVersion(session, auth.env);
  if (observed !== restoredVersion) {
    throw restoreError(
      'Emergency restored version did not become the sole active version',
      'YOUTUBE_LARK_UAT_EMERGENCY_RESTORE_NOT_ACTIVE',
    );
  }
  const trueFlags = readRemoteTrueFlags(session, restoredVersion, auth.env);
  if (trueFlags.length !== 0) {
    throw restoreError(
      'Emergency restored Worker still contains a true execution flag',
      'YOUTUBE_LARK_UAT_EMERGENCY_RESTORE_FLAG_INVALID',
    );
  }

  const evidence = {
    contractVersion: 'youtube_lark_full_sync_uat_emergency_restore_v1',
    operationId: session.operationId,
    repositoryHead: session.repositoryHead,
    activeVersionBefore: activatedVersion,
    restoredVersion,
    safeConfigSha256: config.safeSha256,
    trueFlagCount: 0,
    restoredAt: new Date().toISOString(),
    workerDeployment: 'COMPLETED_ALL_FALSE',
    queueMessage: 'NOT_SENT',
    d1Write: 'NONE',
    larkRequest: 'NOT_RUN',
    tokenPersisted: false,
  };
  await writePrivateJson(join(evidenceRoot, 'emergency-restore.json'), evidence);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    decision: 'EMERGENCY_RESTORE_ALL_FALSE_COMPLETED',
    ...evidence,
    tokenPrinted: false,
  }, null, 2)}\n`);
}

async function readEvidence(root, phase, session) {
  const value = JSON.parse(await readFile(join(root, `${phase}.json`), 'utf8'));
  return validateYouTubeLarkUatEvidence(value, {
    repositoryHead: session.repositoryHead,
    targetFingerprint: value.targetFingerprint,
    operationId: session.operationId,
  });
}

async function readActivationEvidence(root, session) {
  for (const phase of ['verify-active', 'deploy-active']) {
    try {
      return await readEvidence(root, phase, session);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw restoreError(
    'Emergency restore requires deploy-active or verify-active evidence',
    'YOUTUBE_LARK_UAT_EMERGENCY_ACTIVATION_EVIDENCE_MISSING',
  );
}

function readSession(value) {
  const validLegacy = value?.contractVersion === 'youtube_lark_full_sync_uat_session_v1'
    && value.channelId === 'UCAwEENovvqZWosKhJWTS5Kg';
  const validCustomer = value?.contractVersion === 'youtube_lark_full_sync_uat_session_v2'
    && /^UC[A-Za-z0-9_-]{20,}$/u.test(String(value.channelId ?? ''))
    && String(value.connectionId ?? '').trim();
  if ((!validLegacy && !validCustomer)
    || !/^[0-9a-f]{40}$/u.test(String(value.repositoryHead ?? ''))
    || !/^[a-z0-9][a-z0-9_-]{0,95}$/u.test(String(value.operationId ?? ''))
    || !String(value.cloudflareAccountId ?? '').trim()
    || value.queueName !== 'social-mkt-sync-jobs') {
    throw restoreError(
      'Emergency restore session is invalid',
      'YOUTUBE_LARK_UAT_EMERGENCY_SESSION_INVALID',
    );
  }
  return Object.freeze({ ...value });
}

async function resolveCloudflareSession(baseEnv, configText) {
  const env = { ...baseEnv };
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!String(env[key] ?? '').trim()) delete env[key];
  }
  const whoami = runText('npx', ['wrangler', 'whoami', '--json'], { env });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    configText,
    whoamiOutput: whoami,
  });
  const selectedEnv = { ...env, CLOUDFLARE_ACCOUNT_ID: accountId };
  runText('npx', ['wrangler', 'whoami', '--account', accountId, '--json'], {
    env: selectedEnv,
  });
  const authOutput = selectedEnv.CLOUDFLARE_API_TOKEN
    ? null
    : runText('npx', ['wrangler', 'auth', 'token', '--json'], { env: selectedEnv });
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: selectedEnv.CLOUDFLARE_API_TOKEN,
    authOutput,
  });
  return Object.freeze({
    accountId,
    env: Object.freeze({
      ...selectedEnv,
      CLOUDFLARE_API_TOKEN: auth.token,
    }),
  });
}

function readActiveVersion(session, env) {
  const parsed = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status', '--name', 'social-mkt-sync-worker',
    '--config', 'wrangler.sync.jsonc', '--json',
  ], { env }));
  const value = Array.isArray(parsed) ? parsed[0] : parsed;
  const active = Array.isArray(value?.versions)
    ? value.versions.filter((item) => Number(item.percentage) === 100)
    : [];
  if (active.length !== 1) {
    throw restoreError(
      'Emergency restore requires exactly one 100% active Worker version',
      'YOUTUBE_LARK_UAT_EMERGENCY_ACTIVE_VERSION_INVALID',
    );
  }
  const versionId = String(active[0].version_id ?? active[0].id ?? '').trim();
  if (!/^[0-9a-f-]{36}$/u.test(versionId)) {
    throw restoreError(
      'Emergency restore active Worker version is invalid',
      'YOUTUBE_LARK_UAT_EMERGENCY_ACTIVE_VERSION_INVALID',
    );
  }
  return versionId;
}

function readRemoteTrueFlags(session, versionId, env) {
  const parsed = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', versionId,
    '--name', 'social-mkt-sync-worker',
    '--config', 'wrangler.sync.jsonc', '--json',
  ], { env }));
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  const bindings = Array.isArray(item?.bindings)
    ? item.bindings
    : item?.resources?.bindings;
  if (!Array.isArray(bindings)) {
    throw restoreError(
      'Emergency restore version view lacks bindings',
      'YOUTUBE_LARK_UAT_EMERGENCY_VERSION_INVALID',
    );
  }
  return bindings
    .filter((binding) => {
      const type = String(binding?.type ?? '').toLowerCase().replaceAll('-', '_');
      const name = String(binding?.name ?? binding?.binding ?? '').trim();
      const value = String(binding?.text ?? binding?.value ?? '').trim().toLowerCase();
      return type === 'plain_text'
        && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
        && value === 'true';
    })
    .map((binding) => String(binding.name ?? binding.binding))
    .sort();
}

async function withGeneratedConfig(configText, operation) {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-lark-uat-emergency-'));
  try {
    const rebased = rebaseGeneratedWranglerConfigPaths(configText, {
      sourceDirectory: repositoryRoot,
      outputDirectory: directory,
    });
    const path = join(directory, 'wrangler.safe.json');
    await writeFile(path, rebased.text, { mode: 0o600 });
    await chmod(path, 0o600);
    return await operation(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertAbsent(path) {
  try {
    await stat(path);
    throw restoreError(
      'An emergency restore attempt already exists; automatic repetition is disabled',
      'YOUTUBE_LARK_UAT_EMERGENCY_ATTEMPT_EXISTS',
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function extractVersionId(value) {
  const matches = String(value).match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu,
  ) ?? [];
  if (matches.length === 0) {
    throw restoreError(
      'Emergency restore deploy output lacks a Worker version ID',
      'YOUTUBE_LARK_UAT_EMERGENCY_VERSION_MISSING',
    );
  }
  return matches.at(-1).toLowerCase();
}

function runText(command, args, options = {}) {
  return run(command, args, options).stdout.trim();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw restoreError(
      result.stderr?.trim() || result.stdout?.trim() || `${command} failed`,
      'YOUTUBE_LARK_UAT_EMERGENCY_COMMAND_FAILED',
    );
  }
  return result;
}

function restoreError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
