import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readUniqueStringProperty,
  replaceUniqueStringProperty,
  updateWranglerStringVars,
} from '../../scripts/lib/wrangler-sync-config.js';

test('reads and replaces one JSONC string property without touching comments', () => {
  const source = '{\n  // keep\n  "FLAG": "false"\n}\n';
  assert.equal(readUniqueStringProperty(source, 'FLAG'), 'false');
  assert.equal(replaceUniqueStringProperty(source, 'FLAG', 'true'), '{\n  // keep\n  "FLAG": "true"\n}\n');
});

test('fails closed when a key is duplicated', () => {
  assert.throws(
    () => readUniqueStringProperty('{"FLAG":"false","FLAG":"true"}', 'FLAG'),
    (error) => error.code === 'WRANGLER_CONFIG_KEY_DUPLICATE',
  );
});

test('updates Wrangler vars atomically and reports only real changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mkt-wrangler-'));
  const filePath = join(directory, 'wrangler.sync.jsonc');
  await writeFile(filePath, '{"A":"false","B":"true"}\n');
  const result = await updateWranglerStringVars(filePath, { A: 'true', B: 'true' });
  assert.deepEqual(result.changed, [{ key: 'A', from: 'false', to: 'true' }]);
  assert.equal(await readFile(filePath, 'utf8'), '{"A":"true","B":"true"}\n');
});
