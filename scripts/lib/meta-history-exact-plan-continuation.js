import { createHash } from 'node:crypto';

export const META_HISTORY_EXACT_CONTINUATION_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_META_HISTORY_EXACT_CONTINUATION',
  value: 'CONTINUE_META_HISTORY_FROM_FACEBOOK_LARK_BOUNDARY',
});

export const META_HISTORY_EXACT_CONTINUATION_TARGET = Object.freeze({
  repositoryHead: '5ff8e2cfb1f890ac2a8f2867a904b477c6456d91',
  target: 'facebook',
  operationId: 'meta-facebook-history-20260701-20260731-1d12a5ec4fef',
  workKey: 'facebook:meta-facebook-history-20260701-20260731-1d12a5ec4fef',
  syncRunId: 'meta:facebook:facebook:meta-facebook-history-20260701-20260731-1d12a5ec4fef',
  originalRequestedAt: '2026-07-31T16:51:11.017Z',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  mode: 'required',
});

export const META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA = Object.freeze([
  'docs/project-brain/report-metric-value-field-migration.md',
  'docs/tasks/lark-dashboard-compatibility-freeze-v1.md',
  'scripts/lark-dashboard-compatibility-freeze-audit.mjs',
  'scripts/lark-dashboard-compatibility-record-backfill.mjs',
  'scripts/lark-dashboard-field-identity-recovery-terminal-v3.mjs',
  'scripts/lark-dashboard-field-identity-recovery-v3.mjs',
  'scripts/lib/lark-dashboard-compatibility-freeze-v1.js',
  'tests/scripts/lark-dashboard-compatibility-record-backfill.test.js',
  'tests/scripts/lark-dashboard-field-identity-recovery-v3.test.js',
  'tests/scripts/lark-dashboard-window-chart-rebind-v3-2.test.js',
]);

export const META_HISTORY_EXACT_CONTINUATION_CRITICAL_PATHS = Object.freeze([
  'apps/sync-worker/src/index.js',
  'packages/application/src/jobs/queue-operation.js',
  'packages/config/src/meta-end-to-end-runtime-config.js',
  'packages/config/src/lark-table-config.js',
  'packages/connectors/src/lark/lark-bitable.client.js',
  'scripts/meta-history-2026-terminal.mjs',
  'scripts/meta-history-2026-one-command.mjs',
  'scripts/meta-history-2026-finalizer.mjs',
  'scripts/meta-d1-only-rollout-launcher.mjs',
  'scripts/meta-d1-only-rollout-operator.mjs',
  'scripts/meta-lark-parity-rollout-launcher.mjs',
  'scripts/meta-lark-parity-rollout-operator.mjs',
  'scripts/lib/meta-d1-only-rollout-operator.js',
  'scripts/lib/meta-history-2026-finalizer.js',
  'scripts/lib/meta-history-runtime-authority.js',
  'scripts/lib/meta-lark-parity-rollout-operator.js',
]);

export function assertMetaHistoryExactContinuationConfirmation(env = {}) {
  const contract = META_HISTORY_EXACT_CONTINUATION_CONFIRMATION;
  if (env?.[contract.envName] !== contract.value) {
    throw continuationError(
      `Meta history exact continuation requires ${contract.envName}=${contract.value}`,
      'META_HISTORY_EXACT_CONTINUATION_CONFIRMATION_REQUIRED',
      { envName: contract.envName },
    );
  }
  return true;
}

export function validateMetaHistoryExactContinuationPlan(plan = {}) {
  const target = META_HISTORY_EXACT_CONTINUATION_TARGET;
  if (plan?.repositoryHead !== target.repositoryHead || !Array.isArray(plan?.operations)) {
    throw continuationError(
      'Persisted Meta history runtime plan does not match the retained Repository Head',
      'META_HISTORY_EXACT_CONTINUATION_PLAN_INVALID',
    );
  }
  const operation = plan.operations.find((item) => item?.operationId === target.operationId);
  if (!operation) {
    throw continuationError(
      'Retained Facebook operation is missing from the persisted runtime plan',
      'META_HISTORY_EXACT_CONTINUATION_OPERATION_MISSING',
    );
  }
  for (const field of [
    'target',
    'operationId',
    'originalRequestedAt',
    'periodStart',
    'periodEnd',
    'mode',
  ]) {
    if (operation[field] !== target[field]) {
      throw continuationError(
        'Retained Facebook operation identity differs from the reviewed continuation',
        'META_HISTORY_EXACT_CONTINUATION_OPERATION_DRIFT',
        { field },
      );
    }
  }
  return Object.freeze({ ...operation });
}

export function validateMetaHistoryExactContinuationDelta(changedPaths = []) {
  const observed = [...new Set(changedPaths.map(requirePath))].sort();
  const allowed = [...META_HISTORY_EXACT_CONTINUATION_ALLOWED_DELTA].sort();
  if (JSON.stringify(observed) !== JSON.stringify(allowed)) {
    const unreviewed = observed.filter((path) => !allowed.includes(path));
    const missing = allowed.filter((path) => !observed.includes(path));
    throw continuationError(
      'Repository delta from the retained Meta Head is not the exact reviewed unrelated Dashboard change',
      'META_HISTORY_EXACT_CONTINUATION_REPOSITORY_DELTA_INVALID',
      { unreviewed, missing },
    );
  }
  return Object.freeze({
    changedPathCount: observed.length,
    changedPathFingerprint: sha256(JSON.stringify(observed)),
  });
}

export function validateMetaHistoryFacebookLarkBoundary(snapshot = {}) {
  const exact = snapshot?.sync_run_status === 'success'
    && snapshot?.sync_run_finished_at !== null
    && snapshot?.sync_run_error_code === null
    && snapshot?.work_status === 'active'
    && snapshot?.work_lifecycle_status === 'active'
    && snapshot?.work_completed_at === null
    && Number(snapshot?.d1_phase_complete) === 1
    && Number(snapshot?.preflight_phase_complete ?? 0) === 0
    && Number(snapshot?.lark_phase_complete ?? 0) === 0
    && Number(snapshot?.completion_phase_complete ?? 0) === 0
    && Number(snapshot?.active_lock_count) === 0
    && Number(snapshot?.queue_operation_attempts) === 1
    && Number(snapshot?.main_queue_attempts) >= 1
    && Number(snapshot?.coverage_run_count) > 0
    && Number(snapshot?.invalid_coverage_count) === 0;
  if (!exact) {
    throw continuationError(
      'Remote Facebook operation is not at the exact D1-complete/Lark-pending boundary',
      'META_HISTORY_EXACT_CONTINUATION_REMOTE_BOUNDARY_INVALID',
      safeBoundary(snapshot),
    );
  }
  return Object.freeze(safeBoundary(snapshot));
}

export function validateStableMetaHistoryFacebookBoundary(first = {}, second = {}) {
  const left = validateMetaHistoryFacebookLarkBoundary(first);
  const right = validateMetaHistoryFacebookLarkBoundary(second);
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw continuationError(
      'Remote Facebook boundary changed during the read-only stability window',
      'META_HISTORY_EXACT_CONTINUATION_REMOTE_BOUNDARY_MOVING',
    );
  }
  return Object.freeze({
    stable: true,
    fingerprint: sha256(JSON.stringify(left)),
    boundary: left,
  });
}

function safeBoundary(snapshot = {}) {
  return {
    syncRunStatus: snapshot.sync_run_status ?? null,
    syncRunFinishedAt: snapshot.sync_run_finished_at ?? null,
    syncRunErrorCode: snapshot.sync_run_error_code ?? null,
    workStatus: snapshot.work_status ?? null,
    workLifecycleStatus: snapshot.work_lifecycle_status ?? null,
    workCompletedAt: snapshot.work_completed_at ?? null,
    d1PhaseComplete: Number(snapshot.d1_phase_complete ?? 0),
    preflightPhaseComplete: Number(snapshot.preflight_phase_complete ?? 0),
    larkPhaseComplete: Number(snapshot.lark_phase_complete ?? 0),
    completionPhaseComplete: Number(snapshot.completion_phase_complete ?? 0),
    activeLockCount: Number(snapshot.active_lock_count ?? 0),
    queueOperationAttempts: Number(snapshot.queue_operation_attempts ?? 0),
    mainQueueAttempts: Number(snapshot.main_queue_attempts ?? 0),
    coverageRunCount: Number(snapshot.coverage_run_count ?? 0),
    invalidCoverageCount: Number(snapshot.invalid_coverage_count ?? 0),
  };
}

function requirePath(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.startsWith('/')) {
    throw continuationError(
      'Repository delta path is invalid',
      'META_HISTORY_EXACT_CONTINUATION_REPOSITORY_PATH_INVALID',
    );
  }
  return value.trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function continuationError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaHistoryExactContinuationError';
  error.code = code;
  error.details = details;
  return error;
}
