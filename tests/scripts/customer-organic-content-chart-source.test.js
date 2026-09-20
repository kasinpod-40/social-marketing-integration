import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Organic Content chart uses the Metric table shared by Channel and Period slicers', async () => {
  const source = await readFile(new URL(
    '../../apps/sync-worker/src/customer-paid-trend-preview-http.js',
    import.meta.url,
  ), 'utf8');
  const runner = await readFile(new URL(
    '../../scripts/customer-paid-trend-one-command.mjs',
    import.meta.url,
  ), 'utf8');

  assert.match(source, /const ORGANIC_CONTENT_CHART_NAME = '📈 Views เทียบ Engagement ตาม Content';/u);
  assert.match(source, /const ORGANIC_CONTENT_LIMIT = 10;/u);
  assert.match(source, /table_name: '📊 MKT_Report_Metric_Values'/u);
  assert.match(source, /field_name: 'content_chart_label', mode: 'integrated'/u);
  assert.match(source, /field_name: 'metric_key', operator: 'contains', value: \[':content_performance'\]/u);
  assert.match(source, /field_name: 'rank', operator: 'isLessEqual', value: ORGANIC_CONTENT_LIMIT/u);
  assert.match(source, /field_name: 'content_period_views', rollup: 'SUM'/u);
  assert.match(source, /field_name: 'content_period_engagement', rollup: 'SUM'/u);
  assert.match(runner, /'apply_organic_content_chart'/u);
});
