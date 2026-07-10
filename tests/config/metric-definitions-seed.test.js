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
});

test('seedMetricDefinitions uses universal sync engine by metric_key', async () => {
  let call;
  const repository = {
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
