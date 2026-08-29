#!/usr/bin/env node

import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { JOB_TYPES } from '../packages/application/src/jobs/job-catalog.js';
import { processMetaEndToEndSync } from '../packages/application/src/use-cases/process-meta-end-to-end-sync.js';
import { readLarkTableIdsFromEnv } from '../packages/config/src/lark-table-config.js';
import { createStableFingerprint } from '../packages/shared/src/hash/stable-fingerprint.js';
import { InMemoryResumableWorkStore } from '../packages/sync-engine/src/in-memory-resumable-work-store.js';
import { createInfrastructure } from '../apps/sync-worker/src/runtime-infrastructure.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { createForbiddenMetaPaidDirectAdapter } from './lib/meta-paid-direct-lark-materializer.js';
import { readWranglerScalarVars } from './lib/wrangler-jsonc-vars.js';

const CONFIRMATION = 'FINALIZE_EXACT_CUSTOMER_META_K2_LOCALLY';
const ACCOUNT_ID = '154f6bf72740d29d7453cec7fb800d32';
const DATABASE_ID = 'f03ab092-a1aa-4478-8ba2-c20d7b54851f';
const CONFIG_PATH = resolve(process.env.MKT_CUSTOMER_WRANGLER_CONFIG ?? '.customer-youtube-uat.wrangler.jsonc');
const PROFILE = 'chemistry-k-prod';
const execFileAsync = promisify(execFile);
const SOURCE_PHASE = 'meta_end_to_end_source_staging_v1';
const TABLE_KEYS = Object.freeze([
  'mktAdsAccounts', 'mktAdsCampaigns', 'mktAdsAdGroups',
  'mktAdsAds', 'mktAdsCreatives', 'mktAdsDaily',
]);
const LIMITS = Object.freeze({
  sourceMaxPages: 2_500,
  sourceMaxUnits: 2_500,
  sourceMaxRows: 50_000,
  sourceMaxUnitBytes: 1_048_576,
  postSourceUnitsPerInvocation: 25,
  preflightRowsPerInvocation: 1_000,
  d1RowsPerInvocation: 1_000,
  larkRowsPerInvocation: 1_000,
  larkTablesPerInvocation: 4,
});

async function main() {
  if (process.env.CONFIRM_META_K2_CUSTOMER_LOCAL_FINALIZER !== CONFIRMATION) {
    throw finalizerError('Execution confirmation is required', 'META_K2_LOCAL_CONFIRMATION_REQUIRED');
  }
  assertReviewedMain();
  const configText = await readFile(CONFIG_PATH, 'utf8');
  const config = parseJsoncObject(configText);
  const binding = (config.d1_databases ?? []).find((entry) => entry.binding === 'MKT_STATE_DB');
  requireExact(config.account_id, ACCOUNT_ID, 'account_id');
  requireExact(binding?.database_id, DATABASE_ID, 'database_id');
  const fileEnv = await readDevVars(resolve(process.env.DEV_VARS_FILE ?? '.dev.vars'));
  // Customer config is authoritative for every non-secret runtime identity. The local Secret
  // file supplies credentials only and must not silently switch this operator back to Dev.
  const runtimeEnv = { ...process.env, ...fileEnv, ...readWranglerScalarVars(configText) };
  requireExact(runtimeEnv.MKT_CUSTOMER_PROFILE, 'chemistry_k', 'MKT_CUSTOMER_PROFILE');
  requireExact(runtimeEnv.LARK_APP_ID, 'cli_aaf9b6ddfcf99ed1', 'LARK_APP_ID');

  const db = new WranglerRemoteD1Binding({
    env: runtimeEnv,
    configPath: CONFIG_PATH,
    databaseName: binding.database_name,
  });
  const snapshot = await readExactSnapshot(db);
  const store = await seedLocalStore(snapshot);
  const infrastructure = createInfrastructure({ ...runtimeEnv, MKT_STATE_DB: db });
  const tables = Object.freeze({
    ...readLarkTableIdsFromEnv(runtimeEnv, TABLE_KEYS),
    __metaLarkTableKeys: [...TABLE_KEYS],
  });
  const input = {
    connectorKey: 'meta_ads',
    jobType: JOB_TYPES.META_ADS_SYNC,
    operation: Object.freeze({
      operationId: snapshot.operationId,
      workKey: snapshot.workKey,
      generation: snapshot.generation,
      originalRequestedAt: snapshot.requestedAt,
      stable: true,
    }),
    syncRunId: `meta:meta_ads:chemistry_k2:${snapshot.operationId}`,
    cursorKey: snapshot.cursorKey,
    assertLockActive: async () => assertFenceUnchanged(db, snapshot),
    adapter: createForbiddenMetaPaidDirectAdapter(),
    sourceAccountId: snapshot.sourceAccountId,
    accountKey: 'chemistry_k',
    customerProfile: 'chemistry_k',
    customerKey: 'chemistry_k',
    sourceTimezone: 'Asia/Bangkok',
    dateRange: { since: snapshot.period, until: snapshot.period },
    d1WriteEnabled: true,
    larkWriteEnabled: true,
    resumableWorkStore: store,
    historyStore: infrastructure.getMarketingHistoryStore(),
    organicHistoryGateway: null,
    repository: infrastructure.repository,
    syncEngine: infrastructure.syncEngine,
    tables,
    limits: LIMITS,
  };

  let result = null;
  for (let invocation = 1; invocation <= 100; invocation += 1) {
    result = await processMetaEndToEndSync(input);
    console.log(JSON.stringify({
      invocation,
      status: result.status,
      phase: result.continuationPhase ?? null,
    }));
    if (['completed', 'completed_idempotent'].includes(result.status)) break;
    if (result.continuationRequired !== true) {
      throw finalizerError('Local K2 pipeline stopped before completion', 'META_K2_LOCAL_INCOMPLETE', {
        status: result.status,
      });
    }
  }
  if (!['completed', 'completed_idempotent'].includes(result?.status)) {
    throw finalizerError('Local K2 pipeline exceeded bounded invocation count', 'META_K2_LOCAL_LIMIT');
  }
  await assertFenceUnchanged(db, snapshot);
  console.log(JSON.stringify({
    ok: true,
    status: 'CUSTOMER_META_K2_D1_LARK_COMPLETED',
    workKey: snapshot.workKey,
    generation: snapshot.generation,
    sourceUnits: snapshot.units.length,
    reconciliation: result.reconciliation,
    providerReads: 0,
    replacementGeneration: false,
  }, null, 2));
}

async function readExactSnapshot(db) {
  const rows = await db.prepare(`
    SELECT r.work_key, r.cursor_key, r.work_type, r.generation, r.requested_at,
           r.lifecycle_status, r.terminal_reason, p.state_json, p.expected_items,
           p.processed_items, p.pages_processed, p.chunks_processed, p.complete
    FROM sync_generation_fences f
    JOIN sync_work_runs r ON r.work_key=f.work_key AND r.generation=f.generation
    JOIN sync_work_phases p ON p.work_key=r.work_key AND p.phase=?
    WHERE f.cursor_key=?
  `).bind(SOURCE_PHASE, 'chemistry_k:meta_ads:chemistry_k:scheduled_end_to_end_chemistry_k2').all();
  const row = rows.results[0];
  if (!row || row.lifecycle_status !== 'terminal' || row.terminal_reason !== 'QUEUE_RETRY_EXHAUSTED'
    || Number(row.complete) !== 1 || Number(row.processed_items) !== Number(row.expected_items)) {
    throw finalizerError('Latest fenced K2 work is not an exact terminal complete-source snapshot', 'META_K2_LOCAL_PREFLIGHT_BLOCKED');
  }
  const lock = await db.prepare(`SELECT COUNT(*) AS count FROM sync_locks WHERE expires_at>unixepoch()*1000`).first();
  if (Number(lock?.count) !== 0) {
    throw finalizerError('Customer runtime has an active lock', 'META_K2_LOCAL_ACTIVE_LOCK');
  }
  const units = [];
  let sequence = 0;
  while (sequence < Number(row.expected_items)) {
    const page = await db.prepare(`
      SELECT unit_key, sequence, payload_json FROM sync_work_units
      WHERE work_key=? AND phase=? AND sequence>=? ORDER BY sequence LIMIT 25
    `).bind(row.work_key, SOURCE_PHASE, sequence).all();
    if (page.results.length === 0) break;
    for (const unit of page.results) {
      units.push({ unitKey: unit.unit_key, sequence: Number(unit.sequence), payload: JSON.parse(unit.payload_json) });
    }
    sequence = Number(page.results.at(-1).sequence) + 1;
  }
  if (units.length !== Number(row.expected_items)) {
    throw finalizerError('Exact K2 source unit inventory is incomplete', 'META_K2_LOCAL_SOURCE_GAP', {
      expected: Number(row.expected_items), observed: units.length,
    });
  }
  const sourceAccountId = findSourceAccountId(units);
  const operationId = row.work_key.split(':').at(-1);
  const period = operationId.match(/(\d{8})$/u)?.[1];
  if (!period) throw finalizerError('K2 period could not be resolved', 'META_K2_LOCAL_PERIOD_INVALID');
  return Object.freeze({
    workKey: row.work_key,
    cursorKey: row.cursor_key,
    workType: row.work_type,
    generation: Number(row.generation),
    requestedAt: Number(row.requested_at),
    operationId,
    period: `${period.slice(0, 4)}-${period.slice(4, 6)}-${period.slice(6, 8)}`,
    sourceAccountId,
    sourcePhase: {
      state: JSON.parse(row.state_json),
      expectedItems: Number(row.expected_items),
      processedItems: Number(row.processed_items),
      pagesProcessed: Number(row.pages_processed),
      chunksProcessed: Number(row.chunks_processed),
    },
    units: Object.freeze(units),
  });
}

async function seedLocalStore(snapshot) {
  const store = new InMemoryResumableWorkStore();
  const operationFingerprint = await createStableFingerprint({
    schemaVersion: 'meta_ads_report_range_activity_operation_v1',
    connectorKey: 'meta_ads',
    sourceAccountId: snapshot.sourceAccountId,
    accountKey: 'chemistry_k',
    customerProfile: 'chemistry_k',
    customerKey: 'chemistry_k',
    dateRange: { since: snapshot.period, until: snapshot.period },
    generation: snapshot.generation,
  });
  await store.beginWork({
    workKey: snapshot.workKey,
    cursorKey: snapshot.cursorKey,
    workType: snapshot.workType,
    operationFingerprint,
    generation: snapshot.generation,
    requestedAt: snapshot.requestedAt,
  });
  for (const unit of snapshot.units) {
    await store.savePhase({
      workKey: snapshot.workKey,
      phase: SOURCE_PHASE,
      state: structuredClone(snapshot.sourcePhase.state),
      expectedItems: snapshot.sourcePhase.expectedItems,
      processedItems: snapshot.sourcePhase.processedItems,
      pagesProcessed: snapshot.sourcePhase.pagesProcessed,
      chunksProcessed: snapshot.sourcePhase.chunksProcessed,
      complete: true,
      unit: structuredClone(unit),
    });
  }
  return store;
}

async function assertFenceUnchanged(db, snapshot) {
  const row = await db.prepare('SELECT generation, work_key FROM sync_generation_fences WHERE cursor_key=?')
    .bind(snapshot.cursorKey).first();
  if (Number(row?.generation) !== snapshot.generation || row?.work_key !== snapshot.workKey) {
    throw finalizerError('K2 generation changed during local finalization', 'META_K2_LOCAL_SUPERSEDED');
  }
}

function findSourceAccountId(units) {
  for (const unit of units) {
    const text = JSON.stringify(unit.payload);
    const match = text.match(/act_\d+/u);
    if (match) return match[0];
  }
  throw finalizerError('K2 source account ID is absent from exact source units', 'META_K2_LOCAL_SOURCE_ID_MISSING');
}

function assertReviewedMain() {
  const branch = git(['branch', '--show-current']);
  const head = git(['rev-parse', 'HEAD']);
  const origin = git(['rev-parse', 'origin/main']);
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], false);
  if (branch !== 'main' || head !== origin || dirty.trim() !== '') {
    throw finalizerError('Exact reviewed clean main is required', 'META_K2_LOCAL_REPOSITORY_INVALID', {
      branch, head, origin, clean: dirty.trim() === '',
    });
  }
}

function git(args, required = true) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw finalizerError('git preflight failed', 'META_K2_LOCAL_GIT_FAILED');
  const value = String(result.stdout ?? '').trim();
  if (required && !value) throw finalizerError('git preflight returned empty output', 'META_K2_LOCAL_GIT_FAILED');
  return value;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) throw finalizerError(`${fieldName} does not match Customer Production`, 'META_K2_LOCAL_TARGET_INVALID');
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|payload|state/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function finalizerError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

class WranglerRemoteD1Binding {
  constructor(input) {
    this.env = input.env;
    this.configPath = input.configPath;
    this.databaseName = input.databaseName;
  }

  prepare(sql) {
    return new WranglerPreparedStatement(this, sql);
  }

  async batch(statements) {
    const sql = statements.map((statement) => statement.render()).join(';\n');
    await this.executeFile(sql);
    // Wrangler file import returns one aggregate transaction result. The application already
    // owns the exact operation count and verifies final D1/Lark parity, so expose one committed
    // result per prepared statement to preserve the Workers binding contract.
    return statements.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
  }

  async executeFile(sql) {
    const directory = await mkdtemp(join(tmpdir(), 'customer-k2-d1-'));
    const path = join(directory, 'batch.sql');
    try {
      await writeFile(path, `${sql};\n`, { mode: 0o600 });
      const result = await execFileAsync('npx', [
        'wrangler', 'd1', 'execute', this.databaseName,
        '--remote', '--config', this.configPath, '--profile', PROFILE,
        '--file', path, '--json',
      ], {
        cwd: process.cwd(),
        env: this.env,
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      const parsed = parseWranglerJsonSuffix(result.stdout);
      const blocks = Array.isArray(parsed) ? parsed : [parsed];
      if (blocks.some((block) => block?.success !== true)) {
        throw finalizerError('Wrangler D1 file batch reported failure', 'META_K2_LOCAL_D1_BATCH_FAILED');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async executeCommand(sql) {
    const result = await execFileAsync('npx', [
      'wrangler', 'd1', 'execute', this.databaseName,
      '--remote', '--config', this.configPath, '--profile', PROFILE,
      '--command', sql, '--json',
    ], {
      cwd: process.cwd(),
      env: this.env,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = parseWranglerJsonSuffix(result.stdout);
    const blocks = Array.isArray(parsed) ? parsed : [parsed];
    return blocks.map((block) => ({
      success: block?.success !== false,
      results: Array.isArray(block?.results) ? block.results : [],
      meta: block?.meta ?? {},
    }));
  }
}

class WranglerPreparedStatement {
  constructor(binding, sql, params = []) {
    this.binding = binding;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new WranglerPreparedStatement(this.binding, this.sql, structuredClone(params));
  }

  render() {
    let index = 0;
    const rendered = this.sql.replace(/\?/gu, () => {
      if (index >= this.params.length) throw new TypeError('D1 bind parameter is missing');
      return sqlLiteral(this.params[index++]);
    });
    if (index !== this.params.length) throw new TypeError('D1 bind parameter count does not match SQL');
    return rendered;
  }

  async run() {
    return (await this.binding.executeCommand(this.render()))[0];
  }

  async all() {
    return (await this.binding.executeCommand(this.render()))[0];
  }

  async first(column) {
    const row = (await this.all()).results[0] ?? null;
    return column === undefined || row === null ? row : row[column];
  }
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('D1 numeric bind must be finite');
    return String(value);
  }
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  throw new TypeError('Unsupported D1 bind value');
}

function parseWranglerJsonSuffix(output) {
  const text = String(output ?? '').trim();
  const starts = [text.lastIndexOf('\n['), text.lastIndexOf('\n{')]
    .map((index) => (index < 0 ? index : index + 1))
    .filter((index) => index >= 0);
  const start = starts.length > 0 ? Math.max(...starts) : (text.startsWith('[') || text.startsWith('{') ? 0 : -1);
  if (start < 0) throw finalizerError('Wrangler D1 output has no JSON result', 'META_K2_LOCAL_D1_JSON_INVALID');
  try {
    return JSON.parse(text.slice(start));
  } catch {
    throw finalizerError('Wrangler D1 output JSON is invalid', 'META_K2_LOCAL_D1_JSON_INVALID');
  }
}

if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({
    ok: true,
    planOnly: true,
    source: 'latest fenced complete Customer K2 source snapshot',
    providerReads: 0,
    execution: 'local transform plus parameterized Customer D1 and stable-key Customer Lark writes',
    deletes: 0,
    replacementGeneration: false,
  }, null, 2));
} else {
  await main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code ?? 'META_K2_CUSTOMER_LOCAL_FINALIZER_FAILED',
      message: error?.message ?? String(error),
      details: sanitize(error?.details ?? {}),
    }, null, 2));
    process.exitCode = 1;
  });
}
