#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import {
  resolveMetaK2ExactRecoveryUrl,
} from './lib/meta-k2-partial-staging-reviewed-launcher.js';
import {
  buildMetaK2WorkersDevOrigin,
  resolveMetaK2WranglerOriginAuthority,
} from './lib/meta-k2-recovery-origin-authority.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import {
  readAccountWorkersDevSubdomain,
} from './woocommerce-worker-provider-diagnostics-preview-window.mjs';
import {
  META_K2_EXACT_RECOVERY_PATH,
} from '../packages/config/src/meta-k2-exact-recovery-contract.js';

const repositoryRoot = realpathSync.native(process.cwd());
const childLauncher = resolve(
  repositoryRoot,
  'scripts/meta-k2-partial-staging-reviewed-launcher.mjs',
);

const execute = parseArgs(process.argv.slice(2));
if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    launcher: relative(repositoryRoot, childLauncher),
    authorityOrder: [
      'wrangler_exact_route',
      'cloudflare_workers_dev_when_explicitly_enabled',
    ],
    cloudflareLookupMethod: 'GET',
    safeRouteProbeOwnedByChildBeforeArchiveOrDeployment: true,
    rawOriginPrinted: false,
    remoteMutationPerformed: false,
    executeArgument: '--execute',
  }, null, 2)}\n`);
  process.exit(0);
}

let currentStage = 'init';
try {
  currentStage = 'load-private-environment';
  const devVarsPath = await resolveRepositoryFile(
    process.env.DEV_VARS_FILE ?? '.dev.vars',
    'DEV_VARS_FILE',
  );
  await assertPrivateFile(devVarsPath, 'DEV_VARS_FILE');
  const devVars = await readDevVars(devVarsPath);
  const mergedEnv = { ...devVars, ...process.env };

  currentStage = 'load-wrangler-authority';
  const configPath = await resolveRepositoryFile(
    process.env.MKT_META_K2_RECOVERY_BASE_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
    'MKT_META_K2_RECOVERY_BASE_WRANGLER_CONFIG',
  );
  const configText = await readFile(configPath, 'utf8');
  const wranglerAuthority = resolveMetaK2WranglerOriginAuthority(configText);

  currentStage = 'resolve-recovery-authority';
  const originResolution = wranglerAuthority.routeOrigin
    ? Object.freeze({
      origin: wranglerAuthority.routeOrigin,
      source: 'wrangler_exact_route',
      cloudflareRequestCount: 0,
    })
    : await resolveWorkersDevAuthority({
      authority: wranglerAuthority,
      configText,
      env: mergedEnv,
    });

  const exactUrl = new URL(META_K2_EXACT_RECOVERY_PATH, originResolution.origin).toString();
  const reviewedUrl = resolveMetaK2ExactRecoveryUrl({
    explicitUrl: exactUrl,
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

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'resolve-recovery-authority',
    authoritySource: originResolution.source,
    routeEntryCount: wranglerAuthority.routeEntryCount,
    matchingRouteCount: wranglerAuthority.matchingRouteCount,
    workersDevEnabled: wranglerAuthority.workersDevEnabled,
    cloudflareRequestCount: originResolution.cloudflareRequestCount,
    recoveryOriginFingerprint: sha256(new URL(reviewedUrl).origin),
    rawOriginPrinted: false,
    remoteMutationCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);

  currentStage = 'run-reviewed-launcher';
  const child = spawnSync(process.execPath, [childLauncher, '--execute'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DEV_VARS_FILE: devVarsPath,
      MKT_META_K2_RECOVERY_BASE_WRANGLER_CONFIG: configPath,
      MKT_META_K2_EXACT_RECOVERY_URL: reviewedUrl,
    },
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    const error = new Error('Reviewed Meta K2 launcher failed');
    error.code = 'META_K2_AUTHORITY_LAUNCHER_CHILD_FAILED';
    error.details = { exitCode: child.status };
    throw error;
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_K2_AUTHORITY_LAUNCHER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    rawOriginPrinted: false,
    remoteMutationCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function resolveWorkersDevAuthority(input) {
  if (input.authority.workersDevEnabled !== true) {
    const error = new Error(
      'Wrangler config has no exact route for the recovery path and workers_dev is not explicitly enabled',
    );
    error.code = 'META_K2_WRANGLER_RECOVERY_ORIGIN_UNAVAILABLE';
    error.details = {
      routeEntryCount: input.authority.routeEntryCount,
      matchingRouteCount: input.authority.matchingRouteCount,
      workersDevEnabled: input.authority.workersDevEnabled,
    };
    throw error;
  }

  const authEnv = { ...input.env };
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!String(authEnv[key] ?? '').trim()) delete authEnv[key];
  }

  const whoami = runText('npx', ['wrangler', 'whoami', '--json'], authEnv);
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: authEnv.CLOUDFLARE_ACCOUNT_ID,
    configText: input.configText,
    whoamiOutput: whoami,
  });
  const selectedEnv = { ...authEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
  runText(
    'npx',
    ['wrangler', 'whoami', '--account', accountId, '--json'],
    selectedEnv,
  );
  const authOutput = selectedEnv.CLOUDFLARE_API_TOKEN
    ? null
    : runText('npx', ['wrangler', 'auth', 'token', '--json'], selectedEnv);
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: selectedEnv.CLOUDFLARE_API_TOKEN,
    authOutput,
  });
  const accountSubdomain = await readAccountWorkersDevSubdomain({
    accountId,
    bearerToken: auth.token,
  });
  return Object.freeze({
    origin: buildMetaK2WorkersDevOrigin(
      input.authority.workerName,
      accountSubdomain,
    ),
    source: 'cloudflare_workers_dev',
    cloudflareRequestCount: 1,
  });
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    const error = new Error('Unsupported Meta K2 authority launcher argument');
    error.code = 'META_K2_AUTHORITY_LAUNCHER_ARGUMENT_INVALID';
    error.details = { unknown };
    throw error;
  }
  return args.includes('--execute');
}

function runText(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const error = new Error(`${command} command failed during Meta K2 authority resolution`);
    error.code = 'META_K2_AUTHORITY_LAUNCHER_COMMAND_FAILED';
    error.details = {
      command,
      exitCode: result.status ?? null,
      stderrSha256: sha256(result.stderr ?? ''),
    };
    throw error;
  }
  return String(result.stdout ?? '').trim();
}

async function resolveRepositoryFile(value, fieldName) {
  const input = requireText(value, fieldName);
  const candidate = resolve(repositoryRoot, input);
  const canonical = await realpath(candidate);
  if (canonical !== repositoryRoot && !canonical.startsWith(`${repositoryRoot}/`)) {
    const error = new Error(`${fieldName} must resolve inside the Repository`);
    error.code = 'META_K2_AUTHORITY_LAUNCHER_PATH_INVALID';
    error.details = { fieldName };
    throw error;
  }
  const valueStat = await stat(canonical);
  if (!valueStat.isFile()) {
    const error = new Error(`${fieldName} must be a regular file`);
    error.code = 'META_K2_AUTHORITY_LAUNCHER_FILE_INVALID';
    error.details = { fieldName };
    throw error;
  }
  return canonical;
}

async function assertPrivateFile(path, fieldName) {
  const valueStat = await stat(path);
  if ((valueStat.mode & 0o077) !== 0) {
    const error = new Error(`${fieldName} must not be readable by group or others`);
    error.code = 'META_K2_AUTHORITY_LAUNCHER_PRIVATE_FILE_INVALID';
    error.details = { fieldName };
    throw error;
  }
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|authorization|accountId|subdomain|origin|url|credential|secret/iu.test(key)) {
      continue;
    }
    output[key] = sanitize(nested);
  }
  return output;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${fieldName} is required`);
    error.code = 'META_K2_AUTHORITY_LAUNCHER_INPUT_INVALID';
    error.details = { fieldName };
    throw error;
  }
  return value.trim();
}
