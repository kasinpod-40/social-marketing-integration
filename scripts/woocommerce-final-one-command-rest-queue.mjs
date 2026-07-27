#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
  resolveWooCommerceQueueId,
} from './lib/woocommerce-final-one-command.js';

const repositoryRoot = resolve(process.cwd());
const CONFIRMATION_NAME = 'CONFIRM_WOOCOMMERCE_FINAL_ROLLOUT';
const CONFIRMATION_VALUE = 'EXECUTE_WOOCOMMERCE_FINAL_ROLLOUT';

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'WOOCOMMERCE_FINAL_QUEUE_DISCOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const execute = process.argv.slice(2).includes('--execute');
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      executed: false,
      command: `${CONFIRMATION_NAME}=${CONFIRMATION_VALUE} node scripts/woocommerce-final-one-command-rest-queue.mjs --execute`,
      queueDiscovery: 'Cloudflare GET /accounts/{account_id}/queues',
      delegatesTo: 'scripts/woocommerce-final-one-command.mjs',
      remoteMutationCount: 0,
    }, null, 2)}\n`);
    return;
  }

  const env = await loadEnvironment();
  requireExact(env[CONFIRMATION_NAME], CONFIRMATION_VALUE, CONFIRMATION_NAME);
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  const configPath = resolveRepositoryFile(
    env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const configText = await readFile(configPath, 'utf8');
  const baseWranglerEnv = compactCloudflareEnv(env);
  const whoamiOutput = wranglerText(['whoami', '--json'], { env: baseWranglerEnv });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    configText,
    whoamiOutput,
    preferredAccount: env.MKT_WOOCOMMERCE_ROLLOUT_ACCOUNT,
  });
  const selectedWranglerEnv = {
    ...baseWranglerEnv,
    CLOUDFLARE_ACCOUNT_ID: accountId,
  };
  wrangler(['whoami', '--account', accountId, '--json'], { env: selectedWranglerEnv });
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: env.CLOUDFLARE_API_TOKEN,
    authOutput: optionalText(env.CLOUDFLARE_API_TOKEN)
      ? null
      : wranglerText(['auth', 'token', '--json'], { env: selectedWranglerEnv }),
  });

  const queueId = optionalText(env.MKT_WOOCOMMERCE_FINAL_QUEUE_ID)
    ?? resolveWooCommerceQueueId(
      await listCloudflareQueues({ accountId, apiToken: auth.token }),
      env.MKT_MAIN_QUEUE_NAME ?? 'social-mkt-sync-jobs',
    );

  const result = spawnSync(
    process.execPath,
    ['scripts/woocommerce-final-one-command.mjs', '--execute'],
    {
      cwd: repositoryRoot,
      env: {
        ...env,
        ...process.env,
        [CONFIRMATION_NAME]: CONFIRMATION_VALUE,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: auth.token,
        MKT_WOOCOMMERCE_FINAL_QUEUE_ID: queueId,
      },
      stdio: 'inherit',
    },
  );
  if (result.error || result.status !== 0) {
    throw commandError(
      'WooCommerce final one-command did not complete successfully',
      'WOOCOMMERCE_FINAL_DELEGATE_FAILED',
      { status: result.status },
    );
  }
}

async function listCloudflareQueues({ accountId, apiToken }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/queues`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw commandError(
      'Cloudflare Queue list returned invalid JSON',
      'WOOCOMMERCE_FINAL_QUEUE_LIST_INVALID',
      { status: response.status, responseSha256: sha256(responseText) },
    );
  }
  if (!response.ok || payload?.success !== true) {
    throw commandError(
      'Cloudflare Queue list API rejected the request',
      'WOOCOMMERCE_FINAL_QUEUE_LIST_API_FAILED',
      {
        status: response.status,
        errorCodes: Array.isArray(payload?.errors)
          ? payload.errors.map((item) => item?.code).filter(Number.isFinite)
          : [],
        responseSha256: sha256(responseText),
      },
    );
  }
  return payload;
}

async function loadEnvironment() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  return Object.freeze({ ...fileEnv, ...process.env });
}

function compactCloudflareEnv(env) {
  const output = { ...env };
  for (const name of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!optionalText(output[name])) delete output[name];
  }
  return output;
}

function wranglerText(args, options = {}) {
  return wrangler(args, options).stdout;
}

function wrangler(args, options = {}) {
  const result = spawnSync('npx', ['wrangler', ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw commandError(
      `npx wrangler ${args.join(' ')} failed`,
      'WOOCOMMERCE_FINAL_WRANGLER_COMMAND_FAILED',
      { status: result.status, stderrSha256: sha256(result.stderr ?? '') },
    );
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, requireText(value, 'configPath'));
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}/`)) {
    throw commandError(
      'Wrangler config path must remain inside Repository',
      'WOOCOMMERCE_FINAL_PATH_INVALID',
    );
  }
  return path;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw commandError(
      `${fieldName} must equal ${expected}`,
      'WOOCOMMERCE_FINAL_TARGET_INVALID',
      { fieldName, expected },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw commandError(
      `${fieldName} is required`,
      'WOOCOMMERCE_FINAL_ONE_COMMAND_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:secret|token|password|authorization|consumer_key|consumer_secret)/iu.test(key)) {
      continue;
    }
    output[key] = sanitize(nested);
  }
  return output;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function commandError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceFinalQueueDiscoveryError';
  error.code = code;
  error.details = details;
  return error;
}
