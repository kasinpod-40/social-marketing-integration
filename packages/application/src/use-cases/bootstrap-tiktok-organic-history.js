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

const PREFLIGHT_PHASE = 'tiktok_organic_history_preflight_v1';
const WRITE_PHASE = 'tiktok_organic_history_write_v1';
const DATASET_KEY = 'organic_content_cumulative';

/**
 * Manual-only TikTok Native bootstrap: durable Source staging → D1 Organic history.
 * ฟังก์ชันนี้ไม่เขียน MKT_Content/MKT_Content_Daily และไม่เปิด Schedule.
 */
export async function bootstrapTikTokOrganicHistory(input = {}) {
  const gateway = requireGateway(input.gateway);
  await gateway.assertSchemaReady();

  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const sourceHandle = requireText(input.sourceHandle, 'sourceHandle');
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const customerKey = requireText(input.customerKey, 'customerKey');
  const sourceTimezone = requireText(input.sourceTimezone ?? 'Asia/Bangkok', 'sourceTimezone');
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
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
    generation: requestedAt,
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
  const historySyncRunId = `history:tiktok:${coverageDigest}`;
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
    historySyncRunId,
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
    });
    await completeTikTokResumableSource(context, result);
    return result;
  }

  await writer.beginCoverage({
    expectedEntities: preflight.rawRecords,
    expectedRows: preflight.rawRecords,
    sourceWatermark,
  });

  let write = await loadWriteState(context);
  try {
    write = await writeAllUnits({
      context,
      writer,
      accountKey,
      sourceHandle,
      sourceTimezone,
      metricDate,
      sourceSummary: sourceLoad.summary,
      existingState: write,
      onProgress,
    });

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
    });
    await completeTikTokResumableSource(context, result);
    return result;
  } catch (error) {
    await writer.failCoverage({
      expectedEntities: preflight.rawRecords,
      observedEntities: write.validContentRows,
      expectedRows: preflight.rawRecords,
      observedRows: write.validContentRows,
      writtenRows: write.contentRowsDurable + write.observationRowsDurable,
      failedRows: Math.max(1, preflight.issueRows),
      sourceWatermark,
      errorCode: error?.code ?? 'TIKTOK_HISTORY_BOOTSTRAP_FAILED',
      completedAt: Date.now(),
    });
    throw error;
  }
}

async function preflightAllUnits(input) {
  const existing = await input.context.store.loadPhase({
    workKey: input.context.workKey,
    phase: PREFLIGHT_PHASE,
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
    await savePhase(input.context, PREFLIGHT_PHASE, state, false, input.sourceSummary);
    input.onProgress(Object.freeze({
      stage: 'tiktok_history_unit_preflighted',
      sequence: unit.sequence,
      rawRecords: unit.records.length,
      validContentRows: plan.contentRows,
      issueRows: skippedRows + duplicateRows,
    }));
  }

  assertCompleteness(state.rawRecords, input.sourceSummary.records, 'preflight');
  await savePhase(input.context, PREFLIGHT_PHASE, state, true, input.sourceSummary);
  return state;
}

async function writeAllUnits(input) {
  if (input.existingState.complete) return input.existingState;
  let state = input.existingState;
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
    await input.context.assertCurrent();
    const result = await input.writer.writeBatch(selected);

    state = Object.freeze({
      ...state,
      nextSequence: unit.sequence + 1,
      unitsCompleted: state.unitsCompleted + 1,
      rawRecordsCompleted: state.rawRecordsCompleted + unit.records.length,
      validContentRows: state.validContentRows + result.contentRows,
      contentRowsDurable: state.contentRowsDurable + result.contentRows,
      observationRowsDurable: state.observationRowsDurable
        + result.observationsCreated + result.observationsSkipped,
      stateWritten: state.stateWritten + result.stateWritten,
      stateSkipped: state.stateSkipped + result.stateSkipped,
      observationsCreated: state.observationsCreated + result.observationsCreated,
      observationsSkipped: state.observationsSkipped + result.observationsSkipped,
      observationsNotRequired: state.observationsNotRequired + result.observationsNotRequired,
      coverageEntitiesWritten: state.coverageEntitiesWritten + result.coverageEntitiesWritten,
      coverageEntitiesSkipped: state.coverageEntitiesSkipped + result.coverageEntitiesSkipped,
      seenContentKeys: Object.freeze([...seen].sort()),
      complete: false,
    });
    await savePhase(input.context, WRITE_PHASE, state, false, input.sourceSummary);
    input.onProgress(Object.freeze({
      stage: 'tiktok_history_unit_written',
      sequence: unit.sequence,
      d1ContentRows: result.contentRows,
      observationsCreated: result.observationsCreated,
      observationsSkipped: result.observationsSkipped,
    }));
  }

  assertCompleteness(state.rawRecordsCompleted, input.sourceSummary.records, 'write');
  state = Object.freeze({ ...state, complete: true });
  await savePhase(input.context, WRITE_PHASE, state, true, input.sourceSummary);
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
      expectedRows: input.preflight.rawRecords,
      observedRows: input.write.validContentRows,
      skippedRows: input.preflight.skippedRows,
      duplicateRows: input.preflight.duplicateRows,
      status: input.coverageStatus,
    }),
    resumableWork: Object.freeze({
      generation: input.context.generation,
      complete: input.mode !== 'dry_run',
      bounded: true,
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
  const phase = await context.store.loadPhase({ workKey: context.workKey, phase: WRITE_PHASE });
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
    ...{
      contentRowsDurable: 0,
      observationRowsDurable: 0,
      stateWritten: 0,
      stateSkipped: 0,
      observationsCreated: 0,
      observationsSkipped: 0,
      observationsNotRequired: 0,
      coverageEntitiesWritten: 0,
      coverageEntitiesSkipped: 0,
      validContentRows: 0,
    },
  });
}

async function savePhase(context, phase, state, complete, sourceSummary) {
  await context.assertCurrent();
  return context.store.savePhase({
    workKey: context.workKey,
    phase,
    state,
    expectedItems: sourceSummary.records,
    processedItems: phase === PREFLIGHT_PHASE ? state.rawRecords : state.rawRecordsCompleted,
    pagesProcessed: phase === PREFLIGHT_PHASE ? state.unitsPreflighted : state.unitsCompleted,
    chunksProcessed: phase === PREFLIGHT_PHASE ? state.unitsPreflighted : state.unitsCompleted,
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
