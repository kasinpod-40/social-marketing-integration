import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA,
  META_HISTORY_EXACT_CONTINUATION_CONFIRMATION,
  META_HISTORY_EXACT_CONTINUATION_TARGET,
  assertMetaHistoryExactContinuationConfirmation,
  validateMetaHistoryExactContinuationDelta,
  validateMetaHistoryExactContinuationPlan,
  validateMetaHistoryFacebookLarkBoundary,
  validateStableMetaHistoryFacebookBoundary,
} from '../../scripts/lib/meta-history-exact-plan-continuation.js';

function validPlan() {
  return {
    repositoryHead: META_HISTORY_EXACT_CONTINUATION_TARGET.repositoryHead,
    operations: [{ ...META_HISTORY_EXACT_CONTINUATION_TARGET }],
  };
}

function validBoundary(overrides = {}) {
  return {
    sync_run_status: 'success',
    sync_run_finished_at: 1785517279165,
    sync_run_error_code: null,
    work_status: 'active',
    work_lifecycle_status: 'active',
    work_completed_at: null,
    d1_phase_complete: 1,
    preflight_phase_complete: null,
    lark_phase_complete: null,
    completion_phase_complete: null,
    active_lock_count: 0,
    queue_operation_attempts: 1,
    main_queue_attempts: 30,
    coverage_run_count: 2,
    invalid_coverage_count: 0,
    ...overrides,
  };
}

test('exact continuation requires the explicit one-time confirmation', () => {
  assert.throws(
    () => assertMetaHistoryExactContinuationConfirmation({}),
    (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_CONFIRMATION_REQUIRED',
  );
  assert.equal(
    assertMetaHistoryExactContinuationConfirmation({
      [META_HISTORY_EXACT_CONTINUATION_CONFIRMATION.envName]:
        META_HISTORY_EXACT_CONTINUATION_CONFIRMATION.value,
    }),
    true,
  );
});

test('exact continuation locks the retained Head, operation ID, generation and range', () => {
  const operation = validateMetaHistoryExactContinuationPlan(validPlan());
  assert.equal(operation.operationId, META_HISTORY_EXACT_CONTINUATION_TARGET.operationId);
  assert.equal(operation.originalRequestedAt, '2026-07-31T16:51:11.017Z');

  const drift = validPlan();
  drift.operations[0].originalRequestedAt = '2026-07-31T16:51:11.018Z';
  assert.throws(
    () => validateMetaHistoryExactContinuationPlan(drift),
    (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_OPERATION_DRIFT',
  );
});

test('exact continuation permits only the reviewed unrelated Dashboard delta', () => {
  const accepted = validateMetaHistoryExactContinuationDelta([
    ...META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA,
  ].reverse());
  assert.equal(
    accepted.changedPathCount,
    META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA.length,
  );

  assert.throws(
    () => validateMetaHistoryExactContinuationDelta([
      ...META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA,
      'scripts/meta-lark-parity-rollout-operator.mjs',
    ]),
    (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_REPOSITORY_DELTA_INVALID',
  );
});

test('exact continuation accepts only D1-complete Lark-pending Facebook state', () => {
  const boundary = validateMetaHistoryFacebookLarkBoundary(validBoundary());
  assert.equal(boundary.d1PhaseComplete, 1);
  assert.equal(boundary.larkPhaseComplete, 0);
  assert.equal(boundary.queueOperationAttempts, 1);

  for (const invalid of [
    validBoundary({ d1_phase_complete: 0 }),
    validBoundary({ lark_phase_complete: 1 }),
    validBoundary({ active_lock_count: 1 }),
    validBoundary({ queue_operation_attempts: 2 }),
    validBoundary({ invalid_coverage_count: 1 }),
    validBoundary({ work_lifecycle_status: 'completed' }),
  ]) {
    assert.throws(
      () => validateMetaHistoryFacebookLarkBoundary(invalid),
      (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_REMOTE_BOUNDARY_INVALID',
    );
  }
});

test('exact continuation requires two identical read-only boundary snapshots', () => {
  const stable = validateStableMetaHistoryFacebookBoundary(
    validBoundary(),
    validBoundary(),
  );
  assert.equal(stable.stable, true);
  assert.match(stable.fingerprint, /^[0-9a-f]{64}$/u);

  assert.throws(
    () => validateStableMetaHistoryFacebookBoundary(
      validBoundary(),
      validBoundary({ main_queue_attempts: 31 }),
    ),
    (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_REMOTE_BOUNDARY_MOVING',
  );
});
