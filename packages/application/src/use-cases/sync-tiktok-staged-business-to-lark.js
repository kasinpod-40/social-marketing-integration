import { analyzeClassificationDictionaryRecords } from '../services/classification-dictionary.js';
import {
  buildTikTokIncrementalCheckpoint,
  createTikTokDictionaryHash,
  finalizeTikTokIncrementalSourceScan,
  planTikTokIncrementalSourceIterable,
  scanTikTokIncrementalSourceRecords,
} from './plan-tiktok-incremental-source.js';
import { iterateTikTokStagedSourceUnits } from './tiktok-resumable-unit-reader.js';
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
  normalizeWriteState,
  withCheckpointSaved,
} from './tiktok-staged-business-state.js';
import { verifyTikTokStagedSourceWatermark } from './verify-tiktok-staged-source-watermark.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/**
 * ประมวลผล TikTok business rows จาก Durable source units แบบสอง Pass:
 * 1) Validate/Preflight ทุก Unit ก่อน Write แรก
 * 2) D1 history (เมื่อเปิด) → Lark Content → Lark Daily แล้วจึง Persist Unit completion
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
  const historyHooks = normalizeHistoryHooks(input.historyHooks);
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
  const boundedInvocation = input.maxUnitsPerInvocation !== null
    && input.maxUnitsPerInvocation !== undefined;

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
  const persistedPlanPhase = await loadPhase(context, TIKTOK_STAGED_BUSINESS_PHASES.PLAN);
  let plan;
  let planFingerprint;
  let planCreated = false;
  if (persistedPlanPhase?.complete && isPlainObject(persistedPlanPhase.state?.plan)) {
    plan = persistedPlanPhase.state.plan;
    planFingerprint = requireText(
      persistedPlanPhase.state.planFingerprint,
      'persistedPlan.planFingerprint',
    );
    const currentDictionaryHash = await createTikTokDictionaryHash(dictionaryRecords);
    if (currentDictionaryHash !== plan.dictionaryHash) {
      throw permanentError('TikTok classification dictionary changed within the same work generation', {
        code: 'TIKTOK_STAGED_PLAN_CHANGED',
      });
    }
  } else {
    // Admission probe และ Durable staging อาจคั่นด้วยเวลา ต้องเทียบ Dataset จริงอีกครั้ง
    // ก่อนสร้าง immutable Business plan เพื่อปิด race กับ Lark Native ที่อัปเดตหลายหน้า.
    const stagedWatermark = await verifyTikTokStagedSourceWatermark({
      context,
      accountKey: accountId,
      sourceHandle,
      expectedSourceWatermark: input.expectedSourceWatermark,
    });
    if (stagedWatermark && stagedWatermark.recordCount !== sourceSummary.records) {
      throw new TypeError('TikTok staged watermark record count does not match source summary');
    }
    let scannedPlan;
    if (boundedInvocation) {
      const scanExecution = await scanBusinessPlanUnits({
        context,
        sourceSummary,
        maxUnitsPerInvocation: input.maxUnitsPerInvocation,
      });
      if (scanExecution.unitsProcessed > 0) {
        return buildContinuationResult({
          syncRunId,
          phase: 'business_plan_scan',
          nextSequence: scanExecution.nextSequence,
          sourceSummary,
        });
      }
      scannedPlan = await finalizeTikTokIncrementalSourceScan({
        scans: scanExecution.scans,
        dictionaryRecords,
        checkpoint,
        metricDate,
        syncMode: incrementalEnabled ? input.syncMode : 'full',
        now: context.requestedAt,
        fullSyncIntervalMs: input.fullSyncIntervalMs ?? DEFAULT_TIKTOK_FULL_SYNC_INTERVAL_MS,
        expectedSourceHandle: sourceHandle,
      });
    } else {
      scannedPlan = await planTikTokIncrementalSourceIterable({
        rawRecords: iterateStagedRawRecords(context),
        dictionaryRecords,
        checkpoint,
        metricDate,
        syncMode: incrementalEnabled ? input.syncMode : 'full',
        now: context.requestedAt,
        fullSyncIntervalMs: input.fullSyncIntervalMs ?? DEFAULT_TIKTOK_FULL_SYNC_INTERVAL_MS,
        expectedSourceHandle: sourceHandle,
      });
    }
    plan = incrementalEnabled ? scannedPlan : disableIncremental(scannedPlan);
    assertSourceCompleteness(plan, sourceSummary);
    planFingerprint = await createBusinessPlanFingerprint(plan, metricDate);
    await savePlanPhase({ context, sourceSummary, plan, planFingerprint });
    planCreated = true;
  }
  assertPhasePlanCompatible(existingWritePhase, planFingerprint);

  if (boundedInvocation && planCreated) {
    return buildContinuationResult({
      syncRunId,
      phase: 'business_plan',
      nextSequence: 0,
      sourceSummary,
    });
  }

  const selectedExternalIds = new Set(plan.selectedExternalContentIds);
  const phaseInput = {
    context,
    repository,
    syncEngine,
    tables,
    accountId,
    sourceHandle,
    metricDate,
    accountSyncedAt: metricDate,
    reportingTimezone: input.reportingTimezone ?? 'Asia/Bangkok',
    dictionaryAnalysis,
    incrementalPlan: plan,
    selectedExternalIds,
    planFingerprint,
    sourceSummary,
    historyHooks,
    onProgress,
    maxUnitsPerInvocation: input.maxUnitsPerInvocation,
    yieldAfterUnits: boundedInvocation,
    returnExecution: true,
  };
  const preflightExecution = await preflightAllUnits(phaseInput);
  const preflight = preflightExecution.state;
  if (boundedInvocation && preflightExecution.unitsProcessed > 0) {
    return buildContinuationResult({
      syncRunId,
      phase: 'business_preflight',
      nextSequence: preflight.nextSequence,
      sourceSummary,
    });
  }
  if (!preflightExecution.complete) {
    return buildContinuationResult({
      syncRunId,
      phase: 'business_preflight',
      nextSequence: preflight.nextSequence,
      sourceSummary,
    });
  }

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

  if (historyHooks) await historyHooks.begin(preflight.historyPlan);
  let writeState;
  try {
    const writeExecution = await writeAllUnits({
      ...phaseInput,
      syncRunId,
    });
    writeState = writeExecution.state;
    if (!writeExecution.complete) {
      return buildContinuationResult({
        syncRunId,
        phase: writeExecution.unitsComplete ? 'business_finalize' : 'business_write',
        nextSequence: writeState.nextSequence,
        sourceSummary,
      });
    }
    if (historyHooks) await historyHooks.complete(writeState.historyResult, now());
  } catch (error) {
    if (historyHooks) {
      const failedPhase = await loadPhase(context, TIKTOK_STAGED_BUSINESS_PHASES.WRITE);
      const persisted = normalizeWriteState(failedPhase?.state, planFingerprint);
      await historyHooks.fail(Object.freeze({
        ...persisted.historyResult,
        contentRows: preflight.historyPlan.contentRows,
      }), error, now());
    }
    throw error;
  }

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

async function scanBusinessPlanUnits(input) {
  let phase = await loadPhase(input.context, TIKTOK_STAGED_BUSINESS_PHASES.PLAN_SCAN);
  let nextSequence = Number(phase?.state?.nextSequence ?? 0);
  let recordsScanned = Number(phase?.processedItems ?? 0);
  let unitsScanned = Number(phase?.pagesProcessed ?? 0);
  let unitsProcessed = 0;
  const maxUnits = Number(input.maxUnitsPerInvocation);

  if (!phase?.complete) {
    for await (const unit of iterateTikTokStagedSourceUnits({
      context: input.context,
      afterSequence: nextSequence,
    })) {
      const scan = await scanTikTokIncrementalSourceRecords({ rawRecords: unit.records });
      nextSequence = unit.sequence + 1;
      recordsScanned += unit.records.length;
      unitsScanned += 1;
      unitsProcessed += 1;
      const complete = recordsScanned === input.sourceSummary.records
        && unitsScanned === input.sourceSummary.pagesProcessed;
      await input.context.assertCurrent();
      phase = await input.context.store.savePhase({
        workKey: input.context.workKey,
        phase: TIKTOK_STAGED_BUSINESS_PHASES.PLAN_SCAN,
        state: { nextSequence },
        expectedItems: input.sourceSummary.records,
        processedItems: recordsScanned,
        pagesProcessed: unitsScanned,
        chunksProcessed: unitsScanned,
        complete,
        unit: {
          unitKey: `scan:${unit.sequence}`,
          sequence: unit.sequence,
          payload: { scan },
        },
      });
      if (unitsProcessed >= maxUnits) break;
    }
  }

  if (unitsProcessed > 0) {
    return Object.freeze({ unitsProcessed, nextSequence, scans: null });
  }
  if (!phase?.complete) {
    throw permanentError('TikTok durable business plan scan is incomplete', {
      code: 'TIKTOK_BUSINESS_PLAN_SCAN_INCOMPLETE',
    });
  }

  const scans = [];
  let afterSequence = 0;
  while (afterSequence !== null) {
    const page = await input.context.store.listPhaseUnits({
      workKey: input.context.workKey,
      phase: TIKTOK_STAGED_BUSINESS_PHASES.PLAN_SCAN,
      afterSequence,
      limit: 100,
    });
    for (const unit of page.units) scans.push(unit.payload.scan);
    afterSequence = page.nextSequence;
  }
  return Object.freeze({ unitsProcessed: 0, nextSequence, scans: Object.freeze(scans) });
}

async function savePlanPhase(input) {
  await input.context.assertCurrent();
  await input.context.store.savePhase({
    workKey: input.context.workKey,
    phase: TIKTOK_STAGED_BUSINESS_PHASES.PLAN,
    state: {
      plan: input.plan,
      planFingerprint: input.planFingerprint,
    },
    expectedItems: input.sourceSummary.records,
    processedItems: input.sourceSummary.records,
    pagesProcessed: input.sourceSummary.pagesProcessed,
    chunksProcessed: input.sourceSummary.pagesProcessed,
    complete: true,
  });
}

function buildContinuationResult(input) {
  return Object.freeze({
    syncRunId: input.syncRunId,
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    mode: 'continuation',
    status: 'continuation_required',
    continuationRequired: true,
    continuationPhase: input.phase,
    continuationNextSequence: input.nextSequence,
    sourceSummary: input.sourceSummary,
    warnings: Object.freeze([]),
  });
}

function normalizeHistoryHooks(value) {
  if (value === null || value === undefined) return null;
  for (const method of ['preflightUnit', 'begin', 'writeUnit', 'complete', 'fail']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`TikTok staged business historyHooks.${method} is required`);
    }
  }
  return value;
}
