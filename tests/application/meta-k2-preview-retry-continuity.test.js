import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifyMetaK2PreviewRetryContinuity,
  patchMetaK2RawSnapshotTargetCounts,
} from '../../scripts/lib/meta-k2-preview-retry-continuity.js';

const wrapper = new URL(
  '../../scripts/meta-k2-partial-staging-preview-continuity-retry.mjs',
  import.meta.url,
);
const hook = new URL(
  '../../scripts/meta-k2-preview-retry-continuity-hook.mjs',
  import.meta.url,
);

test('accepts only nondecreasing account-wide target count drift', () => {
  const prior = exactSnapshot();
  const current = exactSnapshot({
    observedAt: prior.observedAt + 2_004_159,
    targetCounts: {
      ...prior.targetCounts,
      adsEntities: prior.targetCounts.adsEntities + 7,
      adsDaily: prior.targetCounts.adsDaily + 31,
    },
  });
  const result = classifyMetaK2PreviewRetryContinuity(prior, current);
  assert.equal(result.accepted, true);
  assert.equal(result.targetCountOnlyDrift, true);
  assert.deepEqual(result.exactChangedFields, []);
  assert.equal(result.targetCountDelta.adsEntities, 7);
  assert.equal(result.targetCountDelta.adsDaily, 31);
  assert.deepEqual(result.targetCountRegressions, []);
});

test('rejects exact operation drift even when target counts are monotonic', () => {
  const prior = exactSnapshot();
  const current = exactSnapshot({
    observedAt: prior.observedAt + 2_004_159,
    syncRunUpdatedAt: prior.syncRunUpdatedAt + 1,
    targetCounts: {
      ...prior.targetCounts,
      adsEntities: prior.targetCounts.adsEntities + 1,
    },
  });
  const result = classifyMetaK2PreviewRetryContinuity(prior, current);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.exactChangedFields, ['syncRunUpdatedAt']);
});

test('rejects target count regression to preserve business facts', () => {
  const prior = exactSnapshot();
  const current = exactSnapshot({
    observedAt: prior.observedAt + 2_004_159,
    targetCounts: {
      ...prior.targetCounts,
      adsEntities: prior.targetCounts.adsEntities - 1,
    },
  });
  const result = classifyMetaK2PreviewRetryContinuity(prior, current);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.targetCountRegressions, ['adsEntities']);
});

test('patches only raw account-wide target counts for the unchanged legacy validator', () => {
  const raw = [{
    results: [{
      target_organic_state_count: 10,
      target_organic_observation_count: 20,
      target_account_daily_count: 30,
      target_ads_entity_count: 40,
      target_ads_daily_count: 50,
      operation_ads_daily_count: 0,
    }],
  }];
  const patched = patchMetaK2RawSnapshotTargetCounts(raw, {
    organicState: 1,
    organicObservations: 2,
    accountDaily: 3,
    adsEntities: 4,
    adsDaily: 5,
  });
  assert.equal(patched[0].results[0].target_ads_entity_count, 4);
  assert.equal(patched[0].results[0].target_ads_daily_count, 5);
  assert.equal(patched[0].results[0].operation_ads_daily_count, 0);
  assert.equal(raw[0].results[0].target_ads_entity_count, 40);
});

test('continuity wrapper and hook remain read-only and delegate to reviewed recovery', async () => {
  const [wrapperSource, hookSource] = await Promise.all([
    readFile(wrapper, 'utf8'),
    readFile(hook, 'utf8'),
  ]);
  assert.match(wrapperSource, /meta-k2-partial-staging-preview-attested-retry\.mjs/u);
  assert.match(wrapperSource, /--import=/u);
  assert.match(wrapperSource, /evidenceFileModified:\s*false/u);
  assert.doesNotMatch(wrapperSource, /wrangler['"],\s*['"]deploy/u);
  assert.doesNotMatch(wrapperSource, /wrangler['"],\s*['"]d1['"],\s*['"]execute/u);
  assert.match(hookSource, /syncBuiltinESMExports/u);
  assert.match(hookSource, /exactOperationDrift/u);
  assert.match(hookSource, /targetCountRegressions/u);
  assert.match(hookSource, /evidenceFileModified:\s*false/u);
  assert.doesNotMatch(hookSource, /writeFile|rename|rm\(/u);
});

function exactSnapshot(overrides = {}) {
  const base = {
    syncRunStatus: 'success',
    syncRunStartedAt: 10_000,
    syncRunFinishedAt: 20_000,
    syncRunErrorCode: null,
    syncRunRecordsWritten: 0,
    syncRunUpdatedAt: 30_000,
    workStatus: 'active',
    workLifecycleStatus: 'active',
    workCompletedAt: null,
    d1PhaseComplete: false,
    d1State: null,
    d1PhaseUpdatedAt: null,
    sourceStaging: {
      complete: false,
      updatedAt: 30_000,
      stage: 'daily',
      unitCount: 27,
      rowCount: 2601,
      pageNumber: 27,
      contentIndex: 0,
    },
    larkPhaseCount: 0,
    completionPhaseCount: 0,
    activeLockCount: 0,
    queueOperationAttempts: 1,
    mainQueueAttempts: 29,
    queueOperationUpdatedAt: 30_000,
    observedAt: 2_000_000,
    coverageRunCount: 0,
    invalidCoverageCount: 0,
    coverageEntityCount: 0,
    targetCounts: {
      organicState: 0,
      organicObservations: 0,
      accountDaily: 0,
      adsEntities: 100,
      adsDaily: 200,
    },
    operationCounts: {
      organicState: 0,
      organicObservations: 0,
      accountDaily: 0,
      adsEntities: 0,
      adsDaily: 0,
    },
  };
  return {
    ...base,
    ...overrides,
    sourceStaging: {
      ...base.sourceStaging,
      ...(overrides.sourceStaging ?? {}),
    },
    targetCounts: {
      ...base.targetCounts,
      ...(overrides.targetCounts ?? {}),
    },
    operationCounts: {
      ...base.operationCounts,
      ...(overrides.operationCounts ?? {}),
    },
  };
}
