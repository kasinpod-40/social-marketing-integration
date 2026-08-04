import test from 'node:test';
import assert from 'node:assert/strict';
import { planLarkReportSchema } from '../../packages/application/src/use-cases/install-lark-report-schema.js';
import { validateReportMaterializationPayload } from '../../packages/application/src/reports/report-materialization-payload.js';
import { writeDashboardMaterializationToLark } from '../../packages/application/src/use-cases/write-dashboard-materialization-to-lark.js';
import {
  LARK_REPORT_SCHEMA_V2,
  LARK_REPORT_SCHEMA_V2_VERSION,
  validateReportSchemaV2,
} from '../../packages/config/src/lark-report-schema-v2.js';
import { LARK_REPORT_VIEWS } from '../../packages/config/src/lark-report-views.js';
import { D1ReportMaterializationReader } from '../../packages/connectors/src/d1-report-materialization-reader.js';
import { createReportId } from '../../packages/application/src/storage/marketing-history-contract.js';
import { createStableFingerprint } from '../../packages/shared/src/hash/stable-fingerprint.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';

const GENERATED_AT = Date.parse('2026-07-28T00:00:00Z');
const LEGACY_WINDOW = '__mkt_legacy_window_days_single_select_v1';
const TABLES = Object.freeze({
  mktReportSnapshots: 'snapshots',
  mktReportMetricValues: 'metrics',
  mktReportTopContent: 'top_content',
  mktReportTopAds: 'top_ads',
});
const SHARED_FIELDS = Object.freeze([
  'customer_key',
  'customer_profile',
  'capability',
  'platform',
  'account_id',
  'report_setting_key',
  'report_type',
  'period_kind',
  'window_days',
  'period_start',
  'period_end',
  'data_status',
  'coverage_rate',
  'generated_at',
]);

test('all four executable Report schemas expose additive Shared dimensions with safe types', () => {
  assert.equal(validateReportSchemaV2(), true);
  const requiredAdditions = {
    mktReportSnapshots: ['customer_key', 'capability', 'coverage_rate'],
    mktReportMetricValues: ['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'],
    mktReportTopContent: ['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'],
    mktReportTopAds: ['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'],
  };

  for (const [tableKey, additions] of Object.entries(requiredAdditions)) {
    const table = LARK_REPORT_SCHEMA_V2.find((candidate) => candidate.key === tableKey);
    assert.ok(table, tableKey);
    for (const fieldName of additions) {
      assert.ok(table.fields.find((field) => field.fieldName === fieldName), `${tableKey}.${fieldName}`);
    }
    const capability = table.fields.find((field) => field.fieldName === 'capability');
    assert.equal(capability.type, 1);
    assert.equal(capability.property, undefined);
    const coverageRate = table.fields.find((field) => field.fieldName === 'coverage_rate');
    assert.equal(coverageRate.type, 2);
    assert.equal(coverageRate.property.formatter, '0.0000');
  }

  for (const tableKey of ['mktReportMetricValues', 'mktReportTopContent', 'mktReportTopAds']) {
    const table = LARK_REPORT_SCHEMA_V2.find((candidate) => candidate.key === tableKey);
    const periodKind = table.fields.find((field) => field.fieldName === 'period_kind');
    assert.deepEqual(periodKind.property.options.map((option) => option.name), [
      'rolling_days',
      'custom_range',
    ]);
  }

  const metricWindow = LARK_REPORT_SCHEMA_V2
    .find((table) => table.key === 'mktReportMetricValues')
    .fields.find((field) => field.fieldName === 'window_days');
  assert.equal(metricWindow.type, 3);
  assert.deepEqual(metricWindow.property.options.map((option) => option.name), ['1', '3', '7', '30']);

  for (const tableKey of ['mktReportTopContent', 'mktReportTopAds']) {
    const windowDays = LARK_REPORT_SCHEMA_V2
      .find((table) => table.key === tableKey)
      .fields.find((field) => field.fieldName === 'window_days');
    assert.equal(windowDays.type, 2);
    assert.equal(windowDays.property.formatter, '0');
  }

  const snapshots = LARK_REPORT_SCHEMA_V2.find((table) => table.key === 'mktReportSnapshots');
  assert.equal(
    snapshots.fields.find((field) => field.fieldName === 'baseline_coverage_rate')
      .property.formatter,
    '0.0000',
  );
});

test('schema preview against the prior complete schema plans only 18 additive fields', async () => {
  const priorSchema = structuredClone(LARK_REPORT_SCHEMA_V2);
  const additions = new Map([
    ['mktReportSnapshots', new Set(['customer_key', 'capability', 'coverage_rate'])],
    ['mktReportMetricValues', new Set(['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'])],
    ['mktReportTopContent', new Set(['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'])],
    ['mktReportTopAds', new Set(['customer_key', 'capability', 'period_kind', 'window_days', 'coverage_rate'])],
  ]);
  for (const table of priorSchema) {
    const removed = additions.get(table.key);
    if (removed) table.fields = table.fields.filter((field) => !removed.has(field.fieldName));
  }
  const byId = new Map(priorSchema.map((table, index) => [`tbl${index + 1}`, table]));
  const client = {
    async listTables() {
      return [...byId].map(([tableId, table]) => ({ tableId, name: table.createName }));
    },
    async listFields({ tableId }) {
      return byId.get(tableId).fields.map((field, index) => ({
        fieldId: `${tableId}-fld${index + 1}`,
        fieldName: field.fieldName,
        type: field.type,
        isPrimary: field.primary === true,
        description: field.description,
        property: structuredClone(field.property ?? null),
      }));
    },
  };

  const preview = await planLarkReportSchema({
    client,
    env: {},
    schema: LARK_REPORT_SCHEMA_V2,
    schemaVersion: LARK_REPORT_SCHEMA_V2_VERSION,
    validateSchema: validateReportSchemaV2,
  });
  assert.equal(preview.readyToApply, true);
  assert.equal(preview.summary.createTables, 0);
  assert.equal(preview.summary.createFields, 18);
  assert.equal(preview.summary.updateFields, 0);
  assert.equal(preview.summary.conflicts, 0);
  assert.deepEqual(new Set(preview.actions.map((action) => action.kind)), new Set(['create_field']));
});

test('capability is an extensible lowercase key and Dashboard Views contain no customer/platform/account filter', () => {
  const payload = materializationPayload({
    capability: 'customer_service',
    platformScope: 'future_channel',
  });
  assert.equal(validateReportMaterializationPayload(payload).capability, 'customer_service');
  assert.throws(
    () => validateReportMaterializationPayload({ ...payload, capability: 'CustomerService' }),
    /lowercase extensible key/,
  );

  const dashboardViews = LARK_REPORT_VIEWS.flatMap((table) => table.views)
    .filter((view) => view.name.startsWith('🧭 Dashboard'));
  assert.equal(dashboardViews.length, 4);
  for (const view of dashboardViews) {
    const fields = view.filterInfo.conditions.map((condition) => condition.fieldName);
    assert.equal(fields.includes('platform'), false);
    assert.equal(fields.includes('account_id'), false);
    assert.equal(fields.includes('customer_key'), false);
    assert.equal(
      view.filterInfo.conditions.some((condition) => (
        condition.fieldName === 'report_type'
        && condition.value === 'dashboard_performance_report'
      )),
      true,
    );
  }
});

test('materialization writer maps Shared dimensions to Snapshot, Metric and Top Content rows', async () => {
  const materialization = organicMaterialization();
  const captured = await captureWrite(materialization);
  const snapshot = captured.get('snapshots')[0];
  const metric = captured.get('metrics')[0];
  const topContent = captured.get('top_content')[0];

  assertSharedDimensions([snapshot, metric, topContent], {
    capability: 'organic',
    platform: 'youtube',
    windowDays: null,
    coverageRate: null,
  });
  assert.deepEqual(snapshot.platform, ['youtube']);
  assert.equal(snapshot.baseline_coverage_rate, null);
  assert.equal(metric.current_value, 0);
  assert.equal(metric.compare_value, null);
  assert.equal(topContent.period_views, 0);
  assert.equal(snapshot.report_id, materialization.row.report_id);
  assert.equal(metric.report_metric_key, `${materialization.row.report_id}::youtube%3Aviews::summary::all`);
  assert.equal(topContent.report_content_key, `${materialization.row.report_id}::rank:1`);
});

test('materialization writer maps Shared dimensions to Top Ads and mirrors the Integration Workspace Metric window', async () => {
  const materialization = paidAdsMaterialization();
  const captured = await captureWrite(materialization);
  const snapshot = captured.get('snapshots')[0];
  const metric = captured.get('metrics')[0];
  const topAd = captured.get('top_ads')[0];

  assertSharedDimensions([snapshot, metric, topAd], {
    capability: 'paid_ads',
    platform: 'meta_ads',
    windowDays: 3,
    coverageRate: 0,
  });
  assert.equal(snapshot.window_days, 3);
  assert.equal(metric.window_days, 3);
  assert.equal(metric[LEGACY_WINDOW], '3');
  assert.equal(topAd.window_days, 3);
  assert.deepEqual(snapshot.platform, ['meta_ads']);
  assert.equal(snapshot.baseline_coverage_rate, materialization.payload.coverageRate);
  assert.equal(metric.current_value, 0);
  assert.equal(topAd.impressions, 0);
  assert.equal(topAd.conversions, null);
  assert.equal(topAd.ctr, 0);
  assert.equal(topAd.report_ad_key, `${materialization.row.report_id}::rank:1`);
});

test('Commerce materialization writes only shared Snapshot and Metric tables', async () => {
  const materialization = {
    row: materializationRow({
      report_id: 'report-commerce',
      platform_scope: 'woocommerce',
      period_kind: 'rolling_days',
      window_days: 3,
      coverage_rate: 1,
    }),
    payload: materializationPayload({
      platformScope: 'woocommerce',
      capability: 'commerce',
      coverageRate: 1,
      period: rollingPeriod(),
      collections: { top_products: [{ product_key: 'product-1' }] },
      metricPayload: {
        'woocommerce:net_sales_micros': {
          metricKey: 'woocommerce:net_sales_micros',
          displayName: 'Net sales',
          current: 1_000_000,
          compare: 500_000,
          change: 500_000,
          changePercent: 1,
          unit: 'currency',
          formulaVersion: 'woocommerce-commerce-v1',
          clientVisible: true,
          sortOrder: 1,
        },
      },
    }),
  };
  const captured = await captureWrite(materialization);
  assert.deepEqual([...captured.keys()].sort(), ['metrics', 'snapshots']);
  assert.equal(captured.get('metrics')[0].capability, 'commerce');
  assert.equal(captured.get('metrics')[0].window_days, 3);
  assert.equal(captured.get('metrics')[0][LEGACY_WINDOW], '3');
  assert.equal(captured.get('metrics')[0].current_value, 1_000_000);
});

test('same validated materialization rerun is idempotent across every Organic output table', async () => {
  const repository = memoryRepository();
  const reader = { async readById() { return organicMaterialization(); } };
  const input = {
    reader,
    repository,
    syncEngine: new TableSyncEngine(),
    reportId: 'report-organic',
    customerProfile: 'integration_workspace',
    utcOffset: '+07:00',
    topContentLimit: 1,
    tables: TABLES,
  };

  const first = await writeDashboardMaterializationToLark(input);
  const second = await writeDashboardMaterializationToLark(input);
  assert.deepEqual(
    [first.results.reportSnapshot.created, first.results.reportMetricValues.created, first.results.reportTopContent.created],
    [1, 1, 1],
  );
  assert.deepEqual(
    [second.results.reportSnapshot.skipped, second.results.reportMetricValues.skipped, second.results.reportTopContent.skipped],
    [1, 1, 1],
  );
  assert.deepEqual(
    [...repository.tables.values()].map((rows) => rows.length),
    [1, 1, 1, 0],
  );
});

test('D1 reader rejects row dimensions that disagree with the checksummed payload', async () => {
  const payload = validateReportMaterializationPayload(materializationPayload({
    platformScope: 'meta_ads',
    capability: 'paid_ads',
    period: rollingPeriod(),
    coverageRate: 0,
  }));
  const row = {
    ...materializationRow({
      platform_scope: 'meta_ads',
      period_kind: 'rolling_days',
      window_days: 3,
      coverage_rate: 0,
    }),
    formula_version: 'ads-v1',
    payload_json: JSON.stringify(payload),
    payload_checksum: await createStableFingerprint(payload),
    source_watermark: null,
    expires_at: null,
    created_at: GENERATED_AT,
    updated_at: GENERATED_AT,
  };
  row.report_id = createReportId(row);
  const valid = await new D1ReportMaterializationReader({ db: fakeD1(row) }).readById(row.report_id);
  assert.equal(valid.row.coverage_rate, 0);
  assert.equal(valid.payload.coverageRate, 0);

  const mismatched = { ...row, coverage_rate: null };
  await assert.rejects(
    () => new D1ReportMaterializationReader({ db: fakeD1(mismatched) }).readById(row.report_id),
    (error) => error.code === 'REPORT_MATERIALIZATION_METADATA_MISMATCH',
  );
});

async function captureWrite(materialization) {
  const captured = new Map();
  const syncEngine = {
    async planByKey(input) {
      captured.set(input.tableId, input.rows);
      return { tableId: input.tableId, rows: input.rows };
    },
    async executePlan(plan) {
      return { created: plan.rows.length, updated: 0, skipped: 0 };
    },
  };
  await writeDashboardMaterializationToLark({
    reader: { async readById() { return materialization; } },
    repository: {},
    syncEngine,
    reportId: materialization.row.report_id,
    customerProfile: 'integration_workspace',
    utcOffset: '+07:00',
    topContentLimit: 1,
    topAdsLimit: 1,
    tables: TABLES,
  });
  return captured;
}

function assertSharedDimensions(rows, expected) {
  const reference = Object.fromEntries(SHARED_FIELDS
    .filter((field) => field !== 'platform' && field !== 'window_days')
    .map((field) => [field, rows[0][field]]));
  for (const row of rows) {
    for (const [field, value] of Object.entries(reference)) assert.equal(row[field], value, field);
    assert.equal(row.customer_key, 'chemistry_k');
    assert.equal(row.customer_profile, 'integration_workspace');
    assert.equal(row.capability, expected.capability);
    assert.equal(Array.isArray(row.platform) ? row.platform[0] : row.platform, expected.platform);
    assert.equal(row.account_id, 'account-new');
    assert.equal(row.report_setting_key, 'setting-new');
    assert.equal(row.report_type, 'dashboard_performance_report');
    assert.equal(row.period_kind, expected.windowDays === null ? 'custom_range' : 'rolling_days');
    assert.equal(row.window_days, expected.windowDays);
    if (row.report_metric_key) {
      assert.equal(
        row[LEGACY_WINDOW],
        expected.windowDays === null ? null : String(expected.windowDays),
      );
    } else {
      assert.equal(Object.hasOwn(row, LEGACY_WINDOW), false);
    }
    assert.equal(row.data_status, 'partial');
    assert.equal(row.coverage_rate, expected.coverageRate);
    assert.equal(row.generated_at, GENERATED_AT);
  }
}

function organicMaterialization() {
  return {
    row: materializationRow({
      report_id: 'report-organic',
      platform_scope: 'youtube',
      period_kind: 'custom_range',
      window_days: null,
      coverage_rate: null,
    }),
    payload: materializationPayload({
      platformScope: 'youtube',
      capability: 'organic',
      coverageRate: null,
      period: customPeriod(),
      metricPayload: {
        'youtube:views': {
          metricKey: 'youtube:views',
          displayName: 'Views',
          current: 0,
          compare: null,
          change: null,
          changePercent: null,
          unit: 'count',
          formulaVersion: 'organic-v1',
          clientVisible: true,
          sortOrder: 1,
        },
      },
      topContent: [{
        content_key: 'youtube:account-new:video-1',
        external_content_id: 'video-1',
        period_views: 0,
        period_likes: null,
        data_status: 'partial',
      }],
    }),
  };
}

function paidAdsMaterialization() {
  return {
    row: materializationRow({
      report_id: 'report-paid',
      platform_scope: 'meta_ads',
      period_kind: 'rolling_days',
      window_days: 3,
      coverage_rate: 0,
    }),
    payload: materializationPayload({
      platformScope: 'meta_ads',
      capability: 'paid_ads',
      coverageRate: 0,
      period: rollingPeriod(),
      metricPayload: {
        'meta_ads:clicks': {
          metricKey: 'meta_ads:clicks',
          displayName: 'Clicks',
          current: 0,
          compare: null,
          change: null,
          changePercent: null,
          unit: 'count',
          formulaVersion: 'ads-v1',
          clientVisible: true,
          sortOrder: 1,
        },
      },
      topAds: [{
        external_ad_id: 'ad-1',
        ad_name: 'Ad 1',
        impressions: 0,
        conversions: null,
        ctr: 0,
        data_status: 'partial',
      }],
    }),
  };
}

function materializationRow(overrides = {}) {
  return {
    report_id: 'report',
    report_setting_key: 'setting-new',
    customer_key: 'chemistry_k',
    platform_scope: 'youtube',
    account_key: 'account-new',
    report_type: 'dashboard_performance_report',
    period_kind: 'custom_range',
    window_days: null,
    period_start: '2026-07-25',
    period_end: '2026-07-27',
    compare_start: '2026-07-22',
    compare_end: '2026-07-24',
    data_status: 'partial',
    coverage_rate: null,
    formula_version: 'formula-v1',
    generated_at: GENERATED_AT,
    ...overrides,
  };
}

function materializationPayload(overrides = {}) {
  return {
    schemaVersion: 'dashboard-materialization-v2',
    sourceReportId: null,
    platformScope: 'youtube',
    capability: 'organic',
    reportType: 'dashboard_performance_report',
    period: customPeriod(),
    dataStatus: 'partial',
    coverageRate: null,
    metricPayload: {},
    collections: {},
    topContent: [],
    topAds: [],
    source: 'report_materializations',
    sourceWatermark: null,
    generatedAt: GENERATED_AT,
    sourceUnavailableReason: null,
    aiSummary: null,
    ...overrides,
  };
}

function customPeriod() {
  return {
    periodKind: 'custom_range',
    windowDays: null,
    periodStart: '2026-07-25',
    periodEnd: '2026-07-27',
    comparisonMode: 'previous_period',
    compareStart: '2026-07-22',
    compareEnd: '2026-07-24',
  };
}

function rollingPeriod() {
  return { ...customPeriod(), periodKind: 'rolling_days', windowDays: 3 };
}

function memoryRepository() {
  const tables = new Map(Object.values(TABLES).map((tableId) => [tableId, []]));
  let nextId = 1;
  return {
    tables,
    async prepareRows(_tableId, rows) { return rows; },
    async listByFieldValues(tableId, fieldName, values) {
      return tables.get(tableId).filter((record) => values.includes(record.fields[fieldName]));
    },
    async createMany(tableId, rows) {
      for (const fields of rows) {
        tables.get(tableId).push({ recordId: `${tableId}-${nextId++}`, fields: structuredClone(fields) });
      }
      return { created: rows.length };
    },
    async updateMany(tableId, rows) {
      for (const row of rows) {
        tables.get(tableId).find((record) => record.recordId === row.recordId).fields = structuredClone(row.fields);
      }
      return { updated: rows.length };
    },
  };
}

function fakeD1(row) {
  return {
    prepare() {
      return {
        bind() {
          return { async first() { return structuredClone(row); } };
        },
      };
    },
  };
}
