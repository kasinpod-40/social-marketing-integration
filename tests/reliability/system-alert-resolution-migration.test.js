import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MIGRATION_URL = new URL(
  '../../migrations/0007_preserve_resolved_system_alerts.sql',
  import.meta.url,
);

test('resolved system alert cannot reopen under the same alert identity', async () => {
  const sql = await readFile(MIGRATION_URL, 'utf8');

  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS trg_system_alerts_preserve_resolved_status/u);
  assert.match(sql, /AFTER UPDATE OF status ON system_alerts/u);
  assert.match(sql, /OLD\.status = 'resolved' AND NEW\.status = 'open'/u);
  assert.match(sql, /SET status = 'resolved'/u);
  assert.match(sql, /WHERE alert_id = NEW\.alert_id/u);
});
