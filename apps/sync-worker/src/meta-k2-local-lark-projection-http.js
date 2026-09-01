import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { META_END_TO_END_LARK_TABLES } from '../../../packages/config/src/meta-end-to-end-runtime-config.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import {
  META_K2_LOCAL_LARK_PROJECTION_MODE,
  META_K2_LOCAL_LARK_PROJECTION_PATH,
  META_K2_LOCAL_LARK_PROJECTION_PHASE,
} from '../../../packages/config/src/meta-k2-local-lark-projection-contract.js';
import { D1ResumableWorkStore } from '../../../packages/sync-engine/src/queue-terminal-safe-d1-resumable-work-store.js';
import { createStableFingerprint } from '../../../packages/shared/src/hash/stable-fingerprint.js';
import { sanitizeOperationalError, sanitizeOperationalValue } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import { createInfrastructure } from './runtime-infrastructure.js';

export {
  META_K2_LOCAL_LARK_PROJECTION_MODE,
  META_K2_LOCAL_LARK_PROJECTION_PATH,
  META_K2_LOCAL_LARK_PROJECTION_PHASE,
};

const SOURCE_PHASE = 'meta_end_to_end_source_staging_v1';
const MAX_BODY_BYTES = 1_048_576;
const MAX_ROWS = 25;
const CONTRACTS = new Map(META_END_TO_END_LARK_TABLES
  .filter((contract) => contract.path.startsWith('canonical.ads'))
  .map((contract) => [contract.tableKey, contract]));

/** Preview-only exact K2 Lark writer. Heavy source assembly stays local; this route writes one bounded batch. */
export function createMetaK2LocalLarkProjectionHttpHandler(dependencies = {}) {
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const storeFactory = dependencies.createStore
    ?? ((env) => new MetaK2ProjectionStore({ db: requireD1(env) }));
  const workStoreFactory = dependencies.createWorkStore
    ?? ((env) => new D1ResumableWorkStore({ db: requireD1(env) }));
  const digest = dependencies.digest ?? sha256;

  return async function handleMetaK2LocalLarkProjection({ request, env, url }) {
    if (url.pathname !== META_K2_LOCAL_LARK_PROJECTION_PATH) return null;
    try {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'Method not allowed' }, {
          status: 405,
          headers: { allow: 'POST', ...noStoreHeaders() },
        });
      }
      const target = assertExactRuntime(env);
      await requireAuthorization(request, env, digest);
      const body = await readBoundedJson(request);
      assertOperation(body, target);
      const store = storeFactory(env);
      if (body.mode === 'write') {
        const contract = requireContract(body.tableKey, body.keyField);
        const rows = requireRows(body.rows);
        const batch = requireBatchIdentity(body);
        const calculatedDigest = await createStableFingerprint({
          schemaVersion: 'meta_k2_local_lark_projection_batch_v1',
          operation: target.operation,
          tableKey: contract.tableKey,
          keyField: contract.keyField,
          batchSequence: batch.batchSequence,
          rows,
        });
        if (calculatedDigest !== batch.batchDigest) {
          throw projectionError(
            'batchDigest does not match the exact target',
            'META_K2_LOCAL_LARK_BATCH_DIGEST_MISMATCH',
            { calculatedDigest, suppliedDigest: batch.batchDigest },
          );
        }

        await store.assertExactTarget?.(target.operation);
        const existing = await store.findBatch?.({
          workKey: target.operation.workKey,
          batchSequence: batch.batchSequence,
        });
        if (existing) {
          assertSavedBatch(existing, {
            ...batch,
            tableKey: contract.tableKey,
            keyField: contract.keyField,
            rowCount: rows.length,
          });
          const proof = await store.requireProgress({ ...target.operation, ...batch });
          return json({
            ok: true,
            mode: 'write',
            batchSequence: batch.batchSequence,
            rowCount: existing.rowCount,
            created: existing.created,
            updated: existing.updated,
            skipped: existing.skipped,
            replayedFromProof: true,
            proof,
          }, { status: 200, headers: noStoreHeaders() });
        }

        const tables = readLarkTableIdsFromEnv(env, [...CONTRACTS.keys()]);
        const infrastructure = infrastructureFactory(env);
        const result = await infrastructure.syncEngine.syncByKey({
          repository: infrastructure.repository,
          tableId: tables[contract.tableKey],
          keyField: contract.keyField,
          rows,
        });
        const accounted = result.created + result.updated + result.skipped;
        if (result.duplicateInputRows !== 0 || accounted !== rows.length) {
          throw projectionError('Lark batch reconciliation failed', 'META_K2_LOCAL_LARK_RECONCILIATION_FAILED');
        }
        const proof = await store.recordBatch({
          ...target.operation,
          ...batch,
          tableKey: contract.tableKey,
          keyField: contract.keyField,
          rowCount: rows.length,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
        });
        return json({
          ok: true,
          mode: 'write',
          batchSequence: batch.batchSequence,
          rowCount: rows.length,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          proof,
        }, { status: 200, headers: noStoreHeaders() });
      }
      if (body.mode === 'finalize') {
        const manifest = requireManifest(body);
        const proof = await store.requireComplete({ ...target.operation, ...manifest });
        const workStore = workStoreFactory(env);
        const recovery = await workStore.prepareCompletedSourceRedrive({
          workKey: target.operation.workKey,
          generation: target.operation.generation,
          sourcePhase: SOURCE_PHASE,
          auditReference: `meta-k2-local-lark:${manifest.manifestDigest}`,
        });
        if (recovery.disposition !== 'revived' && recovery.disposition !== 'active') {
          throw projectionError('Exact K2 Work could not be finalized', 'META_K2_LOCAL_LARK_FINALIZE_BLOCKED');
        }
        const completion = Object.freeze({
          schemaVersion: 'meta_end_to_end_reconciliation_v1',
          operationId: target.operation.operationId,
          connectorKey: 'meta_ads',
          localBoundedFinalizer: true,
          lark: proof,
          failed: 0,
        });
        await workStore.completeWork({ workKey: target.operation.workKey, completion });
        const readback = await store.readWork(target.operation.workKey);
        if (readback?.lifecycleStatus !== 'completed') {
          throw projectionError('Exact K2 Work completion readback failed', 'META_K2_LOCAL_LARK_FINALIZE_READBACK_FAILED');
        }
        return json({ ok: true, mode: 'finalize', status: 'completed', proof }, {
          status: 200,
          headers: noStoreHeaders(),
        });
      }
      throw projectionError('Projection mode is invalid', 'META_K2_LOCAL_LARK_MODE_INVALID');
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      console.error(JSON.stringify(sanitizeOperationalValue({
        timestamp: new Date().toISOString(),
        scope: 'meta_k2_local_lark_projection',
        code: operational.code,
        error: operational.message,
      })));
      const status = operational.code === 'META_K2_LOCAL_LARK_UNAUTHORIZED'
        ? 401
        : error?.retryable === true ? 503 : 400;
      const diagnostic = operational.code === 'META_K2_LOCAL_LARK_BATCH_DIGEST_MISMATCH'
        ? sanitizeOperationalValue(error?.details ?? {})
        : undefined;
      return json({
        ok: false,
        error: status === 401 ? 'Unauthorized' : 'Meta K2 projection failed',
        code: operational.code ?? 'META_K2_LOCAL_LARK_PROJECTION_FAILED',
        ...(diagnostic ? { diagnostic } : {}),
      }, { status, headers: noStoreHeaders() });
    }
  };
}

class MetaK2ProjectionStore {
  constructor(input = {}) {
    this.db = input.db;
    this.workStore = new D1ResumableWorkStore({ db: input.db });
  }

  async assertExactTarget(input) {
    const row = await this.db.prepare(`
      SELECT work.work_key, work.generation, work.lifecycle_status,
             fence.work_key AS fenced_work_key, fence.generation AS fenced_generation,
             (
               SELECT COUNT(*) FROM sync_locks AS lock
               WHERE lock.lock_key=work.cursor_key AND lock.expires_at>unixepoch()*1000
             ) AS active_lock_count
      FROM sync_work_runs AS work
      LEFT JOIN sync_generation_fences AS fence ON fence.cursor_key=work.cursor_key
      WHERE work.work_key=?
      LIMIT 1
    `).bind(input.workKey).first();
    if (!row || Number(row.generation) !== input.generation
      || row.fenced_work_key !== input.workKey || Number(row.fenced_generation) !== input.generation
      || row.lifecycle_status !== 'terminal' || Number(row.active_lock_count) !== 0) {
      throw projectionError('Exact K2 target is not a fenced unlocked terminal Work', 'META_K2_LOCAL_LARK_TARGET_NOT_WRITABLE');
    }
  }

  async findBatch(input) {
    const row = await this.db.prepare(`
      SELECT payload_json FROM sync_work_units
      WHERE work_key=? AND phase=? AND sequence=?
      LIMIT 1
    `).bind(input.workKey, META_K2_LOCAL_LARK_PROJECTION_PHASE, input.batchSequence).first();
    if (!row) return null;
    try {
      return Object.freeze(JSON.parse(row.payload_json));
    } catch {
      throw projectionError('Stored projection proof is invalid', 'META_K2_LOCAL_LARK_PROOF_INVALID');
    }
  }

  async requireProgress(input) {
    const phase = await this.workStore.loadPhase({ workKey: input.workKey, phase: META_K2_LOCAL_LARK_PROJECTION_PHASE });
    assertManifestCompatibility(phase?.state, input);
    if (!phase) {
      throw projectionError('Projection progress proof is absent', 'META_K2_LOCAL_LARK_PROOF_INVALID');
    }
    return Object.freeze({ ...phase.state, complete: phase.complete });
  }

  async recordBatch(input) {
    const current = await this.workStore.loadPhase({ workKey: input.workKey, phase: META_K2_LOCAL_LARK_PROJECTION_PHASE });
    assertManifestCompatibility(current?.state, input);
    await this.workStore.savePhase({
      workKey: input.workKey,
      phase: META_K2_LOCAL_LARK_PROJECTION_PHASE,
      state: manifestState(input),
      expectedItems: input.expectedRows,
      processedItems: Number(current?.processedItems ?? 0),
      pagesProcessed: 0,
      chunksProcessed: Number(current?.chunksProcessed ?? 0),
      complete: false,
      unit: {
        unitKey: `batch:${input.batchSequence}:${input.batchDigest}`,
        sequence: input.batchSequence,
        payload: {
          batchDigest: input.batchDigest,
          tableKey: input.tableKey,
          keyField: input.keyField,
          rowCount: input.rowCount,
          created: input.created,
          updated: input.updated,
          skipped: input.skipped,
        },
      },
    });
    const aggregate = await this.#aggregate(input.workKey);
    const complete = aggregate.batchCount === input.expectedBatches
      && aggregate.rowCount === input.expectedRows
      && aggregate.minSequence === 0
      && aggregate.maxSequence === input.expectedBatches - 1;
    await this.workStore.savePhase({
      workKey: input.workKey,
      phase: META_K2_LOCAL_LARK_PROJECTION_PHASE,
      state: { ...manifestState(input), ...aggregate },
      expectedItems: input.expectedRows,
      processedItems: aggregate.rowCount,
      pagesProcessed: 0,
      chunksProcessed: aggregate.batchCount,
      complete,
    });
    return Object.freeze({ ...aggregate, complete });
  }

  async requireComplete(input) {
    const phase = await this.workStore.loadPhase({ workKey: input.workKey, phase: META_K2_LOCAL_LARK_PROJECTION_PHASE });
    assertManifestCompatibility(phase?.state, input);
    if (phase?.complete !== true
      || phase.expectedItems !== input.expectedRows
      || phase.processedItems !== input.expectedRows
      || phase.chunksProcessed !== input.expectedBatches) {
      throw projectionError('Projection proof is incomplete', 'META_K2_LOCAL_LARK_PROOF_INCOMPLETE');
    }
    return Object.freeze({ ...phase.state, complete: true });
  }

  async readWork(workKey) {
    const row = await this.db.prepare(`
      SELECT lifecycle_status FROM sync_work_runs WHERE work_key=?
    `).bind(workKey).first();
    return row ? Object.freeze({ lifecycleStatus: row.lifecycle_status }) : null;
  }

  async #aggregate(workKey) {
    const row = await this.db.prepare(`
      SELECT COUNT(*) AS batch_count,
             COALESCE(SUM(CAST(json_extract(payload_json, '$.rowCount') AS INTEGER)), 0) AS row_count,
             COALESCE(SUM(CAST(json_extract(payload_json, '$.created') AS INTEGER)), 0) AS created,
             COALESCE(SUM(CAST(json_extract(payload_json, '$.updated') AS INTEGER)), 0) AS updated,
             COALESCE(SUM(CAST(json_extract(payload_json, '$.skipped') AS INTEGER)), 0) AS skipped,
             COALESCE(MIN(sequence), -1) AS min_sequence,
             COALESCE(MAX(sequence), -1) AS max_sequence
      FROM sync_work_units WHERE work_key=? AND phase=?
    `).bind(workKey, META_K2_LOCAL_LARK_PROJECTION_PHASE).first();
    return Object.freeze({
      batchCount: integer(row?.batch_count, 'batch_count'),
      rowCount: integer(row?.row_count, 'row_count'),
      created: integer(row?.created, 'created'),
      updated: integer(row?.updated, 'updated'),
      skipped: integer(row?.skipped, 'skipped'),
      minSequence: integer(row?.min_sequence, 'min_sequence', -1),
      maxSequence: integer(row?.max_sequence, 'max_sequence', -1),
    });
  }
}

function assertExactRuntime(env) {
  if (env?.MKT_META_K2_LOCAL_LARK_PROJECTION_MODE !== META_K2_LOCAL_LARK_PROJECTION_MODE) {
    throw projectionError('Projection route is disabled', 'META_K2_LOCAL_LARK_ROUTE_DISABLED');
  }
  const runtime = loadCustomerRuntimeConfig(env);
  if (runtime.environment !== 'production' || runtime.profileKey !== 'chemistry_k'
    || runtime.customerKey !== 'chemistry_k' || runtime.infrastructureOwner !== 'customer') {
    throw projectionError('Projection runtime is not Customer Production', 'META_K2_LOCAL_LARK_RUNTIME_INVALID');
  }
  return Object.freeze({
    operation: Object.freeze({
      operationId: requireText(env.MKT_META_K2_LOCAL_LARK_PROJECTION_OPERATION_ID, 'operationId'),
      workKey: requireText(env.MKT_META_K2_LOCAL_LARK_PROJECTION_WORK_KEY, 'workKey'),
      generation: timestamp(env.MKT_META_K2_LOCAL_LARK_PROJECTION_GENERATION, 'generation'),
    }),
  });
}

async function requireAuthorization(request, env, digest) {
  const match = /^Bearer[ \t]+(.+)$/iu.exec(request.headers.get('authorization') ?? '');
  const supplied = match?.[1]?.trim() ?? '';
  const suppliedDigest = supplied ? await digest(supplied) : '';
  const expectedDigest = requireSha256(env?.MKT_META_K2_LOCAL_LARK_PROJECTION_TOKEN_SHA256, 'tokenSha256');
  if (!match || !(await timingSafeEqualText(suppliedDigest, expectedDigest))) {
    throw projectionError('Projection authorization was rejected', 'META_K2_LOCAL_LARK_UNAUTHORIZED');
  }
}

async function readBoundedJson(request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    throw projectionError('Projection body is too large', 'META_K2_LOCAL_LARK_BODY_TOO_LARGE');
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw projectionError('Projection body is too large', 'META_K2_LOCAL_LARK_BODY_TOO_LARGE');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw projectionError('Projection body is invalid JSON', 'META_K2_LOCAL_LARK_BODY_INVALID');
  }
}

function assertOperation(body, target) {
  const operation = body?.operation;
  requireExact(operation?.operationId, target.operation.operationId, 'operationId');
  requireExact(operation?.workKey, target.operation.workKey, 'workKey');
  requireExact(Number(operation?.generation), target.operation.generation, 'generation');
}

function requireContract(tableKey, keyField) {
  const contract = CONTRACTS.get(requireText(tableKey, 'tableKey'));
  if (!contract || contract.keyField !== keyField) {
    throw projectionError('Projection table contract is invalid', 'META_K2_LOCAL_LARK_TABLE_INVALID');
  }
  return contract;
}

function requireRows(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ROWS
    || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw projectionError('Projection rows are invalid', 'META_K2_LOCAL_LARK_ROWS_INVALID');
  }
  return value;
}

function requireBatchIdentity(body) {
  return Object.freeze({
    batchSequence: integer(body.batchSequence, 'batchSequence'),
    expectedBatches: positiveInteger(body.expectedBatches, 'expectedBatches'),
    expectedRows: positiveInteger(body.expectedRows, 'expectedRows'),
    manifestDigest: requireSha256(body.manifestDigest, 'manifestDigest'),
    batchDigest: requireSha256(body.batchDigest, 'batchDigest'),
  });
}

function requireManifest(body) {
  return Object.freeze({
    expectedBatches: positiveInteger(body.expectedBatches, 'expectedBatches'),
    expectedRows: positiveInteger(body.expectedRows, 'expectedRows'),
    manifestDigest: requireSha256(body.manifestDigest, 'manifestDigest'),
  });
}

function assertManifestCompatibility(value, input) {
  if (!value) return;
  for (const field of ['manifestDigest', 'expectedBatches', 'expectedRows']) {
    if (value[field] !== input[field]) {
      throw projectionError('Projection manifest changed during execution', 'META_K2_LOCAL_LARK_MANIFEST_MISMATCH');
    }
  }
}

function assertSavedBatch(saved, expected) {
  for (const field of ['batchDigest', 'tableKey', 'keyField', 'rowCount']) {
    if (saved[field] !== expected[field]) {
      throw projectionError('Stored projection batch does not match the request', 'META_K2_LOCAL_LARK_BATCH_MISMATCH');
    }
  }
  for (const field of ['created', 'updated', 'skipped']) {
    integer(saved[field], field);
  }
}

function manifestState(input) {
  return Object.freeze({
    manifestDigest: input.manifestDigest,
    expectedBatches: input.expectedBatches,
    expectedRows: input.expectedRows,
  });
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireD1(env) {
  if (!env?.MKT_STATE_DB || typeof env.MKT_STATE_DB.prepare !== 'function') {
    throw projectionError('Customer D1 binding is missing', 'META_K2_LOCAL_LARK_D1_MISSING');
  }
  return env.MKT_STATE_DB;
}

function noStoreHeaders() {
  return { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) throw projectionError(`${fieldName} does not match the exact target`, 'META_K2_LOCAL_LARK_TARGET_MISMATCH');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw projectionError(`${fieldName} is required`, 'META_K2_LOCAL_LARK_INPUT_INVALID');
  }
  return value.trim();
}

function requireSha256(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw projectionError(`${fieldName} must be SHA-256`, 'META_K2_LOCAL_LARK_INPUT_INVALID');
  }
  return text;
}

function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw projectionError(`${fieldName} must be a timestamp`, 'META_K2_LOCAL_LARK_INPUT_INVALID');
  }
  return number;
}

function positiveInteger(value, fieldName) {
  const number = integer(value, fieldName);
  if (number < 1) throw projectionError(`${fieldName} must be positive`, 'META_K2_LOCAL_LARK_INPUT_INVALID');
  return number;
}

function integer(value, fieldName, minimum = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw projectionError(`${fieldName} must be an integer`, 'META_K2_LOCAL_LARK_INPUT_INVALID');
  }
  return number;
}

function projectionError(message, code, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  error.details = details;
  return error;
}
