import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../scripts/customer-weekly-ai-quality-preview.mjs', import.meta.url),
  'utf8',
);

test('weekly quality diagnostic uses an isolated Preview and never changes Production traffic', () => {
  assert.match(source, /versions', 'upload/u);
  assert.match(source, /config\.preview_urls = true/u);
  assert.match(source, /delete config\.queues/u);
  assert.match(source, /delete config\.triggers/u);
  assert.match(source, /productionTrafficChanged: false/u);
  assert.match(source, /assertProductionVersionUnchanged/u);
  assert.doesNotMatch(source, /wrangler', 'deploy'/u);
  assert.doesNotMatch(source, /queue\.send|batchCreateRecords|batchUpdateRecords/u);
});
