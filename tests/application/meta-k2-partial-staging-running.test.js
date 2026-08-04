import assert from 'node:assert/strict';
import test from 'node:test';
import {
  META_K2_PARTIAL_STAGING_EXACT_IDENTITY,
  validateMetaK2ExactPartialStagingStability,
} from '../../scripts/lib/meta-d1-only-partial-staging-recovery.js';

const OBSERVED_AT = 1785649200000;

function runningSnapshot(observedAt = OBSERVED_AT) {
  return {
    sync_run_status: 'running',
    sync_run_started_at: observedAt - (35 * 60 * 1000),
    sync_run_finished_at: null,
    sync_run_error_code: null,
    sync_run_records_written: 0,
    sync_run_updated_at: observedAt - (20 * 60 * 1000),
    work_status: 'active',
    work_lifecycle_status: 'active',
    work_completed_at: null,
    d1_phase_complete: 0,
    d1_state_json: null,
    d1_phase_updated_at: null,
    source_staging_complete: 0,
    source_staging_updated_at: observedAt - (20 * 60 * 1000),
    source_staging_stage: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.sourceStage,
    source_staging_unit_count: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.sourceUnitCount,
    source_staging_row_count: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.sourceRowCount,
    source_staging_page_number: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.sourcePageNumber,
    source_staging_content_index: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.sourceContentIndex,
    lark_phase_count: 0,
    completion_phase_count: 0,
    active_lock_count: 0,
    queue_operation_attempts:
      META_K2_PARTIAL_STAGING_EXACT_IDENTITY.queueOperationAttempts,
    main_queue_attempts: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.mainQueueAttempts,
    queue_operation_updated_at: observedAt - (16 * 60 * 1000),
    observed_at: observedAt,
    coverage_run_count: 0,
    invalid_coverage_count: 0,
    coverage_entity_count: 0,
    target_organic_state_count: 0,
    target_organic_observation_count: 0,
    target_account_daily_count: 0,
    target_ads_entity_count: 0,
    target_ads_daily_count: 0,
    operation_organic_state_count: 0,
    operation_organic_observation_count: 0,
    operation_account_daily_count: 0,
    operation_ads_entity_count: 0,
    operation_ads_daily_count: 0,
  };
}

test('exact K2 validator accepts the proven stale running checkpoint', () => {
  const before = runningSnapshot();
  const after = { ...before, observed_at: OBSERVED_AT + 30_000 };
  const accepted = validateMetaK2ExactPartialStagingStability(before, after);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.orphanedRunningRecovery, true);
  assert.equal(accepted.successfulInvocationRecovery, false);
  assert.equal(accepted.snapshot.syncRunStatus, 'running');
  assert.equal(accepted.snapshot.sourceStaging.stage, 'daily');
  assert.equal(accepted.snapshot.sourceStaging.unitCount, 27);
  assert.equal(accepted.snapshot.sourceStaging.rowCount, 2601);
  assert.equal(accepted.snapshot.mainQueueAttempts, 29);
});

test('exact K2 running checkpoint rejects lock, write, activity and checkpoint drift', () => {
  const before = runningSnapshot();
  for (const drift of [
    { active_lock_count: 1 },
    { sync_run_records_written: 1 },
    { coverage_run_count: 1 },
    { operation_ads_daily_count: 1 },
    { source_staging_unit_count: 28 },
    { main_queue_attempts: 30 },
    { sync_run_updated_at: OBSERVED_AT - 60_000 },
  ]) {
    const candidate = { ...before, ...drift };
    assert.throws(
      () => validateMetaK2ExactPartialStagingStability(candidate, {
        ...candidate,
        observed_at: OBSERVED_AT + 30_000,
      }),
      (error) => error.code === 'META_D1_ONLY_PARTIAL_STAGING_PROGRESS_OBSERVED',
    );
  }
});

test('exact K2 running checkpoint requires a stable 30-second observation window', () => {
  const before = runningSnapshot();
  assert.throws(
    () => validateMetaK2ExactPartialStagingStability(before, {
      ...before,
      observed_at: OBSERVED_AT + 29_999,
    }),
    (error) => error.code === 'META_D1_ONLY_PARTIAL_STAGING_PROGRESS_OBSERVED',
  );
  assert.throws(
    () => validateMetaK2ExactPartialStagingStability(before, {
      ...before,
      observed_at: OBSERVED_AT + 30_000,
      source_staging_page_number: 28,
    }),
    (error) => error.code === 'META_D1_ONLY_PARTIAL_STAGING_PROGRESS_OBSERVED',
  );
});
