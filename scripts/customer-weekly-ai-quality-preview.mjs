#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { resolveCloudflareBearerAuth } from './lib/woocommerce-final-one-command.js';
import { parseWooCommerceDiagnosticsPreviewUpload } from './lib/woocommerce-diagnostics-preview-upload.js';
import {
  assertWooCommercePreviewUrlActive,
  assertWooCommercePreviewUrlBaseline,
  assertWooCommercePreviewUrlRestored,
  buildWooCommercePreviewUrlMutation,
  parseWooCommercePreviewUrlState,
} from './lib/woocommerce-preview-url-window.js';

const ACCOUNT_ID = '154f6bf72740d29d7453cec7fb800d32';
const WORKER = 'social-mkt-sync-worker';
const DATABASE = 'social-mkt-state-prod';
const DATABASE_ID = 'f03ab092-a1aa-4478-8ba2-c20d7b54851f';
const CLOUDFLARE_PROFILE = 'chemistry-k-prod';
const CUSTOMER_PROFILE = 'chemistry_k';
const AI_TABLE_ID = 'tblM96oQuMoN2E5v';
const WORK_KEY = 'lark_notification:weekly-executive-auto-20260913';
const PERIOD_END = '2026-09-13';
const PREVIEW_ENTRYPOINT = resolve(
  'apps/sync-worker/src/customer-weekly-ai-quality-preview-entry.js',
);
const PREVIEW_PATH = '/__codex/customer-weekly-ai-quality-v1';
const CONFIG_PATH = resolve(
  process.env.MKT_CUSTOMER_WRANGLER_CONFIG ?? '.customer-youtube-uat.wrangler.jsonc',
);

let runtimeRoot = null;
let target = null;
let previewWindowOpened = false;
let primaryError = null;
let restoreError = null;

try {
  await main();
} catch (error) {
  primaryError = error;
} finally {
  if (target && previewWindowOpened) {
    try {
      await writePreviewState(false, 'restore');
      assertWooCommercePreviewUrlRestored(await waitForPreviewState('restore-readback'));
      await assertProductionVersionUnchanged();
    } catch (error) {
      restoreError = error;
    }
  }
  if (runtimeRoot) await rm(runtimeRoot, { recursive: true, force: true });
}

if (primaryError || restoreError) {
  const error = restoreError ?? primaryError;
  console.error(JSON.stringify({
    ok: false,
    code: error?.code ?? 'CUSTOMER_WEEKLY_AI_QUALITY_PREVIEW_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    previewUrlsRestored: restoreError === null && previewWindowOpened,
    productionTrafficChanged: false,
  }));
  process.exitCode = 1;
}

async function main() {
  const config = parseJsoncObject(await readFile(CONFIG_PATH, 'utf8'));
  const binding = (config.d1_databases ?? []).filter((entry) => entry?.binding === 'MKT_STATE_DB');
  requireExact(config.name, WORKER, 'Worker name');
  requireExact(config.account_id, ACCOUNT_ID, 'Cloudflare account');
  if (binding.length !== 1) throw operatorError('Expected one D1 binding', 'CUSTOMER_WEEKLY_AI_D1_INVALID');
  requireExact(binding[0].database_name, DATABASE, 'D1 database');
  requireExact(binding[0].database_id, DATABASE_ID, 'D1 database ID');
  requireExact(config.vars?.MKT_ENV, 'production', 'MKT_ENV');
  requireExact(config.vars?.MKT_CUSTOMER_PROFILE, CUSTOMER_PROFILE, 'MKT_CUSTOMER_PROFILE');
  requireExact(config.vars?.LARK_TABLE_MKT_AI_REPORT_RUNS, AI_TABLE_ID, 'AI table');

  const privateEnv = await readDevVars(resolve(process.env.DEV_VARS_FILE ?? '.dev.vars'));
  const commandEnv = { ...process.env, ...privateEnv };
  const authOutput = commandEnv.CLOUDFLARE_API_TOKEN
    ? null
    : runText('npx', ['wrangler', 'auth', 'token', '--json', '--profile', CLOUDFLARE_PROFILE], commandEnv);
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: commandEnv.CLOUDFLARE_API_TOKEN,
    authOutput,
  });
  const accountSubdomain = await readAccountSubdomain(auth.token);
  const productionBaselineVersion = readActiveVersion(commandEnv);
  const token = randomBytes(48).toString('base64url');
  const previewAlias = `weekly-ai-quality-${randomBytes(4).toString('hex')}`;

  runtimeRoot = await mkdtemp(join(tmpdir(), 'customer-weekly-ai-quality-'));
  const runtimeConfigPath = join(runtimeRoot, 'wrangler.preview.json');
  const runtimeConfig = buildPreviewConfig(config, sha256(token));
  await writeFile(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, { mode: 0o600 });
  await chmod(runtimeConfigPath, 0o600);
  target = Object.freeze({ token: auth.token, commandEnv, productionBaselineVersion });

  assertWooCommercePreviewUrlBaseline(await readPreviewState('baseline'));
  await writePreviewState(true, 'enable');
  previewWindowOpened = true;
  assertWooCommercePreviewUrlActive(await waitForPreviewState('enable-readback'));

  const outputPath = join(runtimeRoot, 'wrangler.ndjson');
  const stdout = runText('npx', [
    '--no-install', 'wrangler', 'versions', 'upload',
    '--config', runtimeConfigPath,
    '--profile', CLOUDFLARE_PROFILE,
    '--preview-alias', previewAlias,
    '--message', `Weekly AI read-only quality diagnosis git=${git(['rev-parse', 'HEAD'])}`,
  ], { ...commandEnv, WRANGLER_OUTPUT_FILE_PATH: outputPath });
  const upload = parseWooCommerceDiagnosticsPreviewUpload(
    await readFile(outputPath, 'utf8').catch(() => ''),
    stdout,
    { previewAlias, workerName: WORKER, accountWorkersDevSubdomain: accountSubdomain },
  );
  await assertProductionVersionUnchanged();

  const url = new URL(PREVIEW_PATH, `${upload.previewOrigin}/`);
  await waitForRoute(url);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({ mode: 'diagnose', workKey: WORK_KEY, periodEnd: PERIOD_END }),
    redirect: 'error',
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    throw operatorError(
      `Preview diagnosis failed with HTTP ${response.status}`,
      body?.code ?? 'CUSTOMER_WEEKLY_AI_QUALITY_HTTP_FAILED',
      body?.details ?? {},
    );
  }
  await assertProductionVersionUnchanged();
  console.log(JSON.stringify({
    ok: true,
    executionTransport: 'isolated_preview_version',
    previewVersion: upload.versionId,
    productionBaselineVersion,
    productionTrafficChanged: false,
    result: body.result,
  }, null, 2));
}

function buildPreviewConfig(input, tokenSha256) {
  const config = structuredClone(input);
  config.main = PREVIEW_ENTRYPOINT;
  config.workers_dev = false;
  config.preview_urls = true;
  config.vars = {
    ...config.vars,
    MKT_WEEKLY_AI_QUALITY_PREVIEW_TOKEN_SHA256: tokenSha256,
  };
  for (const name of Object.keys(config.vars)) {
    if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)) config.vars[name] = 'false';
  }
  delete config.route;
  delete config.routes;
  delete config.triggers;
  delete config.queues;
  delete config.assets;
  delete config.env;
  if (config.name !== WORKER || config.account_id !== ACCOUNT_ID
      || config.workers_dev !== false || config.preview_urls !== true
      || config.main !== PREVIEW_ENTRYPOINT || config.routes || config.triggers || config.queues) {
    throw operatorError('Generated Preview config is not isolated', 'CUSTOMER_WEEKLY_AI_PREVIEW_CONFIG_INVALID');
  }
  return config;
}

async function waitForRoute(url) {
  let lastStatus = 0;
  for (const delay of [0, 500, 1_000, 2_000, 3_000, 5_000]) {
    if (delay) await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
    const response = await fetch(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    lastStatus = response.status;
    if (lastStatus === 405) return;
  }
  throw operatorError(`Preview route did not become ready (${lastStatus})`, 'CUSTOMER_WEEKLY_AI_PREVIEW_NOT_READY');
}

async function readAccountSubdomain(token) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/subdomain`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  const subdomain = body?.result?.subdomain;
  if (!response.ok || body?.success !== true || typeof subdomain !== 'string'
      || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(subdomain)) {
    throw operatorError('Preview subdomain lookup failed', 'CUSTOMER_WEEKLY_AI_PREVIEW_SUBDOMAIN_FAILED');
  }
  return subdomain;
}

async function readPreviewState(label) {
  const response = await fetch(scriptSubdomainEndpoint(), {
    headers: { authorization: `Bearer ${target.token}` }, signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw operatorError(`Preview state read failed: ${label}`, 'CUSTOMER_WEEKLY_AI_PREVIEW_WINDOW_FAILED');
  return parseWooCommercePreviewUrlState(body, label);
}

async function writePreviewState(previewsEnabled, label) {
  const response = await fetch(scriptSubdomainEndpoint(), {
    method: 'POST',
    headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(buildWooCommercePreviewUrlMutation(previewsEnabled)),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw operatorError(`Preview state update failed: ${label}`, 'CUSTOMER_WEEKLY_AI_PREVIEW_WINDOW_FAILED');
  return parseWooCommercePreviewUrlState(body, label);
}

async function waitForPreviewState(label) {
  let last = null;
  for (const delay of [0, 500, 1_000, 2_000, 3_000]) {
    if (delay) await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
    last = await readPreviewState(label);
    if (last.enabled === false && last.previewsEnabled === label.startsWith('enable')) return last;
  }
  return last;
}

function scriptSubdomainEndpoint() {
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER}/subdomain`;
}
function readActiveVersion(env) {
  const parsed = JSON.parse(runText('npx', [
    '--no-install', 'wrangler', 'deployments', 'status',
    '--name', WORKER, '--config', CONFIG_PATH, '--json', '--profile', CLOUDFLARE_PROFILE,
  ], env));
  const status = Array.isArray(parsed) ? parsed[0] : parsed;
  const active = (status?.versions ?? []).filter((version) => Number(version?.percentage) === 100);
  if (active.length !== 1 || typeof active[0]?.version_id !== 'string') {
    throw operatorError('Production active version could not be resolved', 'CUSTOMER_WEEKLY_AI_PROD_VERSION_INVALID');
  }
  return active[0].version_id;
}
async function assertProductionVersionUnchanged() {
  if (readActiveVersion(target.commandEnv) !== target.productionBaselineVersion) {
    throw operatorError('Production version changed during Preview', 'CUSTOMER_WEEKLY_AI_PROD_VERSION_DRIFT');
  }
}
function runText(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw operatorError(`${command} command failed`, 'CUSTOMER_WEEKLY_AI_COMMAND_FAILED');
  }
  return String(result.stdout ?? '').trim();
}
function git(args) { return runText('git', args, process.env).trim(); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function requireExact(actual, expected, label) {
  if (actual !== expected) throw operatorError(`${label} does not match Customer PROD`, 'CUSTOMER_WEEKLY_AI_AUTHORITY_MISMATCH');
}
function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
