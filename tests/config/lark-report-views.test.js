import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_REPORT_VIEWS,
  LARK_REPORT_VIEW_VERSION,
  validateReportViewDefinition,
} from '../../packages/config/src/lark-report-views.js';

test('report client view contract is valid, immutable, and covers daily/weekly outputs', () => {
  assert.equal(validateReportViewDefinition(), true);
  assert.equal(LARK_REPORT_VIEW_VERSION, 'report-client-views-v1.4');
  assert.equal(Object.isFrozen(LARK_REPORT_VIEWS), true);

  const hiddenFields = LARK_REPORT_VIEWS.flatMap((table) => table.views.flatMap((view) => view.hiddenFields));
  assert.equal(hiddenFields.includes('report_metric_key'), false);
  assert.equal(hiddenFields.includes('report_content_key'), false);
  assert.deepEqual(
    LARK_REPORT_VIEWS.flatMap((table) => table.views.map((view) => view.name)),
    ['📊 Client Metrics', '📊 Daily Metrics', '📈 Weekly Metrics', '🏆 Top Content', '🏆 Daily Top Content', '🏅 Weekly Top Content'],
  );
});

test('report client view contract rejects duplicate view names', () => {
  assert.throws(
    () => validateReportViewDefinition([{
      tableKey: 'duplicate', envName: 'TABLE_ID',
      views: [
        { key: 'one', name: 'Same', type: 'grid', hiddenFields: [], filterInfo: { conjunction: 'and', conditions: [{ fieldName: 'status', operator: 'is', value: 'a' }] } },
        { key: 'two', name: ' same ', type: 'grid', hiddenFields: [], filterInfo: { conjunction: 'and', conditions: [{ fieldName: 'status', operator: 'is', value: 'b' }] } },
      ],
    }]),
    (error) => error.code === 'LARK_REPORT_VIEW_CONTRACT_INVALID',
  );
});
