import { analyzeClassificationDictionaryRecords } from '../services/classification-dictionary.js';
import {
  buildTikTokIncrementalCheckpoint,
  planTikTokIncrementalSourceIterable,
} from './plan-tiktok-incremental-source.js';
import {
  assertDictionaryReady,
  assertPhasePlanCompatible,
  assertSourceCompleteness,
  createBusinessPlanFingerprint,
  DEFAULT_TIKTOK_FULL_SYNC_INTERVAL_MS,
  disableIncremental,
  isPlainObject,
  iterateStagedRawRecords,
  requireContext,
  requireIncrementalStateStore,
  requireRepository,
  requireSourceSummary,
  requireSyncEngine,
  requireTables,
  requireText,
  TIKTOK_STAGED_BUSINESS_PHASES,
} from './tiktok-staged-business-contract.js';
import {
  checkpointAlreadySaved,
  loadPhase,
  markCheckpointSaved,
  preflightAllUnits,
  recordCheckpointAttempt,
  saveCompletionPhase,
  writeAllUnits,
} from './tiktok-staged-business-phases.js';
import {
  buildDryRunResult,
  withCheckpointSaved,
} from './tiktok-staged-business-state.js';

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

  const completedPhase = await loadPhase(context, TIKTOK_STAGED_BUSINESS_PHASES.COMPLETION);
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

  const existingWritePhase = await loadPhase(context, TIKTOK_STAGED_BUSINESS_PHASES.WRITE);
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
    fullSyncIntervalMs: input.fullSyncIntervalMs ?? DEFAULT_TIKTOK_FULL_SYNC_INTERVAL_MS,
    expectedSourceHandle: sourceHandle,
  });
  const plan = incrementalEnabled ? scannedPlan : disableIncremental(scannedPlan);
  assertSourceCompleteness(plan, sourceSummary);
  const planFingerprint = await createBusinessPlanFingerprint(plan, metricDate);
  assertPhasePlanCompatible(existingWritePhase, planFingerprint);

  const selectedExternalIds = new Set(plan.selectedExternalContentIds);
  const phaseInput = {
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
  };
  const preflight = await preflightAllUnits(phaseInput);

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
    ...phaseInput,
    syncRunId,
  });

  if (incrementalEnabled && !checkpointAlreadySaved(writeState, checkpoint, true)) {
    writeState = await recordCheckpointAttempt({
      context,
      sourceSummary,
      plan,
      writeState,
      syncRunId,
    });
    const checkpointWrite = buildTikTokIncrementalCheckpoint({
      plan,
      cursorKey,
      syncRunId,
      customerProfile,
      accountKey: accountId,
      metricDate,
      completedAt: now(),
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
  } else if (writeState.checkpointSaved !== true) {
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
