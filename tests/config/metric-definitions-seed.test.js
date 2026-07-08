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

test('seedMetricDefinitions upserts by metric_key', async () => {
  const calls = [];
  const repository = {
    async upsertByKey(input) {
      calls.push(input);
      return { created: input.rows.length, updated: 0, skipped: 0 };
    },
  };

  const result = await seedMetricDefinitions({ repository, tableId: 'tbl_metric_definitions' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].tableId, 'tbl_metric_definitions');
  assert.equal(calls[0].keyField, 'metric_key');
  assert.equal(result.created, METRIC_DEFINITION_ROWS.length);
});
