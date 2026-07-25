import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL(
  '../../migrations/0014_google_ads_signing_secret_provisioning.sql',
  import.meta.url,
);

test('migration 0014 replays safely and contains no plaintext capability, Secret or raw identity columns', async () => {
  const sql = await readFile(MIGRATION_URL, 'utf8');
  const d1 = createSqliteD1();
  try {
    d1.exec(sql);
    d1.exec(sql);
    const table = d1.database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'google_ads_signing_provisioning_tickets'
    `).get();
    assert.equal(table.name, 'google_ads_signing_provisioning_tickets');
    const columns = d1.database.prepare(`
      PRAGMA table_info(google_ads_signing_provisioning_tickets)
    `).all().map((row) => row.name);
    assert.deepEqual(columns, [
      'ticket_fingerprint', 'identity_fingerprint', 'key_id', 'status',
      'created_at', 'expires_at', 'redeemed_at', 'confirmed_at',
      'challenge_fingerprint',
    ]);
    assert.equal(columns.some((name) => /(?:secret|plaintext|manager|customer|account|challenge$|ticket$)/u.test(name)), false);
  } finally {
    d1.close();
  }
});

test('migration 0014 enforces five-minute TTL and lifecycle consistency', async () => {
  const sql = await readFile(MIGRATION_URL, 'utf8');
  const d1 = createSqliteD1();
  try {
    d1.exec(sql);
    const insert = d1.database.prepare(`
      INSERT INTO google_ads_signing_provisioning_tickets (
        ticket_fingerprint, identity_fingerprint, key_id, status,
        created_at, expires_at, redeemed_at, confirmed_at, challenge_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    assert.throws(() => insert.run(
      't'.repeat(43), 'a'.repeat(64), 'fixture-key-v1', 'active',
      1, 300_002, null, null, null,
    ), /CHECK constraint failed/u);
    assert.throws(() => insert.run(
      'u'.repeat(43), 'b'.repeat(64), 'fixture-key-v1', 'confirmed',
      1, 300_001, null, 2, 'c'.repeat(43),
    ), /CHECK constraint failed/u);
  } finally {
    d1.close();
  }
});
