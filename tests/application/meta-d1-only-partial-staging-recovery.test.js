import assert from 'node:assert/strict';
import test from 'node:test';
import {
  META_K2_PARTIAL_STAGING_EXACT_IDENTITY,
  assertMetaK2PartialStagingRecoveryConfirmation,
  compareMetaD1OnlyDirectContinuationSnapshots,
  validateMetaK2ExactPartialStagingStability,
} from '../../scripts/lib/meta-d1-only-partial-staging-recovery.js';

const OBSERVED_AT = 1785649200000;

function emptySnapshot() {
  return {
    sync_run_status: null,
    sync_run_started_at: null,
    sync_run_finished_at: null,
    sync_run_error_code: null,
    sync_run_records_written: 0,
    sync_run_updated_at: null,
    work_status: null,
    work_lifecycle_status: null,
    work_completed_at: null,
    d1_phase_complete: 0,
    d1_state_json: null,
    d1_phase_updated_at: null,
    source_staging_complete: 0,
    source_staging_updated_at: null,
    source_staging_stage: null,
    source_staging_unit_count: 0,
    source_staging_row_count: 0,
    source_staging_page_number: 0,
    source_staging_content_index: 0,
    lark_phase_count: 0,
    completion_phase_count: 0,
    active_lock_count: 0,
    queue_operation_attempts: 0,
    main_queue_attempts: 0,
    queue_operation_updated_at: null,
    observed_at: 0,
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

function exactPartialSnapshot(observedAt = OBSERVED_AT) {
  return {
    ...emptySnapshot(),
    sync_run_status: 'success',
    sync_run_started_at: observedAt - (35 * 60 * 1000),
    sync_run_finished_at: observedAt - (20 * 60 * 1000),
    sync_run_updated_at: observedAt - (20 * 60 * 1000),
    sync_run_records_written: 0,
    work_status: 'active',
    work_lifecycle_status: 'active',
    source_staging_complete: 0,
    source_staging_updated_at: observedAt - (20 * 60 * 1000),
    source_staging_stage: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.sourceStage,
    source_staging_unit_count: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.sourceUnitCount,
    source_staging_row_count: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.sourceRowCount,
    source_staging_page_number: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.sourcePageNumber,
    source_staging_content_index: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.sourceContentIndex,
    queue_operation_attempts:
      META_K2_PARTIAL_STAGING_EXACT_IDENTITY.queueOperationAttempts,
    main_queue_attempts: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.mainQueueAttempts,
    queue_operation_updated_at: observedAt - (16 * 60 * 1000),
    observed_at: observedAt,
  };
}

function completedSnapshot() {
  return {
    ...emptySnapshot(),
    sync_run_status: 'success',
    sync_run_started_at: OBSERVED_AT - (35 * 60 * 1000),
    sync_run_finished_at: OBSERVED_AT + 120_000,
    sync_run_updated_at: OBSERVED_AT + 120_000,
    sync_run_records_written: 2748,
    work_status: 'active',
    work_lifecycle_status: 'active',
    d1_phase_complete: 1,
    d1_state_json: JSON.stringify({
      adsEntityDone: true,
      adsDailyDone: true,
      counts: { written: 2748 },
    }),
    d1_phase_updated_at: OBSERVED_AT + 120_000,
    source_staging_complete: 1,
    source_staging_updated_at: OBSERVED_AT + 60_000,
    source_staging_stage: 'complete',
    source_staging_unit_count: 29,
    source_staging_row_count: 2748,
    source_staging_page_number: 29,
    source_staging_content_index: 0,
    queue_operation_attempts:
      META_K2_PARTIAL_STAGING_EXACT_IDENTITY.queueOperationAttempts,
    main_queue_attempts: META_K2_PARTIAL_STAGING_EXACT_IDENTITY.mainQueueAttempts,
    queue_operation_updated_at: OBSERVED_AT - (16 * 60 * 1000),
    observed_at: OBSERVED_AT + 150_000,
    coverage_run_count: 2,
    invalid_coverage_count: 0,
    coverage_entity_count: 4,
    target_ads_entity_count: 147,
    target_ads_daily_count: 2601,
    operation_ads_entity_count: 147,
    operation_ads_daily_count: 2601,
  };
}

test('exact K2 partial-staging recovery accepts daily unit 27 / 2,601 rows only', () => {
  const before = exactPartialSnapshot();
  const after = { ...before, observed_at: OBSERVED_AT + 30_000 };
  const accepted = validateMetaK2ExactPartialStagingStability(before, after);
  assert.equal(accepted.accepted, true);
  assert.equal(
    accepted.decision,
    'META_K2_PARTIAL_STAGING_STABLE_SAFE_TO_PREPARE_RECOVERY',
  );
  assert.equal(accepted.snapshot.sourceStaging.stage, 'daily');
  assert.equal(accepted.snapshot.sourceStaging.unitCount, 27);
  assert.equal(accepted.snapshot.sourceStaging.rowCount, 2601);
  assert.equal(accepted.snapshot.sourceStaging.pageNumber, 27);
  assert.equal(accepted.snapshot.sourceStaging.contentIndex, 0);
  assert.equal(accepted.snapshot.mainQueueAttempts, 29);
});

test('exact K2 partial-staging recovery rejects checkpoint or Queue attempt drift', () => {
  const before = exactPartialSnapshot();
  for (const drift of [
    { source_staging_stage: 'ads' },
    { source_staging_unit_count: 28 },
    { source_staging_row_count: 2602 },
    { source_staging_page_number: 28 },
    { source_staging_content_index: 1 },
    { main_queue_attempts: 30 },
  ]) {
    const candidate = { ...before, ...drift };
    assert.throws(
      () => validateMetaK2ExactPartialStagingStability(candidate, {
        ...candidate,
        observed_at: OBSERVED_AT + 30_000,
      }),
      (error) => [
        'META_K2_PARTIAL_STAGING_EXACT_STATE_INVALID',
        'META_D1_ONLY_PARTIAL_STAGING_PROGRESS_OBSERVED',
      ].includes(error.code),
    );
  }
});

test('direct continuation reaches D1 completion without increasing Queue attempts', () => {
  const before = exactPartialSnapshot();
  const after = completedSnapshot();
  const accepted = compareMetaD1OnlyDirectContinuationSnapshots(before, after);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.rerun, false);
  assert.equal(accepted.queueAttemptsUnchanged, true);
  assert.equal(accepted.after.queueOperationAttempts, 1);
  assert.equal(accepted.after.mainQueueAttempts, 29);
  assert.equal(accepted.operationCounts.adsEntities, 147);
  assert.equal(accepted.operationCounts.adsDaily, 2601);
  assert.equal(accepted.coverageRunCount, 2);
});

test('direct continuation fails closed if Queue send count increases', () => {
  const before = exactPartialSnapshot();
  assert.throws(
    () => compareMetaD1OnlyDirectContinuationSnapshots(before, {
      ...completedSnapshot(),
      main_queue_attempts: 30,
    }),
    (error) => error.code === 'META_D1_ONLY_DIRECT_CONTINUATION_QUEUE_DRIFT',
  );
  assert.throws(
    () => compareMetaD1OnlyDirectContinuationSnapshots(before, {
      ...completedSnapshot(),
      queue_operation_attempts: 2,
    }),
    (error) => error.code === 'META_D1_ONLY_DIRECT_CONTINUATION_QUEUE_DRIFT',
  );
});

test('direct idempotent rerun requires zero Business, Coverage and Queue drift', () => {
  const before = completedSnapshot();
  const accepted = compareMetaD1OnlyDirectContinuationSnapshots(before, {
    ...before,
    observed_at: before.observed_at + 60_000,
  }, { rerun: true });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.rerun, true);
  assert.equal(accepted.businessCountDrift, false);
  assert.equal(accepted.coverageCountDrift, false);
  assert.equal(accepted.queueAttemptsUnchanged, true);

  assert.throws(
    () => compareMetaD1OnlyDirectContinuationSnapshots(before, {
      ...before,
      target_ads_daily_count: before.target_ads_daily_count + 1,
    }, { rerun: true }),
    (error) => error.code === 'META_D1_ONLY_DIRECT_RERUN_COUNT_DRIFT',
  );
  assert.throws(
    () => compareMetaD1OnlyDirectContinuationSnapshots(before, {
      ...before,
      coverage_run_count: before.coverage_run_count + 1,
    }, { rerun: true }),
    (error) => error.code === 'META_D1_ONLY_DIRECT_RERUN_COVERAGE_DRIFT',
  );
  assert.throws(
    () => compareMetaD1OnlyDirectContinuationSnapshots(before, {
      ...before,
      main_queue_attempts: 30,
    }, { rerun: true }),
    (error) => error.code === 'META_D1_ONLY_DIRECT_CONTINUATION_QUEUE_DRIFT',
  );
});

test('partial-staging recovery confirmation is exact', () => {
  assert.equal(assertMetaK2PartialStagingRecoveryConfirmation({
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY:
      'RECOVER_EXACT_PARTIAL_META_ADS_STAGING',
  }), true);
  assert.throws(
    () => assertMetaK2PartialStagingRecoveryConfirmation({}),
    (error) => error.code
      === 'META_K2_PARTIAL_STAGING_RECOVERY_CONFIRMATION_REQUIRED',
  );
});
