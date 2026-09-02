#!/usr/bin/env node

import { execFile, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { JOB_TYPES } from '../packages/application/src/jobs/job-catalog.js';
import { processMetaEndToEndSync } from '../packages/application/src/use-cases/process-meta-end-to-end-sync.js';
import { readLarkTableIdsFromEnv } from '../packages/config/src/lark-table-config.js';
import { createStableFingerprint } from '../packages/shared/src/hash/stable-fingerprint.js';
import { InMemoryResumableWorkStore } from '../packages/sync-engine/src/in-memory-resumable-work-store.js';
import { createInfrastructure } from '../apps/sync-worker/src/runtime-infrastructure.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { canonicalizeMetaK2ProjectionRows } from './lib/meta-k2-local-lark-projection-wire.js';
import { createForbiddenMetaPaidDirectAdapter } from './lib/meta-paid-direct-lark-materializer.js';
import { readWranglerScalarVars } from './lib/wrangler-jsonc-vars.js';

const CONFIRMATION = 'FINALIZE_EXACT_CUSTOMER_META_K2_LOCALLY';
const D1_REUSE_CONFIRMATION = 'REUSE_CONFIRMED_EXACT_CUSTOMER_META_K2_D1';
const ACCOUNT_ID = '154f6bf72740d29d7453cec7fb800d32';
const DATABASE_ID = 'f03ab092-a1aa-4478-8ba2-c20d7b54851f';
const CONFIG_PATH = resolve(process.env.MKT_CUSTOMER_WRANGLER_CONFIG ?? '.customer-youtube-uat.wrangler.jsonc');
const PROFILE = 'chemistry-k-prod';
const execFileAsync = promisify(execFile);
const SOURCE_PHASE = 'meta_end_to_end_source_staging_v1';
const CURSOR_KEY = 'chemistry_k:meta_ads:chemistry_k:scheduled_end_to_end_chemistry_k2';
const EXACT_OPERATION_DATE = '20260827';
const EXACT_SOURCE_ITEMS = 194;
const MAX_CANDIDATES = 32;
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
  // Local preflight can inspect a large bounded slice. The projection engine registers the
  // exact 25-row Lark child plans so its frozen manifest never depends on preflight cadence.
  preflightRowsPerInvocation: 1_000,
  d1RowsPerInvocation: 1_000,
  larkRowsPerInvocation: 25,
  larkTablesPerInvocation: 1,
});
// Keep the local recovery finite while allowing every contract-bounded phase to exhaust its
// maximum rows. The previous fixed limit of 100 stopped large K2 inventories during preflight
// before any destination reconciliation could finish.
const MAX_LOCAL_INVOCATIONS = Math.ceil(LIMITS.sourceMaxUnits / LIMITS.postSourceUnitsPerInvocation)
  + Math.ceil(LIMITS.sourceMaxRows / LIMITS.preflightRowsPerInvocation)
  + Math.ceil(LIMITS.sourceMaxRows / LIMITS.d1RowsPerInvocation)
  + Math.ceil(LIMITS.sourceMaxRows / LIMITS.larkRowsPerInvocation)
  + TABLE_KEYS.length
  + 16;

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
  const projection = await createWorkerLarkProjection({
    snapshot,
    tables,
    projectionUrl: process.env.MKT_META_K2_LARK_PROJECTION_URL,
    tokenFile: process.env.MKT_META_K2_LARK_PROJECTION_TOKEN_FILE,
  });
  const historyStore = resolveHistoryStore({
    infrastructure,
    confirmation: process.env.CONFIRM_META_K2_CUSTOMER_D1_ALREADY_COMPLETE,
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
    assertLockActive: async () => assertRetainedTargetStable(db, snapshot),
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
    historyStore,
    organicHistoryGateway: null,
    // Lark schema/diff/write runs inside the isolated Customer Preview Worker, where the
    // existing Customer LARK_APP_SECRET is bound. Local execution never reads that Secret.
    repository: {},
    syncEngine: projection.syncEngine,
    tables,
    limits: LIMITS,
  };

  let result = null;
  for (let invocation = 1; invocation <= MAX_LOCAL_INVOCATIONS; invocation += 1) {
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
  await assertRetainedTargetStable(db, snapshot);
  await projection.finalize();
  console.log(JSON.stringify({
    ok: true,
    status: 'CUSTOMER_META_K2_D1_LARK_COMPLETED',
    workKey: snapshot.workKey,
    generation: snapshot.generation,
    sourceUnits: snapshot.units.length,
    reconciliation: result.reconciliation,
    providerReads: 0,
    customerLarkSecretReadLocally: false,
    projection: projection.summary(),
    reusedConfirmedD1: historyStore instanceof ConfirmedD1HistoryStore,
    replacementGeneration: false,
  }, null, 2));
}

function resolveHistoryStore(input) {
  if (!input.confirmation) return input.infrastructure.getMarketingHistoryStore();
  if (input.confirmation !== D1_REUSE_CONFIRMATION) {
    throw finalizerError('Exact D1 reuse confirmation is invalid', 'META_K2_LOCAL_D1_REUSE_CONFIRMATION_INVALID');
  }
  return new ConfirmedD1HistoryStore();
}

class ConfirmedD1HistoryStore {
  async writeMetaD1Operations(operations) {
    // Two reviewed local executions already completed every deterministic stable-key D1 batch.
    // Reconcile the exact same write-set locally without issuing a third remote D1 replay.
    return operations.map(() => Object.freeze({ status: 'skipped' }));
  }

  async upsertOrganicAccountDailyFact() { throw this.#unexpected(); }
  async upsertAdsEntityState() { throw this.#unexpected(); }
  async upsertAdsDailyFact() { throw this.#unexpected(); }
  async saveCoverageRun() { throw this.#unexpected(); }
  async saveCoverageEntities() { throw this.#unexpected(); }

  #unexpected() {
    return finalizerError('Confirmed D1 reuse must use the bounded batch path', 'META_K2_LOCAL_D1_REUSE_PATH_INVALID');
  }
}

async function createWorkerLarkProjection(input) {
  const projectionUrl = requireHttpsUrl(input.projectionUrl, 'MKT_META_K2_LARK_PROJECTION_URL');
  const tokenPath = requireText(input.tokenFile, 'MKT_META_K2_LARK_PROJECTION_TOKEN_FILE');
  const token = String(await readFile(resolve(tokenPath), 'utf8')).trim();
  if (token.length < 32) {
    throw finalizerError('Projection token file is invalid', 'META_K2_LOCAL_PROJECTION_TOKEN_INVALID');
  }
  const tableKeyById = new Map(Object.entries(input.tables)
    .filter(([key]) => key !== '__metaLarkTableKeys')
    .map(([key, tableId]) => [tableId, key]));
  const engine = new WorkerLarkProjectionSyncEngine({
    projectionUrl,
    token,
    snapshot: input.snapshot,
    tableKeyById,
  });
  return Object.freeze({
    syncEngine: engine,
    finalize: () => engine.finalize(),
    summary: () => engine.summary(),
  });
}

class WorkerLarkProjectionSyncEngine {
  constructor(input) {
    this.projectionUrl = input.projectionUrl;
    this.token = input.token;
    this.snapshot = input.snapshot;
    this.tableKeyById = input.tableKeyById;
    this.plans = [];
    this.planByDigest = new Map();
    this.manifest = null;
    this.results = { batches: 0, rows: 0, created: 0, updated: 0, skipped: 0 };
  }

  async planByKey(input) {
    const tableKey = this.tableKeyById.get(input.tableId);
    if (!tableKey) throw finalizerError('Projection table ID is outside the exact scope', 'META_K2_LOCAL_PROJECTION_TABLE_INVALID');
    // Hash the exact JSON wire representation. Date and other structured-clone values otherwise
    // fingerprint differently after fetch serializes them for the Preview Worker.
    const rows = canonicalizeMetaK2ProjectionRows(input.rows ?? []);
    if (rows.length === 0) return Object.freeze({ tableKey, keyField: input.keyField, rows, empty: true });
    const registered = [];
    for (let start = 0; start < rows.length; start += LIMITS.larkRowsPerInvocation) {
      registered.push(await this.#registerPlan({
        tableKey,
        keyField: input.keyField,
        rows: rows.slice(start, start + LIMITS.larkRowsPerInvocation),
      }));
    }
    if (registered.length === 1) return registered[0];
    const digest = await createStableFingerprint({
      schemaVersion: 'meta_k2_local_lark_projection_plan_v1',
      tableKey,
      keyField: input.keyField,
      rows,
    });
    return Object.freeze({
      tableKey,
      keyField: input.keyField,
      rows: Object.freeze(rows),
      digest,
      createRows: Object.freeze(rows),
      updateRows: Object.freeze([]),
      skipped: 0,
      duplicateInputRows: 0,
      planningOnly: true,
    });
  }

  async #registerPlan(input) {
    const digest = await createStableFingerprint({
      schemaVersion: 'meta_k2_local_lark_projection_plan_v1',
      tableKey: input.tableKey,
      keyField: input.keyField,
      rows: input.rows,
    });
    let plan = this.planByDigest.get(digest);
    if (!plan) {
      plan = Object.freeze({
        tableKey: input.tableKey,
        keyField: input.keyField,
        rows: Object.freeze(input.rows),
        digest,
        createRows: Object.freeze(input.rows),
        updateRows: Object.freeze([]),
        skipped: 0,
        duplicateInputRows: 0,
      });
      this.planByDigest.set(digest, plan);
      this.plans.push(plan);
    }
    return plan;
  }

  async executePlan(plan) {
    if (plan.empty) return Object.freeze({ created: 0, updated: 0, skipped: 0, duplicateInputRows: 0 });
    await this.#freezeManifest();
    const batchSequence = this.plans.indexOf(plan);
    if (batchSequence < 0) throw finalizerError('Projection plan is absent from the manifest', 'META_K2_LOCAL_PROJECTION_MANIFEST_INVALID');
    const batchDigest = await createStableFingerprint({
      schemaVersion: 'meta_k2_local_lark_projection_batch_v1',
      operation: this.#operation(),
      tableKey: plan.tableKey,
      keyField: plan.keyField,
      batchSequence,
      rows: plan.rows,
    });
    const response = await this.#request({
      mode: 'write',
      operation: this.#operation(),
      tableKey: plan.tableKey,
      keyField: plan.keyField,
      rows: plan.rows,
      batchSequence,
      expectedBatches: this.manifest.expectedBatches,
      expectedRows: this.manifest.expectedRows,
      manifestDigest: this.manifest.manifestDigest,
      batchDigest,
    });
    const result = Object.freeze({
      created: nonNegative(response.created, 'created'),
      updated: nonNegative(response.updated, 'updated'),
      skipped: nonNegative(response.skipped, 'skipped'),
      duplicateInputRows: 0,
    });
    if (result.created + result.updated + result.skipped !== plan.rows.length) {
      throw finalizerError('Projection response did not reconcile the batch', 'META_K2_LOCAL_PROJECTION_RECONCILIATION_FAILED');
    }
    this.results.batches += 1;
    this.results.rows += plan.rows.length;
    this.results.created += result.created;
    this.results.updated += result.updated;
    this.results.skipped += result.skipped;
    return result;
  }

  async finalize() {
    await this.#freezeManifest();
    if (this.results.batches !== this.manifest.expectedBatches
      || this.results.rows !== this.manifest.expectedRows) {
      throw finalizerError('Projection execution is incomplete', 'META_K2_LOCAL_PROJECTION_INCOMPLETE');
    }
    const response = await this.#request({
      mode: 'finalize',
      operation: this.#operation(),
      expectedBatches: this.manifest.expectedBatches,
      expectedRows: this.manifest.expectedRows,
      manifestDigest: this.manifest.manifestDigest,
    });
    if (response.status !== 'completed') {
      throw finalizerError('Projection finalization did not complete the exact Work', 'META_K2_LOCAL_PROJECTION_FINALIZE_FAILED');
    }
  }

  summary() {
    return Object.freeze({ ...this.results, manifestDigest: this.manifest?.manifestDigest ?? null });
  }

  async #freezeManifest() {
    if (this.manifest) return;
    const entries = this.plans.map((plan, batchSequence) => ({
      batchSequence,
      tableKey: plan.tableKey,
      keyField: plan.keyField,
      rowCount: plan.rows.length,
      planDigest: plan.digest,
    }));
    const expectedRows = entries.reduce((total, entry) => total + entry.rowCount, 0);
    if (entries.length === 0 || expectedRows === 0) {
      throw finalizerError('Projection manifest is empty', 'META_K2_LOCAL_PROJECTION_MANIFEST_INVALID');
    }
    this.manifest = Object.freeze({
      expectedBatches: entries.length,
      expectedRows,
      manifestDigest: await createStableFingerprint({
        schemaVersion: 'meta_k2_local_lark_projection_manifest_v1',
        operation: this.#operation(),
        entries,
      }),
    });
  }

  #operation() {
    return Object.freeze({
      operationId: this.snapshot.operationId,
      workKey: this.snapshot.workKey,
      generation: this.snapshot.generation,
    });
  }

  async #request(body) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(this.projectionUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload?.ok === true) return payload;
        const error = finalizerError('Customer Preview projection rejected the request', payload?.code ?? 'META_K2_LOCAL_PROJECTION_HTTP_FAILED', {
          status: response.status,
          diagnostic: payload?.diagnostic ?? null,
        });
        if (response.status < 500) throw error;
        lastError = error;
      } catch (error) {
        if (Number(error?.details?.status ?? 500) < 500) throw error;
        lastError = error;
      }
    }
    throw lastError ?? finalizerError('Customer Preview projection request failed', 'META_K2_LOCAL_PROJECTION_HTTP_FAILED');
  }
}

async function readExactSnapshot(db) {
  const rows = await db.prepare(`
    SELECT r.work_key, r.cursor_key, r.work_type, r.generation, r.requested_at,
           r.lifecycle_status, r.terminal_reason, p.state_json, p.expected_items,
           p.processed_items, p.pages_processed, p.chunks_processed, p.complete
    FROM sync_work_runs AS r
    JOIN sync_work_phases AS p ON p.work_key=r.work_key AND p.phase=?
    WHERE r.cursor_key=?
    ORDER BY r.generation DESC
    LIMIT ${MAX_CANDIDATES}
  `).bind(SOURCE_PHASE, CURSOR_KEY).all();
  const exact = rows.results.filter((candidate) => {
    const operationId = typeof candidate?.work_key === 'string' ? candidate.work_key.split(':').at(-1) : '';
    return operationId?.endsWith(EXACT_OPERATION_DATE) === true
      && Number(candidate.complete) === 1
      && Number(candidate.expected_items) === EXACT_SOURCE_ITEMS
      && Number(candidate.processed_items) === EXACT_SOURCE_ITEMS;
  });
  if (exact.length !== 1) {
    throw finalizerError(
      'Exact retained K2 20260827 complete-source snapshot is not unique',
      'META_K2_LOCAL_PREFLIGHT_BLOCKED',
      { candidateCount: rows.results.length, exactCandidateCount: exact.length },
    );
  }
  const row = exact[0];
  assertRetainedLifecycle(row);
  await assertCursorUnlocked(db, row.cursor_key);

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
  if (units.length !== EXACT_SOURCE_ITEMS) {
    throw finalizerError('Exact K2 source unit inventory is incomplete', 'META_K2_LOCAL_SOURCE_GAP', {
      expected: EXACT_SOURCE_ITEMS, observed: units.length,
    });
  }
  const sourceAccountId = findSourceAccountId(units);
  const operationId = row.work_key.split(':').at(-1);
  const period = operationId.match(/(\d{8})$/u)?.[1];
  if (period !== EXACT_OPERATION_DATE) {
    throw finalizerError('K2 period could not be resolved to the exact retained operation', 'META_K2_LOCAL_PERIOD_INVALID');
  }
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

async function assertRetainedTargetStable(db, snapshot) {
  const rows = await db.prepare(`
    SELECT r.work_key, r.generation, r.lifecycle_status, r.terminal_reason,
           p.complete, p.expected_items, p.processed_items
    FROM sync_work_runs AS r
    JOIN sync_work_phases AS p ON p.work_key=r.work_key AND p.phase=?
    WHERE r.work_key=? AND r.generation=? AND r.cursor_key=?
    LIMIT 2
  `).bind(SOURCE_PHASE, snapshot.workKey, snapshot.generation, snapshot.cursorKey).all();
  const row = rows.results[0];
  if (rows.results.length !== 1
    || !row
    || Number(row.complete) !== 1
    || Number(row.expected_items) !== EXACT_SOURCE_ITEMS
    || Number(row.processed_items) !== EXACT_SOURCE_ITEMS) {
    throw finalizerError('Exact retained K2 target changed during local finalization', 'META_K2_LOCAL_TARGET_CHANGED');
  }
  assertRetainedLifecycle(row);
  await assertCursorUnlocked(db, snapshot.cursorKey);
}

function assertRetainedLifecycle(row) {
  if (row?.lifecycle_status === 'active') return;
  if (row?.lifecycle_status === 'terminal' && row?.terminal_reason === 'QUEUE_RETRY_EXHAUSTED') return;
  throw finalizerError(
    'Exact retained K2 target is no longer resumable',
    'META_K2_LOCAL_TARGET_NOT_RESUMABLE',
    { lifecycleStatus: row?.lifecycle_status ?? null, terminalReason: row?.terminal_reason ?? null },
  );
}

async function assertCursorUnlocked(db, cursorKey) {
  const lock = await db.prepare(`
    SELECT COUNT(*) AS count FROM sync_locks
    WHERE lock_key=? AND expires_at>unixepoch()*1000
  `).bind(cursorKey).first();
  if (Number(lock?.count) !== 0) {
    throw finalizerError('Exact retained K2 cursor has an active lock', 'META_K2_LOCAL_ACTIVE_LOCK');
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

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw finalizerError(`${fieldName} is required`, 'META_K2_LOCAL_INPUT_INVALID');
  }
  return value.trim();
}

function requireHttpsUrl(value, fieldName) {
  const text = requireText(value, fieldName);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw finalizerError(`${fieldName} is invalid`, 'META_K2_LOCAL_INPUT_INVALID');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw finalizerError(`${fieldName} must be a clean HTTPS URL`, 'META_K2_LOCAL_INPUT_INVALID');
  }
  return url.toString();
}

function nonNegative(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw finalizerError(`${fieldName} must be a non-negative integer`, 'META_K2_LOCAL_PROJECTION_RESPONSE_INVALID');
  }
  return number;
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
    const results = await this.executeStableKeyCommand(sql);
    if (results.length === 0 || results.some((result) => result.success !== true)) {
      throw finalizerError('Wrangler D1 command batch reported failure', 'META_K2_LOCAL_D1_BATCH_FAILED');
    }
    // The application bounds this adapter to 100 stable-key statements per batch and verifies
    // final D1/Lark parity. Replaying every statement is intentional: never infer a resume point
    // from row counts, and never risk skipping a key after an ambiguous remote response.
    return statements.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
  }

  async executeStableKeyCommand(sql) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.executeCommand(sql);
      } catch (error) {
        lastError = error;
        // A successful Wrangler process can rarely exit before emitting its JSON result. The
        // commit outcome is then ambiguous, but replaying this deterministic stable-key upsert
        // batch is logically idempotent. Never retry SQL, auth or other classified failures.
        if (error?.code !== 'META_K2_LOCAL_D1_JSON_INVALID' || attempt >= 3) throw error;
        await new Promise((resolvePromise) => {
          setTimeout(resolvePromise, 500 * (2 ** (attempt - 1)));
        });
      }
    }
    throw lastError;
  }

  async executeCommand(sql) {
    const readOnly = /^\s*(?:SELECT|PRAGMA)\b/iu.test(sql);
    let result = null;
    let lastError = null;
    for (let attempt = 1; attempt <= (readOnly ? 5 : 1); attempt += 1) {
      try {
        result = await execFileAsync('npx', [
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
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 5 && readOnly) await new Promise((resolvePromise) => {
          setTimeout(resolvePromise, 250 * (2 ** (attempt - 1)));
        });
      }
    }
    if (!result) throw lastError;
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
    source: 'exact retained 20260827 complete Customer K2 source snapshot',
    providerReads: 0,
    execution: 'local transform plus parameterized Customer D1 and stable-key Customer Lark writes',
    deletes: 0,
    replacementGeneration: false,
    generationFenceMutation: false,
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
