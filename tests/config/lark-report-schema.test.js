import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_REPORT_SCHEMA,
  LARK_REPORT_SCHEMA_VERSION,
  validateReportSchemaDefinition,
} from '../../packages/config/src/lark-report-schema.js';

test('defines the five report tables with one primary field placed first', () => {
  assert.equal(LARK_REPORT_SCHEMA_VERSION, 'report-schema-v1.2');
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
  const settings = LARK_REPORT_SCHEMA.find((table) => table.key === 'mktReportSettings');
  const snapshots = LARK_REPORT_SCHEMA.find((table) => table.key === 'mktReportSnapshots');
  const metricValues = LARK_REPORT_SCHEMA.find((table) => table.key === 'mktReportMetricValues');
  const topContent = LARK_REPORT_SCHEMA.find((table) => table.key === 'mktReportTopContent');
  assert.equal(metricValues.fields.length, 26);
  assert.equal(topContent.fields.length, 26);
  assert.equal(metricValues.fields.some((field) => field.fieldName === 'change_percent'), true);
  assert.equal(topContent.fields.some((field) => field.fieldName === 'performance_status'), true);
  assert.equal(settings.fields.some((field) => field.fieldName === 'period_kind'), true);
  assert.equal(settings.fields.some((field) => field.fieldName === 'window_days'), true);
  assert.equal(snapshots.fields.some((field) => field.fieldName === 'period_kind'), true);
  for (const table of [settings, snapshots, metricValues, topContent]) {
    const reportType = table.fields.find((field) => field.fieldName === 'report_type');
    assert.equal(
      reportType.property.options.some((option) => option.name === 'dashboard_performance_report'),
      true,
    );
  }
});


test('uses only Lark OpenAPI-compatible Number formatter enums', () => {
  const allowed = new Set(['0', '0.0', '0.00', '0.000', '0.0000', '1,000', '1,000.00', '%', '0.00%']);
  const numberFields = LARK_REPORT_SCHEMA.flatMap((table) => table.fields)
    .filter((field) => field.type === 2 && field.property?.formatter);
  assert.ok(numberFields.length > 0);
  for (const field of numberFields) {
    assert.equal(allowed.has(field.property.formatter), true, `${field.fieldName}: ${field.property.formatter}`);
  }
});
