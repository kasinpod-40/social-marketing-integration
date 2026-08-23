#!/usr/bin/env node

import { execFile, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { JOB_TYPES } from '../packages/application/src/jobs/job-catalog.js';
import { processMetaEndToEndSync } from '../packages/application/src/use-cases/process-meta-end-to-end-sync.js';
import { readLarkTableIdsFromEnv } from '../packages/config/src/lark-table-config.js';
import { createInfrastructure } from '../apps/sync-worker/src/runtime-infrastructure.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  META_PAID_DIRECT_LARK_CONFIRMATION,
  META_PAID_DIRECT_LARK_CONTRACT_VERSION,
  META_PAID_DIRECT_LARK_EXCLUDED_TABLE_KEYS,
  META_PAID_DIRECT_LARK_PERIOD,
  META_PAID_DIRECT_LARK_TABLE_KEYS,
  META_PAID_DIRECT_LARK_TARGETS,
  buildMetaPaidDirectCandidateSql,
  buildMetaPaidDirectUnitsSql,
  createForbiddenMetaPaidDirectAdapter,
  createForbiddenMetaPaidDirectHistoryStore,
  createSeededMetaPaidDirectWorkStore,
  normalizeMetaPaidDirectCandidate,
  normalizeMetaPaidDirectUnits,
  parseWranglerD1Rows,
  selectNewestMetaPaidDirectSnapshot,
  summarizeMetaPaidDirectSnapshot,
  validateMetaPaidDirectLarkResult,
  validateMetaPaidDirectSourceSnapshot,
} from './lib/meta-paid-direct-lark-materializer.js';
import { materializeNameResolvedD1Config } from './lib/meta-paid-lark-queryable-d1-config.js';
import { sanitizeCliOutput } from './lib/sanitize-cli-output.js';
import { readWranglerScalarVars } from './lib/wrangler-jsonc-vars.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const READ_TIMEOUT_MS = 60_000;
const MAX_READ_ATTEMPTS = 6;
const READ_RETRY_DELAYS_MS = Object.freeze([5_000, 10_000, 20_000, 30_000, 30_000]);
const DIRECT_LIMITS = Object.freeze({
  sourceMaxPages: 100,
  sourceMaxUnits: 2_500,
  sourceMaxRows: 50_000,
  sourceMaxUnitBytes: 1_048_576,
  d1RowsPerInvocation: 1_000,
  larkTablesPerInvocation: 2,
});
let stage = 'init';
let larkWriteStarted = false;
let evidenceRoot = null;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) printPlan();
  else await executeDirectMaterialization();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'META_PAID_DIRECT_LARK_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    larkWriteStarted,
    remoteD1MutationCount: 0,
    queueSendCount: 0,
    workerDeployCount: 0,
    providerRequestCount: 0,
    scheduleActivationCount: 0,
    production: false,
    ...(evidenceRoot ? { evidenceRoot } : {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: META_PAID_DIRECT_LARK_CONTRACT_VERSION,
    targets: META_PAID_DIRECT_LARK_TARGETS,
    period: META_PAID_DIRECT_LARK_PERIOD,
    larkTableKeys: META_PAID_DIRECT_LARK_TABLE_KEYS,
    excludedLarkTableKeys: META_PAID_DIRECT_LARK_EXCLUDED_TABLE_KEYS,
    source: 'remote_d1_select_only_staged_meta_source',
    materialization: 'local_in_memory_resume_existing_mapper_and_lark_writer',
    idempotency: 'fresh_second_in_memory_replay_against_live_lark',
    remoteD1MutationAllowed: false,
    queueSendAllowed: false,
    workerDeployAllowed: false,
    providerReadAllowed: false,
    scheduleActivationAllowed: false,
    production: false,
  }, null, 2)}\n`);
}

async function executeDirectMaterialization() {
  requireConfirmation(process.env);
  stage = 'exact-clean-main';
  const repositoryHead = assertExactCleanMain();

  stage = 'load-private-runtime';
  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const fileEnv = await readDevVars(devVarsPath);
  const bootstrapEnv = Object.freeze({ ...fileEnv, ...process.env, DEV_VARS_FILE: devVarsPath });
  const sourceConfigPath = resolve(
    bootstrapEnv.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? bootstrapEnv.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
  );
  const info = await stat(sourceConfigPath).catch(() => null);
  if (!info?.isFile()) {
    throw directError(
      'Paid Meta source Wrangler config must be a regular file',
      'META_PAID_DIRECT_LARK_SOURCE_CONFIG_INVALID',
      { sourceConfigPath },
    );
  }
  const sourceText = await readFile(sourceConfigPath, 'utf8');
  const wranglerVars = readWranglerScalarVars(sourceText);
  const baseEnv = Object.freeze({
    ...wranglerVars,
    ...fileEnv,
    ...process.env,
    DEV_VARS_FILE: devVarsPath,
  });
  requireExact(baseEnv.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(baseEnv.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(baseEnv.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  const tableIds = readLarkTableIdsFromEnv(baseEnv, META_PAID_DIRECT_LARK_TABLE_KEYS);
  const tables = Object.freeze({
    ...tableIds,
    __metaLarkTableKeys: [...META_PAID_DIRECT_LARK_TABLE_KEYS],
  });

  stage = 'prepare-name-resolved-d1-config';
  const materialized = materializeNameResolvedD1Config(sourceText, 'MKT_STATE_DB');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'meta-paid-direct-lark-'));
  const temporaryConfigPath = join(temporaryRoot, 'wrangler.meta-paid-direct-lark.queryable.jsonc');
  await writeFile(temporaryConfigPath, materialized.text, { mode: 0o600 });
  await chmod(temporaryConfigPath, 0o600);
  const runtimeEnv = Object.freeze({
    ...baseEnv,
    MKT_META_D1_ONLY_WRANGLER_CONFIG: temporaryConfigPath,
  });

  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  evidenceRoot = join(repositoryRoot, 'outputs', 'meta-paid-direct-lark', repositoryHead, stamp);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  try {
    stage = 'snapshot-all-targets-before-lark';
    const snapshots = [];
    for (const target of META_PAID_DIRECT_LARK_TARGETS) {
      snapshots.push(await discoverTargetSnapshot(runtimeEnv, temporaryConfigPath, target));
    }
    await writePrivateJson(join(evidenceRoot, 'source-snapshots.json'), {
      contractVersion: META_PAID_DIRECT_LARK_CONTRACT_VERSION,
      databaseName: materialized.databaseName,
      databaseIdResolution: 'wrangler_by_database_name',
      sourceConfigModified: false,
      temporaryDatabaseIdRemoved: true,
      snapshots: snapshots.map(summarizeMetaPaidDirectSnapshot),
      remoteD1MutationCount: 0,
      queueSendCount: 0,
      workerDeployCount: 0,
      providerRequestCount: 0,
    });

    // All remote reads end before this boundary, so a transient D1 retry can never happen
    // after a Lark mutation has started.
    stage = 'materialize-live-lark';
    const infrastructure = createInfrastructure(baseEnv);
    const completed = [];
    for (const snapshot of snapshots) {
      completed.push(await materializeTarget({ snapshot, infrastructure, tables }));
    }

    stage = 'final-summary';
    const summary = {
      ok: true,
      accepted: completed.length === META_PAID_DIRECT_LARK_TARGETS.length
        && completed.every((item) => item.accepted === true && item.idempotentRerunVerified === true),
      contractVersion: META_PAID_DIRECT_LARK_CONTRACT_VERSION,
      repositoryHead,
      targets: completed,
      period: META_PAID_DIRECT_LARK_PERIOD,
      larkTableKeys: [...META_PAID_DIRECT_LARK_TABLE_KEYS],
      excludedLarkTableKeys: [...META_PAID_DIRECT_LARK_EXCLUDED_TABLE_KEYS],
      sourceMode: 'remote_d1_select_only_snapshot_before_lark',
      providerRequestCount: 0,
      remoteD1MutationCount: 0,
      queueSendCount: 0,
      workerDeployCount: 0,
      scheduleActivationCount: 0,
      facebookSyncExecutionCount: 0,
      instagramQueueSendCount: 0,
      production: false,
      marker: 'META_PAID_DIRECT_LARK_COMPLETED_SAFE',
    };
    if (!summary.accepted) {
      throw directError(
        'Paid Meta direct Lark summary is incomplete',
        'META_PAID_DIRECT_LARK_SUMMARY_INVALID',
      );
    }
    await writePrivateJson(join(evidenceRoot, 'summary.json'), summary);
    process.stdout.write(`${JSON.stringify({ ...summary, evidenceRoot }, null, 2)}\n`);
    process.stdout.write('META_PAID_DIRECT_LARK_COMPLETED_SAFE\n');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function discoverTargetSnapshot(env, configPath, target) {
  stage = `discover-${target}`;
  const candidateRows = await runD1Select(
    env,
    configPath,
    buildMetaPaidDirectCandidateSql(target),
    `candidate-${target}`,
  );
  const eligible = [];
  let eligibleGeneration = null;
  const rejected = [];

  for (const row of candidateRows) {
    let candidate;
    try {
      candidate = normalizeMetaPaidDirectCandidate(row, target);
    } catch (error) {
      if (error?.code !== 'META_PAID_DIRECT_LARK_SOURCE_INELIGIBLE') throw error;
      rejected.push({ code: error.code, workKey: safeWorkKey(row?.work_key) });
      continue;
    }
    if (eligibleGeneration !== null && candidate.generation < eligibleGeneration) break;
    const unitRows = await runD1Select(
      env,
      configPath,
      buildMetaPaidDirectUnitsSql(candidate.workKey),
      `units-${target}`,
    );
    try {
      const snapshot = validateMetaPaidDirectSourceSnapshot(
        candidate,
        normalizeMetaPaidDirectUnits(unitRows),
      );
      eligible.push(snapshot);
      eligibleGeneration ??= snapshot.generation;
    } catch (error) {
      if (error?.code !== 'META_PAID_DIRECT_LARK_SOURCE_INELIGIBLE') throw error;
      rejected.push({ code: error.code, workKey: candidate.workKey });
    }
  }

  try {
    return selectNewestMetaPaidDirectSnapshot(eligible, target);
  } catch (error) {
    if (error?.code === 'META_PAID_DIRECT_LARK_SOURCE_NOT_FOUND') {
      error.details = {
        ...error.details,
        candidateCount: candidateRows.length,
        rejectedCount: rejected.length,
      };
    }
    throw error;
  }
}

async function materializeTarget({ snapshot, infrastructure, tables }) {
  stage = `lark-${snapshot.target}-first-pass`;
  const firstStore = await createSeededMetaPaidDirectWorkStore(snapshot);
  larkWriteStarted = true;
  const first = await runExistingMetaPipeline({ snapshot, store: firstStore, infrastructure, tables });
  const firstReconciliation = validateMetaPaidDirectLarkResult(first);
  await writePrivateJson(join(evidenceRoot, `${snapshot.target}-first-pass.json`), {
    target: snapshot.target,
    operationId: snapshot.operationId,
    sourceSummary: snapshot.sourceSummary,
    reconciliation: firstReconciliation,
    remoteD1MutationCount: 0,
    queueSendCount: 0,
    workerDeployCount: 0,
    providerRequestCount: 0,
  });

  stage = `lark-${snapshot.target}-idempotent-replay`;
  const secondStore = await createSeededMetaPaidDirectWorkStore(snapshot);
  const second = await runExistingMetaPipeline({ snapshot, store: secondStore, infrastructure, tables });
  const replay = validateMetaPaidDirectLarkResult(second, { idempotent: true });
  const evidence = {
    accepted: true,
    target: snapshot.target,
    operationId: snapshot.operationId,
    workKey: snapshot.workKey,
    sourceAccountId: snapshot.sourceAccountId,
    sourceSummary: snapshot.sourceSummary,
    firstPass: firstReconciliation.larkResults,
    idempotentReplay: replay.larkResults,
    idempotentRerunVerified: true,
    larkTableKeys: [...META_PAID_DIRECT_LARK_TABLE_KEYS],
    excludedLarkTableKeys: [...META_PAID_DIRECT_LARK_EXCLUDED_TABLE_KEYS],
    providerRequestCount: 0,
    remoteD1MutationCount: 0,
    queueSendCount: 0,
    workerDeployCount: 0,
  };
  await writePrivateJson(join(evidenceRoot, `${snapshot.target}-idempotent-replay.json`), evidence);
  return Object.freeze(evidence);
}

async function runExistingMetaPipeline({ snapshot, store, infrastructure, tables }) {
  return processMetaEndToEndSync({
    connectorKey: 'meta_ads',
    jobType: JOB_TYPES.META_ADS_SYNC,
    operation: Object.freeze({
      operationId: snapshot.operationId,
      workKey: snapshot.workKey,
      generation: snapshot.generation,
      originalRequestedAt: snapshot.requestedAt,
      stable: true,
    }),
    syncRunId: `meta:meta_ads:${snapshot.target}:${snapshot.operationId}`,
    cursorKey: snapshot.cursorKey,
    assertLockActive: async () => undefined,
    adapter: createForbiddenMetaPaidDirectAdapter(),
    sourceAccountId: snapshot.sourceAccountId,
    accountKey: 'chemistry_k',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    sourceTimezone: 'Asia/Bangkok',
    dateRange: {
      since: META_PAID_DIRECT_LARK_PERIOD.since,
      until: META_PAID_DIRECT_LARK_PERIOD.until,
    },
    d1WriteEnabled: true,
    larkWriteEnabled: true,
    resumableWorkStore: store,
    historyStore: createForbiddenMetaPaidDirectHistoryStore(),
    organicHistoryGateway: null,
    repository: infrastructure.repository,
    syncEngine: infrastructure.syncEngine,
    tables,
    limits: DIRECT_LIMITS,
  });
}

async function runD1Select(env, configPath, sql, operation) {
  if (!/^\s*SELECT\b/iu.test(sql)
    || /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA)\b/iu.test(sql)) {
    throw directError(
      'Direct materializer D1 command is not SELECT-only',
      'META_PAID_DIRECT_LARK_D1_QUERY_NOT_READ_ONLY',
      { operation },
    );
  }
  for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
    try {
      const stdout = await runWranglerJson([
        'd1', 'execute', 'MKT_STATE_DB',
        '--remote', '--json', '--config', configPath,
        '--command', sql,
      ], env, operation);
      return parseWranglerD1Rows(stdout);
    } catch (error) {
      if (!isTransientReadError(error) || attempt === MAX_READ_ATTEMPTS) throw error;
      const retryDelayMs = READ_RETRY_DELAYS_MS[attempt - 1];
      process.stdout.write(`${JSON.stringify({
        ok: true,
        stage: 'direct-d1-read-retry-scheduled',
        operation,
        attempt,
        nextAttempt: attempt + 1,
        retryDelayMs,
        larkWriteStarted: false,
        remoteD1MutationCount: 0,
      }, null, 2)}\n`);
      await sleep(retryDelayMs);
    }
  }
  throw directError('Unreachable D1 read loop', 'META_PAID_DIRECT_LARK_D1_READ_FAILED');
}

async function runWranglerJson(args, env, operation) {
  try {
    const result = await execFileAsync('npx', ['wrangler', ...args], {
      cwd: repositoryRoot,
      env,
      encoding: 'utf8',
      timeout: READ_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    const stdout = String(result.stdout ?? '').trim();
    if (!stdout) {
      throw directError(
        `Wrangler ${operation} returned empty JSON`,
        'META_PAID_DIRECT_LARK_D1_JSON_EMPTY',
        { operation },
      );
    }
    return stdout;
  } catch (error) {
    if (error?.code === 'META_PAID_DIRECT_LARK_D1_JSON_EMPTY') throw error;
    throw directError(
      `Required read-only Wrangler ${operation} failed`,
      'META_PAID_DIRECT_LARK_D1_READ_FAILED',
      {
        operation,
        exitCode: Number.isInteger(error?.code) ? error.code : (error?.exitCode ?? null),
        signal: error?.signal ?? null,
        timedOut: error?.killed === true && error?.signal === 'SIGTERM',
        errorMessage: sanitizeCliOutput(error instanceof Error ? error.message : error),
        stdout: sanitizeCliOutput(error?.stdout),
        stderr: sanitizeCliOutput(error?.stderr),
      },
    );
  }
}

function isTransientReadError(error) {
  const text = JSON.stringify(error?.details ?? {});
  return /\[code:\s*7500\]|"code"\s*:\s*7500|internal error;\s*reference\s*=|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|\b429\b|\b5\d\d\b/iu.test(text)
    || error?.details?.timedOut === true;
}

function requireConfirmation(env) {
  const expected = META_PAID_DIRECT_LARK_CONFIRMATION;
  if (env?.[expected.envName] !== expected.value) {
    throw directError(
      `Paid Meta direct Lark execution requires ${expected.envName}=${expected.value}`,
      'META_PAID_DIRECT_LARK_CONFIRMATION_REQUIRED',
    );
  }
}

function assertExactCleanMain() {
  const branch = gitText(['branch', '--show-current']);
  const head = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (branch !== 'main' || head !== originMain || dirty.trim() !== '') {
    throw directError(
      'Paid Meta direct Lark execution requires exact clean main equal to origin/main',
      'META_PAID_DIRECT_LARK_REPOSITORY_INVALID',
      { branch, head, originMain, clean: dirty.trim() === '' },
    );
  }
  return head;
}

function gitText(args, requireOutput = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw directError(
      `git ${args.join(' ')} failed`,
      'META_PAID_DIRECT_LARK_GIT_FAILED',
      { stderr: sanitizeCliOutput(result.stderr) },
    );
  }
  const text = String(result.stdout ?? '').trim();
  if (requireOutput && !text) {
    throw directError(
      `git ${args.join(' ')} returned empty output`,
      'META_PAID_DIRECT_LARK_GIT_FAILED',
    );
  }
  return text;
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function safeWorkKey(value) {
  if (typeof value !== 'string') return null;
  return /^meta_ads:chemistry_k[23]:meta-chemistry_k[23]-history-20260701-20260731-[0-9a-f]{12}$/u.test(value)
    ? value
    : null;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw directError(
      'Unsupported paid Meta direct Lark arguments',
      'META_PAID_DIRECT_LARK_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw directError(
      `Paid Meta direct Lark execution requires ${fieldName}=${expected}`,
      'META_PAID_DIRECT_LARK_TARGET_INVALID',
      { fieldName },
    );
  }
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|payload|state_json|completion_json/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function directError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidDirectLarkMaterializeError';
  error.code = code;
  error.details = details;
  return error;
}
