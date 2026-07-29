import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReportMetricLegacyReadNormalizer,
  normalizeLegacyReportWindowDays,
} from '../../scripts/lib/report-metric-legacy-read-normalizer.js';

test('normalizes only unambiguous canonical Report preset-day labels', () => {
  for (const [input, expected] of [
    ['1', '1'], ['3D', '3'], ['7 days', '7'], ['rolling:9d', '9'],
    [{ name: '15D' }, '15'], [[{ text: '30 days' }], '30'], ['90d', '90'],
  ]) {
    assert.equal(normalizeLegacyReportWindowDays(input), expected);
  }
});

test('leaves ambiguous, unsupported and multi-entry labels unchanged so migration fails closed', () => {
  for (const input of [
    '0', '03', '3 weeks', 'rolling_days', 'custom', '365D',
    ['3', '0'], [{ text: '3' }, { text: '0' }],
  ]) {
    assert.deepEqual(normalizeLegacyReportWindowDays(input), input);
  }
  assert.equal(normalizeLegacyReportWindowDays(null), null);
});

test('normalizes the migration read model without mutating raw Legacy records', async () => {
  const raw = [{
    recordId: 'rec1',
    fields: {
      report_metric_key: 'one',
      window_days: { name: '3D' },
      __mkt_legacy_window_days_single_select_v1: [{ text: '7 days' }],
      display_name: 'Views',
    },
  }];
  const client = createReportMetricLegacyReadNormalizer({
    async listRecords() { return structuredClone(raw); },
  });
  const normalized = await client.listRecords({ tableId: 'tblMetric' });
  assert.equal(normalized[0].fields.window_days, '3');
  assert.equal(normalized[0].fields.__mkt_legacy_window_days_single_select_v1, '7');
  assert.deepEqual(raw[0].fields.window_days, { name: '3D' });
  assert.deepEqual(raw[0].fields.__mkt_legacy_window_days_single_select_v1, [{ text: '7 days' }]);
  assert.equal(normalized[0].fields.display_name, 'Views');
});
