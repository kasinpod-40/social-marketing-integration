import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_DASHBOARD_DISPLAY_V2_FIELD,
  TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY,
  TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS,
  TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS,
  TIKTOK_ORGANIC_DASHBOARD_WINDOWS,
  isReviewedTikTokOrganicDashboardDisplayV2Alias,
  resolveTikTokOrganicDashboardDisplayV2,
  resolveTikTokOrganicDashboardDisplayV2ByMetricKey,
} from '../../packages/config/src/lark-dashboard-display-v2-compatibility.js';

test('display v2 compatibility locks the audited physical field and 17 x 4 dashboard matrix', () => {
  assert.deepEqual(LARK_DASHBOARD_DISPLAY_V2_FIELD, {
    fieldId: 'fldHNUhCfl',
    fieldName: '__mkt_legacy_display_name_single_select_v2',
    type: 3,
  });
  assert.deepEqual(TIKTOK_ORGANIC_DASHBOARD_WINDOWS, [1, 3, 7, 30]);
  assert.equal(TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS.length, 17);
  assert.equal(new Set(TIKTOK_ORGANIC_DASHBOARD_METRIC_KEYS).size, 17);
  assert.equal(TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS.length, 17);
  assert.equal(new Set(TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS).size, 17);
  assert.equal(
    Object.keys(TIKTOK_ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY).length,
    17,
  );
});

test('baseline covered count and baseline coverage rate keep distinct audited Dashboard labels', () => {
  assert.equal(
    resolveTikTokOrganicDashboardDisplayV2ByMetricKey(
      'tiktok:baseline_covered_content_count',
    ),
    'Baseline coverage',
  );
  assert.equal(
    resolveTikTokOrganicDashboardDisplayV2ByMetricKey(
      'tiktok:baseline_coverage_rate',
    ),
    'Baseline Coverage Rate',
  );
  assert.equal(
    isReviewedTikTokOrganicDashboardDisplayV2Alias({
      metricKey: 'tiktok:baseline_coverage_rate',
      value: 'Baseline coverage',
    }),
    true,
  );
  assert.equal(
    isReviewedTikTokOrganicDashboardDisplayV2Alias({
      metricKey: 'tiktok:baseline_covered_content_count',
      value: 'Baseline Coverage Rate',
    }),
    false,
  );
});

test('permanent writer compatibility is restricted to the exact Integration Workspace scope', () => {
  const target = {
    customerProfile: 'integration_workspace',
    accountId: 'chemistry_k',
    platform: 'tiktok',
    capability: 'organic',
    reportType: 'dashboard_performance_report',
    metricKey: 'tiktok:period_views',
  };
  assert.equal(resolveTikTokOrganicDashboardDisplayV2(target), 'Views');
  assert.equal(
    resolveTikTokOrganicDashboardDisplayV2({ ...target, customerProfile: 'chemistry_k' }),
    null,
  );
  assert.equal(
    resolveTikTokOrganicDashboardDisplayV2({ ...target, accountId: 'other_account' }),
    null,
  );
  assert.equal(
    resolveTikTokOrganicDashboardDisplayV2({ ...target, platform: 'youtube' }),
    null,
  );
  assert.equal(
    resolveTikTokOrganicDashboardDisplayV2({ ...target, capability: 'paid_ads' }),
    null,
  );
  assert.equal(
    resolveTikTokOrganicDashboardDisplayV2({ ...target, reportType: 'daily_organic_report' }),
    null,
  );
  assert.equal(
    resolveTikTokOrganicDashboardDisplayV2({ ...target, metricKey: 'tiktok:unknown' }),
    null,
  );
});
