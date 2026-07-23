import {
  beginTikTokResumableSource,
  completeTikTokResumableSource,
  replayTikTokCompletedWork,
  stageTikTokResumableSource,
  supersededTikTokResult,
} from './tiktok-resumable-source.js';
import { iterateTikTokStagedSourceUnits } from './tiktok-resumable-unit-reader.js';
import { normalizeTikTokHistoryBatch } from '../storage/normalize-tiktok-history-batch.js';
import { createOrganicHistoryWriter } from '../storage/organic-history-writer.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const TIKTOK_HISTORY_PREFLIGHT_PHASE = 'tiktok_organic_history_preflight_v1';
export const TIKTOK_HISTORY_WRITE_PHASE = 'tiktok_organic_history_write_v1';
const DATASET_KEY = 'organic_content_cumulative';

/**
 * Durable TikTok history bootstrap.
 * Source staging/preflight may resume freely, but each live Queue invocation writes at most one
 * staged source Unit before returning a continuation checkpoint.
 */
export async function bootstrapTikTokOrganicHistoryDurable(input = {}) {
  const gateway = requireGateway(input.gateway);
  await gateway.assertSchemaReady();

  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const sourceHandle = requireText(input.sourceHandle, 'sourceHandle');
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const customerKey = requireText(input.customerKey, 'customerKey');
  const sourceTimezone = requireText(input.sourceTimezone ?? 'Asia/Bangkok', 'sourceTimezone');
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const generation = requireTimestamp(input.generation ?? requestedAt, 'generation');
  if (generation !== requestedAt) {
    throw permanentError('TikTok history generation must equal original requestedAt', {
      code: 'TIKTOK_HISTORY_GENERATION_MISMATCH',
    });
  }
  const workKey = requireText(input.workKey, 'workKey');
  const cursorKey = requireText(input.cursorKey, 'cursorKey');
  const metricDate = dateOnlyInTimeZone(requestedAt, sourceTimezone);
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;

  const context = await beginTikTokResumableSource({
    workStore: requireWorkStore(input.resumableWorkStore),
    workKey,
    cursorKey,
    requestedAt,
    generation,
    accountId: accountKey,
    sourceHandle,
    metricDate,
    syncMode: 'full',
    incrementalEnabled: false,
    dryRun: input.dryRun === true,
    rawTableId: requireText(input.rawTableId, 'rawTableId'),
    assertLockActive,
  });

  if (context.work.superseded) {
    return Object.freeze({
      ...supersededTikTokResult(syncRunId, context.generation),
      operation: 'organic_history_bootstrap',
    });
  }
  if (context.work.completed) {
    return Object.freeze({
      ...replayTikTokCompletedWork(context, syncRunId),
      operation: 'organic_history_bootstrap',
    });
  }

  const sourceLoad = await stageTikTokResumableSource({
    context,
    repository: requireRepository(input.repository),
    tableId: input.rawTableId,
    pageSize: input.sourcePageSize,
    maxPages: input.sourceMaxPages,
    onProgress,
  });
  const sourceWatermark = await createStableFingerprint({
    contract: 'tiktok-organic-history-source-v1',
    workKey,
    generation: context.generation,
    accountKey,
    sourceHandle,
    requestedAt,
    records: sourceLoad.summary.records,
    pagesProcessed: sourceLoad.summary.pagesProcessed,
  });
  const coverageDigest = await createStableFingerprint({
    contract: 'tiktok-organic-history-coverage-v1',
    workKey,
    generation: context.generation,
    datasetKey: DATASET_KEY,
  });
  const coverageRunId = `coverage:tiktok:${coverageDigest}`;
  const writer = createOrganicHistoryWriter({
    gateway,
    customerProfile,
    customerKey,
    platform: 'tiktok',
    accountKey,
    sourceAccountId: null,
    sourceTimezone,
    observedAt: requestedAt,
    fetchedAt: requestedAt,
    historySyncRunId: `history:tiktok:${coverageDigest}`,
    coverageRunId,
    sourceRevision: sourceWatermark,
    scopeMode: 'full_inventory',
    datasetKey: DATASET_KEY,
  });

  const preflight = await preflightAllUnits({
    context,
    writer,
    accountKey,
    sourceHandle,
    sourceTimezone,
    metricDate,
    sourceSummary: sourceLoad.summary,
    onProgress,
  });

  if (input.dryRun === true) {
    const result = buildResult({
      syncRunId,
      mode: 'dry_run',
      context,
      sourceSummary: sourceLoad.summary,
      preflight,
      write: emptyWriteState(),
      coverageRunId,
      sourceWatermark,
      coverageStatus: preflight.issueRows > 0 ? 'partial' : 'complete',
      continuationRequired: false,
    });
    await completeTikTokResumableSource(context, result);
    return result;
  }

  await writer.beginCoverage({
    expectedEntities: preflight.rawRecords,
    expectedRows: preflight.rawRecords,
    sourceWatermark,
  });

  const previousWrite = await loadWriteState(context);
  const write = await writeOneUnit({
    context,
    writer,
    accountKey,
    sourceHandle,
    sourceTimezone,
    metricDate,
    sourceSummary: sourceLoad.summary,
    existingState: previousWrite,
    onProgress,
  });
  const complete = write.complete === true;

  if (!complete) {
    return buildResult({
      syncRunId,
      mode: 'd1_only_continuation',
      context,
      sourceSummary: sourceLoad.summary,
      preflight,
      write,
      coverageRunId,
      sourceWatermark,
      coverageStatus: 'partial',
      continuationRequired: true,
    });
  }

  const coverageStatus = preflight.issueRows === 0 ? 'complete' : 'partial';
  if (coverageStatus === 'complete') {
    await writer.completeCoverage({
      expectedEntities: preflight.rawRecords,
      observedEntities: write.validContentRows,
      expectedRows: preflight.rawRecords,
      observedRows: write.validContentRows,
      writtenRows: write.contentRowsDurable + write.observationRowsDurable,
      sourceWatermark,
      completedAt: Date.now(),
    });
  } else {
    await writer.failCoverage({
      expectedEntities: preflight.rawRecords,
      observedEntities: write.validContentRows,
      expectedRows: preflight.rawRecords,
      observedRows: write.validContentRows,
      writtenRows: write.contentRowsDurable + write.observationRowsDurable,
      failedRows: preflight.issueRows,
      sourceWatermark,
      errorCode: 'TIKTOK_HISTORY_SOURCE_ROWS_PARTIAL',
      completedAt: Date.now(),
    });
  }

  const result = buildResult({
    syncRunId,
    mode: 'd1_only',
    context,
    sourceSummary: sourceLoad.summary,
    preflight,
    write,
    coverageRunId,
    sourceWatermark,
    coverageStatus,
    continuationRequired: false,
  });
  await completeTikTokResumableSource(context, result);
  return result;
}

async function preflightAllUnits(input) {
  const existing = await input.context.store.loadPhase({
    workKey: input.context.workKey,
    phase: TIKTOK_HISTORY_PREFLIGHT_PHASE,
  });
  if (existing?.complete) return normalizePreflight(existing.state);

  let state = normalizePreflight(existing?.state);
  const seen = new Set(state.seenContentKeys);
  for await (const unit of iterateTikTokStagedSourceUnits({
    context: input.context,
    afterSequence: state.nextSequence,
  })) {
    const normalized = normalizeTikTokHistoryBatch({
      records: unit.records,
      accountKey: input.accountKey,
      sourceHandle: input.sourceHandle,
      sourceTimezone: input.sourceTimezone,
      metricDate: input.metricDate,
    });
    const selected = selectUniqueRows(normalized, seen);
    const plan = await input.writer.preflightBatch(selected);
    const duplicateRows = duplicateCount(normalized) + selected.crossUnitDuplicates;
    const skippedRows = normalized.skippedRows.length;
    state = Object.freeze({
      nextSequence: unit.sequence + 1,
      unitsPreflighted: state.unitsPreflighted + 1,
      rawRecords: state.rawRecords + unit.records.length,
      validContentRows: state.validContentRows + plan.contentRows,
      skippedRows: state.skippedRows + skippedRows,
      duplicateRows: state.duplicateRows + duplicateRows,
      issueRows: state.issueRows + skippedRows + duplicateRows,
      plannedStateRows: state.plannedStateRows + plan.stateRows.length,
      plannedObservationRows: state.plannedObservationRows + plan.observationRows.length,
      seenContentKeys: Object.freeze([...seen].sort()),
    });
    await savePhase(
      input.context,
      TIKTOK_HISTORY_PREFLIGHT_PHASE,
      state,
      false,
      input.sourceSummary,
    );
    input.onProgress(Object.freeze({
      stage: 'tiktok_history_unit_preflighted',
      sequence: unit.sequence,
      rawRecords: unit.records.length,
      validContentRows: plan.contentRows,
      issueRows: skippedRows + duplicateRows,
    }));
  }
  assertCompleteness(state.rawRecords, input.sourceSummary.records, 'preflight');
  await savePhase(input.context, TIKTOK_HISTORY_PREFLIGHT_PHASE, state, true, input.sourceSummary);
  return state;
}

async function writeOneUnit(input) {
  if (input.existingState.complete) return input.existingState;
  const seen = new Set(input.existingState.seenContentKeys);
  let selectedUnit = null;
  for await (const unit of iterateTikTokStagedSourceUnits({
    context: input.context,
    afterSequence: input.existingState.nextSequence,
  })) {
    selectedUnit = unit;
    break;
  }

  if (!selectedUnit) {
    assertCompleteness(
      input.existingState.rawRecordsCompleted,
      input.sourceSummary.records,
      'write',
    );
    const completed = Object.freeze({ ...input.existingState, complete: true });
    await savePhase(input.context, TIKTOK_HISTORY_WRITE_PHASE, completed, true, input.sourceSummary);
    return completed;
  }

  const normalized = normalizeTikTokHistoryBatch({
    records: selectedUnit.records,
    accountKey: input.accountKey,
    sourceHandle: input.sourceHandle,
    sourceTimezone: input.sourceTimezone,
    metricDate: input.metricDate,
  });
  const selected = selectUniqueRows(normalized, seen);
  await input.context.assertCurrent();
  // writeBatch is intentionally replayed as a whole after interruption. Stable state, observation
  // and Coverage keys make already-durable rows safe while the phase checkpoint remains unchanged.
  const result = await input.writer.writeBatch(selected);
  const rawRecordsCompleted = input.existingState.rawRecordsCompleted + selectedUnit.records.length;
  const complete = rawRecordsCompleted === input.sourceSummary.records;
  const state = Object.freeze({
    ...input.existingState,
    nextSequence: selectedUnit.sequence + 1,
    unitsCompleted: input.existingState.unitsCompleted + 1,
    rawRecordsCompleted,
    validContentRows: input.existingState.validContentRows + result.contentRows,
    contentRowsDurable: input.existingState.contentRowsDurable + result.contentRows,
    observationRowsDurable: input.existingState.observationRowsDurable
      + result.observationsCreated + result.observationsSkipped,
    stateWritten: input.existingState.stateWritten + result.stateWritten,
    stateSkipped: input.existingState.stateSkipped + result.stateSkipped,
    observationsCreated: input.existingState.observationsCreated + result.observationsCreated,
    observationsSkipped: input.existingState.observationsSkipped + result.observationsSkipped,
    observationsNotRequired: input.existingState.observationsNotRequired
      + result.observationsNotRequired,
    coverageEntitiesWritten: input.existingState.coverageEntitiesWritten
      + result.coverageEntitiesWritten,
    coverageEntitiesSkipped: input.existingState.coverageEntitiesSkipped
      + result.coverageEntitiesSkipped,
    seenContentKeys: Object.freeze([...seen].sort()),
    complete,
  });
  await savePhase(input.context, TIKTOK_HISTORY_WRITE_PHASE, state, complete, input.sourceSummary);
  input.onProgress(Object.freeze({
    stage: 'tiktok_history_unit_written',
    sequence: selectedUnit.sequence,
    d1ContentRows: result.contentRows,
    observationsCreated: result.observationsCreated,
    observationsSkipped: result.observationsSkipped,
    continuationRequired: !complete,
  }));
  return state;
}

function selectUniqueRows(normalized, seen) {
  const dailyByKey = new Map(normalized.dailySnapshotRows.map((row) => [
    `${row.platform}:${row.account_id}:${row.external_content_id}`,
    row,
  ]));
  const contentRows = [];
  const dailySnapshotRows = [];
  let crossUnitDuplicates = 0;
  for (const row of normalized.contentRows) {
    const key = row.content_key;
    if (seen.has(key)) {
      crossUnitDuplicates += 1;
      continue;
    }
    seen.add(key);
    contentRows.push(row);
    const daily = dailyByKey.get(key);
    if (!daily) {
      throw permanentError('TikTok history normalized rows are incomplete', {
        code: 'TIKTOK_HISTORY_NORMALIZATION_INCOMPLETE',
        details: { contentKey: key },
      });
    }
    dailySnapshotRows.push(daily);
  }
  return Object.freeze({
    contentRows: Object.freeze(contentRows),
    dailySnapshotRows: Object.freeze(dailySnapshotRows),
    crossUnitDuplicates,
  });
}

function buildResult(input) {
  return Object.freeze({
    syncRunId: input.syncRunId,
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    operation: 'organic_history_bootstrap',
    mode: input.mode,
    destinationMode: 'd1_only',
    rawRecords: input.sourceSummary.records,
    sourcePagination: input.sourceSummary,
    sourceIdentity: Object.freeze({ expectedHandle: 'chemistry_k' }),
    continuationRequired: input.continuationRequired === true,
    nextSequence: input.write.nextSequence ?? 0,
    d1: Object.freeze({
      schemaReady: true,
      coverageRunId: input.coverageRunId,
      coverageStatus: input.coverageStatus,
      sourceWatermark: input.sourceWatermark,
      plannedStateRows: input.preflight.plannedStateRows,
      plannedObservationRows: input.preflight.plannedObservationRows,
      contentRowsDurable: input.write.contentRowsDurable,
      observationRowsDurable: input.write.observationRowsDurable,
      stateWritten: input.write.stateWritten,
      stateSkipped: input.write.stateSkipped,
      observationsCreated: input.write.observationsCreated,
      observationsSkipped: input.write.observationsSkipped,
      observationsNotRequired: input.write.observationsNotRequired,
      coverageEntitiesWritten: input.write.coverageEntitiesWritten,
      coverageEntitiesSkipped: input.write.coverageEntitiesSkipped,
    }),
    lark: Object.freeze({ contentWrites: 0, dailyWrites: 0, blocked: true }),
    reconciliation: Object.freeze({
      expectedEntities: input.preflight.rawRecords,
      observedEntities: input.write.validContentRows,
      expectedRows: input.preflight.rawRecords,
      observedRows: input.write.validContentRows,
      failedRows: input.coverageStatus === 'complete' ? 0 : input.preflight.issueRows,
      skippedRows: input.preflight.skippedRows,
      duplicateRows: input.preflight.duplicateRows,
      status: input.coverageStatus,
    }),
    resumableWork: Object.freeze({
      generation: input.context.generation,
      complete: input.mode === 'd1_only',
      bounded: true,
      maxSourceUnitsPerInvocation: 1,
    }),
  });
}

function normalizePreflight(value = {}) {
  return Object.freeze({
    nextSequence: nonNegative(value.nextSequence),
    unitsPreflighted: nonNegative(value.unitsPreflighted),
    rawRecords: nonNegative(value.rawRecords),
    validContentRows: nonNegative(value.validContentRows),
    skippedRows: nonNegative(value.skippedRows),
    duplicateRows: nonNegative(value.duplicateRows),
    issueRows: nonNegative(value.issueRows),
    plannedStateRows: nonNegative(value.plannedStateRows),
    plannedObservationRows: nonNegative(value.plannedObservationRows),
    seenContentKeys: Object.freeze(Array.isArray(value.seenContentKeys) ? value.seenContentKeys : []),
  });
}

async function loadWriteState(context) {
  const phase = await context.store.loadPhase({
    workKey: context.workKey,
    phase: TIKTOK_HISTORY_WRITE_PHASE,
  });
  const value = phase?.state ?? {};
  return Object.freeze({
    nextSequence: nonNegative(value.nextSequence),
    unitsCompleted: nonNegative(value.unitsCompleted),
    rawRecordsCompleted: nonNegative(value.rawRecordsCompleted),
    validContentRows: nonNegative(value.validContentRows),
    contentRowsDurable: nonNegative(value.contentRowsDurable),
    observationRowsDurable: nonNegative(value.observationRowsDurable),
    stateWritten: nonNegative(value.stateWritten),
    stateSkipped: nonNegative(value.stateSkipped),
    observationsCreated: nonNegative(value.observationsCreated),
    observationsSkipped: nonNegative(value.observationsSkipped),
    observationsNotRequired: nonNegative(value.observationsNotRequired),
    coverageEntitiesWritten: nonNegative(value.coverageEntitiesWritten),
    coverageEntitiesSkipped: nonNegative(value.coverageEntitiesSkipped),
    seenContentKeys: Object.freeze(Array.isArray(value.seenContentKeys) ? value.seenContentKeys : []),
    complete: phase?.complete === true || value.complete === true,
  });
}

function emptyWriteState() {
  return Object.freeze({
    nextSequence: 0,
    unitsCompleted: 0,
    rawRecordsCompleted: 0,
    validContentRows: 0,
    contentRowsDurable: 0,
    observationRowsDurable: 0,
    stateWritten: 0,
    stateSkipped: 0,
    observationsCreated: 0,
    observationsSkipped: 0,
    observationsNotRequired: 0,
    coverageEntitiesWritten: 0,
    coverageEntitiesSkipped: 0,
    seenContentKeys: Object.freeze([]),
    complete: false,
  });
}

async function savePhase(context, phase, state, complete, sourceSummary) {
  await context.assertCurrent();
  return context.store.savePhase({
    workKey: context.workKey,
    phase,
    state,
    expectedItems: sourceSummary.records,
    processedItems: phase === TIKTOK_HISTORY_PREFLIGHT_PHASE
      ? state.rawRecords
      : state.rawRecordsCompleted,
    pagesProcessed: phase === TIKTOK_HISTORY_PREFLIGHT_PHASE
      ? state.unitsPreflighted
      : state.unitsCompleted,
    chunksProcessed: phase === TIKTOK_HISTORY_PREFLIGHT_PHASE
      ? state.unitsPreflighted
      : state.unitsCompleted,
    complete,
  });
}

function duplicateCount(normalized) {
  return Math.max(
    nonNegative(normalized.duplicateContentRows),
    nonNegative(normalized.duplicateDailyRows),
  );
}

function assertCompleteness(actual, expected, phase) {
  if (actual !== expected) {
    throw permanentError(`TikTok history ${phase} completeness check failed`, {
      code: 'TIKTOK_HISTORY_BOOTSTRAP_INCOMPLETE',
      details: { phase, expectedRows: expected, processedRows: actual },
    });
  }
}

function dateOnlyInTimeZone(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function requireGateway(value) {
  if (typeof value?.assertSchemaReady !== 'function') {
    throw new TypeError('TikTok history bootstrap requires gateway');
  }
  return value;
}

function requireWorkStore(value) {
  for (const method of ['beginWork', 'loadPhase', 'savePhase', 'listPhaseUnits', 'completeWork']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`TikTok history bootstrap requires resumableWorkStore.${method}`);
    }
  }
  return value;
}

function requireRepository(value) {
  if (typeof value?.listPage !== 'function') {
    throw new TypeError('TikTok history bootstrap requires repository.listPage');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok history bootstrap requires ${fieldName}`);
  }
  return value.trim();
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw new TypeError(`TikTok history bootstrap ${fieldName} must be epoch milliseconds`);
  }
  return number;
}

function nonNegative(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError('TikTok history bootstrap requires non-negative counters');
  }
  return number;
}
