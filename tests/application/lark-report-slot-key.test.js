import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLarkMetricSlotKey,
  buildLarkReportSlotBase,
  buildLarkTopAdsSlotKey,
  buildLarkTopContentSlotKey,
  stripReportIdentityPrefix,
} from '../../packages/application/src/reports/lark-report-slot-key.js';

test('rolling report slot stays stable when historical report_id period changes', () => {
  const common = {
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    capability: 'organic',
    platform: 'tiktok',
    accountId: 'chemistry_k',
    reportType: 'dashboard_performance_report',
    periodKind: 'rolling_days',
    windowDays: 7,
  };
  const first = buildLarkReportSlotBase({
    ...common,
    reportId: 'integration_workspace:tiktok:rolling:7d:chemistry_k:rolling_days:2026-07-25:2026-07-31:tiktok-organic-v1',
  });
  const second = buildLarkReportSlotBase({
    ...common,
    reportId: 'integration_workspace:tiktok:rolling:7d:chemistry_k:rolling_days:2026-08-03:2026-08-09:tiktok-organic-v1',
  });
  assert.equal(first, second);
});

test('custom range slot remains request scoped', () => {
  const base = {
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    capability: 'organic',
    platform: 'tiktok',
    accountId: 'chemistry_k',
    reportType: 'dashboard_performance_report',
    periodKind: 'custom_range',
    windowDays: null,
  };
  assert.notEqual(
    buildLarkReportSlotBase({ ...base, reportId: 'custom-report-1' }),
    buildLarkReportSlotBase({ ...base, reportId: 'custom-report-2' }),
  );
});

test('metric and ranked collection slot keys preserve stable row identity without report period', () => {
  const slot = buildLarkReportSlotBase({
    reportId: 'report-2026-08-09',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    capability: 'paid_ads',
    platform: 'google_ads',
    accountId: 'chemistry_k',
    reportType: 'dashboard_performance_report',
    periodKind: 'rolling_days',
    windowDays: 7,
  });
  const metricSuffix = 'google_ads%3Aspend_micros::summary::all';
  assert.equal(
    stripReportIdentityPrefix(`report-2026-08-09::${metricSuffix}`),
    metricSuffix,
  );
  assert.equal(
    buildLarkMetricSlotKey(slot, `report-2026-08-09::${metricSuffix}`),
    `${slot}::metric::${metricSuffix}`,
  );
  assert.equal(buildLarkTopContentSlotKey(slot, 3), `${slot}::content_rank:3`);
  assert.equal(buildLarkTopAdsSlotKey(slot, 4), `${slot}::ad_rank:4`);
});
