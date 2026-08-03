import {
  META_K2_EXACT_RECOVERY_IDENTITY,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import {
  classifyMetaD1OnlyCompletion,
  normalizeMetaD1OnlySnapshot,
} from './meta-d1-only-rollout-operator.js';

export const META_K2_CURRENT_STATE_AUDIT_CONTRACT_VERSION =
  'meta_k2_current_state_audit_v1';

const EXACT = META_K2_EXACT_RECOVERY_IDENTITY;

/**
 * Classify the current durable boundary without authorizing a recovery action.
 * This intentionally reports state only; every mutation path requires a separate reviewed contract.
 */
export function classifyMetaK2CurrentState(snapshotInput = {}) {
  const snapshot = normalizeMetaD1OnlySnapshot(snapshotInput);
  const operationWriteCount = Object.values(snapshot.operationCounts)
    .reduce((sum, value) => sum + Number(value ?? 0), 0);
  const queueIdentityUnchanged = snapshot.queueOperationAttempts
      === EXACT.queueOperationAttempts
    && snapshot.mainQueueAttempts === EXACT.mainQueueAttempts;
  const noDownstreamFacts = snapshot.d1PhaseComplete === false
    && snapshot.d1PhaseUpdatedAt === null
    && snapshot.coverageRunCount === 0
    && snapshot.coverageEntityCount === 0
    && snapshot.invalidCoverageCount === 0
    && snapshot.larkPhaseCount === 0
    && snapshot.completionPhaseCount === 0
    && operationWriteCount === 0;
  const workOpen = snapshot.workStatus === 'active'
    && snapshot.workLifecycleStatus === 'active'
    && snapshot.workCompletedAt === null;
  const lockFree = snapshot.activeLockCount === 0;
  const sourceComplete = snapshot.sourceStaging.complete === true
    && snapshot.sourceStaging.stage === 'complete';
  const sourceIncomplete = snapshot.sourceStaging.complete === false
    && snapshot.sourceStaging.stage !== null
    && snapshot.sourceStaging.stage !== 'complete';

  let boundary = 'unknown_unsafe';
  if (classifyMetaD1OnlyCompletion(snapshot).complete) {
    boundary = 'd1_complete_lark_pending';
  } else if (snapshot.completionPhaseCount > 0 || snapshot.workCompletedAt !== null) {
    boundary = 'completion_present';
  } else if (sourceComplete && noDownstreamFacts && workOpen && lockFree) {
    if (snapshot.syncRunStatus === 'success'
      && snapshot.syncRunFinishedAt !== null
      && snapshot.syncRunErrorCode === null) {
      boundary = 'source_complete_pre_d1_success';
    } else if (snapshot.syncRunStatus === 'failed'
      && snapshot.syncRunFinishedAt !== null
      && snapshot.syncRunErrorCode !== null) {
      boundary = 'source_complete_pre_d1_failed';
    } else if (snapshot.syncRunStatus === 'running'
      && snapshot.syncRunFinishedAt === null
      && snapshot.syncRunErrorCode === null) {
      boundary = 'source_complete_pre_d1_running';
    }
  } else if (sourceIncomplete && noDownstreamFacts && workOpen && lockFree) {
    boundary = 'partial_source_pre_d1';
  }

  return deepFreeze({
    contractVersion: META_K2_CURRENT_STATE_AUDIT_CONTRACT_VERSION,
    boundary,
    recoveryAuthorized: false,
    queueIdentityUnchanged,
    noDownstreamFacts,
    operationWriteCount,
    sourceComplete,
    sourceIncomplete,
    workOpen,
    lockFree,
    snapshot: safeMetaK2CurrentSnapshot(snapshot),
  });
}

/** Compare two read-only snapshots while excluding only the observation timestamp. */
export function compareMetaK2CurrentStateSnapshots(beforeInput = {}, afterInput = {}) {
  const before = safeMetaK2CurrentSnapshot(normalizeMetaD1OnlySnapshot(beforeInput));
  const after = safeMetaK2CurrentSnapshot(normalizeMetaD1OnlySnapshot(afterInput));
  const beforeComparable = { ...before, observedAt: 0 };
  const afterComparable = { ...after, observedAt: 0 };
  const changedFields = diffFields(beforeComparable, afterComparable);
  const elapsedMs = after.observedAt - before.observedAt;
  return deepFreeze({
    stable: elapsedMs >= 30_000 && changedFields.length === 0,
    elapsedMs,
    changedFields,
    before,
    after,
  });
}

export function safeMetaK2CurrentSnapshot(snapshotInput = {}) {
  const snapshot = normalizeMetaD1OnlySnapshot(snapshotInput);
  return deepFreeze({
    syncRunStatus: snapshot.syncRunStatus,
    syncRunStartedAt: snapshot.syncRunStartedAt,
    syncRunFinishedAt: snapshot.syncRunFinishedAt,
    syncRunErrorCode: snapshot.syncRunErrorCode,
    syncRunRecordsWritten: snapshot.syncRunRecordsWritten,
    syncRunUpdatedAt: snapshot.syncRunUpdatedAt,
    workStatus: snapshot.workStatus,
    workLifecycleStatus: snapshot.workLifecycleStatus,
    workCompletedAt: snapshot.workCompletedAt,
    sourceStaging: {
      complete: snapshot.sourceStaging.complete,
      updatedAt: snapshot.sourceStaging.updatedAt,
      stage: snapshot.sourceStaging.stage,
      unitCount: snapshot.sourceStaging.unitCount,
      rowCount: snapshot.sourceStaging.rowCount,
      pageNumber: snapshot.sourceStaging.pageNumber,
      contentIndex: snapshot.sourceStaging.contentIndex,
    },
    d1PhaseComplete: snapshot.d1PhaseComplete,
    d1PhaseUpdatedAt: snapshot.d1PhaseUpdatedAt,
    larkPhaseCount: snapshot.larkPhaseCount,
    completionPhaseCount: snapshot.completionPhaseCount,
    activeLockCount: snapshot.activeLockCount,
    queueOperationAttempts: snapshot.queueOperationAttempts,
    mainQueueAttempts: snapshot.mainQueueAttempts,
    queueOperationUpdatedAt: snapshot.queueOperationUpdatedAt,
    coverageRunCount: snapshot.coverageRunCount,
    coverageEntityCount: snapshot.coverageEntityCount,
    invalidCoverageCount: snapshot.invalidCoverageCount,
    targetCounts: { ...snapshot.targetCounts },
    operationCounts: { ...snapshot.operationCounts },
    observedAt: snapshot.observedAt,
  });
}

function diffFields(before, after, prefix = '') {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changed = [];
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const left = before[key];
    const right = after[key];
    if (isPlainObject(left) && isPlainObject(right)) {
      changed.push(...diffFields(left, right, path));
    } else if (stableJson(left) !== stableJson(right)) {
      changed.push(path);
    }
  }
  return changed;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
