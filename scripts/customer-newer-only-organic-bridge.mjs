#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONFIRMATIONS,
  CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONTRACT,
  assertCustomerBoundaryUnchanged,
  assertCustomerNewerOnlyOrganicBridgeConfirmation,
  buildCustomerBridgeVerificationSql,
  buildCustomerNewerOnlyOrganicBridgePlan,
  customerBoundarySql,
  parseCustomerBoundaryResults,
  parseCustomerNewerOnlyOrganicBridgeArgs,
} from './lib/customer-newer-only-organic-bridge.js';

const TARGET = Object.freeze({
  accountId: '154f6bf72740d29d7453cec7fb800d32',
  profile: 'chemistry-k-prod',
  database: 'social-mkt-state-prod',
  worker: 'social-mkt-sync-worker',
  config: resolve('.customer-youtube-uat.wrangler.jsonc'),
});
const DEV_VARS_FILE = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');

try {
  const options = parseCustomerNewerOnlyOrganicBridgeArgs(process.argv.slice(2));
  if (!options.execute || options.phase === 'plan') printPlan();
  else {
    assertCustomerNewerOnlyOrganicBridgeConfirmation(options.phase, process.env);
    if (options.phase === 'prepare') await prepare();
    else if (options.phase === 'apply') await apply(options.planPath);
    else await verify(options.planPath);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'CUSTOMER_NEWER_ONLY_BRIDGE_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contract: CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONTRACT,
    target: safeTarget(),
    phases: ['prepare', 'apply', 'verify'],
    confirmations: CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONFIRMATIONS,
    safety: {
      source: 'Dev Lark canonical customer-owned records',
      destination: 'Customer Production D1',
      platforms: ['facebook', 'tiktok'],
      strictlyNewerOnly: true,
      sql: 'INSERT OR IGNORE only',
      updates: 0,
      deletes: 0,
      operationalTables: 0,
      larkMutations: 0,
      reportCopies: 0,
    },
  }, null, 2)}\n`);
}

async function prepare() {
  const generatedAt = Date.now();
  const [sourceTables, customerSnapshot] = await Promise.all([
    readDevLarkSource(),
    readCustomerSnapshot(),
  ]);
  const plan = await buildCustomerNewerOnlyOrganicBridgePlan({ generatedAt, sourceTables, customerSnapshot });
  const root = resolve('/tmp', `customer-newer-only-organic-bridge-${generatedAt}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const chunks = [];
  for (const [index, chunk] of plan.chunks.entries()) {
    const fileName = `${String(index + 1).padStart(2, '0')}-${chunk.platform}-${chunk.metricDate}.sql`;
    const filePath = join(root, fileName);
    await writeFile(filePath, chunk.sql, { encoding: 'utf8', mode: 0o600 });
    chunks.push({
      platform: chunk.platform,
      metricDate: chunk.metricDate,
      rowCount: chunk.rowCount,
      stateInsertCount: chunk.stateInsertCount,
      coverageRunId: chunk.coverageRunId,
      sourceWatermark: chunk.sourceWatermark,
      filePath,
      sha256: sha256(chunk.sql),
      bytes: Buffer.byteLength(chunk.sql),
    });
  }
  const evidence = {
    contract: plan.contract,
    periodEnd: plan.periodEnd,
    generatedAt: plan.generatedAt,
    sourceDigest: plan.sourceDigest,
    target: safeTarget(),
    customerBoundary: plan.customerBoundary,
    sourceSummary: plan.sourceSummary,
    chunks,
    applied: false,
  };
  const planPath = join(root, 'plan.json');
  await writePrivateJson(planPath, evidence);
  process.stdout.write(`${JSON.stringify({ ok: true, phase: 'prepare', planPath, ...safeEvidence(evidence) }, null, 2)}\n`);
}

async function apply(planPathInput) {
  const planPath = resolve(planPathInput);
  const plan = await readPlan(planPath);
  assertExactTarget(plan.target);
  const current = await readCustomerSnapshot();
  assertCustomerBoundaryUnchanged(plan.customerBoundary, {
    observationDates: current.observationDates,
    accountDates: current.accountDates,
  });
  for (const chunk of plan.chunks) {
    const sql = await readFile(chunk.filePath, 'utf8');
    if (sha256(sql) !== chunk.sha256) throw operatorError('SQL chunk digest mismatch', 'CUSTOMER_NEWER_ONLY_BRIDGE_SQL_DIGEST_MISMATCH');
  }
  const results = [];
  for (const chunk of plan.chunks) {
    const output = runWrangler([
      'd1', 'execute', TARGET.database, '--remote', '--config', TARGET.config,
      '--profile', TARGET.profile, '--file', chunk.filePath, '--json',
    ]);
    results.push({ platform: chunk.platform, metricDate: chunk.metricDate, write: summarizeD1Write(output) });
  }
  const verification = await verifyPlan(plan);
  const updated = { ...plan, applied: true, appliedAt: Date.now(), writeResults: results, verification };
  await writePrivateJson(planPath, updated);
  process.stdout.write(`${JSON.stringify({ ok: true, phase: 'apply', planPath, writeResults: results, verification }, null, 2)}\n`);
}

async function verify(planPathInput) {
  const planPath = resolve(planPathInput);
  const plan = await readPlan(planPath);
  assertExactTarget(plan.target);
  const verification = await verifyPlan(plan);
  process.stdout.write(`${JSON.stringify({ ok: true, phase: 'verify', planPath, verification }, null, 2)}\n`);
}

async function verifyPlan(plan) {
  const sets = d1ResultSets(runWrangler([
    'd1', 'execute', TARGET.database, '--remote', '--config', TARGET.config,
    '--profile', TARGET.profile, '--command', buildCustomerBridgeVerificationSql(plan), '--json',
  ]));
  const observations = sets[0] ?? [];
  const coverage = sets[1] ?? [];
  const accounts = sets[2] ?? [];
  for (const chunk of plan.chunks) {
    const row = observations.find((entry) => entry.platform === chunk.platform && entry.metric_date === chunk.metricDate);
    if (Number(row?.observation_rows ?? -1) !== chunk.rowCount
      || Number(row?.distinct_content_rows ?? -1) !== chunk.rowCount) {
      throw operatorError('Customer observation parity did not match the exact Dev source row count',
        'CUSTOMER_NEWER_ONLY_BRIDGE_OBSERVATION_PARITY_FAILED', { platform: chunk.platform, metricDate: chunk.metricDate });
    }
    const coverageRow = coverage.find((entry) => entry.coverage_run_id === chunk.coverageRunId
      || (entry.platform === chunk.platform && entry.period_end === chunk.metricDate));
    if (coverageRow?.status !== 'complete'
      || coverageRow?.scope_mode !== 'full_inventory'
      || Number(coverageRow?.expected_entities ?? -1) !== chunk.rowCount
      || Number(coverageRow?.observed_entities ?? -1) !== chunk.rowCount
      || Number(coverageRow?.coverage_entities ?? -1) !== chunk.rowCount
      || Number(coverageRow?.missing_state_rows ?? -1) !== 0
      || Number(coverageRow?.failed_rows ?? -1) !== 0) {
      throw operatorError('Customer full-inventory Coverage parity failed',
        'CUSTOMER_NEWER_ONLY_BRIDGE_COVERAGE_PARITY_FAILED', { platform: chunk.platform, metricDate: chunk.metricDate });
    }
  }
  if (Number(accounts[0]?.account_rows ?? -1) !== 1) {
    throw operatorError('Customer Facebook account daily parity failed', 'CUSTOMER_NEWER_ONLY_BRIDGE_ACCOUNT_PARITY_FAILED');
  }
  return safeEvidence({ observations, coverage, accounts });
}

async function readDevLarkSource() {
  const fileEnv = await readDevVars(DEV_VARS_FILE);
  const env = { ...fileEnv, ...process.env };
  const client = createLarkBitableClientFromEnv(env);
  const tables = await client.listTables();
  const [content, contentDaily, accountDaily] = await Promise.all([
    listTable(client, tables, 'MKT_Content'),
    listTable(client, tables, 'MKT_Content_Daily'),
    listTable(client, tables, 'MKT_Account_Daily'),
  ]);
  return Object.freeze({ content, contentDaily, accountDaily });
}

async function listTable(client, tables, normalizedName) {
  const matches = tables.filter((table) => normalizeTableName(table.name) === normalizedName);
  if (matches.length !== 1) throw operatorError(`Expected one Dev Lark ${normalizedName} table`, 'CUSTOMER_NEWER_ONLY_BRIDGE_LARK_TABLE_INVALID');
  return client.listRecords({ tableId: matches[0].tableId, pageSize: 500, includeRecordMetadata: false });
}

async function readCustomerSnapshot() {
  const sets = d1ResultSets(runWrangler([
    'd1', 'execute', TARGET.database, '--remote', '--config', TARGET.config,
    '--profile', TARGET.profile, '--command', customerBoundarySql(), '--json',
  ]));
  const parsed = parseCustomerBoundaryResults(sets);
  return Object.freeze({
    observationDates: parsed.observationDates,
    accountDates: parsed.accountDates,
    stateKeys: parsed.stateKeys,
  });
}

function runWrangler(args) {
  const result = spawnSync('npx', ['wrangler', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: TARGET.accountId },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw operatorError('Wrangler command failed', 'CUSTOMER_NEWER_ONLY_BRIDGE_WRANGLER_FAILED', {
      status: result.status,
      stderr: String(result.stderr ?? '').slice(0, 2_000),
    });
  }
  try { return JSON.parse(result.stdout); }
  catch { throw operatorError('Wrangler JSON output was invalid', 'CUSTOMER_NEWER_ONLY_BRIDGE_WRANGLER_JSON_INVALID'); }
}

function d1ResultSets(output) {
  const containers = Array.isArray(output) ? output : [output];
  return containers.map((container) => container?.results ?? container?.result?.[0]?.results ?? []);
}

function summarizeD1Write(output) {
  const containers = Array.isArray(output) ? output : [output];
  return containers.reduce((summary, container) => ({
    changes: summary.changes + Number(container?.meta?.changes ?? 0),
    rowsRead: summary.rowsRead + Number(container?.meta?.rows_read ?? 0),
    rowsWritten: summary.rowsWritten + Number(container?.meta?.rows_written ?? 0),
  }), { changes: 0, rowsRead: 0, rowsWritten: 0 });
}

async function readPlan(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (parsed?.contract !== CUSTOMER_NEWER_ONLY_ORGANIC_BRIDGE_CONTRACT || !Array.isArray(parsed?.chunks)) {
    throw operatorError('Bridge plan contract is invalid', 'CUSTOMER_NEWER_ONLY_BRIDGE_PLAN_INVALID');
  }
  return parsed;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function normalizeTableName(value) {
  return String(value ?? '').replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeTarget() {
  return { accountId: TARGET.accountId, profile: TARGET.profile, database: TARGET.database, worker: TARGET.worker };
}

function assertExactTarget(value) {
  if (JSON.stringify(value) !== JSON.stringify(safeTarget())) {
    throw operatorError('Bridge target differs from reviewed Customer Production target', 'CUSTOMER_NEWER_ONLY_BRIDGE_TARGET_INVALID');
  }
}

function safeEvidence(value) {
  if (Array.isArray(value)) return value.map(safeEvidence);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:token|secret|authorization|cookie|password)/iu.test(key)) continue;
    if (key === 'missingStateKeys') output[key] = { count: Array.isArray(nested) ? nested.length : 0 };
    else output[key] = safeEvidence(nested);
  }
  return output;
}

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
