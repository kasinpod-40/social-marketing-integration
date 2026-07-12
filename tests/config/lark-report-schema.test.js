import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_REPORT_SCHEMA,
  LARK_REPORT_SCHEMA_VERSION,
  validateReportSchemaDefinition,
} from '../../packages/config/src/lark-report-schema.js';

test('defines the five report tables with one primary field placed first', () => {
  assert.equal(LARK_REPORT_SCHEMA_VERSION, 'report-schema-v1.1');
  assert.equal(LARK_REPORT_SCHEMA.length, 5);
  assert.equal(validateReportSchemaDefinition(), true);
  assert.deepEqual(LARK_REPORT_SCHEMA.map((table) => table.logicalName), [
    'MKT_Metric_Definitions',
    'MKT_Report_Settings',
    'MKT_Report_Snapshots',
    'MKT_Report_Metric_Values',
    'MKT_Report_Top_Content',
  ]);
  for (const table of LARK_REPORT_SCHEMA) {
    assert.equal(table.fields[0].primary, true);
    assert.equal(table.fields.filter((field) => field.primary).length, 1);
  }
});

test('contains report output fields required by runtime contracts', () => {
  const metricValues = LARK_REPORT_SCHEMA.find((table) => table.key === 'mktReportMetricValues');
  const topContent = LARK_REPORT_SCHEMA.find((table) => table.key === 'mktReportTopContent');
  assert.equal(metricValues.fields.length, 26);
  assert.equal(topContent.fields.length, 26);
  assert.equal(metricValues.fields.some((field) => field.fieldName === 'change_percent'), true);
  assert.equal(topContent.fields.some((field) => field.fieldName === 'performance_status'), true);
});
