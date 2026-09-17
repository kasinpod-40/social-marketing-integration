import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YOUTUBE_ACCOUNT_DAILY_RECOVERY as target,
  assertYouTubeRecoveryEvidence,
  buildYouTubeRecoveryClaimSql,
  buildYouTubeRecoveryEvidenceSql,
  buildYouTubeRecoveryMarkSql,
} from '../../scripts/lib/youtube-account-daily-exact-recovery.js';

function exactRow() {
  return {
    dlq_id: target.dlqId,
    dlq_status: 'open',
    job_type: 'youtube.channel.organic.sync',
    error_code: 'PERMANENT_QUEUE_FAILURE',
    operation_id: target.operationId,
    original_work_key: target.workKey,
    generation: target.generation,
    original_requested_at: target.generation,
    main_queue_attempts: 1,
    recovery_status: 'not_started',
    recorded_attempts: 1,
    source_failure_count: 1,
    exact_work_count: 0,
    active_lock_count: 0,
    newer_operation_count: 0,
    target_fact_count: 0,
    payload_json: JSON.stringify({
      schemaVersion: 1,
      type: 'youtube.channel.organic.sync',
      trigger: 'scheduled',
      syncMode: 'auto',
      requestedAt: new Date(target.generation).toISOString(),
      metricDate: target.metricDate,
      operationId: target.operationId,
      workKey: target.workKey,
      generation: target.generation,
      originalRequestedAt: target.generation,
    }),
  };
}

test('exact YouTube recovery admits only the original failed scheduled generation', () => {
  const result = assertYouTubeRecoveryEvidence(exactRow());
  assert.equal(result.operationId, target.operationId);
  assert.equal(result.metricDate, target.metricDate);
  for (const [field, value] of [
    ['recovery_status', 'in_progress'],
    ['recorded_attempts', 2],
    ['exact_work_count', 1],
    ['active_lock_count', 1],
    ['newer_operation_count', 1],
    ['target_fact_count', 1],
    ['source_failure_count', 0],
  ]) {
    assert.throws(() => assertYouTubeRecoveryEvidence({ ...exactRow(), [field]: value }), /fence failed/u);
  }
  const changedPayload = { ...JSON.parse(exactRow().payload_json), metricDate: '2026-09-17' };
  assert.throws(() => assertYouTubeRecoveryEvidence({
    ...exactRow(), payload_json: JSON.stringify(changedPayload),
  }), /payload identity changed/u);
});

test('recovery SQL is exact, bounded and cannot touch the protected terminal or source facts', () => {
  const sql = [buildYouTubeRecoveryEvidenceSql(1789600000000),
    buildYouTubeRecoveryClaimSql(1789600000000), ...buildYouTubeRecoveryMarkSql(1789600000000)];
  assert.equal(sql.length, 4);
  for (const command of sql) {
    assert.match(command, new RegExp(target.dlqId, 'u'));
    assert.doesNotMatch(command, /eafd8e43f1ae5113d12905301496fd4e/u);
    assert.doesNotMatch(command, /DELETE\s+FROM|UPDATE\s+organic_account_daily_facts/iu);
  }
  assert.match(sql[1], /recovery_status='not_started'/u);
  assert.match(sql[1], /NOT EXISTS\(SELECT 1 FROM sync_locks/u);
  assert.match(sql[2], /status='open'/u);
  assert.match(sql[3], /status='redriven'/u);
  assert.throws(() => buildYouTubeRecoveryClaimSql(NaN), /timestamp invalid/u);
});
