#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
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

const ACCOUNT_ID = '154f6bf72740d29d7453cec7fb800d32';
const WORKER = 'social-mkt-sync-worker';
const PROFILE = 'chemistry-k-prod';
const EXPECTED_ACTIVE_VERSION = '54ba99cb-9fab-4624-83d9-52fdccf2a814';
const APP_TOKEN = 'Tcm4bYRL4acuQysp6AwlmXBKgbe';
const METRIC_TABLE_ID = 'tblHqEtDEUiqFhYx';
const CONFIG_PATH = resolve('.customer-youtube-uat.wrangler.jsonc');
const ENTRYPOINT = resolve('apps/sync-worker/src/customer-paid-trend-preview-entry.js');
const OPERATOR_PATH = '/__codex/customer-paid-trend-v1';
const modes = readModes();

let runtimeRoot;
let auth;
let baselineVersion;
let runtimeCommandEnv;
let previewOpen = false;
let primaryError = null;
let restoreError = null;

try {
  await main();
} catch (error) {
  primaryError = error;
} finally {
  if (previewOpen) {
    try {
      await mutatePreviewState(false);
      assertWooCommercePreviewUrlRestored(await readPreviewState('restore'));
      assertActiveVersion();
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
    code: error?.code ?? 'CUSTOMER_PAID_TREND_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    previewUrlsRestored: restoreError === null && previewOpen,
    productionTrafficChanged: false,
  }));
  process.exitCode = 1;
}

async function main() {
  const config = parseJsoncObject(await readFile(CONFIG_PATH, 'utf8'));
  assertAuthority(config);
  const privateEnv = await readDevVars(resolve(process.env.DEV_VARS_FILE ?? '.dev.vars'));
  const commandEnv = { ...process.env, ...privateEnv };
  runtimeCommandEnv = commandEnv;
  const authOutput = commandEnv.CLOUDFLARE_API_TOKEN
    ? null
    : runText('npx', ['wrangler', 'auth', 'token', '--json', '--profile', PROFILE], commandEnv);
  auth = resolveCloudflareBearerAuth({
    explicitApiToken: commandEnv.CLOUDFLARE_API_TOKEN,
    authOutput,
  });
  baselineVersion = activeVersion(commandEnv);
  if (baselineVersion !== EXPECTED_ACTIVE_VERSION) throw new Error('Production version is outside reviewed scope');

  const token = randomBytes(48).toString('base64url');
  const alias = `paid-trend-${randomBytes(4).toString('hex')}`;
  const accountSubdomain = await readAccountSubdomain();
  runtimeRoot = await mkdtemp(join(tmpdir(), 'customer-paid-trend-'));
  const runtimeConfigPath = join(runtimeRoot, 'wrangler.preview.json');
  await writeFile(runtimeConfigPath, `${JSON.stringify(buildPreviewConfig(config, sha256(token)), null, 2)}\n`, { mode: 0o600 });
  await chmod(runtimeConfigPath, 0o600);

  const previewBaseline = await readPreviewState('baseline');
  if (previewBaseline.enabled === false && previewBaseline.previewsEnabled === true) {
    previewOpen = true;
  } else {
    assertWooCommercePreviewUrlBaseline(previewBaseline);
    await mutatePreviewState(true);
    previewOpen = true;
    assertWooCommercePreviewUrlActive(await readPreviewState('enabled'));
  }

  const outputPath = join(runtimeRoot, 'wrangler.ndjson');
  const stdout = runText('npx', [
    '--no-install', 'wrangler', 'versions', 'upload',
    '--config', runtimeConfigPath,
    '--profile', PROFILE,
    '--preview-alias', alias,
    '--message', 'Customer Paid Ads daily trend dashboard operator',
  ], { ...commandEnv, WRANGLER_OUTPUT_FILE_PATH: outputPath });
  const upload = parseWooCommerceDiagnosticsPreviewUpload(
    await readFile(outputPath, 'utf8').catch(() => ''),
    stdout,
    { previewAlias: alias, workerName: WORKER, accountWorkersDevSubdomain: accountSubdomain },
  );
  assertActiveVersion();
  const url = new URL(OPERATOR_PATH, `${upload.previewOrigin}/`);
  await waitForMktAdsPreviewRoute({ fetchImpl: fetch, url: url.toString() });

  const results = [];
  for (const mode of modes) results.push({ mode, result: await postOperator(url, token, mode) });
  assertActiveVersion();
  console.log(JSON.stringify({
    ok: true,
    productionVersion: baselineVersion,
    productionTrafficChanged: false,
    previewVersion: upload.versionId,
    results,
  }, null, 2));
}

function buildPreviewConfig(input, tokenSha256) {
  const config = structuredClone(input);
  config.main = ENTRYPOINT;
  config.workers_dev = false;
  config.preview_urls = true;
  config.vars = {
    MKT_ENV: input.vars.MKT_ENV,
    MKT_CUSTOMER_PROFILE: input.vars.MKT_CUSTOMER_PROFILE,
    LARK_APP_ID: input.vars.LARK_APP_ID,
    LARK_APP_TOKEN: input.vars.LARK_APP_TOKEN,
    LARK_TABLE_MKT_REPORT_METRIC_VALUES: input.vars.LARK_TABLE_MKT_REPORT_METRIC_VALUES,
    MKT_OPERATOR_TOKEN_SHA256: tokenSha256,
  };
  delete config.route;
  delete config.routes;
  delete config.triggers;
  delete config.queues;
  delete config.assets;
  delete config.env;
  return config;
}

async function postOperator(url, token, mode) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({ mode }),
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) throw new Error(`Paid trend ${mode} failed: ${body?.code ?? response.status}: ${body?.error ?? 'unknown'}`);
  return body.result;
}

async function readAccountSubdomain() {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/subdomain`, {
    headers: { authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body?.success !== true || typeof body?.result?.subdomain !== 'string') throw new Error('Cloudflare Preview subdomain lookup failed');
  return body.result.subdomain;
}

async function readPreviewState(label) {
  const response = await fetch(previewStateUrl(), {
    headers: { authorization: `Bearer ${auth.token}` }, signal: AbortSignal.timeout(30_000),
  });
  return parseWooCommercePreviewUrlState(await response.json(), label);
}

async function mutatePreviewState(enabled) {
  const response = await fetch(previewStateUrl(), {
    method: 'POST',
    headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(buildWooCommercePreviewUrlMutation(enabled)),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Cloudflare Preview state update failed');
}

function previewStateUrl() { return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER}/subdomain`; }
function assertActiveVersion() { if (activeVersion(runtimeCommandEnv) !== baselineVersion) throw new Error('Production version changed during operator'); }
function activeVersion(env) {
  const parsed = JSON.parse(runText('npx', ['--no-install', 'wrangler', 'deployments', 'status', '--name', WORKER, '--config', CONFIG_PATH, '--json', '--profile', PROFILE], env));
  const status = Array.isArray(parsed) ? parsed[0] : parsed;
  const active = (status?.versions ?? []).filter((row) => Number(row?.percentage) === 100);
  if (active.length !== 1) throw new Error('Expected one active production version');
  return active[0].version_id;
}

function assertAuthority(config) {
  if (config.name !== WORKER || config.account_id !== ACCOUNT_ID
    || config.vars?.MKT_ENV !== 'production' || config.vars?.MKT_CUSTOMER_PROFILE !== 'chemistry_k'
    || config.vars?.LARK_APP_TOKEN !== APP_TOKEN
    || config.vars?.LARK_TABLE_MKT_REPORT_METRIC_VALUES !== METRIC_TABLE_ID) {
    throw new Error('Customer production authority mismatch');
  }
}

function readModes() {
  const raw = process.argv.find((value) => value.startsWith('--modes='))?.slice('--modes='.length) ?? 'inspect';
  const values = raw.split(',').filter(Boolean);
  const allowed = new Set([
    'inspect', 'inspect_organic', 'apply_schema', 'apply_dashboard', 'apply_organic_content_chart',
  ]);
  if (values.length === 0 || values.some((value) => !allowed.has(value))) throw new Error('Invalid operator modes');
  return values;
}

function runText(command, args, env) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr ?? '').replace(/Bearer\s+\S+/giu, 'Bearer [REDACTED]').trim().slice(0, 1_500);
    throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed (${result.status}): ${detail}`);
  }
  return String(result.stdout ?? '').trim();
}
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
