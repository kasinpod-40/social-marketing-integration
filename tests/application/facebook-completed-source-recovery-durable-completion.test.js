import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FACEBOOK_COMPLETED_SOURCE_INCIDENT,
  evaluateFacebookCompletedSourceCompletion,
} from '../../scripts/lib/facebook-completed-source-recovery.js';

const incident = FACEBOOK_COMPLETED_SOURCE_INCIDENT;
const completion = Object.freeze({
  schemaVersion: 'meta_end_to_end_reconciliation_v1',
  operationId: incident.operationId,
  connectorKey: 'facebook',
  source: {
    sourceContentRows: incident.expectedContentCount,
    rawContentRows: incident.expectedContentCount,
    contentInsightEntities: incident.expectedContentCount,
    contentDailyRows: 80,
    accountDailyRows: 2,
    missingContentInsightRows: 9,
    sourceStatus: 'complete',
  },
  d1: {
    expectedOperations: 6,
    processedOperations: 6,
    organicHistory: {
      contentRows: 80,
      stateWritten: 3,
      stateSkipped: 77,
      observationsCreated: 0,
      observationsSkipped: 0,
      observationsNotRequired: 80,
      coverageEntitiesWritten: 0,
      coverageEntitiesSkipped: 80,
    },
    counts: {},
  },
  lark: [
    { tableKey: 'rawOrganicAccounts', expected: 1, created: 0, updated: 1, skipped: 0 },
    { tableKey: 'organicContent', expected: 89, created: 0, updated: 10, skipped: 79 },
  ],
  failed: 0,
});

function completedLatest(overrides = {}) {
  return {
    work_lifecycle_status: 'completed',
    work_completed_at: Date.parse('2026-08-11T03:30:00.000Z'),
    sync_status: 'success',
    sync_error_code: null,
    completion_json: JSON.stringify(completion),
    source_complete: null,
    source_stage: null,
    source_units: null,
    content_index: null,
    content_count: null,
    d1_complete: null,
    lark_complete: null,
    completion_complete: null,
    operation_observations: 0,
    target_day_observations: 0,
    queue_attempts: 180,
    active_locks: 0,
    dead_letter_status: 'redriven',
    content_coverage_status: 'complete',
    content_coverage_sync_run_id: incident.syncRunId,
    content_coverage_expected_entities: 80,
    content_coverage_observed_entities: 80,
    content_coverage_expected_rows: 80,
    content_coverage_observed_rows: 80,
    content_coverage_written_rows: 80,
    content_coverage_failed_rows: 0,
    account_coverage_status: 'complete',
    account_coverage_sync_run_id: incident.syncRunId,
    account_coverage_expected_entities: 2,
    account_coverage_observed_entities: 2,
    account_coverage_expected_rows: 2,
    account_coverage_observed_rows: 2,
    account_coverage_written_rows: 2,
    account_coverage_failed_rows: 0,
    account_daily_rows: 2,
    target_day_account_daily_rows: 1,
    ...overrides,
  };
}

test('durable closeout passes after completeWork deletes staging phases and no new observation is required', () => {
  const result = evaluateFacebookCompletedSourceCompletion({ latest: completedLatest() });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.status, 'FACEBOOK_COMPLETED_SOURCE_RECOVERY_COMPLETE');
  assert.equal(result.summary.sourceContentRows, incident.expectedContentCount);
  assert.equal(result.summary.operationObservations, 0);
  assert.equal(result.summary.targetDayAccountDailyRows, 1);
});

test('durable closeout fails closed when retained Lark reconciliation does not account for every row', () => {
  const invalid = structuredClone(completion);
  invalid.lark[1].skipped = 78;
  const result = evaluateFacebookCompletedSourceCompletion({
    latest: completedLatest({ completion_json: JSON.stringify(invalid) }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((row) => row.field === 'completion Lark organicContent'));
});

test('durable closeout requires the exact redriven DLQ and target-day account fact', () => {
  const result = evaluateFacebookCompletedSourceCompletion({
    latest: completedLatest({ dead_letter_status: 'open', target_day_account_daily_rows: 0 }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((row) => row.field === 'dead letter status after recovery'));
  assert.ok(result.errors.some((row) => row.field === 'target-day account daily D1 rows'));
});
