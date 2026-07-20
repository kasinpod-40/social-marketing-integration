import { analyzeClassificationDictionaryRecords } from '../services/classification-dictionary.js';
import { mapTikTokCreatorVideoRow } from '../../../connectors/src/tiktok/creator-native.adapter.js';
import {
  assertTikTokSyncReady,
  prepareTikTokCreatorLarkSync,
} from './prepare-tiktok-creator-lark-sync.js';
import {
  buildTikTokIncrementalCheckpoint,
  planTikTokIncrementalSourceIterable,
} from './plan-tiktok-incremental-source.js';
import { iterateTikTokStagedSourceUnits } from './tiktok-resumable-unit-reader.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import {
  isPartialSyncError,
  partialSyncError,
  permanentError,
} from '../../../shared/src/errors/runtime-error.js';

const PREFLIGHT_PHASE = 'tiktok_native_business_preflight_v1';
const WRITE_PHASE = 'tiktok_native_business_write_v1';
const COMPLETION_PHASE = 'tiktok_native_business_completion_v1';
const DEFAULT_FULL_SYNC_INTERVAL_MS = 86_400_000;

/**
 * ประมวลผล TikTok business rows จาก Durable source units แบบสอง Pass:
 * 1) Validate/Preflight ทุก Unit ก่อน Write แรก
 * 2) Plan/Write ทีละ Unit และ Persist completion หลัง Content + Daily สำเร็จทั้งคู่
 */
export async function syncTikTokStagedBusinessToLark(input = {}) {
  const context = requireContext(input.context);
  const repository = requireRepository(input.repository);
  const syncEngine = requireSyncEngine(input.syncEngine);
  const tables = requireTables(input.tables);
  const sourceSummary = requireSourceSummary(input.sourceSummary);
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const accountId = requireText(input.accountId, 'accountId');
  const sourceHandle = requireText(input.sourceHandle, 'sourceHandle');
  const metricDate = requireText(input.metricDate, 'metricDate');
  const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const incrementalEnabled = input.incrementalEnabled === true;
  const stateStore = incrementalEnabled
    ? requireIncrementalStateStore(input.incrementalStateStore)
    : null;
  const cursorKey = incrementalEnabled ? requireText(input.cursorKey, 'cursorKey') : null;
  const customerProfile = incrementalEnabled
    ? requireText(input.customerProfile, 'customerProfile')
    : null;

  const completedPhase = await loadPhase(context, COMPLETION_PHASE);
  if (completedPhase?.complete && isPlainObject(completedPhase.state?.result)) {
    return Object.freeze({
      ...completedPhase.state.result,
      syncRunId,
      stagedBusiness: Object.freeze({
        ...(completedPhase.state.result.stagedBusiness ?? {}),
        completionPhaseReplay: true,
      }),
    });
  }

  const existingWritePhase = await loadPhase(context, WRITE_PHASE);
  const checkpoint = incrementalEnabled
    ? await stateStore.loadCheckpoint(cursorKey)
    : { cursor: null, recordStates: [] };
  if (existingWritePhase?.complete
    && isPlainObject(existingWritePhase.state?.resultDraft)
    && checkpointAlreadySaved(existingWritePhase.state, checkpoint, incrementalEnabled)) {
    const completed = withCheckpointSaved(existingWritePhase.state.resultDraft, incrementalEnabled);
    await saveCompletionPhase({ context, sourceSummary, result: completed });
    return Object.freeze({ ...completed, syncRunId });
  }

  const dictionaryRecords = await repository.listAll(tables.mktClassificationDictionary);
  const dictionaryAnalysis = analyzeClassificationDictionaryRecords(dictionaryRecords);
  assertDictionaryReady(dictionaryAnalysis);

  const scannedPlan = await planTikTokIncrementalSourceIterable({
    rawRecords: iterateStagedRawRecords(context),
    dictionaryRecords,
    checkpoint,
    metricDate,
    syncMode: incrementalEnabled ? input.syncMode : 'full',
    now: context.requestedAt,
    fullSyncIntervalMs: input.fullSyncIntervalMs ?? DEFAULT_FULL_SYNC_INTERVAL_MS,
    expectedSourceHandle: sourceHandle,
  });
  const plan = incrementalEnabled ? scannedPlan : disableIncremental(scannedPlan);
  assertSourceCompleteness(plan, sourceSummary);
  const planFingerprint = await createBusinessPlanFingerprint(plan, metricDate);
  assertPhasePlanCompatible(existingWritePhase, planFingerprint);

  const selectedExternalIds = new Set(plan.selectedExternalContentIds);
  const preflight = await preflightAllUnits({
    context,
    repository,
    syncEngine,
    tables,
    accountId,
    sourceHandle,
    metricDate,
    dictionaryAnalysis,
    incrementalPlan: plan,
    selectedExternalIds,
    planFingerprint,
    sourceSummary,
    onProgress,
  });

  if (input.dryRun === true) {
    const result = buildDryRunResult({
      syncRunId,
      sourceSummary,
      plan,
      dictionaryAnalysis,
      preflight,
    });
    await saveCompletionPhase({ context, sourceSummary, result });
    return result;
  }

  let writeState = await writeAllUnits({
    context,
    repository,
    syncEngine,
    tables,
    accountId,
    sourceHandle,
    metricDate,
    dictionaryAnalysis,
    incrementalPlan: plan,
    selectedExternalIds,
    planFingerprint,
    sourceSummary,
    syncRunId,
    onProgress,
  });

  if (incrementalEnabled && !checkpointAlreadySaved(writeState, checkpoint, true)) {
    writeState = await recordCheckpointAttempt({
      context,
      sourceSummary,
      plan,
      writeState,
      syncRunId,
    });
    const completedAt = now();
    const checkpointWrite = buildTikTokIncrementalCheckpoint({
      plan,
      cursorKey,
      syncRunId,
      customerProfile,
      accountKey: accountId,
      metricDate,
      completedAt,
    });
    await context.assertCurrent();
    await stateStore.saveCheckpoint({
      ...checkpointWrite,
      generationGuard: {
        cursorKey,
        generation: context.generation,
        workKey: context.workKey,
        requestedAt: context.requestedAt,
      },
    });
    await context.assertCurrent();
    writeState = await markCheckpointSaved({
      context,
      sourceSummary,
      plan,
      writeState,
    });
  } else if (!incrementalEnabled && writeState.checkpointSaved !== true) {
    writeState = await markCheckpointSaved({
      context,
      sourceSummary,
      plan,
      writeState,
    });
  } else if (incrementalEnabled && writeState.checkpointSaved !== true) {
    writeState = await markCheckpointSaved({
      context,
      sourceSummary,
      plan,
      writeState,
    });
  }

  const result = withCheckpointSaved(writeState.resultDraft, incrementalEnabled);
  await saveCompletionPhase({ context, sourceSummary, result });
  return Object.freeze({ ...result, syncRunId });
}

async function preflightAllUnits(input) {
  let phase = await loadPhase(input.context, PREFLIGHT_PHASE);
  assertPhasePlanCompatible(phase, input.planFingerprint);
  if (phase?.complete) return normalizePreflightState(phase.state);

  let state = normalizePreflightState(phase?.state, input.planFingerprint);
  for await (const unit of iterateTikTokStagedSourceUnits({
    context: input.context,
    afterSequence: state.nextSequence,
  })) {
    const selectedIds = selectUnitExternalContentIds(unit.records, input.selectedExternalIds);
    const prepared = await prepareUnit({ ...input, unit, selectedIds });
    assertTikTokSyncReady(prepared);

    state = Object.freeze({
      ...state,
      nextSequence: unit.sequence + 1,
      unitsPreflighted: state.unitsPreflighted + 1,
      recordsPreflighted: state.recordsPreflighted + unit.records.length,
      selectedRowsPreflighted: state.selectedRowsPreflighted + prepared.plans.content.inputRows,
      contentPlan: mergePlanSummary(state.contentPlan, prepared.plans.content),
      dailyPlan: mergePlanSummary(state.dailyPlan, prepared.plans.dailySnapshots),
      reconciliation: mergeReconciliation(state.reconciliation, prepared.reconciliation),
      warnings: mergeWarnings(state.warnings, prepared.warnings),
    });
    await savePhase(input.context, PREFLIGHT_PHASE, {
      state,
      expectedItems: input.sourceSummary.records,
      processedItems: state.recordsPreflighted,
      pagesProcessed: state.unitsPreflighted,
      chunksProcessed: state.unitsPreflighted,
      complete: false,
    });
    input.onProgress({
      stage: 'tiktok_business_unit_preflighted',
      sequence: unit.sequence,
      unitRecords: unit.records.length,
      recordsPreflighted: state.recordsPreflighted,
    });
  }

  if (state.recordsPreflighted !== input.sourceSummary.records
    || state.unitsPreflighted !== input.sourceSummary.pagesProcessed
    || state.selectedRowsPreflighted !== input.incrementalPlan.selectedRecords) {
    throw permanentError('TikTok staged business preflight completeness check failed', {
      code: 'TIKTOK_BUSINESS_PREFLIGHT_INCOMPLETE',
      details: {
        expectedRecords: input.sourceSummary.records,
        processedRecords: state.recordsPreflighted,
        expectedPages: input.sourceSummary.pagesProcessed,
        processedPages: state.unitsPreflighted,
        expectedSelectedRecords: input.incrementalPlan.selectedRecords,
        selectedRowsPreflighted: state.selectedRowsPreflighted,
      },
    });
  }

  await savePhase(input.context, PREFLIGHT_PHASE, {
    state,
    expectedItems: input.sourceSummary.records,
    processedItems: state.recordsPreflighted,
    pagesProcessed: state.unitsPreflighted,
    chunksProcessed: state.unitsPreflighted,
    complete: true,
  });
  return state;
}

async function writeAllUnits(input) {
  let phase = await loadPhase(input.context, WRITE_PHASE);
  assertPhasePlanCompatible(phase, input.planFingerprint);
  if (phase?.complete) return normalizeWriteState(phase.state, input.planFingerprint);

  let state = normalizeWriteState(phase?.state, input.planFingerprint);
  for await (const unit of iterateTikTokStagedSourceUnits({
    context: input.context,
    afterSequence: state.nextSequence,
  })) {
    const selectedIds = selectUnitExternalContentIds(unit.records, input.selectedExternalIds);
    const prepared = await prepareUnit({ ...input, unit, selectedIds });
    assertTikTokSyncReady(prepared);
    await input.context.assertCurrent();

    let contentResult;
    try {
      contentResult = await input.syncEngine.executePlan(prepared.plans.content, {
        beforeWriteChunk: input.context.assertCurrent,
        onProgress: (event) => input.onProgress({
          scope: 'content',
          unitSequence: unit.sequence,
          syncRunId: input.syncRunId,
          ...event,
        }),
      });
    } catch (cause) {
      throw buildStagedPartialError({
        cause,
        input,
        state,
        prepared,
        failedPhase: 'content',
        contentResult: isPartialSyncError(cause)
          ? normalizeTablePartialResult(cause.partialResult, prepared.plans.content)
          : null,
        dailyResult: null,
      });
    }

    let dailyResult;
    try {
      dailyResult = await input.syncEngine.executePlan(prepared.plans.dailySnapshots, {
        beforeWriteChunk: input.context.assertCurrent,
        onProgress: (event) => input.onProgress({
          scope: 'daily_snapshots',
          unitSequence: unit.sequence,
          syncRunId: input.syncRunId,
          ...event,
        }),
      });
    } catch (cause) {
      throw buildStagedPartialError({
        cause,
        input,
        state,
        prepared,
        failedPhase: 'daily_snapshots',
        contentResult,
        dailyResult: isPartialSyncError(cause)
          ? normalizeTablePartialResult(cause.partialResult, prepared.plans.dailySnapshots)
          : null,
      });
    }

    state = Object.freeze({
      ...state,
      nextSequence: unit.sequence + 1,
      unitsCompleted: state.unitsCompleted + 1,
      sourceRecordsCompleted: state.sourceRecordsCompleted + unit.records.length,
      selectedRecordsCompleted: state.selectedRecordsCompleted + prepared.plans.content.inputRows,
      contentResult: mergeTableResult(state.contentResult, contentResult),
      dailyResult: mergeTableResult(state.dailyResult, dailyResult),
      reconciliation: mergeReconciliation(state.reconciliation, prepared.reconciliation),
      warnings: mergeWarnings(state.warnings, prepared.warnings),
    });
    await saveWriteState({ ...input, state, complete: false });
    input.onProgress({
      stage: 'tiktok_business_unit_written',
      sequence: unit.sequence,
      unitRecords: unit.records.length,
      selectedRecords: prepared.plans.content.inputRows,
      unitsCompleted: state.unitsCompleted,
    });
  }

  if (state.sourceRecordsCompleted !== input.sourceSummary.records
    || state.unitsCompleted !== input.sourceSummary.pagesProcessed
    || state.selectedRecordsCompleted !== input.incrementalPlan.selectedRecords) {
    throw permanentError('TikTok staged business write completeness check failed', {
      code: 'TIKTOK_BUSINESS_WRITE_INCOMPLETE',
      details: {
        expectedRecords: input.sourceSummary.records,
        processedRecords: state.sourceRecordsCompleted,
        expectedPages: input.sourceSummary.pagesProcessed,
        processedPages: state.unitsCompleted,
        expectedSelectedRecords: input.incrementalPlan.selectedRecords,
        selectedRecordsCompleted: state.selectedRecordsCompleted,
      },
    });
  }

  const resultDraft = buildWriteResult({
    syncRunId: input.syncRunId,
    sourceSummary: input.sourceSummary,
    plan: input.incrementalPlan,
    dictionaryAnalysis: input.dictionaryAnalysis,
    state,
    checkpointSaved: false,
  });
  state = Object.freeze({ ...state, resultDraft });
  await saveWriteState({ ...input, state, complete: true });
  return state;
}

async function prepareUnit(input) {
  return prepareTikTokCreatorLarkSync({
    repository: input.repository,
    syncEngine: input.syncEngine,
    tables: input.tables,
    accountId: input.accountId,
    sourceHandle: input.sourceHandle,
    metricDate: input.metricDate,
    rawRecords: input.unit.records,
    dictionaryAnalysis: input.dictionaryAnalysis,
    selectedExternalContentIds: input.selectedIds,
    incrementalPlan: input.incrementalPlan.enabled ? input.incrementalPlan : null,
    onProgress: (event) => input.onProgress({
      unitSequence: input.unit.sequence,
      ...event,
    }),
  });
}

async function* iterateStagedRawRecords(context) {
  for await (const unit of iterateTikTokStagedSourceUnits({ context })) {
    for (const record of unit.records) yield record;
  }
}

function selectUnitExternalContentIds(records, selectedExternalIds) {
  const selected = [];
  for (const record of records) {
    const mapped = mapTikTokCreatorVideoRow(record?.fields ?? {});
    if (selectedExternalIds.has(mapped.externalContentId)) selected.push(mapped.externalContentId);
  }
  return selected;
}

async function createBusinessPlanFingerprint(plan, metricDate) {
  return createStableFingerprint({
    contract: 'tiktok-staged-business-v1',
    metricDate,
    mode: plan.mode,
    reason: plan.reason,
    dictionaryHash: plan.dictionaryHash,
    sourceRecords: plan.sourceRecords,
    selectedExternalContentIds: plan.selectedExternalContentIds,
    checkpointRecords: plan.checkpointRecords.map((record) => ({
      sourceRecordId: record.sourceRecordId,
      sourceHash: record.sourceHash,
      externalContentId: record.externalContentId,
    })),
  });
}

function disableIncremental(plan) {
  return Object.freeze({
    ...plan,
    enabled: false,
    mode: 'full',
    reason: 'incremental_disabled',
    requestedMode: 'full',
    sourceSkippedPerTable: 0,
  });
}

function buildDryRunResult(input) {
  return Object.freeze({
    syncRunId: input.syncRunId,
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    mode: 'dry_run',
    readyToWrite: true,
    rawRecords: input.sourceSummary.records,
    processedRawRecords: input.plan.selectedRecords,
    incremental: summarizeIncremental(input.plan, false),
    classificationRules: input.dictionaryAnalysis.rules.length,
    classificationDictionary: summarizeDictionary(input.dictionaryAnalysis),
    content: withPlanSourceSkips(input.preflight.contentPlan, input.plan),
    dailySnapshots: withPlanSourceSkips(input.preflight.dailyPlan, input.plan),
    reconciliation: input.preflight.reconciliation,
    skippedRows: Object.freeze([]),
    sourceIdentity: input.plan.sourceIdentity,
    accountConflicts: Object.freeze([]),
    warnings: input.preflight.warnings,
    sourceSummary: input.sourceSummary,
    stagedBusiness: Object.freeze({
      bounded: true,
      preflightComplete: true,
      writeComplete: false,
      unitsPreflighted: input.preflight.unitsPreflighted,
      unitsCompleted: 0,
    }),
  });
}

function buildWriteResult(input) {
  return Object.freeze({
    syncRunId: input.syncRunId,
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    mode: 'write',
    rawRecords: input.sourceSummary.records,
    processedRawRecords: input.plan.selectedRecords,
    incremental: summarizeIncremental(input.plan, input.checkpointSaved),
    content: withTableSourceSkips(input.state.contentResult, input.plan),
    dailySnapshots: withTableSourceSkips(input.state.dailyResult, input.plan),
    reconciliation: Object.freeze({
      ...input.state.reconciliation,
      status: input.state.reconciliation.required ? 'recovered' : 'not_required',
      recovered: input.state.reconciliation.required,
    }),
    classificationRules: input.dictionaryAnalysis.rules.length,
    classificationDictionary: summarizeDictionary(input.dictionaryAnalysis),
    skippedRows: Object.freeze([]),
    sourceIdentity: input.plan.sourceIdentity,
    accountConflicts: Object.freeze([]),
    warnings: input.state.warnings,
    sourceSummary: input.sourceSummary,
    stagedBusiness: Object.freeze({
      bounded: true,
      preflightComplete: true,
      writeComplete: true,
      unitsCompleted: input.state.unitsCompleted,
      selectedRecordsCompleted: input.state.selectedRecordsCompleted,
      checkpointSaved: input.checkpointSaved,
    }),
  });
}

function buildStagedPartialError(input) {
  const contentCurrent = input.contentResult
    ?? unknownTableResult(input.prepared.plans.content);
  const dailyCurrent = input.dailyResult
    ?? (input.failedPhase === 'daily_snapshots'
      ? unknownTableResult(input.prepared.plans.dailySnapshots)
      : plannedOnlyResult(input.prepared.plans.dailySnapshots));
  const contentAggregate = mergeTableResult(input.state.contentResult, contentCurrent);
  const dailyAggregate = mergeTableResult(input.state.dailyResult, dailyCurrent);
  const confirmedWrites = contentAggregate.created + contentAggregate.updated
    + dailyAggregate.created + dailyAggregate.updated;
  if (confirmedWrites === 0 && !isPartialSyncError(input.cause)) return input.cause;

  const partialState = Object.freeze({
    ...input.state,
    contentResult: contentAggregate,
    dailyResult: dailyAggregate,
    reconciliation: mergeReconciliation(input.state.reconciliation, input.prepared.reconciliation),
  });
  const partialResult = buildWriteResult({
    syncRunId: input.input.syncRunId,
    sourceSummary: input.input.sourceSummary,
    plan: input.input.incrementalPlan,
    dictionaryAnalysis: input.input.dictionaryAnalysis,
    state: partialState,
    checkpointSaved: false,
  });

  return partialSyncError(`TikTok staged sync partially completed during ${input.failedPhase}`, {
    retryable: input.cause?.retryable !== false,
    cause: input.cause,
    partialResult,
    details: {
      failedPhase: input.failedPhase,
      unitsCompleted: input.state.unitsCompleted,
      contentCreated: contentAggregate.created,
      contentUpdated: contentAggregate.updated,
      dailyCreated: dailyAggregate.created,
      dailyUpdated: dailyAggregate.updated,
      causeCode: input.cause?.code ?? null,
      causeMessage: input.cause instanceof Error ? input.cause.message : String(input.cause),
    },
  });
}

async function recordCheckpointAttempt(input) {
  const state = Object.freeze({
    ...input.writeState,
    checkpointAttemptSyncRunId: input.syncRunId,
  });
  await saveWriteState({
    context: input.context,
    sourceSummary: input.sourceSummary,
    incrementalPlan: input.plan,
    state,
    complete: true,
  });
  return state;
}

async function markCheckpointSaved(input) {
  const resultDraft = withCheckpointSaved(input.writeState.resultDraft, input.plan.enabled);
  const state = Object.freeze({
    ...input.writeState,
    checkpointSaved: true,
    resultDraft,
  });
  await saveWriteState({
    context: input.context,
    sourceSummary: input.sourceSummary,
    incrementalPlan: input.plan,
    state,
    complete: true,
  });
  return state;
}

async function saveWriteState(input) {
  await savePhase(input.context, WRITE_PHASE, {
    state: input.state,
    expectedItems: input.incrementalPlan.selectedRecords,
    processedItems: input.state.selectedRecordsCompleted,
    pagesProcessed: input.state.unitsCompleted,
    chunksProcessed: input.state.unitsCompleted,
    complete: input.complete === true,
  });
}

async function saveCompletionPhase(input) {
  await savePhase(input.context, COMPLETION_PHASE, {
    state: { result: input.result },
    expectedItems: 1,
    processedItems: 1,
    pagesProcessed: input.sourceSummary.pagesProcessed,
    chunksProcessed: input.sourceSummary.pagesProcessed,
    complete: true,
  });
}

async function loadPhase(context, phase) {
  await context.assertCurrent();
  return context.store.loadPhase({ workKey: context.workKey, phase });
}

async function savePhase(context, phase, value) {
  await context.assertCurrent();
  return context.store.savePhase({
    workKey: context.workKey,
    phase,
    ...value,
  });
}

function checkpointAlreadySaved(state, checkpoint, incrementalEnabled) {
  if (!incrementalEnabled) return true;
  if (state?.checkpointSaved === true) return true;
  const attemptSyncRunId = optionalText(state?.checkpointAttemptSyncRunId);
  return Boolean(attemptSyncRunId && checkpoint?.cursor?.lastSyncRunId === attemptSyncRunId);
}

function withCheckpointSaved(result, incrementalEnabled) {
  if (!isPlainObject(result)) throw new TypeError('TikTok staged result is missing');
  return Object.freeze({
    ...result,
    incremental: result.incremental
      ? Object.freeze({ ...result.incremental, checkpointSaved: true })
      : null,
    stagedBusiness: Object.freeze({
      ...(result.stagedBusiness ?? {}),
      checkpointSaved: incrementalEnabled ? true : null,
    }),
  });
}

function assertSourceCompleteness(plan, sourceSummary) {
  if (plan.sourceRecords !== sourceSummary.records) {
    throw permanentError('TikTok staged source analysis completeness check failed', {
      code: 'TIKTOK_SOURCE_STAGING_INCOMPLETE',
      details: {
        expectedRecords: sourceSummary.records,
        analyzedRecords: plan.sourceRecords,
      },
    });
  }
}

function assertDictionaryReady(value) {
  if (!Array.isArray(value?.rules) || value.rules.length === 0) {
    throw permanentError('TikTok classification dictionary has no enabled valid rules', {
      code: 'TIKTOK_SYNC_NOT_READY',
    });
  }
  if (Array.isArray(value.invalidRows) && value.invalidRows.length > 0) {
    throw permanentError('TikTok classification dictionary contains invalid enabled rows', {
      code: 'TIKTOK_SYNC_NOT_READY',
      details: { invalidDictionaryRows: value.invalidRows.length },
    });
  }
}

function assertPhasePlanCompatible(phase, planFingerprint) {
  if (!phase) return;
  const persisted = optionalText(phase.state?.planFingerprint);
  if (persisted && persisted !== planFingerprint) {
    throw permanentError('TikTok staged business plan changed within the same work generation', {
      code: 'TIKTOK_STAGED_PLAN_CHANGED',
      details: {
        processedItems: phase.processedItems ?? 0,
        pagesProcessed: phase.pagesProcessed ?? 0,
      },
    });
  }
}

function normalizePreflightState(value, planFingerprint = null) {
  const state = isPlainObject(value) ? value : {};
  return Object.freeze({
    planFingerprint: optionalText(state.planFingerprint) ?? requireText(planFingerprint, 'planFingerprint'),
    nextSequence: nonNegativeInteger(state.nextSequence ?? 0),
    unitsPreflighted: nonNegativeInteger(state.unitsPreflighted ?? 0),
    recordsPreflighted: nonNegativeInteger(state.recordsPreflighted ?? 0),
    selectedRowsPreflighted: nonNegativeInteger(state.selectedRowsPreflighted ?? 0),
    contentPlan: normalizePlanSummary(state.contentPlan),
    dailyPlan: normalizePlanSummary(state.dailyPlan),
    reconciliation: normalizeReconciliation(state.reconciliation),
    warnings: Object.freeze(Array.isArray(state.warnings) ? state.warnings : []),
  });
}

function normalizeWriteState(value, planFingerprint = null) {
  const state = isPlainObject(value) ? value : {};
  return Object.freeze({
    planFingerprint: optionalText(state.planFingerprint) ?? requireText(planFingerprint, 'planFingerprint'),
    nextSequence: nonNegativeInteger(state.nextSequence ?? 0),
    unitsCompleted: nonNegativeInteger(state.unitsCompleted ?? 0),
    sourceRecordsCompleted: nonNegativeInteger(state.sourceRecordsCompleted ?? 0),
    selectedRecordsCompleted: nonNegativeInteger(state.selectedRecordsCompleted ?? 0),
    contentResult: normalizeTableResult(state.contentResult),
    dailyResult: normalizeTableResult(state.dailyResult),
    reconciliation: normalizeReconciliation(state.reconciliation),
    warnings: Object.freeze(Array.isArray(state.warnings) ? state.warnings : []),
    checkpointAttemptSyncRunId: optionalText(state.checkpointAttemptSyncRunId),
    checkpointSaved: state.checkpointSaved === true,
    resultDraft: isPlainObject(state.resultDraft) ? state.resultDraft : null,
  });
}

function mergePlanSummary(left, plan) {
  const base = normalizePlanSummary(left);
  return Object.freeze({
    rowsReady: base.rowsReady + nonNegativeInteger(plan.inputRows ?? 0),
    createRows: base.createRows + plan.createRows.length,
    updateRows: base.updateRows + plan.updateRows.length,
    skipped: base.skipped + nonNegativeInteger(plan.skipped ?? 0),
    duplicateInputRows: base.duplicateInputRows + nonNegativeInteger(plan.duplicateInputRows ?? 0),
    existingRecordsRead: base.existingRecordsRead + nonNegativeInteger(plan.existingRecordsRead ?? 0),
    existingReadStrategy: mergeReadStrategy(base.existingReadStrategy, plan.existingReadStrategy),
  });
}

function normalizePlanSummary(value) {
  return Object.freeze({
    rowsReady: nonNegativeInteger(value?.rowsReady ?? 0),
    createRows: nonNegativeInteger(value?.createRows ?? 0),
    updateRows: nonNegativeInteger(value?.updateRows ?? 0),
    skipped: nonNegativeInteger(value?.skipped ?? 0),
    duplicateInputRows: nonNegativeInteger(value?.duplicateInputRows ?? 0),
    existingRecordsRead: nonNegativeInteger(value?.existingRecordsRead ?? 0),
    existingReadStrategy: optionalText(value?.existingReadStrategy) ?? 'none',
  });
}

function mergeTableResult(left, right) {
  const base = normalizeTableResult(left);
  const incoming = normalizeTableResult(right);
  return Object.freeze({
    created: base.created + incoming.created,
    updated: base.updated + incoming.updated,
    skipped: base.skipped + incoming.skipped,
    duplicateInputRows: base.duplicateInputRows + incoming.duplicateInputRows,
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

function normalizeTablePartialResult(result, plan) {
  return Object.freeze({
    created: nonNegativeInteger(result?.created ?? 0),
    updated: nonNegativeInteger(result?.updated ?? 0),
    skipped: nonNegativeInteger(result?.skipped ?? plan.skipped ?? 0),
    duplicateInputRows: nonNegativeInteger(
      result?.duplicateInputRows ?? plan.duplicateInputRows ?? 0,
    ),
  });
}

function plannedOnlyResult(plan) {
  return Object.freeze({
    created: 0,
    updated: 0,
    skipped: nonNegativeInteger(plan.skipped ?? 0),
    duplicateInputRows: nonNegativeInteger(plan.duplicateInputRows ?? 0),
  });
}

function unknownTableResult(plan) {
  return plannedOnlyResult(plan);
}

function mergeReconciliation(left, right) {
  const base = normalizeReconciliation(left);
  const incoming = normalizeReconciliation(right);
  return Object.freeze({
    required: base.required || incoming.required,
    status: base.required || incoming.required ? 'recovery_required' : 'consistent',
    missingContentRows: base.missingContentRows + incoming.missingContentRows,
    missingDailySnapshotRows: base.missingDailySnapshotRows + incoming.missingDailySnapshotRows,
    missingContentIds: Object.freeze(
      [...new Set([...base.missingContentIds, ...incoming.missingContentIds])].slice(0, 20),
    ),
    missingDailySnapshotIds: Object.freeze(
      [...new Set([...base.missingDailySnapshotIds, ...incoming.missingDailySnapshotIds])].slice(0, 20),
    ),
  });
}

function normalizeReconciliation(value) {
  return Object.freeze({
    required: value?.required === true,
    status: optionalText(value?.status) ?? 'consistent',
    missingContentRows: nonNegativeInteger(value?.missingContentRows ?? 0),
    missingDailySnapshotRows: nonNegativeInteger(value?.missingDailySnapshotRows ?? 0),
    missingContentIds: Object.freeze(Array.isArray(value?.missingContentIds) ? value.missingContentIds : []),
    missingDailySnapshotIds: Object.freeze(
      Array.isArray(value?.missingDailySnapshotIds) ? value.missingDailySnapshotIds : [],
    ),
  });
}

function mergeWarnings(left, right) {
  const byKey = new Map();
  for (const warning of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    const key = JSON.stringify(warning);
    if (!byKey.has(key)) byKey.set(key, warning);
  }
  return Object.freeze([...byKey.values()]);
}

function withPlanSourceSkips(result, plan) {
  return Object.freeze({
    ...result,
    skipped: result.skipped + readSourceSkips(plan),
  });
}

function withTableSourceSkips(result, plan) {
  const normalized = normalizeTableResult(result);
  return Object.freeze({
    ...normalized,
    skipped: normalized.skipped + readSourceSkips(plan),
  });
}

function readSourceSkips(plan) {
  return plan.enabled ? nonNegativeInteger(plan.sourceSkippedPerTable ?? 0) : 0;
}

function summarizeIncremental(plan, checkpointSaved) {
  if (!plan.enabled) return null;
  return Object.freeze({
    enabled: true,
    mode: plan.mode,
    reason: plan.reason,
    requestedMode: plan.requestedMode,
    sourceRecords: plan.sourceRecords,
    selectedRecords: plan.selectedRecords,
    changedRecords: plan.changedRecords,
    unchangedRecords: plan.unchangedRecords,
    removedRecords: plan.removedRecords,
    dictionaryChanged: plan.dictionaryChanged,
    metricDateChanged: plan.metricDateChanged,
    fullSnapshot: plan.fullSnapshot,
    checkpointSaved: checkpointSaved === true,
  });
}

function summarizeDictionary(value) {
  return Object.freeze({
    totalRows: nonNegativeInteger(value.totalRows ?? 0),
    disabledRows: nonNegativeInteger(value.disabledRows ?? 0),
    invalidRows: Object.freeze(Array.isArray(value.invalidRows) ? value.invalidRows : []),
  });
}

function mergeReadStrategy(left, right) {
  const values = new Set([left, right].filter((value) => value && value !== 'none'));
  if (values.size === 0) return 'none';
  if (values.size === 1) return [...values][0];
  return 'mixed';
}

function requireContext(value) {
  for (const method of ['assertCurrent']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`TikTok staged business sync requires context.${method}`);
    }
  }
  for (const method of ['loadPhase', 'savePhase', 'listPhaseUnits']) {
    if (typeof value?.store?.[method] !== 'function') {
      throw new TypeError(`TikTok staged business sync requires context.store.${method}`);
    }
  }
  requireText(value.workKey, 'context.workKey');
  nonNegativeInteger(value.generation);
  nonNegativeInteger(value.requestedAt);
  return value;
}

function requireRepository(value) {
  for (const method of ['listAll', 'prepareRows', 'createMany', 'updateMany']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`TikTok staged business sync requires repository.${method}`);
    }
  }
  return value;
}

function requireSyncEngine(value) {
  for (const method of ['planByKey', 'executePlan']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`TikTok staged business sync requires syncEngine.${method}`);
    }
  }
  return value;
}

function requireIncrementalStateStore(value) {
  if (typeof value?.loadCheckpoint !== 'function' || typeof value?.saveCheckpoint !== 'function') {
    throw new TypeError('TikTok staged business sync requires incrementalStateStore');
  }
  return value;
}

function requireTables(value) {
  return Object.freeze({
    rawTikTokCreatorVideos: requireText(value?.rawTikTokCreatorVideos, 'tables.rawTikTokCreatorVideos'),
    mktContent: requireText(value?.mktContent, 'tables.mktContent'),
    mktContentDaily: requireText(value?.mktContentDaily, 'tables.mktContentDaily'),
    mktClassificationDictionary: requireText(
      value?.mktClassificationDictionary,
      'tables.mktClassificationDictionary',
    ),
  });
}

function requireSourceSummary(value) {
  if (!isPlainObject(value) || value.complete !== true || value.durable !== true) {
    throw new TypeError('TikTok staged business sync requires a complete durable source summary');
  }
  return Object.freeze({
    ...value,
    records: nonNegativeInteger(value.records),
    pagesProcessed: nonNegativeInteger(value.pagesProcessed),
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok staged business sync requires ${fieldName}`);
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError('TikTok staged business sync requires a non-negative safe integer');
  }
  return number;
}
