import test from 'node:test';
import assert from 'node:assert/strict';

import { CHATWOOT_1D_EXACT_INCIDENT } from '../../scripts/lib/report-runtime-chatwoot-1d-incident-continuation.js';
import {
  assertChatwoot1dD1LarkRecoveredState,
  assertChatwoot1dD1LarkRecoveryPrestate,
  assertChatwoot1dD1LarkRecoveryWriteResult,
} from '../../scripts/lib/report-runtime-chatwoot-1d-d1-lark-recovery.js';

const incident = CHATWOOT_1D_EXACT_INCIDENT;

function d1(overrides = {}) {
  return {
    report_id: incident.reportId,
    materialization_count: 1,
    sync_status: incident.failedSync.status,
    successful_sync_count: 0,
    active_lock_count: 0,
    new_dlq_count: 1,
    payload_checksum: 'checksum-chatwoot-1d',
    ...overrides,
  };
}

function emptyLark(overrides = {}) {
  return {
    snapshots: 0,
    metrics: 0,
    topContent: 0,
    topAds: 0,
    duplicateMetricKeys: 0,
    ...overrides,
  };
}

function completeLark(overrides = {}) {
  return {
    snapshots: 1,
    metrics: incident.expectedMetricCount,
    topContent: 0,
    topAds: 0,
    duplicateMetricKeys: 0,
    ...overrides,
  };
}

test('admits only exact D1-complete / Lark-empty retained incident state', () => {
  assert.equal(assertChatwoot1dD1LarkRecoveryPrestate({
    d1: d1(),
    lark: emptyLark(),
  }, incident), true);

  for (const invalid of [
    { d1: d1({ materialization_count: 0 }), lark: emptyLark() },
    { d1: d1({ report_id: null }), lark: emptyLark() },
    { d1: d1({ sync_status: 'success' }), lark: emptyLark() },
    { d1: d1({ successful_sync_count: 1 }), lark: emptyLark() },
    { d1: d1({ new_dlq_count: 2 }), lark: emptyLark() },
    { d1: d1(), lark: emptyLark({ snapshots: 1 }) },
    { d1: d1(), lark: emptyLark({ metrics: 1 }) },
  ]) {
    assert.throws(
      () => assertChatwoot1dD1LarkRecoveryPrestate(invalid, incident),
      (error) => error?.code === 'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_PRESTATE_MISMATCH',
    );
  }
});

test('requires shared writer to emit exactly one snapshot and 139 metrics', () => {
  assert.equal(assertChatwoot1dD1LarkRecoveryWriteResult({
    rows: { snapshots: 1, metrics: 139, topContent: 0, topAds: 0 },
  }, incident), true);

  assert.throws(
    () => assertChatwoot1dD1LarkRecoveryWriteResult({
      rows: { snapshots: 1, metrics: 138, topContent: 0, topAds: 0 },
    }, incident),
    (error) => error?.code === 'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_WRITE_RESULT_INVALID',
  );
});

test('retains failed sync history while requiring exact recovered D1/Lark integrity shape', () => {
  assert.equal(assertChatwoot1dD1LarkRecoveredState({
    d1: d1(),
    lark: completeLark(),
  }, incident), true);

  assert.throws(
    () => assertChatwoot1dD1LarkRecoveredState({
      d1: d1(),
      lark: completeLark({ duplicateMetricKeys: 1 }),
    }, incident),
    (error) => error?.code === 'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_RESULT_MISMATCH',
  );
});
