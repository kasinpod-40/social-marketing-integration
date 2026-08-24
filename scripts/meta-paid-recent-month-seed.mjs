#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildMetaAdsWriteSet } from '../packages/application/src/use-cases/build-meta-ads-write-set.js';
import { loadMetaTokenConnectionConfig } from '../packages/config/src/meta-token-connection-config.js';
import { readLarkTableIdsFromEnv } from '../packages/config/src/lark-table-config.js';
import { MetaGraphClient } from '../packages/connectors/src/meta/meta-graph.client.js';
import { createMetaTokenConnectionRuntime } from '../packages/connectors/src/meta/meta-token-connection-runtime.js';
import { createInfrastructure } from '../apps/sync-worker/src/runtime-infrastructure.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  META_PAID_PROVIDER_DIRECT_LARK_EXCLUDED_TABLE_KEYS,
  META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS,
  executeMetaPaidProviderLarkPlan,
  planMetaPaidProviderLarkTarget,
  validateMetaPaidProviderLarkResults,
} from './lib/meta-paid-provider-direct-lark-materializer.js';
import {
  META_PAID_RECENT_MONTH_SEED_CONTRACT_VERSION,
  META_PAID_RECENT_MONTH_SEED_PERIOD,
  META_PAID_RECENT_MONTH_SEED_TARGETS,
  collectMetaPaidRecentMonthSeedSource,
} from './lib/meta-paid-recent-month-seed-source.js';
import { sanitizeCliOutput } from './lib/sanitize-cli-output.js';
import { readWranglerScalarVars } from './lib/wrangler-jsonc-vars.js';

const CONFIRMATION_ENV = 'CONFIRM_META_PAID_RECENT_MONTH_SEED';
const CONFIRMATION_VALUE = 'RUN_META_PAID_RECENT_MONTH_SEED';
const PROVIDER_PAGE_SIZE = 100;
const GRAPH_BASE_URL = 'https://graph.facebook.com';
const repositoryRoot = resolve(process.cwd());

let stage = 'init';
let providerReadStarted = false;
let providerRequestCount = 0;
let larkWriteStarted = false;
let checkpointRoot = null;
let evidenceRoot = null;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) printPlan();
  else await executeSeed();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'META_PAID_RECENT_MONTH_SEED_FAILED',
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
    ...(checkpointRoot ? { checkpointRoot } : {}),
    ...(evidenceRoot ? { evidenceRoot } : {}),
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: META_PAID_RECENT_MONTH_SEED_CONTRACT_VERSION,
    targets: META_PAID_RECENT_MONTH_SEED_TARGETS,
    period: META_PAID_RECENT_MONTH_SEED_PERIOD,
    periodSemantics: 'latest_31_complete_reporting_days_ending_yesterday_at_review_time',
    sourceOrder: [
      'meta_ads.account.latest',
      'meta_ads.performance.daily',
      'unique_daily_ad_ids',
      'activity_scoped_ad_creative_lookup',
    ],
    fullCreativeInventoryScan: false,
    providerPageSize: PROVIDER_PAGE_SIZE,
    larkTableKeys: META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS,
    excludedLarkTableKeys: META_PAID_PROVIDER_DIRECT_LARK_EXCLUDED_TABLE_KEYS,
    allProviderReadsBeforeLarkWrite: true,
    allTargetsPreflightBeforeLarkWrite: true,
    idempotentReplayRequired: true,
    privateCheckpointOutsideGit: true,
    remoteD1ReadAllowed: false,
    remoteD1MutationAllowed: false,
    queueSendAllowed: false,
    workerDeployAllowed: false,
    scheduleActivationAllowed: false,
    existingScheduledProducer: 'daily_completed_period_only',
    production: false,
  }, null, 2)}\n`);
}

async function executeSeed() {
  requireConfirmation(process.env);

  stage = 'exact-clean-main';
  const repositoryHead = assertExactCleanMain();

  stage = 'load-private-runtime';
  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const devInfo = await stat(devVarsPath).catch(() => null);
  if (!devInfo?.isFile()) {
    throw operatorError(
      'Paid Meta recent-month seed requires a private DEV vars file',
      'META_PAID_RECENT_MONTH_SEED_DEV_VARS_INVALID',
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
  const configInfo = await stat(sourceConfigPath).catch(() => null);
  if (!configInfo?.isFile()) {
    throw operatorError(
      'Paid Meta recent-month seed runtime config must be a regular file',
      'META_PAID_RECENT_MONTH_SEED_RUNTIME_CONFIG_INVALID',
    );
  }
  const wranglerVars = readWranglerScalarVars(await readFile(sourceConfigPath, 'utf8'));
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
  checkpointRoot = resolve(
    process.env.META_PAID_RECENT_MONTH_SEED_CHECKPOINT_ROOT
      ?? join(homedir(), '.cache', 'social-mkt', 'meta-paid-recent-month-seed-v1', repositoryHead),
  );
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  evidenceRoot = join(repositoryRoot, 'outputs', 'meta-paid-recent-month-seed', repositoryHead, stamp);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  const providerEnv = Object.freeze({
    ...baseEnv,
    META_PAGE_SIZE: String(PROVIDER_PAGE_SIZE),
  });
  const onRequest = (event) => {
    if (event?.stage === 'meta_request_start') providerRequestCount += 1;
  };

  stage = 'create-get-only-provider-runtime';
  const runtime = createMetaTokenConnectionRuntime(providerEnv, { onRequest });
  const adapter = runtime?.sources?.meta_ads;
  if (!adapter) {
    throw operatorError(
      'Paid Meta source credential is unavailable',
      'META_PAID_RECENT_MONTH_SEED_PROVIDER_UNAVAILABLE',
    );
  }
  const metaConfig = loadMetaTokenConnectionConfig(providerEnv);
  if (!metaConfig.credentials.facebookAccessToken) {
    throw operatorError(
      'Paid Meta source credential is unavailable',
      'META_PAID_RECENT_MONTH_SEED_PROVIDER_UNAVAILABLE',
    );
  }
  const activityClient = new MetaGraphClient({
    accessToken: metaConfig.credentials.facebookAccessToken,
    apiVersion: metaConfig.apiVersion,
    baseUrl: GRAPH_BASE_URL,
    timeoutMs: metaConfig.transport.timeoutMs,
    maxPages: metaConfig.transport.maxPages,
    pageSize: PROVIDER_PAGE_SIZE,
    maxAttempts: metaConfig.transport.maxAttempts,
    maxResponseBytes: metaConfig.transport.maxResponseBytes,
    onRequest,
  });
  const configuredAccounts = Array.isArray(runtime?.mappings?.metaAdAccounts)
    ? runtime.mappings.metaAdAccounts
    : [];

  stage = 'snapshot-recent-month-before-lark';
  providerReadStarted = true;
  const requestedAt = Date.now();
  const sources = [];
  for (const target of META_PAID_RECENT_MONTH_SEED_TARGETS) {
    const matches = configuredAccounts.filter((entry) => entry?.key === target && entry?.accountId);
    if (matches.length !== 1) {
      throw operatorError(
        'Paid Meta reviewed provider account mapping is missing or ambiguous',
        'META_PAID_RECENT_MONTH_SEED_ACCOUNT_MAPPING_INVALID',
        { target, matchCount: matches.length },
      );
    }
    stage = `provider-${target}`;
    sources.push(await collectMetaPaidRecentMonthSeedSource({
      target,
      sourceAccountId: matches[0].accountId,
      repositoryHead,
      requestedAt,
      adapter,
      checkpointRoot,
      onProgress: printProviderProgress,
      lookupCreativeForAd: async ({ adAccountId, adId }) => lookupActivityCreative({
        activityClient,
        adAccountId,
        adId,
      }),
    }));
  }

  await writePrivateJson(join(evidenceRoot, 'source-summaries.json'), {
    contractVersion: META_PAID_RECENT_MONTH_SEED_CONTRACT_VERSION,
    repositoryHead,
    period: META_PAID_RECENT_MONTH_SEED_PERIOD,
    providerRequestCount,
    sourceMode: 'daily_first_activity_scoped_creatives',
    snapshots: sources.map((source) => ({
      target: source.target,
      operationId: source.operationId,
      sourceSummary: source.sourceSummary,
    })),
    providerMutationCount: 0,
    remoteD1ReadCount: 0,
    remoteD1MutationCount: 0,
  });

  stage = 'build-canonical-two-table-payloads';
  const targetPayloads = [];
  for (const source of sources) {
    targetPayloads.push(Object.freeze({
      source,
      writeSet: await buildSeedWriteSet(source),
    }));
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
    allTargetsPreflightedBeforeWrite: true,
    larkWriteStarted: false,
    targets: firstPlans.map(({ payload, planned }) => ({
      target: payload.source.target,
      tables: summarizePlan(planned),
    })),
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
    accepted: targets.length === META_PAID_RECENT_MONTH_SEED_TARGETS.length
      && targets.every((entry) => entry.accepted && entry.idempotentRerunVerified),
    contractVersion: META_PAID_RECENT_MONTH_SEED_CONTRACT_VERSION,
    repositoryHead,
    period: META_PAID_RECENT_MONTH_SEED_PERIOD,
    targets,
    sourceMode: 'daily_first_activity_scoped_creatives',
    fullCreativeInventoryScan: false,
    larkTableKeys: [...META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS],
    excludedLarkTableKeys: [...META_PAID_PROVIDER_DIRECT_LARK_EXCLUDED_TABLE_KEYS],
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
    marker: 'META_PAID_RECENT_MONTH_SEED_COMPLETED_SAFE',
  };
  if (!summary.accepted) {
    throw operatorError(
      'Paid Meta recent-month seed summary is incomplete',
      'META_PAID_RECENT_MONTH_SEED_SUMMARY_INVALID',
    );
  }
  await writePrivateJson(join(evidenceRoot, 'summary.json'), summary);
  process.stdout.write(`${JSON.stringify({ ...summary, checkpointRoot, evidenceRoot }, null, 2)}\n`);
  process.stdout.write('META_PAID_RECENT_MONTH_SEED_COMPLETED_SAFE\n');
}

async function lookupActivityCreative({ activityClient, adAccountId, adId }) {
  const accountId = normalizeAdAccountId(adAccountId);
  const expectedAdId = requireNumericId(adId, 'adId');
  const resource = await activityClient.get(expectedAdId, {
    fields: 'id,account_id,creative{id,name,object_story_id,object_type,thumbnail_url,url_tags}',
  }, {
    operationName: 'meta_ads.activity_ad_creative',
  });
  const observedAdId = requireNumericId(resource?.id, 'Meta ad id');
  const observedAccountId = normalizeAdAccountId(resource?.account_id);
  if (observedAdId !== expectedAdId || observedAccountId !== accountId) {
    throw operatorError(
      'Paid Meta activity Creative identity mismatch',
      'META_PAID_RECENT_MONTH_SEED_ACTIVITY_IDENTITY_MISMATCH',
    );
  }
  return Object.freeze({
    adId: observedAdId,
    accountId: observedAccountId,
    creative: resource?.creative && typeof resource.creative === 'object'
      ? Object.freeze({ ...resource.creative })
      : null,
  });
}

async function buildSeedWriteSet(source) {
  const accountResource = source.accountResource;
  return buildMetaAdsWriteSet({
    accountId: source.sourceAccountId,
    accountKey: 'chemistry_k',
    customerKey: 'chemistry_k',
    syncRunId: `meta:meta_ads:${source.target}:${source.operationId}`,
    operationId: source.operationId,
    fetchedAt: source.requestedAt,
    completedAt: source.requestedAt,
    sourceRevision: source.operationId,
    sourceWatermark: null,
    accountTimezone: requireText(accountResource?.timezone_name, 'Meta Ads account timezone_name'),
    currency: requireText(accountResource?.currency, 'Meta Ads account currency'),
    entityScopeMode: 'report_range',
    larkProjectionMode: 'curated_reports',
    periodStart: source.period.since,
    periodEnd: source.period.until,
    accountResource,
    campaigns: [],
    adSets: [],
    ads: [],
    creatives: source.creatives,
    dailyInsights: source.dailyInsights,
  });
}

function printProviderProgress(event = {}) {
  if (!['provider-read-page', 'provider-checkpoint-complete'].includes(event.stage)) return;
  const datasetKey = event.datasetKey ?? null;
  const isCreative = datasetKey === 'meta_ads.creatives.activity_scoped';
  const terminal = event.hasMore === false
    || event.stage === 'provider-checkpoint-complete'
    || (isCreative && event.index === event.total);
  const milestone = isCreative
    ? event.index === 1 || event.index % 25 === 0
    : event.page === 1 || event.page % 10 === 0;
  if (!terminal && !milestone) return;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: event.stage === 'provider-checkpoint-complete'
      ? 'provider-source-checkpoint-resume'
      : 'provider-source-progress',
    target: event.target,
    datasetKey,
    page: event.page ?? null,
    index: event.index ?? null,
    total: event.total ?? null,
    rows: event.rows ?? null,
    pageRows: event.pageRows ?? null,
    resumedFromPages: event.resumedFromPages ?? 0,
    providerRequestCount,
    larkWriteStarted: false,
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
  if (env?.[CONFIRMATION_ENV] !== CONFIRMATION_VALUE) {
    throw operatorError(
      `Paid Meta recent-month seed requires ${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
      'META_PAID_RECENT_MONTH_SEED_CONFIRMATION_REQUIRED',
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
      'Paid Meta recent-month seed requires exact clean main equal to origin/main',
      'META_PAID_RECENT_MONTH_SEED_REPOSITORY_INVALID',
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
      'META_PAID_RECENT_MONTH_SEED_GIT_FAILED',
      { stderr: sanitizeCliOutput(result.stderr) },
    );
  }
  const text = String(result.stdout ?? '').trim();
  if (requireOutput && !text) {
    throw operatorError(
      `git ${args.join(' ')} returned empty output`,
      'META_PAID_RECENT_MONTH_SEED_GIT_FAILED',
    );
  }
  return text;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw operatorError(
      'Unsupported paid Meta recent-month seed arguments',
      'META_PAID_RECENT_MONTH_SEED_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw operatorError(
      `Paid Meta recent-month seed requires ${fieldName}=${expected}`,
      'META_PAID_RECENT_MONTH_SEED_TARGET_INVALID',
      { fieldName },
    );
  }
}

function normalizeAdAccountId(value) {
  const text = requireText(value, 'adAccountId').replace(/^act_/iu, '');
  if (!/^\d+$/u.test(text)) throw new TypeError('adAccountId must be numeric');
  return text;
}

function requireNumericId(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d+$/u.test(text)) throw new TypeError(`${fieldName} must be numeric`);
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`${fieldName} must be text`);
  const text = String(value).trim();
  if (!text) throw new TypeError(`${fieldName} must be non-empty text`);
  return text;
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
  error.name = 'MetaPaidRecentMonthSeedOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
