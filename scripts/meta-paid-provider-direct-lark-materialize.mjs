#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readLarkTableIdsFromEnv } from '../packages/config/src/lark-table-config.js';
import { createMetaTokenConnectionRuntime } from '../packages/connectors/src/meta/meta-token-connection-runtime.js';
import { createInfrastructure } from '../apps/sync-worker/src/runtime-infrastructure.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  META_PAID_PROVIDER_DIRECT_LARK_CONFIRMATION,
  META_PAID_PROVIDER_DIRECT_LARK_CONTRACT_VERSION,
  META_PAID_PROVIDER_DIRECT_LARK_EXCLUDED_TABLE_KEYS,
  META_PAID_PROVIDER_DIRECT_LARK_MAX_PAGES,
  META_PAID_PROVIDER_DIRECT_LARK_MAX_ROWS_PER_DATASET,
  META_PAID_PROVIDER_DIRECT_LARK_PERIOD,
  META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS,
  META_PAID_PROVIDER_DIRECT_LARK_TARGETS,
  buildMetaPaidProviderLarkWriteSet,
  collectMetaPaidProviderSource,
  executeMetaPaidProviderLarkPlan,
  planMetaPaidProviderLarkTarget,
  summarizeMetaPaidProviderSource,
  validateMetaPaidProviderLarkResults,
} from './lib/meta-paid-provider-direct-lark-materializer.js';
import { sanitizeCliOutput } from './lib/sanitize-cli-output.js';
import { readWranglerScalarVars } from './lib/wrangler-jsonc-vars.js';

const repositoryRoot = resolve(process.cwd());
let stage = 'init';
let larkWriteStarted = false;
let providerReadStarted = false;
let providerRequestCount = 0;
let evidenceRoot = null;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) printPlan();
  else await executeProviderDirectMaterialization();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'META_PAID_PROVIDER_DIRECT_LARK_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    providerReadStarted,
    providerRequestCount,
    larkWriteStarted,
    remoteD1ReadCount: 0,
    remoteD1MutationCount: 0,
    queueSendCount: 0,
    workerDeployCount: 0,
    scheduleActivationCount: 0,
    facebookSyncExecutionCount: 0,
    instagramSyncExecutionCount: 0,
    production: false,
    ...(evidenceRoot ? { evidenceRoot } : {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: META_PAID_PROVIDER_DIRECT_LARK_CONTRACT_VERSION,
    targets: META_PAID_PROVIDER_DIRECT_LARK_TARGETS,
    period: META_PAID_PROVIDER_DIRECT_LARK_PERIOD,
    larkTableKeys: META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS,
    excludedLarkTableKeys: META_PAID_PROVIDER_DIRECT_LARK_EXCLUDED_TABLE_KEYS,
    source: 'meta_provider_get_only_local_snapshot_before_lark',
    providerReadAllowed: true,
    providerMutationAllowed: false,
    providerRecoveryMaxPagesPerDataset: META_PAID_PROVIDER_DIRECT_LARK_MAX_PAGES,
    providerRecoveryMaxRowsPerDataset: META_PAID_PROVIDER_DIRECT_LARK_MAX_ROWS_PER_DATASET,
    remoteD1ReadAllowed: false,
    remoteD1MutationAllowed: false,
    queueSendAllowed: false,
    workerDeployAllowed: false,
    scheduleActivationAllowed: false,
    larkPreflight: 'all_targets_all_tables_before_first_write',
    idempotency: 'fresh_second_lark_plan_and_replay',
    production: false,
  }, null, 2)}\n`);
}

async function executeProviderDirectMaterialization() {
  requireConfirmation(process.env);
  stage = 'exact-clean-main';
  const repositoryHead = assertExactCleanMain();

  stage = 'load-private-runtime';
  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const devInfo = await stat(devVarsPath).catch(() => null);
  if (!devInfo?.isFile()) {
    throw operatorError(
      'Paid Meta provider direct Lark execution requires a private DEV vars file',
      'META_PAID_PROVIDER_DIRECT_LARK_DEV_VARS_INVALID',
    );
  }
  const fileEnv = await readDevVars(devVarsPath);
  const sourceConfigPath = resolve(
    process.env.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? fileEnv.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? process.env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG
      ?? fileEnv.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
  );
  const sourceInfo = await stat(sourceConfigPath).catch(() => null);
  if (!sourceInfo?.isFile()) {
    throw operatorError(
      'Paid Meta provider direct Lark runtime config must be a regular file',
      'META_PAID_PROVIDER_DIRECT_LARK_RUNTIME_CONFIG_INVALID',
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
  const tableIds = readLarkTableIdsFromEnv(baseEnv, META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS);
  const tables = Object.freeze({ ...tableIds });

  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  evidenceRoot = join(
    repositoryRoot,
    'outputs',
    'meta-paid-provider-direct-lark',
    repositoryHead,
    stamp,
  );
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  stage = 'create-get-only-provider-runtime';
  const runtime = createMetaTokenConnectionRuntime(baseEnv, {
    onRequest(event) {
      if (event?.stage === 'meta_request_start') providerRequestCount += 1;
    },
  });
  const adapter = runtime?.sources?.meta_ads;
  if (!adapter) {
    throw operatorError(
      'Paid Meta provider source credential is unavailable',
      'META_PAID_PROVIDER_DIRECT_LARK_PROVIDER_UNAVAILABLE',
    );
  }
  const configuredAccounts = Array.isArray(runtime?.mappings?.metaAdAccounts)
    ? runtime.mappings.metaAdAccounts
    : [];

  // Complete every Provider GET before creating a Lark write plan. This guarantees that
  // a Provider retry/failure can never occur after a Lark mutation has started.
  stage = 'snapshot-all-provider-targets-before-lark';
  providerReadStarted = true;
  const requestedAt = Date.now();
  const sources = [];
  for (const target of META_PAID_PROVIDER_DIRECT_LARK_TARGETS) {
    const matches = configuredAccounts.filter((entry) => entry?.key === target && entry?.accountId);
    if (matches.length !== 1) {
      throw operatorError(
        'Paid Meta reviewed provider account mapping is missing or ambiguous',
        'META_PAID_PROVIDER_DIRECT_LARK_ACCOUNT_MAPPING_INVALID',
        { target, matchCount: matches.length },
      );
    }
    stage = `provider-${target}`;
    sources.push(await collectMetaPaidProviderSource({
      target,
      sourceAccountId: matches[0].accountId,
      repositoryHead,
      requestedAt,
      adapter,
      onProgress: printProviderProgress,
    }));
  }

  await writePrivateJson(join(evidenceRoot, 'source-summaries.json'), {
    contractVersion: META_PAID_PROVIDER_DIRECT_LARK_CONTRACT_VERSION,
    repositoryHead,
    period: META_PAID_PROVIDER_DIRECT_LARK_PERIOD,
    snapshots: sources.map(summarizeMetaPaidProviderSource),
    providerRequestCount,
    providerMutationCount: 0,
    remoteD1ReadCount: 0,
    remoteD1MutationCount: 0,
    queueSendCount: 0,
    workerDeployCount: 0,
  });

  stage = 'build-canonical-two-table-payloads';
  const targetPayloads = [];
  for (const source of sources) {
    const writeSet = await buildMetaPaidProviderLarkWriteSet(source);
    targetPayloads.push(Object.freeze({ source, writeSet }));
  }

  stage = 'lark-preflight-all-targets';
  const infrastructure = createInfrastructure(baseEnv);
  const firstPlans = [];
  for (const payload of targetPayloads) {
    const planned = await planMetaPaidProviderLarkTarget({
      target: payload.source.target,
      writeSet: payload.writeSet,
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      tables,
    });
    firstPlans.push(Object.freeze({ payload, planned }));
  }
  await writePrivateJson(join(evidenceRoot, 'lark-preflight.json'), {
    targets: firstPlans.map(({ payload, planned }) => ({
      target: payload.source.target,
      tables: summarizePlan(planned),
    })),
    allTargetsPreflightedBeforeWrite: true,
    larkWriteStarted: false,
  });

  stage = 'lark-first-pass';
  larkWriteStarted = true;
  const firstPass = [];
  for (const { payload, planned } of firstPlans) {
    const results = await executeMetaPaidProviderLarkPlan({
      planned,
      syncEngine: infrastructure.syncEngine,
    });
    validateMetaPaidProviderLarkResults(results);
    firstPass.push(Object.freeze({
      target: payload.source.target,
      operationId: payload.source.operationId,
      results,
    }));
  }
  await writePrivateJson(join(evidenceRoot, 'first-pass.json'), { targets: firstPass });

  stage = 'lark-idempotent-replay';
  const replays = [];
  for (const payload of targetPayloads) {
    const planned = await planMetaPaidProviderLarkTarget({
      target: payload.source.target,
      writeSet: payload.writeSet,
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      tables,
    });
    const results = await executeMetaPaidProviderLarkPlan({
      planned,
      syncEngine: infrastructure.syncEngine,
    });
    validateMetaPaidProviderLarkResults(results, { idempotent: true });
    replays.push(Object.freeze({
      target: payload.source.target,
      operationId: payload.source.operationId,
      results,
      idempotentRerunVerified: true,
    }));
  }
  await writePrivateJson(join(evidenceRoot, 'idempotent-replay.json'), { targets: replays });

  stage = 'final-summary';
  const targets = targetPayloads.map(({ source }) => {
    const first = firstPass.find((entry) => entry.target === source.target);
    const replay = replays.find((entry) => entry.target === source.target);
    return Object.freeze({
      accepted: Boolean(first && replay?.idempotentRerunVerified === true),
      target: source.target,
      operationId: source.operationId,
      sourceSummary: source.sourceSummary,
      firstPass: first?.results ?? [],
      idempotentReplay: replay?.results ?? [],
      idempotentRerunVerified: replay?.idempotentRerunVerified === true,
    });
  });
  const summary = {
    ok: true,
    accepted: targets.length === META_PAID_PROVIDER_DIRECT_LARK_TARGETS.length
      && targets.every((entry) => entry.accepted && entry.idempotentRerunVerified),
    contractVersion: META_PAID_PROVIDER_DIRECT_LARK_CONTRACT_VERSION,
    repositoryHead,
    targets,
    period: META_PAID_PROVIDER_DIRECT_LARK_PERIOD,
    larkTableKeys: [...META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS],
    excludedLarkTableKeys: [...META_PAID_PROVIDER_DIRECT_LARK_EXCLUDED_TABLE_KEYS],
    sourceMode: 'meta_provider_get_only_snapshot_before_lark',
    allProviderReadsCompletedBeforeLarkWrite: true,
    allTargetsPreflightedBeforeLarkWrite: true,
    providerRequestCount,
    providerMutationCount: 0,
    remoteD1ReadCount: 0,
    remoteD1MutationCount: 0,
    queueSendCount: 0,
    workerDeployCount: 0,
    scheduleActivationCount: 0,
    facebookSyncExecutionCount: 0,
    instagramSyncExecutionCount: 0,
    production: false,
    marker: 'META_PAID_PROVIDER_DIRECT_LARK_COMPLETED_SAFE',
  };
  if (!summary.accepted) {
    throw operatorError(
      'Paid Meta provider direct Lark summary is incomplete',
      'META_PAID_PROVIDER_DIRECT_LARK_SUMMARY_INVALID',
    );
  }
  await writePrivateJson(join(evidenceRoot, 'summary.json'), summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidenceRoot }, null, 2)}\n`);
  process.stdout.write('META_PAID_PROVIDER_DIRECT_LARK_COMPLETED_SAFE\n');
}

function printProviderProgress(event = {}) {
  if (event.stage !== 'provider-read-page' && event.stage !== 'provider-read-complete') return;
  const finalPage = event.stage === 'provider-read-complete' || event.hasMore === false;
  if (!finalPage && event.page !== 1 && event.page % 10 !== 0) return;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'provider-source-progress',
    target: event.target,
    datasetKey: event.datasetKey,
    page: event.page,
    pageRows: event.pageRows ?? null,
    rows: event.rows ?? null,
    hasMore: event.hasMore ?? false,
    providerRequestCount,
    larkWriteStarted: false,
    remoteD1MutationCount: 0,
  })}\n`);
}

function summarizePlan(planned) {
  return planned.items.map((item) => ({
    tableKey: item.tableKey,
    expected: item.expected,
    create: Array.isArray(item.plan?.createRows) ? item.plan.createRows.length : null,
    update: Array.isArray(item.plan?.updateRows) ? item.plan.updateRows.length : null,
    skipped: Number.isSafeInteger(Number(item.plan?.skipped)) ? Number(item.plan.skipped) : null,
  }));
}

function requireConfirmation(env) {
  const expected = META_PAID_PROVIDER_DIRECT_LARK_CONFIRMATION;
  if (env?.[expected.envName] !== expected.value) {
    throw operatorError(
      `Paid Meta provider direct Lark execution requires ${expected.envName}=${expected.value}`,
      'META_PAID_PROVIDER_DIRECT_LARK_CONFIRMATION_REQUIRED',
    );
  }
}

function assertExactCleanMain() {
  const branch = gitText(['branch', '--show-current']);
  const head = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (branch !== 'main' || head !== originMain || dirty.trim() !== '') {
    throw operatorError(
      'Paid Meta provider direct Lark execution requires exact clean main equal to origin/main',
      'META_PAID_PROVIDER_DIRECT_LARK_REPOSITORY_INVALID',
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
    throw operatorError(
      `git ${args.join(' ')} failed`,
      'META_PAID_PROVIDER_DIRECT_LARK_GIT_FAILED',
      { stderr: sanitizeCliOutput(result.stderr) },
    );
  }
  const text = String(result.stdout ?? '').trim();
  if (requireOutput && !text) {
    throw operatorError(
      `git ${args.join(' ')} returned empty output`,
      'META_PAID_PROVIDER_DIRECT_LARK_GIT_FAILED',
    );
  }
  return text;
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw operatorError(
      'Unsupported paid Meta provider direct Lark arguments',
      'META_PAID_PROVIDER_DIRECT_LARK_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw operatorError(
      `Paid Meta provider direct Lark execution requires ${fieldName}=${expected}`,
      'META_PAID_PROVIDER_DIRECT_LARK_TARGET_INVALID',
      { fieldName },
    );
  }
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|payload|cursor/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidProviderDirectLarkMaterializeError';
  error.code = code;
  error.details = details;
  return error;
}
