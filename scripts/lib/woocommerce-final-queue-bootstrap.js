import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';
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

  const explicitApiToken = optionalText(env.CLOUDFLARE_API_TOKEN);
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken,
    authOutput: explicitApiToken
      ? null
      : runWrangler(['auth', 'token', '--json'], baseWranglerEnv),
  });
  const authenticatedWranglerEnv = {
    ...baseWranglerEnv,
    CLOUDFLARE_API_TOKEN: auth.token,
  };
  delete authenticatedWranglerEnv.CLOUDFLARE_API_KEY;
  delete authenticatedWranglerEnv.CLOUDFLARE_EMAIL;

  const configuredAccount = resolveConfiguredAccountId({ env, configText });
  const accountId = configuredAccount?.accountId ?? resolveCloudflareAccountId({
    configText,
    whoamiOutput: runWrangler(['whoami', '--json'], authenticatedWranglerEnv),
    preferredAccount: env.MKT_WOOCOMMERCE_ROLLOUT_ACCOUNT,
  });
  const accountSource = configuredAccount?.source ?? 'wrangler_whoami';

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
    accountSource,
    authType: auth.type,
    authSource: auth.source,
    providerRequests: 1,
  });
}

function resolveConfiguredAccountId({ env, configText }) {
  const explicitAccountId = optionalText(env.CLOUDFLARE_ACCOUNT_ID);
  if (explicitAccountId) {
    return Object.freeze({
      accountId: resolveCloudflareAccountId({ explicitAccountId }),
      source: 'explicit_environment',
    });
  }

  const config = parseJsoncObject(configText);
  const configuredAccountId = optionalText(config.account_id);
  if (!configuredAccountId) return null;
  return Object.freeze({
    accountId: resolveCloudflareAccountId({ configText }),
    source: 'wrangler_config',
  });
}

function createWranglerRunner(repositoryRoot) {
  const executable = join(
    repositoryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
  );
  return (args, env) => {
    const result = spawnSync(
      executable,
      args,
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
        'Pinned Wrangler authentication command failed during Queue bootstrap',
        'WOOCOMMERCE_FINAL_QUEUE_BOOTSTRAP_WRANGLER_FAILED',
        {
          command: args.slice(0, 2).join(' '),
          status: result.status ?? 1,
          errorCode: result.error?.code ?? null,
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
