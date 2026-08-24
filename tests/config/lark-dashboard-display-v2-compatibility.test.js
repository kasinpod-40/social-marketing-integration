import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_DASHBOARD_DISPLAY_V2_COMPATIBILITY_VERSION,
  LARK_DASHBOARD_DISPLAY_V2_FIELD,
  ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY,
  ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX,
  ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS,
  ORGANIC_DASHBOARD_CUSTOMER_PROFILES,
  ORGANIC_DASHBOARD_METRIC_SUFFIXES,
  ORGANIC_DASHBOARD_PLATFORMS,
  ORGANIC_DASHBOARD_WINDOWS,
  isReviewedOrganicDashboardCompatibilityProfile,
  isReviewedOrganicDashboardDisplayV2Alias,
  resolveOrganicDashboardDisplayV2,
  resolveOrganicDashboardDisplayV2ByMetricKey,
  resolveTikTokOrganicDashboardDisplayV2,
} from '../../packages/config/src/lark-dashboard-display-v2-compatibility.js';

test('display v2 compatibility locks one 17 x 4 x 4 Organic Dashboard matrix', () => {
  assert.equal(LARK_DASHBOARD_DISPLAY_V2_COMPATIBILITY_VERSION, 'lark_dashboard_display_v2_compatibility_v5');
  assert.deepEqual(LARK_DASHBOARD_DISPLAY_V2_FIELD, {
    fieldId: 'fldHNUhCfl',
    fieldName: '__mkt_legacy_display_name_single_select_v2',
    type: 3,
  });
  assert.deepEqual(ORGANIC_DASHBOARD_WINDOWS, [1, 3, 7, 30]);
  assert.deepEqual(ORGANIC_DASHBOARD_PLATFORMS, [
    'facebook',
    'instagram',
    'tiktok',
    'youtube',
  ]);
  assert.deepEqual(ORGANIC_DASHBOARD_CUSTOMER_PROFILES, [
    'integration_workspace',
    'chemistry_k',
  ]);
  assert.equal(ORGANIC_DASHBOARD_METRIC_SUFFIXES.length, 17);
  assert.equal(new Set(ORGANIC_DASHBOARD_METRIC_SUFFIXES).size, 17);
  assert.equal(ORGANIC_DASHBOARD_DISPLAY_V2_OPTIONS.length, 17);
  assert.equal(Object.keys(ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_KEY).length, 68);
  assert.equal(isReviewedOrganicDashboardCompatibilityProfile('integration_workspace'), true);
  assert.equal(isReviewedOrganicDashboardCompatibilityProfile('chemistry_k'), true);
  assert.equal(isReviewedOrganicDashboardCompatibilityProfile('foreign_profile'), false);
});

test('all four Organic platforms resolve the same reviewed KPI labels from platform-local metric keys', () => {
  for (const platform of ORGANIC_DASHBOARD_PLATFORMS) {
    assert.equal(
      resolveOrganicDashboardDisplayV2ByMetricKey(`${platform}:period_views`, platform),
      'Views',
    );
    assert.equal(
      resolveOrganicDashboardDisplayV2ByMetricKey(
        `${platform}:baseline_covered_content_count`,
        platform,
      ),
      'Baseline coverage',
    );
    assert.equal(
      resolveOrganicDashboardDisplayV2ByMetricKey(
        `${platform}:baseline_coverage_rate`,
        platform,
      ),
      'Baseline Coverage Rate',
    );
  }
  assert.equal(ORGANIC_DASHBOARD_DISPLAY_V2_BY_METRIC_SUFFIX.period_views, 'Views');
  assert.equal(
    resolveOrganicDashboardDisplayV2ByMetricKey('facebook:period_views', 'instagram'),
    null,
  );
});

test('permanent writer compatibility follows both reviewed Organic dashboard profiles, not provider account id', () => {
  for (const customerProfile of ORGANIC_DASHBOARD_CUSTOMER_PROFILES) {
    for (const platform of ORGANIC_DASHBOARD_PLATFORMS) {
      const target = {
        customerProfile,
        accountId: `${platform}-provider-native-id`,
        platform,
        capability: 'organic',
        reportType: 'dashboard_performance_report',
        metricKey: `${platform}:period_views`,
      };
      assert.equal(resolveOrganicDashboardDisplayV2(target), 'Views');
    }
  }

  const target = {
    customerProfile: 'integration_workspace',
    accountId: 'chemistry_k',
    platform: 'tiktok',
    capability: 'organic',
    reportType: 'dashboard_performance_report',
    metricKey: 'tiktok:period_views',
  };
  assert.equal(resolveTikTokOrganicDashboardDisplayV2(target), 'Views');
  assert.equal(resolveOrganicDashboardDisplayV2({ ...target, accountId: 'other_account' }), 'Views');
  assert.equal(resolveOrganicDashboardDisplayV2({ ...target, customerProfile: 'foreign_profile' }), null);
  assert.equal(resolveOrganicDashboardDisplayV2({ ...target, platform: 'meta_ads' }), null);
  assert.equal(resolveOrganicDashboardDisplayV2({ ...target, capability: 'paid_ads' }), null);
  assert.equal(resolveOrganicDashboardDisplayV2({ ...target, reportType: 'daily_organic_report' }), null);
  assert.equal(resolveOrganicDashboardDisplayV2({ ...target, metricKey: 'tiktok:unknown' }), null);
});

test('only the historical TikTok baseline-rate alias remains reviewed', () => {
  assert.equal(
    isReviewedOrganicDashboardDisplayV2Alias({
      metricKey: 'tiktok:baseline_coverage_rate',
      value: 'Baseline coverage',
    }),
    true,
  );
  assert.equal(
    isReviewedOrganicDashboardDisplayV2Alias({
      metricKey: 'facebook:baseline_coverage_rate',
      value: 'Baseline coverage',
    }),
    false,
  );
});
