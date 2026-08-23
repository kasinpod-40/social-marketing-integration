import {
  validateGoogleAdsQueueReference,
} from '../google-ads/google-ads-queue-reference.js';
import {
  assembleGoogleAdsLiveRun,
  buildGoogleAdsD1WriteSet,
  buildGoogleAdsLarkWriteSet,
} from '../google-ads/google-ads-live-run.js';
import {
  createStableFingerprint,
} from '../../../shared/src/hash/stable-fingerprint.js';
import {
  isRetryableError,
  permanentError,
  transientError,
} from '../../../shared/src/errors/runtime-error.js';

const PREFLIGHT_PHASE = 'google_ads_destination_preflight_v1';
const D1_PHASE = 'google_ads_d1_business_write_v1';
const LARK_PHASE = 'google_ads_lark_write_v1';
const DEFAULT_D1_ROWS_PER_INVOCATION = 250;
const DEFAULT_LARK_ROWS_PER_INVOCATION = 50;

const LARK_TABLES = Object.freeze([
  { path: 'canonical.accounts', tableKey: 'mktAdsAccounts', keyField: 'ads_account_key' },
  { path: 'canonical.campaigns', tableKey: 'mktAdsCampaigns', keyField: 'ads_campaign_key' },
  { path: 'canonical.assetGroups', tableKey: 'mktAdsAssetGroups', keyField: 'ads_asset_group_key' },
  { path: 'canonical.adGroups', tableKey: 'mktAdsAdGroups', keyField: 'ads_ad_group_key' },
  { path: 'canonical.ads', tableKey: 'mktAdsAds', keyField: 'ads_ad_key' },
  { path: 'canonical.creatives', tableKey: 'mktAdsCreatives', keyField: 'ads_creative_key' },
  { path: 'canonical.daily', tableKey: 'mktAdsDaily', keyField: 'ads_daily_key' },
]);

export async function processGoogleAdsManagerSignedDelivery(input = {}) {
  const reference = validateGoogleAdsQueueReference(input.queueReference);
  const admissionStore = requireMethods(input.admissionStore, [
    'getByOperationId', 'markProcessing', 'markFailed', 'markCompleted',
  ], 'admissionStore');
  const deliveryStore = requireMethods(input.deliveryStore, ['getRun', 'listRunChunks'], 'deliveryStore');
  const historyStore = requireMethods(input.historyStore, [
    'upsertAdsEntityState', 'upsertAdsDailyFact', 'saveCoverageRun', 'saveCoverageEntities',
  ], 'historyStore');
  const resumableWorkStore = requireMethods(input.resumableWorkStore, [
    'beginWork', 'loadPhase', 'savePhase', 'completeWork',
  ], 'resumableWorkStore');
  const repository = requireObject(input.repository, 'repository');
  const syncEngine = requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine');
  const continuationQueue = requireMethods(input.continuationQueue, ['send'], 'continuationQueue');
  const tables = requireObject(input.tables, 'tables');
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const cursorKey = requireText(input.cursorKey, 'cursorKey');
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;
  const maxD1Rows = boundedPositiveInteger(
    input.maxD1RowsPerInvocation ?? DEFAULT_D1_ROWS_PER_INVOCATION,
    'maxD1RowsPerInvocation',
    1_000,
  );
  const maxLarkRows = boundedPositiveInteger(
    input.maxLarkRowsPerInvocation ?? DEFAULT_LARK_ROWS_PER_INVOCATION,
    'maxLarkRowsPerInvocation',
    500,
  );

  if (input.businessWriteEnabled !== true || input.larkWriteEnabled !== true) {
    throw permanentError('Google Ads business and Lark write gates must both be enabled', {
      code: 'GOOGLE_ADS_PROCESSING_GATES_DISABLED',
    });
  }

  let admission = null;
  try {
    admission = await admissionStore.getByOperationId(reference.operationId);
    assertAdmissionMatches(admission, reference);
    if (admission.status === 'completed') {
      return Object.freeze({
        status: 'completed_idempotent',
        operationId: reference.operationId,
        reconciliation: admission.reconciliation,
      });
    }
    if (admission.status === 'failed_permanent') {
      throw permanentError('Google Ads LIVE admission is permanently failed', {
        code: admission.lastErrorCode ?? 'GOOGLE_ADS_LIVE_ADMISSION_FAILED_PERMANENT',
      });
    }
    await assertLockActive();
    admission = await admissionStore.markProcessing({ runId: reference.operationId, now: now() });

    const transport = await loadTransportRun({ deliveryStore, reference });
    const operationFingerprint = await createStableFingerprint({
      schemaVersion: reference.schemaVersion,
      operationId: reference.operationId,
      workKey: reference.workKey,
      generation: reference.generation,
      manifestDigest: transport.persistedRun.manifestDigest,
    }, {
      digestImpl: globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle),
    });
    const begun = await resumableWorkStore.beginWork({
      workKey: reference.workKey,
      cursorKey,
      workType: reference.type,
      operationFingerprint,
      generation: reference.generation,
      requestedAt: reference.originalRequestedAt,
    });
    if (begun.superseded) {
      return Object.freeze({ status: 'superseded', operationId: reference.operationId });
    }
    if (begun.completed) {
      const completed = await admissionStore.markCompleted({
        runId: reference.operationId,
        reconciliation: begun.completion ?? {},
        now: now(),
      });
      return Object.freeze({
        status: 'completed_idempotent',
        operationId: reference.operationId,
        reconciliation: completed.reconciliation,
      });
    }

    const writeSets = await buildWriteSets({
      run: transport.run,
      syncRunId,
      now: now(),
    });

    const preflight = await ensureDestinationPreflight({
      reference,
      resumableWorkStore,
      repository,
      syncEngine,
      tables,
      larkWriteSet: writeSets.lark,
      assertLockActive,
    });
    if (!preflight.complete) {
      return queueContinuation({ continuationQueue, reference, status: 'preflight_continuation' });
    }

    const d1 = await executeD1Phase({
      reference,
      resumableWorkStore,
      historyStore,
      writeSet: writeSets.d1,
      maxRows: maxD1Rows,
      assertLockActive,
    });
    if (!d1.complete) {
      return queueContinuation({ continuationQueue, reference, status: 'd1_continuation' });
    }

    const lark = await executeLarkPhase({
      reference,
      resumableWorkStore,
      repository,
      syncEngine,
      tables,
      writeSet: writeSets.lark,
      maxRows: maxLarkRows,
      assertLockActive,
    });
    if (!lark.complete) {
      return queueContinuation({ continuationQueue, reference, status: 'lark_continuation' });
    }

    const reconciliation = createReconciliation({ reference, run: transport.run, preflight, d1, lark });
    await assertLockActive();
    await resumableWorkStore.completeWork({ workKey: reference.workKey, completion: reconciliation });
    await admissionStore.markCompleted({ runId: reference.operationId, reconciliation, now: now() });
    return Object.freeze({ status: 'completed', operationId: reference.operationId, reconciliation });
  } catch (error) {
    if (admission && admission.status !== 'completed') {
      try {
        await admissionStore.markFailed({
          runId: reference.operationId,
          retryable: isRetryableError(error),
          errorCode: error?.code ?? 'GOOGLE_ADS_PROCESSING_FAILED',
          now: now(),
        });
      } catch (persistenceError) {
        throw transientError('Google Ads failure state could not be persisted', {
          code: 'GOOGLE_ADS_FAILURE_STATE_PERSIST_FAILED',
          cause: persistenceError,
          details: { originalCode: error?.code ?? null },
        });
      }
    }
    throw error;
  }
}

async function loadTransportRun({ deliveryStore, reference }) {
  const persistedRun = await deliveryStore.getRun(reference.operationId);
  if (!persistedRun
    || persistedRun.mode !== 'LIVE'
    || persistedRun.runStartedAt !== reference.generation
    || persistedRun.receivedChunkCount !== persistedRun.expectedChunkCount
    || persistedRun.receivedRowCount !== persistedRun.expectedRowCount
    || persistedRun.payloadRedactedAt !== null) {
    throw permanentError('Google Ads staged LIVE run is unavailable or incomplete', {
      code: 'GOOGLE_ADS_STAGED_RUN_INVALID',
    });
  }
  const chunks = await deliveryStore.listRunChunks(reference.operationId);
  if (chunks.length !== persistedRun.expectedChunkCount) {
    throw permanentError('Google Ads staged LIVE chunks are incomplete', {
      code: 'GOOGLE_ADS_STAGED_RUN_INCOMPLETE',
    });
  }
  const envelopes = chunks.map((chunk) => {
    if (typeof chunk.payloadJson !== 'string') {
      throw permanentError('Google Ads staged LIVE payload was redacted before completion', {
        code: 'GOOGLE_ADS_STAGED_PAYLOAD_UNAVAILABLE',
      });
    }
    try { return JSON.parse(chunk.payloadJson); } catch (cause) {
      throw transientError('Google Ads staged payload cannot be decoded', {
        code: 'GOOGLE_ADS_STAGED_PAYLOAD_CORRUPT',
        cause,
      });
    }
  });
  const run = assembleGoogleAdsLiveRun(envelopes);
  if (run.runId !== reference.operationId || Date.parse(run.runStartedAt) !== reference.generation) {
    throw permanentError('Google Ads Queue reference does not match staged run', {
      code: 'GOOGLE_ADS_STAGED_RUN_IDENTITY_MISMATCH',
    });
  }
  return Object.freeze({ persistedRun, run });
}

async function buildWriteSets({ run, syncRunId, now }) {
  const [d1, lark] = await Promise.all([
    buildGoogleAdsD1WriteSet({ run, syncRunId, now }),
    Promise.resolve(buildGoogleAdsLarkWriteSet({ run, syncRunId })),
  ]);
  return Object.freeze({ d1, lark });
}

async function ensureDestinationPreflight(input) {
  const existing = await input.resumableWorkStore.loadPhase({
    workKey: input.reference.workKey,
    phase: PREFLIGHT_PHASE,
  });
  if (existing?.complete) return existing;

  const summaries = [];
  for (const contract of LARK_TABLES) {
    await input.assertLockActive();
    const rows = readPath(input.larkWriteSet, contract.path);
    const tableId = requireText(input.tables[contract.tableKey], contract.tableKey);
    const plan = await input.syncEngine.planByKey({
      repository: input.repository,
      tableId,
      keyField: contract.keyField,
      rows,
    });
    if (plan.duplicateInputRows !== 0) {
      throw permanentError('Google Ads Lark preflight found duplicate input keys', {
        code: 'GOOGLE_ADS_LARK_PREFLIGHT_DUPLICATE',
        details: { tableKey: contract.tableKey },
      });
    }
    summaries.push(Object.freeze({
      tableKey: contract.tableKey,
      expected: rows.length,
      create: plan.createRows.length,
      update: plan.updateRows.length,
      skipped: plan.skipped,
    }));
  }
  return input.resumableWorkStore.savePhase({
    workKey: input.reference.workKey,
    phase: PREFLIGHT_PHASE,
    state: { summaries },
    expectedItems: LARK_TABLES.length,
    processedItems: LARK_TABLES.length,
    pagesProcessed: 0,
    chunksProcessed: LARK_TABLES.length,
    complete: true,
  });
}

async function executeD1Phase(input) {
  const operations = flattenD1Operations(input.writeSet);
  const existing = await input.resumableWorkStore.loadPhase({
    workKey: input.reference.workKey,
    phase: D1_PHASE,
  });
  let nextIndex = integer(existing?.state?.nextIndex ?? 0, 'nextIndex', 0, operations.length);
  const counts = normalizeCounts(existing?.state?.counts);
  if (existing?.complete || nextIndex >= operations.length) {
    return Object.freeze({ complete: true, state: { nextIndex: operations.length, counts } });
  }

  const stop = Math.min(operations.length, nextIndex + input.maxRows);
  while (nextIndex < stop) {
    await input.assertLockActive();
    const operation = operations[nextIndex];
    const result = await executeD1Operation(input.historyStore, operation);
    accumulateD1Result(counts, result, operation.kind);
    nextIndex += 1;
  }
  const complete = nextIndex >= operations.length;
  return input.resumableWorkStore.savePhase({
    workKey: input.reference.workKey,
    phase: D1_PHASE,
    state: { nextIndex, counts },
    expectedItems: operations.length,
    processedItems: nextIndex,
    pagesProcessed: 0,
    chunksProcessed: Math.ceil(nextIndex / input.maxRows),
    complete,
    unit: {
      unitKey: `rows:${Math.max(0, stop - input.maxRows)}-${stop}`,
      sequence: Math.max(0, stop - 1),
      payload: { processedThrough: stop, complete },
    },
  });
}

function flattenD1Operations(writeSet) {
  return Object.freeze([
    ...writeSet.entities.map((row) => Object.freeze({ kind: 'entity', row })),
    ...writeSet.dailyFacts.map((row) => Object.freeze({ kind: 'daily', row })),
    ...writeSet.coverageRuns.map((row) => Object.freeze({ kind: 'coverage_run', row })),
    ...writeSet.coverageEntities.map((row) => Object.freeze({ kind: 'coverage_entity', row })),
  ]);
}

async function executeD1Operation(store, operation) {
  if (operation.kind === 'entity') return store.upsertAdsEntityState(operation.row);
  if (operation.kind === 'daily') return store.upsertAdsDailyFact(operation.row);
  if (operation.kind === 'coverage_run') return store.saveCoverageRun(operation.row);
  if (operation.kind === 'coverage_entity') {
    const results = await store.saveCoverageEntities([operation.row]);
    return results[0];
  }
  throw new TypeError(`Unknown Google Ads D1 operation: ${operation.kind}`);
}

async function executeLarkPhase(input) {
  const existing = await input.resumableWorkStore.loadPhase({
    workKey: input.reference.workKey,
    phase: LARK_PHASE,
  });
  let nextTableIndex = integer(existing?.state?.nextTableIndex ?? 0, 'nextTableIndex', 0, LARK_TABLES.length);
  let nextRowIndex = integer(existing?.state?.nextRowIndex ?? 0, 'nextRowIndex', 0, Number.MAX_SAFE_INTEGER);
  let chunkIndex = integer(
    existing?.state?.chunkIndex ?? existing?.chunksProcessed ?? nextTableIndex,
    'chunkIndex',
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const results = Array.isArray(existing?.state?.results) ? [...existing.state.results] : [];
  if (existing?.complete || nextTableIndex >= LARK_TABLES.length) {
    return Object.freeze({
      complete: true,
      state: { nextTableIndex: LARK_TABLES.length, nextRowIndex: 0, chunkIndex, results },
    });
  }

  const contract = LARK_TABLES[nextTableIndex];
  const rows = readPath(input.writeSet, contract.path);
  nextRowIndex = integer(nextRowIndex, 'nextRowIndex', 0, rows.length);
  const startRowIndex = nextRowIndex;
  const stopRowIndex = Math.min(rows.length, startRowIndex + input.maxRows);
  const chunkRows = rows.slice(startRowIndex, stopRowIndex);
  const tableId = requireText(input.tables[contract.tableKey], contract.tableKey);
  await input.assertLockActive();
  const plan = await input.syncEngine.planByKey({
    repository: input.repository,
    tableId,
    keyField: contract.keyField,
    rows: chunkRows,
  });
  const result = await input.syncEngine.executePlan(plan, { beforeWriteChunk: input.assertLockActive });
  const accounted = result.created + result.updated + result.skipped;
  if (accounted !== chunkRows.length || result.duplicateInputRows !== 0) {
    throw permanentError('Google Ads Lark table reconciliation failed', {
      code: 'GOOGLE_ADS_LARK_RECONCILIATION_FAILED',
      details: { tableKey: contract.tableKey, expected: chunkRows.length, accounted },
    });
  }
  const prior = normalizeLarkResult(results[nextTableIndex], contract.tableKey, rows.length);
  const cumulative = Object.freeze({
    tableKey: contract.tableKey,
    expected: rows.length,
    created: prior.created + result.created,
    updated: prior.updated + result.updated,
    skipped: prior.skipped + result.skipped,
  });
  results[nextTableIndex] = cumulative;
  nextRowIndex = stopRowIndex;
  chunkIndex += 1;
  const tableComplete = nextRowIndex >= rows.length;
  if (tableComplete) {
    const totalAccounted = cumulative.created + cumulative.updated + cumulative.skipped;
    if (totalAccounted !== rows.length) {
      throw permanentError('Google Ads Lark table reconciliation failed', {
        code: 'GOOGLE_ADS_LARK_RECONCILIATION_FAILED',
        details: { tableKey: contract.tableKey, expected: rows.length, accounted: totalAccounted },
      });
    }
    nextTableIndex += 1;
    nextRowIndex = 0;
  }
  const complete = nextTableIndex >= LARK_TABLES.length;
  return input.resumableWorkStore.savePhase({
    workKey: input.reference.workKey,
    phase: LARK_PHASE,
    state: { nextTableIndex, nextRowIndex, chunkIndex, results },
    expectedItems: LARK_TABLES.length,
    processedItems: nextTableIndex,
    pagesProcessed: 0,
    chunksProcessed: chunkIndex,
    complete,
    unit: {
      unitKey: `${contract.tableKey}:rows:${startRowIndex}-${stopRowIndex}`,
      sequence: chunkIndex - 1,
      payload: cumulative,
    },
  });
}

function normalizeLarkResult(value, tableKey, expected) {
  if (!value) {
    return Object.freeze({ tableKey, expected, created: 0, updated: 0, skipped: 0 });
  }
  if (value.tableKey !== tableKey || Number(value.expected) !== expected) {
    throw permanentError('Google Ads Lark continuation state is inconsistent', {
      code: 'GOOGLE_ADS_LARK_CONTINUATION_STATE_INVALID',
      details: { tableKey },
    });
  }
  return Object.freeze({
    tableKey,
    expected,
    created: integer(value.created ?? 0, 'created', 0, expected),
    updated: integer(value.updated ?? 0, 'updated', 0, expected),
    skipped: integer(value.skipped ?? 0, 'skipped', 0, expected),
  });
}

async function queueContinuation({ continuationQueue, reference, status }) {
  try {
    await continuationQueue.send(reference);
  } catch (cause) {
    throw transientError('Google Ads continuation Queue send failed', {
      code: 'GOOGLE_ADS_CONTINUATION_QUEUE_SEND_FAILED',
      cause,
    });
  }
  return Object.freeze({ status, operationId: reference.operationId, continuationQueued: true });
}

function createReconciliation({ reference, run, preflight, d1, lark }) {
  const larkResults = lark.state?.results ?? [];
  for (const result of larkResults) {
    if (!result || result.created + result.updated + result.skipped !== result.expected) {
      throw permanentError('Google Ads final Lark reconciliation is incomplete', {
        code: 'GOOGLE_ADS_FINAL_RECONCILIATION_FAILED',
      });
    }
  }
  return Object.freeze({
    schemaVersion: 'google_ads_business_reconciliation_v1',
    operationId: reference.operationId,
    runId: run.runId,
    generation: reference.generation,
    datasets: run.summary.datasets,
    expectedRows: run.summary.expectedRowCount,
    preflight: preflight.state?.summaries ?? [],
    d1: d1.state?.counts ?? {},
    lark: larkResults,
    failed: 0,
  });
}

function assertAdmissionMatches(admission, reference) {
  if (!admission) {
    throw permanentError('Google Ads LIVE admission does not exist', {
      code: 'GOOGLE_ADS_LIVE_ADMISSION_NOT_FOUND',
    });
  }
  if (admission.operationId !== reference.operationId
    || admission.workKey !== reference.workKey
    || admission.generation !== reference.generation
    || admission.originalRequestedAt !== reference.originalRequestedAt) {
    throw permanentError('Google Ads Queue reference conflicts with LIVE admission', {
      code: 'GOOGLE_ADS_LIVE_ADMISSION_IDENTITY_MISMATCH',
    });
  }
  if (!['queued', 'processing', 'failed_retryable', 'completed'].includes(admission.status)) {
    throw permanentError('Google Ads LIVE admission is not queued for processing', {
      code: 'GOOGLE_ADS_LIVE_ADMISSION_NOT_QUEUED',
      details: { status: admission.status },
    });
  }
}

function normalizeCounts(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    created: Number(source.created ?? 0),
    updated: Number(source.updated ?? 0),
    skipped: Number(source.skipped ?? 0),
    entity: Number(source.entity ?? 0),
    daily: Number(source.daily ?? 0),
    coverage_run: Number(source.coverage_run ?? 0),
    coverage_entity: Number(source.coverage_entity ?? 0),
  };
}

function accumulateD1Result(counts, result, kind) {
  const status = result?.status ?? result?.action ?? result?.disposition ?? null;
  if (status === 'created') counts.created += 1;
  else if (status === 'updated') counts.updated += 1;
  else counts.skipped += 1;
  counts[kind] += 1;
}

function readPath(value, path) {
  const result = path.split('.').reduce((current, key) => current?.[key], value);
  if (!Array.isArray(result)) throw new TypeError(`Google Ads write set path is invalid: ${path}`);
  return result;
}

function requireMethods(value, methods, fieldName) {
  const object = requireObject(value, fieldName);
  for (const method of methods) {
    if (typeof object[method] !== 'function') throw new TypeError(`${fieldName}.${method} is required`);
  }
  return object;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} is required`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function boundedPositiveInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new TypeError(`${fieldName} must be an integer from 1 to ${maximum}`);
  }
  return number;
}

function integer(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${fieldName} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}
