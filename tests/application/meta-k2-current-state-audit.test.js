import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyMetaK2CurrentState,
  compareMetaK2CurrentStateSnapshots,
} from '../../scripts/lib/meta-k2-current-state-audit.js';

function snapshot(overrides = {}) {
  const base = {
    syncRunStatus: 'success',
    syncRunStartedAt: 1_785_000_000_000,
    syncRunFinishedAt: 1_785_000_100_000,
    syncRunErrorCode: null,
    syncRunRecordsWritten: 0,
    syncRunUpdatedAt: 1_785_000_100_000,
    workStatus: 'active',
    workLifecycleStatus: 'active',
    workCompletedAt: null,
    d1PhaseComplete: false,
    d1State: null,
    d1PhaseUpdatedAt: null,
    sourceStaging: {
      complete: false,
      updatedAt: 1_785_000_090_000,
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
    queueOperationUpdatedAt: 1_785_000_100_000,
    observedAt: 1_785_002_000_000,
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

test('classifies the retained partial source pre-D1 boundary without authorizing recovery', () => {
  const result = classifyMetaK2CurrentState(snapshot());
  assert.equal(result.boundary, 'partial_source_pre_d1');
  assert.equal(result.recoveryAuthorized, false);
  assert.equal(result.noDownstreamFacts, true);
  assert.equal(result.queueIdentityUnchanged, true);
});

test('classifies source-complete success before D1 as a distinct read-only boundary', () => {
  const result = classifyMetaK2CurrentState(snapshot({
    sourceStaging: {
      complete: true,
      stage: 'complete',
      unitCount: 31,
      rowCount: 3000,
      pageNumber: 31,
    },
  }));
  assert.equal(result.boundary, 'source_complete_pre_d1_success');
  assert.equal(result.sourceComplete, true);
  assert.equal(result.recoveryAuthorized, false);
});

test('classifies source-complete failure before D1 without hiding the error', () => {
  const result = classifyMetaK2CurrentState(snapshot({
    syncRunStatus: 'failed',
    syncRunErrorCode: 'META_PERMANENT_API_ERROR',
    sourceStaging: {
      complete: true,
      stage: 'complete',
      unitCount: 31,
      rowCount: 3000,
      pageNumber: 31,
    },
  }));
  assert.equal(result.boundary, 'source_complete_pre_d1_failed');
  assert.equal(result.snapshot.syncRunErrorCode, 'META_PERMANENT_API_ERROR');
  assert.equal(result.recoveryAuthorized, false);
});

test('classifies the accepted D1-complete Lark-pending boundary', () => {
  const result = classifyMetaK2CurrentState(snapshot({
    d1PhaseComplete: true,
    d1PhaseUpdatedAt: 1_785_000_200_000,
    coverageRunCount: 1,
    coverageEntityCount: 10,
    operationCounts: { adsEntities: 4, adsDaily: 31 },
  }));
  assert.equal(result.boundary, 'd1_complete_lark_pending');
  assert.equal(result.recoveryAuthorized, false);
});

test('reports a stable thirty-second read-only snapshot', () => {
  const before = snapshot({ observedAt: 1_785_002_000_000 });
  const after = snapshot({ observedAt: 1_785_002_031_000 });
  const result = compareMetaK2CurrentStateSnapshots(before, after);
  assert.equal(result.stable, true);
  assert.equal(result.elapsedMs, 31_000);
  assert.deepEqual(result.changedFields, []);
});

test('reports exact changed field names without adapting current state', () => {
  const before = snapshot({ observedAt: 1_785_002_000_000 });
  const after = snapshot({
    observedAt: 1_785_002_031_000,
    syncRunStatus: 'failed',
    syncRunErrorCode: 'META_PERMANENT_API_ERROR',
    sourceStaging: { complete: true, stage: 'complete' },
  });
  const result = compareMetaK2CurrentStateSnapshots(before, after);
  assert.equal(result.stable, false);
  assert.deepEqual(result.changedFields, [
    'sourceStaging.complete',
    'sourceStaging.stage',
    'syncRunErrorCode',
    'syncRunStatus',
  ]);
});
