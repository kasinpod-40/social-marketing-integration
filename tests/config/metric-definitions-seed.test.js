import test from 'node:test';
import assert from 'node:assert/strict';
import { METRIC_DEFINITION_ROWS } from '../../packages/config/src/metric-definitions.seed.js';
import { seedMetricDefinitions } from '../../packages/application/src/use-cases/seed-metric-definitions.js';

test('metric definition seed uses stable unique keys and includes organic plus ads platforms', () => {
  const keys = new Set(METRIC_DEFINITION_ROWS.map((row) => row.metric_key));
  const platforms = new Set(METRIC_DEFINITION_ROWS.map((row) => row.platform));

  assert.equal(keys.size, METRIC_DEFINITION_ROWS.length);
  assert.ok(platforms.has('facebook'));
  assert.ok(platforms.has('instagram'));
  assert.ok(platforms.has('tiktok'));
  assert.ok(platforms.has('youtube'));
  assert.ok(platforms.has('meta_ads'));
  assert.ok(platforms.has('tiktok_ads'));
  assert.ok(platforms.has('google_ads'));
  assert.ok(METRIC_DEFINITION_ROWS.find((row) => row.metric_key === 'tiktok:unique_viewers'));
  assert.ok(METRIC_DEFINITION_ROWS.find((row) => row.metric_key === 'google_ads:actual_roas'));
  const reportMetric = METRIC_DEFINITION_ROWS.find((row) => row.metric_key === 'tiktok:period_views');
  assert.deepEqual(reportMetric, {
    metric_key: 'tiktok:period_views',
    platform: 'tiktok',
    raw_field_name: 'period_views',
    display_name: 'Views เพิ่มในช่วง',
    formula: null,
    unit: 'count',
    can_compare_cross_platform: false,
    fallback_metric: null,
    metric_note: 'Computed by TikTok Organic Report Engine from cumulative daily content snapshots.',
    enabled: true,
    metric_scope: 'account_period',
    source_table: 'derived',
    aggregation_method: 'sum_delta',
    null_policy: 'preserve_null',
    higher_is_better: true,
    decimal_places: 0,
    formula_version: 'tiktok-organic-v1',
    client_visible: true,
    sort_order: 10,
  });
});

test('seedMetricDefinitions uses universal sync engine by metric_key', async () => {
  let call;
  const repository = {
    async prepareRows(_tableId, rows) { return rows; },
    async listAll() { return []; },
    async createMany() { return { created: 0 }; },
    async updateMany() { return { updated: 0 }; },
  };
  const syncEngine = {
    async syncByKey(input) {
      call = input;
      return { created: input.rows.length, updated: 0, skipped: 0, duplicateInputRows: 0 };
    },
  };

  const result = await seedMetricDefinitions({ repository, syncEngine, tableId: 'tbl_metrics', rows: [{ metric_key: 'views' }] });
  assert.equal(call.repository, repository);
  assert.equal(call.tableId, 'tbl_metrics');
  assert.equal(call.keyField, 'metric_key');
  assert.deepEqual(result, { created: 1, updated: 0, skipped: 0, duplicateInputRows: 0 });
});
