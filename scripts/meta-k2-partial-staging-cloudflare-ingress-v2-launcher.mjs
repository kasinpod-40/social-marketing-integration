#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import {
  parseMetaK2AccountZones,
  parseMetaK2WorkerDomains,
  parseMetaK2WorkerRoutes,
  selectMetaK2CloudflareIngressAuthority,
} from './lib/meta-k2-cloudflare-ingress-authority.js';
import {
  resolveMetaK2CloudflarePagination,
} from './lib/meta-k2-cloudflare-pagination.js';
import {
  resolveMetaK2ExactRecoveryUrl,
} from './lib/meta-k2-partial-staging-reviewed-launcher.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import {
  META_K2_EXACT_RECOVERY_PATH,
} from '../packages/config/src/meta-k2-exact-recovery-contract.js';

const repositoryRoot = realpathSync.native(process.cwd());
const reviewedLauncher = resolve(
  repositoryRoot,
  'scripts/meta-k2-partial-staging-reviewed-launcher.mjs',
);
const workerName = 'social-mkt-sync-worker';

const execute = parseArgs(process.argv.slice(2));
if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    authorityOrder: [
      'cloudflare_worker_domains',
      'cloudflare_zone_worker_routes',
    ],
    cloudflareMethods: ['GET'],
    paginationContract: 'optional_result_info_v1',
    safeRouteProbeOwnedByReviewedLauncher: true,
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

  currentStage = 'load-wrangler-config';
  const configPath = await resolveRepositoryFile(
    process.env.MKT_META_K2_RECOVERY_BASE_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
    'MKT_META_K2_RECOVERY_BASE_WRANGLER_CONFIG',
  );
  const configText = await readFile(configPath, 'utf8');

  currentStage = 'resolve-cloudflare-auth';
  const authEnv = cleanCloudflareEnvironment(mergedEnv);
  const whoami = runText('npx', ['wrangler', 'whoami', '--json'], authEnv);
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: authEnv.CLOUDFLARE_ACCOUNT_ID,
    configText,
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

  currentStage = 'read-cloudflare-worker-domains';
  let cloudflareRequestCount = 0;
  const domainsPayload = await fetchCloudflarePages(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/domains`,
    auth.token,
    { service: workerName },
  );
  cloudflareRequestCount += domainsPayload.requestCount;
  const domains = parseMetaK2WorkerDomains(domainsPayload.payload, workerName);

  let routes = Object.freeze({ origins: [], zoneCount: 0, inspectedCount: 0 });
  if (domains.origins.length === 0) {
    currentStage = 'read-cloudflare-zones';
    const zonesPayload = await fetchCloudflarePages(
      'https://api.cloudflare.com/client/v4/zones',
      auth.token,
      { 'account.id': accountId, status: 'active' },
    );
    cloudflareRequestCount += zonesPayload.requestCount;
    const zones = parseMetaK2AccountZones(zonesPayload.payload);
    if (zones.zones.length > 100) {
      throw launcherError(
        'Cloudflare zone inventory is too large for bounded Meta K2 ingress discovery',
        'META_K2_CLOUDFLARE_RECOVERY_ZONE_BOUND_EXCEEDED',
        { zoneCount: zones.zones.length },
      );
    }

    currentStage = 'read-cloudflare-worker-routes';
    const routeOrigins = [];
    let inspectedCount = 0;
    for (const zone of zones.zones) {
      const routePayload = await fetchCloudflarePages(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone.id)}/workers/routes`,
        auth.token,
      );
      cloudflareRequestCount += routePayload.requestCount;
      const parsed = parseMetaK2WorkerRoutes(routePayload.payload, workerName);
      routeOrigins.push(...parsed.origins);
      inspectedCount += parsed.inspectedCount;
    }
    routes = Object.freeze({
      origins: Object.freeze([...new Set(routeOrigins)].sort()),
      zoneCount: zones.zones.length,
      inspectedCount,
    });
  }

  currentStage = 'resolve-recovery-authority';
  const ingress = selectMetaK2CloudflareIngressAuthority({
    domainOrigins: domains.origins,
    routeOrigins: routes.origins,
  });
  const exactUrl = new URL(
    META_K2_EXACT_RECOVERY_PATH,
    ingress.origin,
  ).toString();
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
    authoritySource: ingress.source,
    domainMatchingCount: domains.matchingCount,
    domainOriginCount: ingress.domainOriginCount,
    routeZoneCount: routes.zoneCount,
    routeInspectedCount: routes.inspectedCount,
    routeOriginCount: ingress.routeOriginCount,
    cloudflareRequestCount,
    recoveryOriginFingerprint: sha256(new URL(reviewedUrl).origin),
    rawOriginPrinted: false,
    remoteMutationCount: 0,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);

  currentStage = 'run-reviewed-launcher';
  const child = spawnSync(process.execPath, [reviewedLauncher, '--execute'], {
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
    throw launcherError(
      'Reviewed Meta K2 launcher failed',
      'META_K2_CLOUDFLARE_INGRESS_CHILD_FAILED',
      { exitCode: child.status },
    );
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_K2_CLOUDFLARE_INGRESS_LAUNCHER_FAILED',
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

async function fetchCloudflarePages(baseUrl, bearerToken, query = {}) {
  const result = [];
  let requestCount = 0;
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    if (page > 20) {
      throw launcherError(
        'Cloudflare pagination exceeded the bounded Meta K2 ingress limit',
        'META_K2_CLOUDFLARE_RECOVERY_PAGE_BOUND_EXCEEDED',
      );
    }
    const url = new URL(baseUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${bearerToken}`,
        accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    requestCount += 1;
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true || !Array.isArray(body?.result)) {
      throw launcherError(
        `Cloudflare ingress read failed with HTTP ${response.status}`,
        'META_K2_CLOUDFLARE_RECOVERY_READ_FAILED',
        {
          httpStatus: response.status,
          errorCodes: readErrorCodes(body),
          requestCount,
        },
      );
    }
    result.push(...body.result);
    totalPages = resolveMetaK2CloudflarePagination({
      resultInfo: body.result_info,
      resultCount: body.result.length,
      requestedPage: page,
      requestedPageSize: 100,
      maxPages: 20,
    }).totalPages;
  }
  return Object.freeze({
    payload: Object.freeze({ success: true, result: Object.freeze(result) }),
    requestCount,
  });
}

function cleanCloudflareEnvironment(env) {
  const output = { ...env };
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!String(output[key] ?? '').trim()) delete output[key];
  }
  return output;
}

function runText(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw launcherError(
      `${command} command failed during Cloudflare ingress resolution`,
      'META_K2_CLOUDFLARE_INGRESS_COMMAND_FAILED',
      { command, exitCode: result.status ?? null },
    );
  }
  return String(result.stdout ?? '').trim();
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw launcherError(
      'Unsupported Meta K2 Cloudflare ingress launcher argument',
      'META_K2_CLOUDFLARE_INGRESS_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

async function resolveRepositoryFile(value, fieldName) {
  const input = requireText(value, fieldName);
  const candidate = resolve(repositoryRoot, input);
  const canonical = await realpath(candidate);
  if (canonical !== repositoryRoot && !canonical.startsWith(`${repositoryRoot}/`)) {
    throw launcherError(
      `${fieldName} must resolve inside the Repository`,
      'META_K2_CLOUDFLARE_INGRESS_PATH_INVALID',
      { fieldName },
    );
  }
  const valueStat = await stat(canonical);
  if (!valueStat.isFile()) {
    throw launcherError(
      `${fieldName} must be a regular file`,
      'META_K2_CLOUDFLARE_INGRESS_FILE_INVALID',
      { fieldName },
    );
  }
  return canonical;
}

async function assertPrivateFile(path, fieldName) {
  const value = await stat(path);
  if ((value.mode & 0o077) !== 0) {
    throw launcherError(
      `${fieldName} must not be readable by group or others`,
      'META_K2_CLOUDFLARE_INGRESS_PRIVATE_FILE_INVALID',
      { fieldName },
    );
  }
}

function readErrorCodes(body) {
  return Array.isArray(body?.errors)
    ? body.errors
      .map((entry) => entry?.code ?? null)
      .filter((value) => value !== null)
    : [];
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|authorization|account|zone|hostname|origin|url|secret|credential/iu.test(key)) {
      continue;
    }
    output[key] = sanitize(nested);
  }
  return output;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw launcherError(
      `${fieldName} is required`,
      'META_K2_CLOUDFLARE_INGRESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function launcherError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK2CloudflareIngressLauncherError';
  error.code = code;
  error.details = details;
  return error;
}
