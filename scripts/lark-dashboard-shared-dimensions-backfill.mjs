#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { writeDashboardMaterializationToLark } from '../packages/application/src/use-cases/write-dashboard-materialization-to-lark.js';
import { LARK_REPORT_SCHEMA_V2 } from '../packages/config/src/lark-report-schema-v2.js';
import { LARK_TABLE_ENV } from '../packages/config/src/lark-table-config.js';
import { D1ReportMaterializationReader } from '../packages/connectors/src/d1-report-materialization-reader.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import { resolveExactLarkTableEnvironment } from './lib/lark-dashboard-backfill-table-discovery.js';
import { createLocalLarkRuntime, printJson } from './lib/lark-runtime.js';
import {
  LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL_CONFIRMATION,
  assertBackfillVerificationComplete,
  assertBoundedMaterializationRows,
  assertLarkDashboardSharedDimensionsBackfillConfirmation,
  buildLarkDashboardSharedDimensionsBackfillSql,
  createBackfillAllowedFieldsByTableId,
  createInMemoryReportMaterializationD1,
  createLarkDashboardSharedDimensionsBackfillPlanner,
  parseLarkDashboardSharedDimensionsBackfillArgs,
  parseWranglerD1Rows,
} from './lib/lark-dashboard-shared-dimensions-backfill.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const REQUIRED_TABLE_KEYS = Object.freeze([
  'mktReportSnapshots',
  'mktReportMetricValues',
  'mktReportTopContent',
  'mktReportTopAds',
]);

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'LARK_DASHBOARD_BACKFILL_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    workerDeployments: 0,
    queueMessages: 0,
    providerCalls: 0,
    schedulesChanged: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const options = parseLarkDashboardSharedDimensionsBackfillArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  assertLarkDashboardSharedDimensionsBackfillConfirmation(process.env, options.apply);
  const repository = await assertRepositoryState();
  const tableResolution = await resolveBackfillTableRuntimeEnv();
  const runtime = await createLocalLarkRuntime(REQUIRED_TABLE_KEYS, {
    runtimeConfigScope: 'administrative',
    env: tableResolution.env,
  });
  assertIntegrationWorkspace(runtime.runtimeConfig);

  const customerKey = runtime.runtimeConfig.customerKey;
  const query = buildLarkDashboardSharedDimensionsBackfillSql({
    customerKey,
    maximumRows: process.env.MKT_DASHBOARD_BACKFILL_MAX_MATERIALIZATIONS ?? 100,
  });
  const rows = assertBoundedMaterializationRows(
    await readRemoteMaterializations(query.sql),
    query.maximumRows,
  );
  if (rows.length === 0) {
    throw failure(
      'No Organic dashboard report materializations were found for the Integration Workspace',
      'LARK_DASHBOARD_BACKFILL_NO_MATERIALIZATIONS',
    );
  }

  const d1 = createInMemoryReportMaterializationD1(rows);
  const reader = new D1ReportMaterializationReader({ db: d1 });
  const allowedFieldsByTableId = createBackfillAllowedFieldsByTableId(runtime.tables);
  const preview = await planBackfill({
    runtime,
    reader,
    reportIds: rows.map((row) => row.report_id),
    allowedFieldsByTableId,
  });
  const previewSummary = preview.planner.assertSafeToApply();

  if (!options.apply) {
    printJson({
      ok: true,
      mode: 'preview',
      operatorVersion: 'lark-dashboard-shared-dimensions-backfill-v1.1',
      repository,
      target: {
        environment: runtime.runtimeConfig.environment,
        profileKey: runtime.runtimeConfig.profileKey,
        customerKey,
        materializations: rows.length,
        platformScopes: [...new Set(rows.map((row) => row.platform_scope))].sort(),
        tableResolution: tableResolution.summary,
      },
      summary: previewSummary,
      safeToApply: previewSummary.createRows === 0,
      writesRestrictedTo: {
        snapshots: ['customer_key', 'capability', 'coverage_rate'],
        metricValues: ['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'],
        topContent: ['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'],
        topAds: ['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'],
      },
      remoteD1Reads: 1,
      larkMetadataAndRecordReads: true,
      larkWrites: 0,
      workerDeployments: 0,
      queueMessages: 0,
      providerCalls: 0,
      schedulesChanged: 0,
      nextCommand: [
        'CONFIRM_WRITE=YES',
        `CONFIRM_LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL=${LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL_CONFIRMATION}`,
        'node scripts/lark-dashboard-shared-dimensions-backfill.mjs --apply',
      ].join(' '),
    });
    return;
  }

  const applied = await preview.planner.executeAll();
  const verification = await planBackfill({
    runtime,
    reader,
    reportIds: rows.map((row) => row.report_id),
    allowedFieldsByTableId,
  });
  const verificationSummary = verification.planner.assertSafeToApply();
  assertBackfillVerificationComplete(verificationSummary);

  printJson({
    ok: true,
    mode: 'apply',
    operatorVersion: 'lark-dashboard-shared-dimensions-backfill-v1.1',
    repository,
    target: {
      environment: runtime.runtimeConfig.environment,
      profileKey: runtime.runtimeConfig.profileKey,
      customerKey,
      materializations: rows.length,
      platformScopes: [...new Set(rows.map((row) => row.platform_scope))].sort(),
      tableResolution: tableResolution.summary,
    },
    preview: previewSummary,
    applied: applied.results.map((item) => ({
      tableId: item.tableId,
      created: item.result.created,
      updated: item.result.updated,
      skipped: item.result.skipped,
    })),
    postApplyVerification: verificationSummary,
    stableKeyCreates: 0,
    businessFieldsChanged: 0,
    remoteD1Writes: 0,
    larkWrites: applied.results.reduce(
      (total, item) => total + item.result.created + item.result.updated,
      0,
    ),
    workerDeployments: 0,
    queueMessages: 0,
    providerCalls: 0,
    schedulesChanged: 0,
  });
}

async function resolveBackfillTableRuntimeEnv() {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = {
    ...fileEnv,
    ...process.env,
  };
  if (!env.LARK_APP_TOKEN && env.LARK_BASE_APP_TOKEN) {
    env.LARK_APP_TOKEN = env.LARK_BASE_APP_TOKEN;
  }
  const contracts = REQUIRED_TABLE_KEYS.map((tableKey) => {
    const schema = LARK_REPORT_SCHEMA_V2.find((table) => table.key === tableKey);
    const envName = LARK_TABLE_ENV[tableKey];
    if (!schema || !envName) {
      throw failure(
        'Dashboard backfill table contract is missing from the shared schema',
        'LARK_DASHBOARD_BACKFILL_TABLE_CONTRACT_MISSING',
        { tableKey },
      );
    }
    return Object.freeze({
      tableKey,
      envName,
      names: Object.freeze([
        schema.createName,
        ...(Array.isArray(schema.aliases) ? schema.aliases : []),
        schema.logicalName,
      ].filter((value) => typeof value === 'string' && value.trim())),
    });
  });
  const requiresDiscovery = contracts.some(({ envName }) => (
    typeof env[envName] !== 'string' || env[envName].trim() === ''
  ));
  const liveTables = requiresDiscovery
    ? await createLarkBitableClientFromEnv(env).listTables()
    : [];
  return resolveExactLarkTableEnvironment({ env, liveTables, contracts });
}

async function planBackfill(input) {
  const planner = createLarkDashboardSharedDimensionsBackfillPlanner({
    baseEngine: input.runtime.syncEngine,
    allowedFieldsByTableId: input.allowedFieldsByTableId,
  });
  for (const reportId of input.reportIds) {
    const result = await writeDashboardMaterializationToLark({
      reader: input.reader,
      repository: input.runtime.repository,
      syncEngine: planner.syncEngine,
      reportId,
      customerProfile: input.runtime.runtimeConfig.profileKey,
      utcOffset: input.runtime.env.DEFAULT_UTC_OFFSET ?? '+07:00',
      tables: input.runtime.tables,
    });
    if (result.capability !== 'organic') {
      throw failure(
        'Backfill query returned a non-Organic materialization',
        'LARK_DASHBOARD_BACKFILL_CAPABILITY_INVALID',
        { capability: result.capability },
      );
    }
  }
  return Object.freeze({ planner });
}

async function readRemoteMaterializations(sql) {
  const database = process.env.MKT_DASHBOARD_BACKFILL_D1_TARGET ?? 'MKT_STATE_DB';
  const config = process.env.MKT_DASHBOARD_BACKFILL_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc';
  try {
    const { stdout } = await execFileAsync(
      'npx',
      [
        'wrangler',
        'd1',
        'execute',
        database,
        '--remote',
        '--config',
        config,
        '--command',
        sql,
        '--json',
      ],
      {
        cwd: repositoryRoot,
        env: process.env,
        maxBuffer: 100 * 1024 * 1024,
      },
    );
    return parseWranglerD1Rows(stdout);
  } catch (cause) {
    throw failure(
      'Remote D1 materialization read failed',
      'LARK_DASHBOARD_BACKFILL_D1_READ_FAILED',
      {
        exitCode: Number.isInteger(cause?.code) ? cause.code : null,
        causeName: cause?.name ?? null,
      },
    );
  }
}

async function assertRepositoryState() {
  await execFileAsync('git', ['fetch', 'origin', 'main'], {
    cwd: repositoryRoot,
    env: process.env,
  });
  const [branch, head, originHead, status] = await Promise.all([
    gitText(['branch', '--show-current']),
    gitText(['rev-parse', 'HEAD']),
    gitText(['rev-parse', 'origin/main']),
    gitText(['status', '--porcelain', '--untracked-files=all']),
  ]);
  if (branch !== 'main' || head !== originHead || status !== '') {
    throw failure(
      'Dashboard backfill requires a clean main worktree aligned exactly with origin/main',
      'LARK_DASHBOARD_BACKFILL_REPOSITORY_STATE_INVALID',
      {
        branch,
        alignedWithOriginMain: head === originHead,
        clean: status === '',
      },
    );
  }
  return Object.freeze({ branch, head, originMain: originHead, clean: true });
}

async function gitText(args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
  });
  return stdout.trim();
}

function assertIntegrationWorkspace(runtimeConfig) {
  if (runtimeConfig?.environment !== 'development'
    || runtimeConfig?.profileKey !== 'integration_workspace'
    || runtimeConfig?.customerKey !== 'chemistry_k'
    || runtimeConfig?.infrastructureOwner !== 'developer') {
    throw failure(
      'Dashboard backfill is locked to the developer-owned Integration Workspace',
      'LARK_DASHBOARD_BACKFILL_TARGET_INVALID',
    );
  }
  return true;
}

function printHelp() {
  printJson({
    operatorVersion: 'lark-dashboard-shared-dimensions-backfill-v1.1',
    preview: 'node scripts/lark-dashboard-shared-dimensions-backfill.mjs',
    apply: [
      'CONFIRM_WRITE=YES',
      `CONFIRM_LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL=${LARK_DASHBOARD_SHARED_DIMENSIONS_BACKFILL_CONFIRMATION}`,
      'node scripts/lark-dashboard-shared-dimensions-backfill.mjs --apply',
    ].join(' '),
    tableIdResolution: 'environment_or_exact_live_table_name',
    remoteD1Mutation: false,
    workerDeployment: false,
    queueSend: false,
    providerCall: false,
    scheduleMutation: false,
  });
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitize(nested)]));
}

function failure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkDashboardSharedDimensionsBackfillOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
