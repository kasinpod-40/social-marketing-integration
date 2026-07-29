import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveExactLarkTableEnvironment } from '../../scripts/lib/lark-dashboard-backfill-table-discovery.js';

const CONTRACTS = Object.freeze([
  Object.freeze({
    tableKey: 'mktReportSnapshots',
    envName: 'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
    names: Object.freeze(['🧾 MKT_Report_Snapshots', 'MKT_Report_Snapshots']),
  }),
  Object.freeze({
    tableKey: 'mktReportMetricValues',
    envName: 'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
    names: Object.freeze(['📊 MKT_Report_Metric_Values', 'MKT_Report_Metric_Values']),
  }),
]);

test('table discovery preserves configured IDs without requiring live inventory', () => {
  const sourceEnv = {
    LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl-snapshots',
    LARK_TABLE_MKT_REPORT_METRIC_VALUES: 'tbl-metrics',
  };
  const result = resolveExactLarkTableEnvironment({
    env: sourceEnv,
    liveTables: [],
    contracts: CONTRACTS,
  });
  assert.deepEqual(result.summary, {
    required: 2,
    fromEnvironment: 2,
    discovered: 0,
    tables: [
      { tableKey: 'mktReportSnapshots', source: 'environment' },
      { tableKey: 'mktReportMetricValues', source: 'environment' },
    ],
  });
  assert.equal(result.env.LARK_TABLE_MKT_REPORT_SNAPSHOTS, 'tbl-snapshots');
  assert.equal(sourceEnv.LARK_TABLE_MKT_REPORT_SNAPSHOTS, 'tbl-snapshots');
});

test('table discovery fills only missing IDs by exact schema alias', () => {
  const result = resolveExactLarkTableEnvironment({
    env: { LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl-snapshots' },
    liveTables: [
      { tableId: 'tbl-metrics', name: '📊 MKT_Report_Metric_Values' },
      { tableId: 'tbl-other', name: 'MKT_Report_Metric_Values Copy' },
    ],
    contracts: CONTRACTS,
  });
  assert.equal(result.env.LARK_TABLE_MKT_REPORT_SNAPSHOTS, 'tbl-snapshots');
  assert.equal(result.env.LARK_TABLE_MKT_REPORT_METRIC_VALUES, 'tbl-metrics');
  assert.deepEqual(result.summary, {
    required: 2,
    fromEnvironment: 1,
    discovered: 1,
    tables: [
      { tableKey: 'mktReportSnapshots', source: 'environment' },
      {
        tableKey: 'mktReportMetricValues',
        source: 'exact_name_discovery',
        matchedName: '📊 MKT_Report_Metric_Values',
      },
    ],
  });
});

test('table discovery fails closed when a required name is missing', () => {
  assert.throws(
    () => resolveExactLarkTableEnvironment({
      env: {},
      liveTables: [{ tableId: 'tbl-other', name: 'Other' }],
      contracts: [CONTRACTS[0]],
    }),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_TABLE_DISCOVERY_MISSING'
      && error.details.tableKey === 'mktReportSnapshots',
  );
});

test('table discovery fails closed when aliases match multiple live tables', () => {
  assert.throws(
    () => resolveExactLarkTableEnvironment({
      env: {},
      liveTables: [
        { tableId: 'tbl-1', name: '🧾 MKT_Report_Snapshots' },
        { tableId: 'tbl-2', name: 'MKT_Report_Snapshots' },
      ],
      contracts: [CONTRACTS[0]],
    }),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_TABLE_DISCOVERY_AMBIGUOUS',
  );
});

test('table discovery rejects one physical table assigned to two logical tables', () => {
  assert.throws(
    () => resolveExactLarkTableEnvironment({
      env: {
        LARK_TABLE_MKT_REPORT_SNAPSHOTS: 'tbl-shared',
        LARK_TABLE_MKT_REPORT_METRIC_VALUES: 'tbl-shared',
      },
      liveTables: [],
      contracts: CONTRACTS,
    }),
    (error) => error.code === 'LARK_DASHBOARD_BACKFILL_TABLE_DISCOVERY_ID_CONFLICT',
  );
});
