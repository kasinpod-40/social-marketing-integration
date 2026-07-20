import {
  assertTikTokSyncReady,
  prepareTikTokCreatorLarkSync,
} from './prepare-tiktok-creator-lark-sync.js';
import {
  isPartialSyncError,
  partialSyncError,
} from '../../../shared/src/errors/runtime-error.js';
import { analyzeClassificationDictionaryRecords } from '../services/classification-dictionary.js';
import {
  buildTikTokIncrementalCheckpoint,
  planTikTokIncrementalSource,
} from './plan-tiktok-incremental-source.js';
import {
  beginTikTokResumableSource,
  completeTikTokResumableSource,
  loadTikTokResumableSource,
  replayTikTokCompletedWork,
  supersededTikTokResult,
} from './tiktok-resumable-source.js';

/**
 * Sync RAW TikTok Creator ไปยัง MKT_Content และ MKT_Content_Daily
 */
export async function syncTikTokCreatorNativeToLark(input) {
  const progress = typeof input?.onProgress === 'function' ? input.onProgress : () => undefined;
  const baseAssertLockActive = typeof input?.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;
  const syncRunId = optionalText(input?.syncRunId);
  const resumable = await beginTikTokResumableSource({
    workStore: input?.resumableWorkStore,
    workKey: input?.workKey,
    cursorKey: input?.cursorKey,
    requestedAt: input?.requestedAt,
    generation: input?.generation,
    accountId: input?.accountId,
    sourceHandle: input?.sourceHandle,
    metricDate: input?.metricDate,
    syncMode: input?.syncMode,
    incrementalEnabled: input?.incrementalEnabled,
    dryRun: input?.dryRun,
    rawTableId: input?.tables?.rawTikTokCreatorVideos,
    assertLockActive: baseAssertLockActive,
  });
  if (resumable?.work?.superseded) {
    return supersededTikTokResult(syncRunId, resumable.generation);
  }
  if (resumable?.work?.completed) {
    return replayTikTokCompletedWork(resumable, syncRunId);
  }
  const assertWorkActive = resumable?.assertCurrent ?? baseAssertLockActive;
  const sourceLoad = resumable
    ? await loadTikTokResumableSource({
      context: resumable,
      repository: input?.repository,
      tableId: input?.tables?.rawTikTokCreatorVideos,
      pageSize: input?.sourcePageSize,
      maxPages: input?.sourceMaxPages,
      onProgress: progress,
    })
    : null;
  const incrementalContext = await loadIncrementalContext(input, progress, sourceLoad?.records);
  const prepared = await prepareTikTokCreatorLarkSync({
    repository: input?.repository,
    syncEngine: input?.syncEngine,
    tables: input?.tables,
    accountId: input?.accountId,
    sourceHandle: input?.sourceHandle,
    metricDate: input?.metricDate,
    rawRecords: incrementalContext?.rawRecords ?? sourceLoad?.records,
    dictionaryAnalysis: incrementalContext?.dictionaryAnalysis,
    selectedExternalContentIds: incrementalContext?.plan.selectedExternalContentIds,
    incrementalPlan: incrementalContext?.plan ?? null,
    onProgress: progress,
  });

  if (input?.dryRun === true) {
    const result = attachResumableSummary(Object.freeze({
      syncRunId,
      platform: prepared.platform,
      source: prepared.source,
      mode: 'dry_run',
      readyToWrite: prepared.readyToWrite,
      rawRecords: prepared.rawRecords,
      processedRawRecords: prepared.processedRawRecords,
      incremental: summarizeIncremental(prepared.incremental, false),
      classificationRules: prepared.classificationRules,
      classificationDictionary: prepared.classificationDictionary,
      content: planSummary(prepared.plans.content, prepared.incremental),
      dailySnapshots: planSummary(prepared.plans.dailySnapshots, prepared.incremental),
      reconciliation: prepared.reconciliation,
      skippedRows: prepared.normalized.skippedRows,
      sourceIdentity: prepared.sourceIdentity,
      accountConflicts: prepared.accountConflicts,
      issues: prepared.issues,
      warnings: prepared.warnings,
    }), resumable, sourceLoad, true);
    await completeTikTokResumableSource(resumable, result);
    return result;
  }

  assertTikTokSyncReady(prepared);
  await assertWorkActive();

  progress({
    stage: 'executing_content_plan',
    syncRunId,
    createRows: prepared.plans.content.createRows.length,
    updateRows: prepared.plans.content.updateRows.length,
  });

  let contentResult;
  try {
    contentResult = await input.syncEngine.executePlan(prepared.plans.content, {
      beforeWriteChunk: assertWorkActive,
      onProgress: (event) => progress({ scope: 'content', syncRunId, ...event }),
    });
  } catch (cause) {
    if (!isPartialSyncError(cause)) throw cause;
    throw buildWholeSyncPartialError({
      cause,
      syncRunId,
      prepared,
      failedPhase: 'content',
      contentResult: normalizeTablePartialResult(cause.partialResult, prepared.plans.content),
      dailyResult: plannedOnlyResult(prepared.plans.dailySnapshots),
    });
  }
  progress({ stage: 'content_synced', syncRunId, result: contentResult });

  await assertWorkActive();
  progress({
    stage: 'executing_daily_snapshot_plan',
    syncRunId,
    createRows: prepared.plans.dailySnapshots.createRows.length,
    updateRows: prepared.plans.dailySnapshots.updateRows.length,
  });

  let dailyResult;
  try {
    dailyResult = await input.syncEngine.executePlan(prepared.plans.dailySnapshots, {
      beforeWriteChunk: assertWorkActive,
      onProgress: (event) => progress({ scope: 'daily_snapshots', syncRunId, ...event }),
    });
  } catch (cause) {
    const normalizedDaily = isPartialSyncError(cause)
      ? normalizeTablePartialResult(cause.partialResult, prepared.plans.dailySnapshots)
      : unknownWriteResult(prepared.plans.dailySnapshots);

    throw buildWholeSyncPartialError({
      cause,
      syncRunId,
      prepared,
      failedPhase: 'daily_snapshots',
      contentResult,
      dailyResult: normalizedDaily,
    });
  }

  progress({ stage: 'daily_snapshots_synced', syncRunId, result: dailyResult });
  await assertWorkActive();

  let result = buildResult({
    syncRunId,
    prepared,
    contentResult,
    dailyResult,
    reconciliationStatus: prepared.reconciliation.required ? 'recovered' : 'not_required',
    checkpointSaved: false,
  });

  if (incrementalContext) {
    await assertWorkActive();
    const completedAt = incrementalContext.now();
    const checkpoint = buildTikTokIncrementalCheckpoint({
      plan: incrementalContext.plan,
      cursorKey: incrementalContext.cursorKey,
      syncRunId,
      customerProfile: incrementalContext.customerProfile,
      accountKey: input?.accountId,
      metricDate: input?.metricDate,
      completedAt,
    });
    await incrementalContext.stateStore.saveCheckpoint(checkpoint);
    await assertWorkActive();
    result = Object.freeze({
      ...result,
      incremental: summarizeIncremental(incrementalContext.plan, true),
    });
  }

  const completedResult = attachResumableSummary(result, resumable, sourceLoad, true);
  await completeTikTokResumableSource(resumable, completedResult);
  return completedResult;
}

function buildWholeSyncPartialError(input) {
  const partialResult = buildResult({
    syncRunId: input.syncRunId,
    prepared: input.prepared,
    contentResult: input.contentResult,
    dailyResult: input.dailyResult,
    reconciliationStatus: 'partial_write_detected',
  });

  return partialSyncError(`TikTok sync partially completed during ${input.failedPhase}`, {
    retryable: input.cause?.retryable !== false,
    cause: input.cause,
    partialResult,
    details: {
      syncRunId: input.syncRunId,
      failedPhase: input.failedPhase,
      contentCreated: input.contentResult?.created ?? 0,
      contentUpdated: input.contentResult?.updated ?? 0,
      dailyCreated: input.dailyResult?.created ?? 0,
      dailyUpdated: input.dailyResult?.updated ?? 0,
      contentWriteOutcome: input.contentResult?.writeOutcome ?? null,
      dailyWriteOutcome: input.dailyResult?.writeOutcome ?? null,
      causeCode: input.cause?.code ?? null,
      causeMessage: input.cause instanceof Error ? input.cause.message : String(input.cause),
    },
  });
}

function normalizeTablePartialResult(result, plan) {
  return Object.freeze({
    created: nonNegative(result?.created),
    updated: nonNegative(result?.updated),
    skipped: nonNegative(result?.skipped ?? plan.skipped),
    duplicateInputRows: nonNegative(result?.duplicateInputRows ?? plan.duplicateInputRows),
    writeOutcome: result?.writeOutcome ?? 'partial',
    failedPhase: result?.failedPhase ?? null,
    plannedCreate: nonNegative(result?.plannedCreate ?? plan.createRows.length),
    plannedUpdate: nonNegative(result?.plannedUpdate ?? plan.updateRows.length),
    writeProgress: result?.writeProgress ?? null,
  });
}

function plannedOnlyResult(plan) {
  return Object.freeze({
    created: 0,
    updated: 0,
    skipped: plan.skipped,
    duplicateInputRows: plan.duplicateInputRows,
    writeOutcome: 'not_started',
    plannedCreate: plan.createRows.length,
    plannedUpdate: plan.updateRows.length,
  });
}

function unknownWriteResult(plan) {
  return Object.freeze({
    created: 0,
    updated: 0,
    skipped: plan.skipped,
    duplicateInputRows: plan.duplicateInputRows,
    writeOutcome: 'unknown',
    plannedCreate: plan.createRows.length,
    plannedUpdate: plan.updateRows.length,
  });
}

function buildResult(input) {
  return Object.freeze({
    syncRunId: input.syncRunId,
    platform: input.prepared.platform,
    source: input.prepared.source,
    mode: 'write',
    rawRecords: input.prepared.rawRecords,
    processedRawRecords: input.prepared.processedRawRecords,
    incremental: summarizeIncremental(input.prepared.incremental, input.checkpointSaved === true),
    content: withIncrementalSkips(input.contentResult, input.prepared.incremental),
    dailySnapshots: withIncrementalSkips(input.dailyResult, input.prepared.incremental),
    reconciliation: Object.freeze({
      ...input.prepared.reconciliation,
      status: input.reconciliationStatus,
      recovered: input.reconciliationStatus === 'recovered',
    }),
    classificationRules: input.prepared.classificationRules,
    classificationDictionary: input.prepared.classificationDictionary,
    skippedRows: input.prepared.normalized.skippedRows,
    sourceIdentity: input.prepared.sourceIdentity,
    accountConflicts: input.prepared.accountConflicts,
    warnings: input.prepared.warnings,
  });
}

function planSummary(plan, incremental) {
  return Object.freeze({
    rowsReady: plan.inputRows,
    createRows: plan.createRows.length,
    updateRows: plan.updateRows.length,
    skipped: plan.skipped + readIncrementalSourceSkips(incremental),
    duplicateInputRows: plan.duplicateInputRows,
    existingRecordsRead: plan.existingRecordsRead,
    existingReadStrategy: plan.existingReadStrategy,
  });
}

async function loadIncrementalContext(input, progress, rawRecordsOverride = null) {
  if (input?.incrementalEnabled !== true) return null;
  const stateStore = requireIncrementalStateStore(input?.incrementalStateStore);
  const cursorKey = requireText(input?.cursorKey, 'cursorKey');
  const customerProfile = requireText(input?.customerProfile, 'customerProfile');
  const tables = input?.tables ?? {};
  const repository = input?.repository;
  const now = typeof input?.now === 'function' ? input.now : () => Date.now();

  progress({ stage: 'loading_incremental_checkpoint', cursorKey });
  const [rawRecords, dictionaryRecords, checkpoint] = await Promise.all([
    rawRecordsOverride === null
      ? repository.listAll(requireText(tables.rawTikTokCreatorVideos, 'tables.rawTikTokCreatorVideos'))
      : Promise.resolve(requireArray(rawRecordsOverride, 'rawRecordsOverride')),
    repository.listAll(requireText(
      tables.mktClassificationDictionary,
      'tables.mktClassificationDictionary',
    )),
    stateStore.loadCheckpoint(cursorKey),
  ]);
  const dictionaryAnalysis = analyzeClassificationDictionaryRecords(dictionaryRecords);
  const plan = await planTikTokIncrementalSource({
    rawRecords,
    dictionaryRecords,
    checkpoint,
    metricDate: input?.metricDate,
    syncMode: input?.syncMode,
    now: now(),
    fullSyncIntervalMs: input?.fullSyncIntervalMs,
  });
  progress({
    stage: 'incremental_plan_ready',
    mode: plan.mode,
    reason: plan.reason,
    sourceRecords: plan.sourceRecords,
    selectedRecords: plan.selectedRecords,
    changedRecords: plan.changedRecords,
  });

  return Object.freeze({
    stateStore,
    cursorKey,
    customerProfile,
    now,
    rawRecords,
    dictionaryAnalysis,
    plan,
  });
}

function withIncrementalSkips(result, incremental) {
  return Object.freeze({
    ...result,
    skipped: nonNegative(result?.skipped) + readIncrementalSourceSkips(incremental),
  });
}

function readIncrementalSourceSkips(incremental) {
  return incremental?.enabled === true ? nonNegative(incremental.sourceSkippedPerTable) : 0;
}

function summarizeIncremental(value, checkpointSaved) {
  if (!value || value.enabled !== true) return null;
  return Object.freeze({
    enabled: true,
    mode: value.mode,
    reason: value.reason,
    requestedMode: value.requestedMode,
    sourceRecords: value.sourceRecords,
    selectedRecords: value.selectedRecords,
    changedRecords: value.changedRecords,
    unchangedRecords: value.unchangedRecords,
    removedRecords: value.removedRecords,
    dictionaryChanged: value.dictionaryChanged,
    metricDateChanged: value.metricDateChanged,
    fullSnapshot: value.fullSnapshot,
    checkpointSaved: checkpointSaved === true,
  });
}

function attachResumableSummary(result, context, sourceLoad, complete) {
  if (!context) return result;
  return Object.freeze({
    ...result,
    sourcePagination: sourceLoad?.summary ?? null,
    resumableWork: Object.freeze({
      resumed: context.work?.resumed === true,
      complete: complete === true,
      cleared: complete === true,
      generation: context.generation,
    }),
  });
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`TikTok sync requires ${fieldName}`);
  return value;
}

function requireIncrementalStateStore(value) {
  if (typeof value?.loadCheckpoint !== 'function' || typeof value?.saveCheckpoint !== 'function') {
    throw new TypeError('TikTok incremental sync requires incrementalStateStore');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok sync requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('syncRunId must be a non-empty string');
  }
  return value.trim();
}

function nonNegative(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
