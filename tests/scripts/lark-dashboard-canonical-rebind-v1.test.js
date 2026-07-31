import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORGANIC_DASHBOARD_NAME,
  assertCanonicalOrganicMetricBinding,
  assertOrganicMetricBlockNames,
  collectLegacyFieldReferences,
  hasComputedDashboardValue,
  hasDashboardProtocol,
  rewriteDashboardBlockDataConfig,
} from '../../scripts/lib/lark-dashboard-canonical-rebind-v1.js';

test('rebinds an Organic KPI from Legacy display Select to exact metric_key', () => {
  const result = rewriteDashboardBlockDataConfig({
    dashboardName: ORGANIC_DASHBOARD_NAME,
    blockName: 'Total Views',
    dataConfig: {
      table_name: '📊 MKT_Report_Metric_Values',
      series: [{ field_name: 'current_value', rollup: 'SUM' }],
      filter: {
        conjunction: 'and',
        conditions: [
          {
            field_name: '__mkt_legacy_display_name_single_select_v2',
            operator: 'is',
            value: 'Latest total views',
          },
          { field_name: 'platform', operator: 'is', value: 'tiktok' },
        ],
      },
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.patch, {
    filter: {
      conjunction: 'and',
      conditions: [
        { field_name: 'platform', operator: 'is', value: 'tiktok' },
        { field_name: 'metric_key', operator: 'is', value: 'tiktok:latest_total_views' },
      ],
    },
  });
  assert.equal(collectLegacyFieldReferences(result.dataConfig).length, 0);
  assert.equal(assertCanonicalOrganicMetricBinding({
    blockName: 'Total Views',
    dataConfig: result.dataConfig,
  }), true);
});

test('fixes Baseline Covered Content by stable key instead of ambiguous display label', () => {
  const result = rewriteDashboardBlockDataConfig({
    dashboardName: ORGANIC_DASHBOARD_NAME,
    blockName: 'Baseline Covered Content',
    dataConfig: {
      filter: {
        conjunction: 'and',
        conditions: [{
          field_name: '__mkt_legacy_display_name_single_select_v2',
          operator: 'is',
          value: 'Baseline coverage',
        }],
      },
    },
  });
  assert.equal(result.metricKey, 'tiktok:baseline_covered_content_count');
  assert.equal(result.dataConfig.filter.conditions[0].value, 'tiktok:baseline_covered_content_count');
});

test('rewrites window slicer and chart groups to Number window_days', () => {
  const result = rewriteDashboardBlockDataConfig({
    dashboardName: '🛒 Commerce & Conversion',
    blockName: 'ช่วงรายงาน',
    dataConfig: {
      table_name: '📊 MKT_Report_Metric_Values',
      group_by: [{ field_name: '__mkt_legacy_window_days_single_select_v1', mode: 'integrated' }],
      default_value: '3',
      filter: {
        conjunction: 'and',
        conditions: [{
          field_name: '__mkt_legacy_window_days_single_select_v2',
          operator: 'is',
          value: ['7'],
        }],
      },
    },
  });
  assert.equal(result.dataConfig.group_by[0].field_name, 'window_days');
  assert.equal(result.dataConfig.default_value, 3);
  assert.equal(result.dataConfig.filter.conditions[0].field_name, 'window_days');
  assert.deepEqual(result.dataConfig.filter.conditions[0].value, [7]);
  assert.equal(collectLegacyFieldReferences(result.dataConfig).length, 0);
});

test('canonical Organic configuration is idempotent', () => {
  const dataConfig = {
    filter: {
      conjunction: 'and',
      conditions: [{ field_name: 'metric_key', operator: 'is', value: 'tiktok:period_views' }],
    },
  };
  const result = rewriteDashboardBlockDataConfig({
    dashboardName: ORGANIC_DASHBOARD_NAME,
    blockName: 'Period Views',
    dataConfig,
  });
  assert.equal(result.changed, false);
  assert.deepEqual(result.patch, {});
});

test('requires the exact 17 Organic KPI names', () => {
  const names = [
    'Period Engagement', 'Baseline Coverage Rate', 'Tracked Content',
    'Current Engagement Rate', 'Period Likes', 'Baseline Missing Content',
    'Period Comments', 'New Content', 'Total Engagement', 'Total Views',
    'Period Shares', 'Period Engagement Rate', 'Baseline Covered Content',
    'Period Views', 'Total Shares', 'Total Likes', 'Total Comments',
  ];
  assert.deepEqual(assertOrganicMetricBlockNames(names), { expectedCount: 17, actualCount: 17 });
  assert.throws(
    () => assertOrganicMetricBlockNames(names.slice(1)),
    { code: 'LARK_DASHBOARD_CANONICAL_REBIND_ORGANIC_BLOCK_SET_INVALID' },
  );
  assert.throws(
    () => assertOrganicMetricBlockNames([...names, 'Total Views']),
    { code: 'LARK_DASHBOARD_CANONICAL_REBIND_ORGANIC_BLOCK_SET_INVALID' },
  );
});

test('validates computed dashboard protocol and numeric measure', () => {
  const protocol = {
    dimensions: [],
    measures: [{ alias: 'me_value', field_name: 'current_value', aggregation: 'sum' }],
    main_data: [{ me_value: { value: 123 } }],
  };
  assert.equal(hasDashboardProtocol(protocol), true);
  assert.equal(hasComputedDashboardValue(protocol), true);
  assert.equal(hasComputedDashboardValue({ ...protocol, main_data: [{ me_value: { value: null } }] }), false);
});
