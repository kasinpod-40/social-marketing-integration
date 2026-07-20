import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MIGRATION_URL = new URL(
  '../../migrations/0008_reliability_mirror_outbox.sql',
  import.meta.url,
);

test('migration 0008 adds deterministic bounded reliability mirror delivery state', async () => {
  const sql = await readFile(MIGRATION_URL, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS reliability_mirror_outbox/u);
  assert.match(sql, /outbox_id TEXT PRIMARY KEY/u);
  assert.match(sql, /mirror_method TEXT NOT NULL/u);
  assert.match(sql, /'saveSyncRun', 'saveSystemAlert'/u);
  assert.match(sql, /'pending', 'delivered', 'failed_permanent'/u);
  assert.match(sql, /revision INTEGER NOT NULL DEFAULT 1/u);
  assert.match(sql, /delivery_attempts INTEGER NOT NULL DEFAULT 0/u);
  assert.match(sql, /idx_reliability_mirror_outbox_status_updated/u);
});
