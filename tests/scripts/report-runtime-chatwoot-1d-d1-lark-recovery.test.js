import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDashboardMetricScope } from '../../packages/config/src/dashboard-metric-readiness.js';
import { CHATWOOT_1D_EXACT_INCIDENT } from '../../scripts/lib/report-runtime-chatwoot-1d-incident-continuation.js';
import {
  assertChatwoot1dD1LarkRecoveredState,
  assertChatwoot1dD1LarkRecoveryPrestate,
  assertChatwoot1dD1LarkRecoveryWriteResult,
  assertChatwoot1dD1MaterializationUnchanged,
  normalizeChatwoot1dRetainedMaterializationForProjection,
} from '../../scripts/lib/report-runtime-chatwoot-1d-d1-lark-recovery.js';

const incident = CHATWOOT_1D_EXACT_INCIDENT;

function d1(overrides = {}) {
  return {
    report_id: incident.reportId,
    data_status: 'complete',
    payload_checksum: 'checksum-chatwoot-1d',
    payload_json: '{"retained":true}',
    generated_at: 1786016588074,
    materialization_count: 1,
    sync_status: incident.failedSync.status,
    successful_sync_count: 0,
    active_lock_count: 0,
    new_dlq_count: 1,
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

function retainedMaterialization(overrides = {}) {
  return {
    row: {
      report_id: incident.reportId,
    },
    payload: {
      platformScope: incident.platformScope,
      capability: incident.capability,
      metricPayload: {
        total_contacts: {
          metricKey: 'chatwoot:total_contacts',
          metricScope: 'period_end_snapshot',
        },
        conversations_created: {
          metricKey: 'chatwoot:conversations_created',
          metricScope: 'period_delta',
        },
      },
      collections: {
        dimension_metrics: [
          {
            metricKey: 'chatwoot:inbox:conversations_created',
            metricScope: 'period_delta',
          },
        ],
      },
      ...overrides,
    },
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

test('normalizes only the retained Chatwoot legacy scope in memory', () => {
  const retained = retainedMaterialization();
  const before = structuredClone(retained);
  const normalized = normalizeChatwoot1dRetainedMaterializationForProjection(
    retained,
    incident,
  );

  assert.deepEqual(retained, before);
  assert.notEqual(normalized.materialization, retained);
  assert.equal(
    normalized.materialization.payload.metricPayload.total_contacts.metricScope,
    'current_total',
  );
  assert.equal(
    normalized.materialization.payload.metricPayload.conversations_created.metricScope,
    'period_delta',
  );
  assert.equal(
    normalized.materialization.payload.collections.dimension_metrics[0].metricScope,
    'period_delta',
  );
  assert.deepEqual(normalized.compatibility, {
    legacyMetricScope: 'period_end_snapshot',
    canonicalMetricScope: 'current_total',
    legacyScopeRewriteCount: 1,
    persistedMaterializationMutated: false,
  });

  assert.throws(
    () => normalizeDashboardMetricScope('period_end_snapshot'),
    /Unsupported Dashboard metric scope: period_end_snapshot/u,
  );
});

test('retained projection fails closed for unknown scope or missing proved legacy scope', () => {
  assert.throws(
    () => normalizeChatwoot1dRetainedMaterializationForProjection(
      retainedMaterialization({
        metricPayload: {
          bad: { metricKey: 'chatwoot:bad', metricScope: 'future_scope' },
        },
      }),
      incident,
    ),
    (error) => error?.code === 'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_METRIC_SCOPE_INVALID',
  );

  assert.throws(
    () => normalizeChatwoot1dRetainedMaterializationForProjection(
      retainedMaterialization({
        metricPayload: {
          canonical: { metricKey: 'chatwoot:canonical', metricScope: 'current_total' },
        },
      }),
      incident,
    ),
    (error) => error?.code === 'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_LEGACY_SCOPE_NOT_PRESENT',
  );
});

test('requires retained D1 materialization to remain byte-identical across Lark projection', () => {
  const before = d1();
  assert.equal(assertChatwoot1dD1MaterializationUnchanged(before, { ...before }), true);
  assert.throws(
    () => assertChatwoot1dD1MaterializationUnchanged(before, {
      ...before,
      payload_checksum: 'changed-checksum',
    }),
    (error) => error?.code === 'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_D1_DRIFT',
  );
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
