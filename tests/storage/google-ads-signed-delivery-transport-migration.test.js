import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL(
  '../../migrations/0013_google_ads_signed_delivery_transport.sql',
  import.meta.url,
);

test('migration 0013 replays safely and adds isolated nonce/run/chunk grains', async () => {
  const sql = await readFile(MIGRATION_URL, 'utf8');
  const d1 = createSqliteD1();
  try {
    d1.exec(sql);
    d1.exec(sql);
    const tables = d1.database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map((row) => row.name);
    for (const name of [
      'google_ads_delivery_nonces',
      'google_ads_delivery_runs',
      'google_ads_delivery_chunks',
    ]) assert.ok(tables.includes(name), name);

    const indexes = d1.database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name
    `).all().map((row) => row.name);
    for (const name of [
      'idx_google_ads_delivery_nonces_expiry',
      'idx_google_ads_delivery_runs_status_expiry',
      'idx_google_ads_delivery_runs_audit_expiry',
      'idx_google_ads_delivery_chunks_run_dataset',
    ]) assert.ok(indexes.includes(name), name);
  } finally {
    d1.close();
  }
});
test('migration 0013 enforces bounded payload, dataset and transport status contracts', async () => {
  const sql = await readFile(MIGRATION_URL, 'utf8');
  const d1 = createSqliteD1();
  try {
    d1.exec(sql);
    assert.throws(() => d1.database.prepare(`
      INSERT INTO google_ads_delivery_nonces (
        nonce_fingerprint, request_timestamp_seconds, received_at, expires_at
      ) VALUES (?, ?, ?, ?)
    `).run('short', 1, 1, 901_000), /CHECK constraint failed/u);

    assert.throws(() => d1.database.prepare(`
      INSERT INTO google_ads_delivery_runs (
        run_id, run_fingerprint, schema_version, mode, run_started_at,
        identity_fingerprint, source_timezone, manifest_json, manifest_digest,
        expected_chunk_count, expected_row_count, status, expires_at,
        payload_retention_until, audit_expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      '123e4567-e89b-42d3-a456-426614174000',
      'a'.repeat(43),
      'google_ads_manager_script_signed_delivery_v1',
      'DRY_RUN',
      1,
      'b'.repeat(64),
      'Asia/Bangkok',
      '{}',
      'c'.repeat(64),
      1,
      1,
      'assembling',
      2,
      3,
      4,
      1,
      1,
    ), /CHECK constraint failed/u);
  } finally {
    d1.close();
  }
});
