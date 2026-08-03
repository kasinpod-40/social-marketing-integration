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

test('accepts only the stable exact source-complete pre-D1 failed boundary', () => {
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
  assert.equal(result.snapshot.sourceStaging.unitCount, 43);
  assert.equal(result.snapshot.sourceStaging.rowCount, 4104);
});

test('rejects exact-state drift, new facts and a short stability window', () => {
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
      exactSnapshot(),
      afterSnapshot({
        operationCounts: {
          ...exactSnapshot().operationCounts,
          adsDaily: 1,
        },
      }),
    ),
    (error) => error?.code === 'META_K2_SOURCE_COMPLETE_PROGRESS_OBSERVED'
      && error?.details?.afterFailedChecks?.includes('operationCounts'),
  );
  assert.throws(
    () => validateMetaK2ExactSourceCompleteFailureStability(
      exactSnapshot(),
      exactSnapshot({ observedAt: BEFORE_OBSERVED_AT + 29_999 }),
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

test('new wiring uses a module loader and contains no Remote mutation implementation', async () => {
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
    assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu);
    assert.doesNotMatch(source, /queue\s*\.\s*send\s*\(/iu);
    assert.doesNotMatch(source, /fetch\s*\(/iu);
  }
});
