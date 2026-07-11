import {
  assertTikTokSyncReady,
  prepareTikTokCreatorLarkSync,
} from './prepare-tiktok-creator-lark-sync.js';
import {
  isPartialSyncError,
  partialSyncError,
} from '../../../shared/src/errors/runtime-error.js';

/**
 * Sync RAW TikTok Creator ไปยัง MKT_Content และ MKT_Content_Daily
 */
export async function syncTikTokCreatorNativeToLark(input) {
  const progress = typeof input?.onProgress === 'function' ? input.onProgress : () => undefined;
  const assertLockActive = typeof input?.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;
  const syncRunId = optionalText(input?.syncRunId);
  const prepared = await prepareTikTokCreatorLarkSync({
    repository: input?.repository,
    syncEngine: input?.syncEngine,
    tables: input?.tables,
    accountId: input?.accountId,
    sourceHandle: input?.sourceHandle,
    metricDate: input?.metricDate,
    onProgress: progress,
  });

  if (input?.dryRun === true) {
    return Object.freeze({
      syncRunId,
      platform: prepared.platform,
      source: prepared.source,
      mode: 'dry_run',
      readyToWrite: prepared.readyToWrite,
      rawRecords: prepared.rawRecords,
      classificationRules: prepared.classificationRules,
      classificationDictionary: prepared.classificationDictionary,
      content: planSummary(prepared.plans.content),
      dailySnapshots: planSummary(prepared.plans.dailySnapshots),
      reconciliation: prepared.reconciliation,
      skippedRows: prepared.normalized.skippedRows,
      sourceIdentity: prepared.sourceIdentity,
      accountConflicts: prepared.accountConflicts,
      issues: prepared.issues,
      warnings: prepared.warnings,
    });
  }

  assertTikTokSyncReady(prepared);
  await assertLockActive();

  progress({
    stage: 'executing_content_plan',
    syncRunId,
    createRows: prepared.plans.content.createRows.length,
    updateRows: prepared.plans.content.updateRows.length,
  });

  let contentResult;
  try {
    contentResult = await input.syncEngine.executePlan(prepared.plans.content, {
      beforeWriteChunk: assertLockActive,
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

  await assertLockActive();
  progress({
    stage: 'executing_daily_snapshot_plan',
    syncRunId,
    createRows: prepared.plans.dailySnapshots.createRows.length,
    updateRows: prepared.plans.dailySnapshots.updateRows.length,
  });

  let dailyResult;
  try {
    dailyResult = await input.syncEngine.executePlan(prepared.plans.dailySnapshots, {
      beforeWriteChunk: assertLockActive,
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
  await assertLockActive();

  return buildResult({
    syncRunId,
    prepared,
    contentResult,
    dailyResult,
    reconciliationStatus: prepared.reconciliation.required ? 'recovered' : 'not_required',
  });
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
    content: Object.freeze({ ...input.contentResult }),
    dailySnapshots: Object.freeze({ ...input.dailyResult }),
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

function planSummary(plan) {
  return Object.freeze({
    rowsReady: plan.inputRows,
    createRows: plan.createRows.length,
    updateRows: plan.updateRows.length,
    skipped: plan.skipped,
    duplicateInputRows: plan.duplicateInputRows,
    existingRecordsRead: plan.existingRecordsRead,
    existingReadStrategy: plan.existingReadStrategy,
  });
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
