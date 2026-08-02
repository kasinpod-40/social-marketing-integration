import {
  classifyMetaD1OnlyCompletion,
  normalizeMetaD1OnlySnapshot,
  validateMetaD1OnlyPartialStagingStability,
} from './meta-d1-only-rollout-operator.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const META_K2_PARTIAL_STAGING_RECOVERY_CONTRACT_VERSION =
  'meta_k2_partial_staging_recovery_v1';
export const META_K2_PARTIAL_STAGING_RECOVERY_CONFIRMATION = Object.freeze({
  envName: 'MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY',
  value: 'RECOVER_EXACT_PARTIAL_META_ADS_STAGING',
});
export const META_K2_PARTIAL_STAGING_EXACT_IDENTITY = Object.freeze({
  targetKey: 'chemistry_k2',
  sourceAccountKey: 'chemistry_k2',
  operationId: 'meta-chemistry_k2-history-20260701-20260731-f741090d1d8a',
  workKey:
    'meta_ads:chemistry_k2:meta-chemistry_k2-history-20260701-20260731-f741090d1d8a',
  syncRunId:
    'meta:meta_ads:chemistry_k2:meta-chemistry_k2-history-20260701-20260731-f741090d1d8a',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  sourceStage: 'daily',
  sourceUnitCount: 27,
  sourceRowCount: 2601,
  sourcePageNumber: 27,
  sourceContentIndex: 0,
  queueOperationAttempts: 1,
  mainQueueAttempts: 29,
});

/** Bind generic stability proof to the exact accepted Chemistry K2 incident. */
export function validateMetaK2ExactPartialStagingStability(beforeInput = {}, afterInput = {}) {
  const stability = validateMetaD1OnlyPartialStagingStability(beforeInput, afterInput);
  assertExactPartialSnapshot(stability.snapshot);
  return deepFreeze({
    accepted: true,
    decision: 'META_K2_PARTIAL_STAGING_STABLE_SAFE_TO_PREPARE_RECOVERY',
    contractVersion: META_K2_PARTIAL_STAGING_RECOVERY_CONTRACT_VERSION,
    elapsedMs: stability.elapsedMs,
    snapshot: stability.snapshot,
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

function assertExactPartialSnapshot(snapshot) {
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
    coverageNotStarted: snapshot.coverageRunCount === 0 && snapshot.coverageEntityCount === 0,
    larkNotStarted: snapshot.larkPhaseCount === 0,
    completionNotStarted: snapshot.completionPhaseCount === 0,
    operationWritesZero: Object.values(snapshot.operationCounts).every((value) => value === 0),
  };
  const failed = Object.entries(checks)
    .filter(([, accepted]) => !accepted)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw recoveryError(
      'Meta K2 partial-staging snapshot does not match the exact retained incident',
      'META_K2_PARTIAL_STAGING_EXACT_STATE_INVALID',
      { failed },
    );
  }
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

function recoveryError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
