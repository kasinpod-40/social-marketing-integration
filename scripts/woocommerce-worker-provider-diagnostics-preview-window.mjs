#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import {
  assertWooCommercePreviewUrlActive,
  assertWooCommercePreviewUrlBaseline,
  assertWooCommercePreviewUrlRestored,
  buildWooCommercePreviewUrlMutation,
  parseWooCommercePreviewUrlState,
} from './lib/woocommerce-preview-url-window.js';

const repositoryRoot = resolve(process.cwd());
const workerNameDefault = 'social-mkt-sync-worker';
const confirmation = Object.freeze({
  envName: 'CONFIRM_WOOCOMMERCE_PREVIEW_URL_WINDOW',
  value: 'OPEN_AND_RESTORE_WOOCOMMERCE_PREVIEW_URLS',
});
const diagnosticConfirmation = Object.freeze({
  envName: 'CONFIRM_WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS',
  value: 'RUN_WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS',
});

let target = null;
let baseline = null;
let previewMutationAttempted = false;
let previewSettingMutationAttemptCount = 0;
let previewSettingMutationCount = 0;
let diagnosticExitStatus = null;
let primaryError = null;
let restoreError = null;
let restored = false;

try {
  await main();
} catch (error) {
  primaryError = error;
} finally {
  if (previewMutationAttempted && target && baseline) {
    try {
      await restorePreviewUrls();
      restored = true;
    } catch (error) {
      restoreError = error;
    }
  }
}

if (primaryError || restoreError || diagnosticExitStatus !== 0) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'woocommerce-worker-provider-diagnostics-preview-window',
    code: restoreError?.code
      ?? primaryError?.code
      ?? 'WOOCOMMERCE_PREVIEW_URL_WINDOW_DIAGNOSTIC_FAILED',
    message: restoreError instanceof Error
      ? restoreError.message
      : primaryError instanceof Error
        ? primaryError.message
        : 'WooCommerce Preview diagnostics did not complete successfully',
    diagnosticExitStatus,
    previewUrlsRestored: restored,
    workersDevRestoredDisabled: restored,
    previewSettingMutationAttemptCount,
    previewSettingMutationCount,
    productionTrafficChange: false,
    tokenPrinted: false,
    details: sanitize(restoreError?.details ?? primaryError?.details ?? {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-worker-provider-diagnostics-preview-window',
    diagnosticExitStatus,
    previewUrlsRestored: true,
    workersDevRestoredDisabled: true,
    previewSettingMutationAttemptCount,
    previewSettingMutationCount,
    productionTrafficChange: false,
    tokenPrinted: false,
  }, null, 2)}\n`);
}

async function main() {
  assertConfirmation(process.env, confirmation);
  assertConfirmation(process.env, diagnosticConfirmation);
  assertCleanMain();

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const baseEnv = { ...fileEnv, ...process.env };
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!String(baseEnv[key] ?? '').trim()) delete baseEnv[key];
  }

  const configPath = resolve(
    repositoryRoot,
    baseEnv.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const configText = await readFile(configPath, 'utf8');
  const whoami = runText('npx', ['wrangler', 'whoami', '--json'], { env: baseEnv });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: baseEnv.CLOUDFLARE_ACCOUNT_ID,
    configText,
    whoamiOutput: whoami,
  });
  const selectedEnv = { ...baseEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
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
  const workerName = selectedEnv.MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME ?? workerNameDefault;
  requireWorkerName(workerName);

  target = Object.freeze({
    accountId,
    token: auth.token,
    workerName,
    childEnv: selectedEnv,
  });
  baseline = assertWooCommercePreviewUrlBaseline(await readPreviewUrlState('baseline'));

  previewMutationAttempted = true;
  previewSettingMutationAttemptCount += 1;
  const enabled = await writePreviewUrlState(true, 'enable');
  assertWooCommercePreviewUrlActive(enabled);
  previewSettingMutationCount += 1;
  await waitForExactState(assertWooCommercePreviewUrlActive, 'enable-readback');

  const child = spawnSync(
    process.execPath,
    ['scripts/woocommerce-worker-provider-diagnostics-ephemeral.mjs', '--execute'],
    {
      cwd: repositoryRoot,
      env: target.childEnv,
      stdio: 'inherit',
    },
  );
  if (child.error) {
    throw windowError(
      'WooCommerce diagnostics child process could not start',
      'WOOCOMMERCE_PREVIEW_URL_WINDOW_CHILD_START_FAILED',
    );
  }
  diagnosticExitStatus = child.status ?? 1;
}

async function restorePreviewUrls() {
  previewSettingMutationAttemptCount += 1;
  const restoredState = await writePreviewUrlState(false, 'restore');
  assertWooCommercePreviewUrlRestored(restoredState);
  previewSettingMutationCount += 1;
  await waitForExactState(assertWooCommercePreviewUrlRestored, 'restore-readback');
}

async function readPreviewUrlState(label) {
  const response = await fetch(subdomainEndpoint(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${target.token}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw windowError(
      `Cloudflare Worker subdomain read failed during ${label} (HTTP ${response.status})`,
      'WOOCOMMERCE_PREVIEW_URL_WINDOW_READ_FAILED',
      { label, httpStatus: response.status, errorCodes: readErrorCodes(body) },
    );
  }
  return parseWooCommercePreviewUrlState(body, label);
}

async function writePreviewUrlState(previewsEnabled, label) {
  const response = await fetch(subdomainEndpoint(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.token}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildWooCommercePreviewUrlMutation(previewsEnabled)),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw windowError(
      `Cloudflare Worker subdomain mutation failed during ${label} (HTTP ${response.status})`,
      label === 'restore'
        ? 'WOOCOMMERCE_PREVIEW_URL_WINDOW_RESTORE_FAILED'
        : 'WOOCOMMERCE_PREVIEW_URL_WINDOW_ENABLE_FAILED',
      { label, httpStatus: response.status, errorCodes: readErrorCodes(body) },
    );
  }
  return parseWooCommercePreviewUrlState(body, label);
}

async function waitForExactState(assertion, label) {
  const delays = [0, 500, 1_000, 2_000, 3_000];
  let lastError = null;
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    try {
      return assertion(await readPreviewUrlState(label));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? windowError(
    `Cloudflare Worker subdomain state did not converge during ${label}`,
    'WOOCOMMERCE_PREVIEW_URL_WINDOW_STATE_UNSTABLE',
    { label },
  );
}

function subdomainEndpoint() {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.accountId)}`
    + `/workers/scripts/${encodeURIComponent(target.workerName)}/subdomain`;
}

function assertCleanMain() {
  const branch = runText('git', ['branch', '--show-current']).trim();
  const head = runText('git', ['rev-parse', 'HEAD']).trim();
  const dirty = runText('git', ['status', '--porcelain', '--untracked-files=all']).trim();
  if (branch !== 'main' || dirty !== '' || !/^[0-9a-f]{40}$/u.test(head)) {
    throw windowError(
      'WooCommerce Preview URL window requires clean main',
      'WOOCOMMERCE_PREVIEW_URL_WINDOW_REPOSITORY_INVALID',
      { branch, head, clean: dirty === '' },
    );
  }
}

function assertConfirmation(env, expected) {
  if (env[expected.envName] !== expected.value) {
    throw windowError(
      `WooCommerce Preview URL window requires ${expected.envName}=${expected.value}`,
      'WOOCOMMERCE_PREVIEW_URL_WINDOW_CONFIRMATION_REQUIRED',
      { envName: expected.envName },
    );
  }
}

function requireWorkerName(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(value)) {
    throw windowError(
      'Worker name is invalid',
      'WOOCOMMERCE_PREVIEW_URL_WINDOW_TARGET_INVALID',
    );
  }
  return value;
}

function readErrorCodes(body) {
  return Array.isArray(body?.errors)
    ? body.errors.map((item) => item?.code ?? null).filter((value) => value !== null)
    : [];
}

function runText(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: repositoryRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw windowError(
      `${file} command failed during Preview URL window preflight`,
      'WOOCOMMERCE_PREVIEW_URL_WINDOW_COMMAND_FAILED',
      {
        command: `${file} ${args.slice(0, 5).join(' ')}`,
        status: result.status ?? null,
      },
    );
  }
  return String(result.stdout ?? '').trim();
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|authorization|accountId|url|credential|secret/iu.test(key)) continue;
    output[key] = sanitize(nested);
  }
  return output;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function windowError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommercePreviewUrlWindowOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
