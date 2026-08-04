import {
  META_K2_EXACT_RECOVERY_IDENTITY,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import {
  normalizeMetaD1OnlySnapshot,
} from './meta-d1-only-rollout-operator.js';

export const META_K2_RETRY_CONTINUITY_MODE = Object.freeze({
  envName: 'MKT_META_K2_RETRY_CONTINUITY',
  value: 'ALLOW_NONDECREASING_TARGET_COUNT_DRIFT_ONLY',
});

const TARGET_COUNT_KEYS = Object.freeze([
  'organicState',
  'organicObservations',
  'accountDaily',
  'adsEntities',
  'adsDaily',
]);

const RAW_TARGET_COUNT_FIELDS = Object.freeze({
  organicState: 'target_organic_state_count',
  organicObservations: 'target_organic_observation_count',
  accountDaily: 'target_account_daily_count',
  adsEntities: 'target_ads_entity_count',
  adsDaily: 'target_ads_daily_count',
});

export function classifyMetaK2PreviewRetryContinuity(priorInput = {}, currentInput = {}) {
  const prior = normalizeMetaD1OnlySnapshot(priorInput);
  const current = normalizeMetaD1OnlySnapshot(currentInput);
  const elapsedMs = current.observedAt - prior.observedAt;
  const priorClassification = classifyExactPartial(prior);
  const currentClassification = classifyExactPartial(current);
  const exactChangedFields = diffPaths(
    exactOperationSnapshot(prior),
    exactOperationSnapshot(current),
  );
  const targetCountDelta = Object.freeze(Object.fromEntries(
    TARGET_COUNT_KEYS.map((key) => [
      key,
      current.targetCounts[key] - prior.targetCounts[key],
    ]),
  ));
  const targetCountRegressions = Object.freeze(
    TARGET_COUNT_KEYS.filter((key) => targetCountDelta[key] < 0),
  );
  const targetCountChangedFields = Object.freeze(
    TARGET_COUNT_KEYS.filter((key) => targetCountDelta[key] !== 0),
  );
  const accepted = priorClassification.accepted
    && currentClassification.accepted
    && elapsedMs >= 30_000
    && exactChangedFields.length === 0
    && targetCountRegressions.length === 0;
  return deepFreeze({
    accepted,
    elapsedMs,
    priorClassification,
    currentClassification,
    exactChangedFields,
    targetCountDelta,
    targetCountChangedFields,
    targetCountRegressions,
    targetCountOnlyDrift: accepted && targetCountChangedFields.length > 0,
    prior,
    current,
  });
}

export function patchMetaK2RawSnapshotTargetCounts(rawValue, priorTargetCounts = {}) {
  const cloned = structuredClone(rawValue);
  const row = firstResultRow(cloned);
  if (!row) throw continuityError('Remote D1 retry snapshot has no result row');
  for (const key of TARGET_COUNT_KEYS) {
    const value = Number(priorTargetCounts[key]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw continuityError('Prior Meta target count is invalid', { key });
    }
    row[RAW_TARGET_COUNT_FIELDS[key]] = value;
  }
  return cloned;
}

export function extractMetaK2RawSnapshot(value) {
  const row = firstResultRow(value);
  if (!row) throw continuityError('Remote D1 retry snapshot has no result row');
  return normalizeMetaD1OnlySnapshot(row);
}

function classifyExactPartial(snapshot) {
  const exact = META_K2_EXACT_RECOVERY_IDENTITY;
  const latestActivityAt = Math.max(
    snapshot.sourceStaging.updatedAt ?? 0,
    snapshot.syncRunUpdatedAt ?? 0,
    snapshot.queueOperationUpdatedAt ?? 0,
  );
  const successful = snapshot.syncRunStatus === 'success'
    && snapshot.syncRunStartedAt !== null
    && snapshot.syncRunFinishedAt !== null;
  const orphanedRunning = snapshot.syncRunStatus === 'running'
    && snapshot.syncRunStartedAt !== null
    && snapshot.syncRunFinishedAt === null;
  const checks = Object.freeze({
    recoverableSyncRun: successful || orphanedRunning,
    syncRunErrorAbsent: snapshot.syncRunErrorCode === null,
    syncRunRecordsWrittenZero: snapshot.syncRunRecordsWritten === 0,
    workActive: snapshot.workStatus === 'active',
    lifecycleActive: snapshot.workLifecycleStatus === 'active',
    workNotCompleted: snapshot.workCompletedAt === null,
    sourceIncomplete: snapshot.sourceStaging.complete === false,
    sourceStage: snapshot.sourceStaging.stage === exact.sourceStage,
    sourceUnitCount: snapshot.sourceStaging.unitCount === exact.sourceUnitCount,
    sourceRowCount: snapshot.sourceStaging.rowCount === exact.sourceRowCount,
    sourcePageNumber: snapshot.sourceStaging.pageNumber === exact.sourcePageNumber,
    sourceContentIndex: snapshot.sourceStaging.contentIndex === exact.sourceContentIndex,
    queueOperationAttempts: snapshot.queueOperationAttempts === exact.queueOperationAttempts,
    mainQueueAttempts: snapshot.mainQueueAttempts === exact.mainQueueAttempts,
    activeLocksZero: snapshot.activeLockCount === 0,
    d1NotStarted: snapshot.d1PhaseComplete === false && snapshot.d1PhaseUpdatedAt === null,
    coverageNotStarted: snapshot.coverageRunCount === 0
      && snapshot.coverageEntityCount === 0
      && snapshot.invalidCoverageCount === 0,
    larkNotStarted: snapshot.larkPhaseCount === 0,
    completionNotStarted: snapshot.completionPhaseCount === 0,
    operationWritesZero: Object.values(snapshot.operationCounts)
      .every((value) => value === 0),
    stale: latestActivityAt > 0
      && snapshot.observedAt - latestActivityAt >= 16 * 60 * 1000,
  });
  const failed = Object.freeze(
    Object.entries(checks)
      .filter(([, valid]) => !valid)
      .map(([name]) => name),
  );
  return deepFreeze({
    accepted: failed.length === 0,
    successful,
    orphanedRunning,
    latestActivityAt: latestActivityAt || null,
    failed,
  });
}

function exactOperationSnapshot(snapshot) {
  const { observedAt: _observedAt, targetCounts: _targetCounts, ...exact } = snapshot;
  return exact;
}

function diffPaths(before, after, prefix = '') {
  if (stableJson(before) === stableJson(after)) return Object.freeze([]);
  if (!isContainer(before) || !isContainer(after)
    || Array.isArray(before) !== Array.isArray(after)) {
    return Object.freeze([prefix || '$']);
  }
  const keys = [...new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])].sort();
  return Object.freeze(keys.flatMap((key) => diffPaths(
    before?.[key],
    after?.[key],
    prefix ? `${prefix}.${key}` : key,
  )));
}

function firstResultRow(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (Array.isArray(entry?.results) && entry.results[0]) return entry.results[0];
    }
    return null;
  }
  return Array.isArray(value?.results) ? value.results[0] ?? null : null;
}

function isContainer(value) {
  return value !== null && typeof value === 'object';
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function continuityError(message, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK2PreviewRetryContinuityError';
  error.code = 'META_K2_PREVIEW_RETRY_CONTINUITY_INVALID';
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
