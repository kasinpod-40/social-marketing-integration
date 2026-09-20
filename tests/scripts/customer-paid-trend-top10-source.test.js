import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Paid Ads detail chart applies a persistent Top 10 rank filter and sorts it by spend', async () => {
  const source = await readFile(new URL(
    '../../apps/sync-worker/src/customer-paid-trend-preview-http.js',
    import.meta.url,
  ), 'utf8');

  assert.match(source, /const ADS_IN_PERIOD_LIMIT = 10;/u);
  assert.doesNotMatch(source, /appearance: \{ limit:/u);
  assert.match(source, /field_name: 'rank', operator: 'isLessEqual', value: ADS_IN_PERIOD_LIMIT/u);
  assert.match(source, /field_name: 'ad_chart_label', mode: 'integrated', sort: \{ type: 'value', order: 'desc' \}/u);
  assert.match(source, /series: \[\s*\{ field_name: 'ad_spend_amount', rollup: 'SUM' \}/u);
  assert.match(source, /computed\[key\]\.rowCount > ADS_IN_PERIOD_LIMIT/u);
});
