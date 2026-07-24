import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIKTOK_DURABLE_RECOVERY_INCIDENT,
  validateTikTokRecoveryPreflightRow,
} from '../../scripts/lib/tiktok-durable-recovery-operator.js';

const NOW = Date.parse('2026-07-24T03:00:00.000Z');

function createRemotePartialRow(overrides = {}) {
  return {
    organic_content_state: 1309,
    organic_content_observations: 1000,
    data_coverage_entities: 1000,
    work_status: 'active',
    work_generation: TIKTOK_DURABLE_RECOVERY_INCIDENT.generation,
    work_requested_at: TIKTOK_DURABLE_RECOVERY_INCIDENT.requestedAt,
    next_sequence: 2,
    units_completed: 2,
    raw_records_completed: 1000,
    content_rows_durable: 1000,
    observation_rows_durable: 1000,
    coverage_entities_written: 1000,
    phase_complete: 0,
    dlq_status: 'open',
    dlq_message_id: TIKTOK_DURABLE_RECOVERY_INCIDENT.dlqMessageId,
    dlq_error_code: 'QUEUE_RETRY_EXHAUSTED',
    lock_expires_at: NOW - 1,
    coverage_status: 'partial',
    coverage_expected_entities: 2021,
    coverage_observed_entities: 0,
    coverage_expected_rows: 2021,
    coverage_observed_rows: 0,
    coverage_failed_rows: 0,
    coverage_completed_at: null,
    ...overrides,
  };
}

test('preflight accepts partial Coverage summary counters that remain zero before completion', () => {
  const result = validateTikTokRecoveryPreflightRow(createRemotePartialRow(), NOW);
  assert.equal(result.lockExpired, true);
  assert.equal(result.coverage_observed_entities, 0);
  assert.equal(result.coverage_observed_rows, 0);
});

test('preflight rejects partial Coverage counters that disagree with each other or durable progress', () => {
  assert.throws(
    () => validateTikTokRecoveryPreflightRow(createRemotePartialRow({
      coverage_observed_entities: 1,
      coverage_observed_rows: 0,
    }), NOW),
    (error) => error.code === 'TIKTOK_RECOVERY_PREFLIGHT_EVIDENCE_MISMATCH',
  );
});
