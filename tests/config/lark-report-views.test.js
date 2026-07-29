import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_REPORT_VIEWS,
  LARK_REPORT_VIEW_VERSION,
  validateReportViewDefinition,
} from '../../packages/config/src/lark-report-views.js';

test('report client view contract is universal, immutable, and covers every Report output table', () => {
  assert.equal(validateReportViewDefinition(), true);
  assert.equal(LARK_REPORT_VIEW_VERSION, 'report-client-views-v2.0');
  assert.equal(Object.isFrozen(LARK_REPORT_VIEWS), true);
  assert.deepEqual(LARK_REPORT_VIEWS.map((table) => table.tableKey), [
    'mktReportSnapshots',
    'mktReportMetricValues',
    'mktReportTopContent',
    'mktReportTopAds',
  ]);

  const hiddenFields = LARK_REPORT_VIEWS.flatMap((table) => table.views.flatMap((view) => view.hiddenFields));
  assert.equal(hiddenFields.includes('report_id') && hiddenFields.includes('report_metric_key'), false);
  assert.equal(hiddenFields.includes('report_content_key'), false);
  assert.equal(hiddenFields.includes('report_ad_key'), false);

  const names = LARK_REPORT_VIEWS.flatMap((table) => table.views.map((view) => view.name));
  assert.deepEqual(names, [
    '🧭 Dashboard Reports',
    '📊 Client Metrics',
    '🧭 Dashboard Metrics',
    '📊 Daily Metrics',
    '📈 Weekly Metrics',
    '🏆 Top Content',
    '🧭 Dashboard Top Content',
    '🏆 Daily Top Content',
    '🏅 Weekly Top Content',
    '💰 Top Ads',
    '🧭 Dashboard Top Ads',
  ]);
});

test('Dashboard Views never hardcode a platform or account filter', () => {
  const dashboardViews = LARK_REPORT_VIEWS
    .flatMap((table) => table.views)
    .filter((view) => view.name.includes('Dashboard'));
  assert.equal(dashboardViews.length, 4);

  for (const view of dashboardViews) {
    const fields = view.filterInfo.conditions.map((condition) => condition.fieldName);
    assert.equal(fields.includes('platform'), false);
    assert.equal(fields.includes('account_id'), false);
    assert.equal(view.filterInfo.conditions.some((condition) => (
      condition.fieldName === 'report_type' && condition.value === 'dashboard_performance_report'
    )), true);
  }
});

test('report client view contract rejects duplicate view names', () => {
  assert.throws(
    () => validateReportViewDefinition([{
      tableKey: 'duplicate', envName: 'TABLE_ID',
      views: [
        { key: 'one', name: 'Same', type: 'grid', hiddenFields: [], filterInfo: { conjunction: 'and', conditions: [{ fieldName: 'status', operator: 'is', value: 'a' }] } },
        { key: 'two', name: ' same ', type: 'grid', hiddenFields: [], filterInfo: { conjunction: 'and', conditions: [{ fieldName: 'status', operator: 'is', value: 'b' }] } },
      ],
    }]),
    (error) => error.code === 'LARK_REPORT_VIEW_CONTRACT_INVALID',
  );
});
