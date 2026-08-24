import test from 'node:test';
import assert from 'node:assert/strict';
import {
  writeDashboardMaterializationToLark,
} from '../../packages/application/src/use-cases/write-dashboard-materialization-to-lark.js';

const LEGACY_WINDOW = '__mkt_legacy_window_days_single_select_v1';

function materialization(windowDays = 3) {
  return {
    row: {
      report_id: 'report-1',
      report_setting_key: 'setting-1',
      customer_key: 'chemistry_k',
      account_key: 'chemistry_k',
      report_type: 'dashboard_performance_report',
      period_kind: 'rolling_days',
      window_days: windowDays,
      period_start: '2026-08-01',
      period_end: '2026-08-03',
      compare_start: null,
      compare_end: null,
      data_status: 'complete',
      coverage_rate: 1,
      generated_at: 1785790800000,
      formula_version: 'test-v1',
    },
    payload: {
      capability: 'commerce',
      platformScope: 'woocommerce',
      dataStatus: 'complete',
      coverageRate: 1,
      period: {
        periodStart: '2026-08-01',
        periodEnd: '2026-08-03',
        compareStart: null,
        compareEnd: null,
        comparisonMode: 'none',
      },
      metricPayload: [{
        metricKey: 'commerce:orders',
        stableMetricKey: 'commerce:orders',
        displayName: 'Orders',
        current: 5,
        compare: null,
        change: null,
        changePercent: null,
        unit: 'count',
        formulaVersion: 'test-v1',
        clientVisible: true,
      }],
      collections: { dimension_metrics: [] },
      topContent: [],
      topAds: [],
    },
  };
}

test('both reviewed Dashboard runtimes write Number authority and preserved Select mirror', async () => {
  for (const customerProfile of ['integration_workspace', 'chemistry_k']) {
    const captured = [];
    await writeDashboardMaterializationToLark({
      reader: { async readById() { return materialization(3); } },
      repository: {},
      syncEngine: {
        async planByKey(input) {
          captured.push(input);
          return { tableId: input.tableId, rows: input.rows };
        },
        async executePlan(plan) { return { ok: true, rowCount: plan.rows.length }; },
      },
      reportId: 'report-1',
      customerProfile,
      utcOffset: '+07:00',
      tables: {
        mktReportSnapshots: 'tblSnapshots',
        mktReportMetricValues: 'tblMetrics',
      },
    });

    const metricPlan = captured.find((entry) => entry.tableId === 'tblMetrics');
    assert.ok(metricPlan);
    assert.equal(metricPlan.rows.length, 1);
    assert.equal(metricPlan.rows[0].window_days, 3);
    assert.equal(metricPlan.rows[0][LEGACY_WINDOW], '3');
  }
});

test('non-Integration Workspace Metric rows retain Select text and no private mirror', async () => {
  const captured = [];
  await writeDashboardMaterializationToLark({
    reader: { async readById() { return materialization(3); } },
    repository: {},
    syncEngine: {
      async planByKey(input) {
        captured.push(input);
        return { tableId: input.tableId, rows: input.rows };
      },
      async executePlan(plan) { return { ok: true, rowCount: plan.rows.length }; },
    },
    reportId: 'report-1',
    customerProfile: 'customer_production',
    utcOffset: '+07:00',
    tables: {
      mktReportSnapshots: 'tblSnapshots',
      mktReportMetricValues: 'tblMetrics',
    },
  });

  const metricPlan = captured.find((entry) => entry.tableId === 'tblMetrics');
  assert.equal(Object.hasOwn(metricPlan.rows[0], LEGACY_WINDOW), false);
  assert.equal(metricPlan.rows[0].window_days, '3');
});
