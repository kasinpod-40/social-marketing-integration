#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import {
  parseYouTubeLarkUatArgs,
} from './lib/youtube-lark-full-sync-uat-operator.js';

const repositoryRoot = resolve(process.cwd());
const sessionPath = resolve(
  process.env.MKT_YOUTUBE_LARK_UAT_SESSION_FILE
    ?? 'outputs/youtube-lark-full-sync-uat/session.json',
);
const queueName = 'social-mkt-sync-jobs';
const channelId = 'UCAwEENovvqZWosKhJWTS5Kg';

try {
  const parsed = parseYouTubeLarkUatArgs(process.argv.slice(2));
  if (parsed.phase === 'plan') {
    const result = spawnSync(
      process.execPath,
      ['scripts/youtube-lark-full-sync-uat-operator.mjs'],
      { cwd: repositoryRoot, stdio: 'inherit', env: process.env },
    );
    process.exitCode = result.status ?? 1;
  } else {
    await runPhase(parsed);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'YOUTUBE_LARK_UAT_SESSION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    tokenPrinted: false,
    remoteMutation: 'NONE_BY_SESSION_WRAPPER',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function runPhase(parsed) {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const baseEnv = { ...fileEnv, ...process.env };
  const repositoryHead = runText('git', ['rev-parse', 'HEAD'], { env: baseEnv });
  const workingTree = runText(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { env: baseEnv, trim: false },
  );
  if (workingTree.trim() !== '') {
    throw sessionError(
      'YouTube Lark UAT session requires a clean Working Tree',
      'YOUTUBE_LARK_UAT_SESSION_WORKING_TREE_DIRTY',
    );
  }

  const auth = resolveCloudflareSession(baseEnv);
  const queue = await resolveQueue(auth.accountId, auth.token, queueName);
  const session = await loadOrCreateSession({
    repositoryHead,
    accountId: auth.accountId,
    queueId: queue.queueId,
  });
  if (session.repositoryHead !== repositoryHead) {
    throw sessionError(
      'Local repository HEAD differs from the pinned YouTube Lark UAT session',
      'YOUTUBE_LARK_UAT_SESSION_HEAD_CHANGED',
    );
  }
  if (session.cloudflareAccountId !== auth.accountId
    || session.queueId !== queue.queueId
    || session.queueName !== queueName) {
    throw sessionError(
      'Resolved Cloudflare target differs from the pinned YouTube Lark UAT session',
      'YOUTUBE_LARK_UAT_SESSION_TARGET_CHANGED',
    );
  }

  const env = {
    ...baseEnv,
    CLOUDFLARE_ACCOUNT_ID: auth.accountId,
    CLOUDFLARE_API_TOKEN: auth.token,
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_YOUTUBE_LARK_UAT_ACCOUNT_KEY: 'dev_ft_pumkin',
    MKT_YOUTUBE_LARK_UAT_EXPECTED_CHANNEL_ID: channelId,
    MKT_YOUTUBE_LARK_UAT_REPOSITORY_HEAD: session.repositoryHead,
    MKT_YOUTUBE_LARK_UAT_OPERATION_ID: session.operationId,
    MKT_YOUTUBE_LARK_UAT_ORIGINAL_REQUESTED_AT: String(session.originalRequestedAt),
    MKT_YOUTUBE_LARK_UAT_QUEUE_ID: session.queueId,
  };

  process.stdout.write(`${JSON.stringify({
    ok: true,
    phase: parsed.phase,
    sessionResolved: true,
    cloudflareAccountResolved: true,
    queueResolved: true,
    authenticationSource: auth.source,
    tokenPrinted: false,
    repositoryHead: session.repositoryHead,
    operationId: session.operationId,
    originalRequestedAt: session.originalRequestedAt,
  }, null, 2)}\n`);

  const result = spawnSync(
    process.execPath,
    [
      'scripts/youtube-lark-full-sync-uat-operator.mjs',
      `--phase=${parsed.phase}`,
      '--execute',
    ],
    { cwd: repositoryRoot, stdio: 'inherit', env },
  );
  process.exitCode = result.status ?? 1;
}

function resolveCloudflareSession(baseEnv) {
  const env = { ...baseEnv };
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!String(env[key] ?? '').trim()) delete env[key];
  }
  const configText = runText('cat', ['wrangler.sync.jsonc'], { env });
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
  return Object.freeze({ accountId, token: auth.token, source: auth.source });
}

async function resolveQueue(accountId, token, expectedName) {
  const matches = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`
        + `/queues?page=${page}&per_page=100`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true || !Array.isArray(body.result)) {
      throw sessionError(
        `Cloudflare Queue inventory read failed (HTTP ${response.status})`,
        'YOUTUBE_LARK_UAT_SESSION_QUEUE_READ_FAILED',
      );
    }
    for (const item of body.result) {
      const name = String(item.queue_name ?? item.name ?? '').trim();
      if (name === expectedName) {
        matches.push({
          queueId: String(item.queue_id ?? item.id ?? '').trim(),
          queueName: name,
        });
      }
    }
    totalPages = Number(body.result_info?.total_pages ?? 1);
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 10_000) {
      throw sessionError(
        'Cloudflare Queue inventory pagination is invalid',
        'YOUTUBE_LARK_UAT_SESSION_QUEUE_READ_FAILED',
      );
    }
    page += 1;
  } while (page <= totalPages);
  if (matches.length !== 1 || !matches[0].queueId) {
    throw sessionError(
      `Expected exactly one Cloudflare Queue named ${expectedName}`,
      'YOUTUBE_LARK_UAT_SESSION_QUEUE_TARGET_INVALID',
    );
  }
  return Object.freeze(matches[0]);
}

async function loadOrCreateSession(input) {
  try {
    const existing = JSON.parse(await readFile(sessionPath, 'utf8'));
    validateSession(existing);
    return Object.freeze(existing);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const originalRequestedAt = Date.now();
  const operationId = [
    'youtube-lark-uat',
    new Date(originalRequestedAt).toISOString().replaceAll(/[-:.]/gu, '').toLowerCase(),
    input.repositoryHead.slice(0, 8),
  ].join('-');
  const session = Object.freeze({
    contractVersion: 'youtube_lark_full_sync_uat_session_v1',
    repositoryHead: input.repositoryHead,
    operationId,
    originalRequestedAt,
    cloudflareAccountId: input.accountId,
    queueId: input.queueId,
    queueName,
    channelId,
    createdAt: new Date(originalRequestedAt).toISOString(),
  });
  validateSession(session);
  await writePrivateJson(sessionPath, session);
  return session;
}

function validateSession(value) {
  if (value?.contractVersion !== 'youtube_lark_full_sync_uat_session_v1'
    || !/^[0-9a-f]{40}$/u.test(String(value.repositoryHead ?? ''))
    || !/^[a-z0-9][a-z0-9_-]{0,95}$/u.test(String(value.operationId ?? ''))
    || !Number.isSafeInteger(Number(value.originalRequestedAt))
    || !String(value.cloudflareAccountId ?? '').trim()
    || !String(value.queueId ?? '').trim()
    || value.queueName !== queueName
    || value.channelId !== channelId) {
    throw sessionError(
      'YouTube Lark UAT session file is invalid',
      'YOUTUBE_LARK_UAT_SESSION_INVALID',
    );
  }
  return true;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

function runText(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw sessionError(
      result.stderr?.trim() || result.stdout?.trim() || `${command} failed`,
      'YOUTUBE_LARK_UAT_SESSION_COMMAND_FAILED',
    );
  }
  return options.trim === false ? result.stdout : result.stdout.trim();
}

function sessionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
