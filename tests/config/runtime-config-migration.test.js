import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('runtime config migration creates customer-scoped non-secret authority', async () => {
  const sql = await readFile(new URL('../../migrations/0023_runtime_config.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS runtime_config/u);
  assert.match(sql, /PRIMARY KEY \(environment, customer_key, config_key\)/u);
  assert.match(sql, /config_value TEXT NOT NULL/u);
});
