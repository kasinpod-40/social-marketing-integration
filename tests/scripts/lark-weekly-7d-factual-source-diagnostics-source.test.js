import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE = new URL('../../scripts/lark-weekly-7d-factual-source-diagnostics.mjs', import.meta.url);

test('weekly factual diagnostics operator is read-only by source contract', async () => {
  const source = await readFile(SOURCE, 'utf8');
  assert.match(source, /mode: 'READ_ONLY'/u);
  assert.match(source, /Read-only diagnostics blocked a non-read Lark request/u);
  assert.match(source, /collectLarkNativeAiWeekly7dControlledUatSource/u);
  assert.match(source, /diagnoseLarkWeekly7dFactualSource/u);
  assert.doesNotMatch(source, /batchCreateRecords/u);
  assert.doesNotMatch(source, /batchUpdateRecords/u);
  assert.doesNotMatch(source, /sendQueue/u);
  assert.doesNotMatch(source, /wrangler.+deploy/iu);
  assert.doesNotMatch(source, /workflows/u);
});
