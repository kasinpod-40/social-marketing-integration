import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './woocommerce-final-one-command.js';
import { discoverWooCommerceQueueId } from './woocommerce-final-queue-discovery.js';

export async function bootstrapWooCommerceFinalQueueId(input = {}) {
  const env = input.env ?? process.env;
  const repositoryRoot = resolve(input.repositoryRoot ?? process.cwd());
  const queueName = optionalText(env.MKT_MAIN_QUEUE_NAME) ?? 'social-mkt-sync-jobs';
  const existingQueueId = optionalText(env.MKT_WOOCOMMERCE_FINAL_QUEUE_ID);
  if (existingQueueId) {
    return Object.freeze({
      queueId: existingQueueId,
      source: 'explicit_environment',
      queueIdFingerprint: sha256(existingQueueId),
      providerRequests: 0,
    });
  }

  const configPath = resolve(
    repositoryRoot,
    optionalText(env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG)
      ?? 'wrangler.sync.jsonc',
  );
  const configText = await readFile(configPath, 'utf8');
  const runWrangler = input.runWrangler ?? createWranglerRunner(repositoryRoot);
  const baseWranglerEnv = compactCloudflareEnv(env);
  const whoamiOutput = runWrangler(['whoami', '--json'], baseWranglerEnv);
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
  runWrangler(
    ['whoami', '--account', accountId, '--json'],
    selectedWranglerEnv,
  );

  const explicitApiToken = optionalText(env.CLOUDFLARE_API_TOKEN);
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken,
    authOutput: explicitApiToken
      ? null
      : runWrangler(['auth', 'token', '--json'], selectedWranglerEnv),
  });
  const queueId = await discoverWooCommerceQueueId({
    accountId,
    apiToken: auth.token,
    queueName,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });

  env.MKT_WOOCOMMERCE_FINAL_QUEUE_ID = queueId;
  return Object.freeze({
    queueId,
    source: 'cloudflare_queue_rest',
    queueIdFingerprint: sha256(queueId),
    authType: auth.type,
    authSource: auth.source,
    providerRequests: 1,
  });
}

function createWranglerRunner(repositoryRoot) {
  return (args, env) => {
    const result = spawnSync(
      'npx',
      ['wrangler', ...args],
      {
        cwd: repositoryRoot,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (result.error || result.status !== 0) {
      throw bootstrapError(
        'Wrangler authentication command failed during Queue bootstrap',
        'WOOCOMMERCE_FINAL_QUEUE_BOOTSTRAP_WRANGLER_FAILED',
        {
          command: args.slice(0, 2).join(' '),
          status: result.status ?? 1,
          stderrSha256: sha256(result.stderr ?? ''),
        },
      );
    }
    return result.stdout ?? '';
  };
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

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function sha256(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function bootstrapError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceFinalQueueBootstrapError';
  error.code = code;
  error.details = details;
  return error;
}
