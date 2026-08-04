import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  META_K2_SOURCE_COMPLETE_PREVIEW_CONFIRMATION,
  assertMetaK2SourceCompletePreviewConfirmation,
  transformMetaK2SourceCompleteController,
  validateMetaK2ExactSourceCompleteFailureStability,
} from '../../scripts/lib/meta-k2-source-complete-preview-recovery.js';

const BEFORE_OBSERVED_AT = 1785732176574;

function exactSnapshot(overrides = {}) {
  return {
    syncRunStatus: 'failed',
    syncRunStartedAt: 1785728496842,
    syncRunFinishedAt: 1785728534358,
    syncRunErrorCode: 'UNHANDLED_SYNC_ERROR',
    syncRunRecordsWritten: 0,
    syncRunUpdatedAt: 1785728534358,
    workStatus: 'active',
    workLifecycleStatus: 'active',
    workCompletedAt: null,
    sourceStaging: {
      complete: true,
      updatedAt: 1785728527046,
      stage: 'complete',
      unitCount: 43,
      rowCount: 4104,
      pageNumber: 0,
      contentIndex: 0,
    },
    d1PhaseComplete: false,
    d1State: null,
    d1PhaseUpdatedAt: null,
    larkPhaseCount: 0,
    completionPhaseCount: 0,
    activeLockCount: 0,
    queueOperationAttempts: 1,
    mainQueueAttempts: 29,
    queueOperationUpdatedAt: 1785667099928,
    observedAt: BEFORE_OBSERVED_AT,
    coverageRunCount: 0,
    invalidCoverageCount: 0,
    coverageEntityCount: 0,
    targetCounts: {
      organicState: 0,
      organicObservations: 0,
      accountDaily: 0,
      adsEntities: 0,
      adsDaily: 0,
    },
    operationCounts: {
      organicState: 0,
      organicObservations: 0,
      accountDaily: 0,
      adsEntities: 0,
      adsDaily: 0,
    },
    ...overrides,
  };
}

function afterSnapshot(overrides = {}) {
  return exactSnapshot({ observedAt: BEFORE_OBSERVED_AT + 38_405, ...overrides });
}

function partialSnapshot(overrides = {}) {
  const counts = {
    organicState: 0,
    organicObservations: 0,
    accountDaily: 0,
    adsEntities: 26,
    adsDaily: 0,
  };
  return exactSnapshot({
    syncRunStatus: 'running',
    syncRunStartedAt: 1785757855080,
    syncRunFinishedAt: null,
    syncRunErrorCode: null,
    syncRunUpdatedAt: 1785757862680,
    targetCounts: counts,
    operationCounts: { ...counts },
    observedAt: 1785758496790,
    ...overrides,
  });
}

function d1CompleteSnapshot(overrides = {}) {
  const counts = {
    organicState: 0,
    organicObservations: 0,
    accountDaily: 0,
    adsEntities: 182,
    adsDaily: 4103,
  };
  return exactSnapshot({
    syncRunStatus: 'success',
    syncRunStartedAt: 1785766562039,
    syncRunFinishedAt: 1785766564114,
    syncRunErrorCode: null,
    syncRunRecordsWritten: 0,
    syncRunUpdatedAt: 1785766564114,
    d1PhaseComplete: true,
    d1PhaseUpdatedAt: 1785766558619,
    coverageRunCount: 5,
    coverageEntityCount: 4285,
    targetCounts: counts,
    operationCounts: { ...counts },
    observedAt: 1785769599090,
    ...overrides,
  });
}

function larkPreflightFailedSnapshot(overrides = {}) {
  return d1CompleteSnapshot({
    syncRunStatus: 'failed',
    syncRunStartedAt: 1785771000000,
    syncRunFinishedAt: 1785771003000,
    syncRunErrorCode: 'LARK_PREFLIGHT_FAILED',
    syncRunUpdatedAt: 1785771003000,
    observedAt: 1785772000000,
    ...overrides,
  });
}

test('accepts the stable exact source-complete pre-D1 failed boundary', () => {
  const result = validateMetaK2ExactSourceCompleteFailureStability(
    exactSnapshot(),
    afterSnapshot(),
  );
  assert.equal(result.accepted, true);
  assert.equal(result.boundary, 'source_complete_pre_d1_failed');
  assert.equal(result.elapsedMs, 38_405);
  assert.equal(result.providerReplayAuthorized, false);
  assert.equal(result.queueSendAuthorized, false);
  assert.equal(result.lifecycleSqlRepairAuthorized, false);
  assert.equal(result.existingBusinessFactsRetained, false);
  assert.equal(result.snapshot.sourceStaging.unitCount, 43);
  assert.equal(result.snapshot.sourceStaging.rowCount, 4104);
});

test('accepts only the exact stable 26-entity partial D1 resume boundary', () => {
  const before = partialSnapshot();
  const after = partialSnapshot({ observedAt: before.observedAt + 22_991 });
  const result = validateMetaK2ExactSourceCompleteFailureStability(before, after);
  assert.equal(result.accepted, true);
  assert.equal(result.boundary, 'd1_partial_entities_complete');
  assert.equal(result.elapsedMs, 22_991);
  assert.equal(result.existingBusinessFactsRetained, true);
  assert.equal(result.providerReplayAuthorized, false);
  assert.equal(result.queueSendAuthorized, false);
  assert.equal(result.lifecycleSqlRepairAuthorized, false);
  assert.equal(result.snapshot.targetCounts.adsEntities, 26);
  assert.equal(result.snapshot.targetCounts.adsDaily, 0);
});

test('accepts exact stable D1-complete Lark-pending facts without hardcoded entity count', () => {
  const before = d1CompleteSnapshot();
  const after = d1CompleteSnapshot({ observedAt: before.observedAt + 34_052 });
  const result = validateMetaK2ExactSourceCompleteFailureStability(before, after);
  assert.equal(result.accepted, true);
  assert.equal(result.boundary, 'd1_complete_lark_pending');
  assert.equal(result.d1AlreadyComplete, true);
  assert.equal(result.existingBusinessFactsRetained, true);
  assert.equal(
    result.decision,
    'META_K2_D1_COMPLETE_LARK_PENDING_STABLE_SAFE_TO_RESUME_EXACT_OPERATION',
  );
  assert.equal(result.snapshot.targetCounts.adsEntities, 182);
  assert.equal(result.snapshot.targetCounts.adsDaily, 4103);
  assert.equal(result.snapshot.coverageRunCount, 5);
  assert.equal(result.snapshot.coverageEntityCount, 4285);
  assert.equal(result.providerReplayAuthorized, false);
  assert.equal(result.queueSendAuthorized, false);
});

test('accepts exact terminal Lark preflight failure without reopening D1', () => {
  const before = larkPreflightFailedSnapshot();
  const after = larkPreflightFailedSnapshot({ observedAt: before.observedAt + 34_052 });
  const result = validateMetaK2ExactSourceCompleteFailureStability(before, after);

  assert.equal(result.accepted, true);
  assert.equal(result.boundary, 'd1_complete_lark_preflight_failed');
  assert.equal(result.d1AlreadyComplete, true);
  assert.equal(result.larkPreflightRecovery, true);
  assert.equal(result.existingBusinessFactsRetained, true);
  assert.equal(
    result.decision,
    'META_K2_D1_COMPLETE_LARK_PREFLIGHT_FAILED_STABLE_SAFE_TO_RESUME_EXACT_OPERATION',
  );
  assert.equal(result.snapshot.operationCounts.adsEntities, 182);
  assert.equal(result.snapshot.operationCounts.adsDaily, 4103);
  assert.equal(result.providerReplayAuthorized, false);
  assert.equal(result.queueSendAuthorized, false);
  assert.equal(result.lifecycleSqlRepairAuthorized, false);
});

test('rejects exact-state drift, unsupported facts and a short stability window', () => {
  assert.throws(
    () => validateMetaK2ExactSourceCompleteFailureStability(
      exactSnapshot(),
      afterSnapshot({ syncRunStatus: 'success' }),
    ),
    (error) => error?.code === 'META_K2_SOURCE_COMPLETE_PROGRESS_OBSERVED'
      && error?.details?.afterFailedChecks?.includes('syncRunStatus'),
  );
  assert.throws(
    () => validateMetaK2ExactSourceCompleteFailureStability(
      partialSnapshot(),
      partialSnapshot({
        observedAt: partialSnapshot().observedAt + 22_991,
        operationCounts: {
          ...partialSnapshot().operationCounts,
          adsDaily: 1,
        },
      }),
    ),
    (error) => error?.code === 'META_K2_SOURCE_COMPLETE_PROGRESS_OBSERVED',
  );
  assert.throws(
    () => validateMetaK2ExactSourceCompleteFailureStability(
      d1CompleteSnapshot(),
      d1CompleteSnapshot({
        observedAt: d1CompleteSnapshot().observedAt + 34_052,
        operationCounts: {
          ...d1CompleteSnapshot().operationCounts,
          adsDaily: 4102,
        },
      }),
    ),
    (error) => error?.code === 'META_K2_SOURCE_COMPLETE_PROGRESS_OBSERVED'
      && error?.details?.afterFailedChecks?.includes('operationTargetParity'),
  );
  assert.throws(
    () => validateMetaK2ExactSourceCompleteFailureStability(
      d1CompleteSnapshot(),
      d1CompleteSnapshot({
        observedAt: d1CompleteSnapshot().observedAt + 34_052,
        coverageEntityCount: 4284,
      }),
    ),
    (error) => error?.code === 'META_K2_SOURCE_COMPLETE_PROGRESS_OBSERVED'
      && error?.details?.afterFailedChecks?.includes('coverageEntityParity'),
  );
  assert.throws(
    () => validateMetaK2ExactSourceCompleteFailureStability(
      larkPreflightFailedSnapshot(),
      larkPreflightFailedSnapshot({
        observedAt: larkPreflightFailedSnapshot().observedAt + 34_052,
        syncRunErrorCode: 'OTHER_FAILURE',
      }),
    ),
    (error) => error?.code === 'META_K2_SOURCE_COMPLETE_PROGRESS_OBSERVED'
      && error?.details?.afterFailedChecks?.includes('acceptedSyncRunStatus'),
  );
  assert.throws(
    () => validateMetaK2ExactSourceCompleteFailureStability(
      exactSnapshot(),
      exactSnapshot({ observedAt: BEFORE_OBSERVED_AT + 19_999 }),
    ),
    (error) => error?.code === 'META_K2_SOURCE_COMPLETE_PROGRESS_OBSERVED',
  );
});

test('requires the dedicated source-complete confirmation', () => {
  assert.equal(assertMetaK2SourceCompletePreviewConfirmation({
    [META_K2_SOURCE_COMPLETE_PREVIEW_CONFIRMATION.envName]:
      META_K2_SOURCE_COMPLETE_PREVIEW_CONFIRMATION.value,
  }), true);
  assert.throws(
    () => assertMetaK2SourceCompletePreviewConfirmation({}),
    (error) => error?.code === 'META_K2_SOURCE_COMPLETE_PREVIEW_CONFIRMATION_REQUIRED',
  );
});

test('hash-pinned transform reuses existing controllers without changing disk source', async () => {
  const outerUrl = new URL(
    '../../scripts/meta-k2-partial-staging-preview-recovery.mjs',
    import.meta.url,
  );
  const finalizerUrl = new URL(
    '../../scripts/meta-k2-partial-staging-preview-finalizer.mjs',
    import.meta.url,
  );
  const [outerBefore, finalizerBefore] = await Promise.all([
    readFile(outerUrl, 'utf8'),
    readFile(finalizerUrl, 'utf8'),
  ]);

  const outer = transformMetaK2SourceCompleteController(outerUrl.href, outerBefore);
  const finalizer = transformMetaK2SourceCompleteController(
    finalizerUrl.href,
    finalizerBefore,
  );

  assert.equal(outer.changed, true);
  assert.match(
    outer.source,
    /meta-k2-source-complete-preview-finalizer-bootstrap\.mjs/u,
  );
  assert.match(outer.source, /exact-source-complete-pre-d1-recovery-v1/u);
  assert.match(outer.source, /source-complete-recovery-boundary/u);
  assert.match(outer.source, /d1_complete_lark_pending/u);
  assert.doesNotMatch(outer.source, /currentStage = 'archive-retryable-failure'/u);

  assert.equal(finalizer.changed, true);
  assert.match(
    finalizer.source,
    /validateMetaK2ExactSourceCompleteFailureStability/u,
  );
  assert.match(finalizer.source, /exact-source-complete-pre-d1-recovery-v1/u);
  assert.match(
    finalizer.source,
    /MKT_META_D1_ONLY_TERMINAL_RECOVERY: 'RECOVER_EXACT_FAILED_META_OPERATION'/u,
  );
  assert.match(finalizer.source, /controller\.abort\(\), 300_000/u);
  assert.doesNotMatch(finalizer.source, /controller\.abort\(\), 120_000/u);
  assert.doesNotMatch(
    finalizer.source,
    /const stability = validateMetaK2ExactPartialStagingStability\(/u,
  );

  const [outerAfter, finalizerAfter] = await Promise.all([
    readFile(outerUrl, 'utf8'),
    readFile(finalizerUrl, 'utf8'),
  ]);
  assert.equal(outerAfter, outerBefore);
  assert.equal(finalizerAfter, finalizerBefore);

  assert.throws(
    () => transformMetaK2SourceCompleteController(
      outerUrl.href,
      `${outerBefore}\n`,
    ),
    (error) => error?.code === 'META_K2_SOURCE_COMPLETE_CONTROLLER_SOURCE_DRIFT',
  );
});

test('new wiring uses a module loader and contains no direct Remote mutation implementation', async () => {
  const paths = [
    '../../scripts/lib/meta-k2-source-complete-preview-loader.mjs',
    '../../scripts/meta-k2-source-complete-preview-recovery.mjs',
    '../../scripts/meta-k2-source-complete-preview-finalizer-bootstrap.mjs',
  ];
  const sources = await Promise.all(paths.map((path) => (
    readFile(new URL(path, import.meta.url), 'utf8')
  )));
  const [loader, wrapper, bootstrap] = sources;
  assert.match(wrapper, /register\(/u);
  assert.match(
    wrapper,
    /import\('\.\/meta-k2-partial-staging-preview-recovery\.mjs'\)/u,
  );
  assert.match(bootstrap, /register\(/u);
  assert.match(
    bootstrap,
    /import\('\.\/meta-k2-partial-staging-preview-finalizer\.mjs'\)/u,
  );
  assert.match(loader, /transformMetaK2SourceCompleteController/u);
  for (const source of sources) {
    assert.doesNotMatch(source, /wrangler[\s\S]{0,80}\bdeploy\b/iu);
    assert.doesNotMatch(source, /['"`]\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu);
    assert.doesNotMatch(source, /\bd1\s+execute\b/iu);
    assert.doesNotMatch(source, /queue\s*\.\s*send\s*\(/iu);
    assert.doesNotMatch(source, /fetch\s*\(/iu);
  }
});
