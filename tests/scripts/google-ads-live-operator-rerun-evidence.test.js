import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareGoogleAdsRerunVerification,
  validateGoogleAdsRunVerificationRow,
} from '../../scripts/lib/google-ads-live-operator.js';

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';

function rawRow(overrides = {}) {
  return {
    run_id: RUN_ID,
    mode: 'LIVE',
    transport_status: 'assembling',
    expected_chunk_count: 7,
    received_chunk_count: 7,
    expected_row_count: 1305,
    received_row_count: 1305,
    payload_redacted_at: 100,
    admission_status: 'completed',
    send_attempts: 1,
    completed_at: 100,
    admission_payload_redacted_at: 100,
    work_lifecycle_status: 'completed',
    ads_entity_rows: 1000,
    ads_daily_rows: 200,
    coverage_run_rows: 6,
    ...overrides,
  };
}

test('rerun comparison accepts persisted normalized verify evidence against a fresh raw D1 row', () => {
  const persisted = validateGoogleAdsRunVerificationRow(rawRow());
  assert.deepEqual(
    compareGoogleAdsRerunVerification(persisted, rawRow()),
    { businessFactDrift: false, changed: [] },
  );
});

test('rerun comparison still detects drift when persisted evidence is normalized', () => {
  const persisted = validateGoogleAdsRunVerificationRow(rawRow());
  assert.throws(
    () => compareGoogleAdsRerunVerification(persisted, rawRow({ ads_daily_rows: 201 })),
    (error) => error.code === 'GOOGLE_ADS_OPERATOR_RERUN_DRIFT',
  );
});
