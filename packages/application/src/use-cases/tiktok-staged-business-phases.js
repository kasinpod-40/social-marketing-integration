import {
  assertTikTokSyncReady,
  prepareTikTokCreatorLarkSync,
} from './prepare-tiktok-creator-lark-sync.js';
import { iterateTikTokStagedSourceUnits } from './tiktok-resumable-unit-reader.js';
import {
  isPartialSyncError,
  permanentError,
} from '../../../shared/src/errors/runtime-error.js';
import {
  TIKTOK_STAGED_BUSINESS_PHASES,
  assertPhasePlanCompatible,
  optionalText,
  selectUnitExternalContentIds,
} from './tiktok-staged-business-contract.js';
import {
  buildStagedPartialError,
  buildWriteResult,
  mergeHistoryPlan,
  mergeHistoryResult,
  mergePlanSummary,
  mergeReconciliation,
  mergeTableResult,
  mergeWarnings,
  normalizePreflightState,
  normalizeTablePartialResult,
  normalizeWriteState,
  withCheckpointSaved,
} from './tiktok-staged-business-state.js';

export async function preflightAllUnits(input) {
  let phase = await loadPhase(input.context, TIKTOK_STAGED_BUSINESS_PHASES.PREFLIGHT);
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
    const historyPlan = input.historyHooks
      ? await input.historyHooks.preflightUnit(prepared)
      : null;

    state = Object.freeze({
      ...state,
      nextSequence: unit.sequence + 1,
      unitsPreflighted: state.unitsPreflighted + 1,
      recordsPreflighted: state.recordsPreflighted + unit.records.length,
      selectedRowsPreflighted: state.selectedRowsPreflighted + prepared.plans.content.inputRows,
      contentPlan: mergePlanSummary(state.contentPlan, prepared.plans.content),
      dailyPlan: mergePlanSummary(state.dailyPlan, prepared.plans.dailySnapshots),
      historyPlan: historyPlan ? mergeHistoryPlan(state.historyPlan, historyPlan) : state.historyPlan,
      reconciliation: mergeReconciliation(state.reconciliation, prepared.reconciliation),
      warnings: mergeWarnings(state.warnings, prepared.warnings),
    });
    await savePhase(input.context, TIKTOK_STAGED_BUSINESS_PHASES.PREFLIGHT, {
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
      d1HistoryRows: historyPlan?.contentRows ?? 0,
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
  if (input.historyHooks && state.historyPlan.contentRows !== input.incrementalPlan.selectedRecords) {
    throw permanentError('TikTok D1 history preflight completeness check failed', {
      code: 'TIKTOK_HISTORY_PREFLIGHT_INCOMPLETE',
      details: {
        expectedRows: input.incrementalPlan.selectedRecords,
        plannedRows: state.historyPlan.contentRows,
      },
    });
  }

  await savePhase(input.context, TIKTOK_STAGED_BUSINESS_PHASES.PREFLIGHT, {
    state,
    expectedItems: input.sourceSummary.records,
    processedItems: state.recordsPreflighted,
    pagesProcessed: state.unitsPreflighted,
    chunksProcessed: state.unitsPreflighted,
    complete: true,
  });
  return state;
}

export async function writeAllUnits(input) {
  let phase = await loadPhase(input.context, TIKTOK_STAGED_BUSINESS_PHASES.WRITE);
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

    let historyResult = null;
    if (input.historyHooks) {
      try {
        historyResult = await input.historyHooks.writeUnit(prepared);
      } catch (cause) {
        throw buildStagedPartialError({
          cause,
          input,
          state,
          prepared,
          failedPhase: 'd1_history',
          historyResult: null,
          contentResult: null,
          dailyResult: null,
        });
      }
      input.onProgress({
        stage: 'tiktok_d1_history_unit_written',
        sequence: unit.sequence,
        syncRunId: input.syncRunId,
        contentRows: historyResult.contentRows,
        observationsCreated: historyResult.observationsCreated,
        observationsSkipped: historyResult.observationsSkipped,
      });
    }

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
        historyResult,
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
        historyResult,
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
      historyResult: historyResult
        ? mergeHistoryResult(state.historyResult, historyResult)
        : state.historyResult,
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
      d1HistoryEnabled: state.historyResult.enabled,
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
  if (input.historyHooks
    && state.historyResult.contentRowsDurable !== input.incrementalPlan.selectedRecords) {
    throw permanentError('TikTok D1 history write completeness check failed', {
      code: 'TIKTOK_HISTORY_WRITE_INCOMPLETE',
      details: {
        expectedRows: input.incrementalPlan.selectedRecords,
        durableRows: state.historyResult.contentRowsDurable,
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

export async function recordCheckpointAttempt(input) {
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

export async function markCheckpointSaved(input) {
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

export async function saveCompletionPhase(input) {
  await savePhase(input.context, TIKTOK_STAGED_BUSINESS_PHASES.COMPLETION, {
    state: { result: input.result },
    expectedItems: 1,
    processedItems: 1,
    pagesProcessed: input.sourceSummary.pagesProcessed,
    chunksProcessed: input.sourceSummary.pagesProcessed,
    complete: true,
  });
}

export async function loadPhase(context, phase) {
  await context.assertCurrent();
  return context.store.loadPhase({ workKey: context.workKey, phase });
}

export function checkpointAlreadySaved(state, checkpoint, incrementalEnabled) {
  if (!incrementalEnabled) return true;
  if (state?.checkpointSaved === true) return true;
  const attemptSyncRunId = optionalText(state?.checkpointAttemptSyncRunId);
  return Boolean(attemptSyncRunId && checkpoint?.cursor?.lastSyncRunId === attemptSyncRunId);
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

async function saveWriteState(input) {
  await savePhase(input.context, TIKTOK_STAGED_BUSINESS_PHASES.WRITE, {
    state: input.state,
    expectedItems: input.incrementalPlan.selectedRecords,
    processedItems: input.state.selectedRecordsCompleted,
    pagesProcessed: input.state.unitsCompleted,
    chunksProcessed: input.state.unitsCompleted,
    complete: input.complete === true,
  });
}

async function savePhase(context, phase, value) {
  await context.assertCurrent();
  return context.store.savePhase({
    workKey: context.workKey,
    phase,
    ...value,
  });
}
