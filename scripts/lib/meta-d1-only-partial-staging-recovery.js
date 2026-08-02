import {
  classifyMetaD1OnlyCompletion,
  normalizeMetaD1OnlySnapshot,
} from './meta-d1-only-rollout-operator.js';
import {
  META_K2_EXACT_RECOVERY_IDENTITY,
  META_K2_EXACT_RECOVERY_MODE,
  META_K2_EXACT_RECOVERY_MODE_ENV,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const META_K2_PARTIAL_STAGING_RECOVERY_CONTRACT_VERSION =
  'meta_k2_partial_staging_recovery_v1';
export const META_K2_PARTIAL_STAGING_RECOVERY_CONFIRMATION = Object.freeze({
  envName: META_K2_EXACT_RECOVERY_MODE_ENV,
  value: META_K2_EXACT_RECOVERY_MODE,
});
export const META_K2_PARTIAL_STAGING_EXACT_IDENTITY = META_K2_EXACT_RECOVERY_IDENTITY;

/**
 * Bind the recovery to the exact retained Chemistry K2 incident. The retained sync run may be
 * either a finished successful bounded invocation or the proven orphaned `running` record. A
 * running record is accepted only when it is stale, lock-free, zero-write and stable for 30 seconds.
 */
export function validateMetaK2ExactPartialStagingStability(beforeInput = {}, afterInput = {}) {
  const before = classifyExactPartialSnapshot(beforeInput);
  const after = classifyExactPartialSnapshot(afterInput);
  const elapsedMs = after.snapshot.observedAt - before.snapshot.observedAt;
  const stableBefore = { ...before.snapshot, observedAt: 0 };
  const stableAfter = { ...after.snapshot, observedAt: 0 };
  if (!before.accepted
    || !after.accepted
    || elapsedMs < 30_000
    || stableJson(stableBefore) !== stableJson(stableAfter)) {
    throw recoveryError(
      'Meta K2 exact partial staging changed during the stability window',
      'META_D1_ONLY_PARTIAL_STAGING_PROGRESS_OBSERVED',
      { elapsedMs },
    );
  }
  return deepFreeze({
    accepted: true,
    decision: 'META_K2_PARTIAL_STAGING_STABLE_SAFE_TO_PREPARE_RECOVERY',
    contractVersion: META_K2_PARTIAL_STAGING_RECOVERY_CONTRACT_VERSION,
    elapsedMs,
    orphanedRunningRecovery: after.orphanedRunningRecovery,
    successfulInvocationRecovery: after.successfulInvocationRecovery,
    snapshot: after.snapshot,
  });
}

/**
 * Verify direct use-case continuation without a Cloudflare Queue delivery. Queue operation rows and
 * attempt counters must remain byte-for-byte stable while the existing operation reaches D1 completion.
 */
export function compareMetaD1OnlyDirectContinuationSnapshots(
  beforeInput = {},
  afterInput = {},
  options = {},
) {
  const before = normalizeMetaD1OnlySnapshot(beforeInput);
  const after = normalizeMetaD1OnlySnapshot(afterInput);
  const rerun = options.rerun === true;

  assertQueueAttemptsUnchanged(before, after);
  if (!classifyMetaD1OnlyCompletion(after).complete) {
    throw recoveryError(
      'Meta direct continuation did not reach the accepted D1-only boundary',
      'META_D1_ONLY_DIRECT_CONTINUATION_INCOMPLETE',
    );
  }
  if (after.larkPhaseCount !== 0 || after.completionPhaseCount !== 0) {
    throw recoveryError(
      'Meta direct continuation crossed the D1-only Lark/completion boundary',
      'META_D1_ONLY_DIRECT_CONTINUATION_BOUNDARY_VIOLATED',
    );
  }
  if (after.invalidCoverageCount !== 0) {
    throw recoveryError(
      'Meta direct continuation produced invalid Coverage',
      'META_D1_ONLY_DIRECT_CONTINUATION_COVERAGE_INVALID',
    );
  }

  if (!rerun) {
    if (after.coverageRunCount < 1 || after.coverageEntityCount < 1) {
      throw recoveryError(
        'Meta direct continuation did not persist Coverage',
        'META_D1_ONLY_DIRECT_CONTINUATION_COVERAGE_MISSING',
      );
    }
    return deepFreeze({
      accepted: true,
      rerun: false,
      queueAttemptsUnchanged: true,
      before,
      after,
      targetCountDelta: subtractCounts(after.targetCounts, before.targetCounts),
      operationCounts: after.operationCounts,
      coverageRunCount: after.coverageRunCount,
      coverageEntityCount: after.coverageEntityCount,
    });
  }

  assertCountsUnchanged(before.targetCounts, after.targetCounts, 'target');
  assertCountsUnchanged(before.operationCounts, after.operationCounts, 'operation');
  if (after.coverageRunCount !== before.coverageRunCount
    || after.coverageEntityCount !== before.coverageEntityCount) {
    throw recoveryError(
      'Meta direct idempotent rerun changed Coverage counts',
      'META_D1_ONLY_DIRECT_RERUN_COVERAGE_DRIFT',
    );
  }
  return deepFreeze({
    accepted: true,
    rerun: true,
    queueAttemptsUnchanged: true,
    businessCountDrift: false,
    coverageCountDrift: false,
    before,
    after,
  });
}

export function assertMetaK2PartialStagingRecoveryConfirmation(env = {}) {
  const expected = META_K2_PARTIAL_STAGING_RECOVERY_CONFIRMATION;
  if (env?.[expected.envName] !== expected.value) {
    throw recoveryError(
      `Meta K2 partial-staging recovery requires ${expected.envName}=${expected.value}`,
      'META_K2_PARTIAL_STAGING_RECOVERY_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

function classifyExactPartialSnapshot(snapshotInput) {
  const snapshot = normalizeMetaD1OnlySnapshot(snapshotInput);
  const latestActivityAt = Math.max(
    snapshot.sourceStaging.updatedAt ?? 0,
    snapshot.syncRunUpdatedAt ?? 0,
    snapshot.queueOperationUpdatedAt ?? 0,
  );
  const successfulInvocationRecovery = snapshot.syncRunStatus === 'success'
    && snapshot.syncRunStartedAt !== null
    && snapshot.syncRunFinishedAt !== null
    && snapshot.syncRunErrorCode === null;
  const orphanedRunningRecovery = snapshot.syncRunStatus === 'running'
    && snapshot.syncRunStartedAt !== null
    && snapshot.syncRunFinishedAt === null
    && snapshot.syncRunErrorCode === null;
  const exactState = assertExactPartialSnapshot(snapshot, { throwOnFailure: false });
  const accepted = (successfulInvocationRecovery || orphanedRunningRecovery)
    && snapshot.syncRunRecordsWritten === 0
    && snapshot.workStatus === 'active'
    && snapshot.workLifecycleStatus === 'active'
    && snapshot.workCompletedAt === null
    && snapshot.sourceStaging.complete === false
    && latestActivityAt > 0
    && snapshot.observedAt - latestActivityAt >= 16 * 60 * 1000
    && exactState.accepted;
  return deepFreeze({
    accepted,
    successfulInvocationRecovery,
    orphanedRunningRecovery,
    latestActivityAt,
    snapshot,
    failed: exactState.failed,
  });
}

function assertExactPartialSnapshot(snapshot, options = {}) {
  const exact = META_K2_PARTIAL_STAGING_EXACT_IDENTITY;
  const checks = {
    sourceStage: snapshot.sourceStaging.stage === exact.sourceStage,
    sourceUnitCount: snapshot.sourceStaging.unitCount === exact.sourceUnitCount,
    sourceRowCount: snapshot.sourceStaging.rowCount === exact.sourceRowCount,
    sourcePageNumber: snapshot.sourceStaging.pageNumber === exact.sourcePageNumber,
    sourceContentIndex: snapshot.sourceStaging.contentIndex === exact.sourceContentIndex,
    queueOperationAttempts: snapshot.queueOperationAttempts === exact.queueOperationAttempts,
    mainQueueAttempts: snapshot.mainQueueAttempts === exact.mainQueueAttempts,
    activeLocks: snapshot.activeLockCount === 0,
    d1NotStarted: snapshot.d1PhaseComplete === false && snapshot.d1PhaseUpdatedAt === null,
    coverageNotStarted: snapshot.coverageRunCount === 0
      && snapshot.coverageEntityCount === 0
      && snapshot.invalidCoverageCount === 0,
    larkNotStarted: snapshot.larkPhaseCount === 0,
    completionNotStarted: snapshot.completionPhaseCount === 0,
    operationWritesZero: Object.values(snapshot.operationCounts).every((value) => value === 0),
  };
  const failed = Object.entries(checks)
    .filter(([, accepted]) => !accepted)
    .map(([name]) => name);
  if (failed.length > 0 && options.throwOnFailure !== false) {
    throw recoveryError(
      'Meta K2 partial-staging snapshot does not match the exact retained incident',
      'META_K2_PARTIAL_STAGING_EXACT_STATE_INVALID',
      { failed },
    );
  }
  return deepFreeze({ accepted: failed.length === 0, failed });
}

function assertQueueAttemptsUnchanged(before, after) {
  if (after.queueOperationAttempts !== before.queueOperationAttempts
    || after.mainQueueAttempts !== before.mainQueueAttempts) {
    throw recoveryError(
      'Meta direct continuation changed Queue operation attempts',
      'META_D1_ONLY_DIRECT_CONTINUATION_QUEUE_DRIFT',
      {
        beforeQueueOperationAttempts: before.queueOperationAttempts,
        afterQueueOperationAttempts: after.queueOperationAttempts,
        beforeMainQueueAttempts: before.mainQueueAttempts,
        afterMainQueueAttempts: after.mainQueueAttempts,
      },
    );
  }
}

function assertCountsUnchanged(before, after, scope) {
  for (const key of Object.keys(before)) {
    if (after[key] !== before[key]) {
      throw recoveryError(
        'Meta direct idempotent rerun changed Business counts',
        'META_D1_ONLY_DIRECT_RERUN_COUNT_DRIFT',
        { scope, field: key, before: before[key], after: after[key] },
      );
    }
  }
}

function subtractCounts(after, before) {
  return deepFreeze(Object.fromEntries(
    Object.keys(after).map((key) => [key, after[key] - before[key]]),
  ));
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

function recoveryError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
