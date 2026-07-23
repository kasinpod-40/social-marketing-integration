import {
  syncTikTokCreatorNativeToLark as syncTikTokCreatorNativeToLarkLegacy,
} from './sync-tiktok-creator-native-to-lark-legacy.js';
import {
  beginTikTokResumableSource,
  completeTikTokResumableSource,
  replayTikTokCompletedWork,
  stageTikTokResumableSource,
  supersededTikTokResult,
} from './tiktok-resumable-source.js';
import { syncTikTokStagedBusinessToLark } from './sync-tiktok-staged-business-to-lark.js';
import {
  isPartialSyncError,
  partialSyncError,
} from '../../../shared/src/errors/runtime-error.js';

const BUSINESS_WRITE_PHASE = 'tiktok_native_business_write_v1';

/**
 * Entry point กลางของ TikTok Creator sync
 * - Local/legacy callers ที่ไม่มี Durable work store ใช้ Flow เดิมเพื่อรักษา Compatibility
 * - Queue production path ที่มี Durable work storeต้อง Stage และประมวลผล Business ทีละ Unit เท่านั้น
 */
export async function syncTikTokCreatorNativeToLark(input = {}) {
  if (!input.resumableWorkStore) {
    return syncTikTokCreatorNativeToLarkLegacy(input);
  }

  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;
  const context = await beginTikTokResumableSource({
    workStore: input.resumableWorkStore,
    workKey: input.workKey,
    cursorKey: input.cursorKey,
    requestedAt: input.requestedAt,
    generation: input.generation,
    accountId: input.accountId,
    sourceHandle: input.sourceHandle,
    metricDate: input.metricDate,
    syncMode: input.syncMode,
    incrementalEnabled: input.incrementalEnabled,
    dryRun: input.dryRun,
    rawTableId: input.tables?.rawTikTokCreatorVideos,
    assertLockActive,
  });

  if (context.work.superseded) {
    return supersededTikTokResult(syncRunId, context.generation);
  }
  if (context.work.completed) {
    return replayTikTokCompletedWork(context, syncRunId);
  }

  const sourceLoad = await stageTikTokResumableSource({
    context,
    repository: input.repository,
    tableId: input.tables?.rawTikTokCreatorVideos,
    pageSize: input.sourcePageSize,
    maxPages: input.sourceMaxPages,
    onProgress: input.onProgress,
  });
  const writeStateBefore = await loadBusinessWriteState(context);

  let stagedResult;
  try {
    stagedResult = await syncTikTokStagedBusinessToLark({
      ...input,
      context,
      syncRunId,
      sourceSummary: sourceLoad.summary,
    });
  } catch (error) {
    if (!isPartialSyncError(error)) throw error;
    throw normalizeAttemptPartialError(error, writeStateBefore);
  }

  const durableReplay = stagedResult?.stagedBusiness?.completionPhaseReplay === true
    || writeStateBefore?.resultDraft;
  const writeStateAfter = durableReplay || stagedResult?.mode === 'dry_run'
    ? null
    : await loadBusinessWriteState(context);
  const result = durableReplay
    ? normalizeDurableReplayResult(stagedResult)
    : normalizeAttemptWriteResult(stagedResult, writeStateBefore, writeStateAfter);
  const completedResult = attachResumableSummary(result, context, sourceLoad.summary);
  await completeTikTokResumableSource(context, completedResult);
  return completedResult;
}

/**
 * Sync Log เป็นราย Attempt จึงต้องหักยอด Durable units ที่สำเร็จใน Attempt ก่อนหน้า
 * ยอดสะสมทั้ง Work ยังเก็บไว้ใน stagedBusiness.workTotals สำหรับ Reconciliation/Audit
 */
function normalizeAttemptWriteResult(result, beforeState, afterState) {
  if (result?.mode === 'dry_run' || !afterState) return result;
  const sourceSkips = readSourceSkips(result);
  const content = addSkipped(
    subtractTableResult(afterState.contentResult, beforeState?.contentResult),
    sourceSkips,
  );
  const dailySnapshots = addSkipped(
    subtractTableResult(afterState.dailyResult, beforeState?.dailyResult),
    sourceSkips,
  );
  const d1History = subtractHistoryResult(afterState.historyResult, beforeState?.historyResult);

  return Object.freeze({
    ...result,
    content,
    dailySnapshots,
    d1History,
    stagedBusiness: Object.freeze({
      ...(result.stagedBusiness ?? {}),
      attemptUnitsCompleted: subtractCount(
        afterState.unitsCompleted,
        beforeState?.unitsCompleted,
      ),
      attemptSelectedRecordsCompleted: subtractCount(
        afterState.selectedRecordsCompleted,
        beforeState?.selectedRecordsCompleted,
      ),
      workTotals: Object.freeze({
        content: addSkipped(normalizeTableResult(afterState.contentResult), sourceSkips),
        dailySnapshots: addSkipped(normalizeTableResult(afterState.dailyResult), sourceSkips),
        d1History: normalizeHistoryResult(afterState.historyResult),
        unitsCompleted: nonNegativeInteger(afterState.unitsCompleted ?? 0),
        selectedRecordsCompleted: nonNegativeInteger(
          afterState.selectedRecordsCompleted ?? 0,
        ),
      }),
    }),
  });
}

/** Partial result ต้องรายงานเฉพาะ Write ของ Attempt ปัจจุบันเช่นเดียวกับ Success result */
function normalizeAttemptPartialError(error, beforeState) {
  const result = error.partialResult;
  const sourceSkips = readSourceSkips(result);
  const contentCumulative = removeSkipped(normalizeTableResult(result?.content), sourceSkips);
  const dailyCumulative = removeSkipped(
    normalizeTableResult(result?.dailySnapshots),
    sourceSkips,
  );
  const historyCumulative = normalizeHistoryResult(result?.d1History);
  const normalizedResult = Object.freeze({
    ...result,
    content: addSkipped(
      subtractTableResult(contentCumulative, beforeState?.contentResult),
      sourceSkips,
    ),
    dailySnapshots: addSkipped(
      subtractTableResult(dailyCumulative, beforeState?.dailyResult),
      sourceSkips,
    ),
    d1History: subtractHistoryResult(historyCumulative, beforeState?.historyResult),
    stagedBusiness: Object.freeze({
      ...(result?.stagedBusiness ?? {}),
      workTotals: Object.freeze({
        content: addSkipped(contentCumulative, sourceSkips),
        dailySnapshots: addSkipped(dailyCumulative, sourceSkips),
        d1History: historyCumulative,
      }),
    }),
  });

  return partialSyncError(error.message, {
    code: error.code,
    retryable: error.retryable !== false,
    cause: error.cause ?? error,
    partialResult: normalizedResult,
    details: error.details ?? {},
  });
}

/**
 * Retry หลัง Business/Checkpoint สำเร็จแต่ Phase หรือ completeWork ล้ม ต้องไม่ลง Write ซ้ำ
 * Attempt ปัจจุบันจึงมี Write count เป็นศูนย์ ส่วนยอดเดิมคงอยู่ใน workTotals
 */
function normalizeDurableReplayResult(result) {
  const sourceRecords = nonNegativeInteger(
    result?.rawRecords ?? result?.incremental?.sourceRecords ?? 0,
  );
  const sourceSkips = result?.incremental ? sourceRecords : 0;
  const emptyResult = Object.freeze({
    created: 0,
    updated: 0,
    skipped: sourceSkips,
    duplicateInputRows: 0,
  });
  const historyTotals = normalizeHistoryResult(result?.d1History);
  const normalizedIncremental = result?.incremental
    ? Object.freeze({
      ...result.incremental,
      mode: 'incremental',
      reason: 'no_source_changes',
      selectedRecords: 0,
      changedRecords: 0,
      unchangedRecords: sourceRecords,
      removedRecords: 0,
      dictionaryChanged: false,
      metricDateChanged: false,
      fullSnapshot: false,
      checkpointSaved: true,
    })
    : null;

  return Object.freeze({
    ...result,
    processedRawRecords: 0,
    incremental: normalizedIncremental,
    content: emptyResult,
    dailySnapshots: emptyResult,
    d1History: emptyHistoryResult(historyTotals.enabled),
    stagedBusiness: Object.freeze({
      ...(result?.stagedBusiness ?? {}),
      durableReplay: true,
      workTotals: Object.freeze({
        content: normalizeTableResult(result?.content),
        dailySnapshots: normalizeTableResult(result?.dailySnapshots),
        d1History: historyTotals,
        unitsCompleted: nonNegativeInteger(result?.stagedBusiness?.unitsCompleted ?? 0),
        selectedRecordsCompleted: nonNegativeInteger(
          result?.stagedBusiness?.selectedRecordsCompleted ?? 0,
        ),
      }),
    }),
  });
}

async function loadBusinessWriteState(context) {
  await context.assertCurrent();
  const phase = await context.store.loadPhase({
    workKey: context.workKey,
    phase: BUSINESS_WRITE_PHASE,
  });
  return phase?.state && typeof phase.state === 'object' ? phase.state : null;
}

function subtractTableResult(after, before) {
  const final = normalizeTableResult(after);
  const initial = normalizeTableResult(before);
  return Object.freeze({
    created: subtractCount(final.created, initial.created),
    updated: subtractCount(final.updated, initial.updated),
    skipped: subtractCount(final.skipped, initial.skipped),
    duplicateInputRows: subtractCount(
      final.duplicateInputRows,
      initial.duplicateInputRows,
    ),
  });
}

function normalizeTableResult(value) {
  return Object.freeze({
    created: nonNegativeInteger(value?.created ?? 0),
    updated: nonNegativeInteger(value?.updated ?? 0),
    skipped: nonNegativeInteger(value?.skipped ?? 0),
    duplicateInputRows: nonNegativeInteger(value?.duplicateInputRows ?? 0),
  });
}

function subtractHistoryResult(after, before) {
  const final = normalizeHistoryResult(after);
  const initial = normalizeHistoryResult(before);
  return Object.freeze({
    enabled: final.enabled || initial.enabled,
    contentRows: subtractCount(final.contentRows, initial.contentRows),
    contentRowsDurable: subtractCount(final.contentRowsDurable, initial.contentRowsDurable),
    observationRowsDurable: subtractCount(
      final.observationRowsDurable,
      initial.observationRowsDurable,
    ),
    stateWritten: subtractCount(final.stateWritten, initial.stateWritten),
    stateSkipped: subtractCount(final.stateSkipped, initial.stateSkipped),
    observationsCreated: subtractCount(
      final.observationsCreated,
      initial.observationsCreated,
    ),
    observationsSkipped: subtractCount(
      final.observationsSkipped,
      initial.observationsSkipped,
    ),
    observationsNotRequired: subtractCount(
      final.observationsNotRequired,
      initial.observationsNotRequired,
    ),
    coverageEntitiesWritten: subtractCount(
      final.coverageEntitiesWritten,
      initial.coverageEntitiesWritten,
    ),
    coverageEntitiesSkipped: subtractCount(
      final.coverageEntitiesSkipped,
      initial.coverageEntitiesSkipped,
    ),
  });
}

function normalizeHistoryResult(value) {
  return Object.freeze({
    enabled: value?.enabled === true
      || nonNegativeInteger(value?.contentRows ?? 0) > 0
      || nonNegativeInteger(value?.contentRowsDurable ?? 0) > 0,
    contentRows: nonNegativeInteger(value?.contentRows ?? 0),
    contentRowsDurable: nonNegativeInteger(value?.contentRowsDurable ?? 0),
    observationRowsDurable: nonNegativeInteger(value?.observationRowsDurable ?? 0),
    stateWritten: nonNegativeInteger(value?.stateWritten ?? 0),
    stateSkipped: nonNegativeInteger(value?.stateSkipped ?? 0),
    observationsCreated: nonNegativeInteger(value?.observationsCreated ?? 0),
    observationsSkipped: nonNegativeInteger(value?.observationsSkipped ?? 0),
    observationsNotRequired: nonNegativeInteger(value?.observationsNotRequired ?? 0),
    coverageEntitiesWritten: nonNegativeInteger(value?.coverageEntitiesWritten ?? 0),
    coverageEntitiesSkipped: nonNegativeInteger(value?.coverageEntitiesSkipped ?? 0),
  });
}

function emptyHistoryResult(enabled) {
  return Object.freeze({
    enabled: enabled === true,
    contentRows: 0,
    contentRowsDurable: 0,
    observationRowsDurable: 0,
    stateWritten: 0,
    stateSkipped: 0,
    observationsCreated: 0,
    observationsSkipped: 0,
    observationsNotRequired: 0,
    coverageEntitiesWritten: 0,
    coverageEntitiesSkipped: 0,
  });
}

function addSkipped(result, sourceSkips) {
  return Object.freeze({
    ...result,
    skipped: nonNegativeInteger(result.skipped) + nonNegativeInteger(sourceSkips),
  });
}

function removeSkipped(result, sourceSkips) {
  return Object.freeze({
    ...result,
    skipped: subtractCount(result.skipped, sourceSkips),
  });
}

function readSourceSkips(result) {
  return result?.incremental?.mode === 'incremental'
    ? nonNegativeInteger(result.incremental.unchangedRecords ?? 0)
    : 0;
}

function subtractCount(after, before) {
  const difference = nonNegativeInteger(after ?? 0) - nonNegativeInteger(before ?? 0);
  if (difference < 0) {
    throw new TypeError('TikTok durable write counters moved backwards');
  }
  return difference;
}

function attachResumableSummary(result, context, sourcePagination) {
  return Object.freeze({
    ...result,
    sourcePagination,
    resumableWork: Object.freeze({
      resumed: context.work?.resumed === true,
      complete: true,
      cleared: true,
      generation: context.generation,
      completionPhaseReplay: result?.stagedBusiness?.completionPhaseReplay === true,
      durableReplay: result?.stagedBusiness?.durableReplay === true,
    }),
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok sync requires ${fieldName}`);
  }
  return value.trim();
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError('TikTok sync requires a non-negative safe integer');
  }
  return number;
}
