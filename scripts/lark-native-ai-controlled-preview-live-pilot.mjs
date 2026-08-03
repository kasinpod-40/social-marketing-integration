#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  applyLarkNativeAiControlledPreviewLivePilot,
} from '../packages/application/src/reports/apply-lark-native-ai-controlled-preview-live-pilot.js';
import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONTRACT_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_EVIDENCE_SCHEMA_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_SCHEMA_VERSION,
} from '../packages/config/src/lark-native-ai-controlled-preview-live-pilot-contract.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  assertLarkNativeAiControlledPreviewLivePilotConfirmation,
  assertLarkNativeAiControlledPreviewLivePilotRemoteCounters,
  assertLarkNativeAiControlledPreviewLivePilotRepository,
  createLarkNativeAiControlledPreviewLivePilotFetchGuard,
  parseLarkNativeAiControlledPreviewLivePilotArgs,
  sanitizeLarkNativeAiControlledPreviewLivePilotValue,
} from './lib/lark-native-ai-controlled-preview-live-pilot.js';

const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_WRANGLER_CONFIG
    ?? 'wrangler.sync.jsonc',
);
const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const inputPath = resolve(
  process.env.MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_INPUT
    ?? 'outputs/lark-native-ai-controlled-preview/live-pilot-input.json',
);
const evidencePath = resolve(
  process.env.MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EVIDENCE
    ?? 'outputs/lark-native-ai-controlled-preview/live-pilot-summary.json',
);

let stage = 'init';
let repository = null;
let fetchGuard = null;
let executionStarted = false;

try {
  const options = parseLarkNativeAiControlledPreviewLivePilotArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeLivePilot();
} catch (error) {
  const remote = fetchGuard?.snapshot() ?? emptyRemoteCounters();
  const failure = Object.freeze({
    ok: false,
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_EVIDENCE_SCHEMA_VERSION,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONTRACT_VERSION,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_FAILED',
    message: sanitizeLarkNativeAiControlledPreviewLivePilotValue(error?.message ?? String(error)),
    details: sanitizeLarkNativeAiControlledPreviewLivePilotValue(error?.details ?? {}),
    repository,
    remote,
    aiCallCount: 0,
    remoteD1ActionCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerActionCount: 0,
    automationCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  if (executionStarted) {
    try { await writePrivateJson(evidencePath, failure); } catch { /* preserve primary failure */ }
  }
  process.stderr.write(`${JSON.stringify({
    ...failure,
    ...(executionStarted ? { evidencePath } : {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONTRACT_VERSION,
    objective: 'write_exact_40_preview_rows_from_approved_real_report_readiness',
    requiredInput: {
      schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_SCHEMA_VERSION,
      readinessPlans: 'exact approved 1D/3D/7D/30D plans generated from real validated Report evidence',
      privateMode: '0600',
      defaultPath: 'outputs/lark-native-ai-controlled-preview/live-pilot-input.json',
    },
    command: [
      `CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW=${LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION}`,
      'MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_REVIEWED_HEAD=<exact-reviewed-main-sha>',
      'node scripts/lark-native-ai-controlled-preview-live-pilot.mjs --execute',
    ].join(' '),
    hardGates: [
      'clean exact main Head',
      'four readiness plans with valid retained plan hashes',
      'Meta Remote lock released',
      'exact Head-bound explicit approval',
      'Lark schema zero drift and 6/6 View filters',
      'all Worker flags false, Preview URLs disabled, Schedule disabled, Production blocked',
      'forty unique ai_run_key and dedupe_key identities',
    ],
    remoteAllowlist: [
      'tenant token',
      'list Tables',
      'search Records by ai_run_key/dedupe_key',
      'batch create/update Preview Records only',
    ],
    maximumRecordWrites: 40,
    deleteActionCount: 0,
    schemaMutationCount: 0,
    aiCallCount: 0,
    automationCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    executed: false,
  }, null, 2)}\n`);
}

async function executeLivePilot() {
  stage = 'confirmation';
  assertLarkNativeAiControlledPreviewLivePilotConfirmation(process.env);
  const reviewedHead = requireSha(
    process.env.MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_REVIEWED_HEAD,
    'MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_REVIEWED_HEAD',
  );

  stage = 'repository-preflight';
  repository = assertLarkNativeAiControlledPreviewLivePilotRepository(
    collectRepositoryState(reviewedHead),
  );
  executionStarted = true;

  stage = 'load-private-readiness-input';
  await assertPrivateFile(inputPath);
  const input = parseJson(await readFile(inputPath, 'utf8'), 'Controlled Preview Live Pilot input');
  if (input.schemaVersion !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_SCHEMA_VERSION
    || !Array.isArray(input.readinessPlans)
    || input.readinessPlans.length !== 4) {
    throw codedError(
      'Controlled Preview Live Pilot input must contain the exact four-window readiness set',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_INVALID',
    );
  }

  stage = 'load-local-lark-config';
  const config = parseJsoncObject(await readFile(configPath, 'utf8'));
  const devVars = await readOptionalDevVars(devVarsPath);
  const env = Object.freeze({ ...(config.vars ?? {}), ...devVars, ...process.env });
  requireCredential(env.LARK_APP_ID, 'LARK_APP_ID');
  requireCredential(env.LARK_APP_SECRET, 'LARK_APP_SECRET');
  requireCredential(env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN, 'LARK_APP_TOKEN or LARK_BASE_APP_TOKEN');

  stage = 'apply-controlled-preview-records';
  fetchGuard = createLarkNativeAiControlledPreviewLivePilotFetchGuard(globalThis.fetch.bind(globalThis));
  const client = createLarkBitableClientFromEnv(env, {
    fetchImpl: fetchGuard.fetchImpl,
    onRequest: (event) => {
      const safe = sanitizeLarkNativeAiControlledPreviewLivePilotValue(event);
      process.stderr.write(`${JSON.stringify({ stage: 'lark_request', ...safe })}\n`);
    },
  });
  const result = await applyLarkNativeAiControlledPreviewLivePilot({
    client,
    repository,
    readinessPlans: input.readinessPlans,
    onProgress: (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
  });
  const remote = fetchGuard.snapshot();
  assertLarkNativeAiControlledPreviewLivePilotRemoteCounters(remote);

  stage = 'write-sanitized-evidence';
  const evidence = Object.freeze({
    ok: true,
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_EVIDENCE_SCHEMA_VERSION,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONTRACT_VERSION,
    stage: 'complete',
    repository,
    mode: result.mode,
    targetTable: result.targetTable,
    initialPlanId: result.initialPlanId,
    verificationPlanId: result.verificationPlanId,
    writes: result.writes,
    verification: result.verification,
    remote,
    aiCallCount: 0,
    remoteD1ActionCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerActionCount: 0,
    automationCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  await writePrivateJson(evidencePath, evidence);
  process.stdout.write(`${JSON.stringify({ ...evidence, evidencePath }, null, 2)}\n`);
}

function collectRepositoryState(reviewedHead) {
  return {
    branch: git(['branch', '--show-current']),
    head: git(['rev-parse', 'HEAD']),
    clean: git(['status', '--porcelain']) === '',
    reviewedHead,
  };
}
function git(args) {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    throw codedError(`Git command failed: git ${args.join(' ')}`, 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_GIT_FAILED');
  }
  return String(result.stdout ?? '').trim();
}
async function readOptionalDevVars(path) {
  try { return await readDevVars(path); } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}
async function assertPrivateFile(path) {
  const file = await stat(path);
  if (!file.isFile()) throw codedError('Controlled Preview input must be a file', 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_INVALID');
  if ((file.mode & 0o077) !== 0) {
    throw codedError('Controlled Preview input must use private mode 0600', 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_MODE_INVALID');
  }
}
async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
}
function parseJson(source, label) {
  try { return JSON.parse(source); } catch (cause) {
    const error = codedError(`${label} is not valid JSON`, 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_JSON_INVALID');
    error.cause = cause;
    throw error;
  }
}
function requireCredential(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw codedError(`${name} is required`, 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CREDENTIAL_REQUIRED');
  }
  return value.trim();
}
function requireSha(value, name) {
  const item = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{40}$/u.test(item)) {
    throw codedError(`${name} must be an exact lowercase 40-character SHA`, 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_REVIEWED_HEAD_REQUIRED');
  }
  return item;
}
function codedError(message, code) { const error = new Error(message); error.code = code; return error; }
function emptyRemoteCounters() {
  return Object.freeze({
    tokenRequestCount: 0,
    tableReadRequestCount: 0,
    recordSearchRequestCount: 0,
    batchCreateRequestCount: 0,
    batchUpdateRequestCount: 0,
    recordCreateCount: 0,
    recordUpdateCount: 0,
    blockedRequestCount: 0,
    totalBatchWriteRequests: 0,
    totalRecordWrites: 0,
  });
}
