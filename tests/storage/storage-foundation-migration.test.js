import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL('../../migrations/0009_storage_foundation.sql', import.meta.url);
const REQUIRED_TABLES = Object.freeze([
  'organic_content_state',
  'organic_content_observations',
  'organic_account_daily_facts',
  'ads_entity_state',
  'ads_daily_facts',
  'ads_conversion_daily_facts',
  'data_coverage_runs',
  'data_coverage_entities',
  'report_materializations',
  'report_requests',
]);

const REQUIRED_INDEXES = Object.freeze([
  'idx_organic_content_state_account_observed',
  'idx_organic_content_state_account_published',
  'idx_organic_content_observations_content_observed',
  'idx_organic_content_observations_account_date',
  'idx_organic_account_daily_account_date',
  'idx_ads_entity_state_account_type_seen',
  'idx_ads_daily_facts_account_date',
  'idx_ads_daily_facts_entity_date',
  'idx_ads_conversion_daily_account_date',
  'idx_data_coverage_runs_account_dataset_completed',
  'idx_data_coverage_entities_run_status',
  'idx_report_materializations_setting_period',
  'idx_report_requests_status_requested',
]);

test('migration 0009 replays safely and creates every approved table and query index', async () => {
  const sql = await readFile(MIGRATION_URL, 'utf8');
  const d1 = createSqliteD1();
  try {
    d1.exec(sql);
    d1.exec(sql);

    const tables = d1.database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map((row) => row.name);
    for (const tableName of REQUIRED_TABLES) assert.ok(tables.includes(tableName), tableName);

    const indexes = d1.database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name
    `).all().map((row) => row.name);
    for (const indexName of REQUIRED_INDEXES) assert.ok(indexes.includes(indexName), indexName);
  } finally {
    d1.close();
  }
});

test('migration 0009 remains additive beside existing operational tables and rows', async () => {
  const sql = await readFile(MIGRATION_URL, 'utf8');
  const d1 = createSqliteD1();
  try {
    d1.exec(`
      CREATE TABLE sync_runs (sync_run_id TEXT PRIMARY KEY, status TEXT NOT NULL);
      INSERT INTO sync_runs(sync_run_id, status) VALUES ('existing-run', 'success');
    `);
    d1.exec(sql);
    d1.exec(sql);

    assert.deepEqual(
      d1.database.prepare('SELECT * FROM sync_runs').get(),
      { sync_run_id: 'existing-run', status: 'success' },
    );
    assert.equal(
      d1.database.prepare("SELECT count(*) AS total FROM sqlite_master WHERE type='table' AND name IN (${REQUIRED_TABLES.map(() => '?').join(',')})")
        .get(...REQUIRED_TABLES).total,
      REQUIRED_TABLES.length,
    );
  } finally {
    d1.close();
  }
});

test('migration constraints reject invalid Coverage states and oversized bounded JSON', async () => {
  const sql = await readFile(MIGRATION_URL, 'utf8');
  const d1 = createSqliteD1();
  try {
    d1.exec(sql);
    assert.throws(() => d1.database.prepare(`
      INSERT INTO data_coverage_runs (
        coverage_run_id, sync_run_id, customer_key, platform, account_key,
        dataset_key, metric_semantics, scope_mode, source_timezone, status,
        failed_rows, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'coverage-invalid', 'sync-1', 'chemistry_k', 'tiktok', 'chemistry_k',
      'organic_content', 'cumulative', 'full_inventory', 'Asia/Bangkok', 'made_up',
      0, 1, 1, 1,
    ), /CHECK constraint failed/u);

    const payload = JSON.stringify({ version: 'v1', body: 'x'.repeat(262_144) });
    assert.throws(() => d1.database.prepare(`
      INSERT INTO report_materializations (
        report_id, report_setting_key, customer_key, platform_scope, account_key,
        report_type, period_kind, period_start, period_end, data_status,
        formula_version, payload_json, payload_checksum, generated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'report-large', 'setting', 'chemistry_k', 'tiktok', 'chemistry_k',
      'organic', '30D', '2026-06-01', '2026-06-30', 'complete',
      'v1', payload, 'hash', 1, 1, 1,
    ), /CHECK constraint failed/u);
  } finally {
    d1.close();
  }
});
