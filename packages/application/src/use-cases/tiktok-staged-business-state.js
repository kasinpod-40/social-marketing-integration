import {
  isPartialSyncError,
  partialSyncError,
} from '../../../shared/src/errors/runtime-error.js';
import {
  isPlainObject,
  nonNegativeInteger,
  optionalText,
  requireText,
} from './tiktok-staged-business-contract.js';

export function normalizePreflightState(value, planFingerprint = null) {
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

export function normalizeWriteState(value, planFingerprint = null) {
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

export function mergePlanSummary(left, plan) {
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

export function normalizePlanSummary(value) {
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

export function mergeTableResult(left, right) {
  const base = normalizeTableResult(left);
  const incoming = normalizeTableResult(right);
  return Object.freeze({
    created: base.created + incoming.created,
    updated: base.updated + incoming.updated,
    skipped: base.skipped + incoming.skipped,
    duplicateInputRows: base.duplicateInputRows + incoming.duplicateInputRows,
  });
}

export function normalizeTableResult(value) {
  return Object.freeze({
    created: nonNegativeInteger(value?.created ?? 0),
    updated: nonNegativeInteger(value?.updated ?? 0),
    skipped: nonNegativeInteger(value?.skipped ?? 0),
    duplicateInputRows: nonNegativeInteger(value?.duplicateInputRows ?? 0),
  });
}

export function normalizeTablePartialResult(result, plan) {
  return Object.freeze({
    created: nonNegativeInteger(result?.created ?? 0),
    updated: nonNegativeInteger(result?.updated ?? 0),
    skipped: nonNegativeInteger(result?.skipped ?? plan.skipped ?? 0),
    duplicateInputRows: nonNegativeInteger(
      result?.duplicateInputRows ?? plan.duplicateInputRows ?? 0,
    ),
  });
}

export function plannedOnlyResult(plan) {
  return Object.freeze({
    created: 0,
    updated: 0,
    skipped: nonNegativeInteger(plan.skipped ?? 0),
    duplicateInputRows: nonNegativeInteger(plan.duplicateInputRows ?? 0),
  });
}

export function unknownTableResult(plan) {
  return plannedOnlyResult(plan);
}

export function mergeReconciliation(left, right) {
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

export function normalizeReconciliation(value) {
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

export function mergeWarnings(left, right) {
  const byKey = new Map();
  for (const warning of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    const key = JSON.stringify(warning);
    if (!byKey.has(key)) byKey.set(key, warning);
  }
  return Object.freeze([...byKey.values()]);
}

export function withPlanSourceSkips(result, plan) {
  return Object.freeze({
    ...result,
    skipped: result.skipped + readSourceSkips(plan),
  });
}

export function withTableSourceSkips(result, plan) {
  const normalized = normalizeTableResult(result);
  return Object.freeze({
    ...normalized,
    skipped: normalized.skipped + readSourceSkips(plan),
  });
}

export function summarizeIncremental(plan, checkpointSaved) {
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

export function summarizeDictionary(value) {
  return Object.freeze({
    totalRows: nonNegativeInteger(value.totalRows ?? 0),
    disabledRows: nonNegativeInteger(value.disabledRows ?? 0),
    invalidRows: Object.freeze(Array.isArray(value.invalidRows) ? value.invalidRows : []),
  });
}

export function buildDryRunResult(input) {
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

export function buildWriteResult(input) {
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

export function buildStagedPartialError(input) {
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

export function withCheckpointSaved(result, incrementalEnabled) {
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

function readSourceSkips(plan) {
  return plan.enabled ? nonNegativeInteger(plan.sourceSkippedPerTable ?? 0) : 0;
}

function mergeReadStrategy(left, right) {
  const values = new Set([left, right].filter((value) => value && value !== 'none'));
  if (values.size === 0) return 'none';
  if (values.size === 1) return [...values][0];
  return 'mixed';
}
