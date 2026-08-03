#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { buildLarkNativeAiControlledPreviewReadiness } from '../packages/application/src/reports/build-lark-native-ai-controlled-preview-readiness.js';
import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_EVIDENCE_SCHEMA_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_OUTPUT_ROOT,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_SCHEMA_VERSION,
} from '../packages/config/src/lark-native-ai-controlled-preview-exact-terminal-contract.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { adaptLarkNativeAiControlledPreviewReportSource } from './lib/adapt-lark-native-ai-controlled-preview-report-source.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  collectLarkNativeAiControlledPreviewRealSource,
  createLarkNativeAiControlledPreviewSourceReadGuard,
} from './lib/collect-lark-native-ai-controlled-preview-real-source.js';
import {
  assertLarkNativeAiControlledPreviewExactTerminalConfirmation,
  assertLarkNativeAiControlledPreviewExactTerminalFirstPass,
  assertLarkNativeAiControlledPreviewExactTerminalNodeVersion,
  assertLarkNativeAiControlledPreviewExactTerminalReplay,
  assertLarkNativeAiControlledPreviewExactTerminalRepository,
  buildLarkNativeAiControlledPreviewExactTerminalChildEnv,
  buildLarkNativeAiControlledPreviewExactTerminalReadiness,
  exactTerminalError,
  parseLarkNativeAiControlledPreviewExactTerminalArgs,
  sanitizeLarkNativeAiControlledPreviewExactTerminalValue,
  validateLarkNativeAiControlledPreviewSourcePackage,
} from './lib/lark-native-ai-controlled-preview-exact-terminal.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_WRANGLER_CONFIG
    ?? 'wrangler.sync.jsonc',
);
const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const outputRoot = resolve(
  process.env.MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_OUTPUT_ROOT
    ?? LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_OUTPUT_ROOT,
);
const lockPath = resolve(outputRoot, '.exact-terminal.lock');

let stage = 'init';
let repository = null;
let sourcePackage = null;
let sourceRead = null;
let attemptDirectory = null;
let lockHandle = null;
let summaryWritten = false;

try {
  const options = parseLarkNativeAiControlledPreviewExactTerminalArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeExactTerminal();
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_FAILED',
    message: sanitizeLarkNativeAiControlledPreviewExactTerminalValue(
      error?.message ?? String(error),
    ),
    details: sanitizeLarkNativeAiControlledPreviewExactTerminalValue(error?.details ?? {}),
    repository,
    sourcePackageSha256: sourcePackage?.packageSha256 ?? null,
    sourceRead: sourceRead?.snapshot?.() ?? null,
    attemptDirectory: attemptDirectory ? relative(repositoryRoot, attemptDirectory) : null,
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
  if (attemptDirectory && !summaryWritten) {
    try {
      await writePrivateJson(resolve(attemptDirectory, 'failure-summary.json'), failure);
      summaryWritten = true;
    } catch {
      // Preserve the primary failure and keep stderr as the final authority.
    }
  }
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (lockHandle) {
    try { await lockHandle.close(); } catch { /* no-op */ }
    try { await unlink(lockPath); } catch { /* preserve primary result */ }
  }
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
    objective: 'collect_real_lark_report_outputs_then_apply_and_replay_exact_40_preview_rows',
    exactCommand: [
      'cd /Users/wasanjantawong/Git/social-marketing-integration &&',
      'git fetch --quiet origin main &&',
      'git switch main &&',
      'git pull --ff-only origin main &&',
      `CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL=${LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION}`,
      'node scripts/lark-native-ai-controlled-preview-exact-terminal.mjs --execute',
    ].join(' '),
    hiddenPrerequisiteFiles: 0,
    executionSequence: [
      'refresh local main by fast-forward only before starting the installed operator',
      'fetch origin/main again and require a clean exact local main',
      'validate all local config, credentials and mappings before Remote read',
      'harden regular .dev.vars permissions to 0600 before reading secrets',
      'acquire one local exact-terminal lock',
      'read one cached Lark table inventory plus AI schema and TikTok 1D/3D/7D/30D Report outputs',
      'adapt Shared Report metric taxonomy without changing numeric values',
      'create and revalidate a private checksummed source package automatically',
      'build exact approved all-channel readiness plans',
      'run bounded first pass with at most 40 Record writes',
      'run a separate same-input replay',
      'require 40 no-op / zero replay writes',
      'write immutable private attempt evidence',
    ],
    visibleRows: {
      tiktokGoldenDataset: 4,
      otherChannelStatusRows: 32,
      executiveRows: 4,
      total: 40,
    },
    maximumFirstPassWrites:
      LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS.maximumFirstPassWrites,
    replayWritesRequired: 0,
    deleteActionCount: 0,
    schemaMutationCount: 0,
    aiCallCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    executed: false,
  }, null, 2)}\n`);
}

async function executeExactTerminal() {
  stage = 'confirmation';
  assertLarkNativeAiControlledPreviewExactTerminalConfirmation(process.env);
  assertLarkNativeAiControlledPreviewExactTerminalNodeVersion(process.versions.node);

  stage = 'fetch-origin-main';
  await runGit(['fetch', '--quiet', 'origin', 'main']);

  stage = 'repository-preflight';
  repository = assertLarkNativeAiControlledPreviewExactTerminalRepository({
    branch: await gitText(['branch', '--show-current']),
    head: await gitText(['rev-parse', 'HEAD']),
    originMain: await gitText(['rev-parse', 'origin/main']),
    clean: (await gitText(['status', '--porcelain'])) === '',
  });

  stage = 'local-preflight';
  const runtime = await loadAndValidateRuntime();

  stage = 'acquire-local-execution-lock';
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await chmod(outputRoot, 0o700);
  lockHandle = await acquireExecutionLock();

  stage = 'create-immutable-attempt-directory';
  attemptDirectory = await createAttemptDirectory();
  const sourcePath = resolve(attemptDirectory, '00-retained-real-report-source.json');
  const inputPath = resolve(attemptDirectory, 'live-pilot-input.json');
  const firstEvidencePath = resolve(attemptDirectory, '01-first-pass.json');
  const replayEvidencePath = resolve(attemptDirectory, '02-same-input-replay.json');

  stage = 'collect-real-lark-report-source';
  sourceRead = createLarkNativeAiControlledPreviewSourceReadGuard(
    globalThis.fetch.bind(globalThis),
  );
  const sourceEnv = Object.freeze({
    ...runtime.env,
    LARK_MAX_ATTEMPTS: '1',
    LARK_MAX_PAGES: '2',
    LARK_MAX_FILTER_CONDITIONS: '50',
    LARK_REQUEST_TIMEOUT_MS: '30000',
    LARK_MIN_REQUEST_INTERVAL_MS: '150',
  });
  const rawSourceClient = createLarkBitableClientFromEnv(sourceEnv, {
    fetchImpl: sourceRead.fetchImpl,
    onRequest: (event) => process.stderr.write(`${JSON.stringify({
      stage: 'source_read',
      ...sanitizeLarkNativeAiControlledPreviewExactTerminalValue(event),
    })}\n`),
  });
  const sourceClient = withCachedTableInventory(rawSourceClient);
  const collectedReportSource = await collectLarkNativeAiControlledPreviewRealSource({
    client: sourceClient,
    sourceGuard: sourceRead,
    repository,
    env: runtime.env,
    generatedAt: Date.now(),
  });

  stage = 'adapt-report-metric-taxonomy';
  const collected = await adaptLarkNativeAiControlledPreviewReportSource(
    collectedReportSource,
  );
  sourcePackage = await validateLarkNativeAiControlledPreviewSourcePackage(
    collected,
    repository,
  );
  // Retain the exact adapted package because packageSha256 covers every metadata field.
  await writePrivateJson(sourcePath, collected);

  stage = 'build-exact-four-window-readiness';
  const readinessPlans = await buildLarkNativeAiControlledPreviewExactTerminalReadiness({
    sourcePackage,
    repository,
    buildReadiness: buildLarkNativeAiControlledPreviewReadiness,
  });
  await writePrivateJson(inputPath, {
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_SCHEMA_VERSION,
    readinessPlans,
  });

  stage = 'lark-first-pass';
  const firstPass = assertLarkNativeAiControlledPreviewExactTerminalFirstPass(
    await runLivePilotChild({
      inputPath,
      evidencePath: firstEvidencePath,
      passName: 'first-pass',
    }),
  );

  stage = 'lark-same-input-replay';
  const replay = assertLarkNativeAiControlledPreviewExactTerminalReplay(
    await runLivePilotChild({
      inputPath,
      evidencePath: replayEvidencePath,
      passName: 'same-input-replay',
    }),
  );

  stage = 'write-exact-terminal-summary';
  const summary = Object.freeze({
    ok: true,
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
    stage: 'complete',
    repository,
    sourcePackageSha256: sourcePackage.packageSha256,
    sourceEvidenceSha256: sourcePackage.provenance.sourceEvidenceSha256,
    sourceRead: sourceRead.snapshot(),
    windows: sourcePackage.offlineInputs.map((item) => item.window.windowDays),
    firstPass: {
      mode: firstPass.mode,
      writes: firstPass.writes,
      verification: firstPass.verification,
      remote: firstPass.remote,
    },
    replay: {
      mode: replay.mode,
      writes: replay.writes,
      verification: replay.verification,
      remote: replay.remote,
    },
    totalRecordWrites: firstPass.writes.total,
    sameInputReplayWrites: replay.writes.total,
    deleteActionCount: 0,
    schemaMutationCount: 0,
    aiCallCount: 0,
    remoteD1ActionCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerActionCount: 0,
    automationCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    attemptDirectory: relative(repositoryRoot, attemptDirectory),
  });
  await writePrivateJson(resolve(attemptDirectory, 'summary.json'), summary);
  summaryWritten = true;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function loadAndValidateRuntime() {
  let config;
  const blockers = [];
  try {
    config = parseJsoncObject(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw exactTerminalError(
      'Reviewed wrangler.sync.jsonc could not be loaded',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIG_INVALID',
      { code: error?.code ?? null },
    );
  }
  const devVars = await readOptionalPrivateDevVars(devVarsPath, blockers);
  const env = Object.freeze({ ...(config.vars ?? {}), ...devVars, ...process.env });
  if (config.name !== 'social-mkt-sync-worker') blockers.push({
    code: 'WORKER_NAME_INVALID', field: 'name',
  });
  if (config.workers_dev !== false) blockers.push({
    code: 'WORKERS_DEV_NOT_DISABLED', field: 'workers_dev',
  });
  if (env.MKT_ENV !== 'development') blockers.push({
    code: 'MKT_ENV_INVALID', field: 'MKT_ENV',
  });
  if (env.MKT_CUSTOMER_PROFILE !== 'integration_workspace') blockers.push({
    code: 'CUSTOMER_PROFILE_INVALID', field: 'MKT_CUSTOMER_PROFILE',
  });
  for (const field of [
    'LARK_APP_ID',
    'LARK_APP_SECRET',
    'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
    'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
  ]) {
    if (typeof env[field] !== 'string' || env[field].trim() === '') blockers.push({
      code: 'REQUIRED_ENV_MISSING', field,
    });
  }
  if (typeof (env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN) !== 'string'
    || (env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN).trim() === '') blockers.push({
    code: 'REQUIRED_ENV_MISSING', field: 'LARK_APP_TOKEN|LARK_BASE_APP_TOKEN',
  });
  const enabledFlags = Object.entries(env)
    .filter(([name, value]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
      && String(value).toLowerCase() === 'true')
    .map(([name]) => name)
    .sort();
  if (enabledFlags.length > 0) blockers.push({
    code: 'LOCAL_EXECUTION_FLAGS_NOT_ALL_FALSE', fields: enabledFlags,
  });
  if (blockers.length > 0) throw exactTerminalError(
    'Controlled Preview Exact Terminal local preflight found blockers',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LOCAL_PREFLIGHT_BLOCKED',
    { blockerCount: blockers.length, blockers },
  );
  return Object.freeze({ config, env });
}

async function readOptionalPrivateDevVars(path, blockers) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      blockers.push({ code: 'DEV_VARS_FILE_TYPE_INVALID', field: '.dev.vars' });
      return {};
    }
    if ((metadata.mode & 0o077) !== 0) await chmod(path, 0o600);
    return await readDevVars(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    blockers.push({ code: 'DEV_VARS_READ_FAILED', field: '.dev.vars', sourceCode: error?.code ?? null });
    return {};
  }
}

async function runLivePilotChild({ inputPath, evidencePath, passName }) {
  const env = buildLarkNativeAiControlledPreviewExactTerminalChildEnv(process.env, {
    head: repository.exactHeadSha,
    inputPath,
    evidencePath,
  });
  try {
    const result = await execFileAsync(process.execPath, [
      'scripts/lark-native-ai-controlled-preview-live-pilot.mjs',
      '--execute',
    ], {
      cwd: repositoryRoot,
      env,
      encoding: 'utf8',
      timeout: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS.childTimeoutMs,
      maxBuffer: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS.childMaxBufferBytes,
      windowsHide: true,
    });
    return parseChildJson(result.stdout, passName);
  } catch (error) {
    const retained = await readOptionalJson(evidencePath);
    const childEvidence = retained
      ?? parseOptionalChildJson(error?.stdout)
      ?? parseOptionalChildJson(error?.stderr)
      ?? {};
    throw exactTerminalError(
      `Controlled Preview ${passName} child process failed`,
      childEvidence.code ?? 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_FAILED',
      {
        passName,
        childStage: childEvidence.stage ?? null,
        childMessage: childEvidence.message ?? null,
        childDetails: childEvidence.details ?? {},
        childExitCode: Number.isInteger(error?.code) ? error.code : null,
        childSignal: error?.signal ?? null,
        automaticRetryPerformed: false,
      },
    );
  }
}

function withCachedTableInventory(client) {
  let tablePromise = null;
  return Object.freeze({
    listTables() {
      if (!tablePromise) tablePromise = client.listTables();
      return tablePromise;
    },
    listFields: client.listFields.bind(client),
    listViews: client.listViews.bind(client),
    getView: client.getView.bind(client),
    searchRecordsByFieldValues: client.searchRecordsByFieldValues.bind(client),
  });
}

async function acquireExecutionLock() {
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({
      contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
      head: repository.exactHeadSha,
      pid: process.pid,
      createdAt: Date.now(),
    })}\n`, 'utf8');
    await chmod(lockPath, 0o600);
    return handle;
  } catch (error) {
    if (error?.code === 'EEXIST') throw exactTerminalError(
      'A Controlled Preview Exact Terminal lock already exists; it is never deleted automatically',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LOCK_EXISTS',
      { lockPath: relative(repositoryRoot, lockPath) },
    );
    throw error;
  }
}

async function createAttemptDirectory() {
  const timestamp = new Date().toISOString().replace(/[-:.]/gu, '');
  const path = resolve(outputRoot, `${timestamp}-${repository.exactHeadSha.slice(0, 12)}-${process.pid}`);
  await mkdir(path, { recursive: false, mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(path, 0o600);
}

async function readOptionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return null; }
}

function parseChildJson(value, label) {
  const parsed = parseOptionalChildJson(value);
  if (!parsed) throw exactTerminalError(
    `Controlled Preview ${label} child returned invalid JSON`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_JSON_INVALID',
    { label },
  );
  return parsed;
}

function parseOptionalChildJson(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* continue */ }
  const starts = [...text.matchAll(/\{/gu)].map((match) => match.index).reverse();
  for (const start of starts) {
    try { return JSON.parse(text.slice(start)); } catch { /* continue */ }
  }
  return null;
}

async function runGit(args) {
  try {
    await execFileAsync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw exactTerminalError(
      `Git command failed: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_GIT_FAILED',
      { exitCode: Number.isInteger(error?.code) ? error.code : null },
    );
  }
}

async function gitText(args) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return String(result.stdout ?? '').trim();
  } catch (error) {
    throw exactTerminalError(
      `Git command failed: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_GIT_FAILED',
      { exitCode: Number.isInteger(error?.code) ? error.code : null },
    );
  }
}
