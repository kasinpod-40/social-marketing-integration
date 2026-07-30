import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORGANIC_DASHBOARD_READINESS_METRIC_KEYS,
  assertOrganicDashboardReadinessWindow,
} from '../../scripts/lib/organic-dashboard-readiness-refresh.js';

test('live readiness verifier rejects a null current-total metric even though Number(null) is zero', () => {
  const metricPayload = {};
  for (const metricKey of ORGANIC_DASHBOARD_READINESS_METRIC_KEYS) {
    const suffix = metricKey.split(':')[1];
    const period = suffix.startsWith('period_');
    const currentTotal = suffix.startsWith('latest_');
    const metricScope = period ? 'period_delta' : (currentTotal ? 'current_total' : 'data_quality');
    metricPayload[metricKey] = {
      metricKey,
      current: period ? null : 1,
      metricScope,
      availabilityStatus: period ? 'baseline_incomplete' : 'available',
      availabilityMessage: period ? 'N/A — Baseline ยังไม่ครบ' : 'พร้อมใช้งาน',
    };
  }
  metricPayload['tiktok:latest_total_likes'].current = null;
  const larkRows = Object.values(metricPayload).map((metric) => ({
    metricKey: metric.metricKey,
    currentValue: metric.current,
    metricScope: metric.metricScope,
    availabilityStatus: metric.availabilityStatus,
    availabilityMessage: metric.availabilityMessage,
  }));
  assert.throws(
    () => assertOrganicDashboardReadinessWindow({
      windowDays: 1,
      payload: { coverageRate: 0.5, metricPayload },
      larkRows,
    }),
    /Current-total Organic metric is not available/u,
  );
});
