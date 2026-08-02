import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertReportRuntimeMetricIntegrity,
} from '../../scripts/lib/report-runtime-window-repair.js';
import {
  assertReportRuntimeMetricNullRepairReadback,
  buildReportRuntimeMetricNullRepairPlan,
} from '../../scripts/lib/report-runtime-lark-metric-null-repair.js';

const nullMetricKeys = [
  'tiktok:period_views',
  'tiktok:period_likes',
  'tiktok:period_comments',
  'tiktok:period_shares',
  'tiktok:period_engagement',
  'tiktok:period_engagement_rate',
];

function payload() {
  return {
    platformScope: 'tiktok',
    capability: 'organic',
    metricPayload: {
      ...Object.fromEntries(nullMetricKeys.map((metricKey) => [metricKey, {
        current: null,
        compare: null,
        change: null,
        changePercent: null,
      }])),
      'tiktok:new_content_count': { current: 1, compare: 0, change: 1, changePercent: null },
      'tiktok:tracked_content_count': { current: 130, compare: 130, change: 0, changePercent: 0 },
      'tiktok:baseline_coverage_rate': { current: 129 / 130, compare: 1, change: (129 / 130) - 1, changePercent: (129 / 130) - 1 },
      'tiktok:latest_total_views': { current: 12345, compare: 12000, change: 345, changePercent: 0.02875 },
    },
  };
}

function records() {
  return Object.entries(payload().metricPayload).map(([metricKey, metric], index) => ({
    recordId: `rec_${index + 1}`,
    fields: {
      metric_key: metricKey,
      current_value: metric.current === null ? index + 100 : Number(metric.current.toFixed(4)),
      compare_value: metric.compare === null ? null : Number(metric.compare.toFixed(4)),
      change_value: metric.change === null ? null : Number(metric.change.toFixed(4)),
      change_percent: metric.changePercent === null ? null : Number(metric.changePercent.toFixed(4)),
    },
  }));
}

test('exact Report metric null repair accepts only the six approved stale Organic KPI cells', () => {
  const plan = buildReportRuntimeMetricNullRepairPlan({ payload: payload(), records: records() });
  assert.equal(plan.metricCount, 10);
  assert.equal(plan.staleNullableCurrentCount, 6);
  assert.equal(plan.nonRepairableCurrentMismatchCount, 0);
  assert.equal(plan.updates.length, 10);
  const updatesByMetricKey = new Map(plan.updates.map((update) => {
    const record = records().find((candidate) => candidate.recordId === update.recordId);
    return [record.fields.metric_key, update];
  }));
  for (const metricKey of nullMetricKeys) {
    assert.equal(updatesByMetricKey.get(metricKey).fields.current_value, null);
  }
});

test('exact Report metric null repair rejects drift outside the approved stale-null set', () => {
  const drifted = records();
  drifted.at(-1).fields.current_value += 1;
  assert.throws(
    () => buildReportRuntimeMetricNullRepairPlan({ payload: payload(), records: drifted }),
    (error) => error.code === 'REPORT_RUNTIME_METRIC_NULL_REPAIR_DRIFT_NOT_APPROVED'
      && error.details.nonRepairableCurrentMismatchCount === 1,
  );
});

test('Report metric null repair readback verifies all four nullable number fields', () => {
  const repaired = Object.entries(payload().metricPayload).map(([metricKey, metric], index) => ({
    recordId: `rec_${index + 1}`,
    fields: {
      metric_key: metricKey,
      current_value: metric.current === null ? null : Number(metric.current.toFixed(4)),
      compare_value: metric.compare === null ? null : Number(metric.compare.toFixed(4)),
      change_value: metric.change === null ? null : Number(metric.change.toFixed(4)),
      change_percent: metric.changePercent === null ? null : Number(metric.changePercent.toFixed(4)),
    },
  }));
  assert.deepEqual(
    assertReportRuntimeMetricNullRepairReadback({ payload: payload(), records: repaired }),
    { metricCount: 10, mismatchCount: 0 },
  );
});

test('D1/Lark integrity compares numbers at the four-decimal Lark formatter precision', () => {
  assert.deepEqual(assertReportRuntimeMetricIntegrity({
    payload: { metricPayload: { ratio: { current: 1 / 3 } } },
    larkMetrics: { ratio: 0.3333 },
  }), {
    metricCount: 1,
    summaryMetricCount: 1,
    dimensionMetricCount: 0,
    mismatchCount: 0,
  });
});

test('D1/Lark integrity classifies stale nullable values separately from non-repairable drift', () => {
  assert.throws(() => assertReportRuntimeMetricIntegrity({
    payload: { metricPayload: { nullable: { current: null }, finite: { current: 4 } } },
    larkMetrics: { nullable: 9, finite: 5 },
  }), (error) => error.code === 'REPORT_RUNTIME_WINDOW_REPAIR_METRIC_VALUE_DRIFT'
    && error.details.metricCount === 2
    && error.details.staleNullableMismatchCount === 1
    && error.details.nonRepairableMismatchCount === 1);
});
