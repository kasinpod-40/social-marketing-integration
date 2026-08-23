import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  TIKTOK_PRODUCTION_RECOVERY,
  readJsoncScalar,
} from './lib/tiktok-production-uat-recovery-contract.js';

try {
  const repositoryRoot = resolve(
    process.env.MKT_RUNNER_REPOSITORY_ROOT
      ?? join(homedir(), 'Git', 'social-marketing-integration'),
  );
  const wrangler = resolve(repositoryRoot, 'node_modules/.bin/wrangler');
  await requireReadable(wrangler);

  const production = await discoverProductionWorktree(repositoryRoot);
  const queueName = requireText(
    readJsoncScalar(production.configText, 'MKT_MAIN_QUEUE_NAME'),
    'MKT_MAIN_QUEUE_NAME',
  );

  const auth = readWranglerAuth({ wrangler, cwd: production.worktree });
  const account = await resolveAccount({
    apiToken: auth.token,
    requestedAccountId: process.env.CF_ACCOUNT_ID,
  });
  const queue = await resolveQueue({
    apiToken: auth.token,
    accountId: account.id,
    queueName,
    requestedQueueId: process.env.CF_QUEUE_ID,
  });

  console.log(JSON.stringify({
    ok: true,
    mode: 'wrangler-oauth-authority-resolved',
    authType: auth.type,
    account: { id: account.id, name: account.name ?? null },
    queue: { id: queue.id, name: queue.queue_name ?? queueName },
    tokenExposed: false,
    next: 'delegating_to_reviewed_live_recovery_runner',
  }, null, 2));

  const liveRunner = resolve(
    new URL('./tiktok-production-uat-live-recovery.mjs', import.meta.url).pathname,
  );
  const result = spawnSync(process.execPath, [liveRunner, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CF_ACCOUNT_ID: account.id,
      CF_QUEUE_ID: queue.id,
      CLOUDFLARE_API_TOKEN: auth.token,
    },
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.signal) {
    throw operatorError('Live recovery runner terminated by signal', 'TIKTOK_PRODUCTION_WRANGLER_AUTH_DELEGATE_SIGNAL', {
      signal: result.signal,
    });
  }
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'wrangler-oauth-authority-resolution',
    code: error?.code ?? 'TIKTOK_PRODUCTION_WRANGLER_AUTH_FAILED',
    message: error?.message ?? String(error),
    details: sanitize(error?.details ?? {}),
    tokenExposed: false,
    productionMutationCount: 0,
  }, null, 2));
  process.exitCode = 1;
}

function readWranglerAuth({ wrangler, cwd }) {
  const result = run(wrangler, ['auth', 'token', '--json'], { cwd });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw operatorError('Wrangler auth token output was not valid JSON', 'TIKTOK_PRODUCTION_WRANGLER_AUTH_JSON_INVALID');
  }
  const type = requireText(parsed?.type, 'wrangler auth type');
  const token = requireText(parsed?.token, 'wrangler auth token');
  if (!['oauth', 'api_token'].includes(type)) {
    throw operatorError('Wrangler authentication type is not supported for Queue HTTP push', 'TIKTOK_PRODUCTION_WRANGLER_AUTH_TYPE_UNSUPPORTED', {
      type,
    });
  }
  return Object.freeze({ type, token });
}

async function resolveAccount({ apiToken, requestedAccountId }) {
  const body = await cloudflareGet({ apiToken, path: '/accounts?per_page=50' });
  const accounts = Array.isArray(body?.result) ? body.result : [];
  if (requestedAccountId) {
    const requested = accounts.find((account) => account?.id === requestedAccountId.trim());
    if (!requested) {
      throw operatorError('CF_ACCOUNT_ID is not present in the authenticated Wrangler account list', 'TIKTOK_PRODUCTION_WRANGLER_ACCOUNT_MISMATCH', {
        requestedAccountId: requestedAccountId.trim(),
        availableAccounts: accounts.map(summarizeAccount),
      });
    }
    return Object.freeze({ ...requested });
  }
  if (accounts.length !== 1) {
    throw operatorError('Expected exactly one Cloudflare account when CF_ACCOUNT_ID is not set', 'TIKTOK_PRODUCTION_WRANGLER_ACCOUNT_CARDINALITY_MISMATCH', {
      accountCount: accounts.length,
      availableAccounts: accounts.map(summarizeAccount),
    });
  }
  return Object.freeze({ ...accounts[0] });
}

async function resolveQueue({ apiToken, accountId, queueName, requestedQueueId }) {
  const safeAccountId = safeId(accountId, 'Cloudflare account id');
  const body = await cloudflareGet({
    apiToken,
    path: `/accounts/${safeAccountId}/queues?per_page=100`,
  });
  const queues = Array.isArray(body?.result) ? body.result : [];

  if (requestedQueueId) {
    const requested = queues.find((queue) => queue?.queue_id === requestedQueueId.trim() || queue?.id === requestedQueueId.trim());
    if (!requested) {
      throw operatorError('CF_QUEUE_ID is not present in the authenticated account Queue list', 'TIKTOK_PRODUCTION_WRANGLER_QUEUE_ID_MISMATCH', {
        requestedQueueId: requestedQueueId.trim(),
        expectedQueueName: queueName,
        availableQueues: queues.map(summarizeQueue),
      });
    }
    const requestedName = requested.queue_name ?? requested.name ?? null;
    if (requestedName !== queueName) {
      throw operatorError('CF_QUEUE_ID does not point to MKT_MAIN_QUEUE_NAME', 'TIKTOK_PRODUCTION_WRANGLER_QUEUE_NAME_MISMATCH', {
        expectedQueueName: queueName,
        actualQueueName: requestedName,
      });
    }
    return normalizeQueue(requested);
  }

  const matches = queues.filter((queue) => (queue?.queue_name ?? queue?.name) === queueName);
  if (matches.length !== 1) {
    throw operatorError('Expected exactly one Cloudflare Queue matching MKT_MAIN_QUEUE_NAME', 'TIKTOK_PRODUCTION_WRANGLER_QUEUE_CARDINALITY_MISMATCH', {
      expectedQueueName: queueName,
      matchCount: matches.length,
      availableQueues: queues.map(summarizeQueue),
    });
  }
  return normalizeQueue(matches[0]);
}

async function cloudflareGet({ apiToken, path }) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok || body?.success !== true) {
    throw operatorError('Cloudflare API authority discovery failed', 'TIKTOK_PRODUCTION_WRANGLER_AUTHORITY_API_FAILED', {
      status: response.status,
      path,
      errors: Array.isArray(body?.errors)
        ? body.errors.map((item) => ({ code: item?.code ?? null, message: item?.message ?? null }))
        : [],
    });
  }
  return body;
}

async function discoverProductionWorktree(repositoryRoot) {
  const output = run('git', ['-C', repositoryRoot, 'worktree', 'list', '--porcelain']);
  const worktrees = output.stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean);
  const candidates = [];
  for (const worktree of worktrees) {
    const configPath = join(worktree, 'wrangler.sync.jsonc');
    try {
      const configText = await readFile(configPath, 'utf8');
      if (readJsoncScalar(configText, 'name') === TIKTOK_PRODUCTION_RECOVERY.workerName
        && readJsoncScalar(configText, 'MKT_ENV') === 'production'
        && readJsoncScalar(configText, 'MKT_CUSTOMER_PROFILE') === TIKTOK_PRODUCTION_RECOVERY.customerProfile) {
        candidates.push({ worktree, configPath, configText });
      }
    } catch {
      // Ignore non-Production worktrees and worktrees without local config.
    }
  }
  if (candidates.length !== 1) {
    throw operatorError('Expected exactly one isolated customer Production worktree', 'TIKTOK_PRODUCTION_WORKTREE_CARDINALITY_MISMATCH', {
      repositoryRoot,
      productionCandidateCount: candidates.length,
      productionCandidatePaths: candidates.map((candidate) => candidate.worktree),
    });
  }
  return Object.freeze({ repositoryRoot, ...candidates[0] });
}

function normalizeQueue(queue) {
  const id = requireText(queue?.queue_id ?? queue?.id, 'Cloudflare Queue id');
  const queueName = requireText(queue?.queue_name ?? queue?.name, 'Cloudflare Queue name');
  return Object.freeze({ ...queue, id, queue_name: queueName });
}

function summarizeAccount(account) {
  return { id: account?.id ?? null, name: account?.name ?? null };
}

function summarizeQueue(queue) {
  return {
    id: queue?.queue_id ?? queue?.id ?? null,
    name: queue?.queue_name ?? queue?.name ?? null,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw operatorError(`Command failed: ${command} ${args.join(' ')}`, 'TIKTOK_PRODUCTION_WRANGLER_AUTH_COMMAND_FAILED', {
      command,
      args,
      status: result.status,
      stderr: result.stderr?.trim() ?? '',
    });
  }
  return Object.freeze({ stdout: result.stdout?.trim() ?? '' });
}

async function requireReadable(path) {
  try {
    await access(path, constants.R_OK);
  } catch (cause) {
    throw operatorError('Required path is not readable', 'TIKTOK_PRODUCTION_WRANGLER_AUTH_PATH_UNREADABLE', {
      path,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(`${label} is required`, 'TIKTOK_PRODUCTION_WRANGLER_AUTH_VALUE_MISSING', { label });
  }
  return value.trim();
}

function safeId(value, label) {
  const text = requireText(String(value ?? ''), label);
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) {
    throw operatorError(`${label} contains unsafe characters`, 'TIKTOK_PRODUCTION_WRANGLER_AUTH_ID_INVALID', { label });
  }
  return text;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|authorization|credential/iu.test(key)) output[key] = '[REDACTED]';
    else output[key] = sanitize(item);
  }
  return output;
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokProductionWranglerAuthError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
