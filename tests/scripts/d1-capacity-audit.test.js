import test from 'node:test';
import assert from 'node:assert/strict';
import {
  D1_CAPACITY_TABLES,
  buildD1GrowthSql,
  buildD1TableCountSql,
  projectD1Growth,
  summarizeD1Capacity,
} from '../../scripts/lib/d1-capacity-audit.js';

test('capacity SQL is SELECT-only and covers every reviewed table', () => {
  const sql = buildD1TableCountSql();
  assert.equal((sql.match(/SELECT '/gu) ?? []).length, D1_CAPACITY_TABLES.length);
  assert.doesNotMatch(sql, /UPDATE|DELETE|INSERT|DROP|ALTER/iu);
});

test('growth SQL uses an immutable fourteen-day cutoff', () => {
  const sql = buildD1GrowthSql(1786780000000, ['organic_content_observations']);
  assert.match(sql, /created_at>=1785570400000/u);
  assert.doesNotMatch(sql, /UPDATE|DELETE|INSERT/iu);
});

test('projects observed growth at 90d, 1y and 3y without deleting data', () => {
  const [projection] = projectD1Growth([{ table_name: 'organic_content_observations', row_count: 1000, recent_14d_rows: 140 }]);
  assert.equal(projection.observedDailyRate, 10);
  assert.equal(projection.projectedRows['90d'], 1900);
  assert.equal(projection.projectedRows['365d'], 4650);
  assert.equal(projection.projectedRows['1095d'], 11950);
});

test('summarizes database and per-platform evidence', () => {
  const summary = summarizeD1Capacity({
    databaseBytes: 1048576,
    indexCount: 12,
    counts: [{ table_name: 'sync_runs', row_count: 9 }],
    growth: [],
    writesByPlatform: [{ platform: 'youtube', run_count: 2, records_written_14d: 20 }],
  });
  assert.equal(summary.databaseMiB, 1);
  assert.equal(summary.totalRows, 9);
  assert.equal(summary.writesByPlatform[0].recordsWritten14d, 20);
});
