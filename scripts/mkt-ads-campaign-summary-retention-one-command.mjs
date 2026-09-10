#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { loadSharedTableSchemaContract } from './lib/shared-table-schema-contract.js';
import { waitForMktAdsPreviewRoute } from './lib/mkt-ads-preview-readiness.js';
import { resolveCloudflareBearerAuth } from './lib/woocommerce-final-one-command.js';
import { parseWooCommerceDiagnosticsPreviewUpload } from './lib/woocommerce-diagnostics-preview-upload.js';
import {
  assertWooCommercePreviewUrlActive,
  assertWooCommercePreviewUrlBaseline,
  assertWooCommercePreviewUrlRestored,
  buildWooCommercePreviewUrlMutation,
  parseWooCommercePreviewUrlState,
} from './lib/woocommerce-preview-url-window.js';

const CONFIRMATION = 'APPLY_CUSTOMER_PROD_ADS_SUMMARY_RETENTION';
const ACCOUNT_ID = '154f6bf72740d29d7453cec7fb800d32';
const WORKER = 'social-mkt-sync-worker';
const DATABASE = 'social-mkt-state-prod';
const DATABASE_ID = 'f03ab092-a1aa-4478-8ba2-c20d7b54851f';
const CLOUDFLARE_PROFILE = 'chemistry-k-prod';
const CUSTOMER_PROFILE = 'chemistry_k';
const APP_TOKEN = 'Tcm4bYRL4acuQysp6AwlmXBKgbe';
const ADS_DAILY_TABLE_ID = 'tblTjWaxgSCwSj1P';
const PREVIEW_ENTRYPOINT = resolve('apps/sync-worker/src/mkt-ads-campaign-summary-retention-preview-entry.js');
const PREVIEW_PATH = '/__codex/mkt-ads-campaign-summary-retention-v1';
const CONFIG_PATH = resolve(
  process.env.MKT_CUSTOMER_WRANGLER_CONFIG ?? '.customer-youtube-uat.wrangler.jsonc',
);
const execute = process.argv.includes('--execute');

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
    code: error?.code ?? 'MKT_ADS_PROD_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    previewUrlsRestored: restoreError === null && previewWindowOpened,
    productionTrafficChanged: false,
  }));
  process.exitCode = 1;
}

async function main() {
  if (execute && process.env.CONFIRM_MKT_ADS_PROD_OPERATOR !== CONFIRMATION) {
    throw operatorError('Exact PROD confirmation is required', 'MKT_ADS_PROD_CONFIRMATION_REQUIRED');
  }
  assertReviewedMain();

  const configText = await readFile(CONFIG_PATH, 'utf8');
  const config = parseJsoncObject(configText);
  const binding = (config.d1_databases ?? []).filter((entry) => entry?.binding === 'MKT_STATE_DB');
  requireExact(config.name, WORKER, 'Worker name');
  requireExact(config.account_id, ACCOUNT_ID, 'Cloudflare account');
  if (binding.length !== 1) {
    throw operatorError('Expected exactly one MKT_STATE_DB binding', 'MKT_ADS_PROD_D1_BINDING_INVALID');
  }
  requireExact(binding[0].database_name, DATABASE, 'D1 database');
  requireExact(binding[0].database_id, DATABASE_ID, 'D1 database ID');
  requireExact(config.vars?.MKT_ENV, 'production', 'MKT_ENV');
  requireExact(config.vars?.MKT_CUSTOMER_PROFILE, CUSTOMER_PROFILE, 'MKT_CUSTOMER_PROFILE');
  requireExact(config.vars?.LARK_APP_TOKEN, APP_TOKEN, 'LARK_APP_TOKEN');
  requireExact(config.vars?.LARK_TABLE_MKT_ADS_DAILY, ADS_DAILY_TABLE_ID, 'LARK_TABLE_MKT_ADS_DAILY');

  const privateEnv = await readDevVars(resolve(process.env.DEV_VARS_FILE ?? '.dev.vars'));
  const commandEnv = { ...process.env, ...privateEnv };
  const authOutput = commandEnv.CLOUDFLARE_API_TOKEN
    ? null
    : runText('npx', [
      'wrangler', 'auth', 'token', '--json', '--profile', CLOUDFLARE_PROFILE,
    ], commandEnv);
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: commandEnv.CLOUDFLARE_API_TOKEN,
    authOutput,
  });
  const accountSubdomain = await readAccountSubdomain(auth.token);
  const productionBaselineVersion = readActiveVersion(commandEnv, CONFIG_PATH);
  const token = randomBytes(48).toString('base64url');
  const previewAlias = `ads-summary-${randomBytes(4).toString('hex')}`;

  runtimeRoot = await mkdtemp(join(tmpdir(), 'mkt-ads-summary-retention-'));
  const runtimeConfigPath = join(runtimeRoot, 'wrangler.preview.json');
  const runtimeConfig = buildPreviewConfig(config, sha256(token));
  await writeFile(runtimeConfigPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, { mode: 0o600 });
  await chmod(runtimeConfigPath, 0o600);
  target = Object.freeze({ token: auth.token, commandEnv, runtimeConfigPath, productionBaselineVersion });

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
    '--message', `Paid summary/retention operator git=${git(['rev-parse', 'HEAD'])}`,
  ], { ...commandEnv, WRANGLER_OUTPUT_FILE_PATH: outputPath });
  const upload = parseWooCommerceDiagnosticsPreviewUpload(
    await readFile(outputPath, 'utf8').catch(() => ''),
    stdout,
    { previewAlias, workerName: WORKER, accountWorkersDevSubdomain: accountSubdomain },
  );
  await assertProductionVersionUnchanged();

  const operatorUrl = new URL(PREVIEW_PATH, `${upload.previewOrigin}/`);
  const readiness = await waitForMktAdsPreviewRoute({ fetchImpl: fetch, url: operatorUrl.toString() });
  await assertProductionVersionUnchanged();

  // Send the potentially mutating operator request exactly once. Only the GET readiness probe retries.
  const response = await fetch(operatorUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({
      mode: execute ? 'execute' : 'preview',
      contract: await loadSharedTableSchemaContract(),
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(execute ? 600_000 : 120_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    throw operatorError(
      `Preview operator failed with HTTP ${response.status}: ${body?.code ?? 'UNKNOWN'}: ${body?.error ?? 'Unknown error'}`,
      body?.code ?? 'MKT_ADS_PREVIEW_HTTP_FAILED',
      { status: response.status, operational: body?.details ?? {} },
    );
  }
  await assertProductionVersionUnchanged();
  console.log(JSON.stringify({
    ok: true,
    executionTransport: 'preview_version_upload',
    productionBaselineVersion,
    productionDeploymentUnchanged: true,
    productionTrafficChanged: false,
    previewVersion: upload.versionId,
    previewReadiness: readiness,
    result: body.result,
  }, null, 2));
}

function buildPreviewConfig(configInput, tokenSha256) {
  const config = structuredClone(configInput);
  config.main = PREVIEW_ENTRYPOINT;
  config.workers_dev = false;
  config.preview_urls = true;
  config.vars = { ...config.vars, MKT_ADS_PROD_OPERATOR_TOKEN_SHA256: tokenSha256 };
  for (const [name] of Object.entries(config.vars)) {
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
    throw operatorError('Generated Preview config is not isolated', 'MKT_ADS_PREVIEW_CONFIG_INVALID');
  }
  return config;
}

async function readAccountSubdomain(token) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/subdomain`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
  );
  const body = await response.json().catch(() => null);
  const subdomain = body?.result?.subdomain;
  if (!response.ok || body?.success !== true || typeof subdomain !== 'string'
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(subdomain)) {
    throw operatorError('Cloudflare account Preview subdomain lookup failed', 'MKT_ADS_PREVIEW_SUBDOMAIN_FAILED');
  }
  return subdomain;
}

async function readPreviewState(label) {
  const response = await fetch(scriptSubdomainEndpoint(), {
    headers: { authorization: `Bearer ${target.token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw operatorError(`Preview URL state read failed: ${label}`, 'MKT_ADS_PREVIEW_WINDOW_FAILED');
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
  if (!response.ok) throw operatorError(`Preview URL state update failed: ${label}`, 'MKT_ADS_PREVIEW_WINDOW_FAILED');
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

function readActiveVersion(env, configPath) {
  const parsed = JSON.parse(runText('npx', [
    '--no-install', 'wrangler', 'deployments', 'status',
    '--name', WORKER, '--config', configPath, '--json',
    '--profile', CLOUDFLARE_PROFILE,
  ], env));
  const status = Array.isArray(parsed) ? parsed[0] : parsed;
  const active = (status?.versions ?? []).filter((version) => Number(version?.percentage) === 100);
  if (active.length !== 1 || typeof active[0]?.version_id !== 'string') {
    throw operatorError('Production active version could not be resolved', 'MKT_ADS_PROD_VERSION_INVALID');
  }
  return active[0].version_id;
}

async function assertProductionVersionUnchanged() {
  if (readActiveVersion(target.commandEnv, CONFIG_PATH) !== target.productionBaselineVersion) {
    throw operatorError('Production Worker version changed during Preview operator', 'MKT_ADS_PROD_VERSION_DRIFT');
  }
}

function assertReviewedMain() {
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const remote = git(['rev-parse', 'origin/main']);
  const tracked = git(['status', '--porcelain', '--untracked-files=no']);
  if (branch !== 'main' || head !== remote || tracked !== '') {
    throw operatorError(
      'PROD operator requires clean reviewed main exactly equal to origin/main',
      'MKT_ADS_PROD_REVIEWED_MAIN_REQUIRED',
    );
  }
}

function runText(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw operatorError(`${command} command failed`, 'MKT_ADS_PROD_COMMAND_FAILED');
  }
  return String(result.stdout ?? '').trim();
}

function git(args) { return runText('git', args, process.env).trim(); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function requireExact(actual, expected, label) {
  if (actual !== expected) {
    throw operatorError(`${label} does not match exact Customer PROD authority`, 'MKT_ADS_PROD_AUTHORITY_MISMATCH');
  }
}
function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(`${label} is required`, 'MKT_ADS_PROD_CONFIGURATION_MISSING');
  }
  return value.trim();
}
function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
