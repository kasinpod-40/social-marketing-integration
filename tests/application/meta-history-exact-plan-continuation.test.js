import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_D1_ONLY_OPERATOR_PHASES,
  createMetaD1OnlyEvidence,
} from '../../scripts/lib/meta-d1-only-rollout-operator.js';
import {
  META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA,
  META_HISTORY_EXACT_CONTINUATION_CONFIRMATION,
  META_HISTORY_EXACT_CONTINUATION_TARGET,
  assertMetaHistoryExactContinuationConfirmation,
  materializeRetainedMetaD1Summary,
  validateMetaHistoryExactContinuationDelta,
  validateMetaHistoryExactContinuationPlan,
  validateMetaHistoryFacebookLarkBoundary,
  validateStableMetaHistoryFacebookBoundary,
} from '../../scripts/lib/meta-history-exact-plan-continuation.js';
import {
  validateMetaD1OnlySummaryForLark,
} from '../../scripts/lib/meta-lark-parity-rollout-operator.js';

const REQUIRED_RELEASE_PATHS = Object.freeze([
  '.github/workflows/branch-verification.yml',
  '.github/workflows/meta-end-to-end-verification.yml',
  'docs/current-task.md',
  'docs/tasks/chatwoot-final-source-config-recovery-v1.md',
  'docs/tasks/lark-dashboard-display-v2-compatibility-v1.md',
  'docs/tasks/meta-history-exact-plan-continuation-v1.md',
  'packages/application/src/reports/build-report-output-rows.js',
  'packages/config/src/lark-dashboard-display-v2-compatibility.js',
  'scripts/chatwoot-final-source-config-recovery-launcher.mjs',
  'scripts/lark-dashboard-display-v2-compatibility-backfill.mjs',
  'scripts/lib/chatwoot-final-source-config-recovery.js',
  'scripts/lib/lark-dashboard-display-v2-compatibility-v1.js',
  'scripts/lib/meta-history-exact-plan-continuation.js',
  'scripts/meta-history-2026-exact-plan-continuation-terminal.mjs',
  'scripts/meta-history-2026-exact-plan-continuation.mjs',
  'scripts/verify-meta-history-exact-plan-continuation-local.mjs',
  'tests/application/chatwoot-final-source-config-recovery.test.js',
  'tests/application/lark-dashboard-display-v2-writer.test.js',
  'tests/application/meta-history-2026-public-launcher.test.js',
  'tests/application/meta-history-exact-plan-continuation.test.js',
  'tests/application/meta-history-exact-plan-continuation-wiring.test.js',
  'tests/config/lark-dashboard-display-v2-compatibility.test.js',
  'tests/scripts/lark-dashboard-display-v2-compatibility-backfill.test.js',
]);

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

function validD1Evidence(options = {}) {
  const target = META_HISTORY_EXACT_CONTINUATION_TARGET;
  const targetFingerprint = 'a'.repeat(64);
  const expectedRequestedAt = Date.parse(target.originalRequestedAt);
  const planTarget = {
    repositoryHead: target.repositoryHead,
    targetKey: target.target,
    operationId: target.operationId,
    originalRequestedAt: expectedRequestedAt,
    generation: expectedRequestedAt,
    periodStart: target.periodStart,
    periodEnd: target.periodEnd,
    workKey: target.workKey,
    syncRunId: target.syncRunId,
    ...(options.targetOverrides ?? {}),
  };
  const includePlan = options.includePlan !== false;
  const phases = META_D1_ONLY_OPERATOR_PHASES.slice(includePlan ? 0 : 1, -1);
  const result = [];
  let previousEvidenceSha256 = includePlan
    ? null
    : (options.preflightPreviousEvidenceSha256 ?? null);
  for (const phase of phases) {
    const data = phase === 'plan' || phase === 'preflight'
      ? { target: planTarget }
      : phase === 'verify-restore'
        ? { mode: 'safe', expectedTrueFlags: [] }
        : {};
    const evidence = createMetaD1OnlyEvidence({
      phase,
      repositoryHead: target.repositoryHead,
      targetFingerprint,
      targetKey: target.target,
      operationId: target.operationId,
      previousEvidenceSha256,
      capturedAt: '2026-07-31T19:20:00.000Z',
      data,
      remoteMutationPerformed: false,
      businessWritesAllowed: false,
    });
    result.push(evidence);
    previousEvidenceSha256 = evidence.evidenceSha256;
  }
  return result;
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

test('exact continuation permits only the reviewed Dashboard, Chatwoot and continuation release paths', () => {
  for (const path of REQUIRED_RELEASE_PATHS) {
    assert.equal(
      META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA.includes(path),
      true,
      path,
    );
  }

  const accepted = validateMetaHistoryExactContinuationDelta([
    ...META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA,
  ].reverse());
  assert.equal(
    accepted.changedPathCount,
    META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA.length,
  );

  const missingOwnSource = META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA.filter(
    (path) => path !== 'scripts/meta-history-2026-exact-plan-continuation.mjs',
  );
  assert.throws(
    () => validateMetaHistoryExactContinuationDelta(missingOwnSource),
    (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_REPOSITORY_DELTA_INVALID',
  );

  const missingReviewedChatwootPath = META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA.filter(
    (path) => path !== 'scripts/chatwoot-final-source-config-recovery-launcher.mjs',
  );
  assert.throws(
    () => validateMetaHistoryExactContinuationDelta(missingReviewedChatwootPath),
    (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_REPOSITORY_DELTA_INVALID',
  );

  assert.throws(
    () => validateMetaHistoryExactContinuationDelta([
      ...META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA,
      'scripts/meta-lark-parity-rollout-operator.mjs',
    ]),
    (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_REPOSITORY_DELTA_INVALID',
  );
});

test('retained D1 summary is materialized from a complete plan-bound evidence chain', () => {
  const evidence = validD1Evidence();
  const summary = materializeRetainedMetaD1Summary(evidence, {
    capturedAt: '2026-08-01T03:30:00.000Z',
  });
  const accepted = validateMetaD1OnlySummaryForLark(summary, {
    targetKey: META_HISTORY_EXACT_CONTINUATION_TARGET.target,
    operationId: META_HISTORY_EXACT_CONTINUATION_TARGET.operationId,
  });

  assert.equal(summary.phase, 'summary');
  assert.equal(summary.data.accepted, true);
  assert.equal(summary.data.d1OnlyVerified, true);
  assert.equal(summary.data.idempotentRerunVerified, true);
  assert.equal(summary.data.restoredAllFalse, true);
  assert.equal(summary.data.evidenceChainStartPhase, 'plan');
  assert.equal(summary.data.planEvidencePresent, true);
  assert.equal(summary.remoteMutationPerformed, false);
  assert.equal(summary.businessWritesAllowed, false);
  assert.equal(accepted.operationId, META_HISTORY_EXACT_CONTINUATION_TARGET.operationId);

  assert.throws(
    () => materializeRetainedMetaD1Summary(evidence.slice(0, -1)),
    (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_D1_EVIDENCE_INCOMPLETE',
  );

  const invalidRestore = [...evidence];
  invalidRestore[invalidRestore.length - 1] = createMetaD1OnlyEvidence({
    phase: 'verify-restore',
    repositoryHead: META_HISTORY_EXACT_CONTINUATION_TARGET.repositoryHead,
    targetFingerprint: evidence[0].targetFingerprint,
    targetKey: META_HISTORY_EXACT_CONTINUATION_TARGET.target,
    operationId: META_HISTORY_EXACT_CONTINUATION_TARGET.operationId,
    previousEvidenceSha256: evidence.at(-2).evidenceSha256,
    capturedAt: '2026-07-31T19:20:00.000Z',
    data: { mode: 'active', expectedTrueFlags: ['MKT_META_D1_WRITE_ENABLED'] },
    remoteMutationPerformed: false,
    businessWritesAllowed: false,
  });
  assert.throws(
    () => materializeRetainedMetaD1Summary(invalidRestore),
    (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_D1_RESTORE_EVIDENCE_INVALID',
  );
});

test('retained D1 summary accepts the operator-supported preflight-anchored chain', () => {
  const evidence = validD1Evidence({ includePlan: false });
  const summary = materializeRetainedMetaD1Summary(evidence, {
    capturedAt: '2026-08-01T04:00:00.000Z',
  });
  validateMetaD1OnlySummaryForLark(summary, {
    targetKey: META_HISTORY_EXACT_CONTINUATION_TARGET.target,
    operationId: META_HISTORY_EXACT_CONTINUATION_TARGET.operationId,
  });

  assert.equal(summary.data.phaseCount, META_D1_ONLY_OPERATOR_PHASES.length - 2);
  assert.equal(summary.data.evidenceChainStartPhase, 'preflight');
  assert.equal(summary.data.planEvidencePresent, false);
  assert.equal(summary.data.evidenceChainHeadSha256, evidence.at(-1).evidenceSha256);
});

test('preflight-anchored recovery fails when a missing plan hash is still referenced', () => {
  const evidence = validD1Evidence({
    includePlan: false,
    preflightPreviousEvidenceSha256: 'b'.repeat(64),
  });
  assert.throws(
    () => materializeRetainedMetaD1Summary(evidence),
    (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_D1_PLAN_ANCHOR_MISSING',
  );
});

test('preflight-anchored recovery still requires the exact retained operation identity', () => {
  const evidence = validD1Evidence({
    includePlan: false,
    targetOverrides: { generation: Date.parse('2026-07-31T16:51:11.018Z') },
  });
  assert.throws(
    () => materializeRetainedMetaD1Summary(evidence),
    (error) => error?.code === 'META_HISTORY_EXACT_CONTINUATION_D1_EVIDENCE_TARGET_INVALID',
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
