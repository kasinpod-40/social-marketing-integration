import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../../migrations/0005_resumable_sync_reliability.sql', import.meta.url);

test('migration 0005 fails closed unless resumable work and active locks are drained', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE _mkt_migration_0005_guard/u);
  assert.match(sql, /CHECK \(active_work_count = 0\)/u);
  assert.match(sql, /CHECK \(active_lock_count = 0\)/u);
  assert.match(sql, /SELECT COUNT\(\*\) FROM sync_work_runs/u);
  assert.match(sql, /SELECT COUNT\(\*\) FROM sync_locks[\s\S]*expires_at >/u);
  assert.ok(
    sql.indexOf('_mkt_migration_0005_guard') < sql.indexOf('ALTER TABLE sync_work_runs'),
    'quiesce guard must execute before any schema mutation',
  );
});

test('migration 0005 bootstraps generation fences from the latest business checkpoint', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /SET generation = last_successful_sync_at/u);
  assert.match(sql, /requested_at = last_successful_sync_at/u);
  assert.match(sql, /generation_work_key = 'legacy-checkpoint:' \|\| cursor_key/u);
  assert.match(sql, /INSERT INTO sync_generation_fences/u);
  assert.match(sql, /WHERE generation > 0/u);
});

test('migration 0005 adds durable warning and exact secret-filtered redrive state', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS sync_warning_outbox/u);
  assert.match(sql, /ALTER TABLE dead_letter_jobs ADD COLUMN replay_payload_json TEXT/u);
  assert.match(sql, /ALTER TABLE dead_letter_jobs ADD COLUMN redrive_requested_at INTEGER/u);
  assert.match(sql, /ALTER TABLE dead_letter_jobs ADD COLUMN redrive_reference TEXT/u);
  assert.match(sql, /ALTER TABLE dead_letter_jobs ADD COLUMN redriven_at INTEGER/u);
  assert.match(sql, /idx_dead_letter_jobs_redrive_status/u);
});
