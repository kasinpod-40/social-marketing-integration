import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportChannelWindowAssessment,
} from '../../scripts/lib/report-channel-remote-readiness.js';

function assessed(dataStatus) {
  return buildReportChannelWindowAssessment({
    windowDays: 3,
    d1: {
      materialization_count: 1,
      data_status: dataStatus,
    },
    lark: {
      snapshots: 1,
      metrics: 139,
      topContent: 0,
      topAds: 0,
      duplicateMetricKeys: 0,
    },
    integrityOk: true,
  });
}

test('source-unavailable materialization is repaired even when retained D1/Lark parity is internally stable', () => {
  const result = assessed('source_unavailable');
  assert.equal(result.ready, true);
  assert.equal(result.action, 'refresh_or_repair_materialization');
});

test('completed materialization remains reusable with the same stable D1/Lark shape', () => {
  const result = assessed('complete');
  assert.equal(result.ready, true);
  assert.equal(result.action, 'reuse_or_idempotent_verify');
});
