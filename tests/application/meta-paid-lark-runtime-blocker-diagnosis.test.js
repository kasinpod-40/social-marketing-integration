import test from 'node:test';
import assert from 'node:assert/strict';
import {
  META_PAID_LARK_RETAINED_FORENSIC_WORK_KEY,
  buildMetaPaidLarkRuntimeDiagnosisQueries,
  classifyMetaPaidLarkRuntimeDiagnosis,
} from '../../scripts/lib/meta-paid-lark-runtime-blocker-diagnosis.js';

function snapshot(observedAt, overrides = {}) {
  const work = [{
    work_key: 'meta_ads:chemistry_k2:meta-current-operation',
    cursor_key: 'meta_ads:chemistry_k2',
    work_type: 'meta_ads_sync',
    status: 'active',
    lifecycle_status: 'active',
    generation: 1_000_000,
    requested_at: 1_000_000,
    created_at: 1_000_000,
    updated_at: 1_000_000,
    expires_at: 3_000_000,
    terminal_reason: null,
  }];
  const queue = [{
    operation_id: 'meta-current-operation',
    work_key: work[0].work_key,
  }];
  const locks = [{
    lock_key: 'sync:meta_ads:chemistry_k2',
    owner_id: 'owner-1',
    acquired_at: 1_000_000,
    expires_at: 3_000_000,
    updated_at: 1_000_000,
  }];
  const phases = [{
    work_key: work[0].work_key,
    phase: 'meta_end_to_end_source_staging_v1',
    complete: 0,
    expected_items: 1,
    processed_items: 0,
    pages_processed: 0,
    chunks_processed: 0,
    updated_at: 1_000_000,
  }];
  return { observedAt, work, queue, locks, phases, ...overrides };
}

test('runtime diagnosis SQL is read-only and excludes the retained forensic work key', () => {
  const queries = buildMetaPaidLarkRuntimeDiagnosisQueries();
  assert.deepEqual(Object.keys(queries).sort(), ['locks', 'phases', 'queue', 'work']);
  for (const sql of Object.values(queries)) {
    assert.match(sql, /^SELECT\b/u);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/iu);
  }
  assert.equal(queries.work.includes(META_PAID_LARK_RETAINED_FORENSIC_WORK_KEY), true);
  assert.match(queries.queue, /queue_operation_attempts/u);
  assert.match(queries.locks, /expires_at > \(unixepoch\(\) \* 1000\)/u);
});

test('stable old blocker reaches exact recovery review but never claims automatic recovery', () => {
  const before = snapshot(1_970_000);
  const after = snapshot(2_000_000);
  const result = classifyMetaPaidLarkRuntimeDiagnosis(before, after);
  assert.equal(result.enoughStabilityWindow, true);
  assert.equal(result.blockerStateStable, true);
  assert.equal(result.idle, false);
  assert.equal(result.everyCurrentWorkStable, true);
  assert.equal(result.everyCurrentWorkStale, true);
  assert.equal(result.work[0].staleByExistingMetaRule, true);
  assert.equal(result.work[0].metaAdsWork, true);
  assert.deepEqual(result.work[0].queueOperations, ['meta-current-operation']);
  assert.equal(result.nextGate, 'exact_recovery_review_required');
  assert.equal(result.remoteMutationPerformed, false);
});

test('any phase or lock movement blocks stale recovery review', () => {
  const before = snapshot(1_970_000);
  const changed = snapshot(2_000_000);
  changed.phases = changed.phases.map((row) => ({ ...row, processed_items: 1, updated_at: 1_990_000 }));
  const result = classifyMetaPaidLarkRuntimeDiagnosis(before, changed);
  assert.equal(result.blockerStateStable, false);
  assert.equal(result.everyCurrentWorkStale, false);
  assert.equal(result.nextGate, 'active_or_changing_work_must_not_be_mutated');
});

test('idle second snapshot allows the existing paid Meta closeout to be rerun', () => {
  const before = snapshot(1_970_000);
  const after = {
    observedAt: 2_000_000,
    work: [],
    queue: [],
    locks: [],
    phases: [],
  };
  const result = classifyMetaPaidLarkRuntimeDiagnosis(before, after);
  assert.equal(result.idle, true);
  assert.equal(result.counts.activeWork, 0);
  assert.equal(result.counts.activeQueueOperations, 0);
  assert.equal(result.counts.activeLocks, 0);
  assert.deepEqual(result.disappearedWorkKeys, ['meta_ads:chemistry_k2:meta-current-operation']);
  assert.equal(result.nextGate, 'rerun_paid_meta_closeout');
});
