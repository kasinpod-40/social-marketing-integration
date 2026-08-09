#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES } from '../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { collectLarkNativeAiWeekly7dControlledUatSource } from './lib/lark-native-ai-weekly-7d-controlled-uat.js';
import { diagnoseLarkWeekly7dFactualSource } from './lib/lark-weekly-7d-factual-source-diagnostics.js';

const CONTRACT_VERSION = 'lark_weekly_7d_factual_source_diagnostics_v1';
const CONFIG_PATH = resolve(process.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc');
const DEV_VARS_PATH = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const AUTH_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
const TABLES_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables$/u;
const RECORDS_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records$/u;
const RECORD_SEARCH_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records\/search$/u;

let stage = 'init';
let repository = null;
const counters = { token: 0, tableRead: 0, recordListRead: 0, recordSearchRead: 0, blocked: 0 };

try {
  if (process.argv.length !== 2) throw fail('This operator accepts no arguments', 'LARK_WEEKLY_7D_FACTUAL_DIAGNOSTICS_ARGUMENT_INVALID');
  stage = 'repository-preflight';
  repository = readRepositoryState();
  if (repository.branch !== 'main' || repository.clean !== true || repository.head !== repository.originMain) {
    throw fail('Diagnostics requires clean current main', 'LARK_WEEKLY_7D_FACTUAL_DIAGNOSTICS_REPOSITORY_INVALID', repository);
  }

  stage = 'load-local-environment';
  const config = parseJsoncObject(await readFile(CONFIG_PATH, 'utf8'));
  let devVars = {};
  try { devVars = await readDevVars(DEV_VARS_PATH); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const env = Object.freeze({ ...(config.vars ?? {}), ...devVars, ...process.env });
  if (env.MKT_ENV !== 'development' || env.MKT_CUSTOMER_PROFILE !== 'integration_workspace') {
    throw fail('Diagnostics requires Integration Workspace runtime', 'LARK_WEEKLY_7D_FACTUAL_DIAGNOSTICS_ENV_INVALID');
  }

  stage = 'initialize-read-only-lark-boundary';
  const rawClient = createLarkBitableClientFromEnv(Object.freeze({
    ...env,
    LARK_MAX_ATTEMPTS: '1',
    LARK_MAX_PAGES: '10',
    LARK_MAX_FILTER_CONDITIONS: '50',
    LARK_REQUEST_TIMEOUT_MS: '30000',
    LARK_MIN_REQUEST_INTERVAL_MS: '150',
  }), { fetchImpl: readOnlyFetch });

  stage = 'read-table-inventory';
  const inventory = await rawClient.listTables();
  for (const name of Object.values(LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES)) {
    const matches = inventory.filter((table) => table.name === name && table.tableId);
    if (matches.length !== 1) throw fail(
      'Weekly factual diagnostics requires exact Lark table inventory',
      'LARK_WEEKLY_7D_FACTUAL_DIAGNOSTICS_TABLE_INVALID',
      { name, matchCount: matches.length },
    );
  }
  const client = Object.freeze({
    listTables: async () => inventory,
    listRecordsPage: (input) => rawClient.listRecordsPage(input),
    searchRecordsByFieldValues: (input) => rawClient.searchRecordsByFieldValues(input),
  });

  stage = 'collect-aligned-weekly-source';
  const source = await collectLarkNativeAiWeekly7dControlledUatSource({ client });
  stage = 'classify-factual-source';
  const diagnostics = diagnoseLarkWeekly7dFactualSource({ reportBundles: source.reportBundles });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    mode: 'READ_ONLY',
    stage: 'complete',
    status: 'weekly_7d_factual_source_diagnostics_complete',
    repository,
    selectionPolicy: source.selectionPolicy,
    targetPeriod: source.targetPeriod,
    sourceReportIds: source.sourceReportIds,
    selectedChannels: source.selectedChannels,
    channelCount: diagnostics.channelCount,
    sourceReportChannelCount: diagnostics.sourceReportChannelCount,
    businessFactChannelCount: diagnostics.businessFactChannelCount,
    channels: diagnostics.channels,
    remote: Object.freeze({ ...counters }),
    recordWriteCount: 0,
    queueAdmissionCount: 0,
    messageSendCount: 0,
    workerDeploymentCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: CONTRACT_VERSION,
    mode: 'READ_ONLY',
    stage,
    code: error?.code ?? 'LARK_WEEKLY_7D_FACTUAL_DIAGNOSTICS_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    repository,
    remote: Object.freeze({ ...counters }),
    recordWriteCount: 0,
    queueAdmissionCount: 0,
    messageSendCount: 0,
    workerDeploymentCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function readOnlyFetch(input, init = {}) {
  const url = new URL(resolveUrl(input));
  const method = String(init.method ?? input?.method ?? 'GET').toUpperCase();
  const path = url.pathname;
  if (method === 'POST' && path === AUTH_PATH) counters.token += 1;
  else if (method === 'GET' && TABLES_PATH.test(path)) counters.tableRead += 1;
  else if (method === 'GET' && RECORDS_PATH.test(path)) counters.recordListRead += 1;
  else if (method === 'POST' && RECORD_SEARCH_PATH.test(path)) counters.recordSearchRead += 1;
  else {
    counters.blocked += 1;
    throw fail('Read-only diagnostics blocked a non-read Lark request', 'LARK_WEEKLY_7D_FACTUAL_DIAGNOSTICS_REQUEST_BLOCKED', { method, pathClass: classify(path) });
  }
  if (counters.token > 2 || counters.tableRead > 1 || counters.recordListRead > 1 || counters.recordSearchRead > 6) {
    counters.blocked += 1;
    throw fail('Read-only diagnostics exceeded bounded request counts', 'LARK_WEEKLY_7D_FACTUAL_DIAGNOSTICS_REQUEST_LIMIT_EXCEEDED', { ...counters });
  }
  return globalThis.fetch(input, init);
}

function readRepositoryState() {
  execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { stdio: 'inherit' });
  return Object.freeze({
    branch: git(['branch', '--show-current']),
    head: git(['rev-parse', 'HEAD']),
    originMain: git(['rev-parse', 'origin/main']),
    clean: git(['status', '--porcelain']) === '',
  });
}
function git(args) { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
function resolveUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof input?.url === 'string') return input.url;
  throw new TypeError('Request URL is required');
}
function classify(path) {
  if (path.includes('/records')) return 'records';
  if (path.includes('/tables')) return 'tables';
  return 'other';
}
function fail(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
