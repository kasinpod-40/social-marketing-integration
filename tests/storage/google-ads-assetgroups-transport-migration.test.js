import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const TRANSPORT_MIGRATION_URL = new URL(
  '../../migrations/0013_google_ads_signed_delivery_transport.sql',
  import.meta.url,
);
const ASSET_GROUPS_MIGRATION_URL = new URL(
  '../../migrations/0021_google_ads_assetgroups_transport.sql',
  import.meta.url,
);

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';

function insertRun(database) {
  database.prepare(`
    INSERT INTO google_ads_delivery_runs (
      run_id, run_fingerprint, schema_version, mode, run_started_at,
      identity_fingerprint, source_timezone, manifest_json, manifest_digest,
      expected_chunk_count, expected_row_count, status, expires_at,
      payload_retention_until, audit_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    RUN_ID,
    'r'.repeat(43),
    'google_ads_manager_script_signed_delivery_v1',
    'LIVE',
    1_000,
    'i'.repeat(64),
    'Asia/Bangkok',
    '{}',
    'm'.repeat(64),
    2,
    2,
    'assembling',
    8_000_000,
    9_000_000,
    10_000_000,
    1_000,
    1_000,
  );
}

function insertChunk(database, datasetKey, reservationId) {
  return database.prepare(`
    INSERT INTO google_ads_delivery_chunks (
      idempotency_key, run_id, dataset_key, chunk_index, chunk_count,
      total_rows, row_count, body_digest, payload_json, payload_bytes,
      reservation_id, received_at, redacted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `google-ads:${RUN_ID}:${datasetKey}:0`,
    RUN_ID,
    datasetKey,
    0,
    1,
    1,
    1,
    'd'.repeat(64),
    '{}',
    2,
    reservationId,
    1_500,
    null,
  );
}

test('migration 0021 preserves staged chunks and admits Asset Groups transport rows', async () => {
  const transportSql = await readFile(TRANSPORT_MIGRATION_URL, 'utf8');
  const assetGroupsSql = await readFile(ASSET_GROUPS_MIGRATION_URL, 'utf8');
  const d1 = createSqliteD1();
  try {
    d1.exec(transportSql);
    insertRun(d1.database);
    insertChunk(d1.database, 'campaigns', 'reservation-campaigns');

    assert.throws(
      () => insertChunk(d1.database, 'assetGroups', 'reservation-before-migration'),
      /CHECK constraint failed/u,
    );

    d1.exec(assetGroupsSql);

    const retained = d1.database.prepare(`
      SELECT dataset_key, reservation_id
      FROM google_ads_delivery_chunks
      ORDER BY dataset_key
    `).all();
    assert.deepEqual(retained, [{
      dataset_key: 'campaigns',
      reservation_id: 'reservation-campaigns',
    }]);

    insertChunk(d1.database, 'assetGroups', 'reservation-asset-groups');
    const datasets = d1.database.prepare(`
      SELECT dataset_key
      FROM google_ads_delivery_chunks
      ORDER BY dataset_key
    `).all().map((row) => row.dataset_key);
    assert.deepEqual(datasets, ['assetGroups', 'campaigns']);

    assert.throws(
      () => insertChunk(d1.database, 'searchTerms', 'reservation-invalid'),
      /CHECK constraint failed/u,
    );

    const ddl = d1.database.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'table' AND name = 'google_ads_delivery_chunks'
    `).get().sql;
    assert.match(ddl, /'assetGroups'/u);
    assert.match(ddl, /FOREIGN KEY \(run_id\) REFERENCES google_ads_delivery_runs/u);
  } finally {
    d1.close();
  }
});
