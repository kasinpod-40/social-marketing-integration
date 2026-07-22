import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('migration creates nonce replay and durable idempotency state without secrets', async () => {
  const sql = await readFile(new URL('../../migrations/0009_google_ads_signed_delivery.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS google_ads_delivery_nonces/u);
  assert.match(sql, /nonce TEXT PRIMARY KEY/u);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS google_ads_deliveries/u);
  assert.match(sql, /idempotency_key TEXT PRIMARY KEY/u);
  assert.match(sql, /delivery_id TEXT NOT NULL UNIQUE/u);
  assert.match(sql, /payload_json TEXT NOT NULL/u);
  assert.match(sql, /payload_expires_at INTEGER NOT NULL/u);
  assert.match(sql, /preview_validated/u);
  assert.match(sql, /idx_google_ads_deliveries_payload_expiry/u);
  assert.doesNotMatch(sql, /signature|authorization|secret|token/iu);
});
