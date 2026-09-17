import test from 'node:test';
import assert from 'node:assert/strict';
import {
  META_ADS_EXACT_RECOVERY,
  readMetaRecoveryTarget,
  assertMetaRecoveryEvidence,
  buildMetaRecoveryEvidenceSql,
  buildMetaRecoveryClaimSql,
  buildMetaRecoveryReactivateSql,
  buildMetaRecoveryMarkSql,
} from '../../scripts/lib/meta-ads-20260916-exact-recovery.js';

function exactRow(target) {
  return {
    dlq_id: target.dlqId, dlq_status: 'open', job_type: 'meta.ads.sync',
    error_code: 'META_PERMANENT_API_ERROR', operation_id: target.operationId,
    original_work_key: target.workKey, generation: target.generation,
    original_requested_at: target.generation, main_queue_attempts: 2,
    recovery_status: 'not_started', recorded_attempts: 2,
    lifecycle_status: 'terminal', terminal_reason: 'QUEUE_PERMANENT_FAILURE',
    completed_at: null, source_phase_count: 1, exact_failure_count: 1,
    active_lock_count: 0, changed_fence_count: 0, newer_work_count: 0,
    other_channel_active_count: 0,
    cursor_key: `chemistry_k:meta_ads:chemistry_k:scheduled_end_to_end_${target.key}`,
    replay_payload_json: JSON.stringify({
      schemaVersion: 1, type: 'meta.ads.sync', trigger: 'scheduled',
      connectorKey: 'meta_ads', sourceAccountKey: `chemistry_${target.key}`,
      operationId: target.operationId, workKey: target.workKey,
      generation: target.generation, originalRequestedAt: target.generation,
      requestedAt: new Date(target.generation).toISOString(),
      periodStart: target.metricDate, periodEnd: target.metricDate,
      sourceMode: 'daily_activity_scoped_creatives_v1', d1Only: false, dryRun: false,
    }),
  };
}

test('both exact K2/K3 incident identities and payloads admit a read-only plan', () => {
  for (const key of ['k2', 'k3']) {
    const target = readMetaRecoveryTarget(key);
    const plan = assertMetaRecoveryEvidence(exactRow(target), target);
    assert.equal(plan.payload.workKey, target.workKey);
    assert.match(plan.cursorKey, /scheduled_end_to_end/u);
  }
  assert.throws(() => readMetaRecoveryTarget('k1'), /Specify only/u);
  assert.equal(META_ADS_EXACT_RECOVERY.queue, 'social-mkt-sync-jobs');
});

test('claim and replay fail closed for changed generation, signature, lock or source payload', () => {
  const target = readMetaRecoveryTarget('k2');
  for (const [field, value] of [
    ['generation', target.generation + 1], ['recovery_status', 'in_progress'],
    ['exact_failure_count', 0], ['active_lock_count', 1],
    ['changed_fence_count', 1], ['newer_work_count', 1],
    ['other_channel_active_count', 1], ['source_phase_count', 0],
    ['recorded_attempts', 3], ['completed_at', target.generation + 1],
  ]) {
    assert.throws(() => assertMetaRecoveryEvidence({ ...exactRow(target), [field]: value }, target), /fence failed/u);
  }
  for (const changed of [
    { sourceAccountKey: '[REDACTED]' }, { periodEnd: '2026-09-17' },
    { type: 'facebook.page.organic.sync' }, { d1Only: true },
  ]) {
    const row = exactRow(target);
    row.replay_payload_json = JSON.stringify({ ...JSON.parse(row.replay_payload_json), ...changed });
    assert.throws(() => assertMetaRecoveryEvidence(row, target), /payload identity changed/u);
  }
});

test('SQL is exact CAS with no Business/source deletion or unrelated terminal access', () => {
  const target = readMetaRecoveryTarget('k3');
  const sql = [buildMetaRecoveryEvidenceSql(target, 1789600000000),
    buildMetaRecoveryClaimSql(target, 1789600000000),
    buildMetaRecoveryReactivateSql(target, 1789600000000),
    ...buildMetaRecoveryMarkSql(target, 1789600000000)];
  for (const query of sql) {
    assert.match(query, new RegExp(target.dlqId, 'u'));
    assert.doesNotMatch(query, /eafd8e43f1ae5113d12905301496fd4e/u);
    assert.doesNotMatch(query, /DELETE\s+FROM|UPDATE\s+ads_daily_facts/iu);
  }
  assert.match(sql[0], /graphSubcode'\)=1504044/u);
  assert.match(sql[1], /recovery_status='not_started'/u);
  assert.match(sql[1], /other_channel_active_count|o.lifecycle_status='active'/u);
  assert.match(sql[2], /lifecycle_status='terminal'/u);
  assert.match(sql[3], /status='open'/u);
  assert.match(sql[4], /status='redriven'/u);
  assert.throws(() => buildMetaRecoveryClaimSql(target, NaN), /Invalid recovery timestamp/u);
});
