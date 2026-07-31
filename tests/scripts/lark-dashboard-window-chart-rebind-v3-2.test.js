import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EXECUTIVE_DASHBOARD_NAME,
  EXECUTIVE_NUMBER_WINDOW_CHART_NAMES,
  assertReviewedExecutiveWindowChartSet,
  assertReviewedNumberWindowChart,
  hasNumberWindowReference,
  hasPreservedWindowReference,
  rewriteNumberWindowChartToPreservedSelect,
} from '../../scripts/lib/lark-dashboard-window-chart-rebind-v3-2.js';

test('window chart scope is exactly the three audited Executive columns', () => {
  assert.deepEqual(EXECUTIVE_NUMBER_WINDOW_CHART_NAMES, [
    'Net Sales by Window',
    'Ad Spend by Window',
    'Organic Views by Window',
  ]);
  assert.deepEqual(
    assertReviewedExecutiveWindowChartSet([
      'Organic Views by Window',
      'Net Sales by Window',
      'Ad Spend by Window',
    ]),
    EXECUTIVE_NUMBER_WINDOW_CHART_NAMES,
  );
  for (const blockName of EXECUTIVE_NUMBER_WINDOW_CHART_NAMES) {
    assert.deepEqual(assertReviewedNumberWindowChart({
      dashboardName: EXECUTIVE_DASHBOARD_NAME,
      blockName,
      blockType: 'column',
    }), {
      dashboardName: EXECUTIVE_DASHBOARD_NAME,
      blockName,
      blockType: 'column',
    });
  }
  assert.throws(
    () => assertReviewedExecutiveWindowChartSet([
      'Net Sales by Window',
      'Ad Spend by Window',
      'Ad Spend by Window',
    ]),
    (error) => error.code === 'LARK_DASHBOARD_WINDOW_CHART_SET_INVALID',
  );
  assert.throws(
    () => assertReviewedExecutiveWindowChartSet([
      'Net Sales by Window',
      'Ad Spend by Window',
      'Orders by Window',
    ]),
    (error) => error.code === 'LARK_DASHBOARD_WINDOW_CHART_SET_INVALID',
  );
  assert.throws(
    () => assertReviewedNumberWindowChart({
      dashboardName: EXECUTIVE_DASHBOARD_NAME,
      blockName: 'Orders by Window',
      blockType: 'column',
    }),
    (error) => error.code === 'LARK_DASHBOARD_WINDOW_CHART_SCOPE_UNSUPPORTED',
  );
  assert.throws(
    () => assertReviewedNumberWindowChart({
      dashboardName: EXECUTIVE_DASHBOARD_NAME,
      blockName: 'Net Sales by Window',
      blockType: 'slicer',
    }),
    (error) => error.code === 'LARK_DASHBOARD_WINDOW_CHART_SCOPE_UNSUPPORTED',
  );
});

test('Number window chart rewrites field identity, field type and preset values losslessly', () => {
  const before = {
    group: [{ field_name: 'window_days', field_type: 2 }],
    filter: {
      conjunction: 'and',
      conditions: [
        { field_name: 'metric_key', field_type: 1, operator: 'contains', value: ['woocommerce'] },
        { field_name: 'window_days', field_type: 2, operator: 'is', value: [30] },
      ],
    },
    nested: { fieldId: 'fldbPCldTL', originFieldType: 2, defaultValue: 7 },
  };
  const result = rewriteNumberWindowChartToPreservedSelect({
    dashboardName: EXECUTIVE_DASHBOARD_NAME,
    blockName: 'Net Sales by Window',
    blockType: 'column',
    dataConfig: before,
  });

  assert.equal(result.changed, true);
  assert.equal(result.sourceReferenceCount, 3);
  assert.equal(result.dataConfig.group[0].field_name, '__mkt_legacy_window_days_single_select_v1');
  assert.equal(result.dataConfig.group[0].field_type, 3);
  assert.deepEqual(result.dataConfig.filter.conditions[1].value, ['30']);
  assert.equal(result.dataConfig.filter.conditions[1].field_type, 3);
  assert.equal(result.dataConfig.nested.fieldId, 'fldMlTUP3Z');
  assert.equal(result.dataConfig.nested.originFieldType, 3);
  assert.equal(result.dataConfig.nested.defaultValue, '7');
  assert.equal(hasNumberWindowReference(result.dataConfig), false);
  assert.equal(hasPreservedWindowReference(result.dataConfig), true);
  assert.deepEqual(before.filter.conditions[1].value, [30]);
  assert.deepEqual(Object.keys(result.patch).sort(), ['filter', 'group', 'nested']);
});

test('rewrite leaves unrelated numeric presets and field types unchanged', () => {
  const before = {
    group: [{ field_name: 'window_days', field_type: 2 }],
    filter: {
      conjunction: 'and',
      conditions: [
        { field_name: 'window_days', field_type: 2, operator: 'is', value: [30] },
        { field_name: 'days_since_order', field_type: 2, operator: 'is', value: [30] },
      ],
    },
    appearance: {
      defaultValue: 7,
      limit: { value: 30 },
      fieldType: 2,
    },
  };
  const result = rewriteNumberWindowChartToPreservedSelect({
    dashboardName: EXECUTIVE_DASHBOARD_NAME,
    blockName: 'Organic Views by Window',
    blockType: 'column',
    dataConfig: before,
  });

  assert.deepEqual(result.dataConfig.filter.conditions[0].value, ['30']);
  assert.equal(result.dataConfig.filter.conditions[0].field_type, 3);
  assert.deepEqual(result.dataConfig.filter.conditions[1].value, [30]);
  assert.equal(result.dataConfig.filter.conditions[1].field_type, 2);
  assert.equal(result.dataConfig.appearance.defaultValue, 7);
  assert.equal(result.dataConfig.appearance.limit.value, 30);
  assert.equal(result.dataConfig.appearance.fieldType, 2);
});

test('rewrite fails closed when the reviewed chart no longer references Number window_days', () => {
  assert.throws(
    () => rewriteNumberWindowChartToPreservedSelect({
      dashboardName: EXECUTIVE_DASHBOARD_NAME,
      blockName: 'Ad Spend by Window',
      blockType: 'column',
      dataConfig: {
        group: [{ field_name: '__mkt_legacy_window_days_single_select_v1', field_type: 3 }],
      },
    }),
    (error) => error.code === 'LARK_DASHBOARD_WINDOW_CHART_SOURCE_REFERENCE_MISSING',
  );
});

test('Live operator source wires exact 17/5/7 planning and never PATCHes a slicer', async () => {
  const source = await readFile(
    new URL('../../scripts/lark-dashboard-field-identity-recovery-v3.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /pendingWindowChartRebindCount/);
  assert.match(source, /rebind-number-window-charts/);
  assert.match(source, /rewriteNumberWindowChartToPreservedSelect/);
  assert.match(source, /assertReviewedExecutiveWindowChartSet/);
  assert.match(
    source,
    /const preservedWindowChartCount\s*=\s*alreadyPreservedWindowChartCount\s*\+\s*numberWindowChartCount/,
  );
  assert.match(source, /preservedWindowChartCount\s*!==\s*7/);
  assert.match(source, /slicerPatchCount:\s*0/);
  assert.doesNotMatch(source, /blockType:\s*['"]slicer['"][\s\S]{0,500}method:\s*['"]PATCH['"]/);
});
