import {
  beginTikTokResumableSource,
  completeTikTokResumableSource,
  replayTikTokCompletedWork,
  stageTikTokResumableSource,
  supersededTikTokResult,
} from './tiktok-resumable-source.js';
import { iterateTikTokStagedSourceUnits } from './tiktok-resumable-unit-reader.js';
import { normalizeTikTokHistoryBatch } from '../storage/normalize-tiktok-history-batch.js';
import { createDurableOrganicHistoryWriter } from '../storage/durable-organic-history-writer.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const TIKTOK_HISTORY_PREFLIGHT_PHASE = 'tiktok_organic_history_preflight_v1';
export const TIKTOK_HISTORY_WRITE_PHASE = 'tiktok_organic_history_write_v1';
const DATASET_KEY = 'organic_content_cumulative';

/**
 * Process at most one staged source Unit per Queue invocation.
 * Preflight is also staged one Unit at a time; live D1 writes begin only on a later invocation
 * after full-source preflight has already completed.
 */
export async function bootstrapTikTokOrganicHistoryDurable(input = {}) {
  const gateway = requireGateway(input.gateway);
  await gateway.assertSchemaReady();
  const values = normalizeInput(input);
  const context = await beginTikTokResumableSource({
    workStore: requireWorkStore(input.resumableWorkStore),
    workKey: values.workKey,
    cursorKey: values.cursorKey,
    requestedAt: values.requestedAt,
    generation: values.generation,
    accountId: values.accountKey,
    sourceHandle: values.sourceHandle,
    metricDate: values.metricDate,
    syncMode: 'full',
    incrementalEnabled: false,
    dryRun: values.dryRun,
    rawTableId: values.rawTableId,
    assertLockActive: values.assertLockActive,
  });
  if (context.work.superseded) {
    return Object.freeze({
      ...supersededTikTokResult(values.syncRunId, context.generation),
      operation: 'organic_history_bootstrap',
    });
  }
  if (context.work.completed) {
    return Object.freeze({
      ...replayTikTokCompletedWork(context, values.syncRunId),
      operation: 'organic_history_bootstrap',
    });
  }

  const source = await stageTikTokResumableSource({
    context,
    repository: requireRepository(input.repository),
    tableId: values.rawTableId,
    pageSize: input.sourcePageSize,
    maxPages: input.sourceMaxPages,
    onProgress: values.onProgress,
  });
  const identities = await createHistoryIdentities({ context, values, source });
  const writer = createDurableOrganicHistoryWriter({
    gateway,
    customerProfile: values.customerProfile,
    customerKey: values.customerKey,
    platform: 'tiktok',
    accountKey: values.accountKey,
    sourceAccountId: null,
    sourceTimezone: values.sourceTimezone,
    observedAt: values.requestedAt,
    fetchedAt: values.requestedAt,
    historySyncRunId: identities.historySyncRunId,
    coverageRunId: identities.coverageRunId,
    sourceRevision: identities.sourceWatermark,
    scopeMode: 'full_inventory',
    datasetKey: DATASET_KEY,
  });
  const unitInput = {
    context,
    writer,
    accountKey: values.accountKey,
    sourceHandle: values.sourceHandle,
    sourceTimezone: values.sourceTimezone,
    metricDate: values.metricDate,
    sourceSummary: source.summary,
    onProgress: values.onProgress,
  };

  const preflightStep = await preflightOneUnit(unitInput);
  const preflight = preflightStep.state;
  const existingWrite = await loadWriteState(context);

  // Even the invocation that completes the final preflight Unit stops here. This preserves the
  // hard one-Unit boundary; a continuation begins D1 business writes on the next invocation.
  if (preflightStep.processedUnit) {
    if (values.dryRun && preflightStep.complete) {
      const result = buildResult({
        values,
        context,
        sourceSummary: source.summary,
        preflight,
        write: existingWrite,
        identities,
        mode: 'dry_run',
        coverageStatus: preflight.issueRows > 0 ? 'partial' : 'complete',
        continuationRequired: false,
        continuationPhase: null,
        nextSequence: preflight.nextSequence,
      });
      await completeTikTokResumableSource(context, result);
      return result;
    }
    return buildResult({
      values,
      context,
      sourceSummary: source.summary,
      preflight,
      write: existingWrite,
      identities,
      mode: 'd1_only_preflight_continuation',
      coverageStatus: 'not_started',
      continuationRequired: true,
      continuationPhase: TIKTOK_HISTORY_PREFLIGHT_PHASE,
      nextSequence: preflight.nextSequence,
    });
  }

  if (!preflightStep.complete) {
    throw permanentError('TikTok history preflight made no progress', {
      code: 'TIKTOK_HISTORY_BOOTSTRAP_INCOMPLETE',
      details: {
        phase: TIKTOK_HISTORY_PREFLIGHT_PHASE,
        nextSequence: preflight.nextSequence,
      },
    });
  }

  if (values.dryRun) {
    const result = buildResult({
      values,
      context,
      sourceSummary: source.summary,
      preflight,
      write: existingWrite,
      identities,
      mode: 'dry_run',
      coverageStatus: preflight.issueRows > 0 ? 'partial' : 'complete',
      continuationRequired: false,
      continuationPhase: null,
      nextSequence: preflight.nextSequence,
    });
    await completeTikTokResumableSource(context, result);
    return result;
  }

  await writer.beginCoverage({
    expectedEntities: preflight.rawRecords,
    expectedRows: preflight.rawRecords,
    sourceWatermark: identities.sourceWatermark,
  });
  const write = await writeOneUnit({
    ...unitInput,
    existingState: existingWrite,
  });
  if (!write.complete) {
    return buildResult({
      values,
      context,
      sourceSummary: source.summary,
      preflight,
      write,
      identities,
      mode: 'd1_only_write_continuation',
      coverageStatus: 'partial',
      continuationRequired: true,
      continuationPhase: TIKTOK_HISTORY_WRITE_PHASE,
      nextSequence: write.nextSequence,
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
      sourceWatermark: identities.sourceWatermark,
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
      sourceWatermark: identities.sourceWatermark,
      errorCode: 'TIKTOK_HISTORY_SOURCE_ROWS_PARTIAL',
      completedAt: Date.now(),
    });
  }
  const result = buildResult({
    values,
    context,
    sourceSummary: source.summary,
    preflight,
    write,
    identities,
    mode: 'd1_only',
    coverageStatus,
    continuationRequired: false,
    continuationPhase: null,
    nextSequence: write.nextSequence,
  });
  await completeTikTokResumableSource(context, result);
  return result;
}

async function createHistoryIdentities({ context, values, source }) {
  const sourceWatermark = await createStableFingerprint({
    contract: 'tiktok-organic-history-source-v1',
    workKey: values.workKey,
    generation: context.generation,
    accountKey: values.accountKey,
    sourceHandle: values.sourceHandle,
    requestedAt: values.requestedAt,
    records: source.summary.records,
    pagesProcessed: source.summary.pagesProcessed,
  });
  const digest = await createStableFingerprint({
    contract: 'tiktok-organic-history-coverage-v1',
    workKey: values.workKey,
    generation: context.generation,
    datasetKey: DATASET_KEY,
  });
  return Object.freeze({
    sourceWatermark,
    coverageRunId: `coverage:tiktok:${digest}`,
    historySyncRunId: `history:tiktok:${digest}`,
  });
}

async function preflightOneUnit(input) {
  const existing = await input.context.store.loadPhase({
    workKey: input.context.workKey,
    phase: TIKTOK_HISTORY_PREFLIGHT_PHASE,
  });
  if (existing?.complete) {
    return Object.freeze({
      state: normalizePreflight(existing.state),
      complete: true,
      processedUnit: false,
    });
  }

  const previous = normalizePreflight(existing?.state);
  const seen = new Set(previous.seenContentKeys);
  let nextUnit = null;
  for await (const unit of iterateTikTokStagedSourceUnits({
    context: input.context,
    afterSequence: previous.nextSequence,
  })) {
    nextUnit = unit;
    break;
  }
  if (!nextUnit) {
    assertCompleteness(previous.rawRecords, input.sourceSummary.records, 'preflight');
    await savePhase(
      input.context,
      TIKTOK_HISTORY_PREFLIGHT_PHASE,
      previous,
      true,
      input.sourceSummary,
    );
    return Object.freeze({ state: previous, complete: true, processedUnit: false });
  }

  const normalized = normalizeUnit(input, nextUnit.records);
  const selected = selectUniqueRows(normalized, seen);
  const plan = await input.writer.preflightBatch(selected);
  const duplicateRows = duplicateCount(normalized) + selected.crossUnitDuplicates;
  const skippedRows = normalized.skippedRows.length;
  const state = Object.freeze({
    nextSequence: nextUnit.sequence + 1,
    unitsPreflighted: previous.unitsPreflighted + 1,
    rawRecords: previous.rawRecords + nextUnit.records.length,
    validContentRows: previous.validContentRows + plan.contentRows,
    skippedRows: previous.skippedRows + skippedRows,
    duplicateRows: previous.duplicateRows + duplicateRows,
    issueRows: previous.issueRows + skippedRows + duplicateRows,
    plannedStateRows: previous.plannedStateRows + plan.stateRows.length,
    plannedObservationRows: previous.plannedObservationRows + plan.observationRows.length,
    seenContentKeys: Object.freeze([...seen].sort()),
  });
  const complete = state.rawRecords === input.sourceSummary.records;
  if (state.rawRecords > input.sourceSummary.records) {
    throw permanentError('TikTok history preflight exceeded staged source size', {
      code: 'TIKTOK_HISTORY_BOOTSTRAP_INCOMPLETE',
      details: {
        expectedRows: input.sourceSummary.records,
        processedRows: state.rawRecords,
      },
    });
  }
  await savePhase(
    input.context,
    TIKTOK_HISTORY_PREFLIGHT_PHASE,
    state,
    complete,
    input.sourceSummary,
  );
  input.onProgress(Object.freeze({
    stage: 'tiktok_history_unit_preflighted',
    sequence: nextUnit.sequence,
    rawRecords: nextUnit.records.length,
    validContentRows: plan.contentRows,
    issueRows: skippedRows + duplicateRows,
    continuationRequired: !complete || input.context.dryRun !== true,
  }));
  return Object.freeze({ state, complete, processedUnit: true });
}

async function writeOneUnit(input) {
  if (input.existingState.complete) return input.existingState;
  const seen = new Set(input.existingState.seenContentKeys);
  let nextUnit = null;
  for await (const unit of iterateTikTokStagedSourceUnits({
    context: input.context,
    afterSequence: input.existingState.nextSequence,
  })) {
    nextUnit = unit;
    break;
  }
  if (!nextUnit) {
    assertCompleteness(input.existingState.rawRecordsCompleted, input.sourceSummary.records, 'write');
    const complete = Object.freeze({ ...input.existingState, complete: true });
    await savePhase(input.context, TIKTOK_HISTORY_WRITE_PHASE, complete, true, input.sourceSummary);
    return complete;
  }

  const selected = selectUniqueRows(normalizeUnit(input, nextUnit.records), seen);
  await input.context.assertCurrent();
  const result = await input.writer.writeBatch(selected);
  const rawRecordsCompleted = input.existingState.rawRecordsCompleted + nextUnit.records.length;
  const complete = rawRecordsCompleted === input.sourceSummary.records;
  if (rawRecordsCompleted > input.sourceSummary.records) {
    throw permanentError('TikTok history write exceeded staged source size', {
      code: 'TIKTOK_HISTORY_BOOTSTRAP_INCOMPLETE',
      details: {
        expectedRows: input.sourceSummary.records,
        processedRows: rawRecordsCompleted,
      },
    });
  }
  const state = Object.freeze({
    ...input.existingState,
    nextSequence: nextUnit.sequence + 1,
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
    sequence: nextUnit.sequence,
    d1ContentRows: result.contentRows,
    observationsCreated: result.observationsCreated,
    observationsSkipped: result.observationsSkipped,
    continuationRequired: !complete,
  }));
  return state;
}

function normalizeUnit(input, records) {
  return normalizeTikTokHistoryBatch({
    records,
    accountKey: input.accountKey,
    sourceHandle: input.sourceHandle,
    sourceTimezone: input.sourceTimezone,
    metricDate: input.metricDate,
  });
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
    if (seen.has(row.content_key)) {
      crossUnitDuplicates += 1;
      continue;
    }
    seen.add(row.content_key);
    contentRows.push(row);
    const daily = dailyByKey.get(row.content_key);
    if (!daily) {
      throw permanentError('TikTok history normalized rows are incomplete', {
        code: 'TIKTOK_HISTORY_NORMALIZATION_INCOMPLETE',
        details: { contentKey: row.content_key },
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
  const { write, preflight, sourceSummary } = input;
  const dryRun = input.mode === 'dry_run';
  const observedEntities = dryRun ? preflight.validContentRows : write.validContentRows;
  return Object.freeze({
    syncRunId: input.values.syncRunId,
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    operation: 'organic_history_bootstrap',
    mode: input.mode,
    destinationMode: 'd1_only',
    dryRun,
    rawRecords: sourceSummary.records,
    sourcePagination: sourceSummary,
    sourceIdentity: Object.freeze({ expectedHandle: 'chemistry_k' }),
    continuationRequired: input.continuationRequired,
    continuationPhase: input.continuationPhase,
    nextSequence: input.nextSequence,
    d1: Object.freeze({
      schemaReady: true,
      coverageRunId: input.identities.coverageRunId,
      coverageStatus: input.coverageStatus,
      sourceWatermark: input.identities.sourceWatermark,
      plannedStateRows: preflight.plannedStateRows,
      plannedObservationRows: preflight.plannedObservationRows,
      contentRowsDurable: write.contentRowsDurable,
      observationRowsDurable: write.observationRowsDurable,
      stateWritten: write.stateWritten,
      stateSkipped: write.stateSkipped,
      observationsCreated: write.observationsCreated,
      observationsSkipped: write.observationsSkipped,
      observationsNotRequired: write.observationsNotRequired,
      coverageEntitiesWritten: write.coverageEntitiesWritten,
      coverageEntitiesSkipped: write.coverageEntitiesSkipped,
    }),
    lark: Object.freeze({ contentWrites: 0, dailyWrites: 0, blocked: true }),
    reconciliation: Object.freeze({
      expectedEntities: sourceSummary.records,
      observedEntities,
      expectedRows: sourceSummary.records,
      observedRows: observedEntities,
      failedRows: input.coverageStatus === 'partial' && !input.continuationRequired
        ? preflight.issueRows
        : 0,
      skippedRows: preflight.skippedRows,
      duplicateRows: preflight.duplicateRows,
      status: input.coverageStatus,
    }),
    resumableWork: Object.freeze({
      generation: input.context.generation,
      complete: input.mode === 'd1_only' || input.mode === 'dry_run',
      bounded: true,
      maxSourceUnitsPerInvocation: 1,
      preflightComplete: preflight.rawRecords === sourceSummary.records,
    }),
  });
}

function normalizeInput(input) {
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const generation = requireTimestamp(input.generation ?? requestedAt, 'generation');
  if (generation !== requestedAt) {
    throw permanentError('TikTok history generation must equal original requestedAt', {
      code: 'TIKTOK_HISTORY_GENERATION_MISMATCH',
    });
  }
  const sourceTimezone = requireText(input.sourceTimezone ?? 'Asia/Bangkok', 'sourceTimezone');
  return Object.freeze({
    syncRunId: requireText(input.syncRunId, 'syncRunId'),
    accountKey: requireText(input.accountKey, 'accountKey'),
    sourceHandle: requireText(input.sourceHandle, 'sourceHandle'),
    customerProfile: requireText(input.customerProfile, 'customerProfile'),
    customerKey: requireText(input.customerKey, 'customerKey'),
    sourceTimezone,
    requestedAt,
    generation,
    workKey: requireText(input.workKey, 'workKey'),
    cursorKey: requireText(input.cursorKey, 'cursorKey'),
    rawTableId: requireText(input.rawTableId, 'rawTableId'),
    metricDate: dateOnlyInTimeZone(requestedAt, sourceTimezone),
    dryRun: input.dryRun === true,
    assertLockActive: typeof input.assertLockActive === 'function'
      ? input.assertLockActive
      : async () => undefined,
    onProgress: typeof input.onProgress === 'function' ? input.onProgress : () => undefined,
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

async function savePhase(context, phase, state, complete, summary) {
  await context.assertCurrent();
  const preflight = phase === TIKTOK_HISTORY_PREFLIGHT_PHASE;
  return context.store.savePhase({
    workKey: context.workKey,
    phase,
    state,
    expectedItems: summary.records,
    processedItems: preflight ? state.rawRecords : state.rawRecordsCompleted,
    pagesProcessed: preflight ? state.unitsPreflighted : state.unitsCompleted,
    chunksProcessed: preflight ? state.unitsPreflighted : state.unitsCompleted,
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
