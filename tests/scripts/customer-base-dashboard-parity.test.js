import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_CONFIRMATION,
  applyCustomerBaseDashboardParity,
  buildCustomerBaseDashboardParityPlan,
} from '../../scripts/lib/customer-base-dashboard-parity.js';

const AUTHORITIES = [
  ['💬 Customer Service & Leads', 11, ['slicer']],
  ['🛡️ Data Quality & Operations', 8, ['table_view', 'table_view']],
  ['📊 Executive Marketing Overview', 11, ['slicer']],
  ['🌱 Organic Performance', 22, ['slicer', 'slicer']],
  ['💰 Paid Ads Performance', 13, ['slicer', 'slicer']],
  ['🛒 Commerce & Conversion', 10, ['slicer']],
];

class FakeSourceClient {
  constructor() {
    this.resources = {
      dashboards: AUTHORITIES.map((entry, index) => makeDashboard(index + 1, ...entry)),
      workflows: [],
      roles: [],
      accessConfig: {},
      extraInfo: {},
    };
  }
  async listTables() {
    return [{ tableId: 'tbl_source_123456', name: '📊 MKT_Report_Metric_Values' }];
  }
  async listFields() {
    return [
      { fieldId: 'fld_value_123456', fieldName: 'current_value', type: 2, property: null },
      { fieldId: 'fld_metric_123456', fieldName: 'metric_key', type: 1, property: null },
      {
        fieldId: 'fld_period_123456',
        fieldName: '__mkt_legacy_window_days_single_select_v1',
        type: 3,
        property: { options: [{ id: 'opt_7_123456', name: '7' }] },
      },
    ];
  }
  async listViews() {
    return [{ viewId: 'vew_dashboard_123456', viewName: '📊 Dashboard View' }];
  }
  getExportResources() {
    return structuredClone(this.resources);
  }
}

test('dashboard plan converts exact six-dashboard Source into 66 documented API blocks plus 9 reviewed remainders', async () => {
  const plan = await buildCustomerBaseDashboardParityPlan({ sourceClient: new FakeSourceClient() });
  assert.equal(plan.ok, true);
  assert.equal(plan.summary.dashboardCount, 6);
  assert.equal(plan.summary.dashboardBlockCount, 75);
  assert.equal(plan.summary.documentedApiBlockCount, 66);
  assert.equal(plan.summary.unsupportedBlockCount, 9);
  assert.deepEqual(plan.summary.unsupportedByKind, { slicer: 7, table_view: 2 });
  assert.deepEqual(plan.dashboards.map((item) => item.name), AUTHORITIES.map(([name]) => name));

  const statistic = plan.dashboards[0].blocks.find((item) => item.type === 'statistics');
  assert.deepEqual(statistic.dataConfig, {
    table_name: '📊 MKT_Report_Metric_Values',
    series: [{ field_name: 'current_value', rollup: 'SUM' }],
    filter: {
      conjunction: 'and',
      conditions: [{ field_name: 'metric_key', operator: 'contains', value: 'metric:test' }],
    },
    number_format: { formatName: 'digital', precision: 2 },
  });
  assert.deepEqual(statistic.position, { x: 4, y: 2, w: 4, h: 2 });

  const slicer = plan.dashboards[0].blocks.find((item) => item.sourceKind === 'slicer');
  assert.equal(slicer.supportedByDocumentedApi, false);
  assert.equal(slicer.manualReference.tableName, '📊 MKT_Report_Metric_Values');
  assert.equal(slicer.manualReference.fieldName, '__mkt_legacy_window_days_single_select_v1');
  assert.equal(slicer.manualReference.defaultValue, '7');

  const tableViews = plan.dashboards[1].blocks.filter((item) => item.sourceKind === 'table_view');
  assert.equal(tableViews.length, 2);
  assert.deepEqual(tableViews[0].manualReference, {
    tableName: '📊 MKT_Report_Metric_Values',
    viewName: '📊 Dashboard View',
  });
});

test('dashboard apply requires exact confirmation before any Target request', async () => {
  let requests = 0;
  const targetClient = {
    appToken: 'target_app_token',
    async listTables() { requests += 1; return []; },
    async requestBitableJson() { requests += 1; return { data: {} }; },
  };
  const plan = await buildCustomerBaseDashboardParityPlan({ sourceClient: new FakeSourceClient() });
  await assert.rejects(
    () => applyCustomerBaseDashboardParity({ plan, targetClient, mode: 'apply', confirmation: 'WRONG' }),
    (error) => error.code === 'CUSTOMER_BASE_DASHBOARD_CONFIRMATION_REQUIRED',
  );
  assert.equal(requests, 0);
  assert.equal(
    CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_CONFIRMATION,
    'APPLY_CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_PARITY_V1',
  );
});

function makeDashboard(ordinal, name, chartCount, unsupportedKinds) {
  const chartSpecs = [
    { kind: 'text', name, top: true },
    ...unsupportedKinds.map((kind, index) => ({ kind, name: `${kind}-${ordinal}-${index + 1}` })),
  ];
  while (chartSpecs.length < chartCount) {
    chartSpecs.push({ kind: 'statistics', name: `KPI ${ordinal}-${chartSpecs.length}` });
  }

  const charts = [];
  const children = [];
  const map = {};
  const position = {};
  chartSpecs.forEach((spec, index) => {
    const widgetId = `widget_${ordinal}_${index}`;
    const chartID = `chart_${ordinal}_${index}`;
    const token = `token_${ordinal}_${index}`;
    children.push(widgetId);
    const pos = index === 0
      ? { x: 0, y: 0, w: 12, h: 2 }
      : {
        x: ((index - 1) % 3) * 4,
        y: 2 + Math.floor((index - 1) / 3) * 2,
        w: 4,
        h: 2,
      };
    position[widgetId] = pos;
    map[widgetId] = makeWidget(spec, chartID, token);
    charts.push({ chartID, token, subType: subtype(spec.kind), snapshot: b64(makeChartSnapshot(spec)) });
  });
  map.rootWidget = {
    type: 'LAYOUT',
    children,
    data: { desktop: { position } },
  };
  return {
    dashboardID: `dashboard_${ordinal}`,
    token: `dashboard_token_${ordinal}`,
    isAdvancedPermEnabled: false,
    snapshot: b64({ map, theme: { themeStyle: 'summerBreeze' } }),
    charts,
  };
}

function makeWidget(spec, chartID, token) {
  if (spec.kind === 'slicer') {
    return { name: '切片器', typeV2: 'SLICER', data: { chartId: chartID, token, chartType: 'slicer' } };
  }
  if (spec.kind === 'table_view') {
    return {
      name: spec.name,
      typeV2: 'TABLE_VIEW',
      data: {
        chartId: chartID,
        token,
        tableId: 'tbl_source_123456',
        viewId: 'vew_dashboard_123456',
      },
    };
  }
  if (spec.kind === 'text') {
    return { name: 'Text', typeV2: 'RICH_TEXT', data: { chartId: chartID, token } };
  }
  return {
    name: spec.name,
    typeV2: 'CHART',
    data: { chartId: chartID, token, chartType: 'statistic' },
  };
}

function makeChartSnapshot(spec) {
  if (spec.kind === 'text') {
    return {
      text: {
        initialAttributedTexts: { text: { 0: `*${spec.name}\n*Description` } },
        apool: { numToAttrib: { 0: ['heading', 'h2'] } },
      },
      viewModel: { chartKind: 134217728 },
    };
  }
  if (spec.kind === 'slicer') {
    return {
      dataSources: [{
        rangeDefinition: JSON.stringify({
          refMap: { '#ref': 'tbl_source_123456' },
          dataCondition: {
            seriesArray: 'COUNTA',
            group: [{ fieldId: 'fld_period_123456' }],
            source: { type: 'CUSTOM', filterInfo: null },
          },
        }),
      }],
      dataSourcesExtra: {
        slicer: {
          desc: `📅 Period ${spec.name}`,
          defaultValue: 'opt_7_123456',
          selectMode: 'single',
          displayMode: 'tiled',
        },
      },
      viewModel: { chartKind: 2147483948 },
    };
  }
  if (spec.kind === 'table_view') {
    return {
      tableView: {
        tableId: 'tbl_source_123456',
        viewId: 'vew_dashboard_123456',
        viewType: 1,
      },
      viewModel: { chartKind: 1073741825 },
    };
  }
  return {
    dataSources: [{
      rangeDefinition: JSON.stringify({
        refMap: { '#ref': 'tbl_source_123456' },
        dataCondition: {
          seriesArray: [{ fieldId: 'fld_value_123456', rollup: 'SUM' }],
          source: {
            type: 'CUSTOM',
            filterInfo: {
              conjunction: 'and',
              conditions: [{
                fieldId: 'fld_metric_123456',
                fieldType: 1,
                operator: 'contains',
                value: ['metric:test'],
              }],
            },
          },
        },
      }),
    }],
    viewModel: {
      chartKind: 4194304,
      rules: {
        statistics: { formatInfo: { formatName: 'digital', precision: 2 } },
      },
    },
  };
}

function subtype(kind) {
  return kind === 'text' ? 7 : kind === 'slicer' ? 14 : kind === 'table_view' ? 11 : 0;
}
function b64(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}
