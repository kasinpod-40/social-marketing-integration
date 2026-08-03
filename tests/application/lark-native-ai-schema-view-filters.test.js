import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkNativeAiSchemaViewFilter,
  buildLarkNativeAiSchemaViewPlans,
  normalizeLarkNativeAiSchemaComparableViewFilter,
} from '../../packages/application/src/reports/lark-native-ai-schema-view-filters.js';
import {
  LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS,
} from '../../packages/config/src/lark-native-ai-schema-preview.js';

const executiveContract = contract('📊 Executive Summaries');
const notificationContract = contract('✅ Notification Eligible');
const missingContract = contract('⚠️ Missing / Partial Data');

function contract(viewName) {
  const value = LARK_NATIVE_AI_PREVIEW_VIEW_CONTRACTS.find((item) => item.viewName === viewName);
  assert.ok(value);
  return value;
}

function rawFields() {
  return [
    selectField('fld_scope', 'scope_type', [
      ['opt_scope_channel', 'channel'],
      ['opt_scope_executive', 'executive'],
    ]),
    selectField('fld_readiness', 'readiness_status', [
      ['opt_available', 'report_available'],
      ['opt_partial', 'report_partial'],
      ['opt_no_data', 'no_data_confirmed'],
      ['opt_source', 'source_unavailable'],
      ['opt_not_observed', 'not_observed'],
      ['opt_missing', 'report_missing'],
      ['opt_config', 'configuration_missing'],
      ['opt_invalid', 'validation_failed'],
    ]),
    checkboxField('fld_notify', 'notification_eligible'),
    checkboxField('fld_preview', 'preview_mode'),
    selectField('fld_generation', 'generation_status', [
      ['opt_pending', 'pending'],
      ['opt_generated', 'generated'],
      ['opt_skipped', 'skipped'],
      ['opt_failed', 'failed'],
    ]),
  ];
}

function selectField(fieldId, fieldName, options) {
  return {
    fieldId,
    fieldName,
    type: 3,
    uiType: 'SingleSelect',
    property: {
      options: options.map(([id, name], index) => ({ id, name, color: index % 10 })),
    },
  };
}

function checkboxField(fieldId, fieldName) {
  return {
    fieldId,
    fieldName,
    type: 7,
    uiType: 'Checkbox',
    property: null,
  };
}

test('resolves name-based Select contracts to exact live option IDs', () => {
  const executive = buildLarkNativeAiSchemaViewFilter(executiveContract, rawFields());
  assert.deepEqual(executive.mutation.conditions, [{
    fieldId: 'fld_scope',
    fieldType: 3,
    operator: 'is',
    value: ['opt_scope_executive'],
  }]);

  const missing = buildLarkNativeAiSchemaViewFilter(missingContract, rawFields());
  assert.deepEqual(missing.mutation.conditions[0].value, [
    'opt_partial',
    'opt_missing',
    'opt_config',
    'opt_source',
    'opt_not_observed',
    'opt_invalid',
  ]);
  assert.equal(missing.mutation.conditions[0].value.includes('report_partial'), false);
});

test('preserves JSON Boolean values for Checkbox View filters', () => {
  const notification = buildLarkNativeAiSchemaViewFilter(notificationContract, rawFields());
  const byField = new Map(notification.mutation.conditions.map((item) => [item.fieldId, item]));

  assert.deepEqual(byField.get('fld_notify').value, [true]);
  assert.deepEqual(byField.get('fld_preview').value, [false]);
  assert.equal(typeof byField.get('fld_notify').value[0], 'boolean');
  assert.equal(typeof byField.get('fld_preview').value[0], 'boolean');
});

test('treats an exact option-ID read-back as complete during partial retry', async () => {
  const fields = rawFields();
  const view = {
    viewId: 'vew_executive',
    viewName: executiveContract.viewName,
    viewType: 'grid',
    property: {
      hiddenFields: [],
      filterInfo: {
        conjunction: 'and',
        conditions: [{
          fieldId: 'fld_scope',
          fieldType: 3,
          operator: 'is',
          value: JSON.stringify(['opt_scope_executive']),
        }],
      },
    },
  };
  const client = {
    getView: async ({ viewId }) => {
      assert.equal(viewId, 'vew_executive');
      return structuredClone(view);
    },
  };
  const plans = await buildLarkNativeAiSchemaViewPlans(client, {
    table: { tableId: 'tbl_ai' },
    fields,
    views: [view],
  });

  assert.equal(
    plans.find((item) => item.viewName === executiveContract.viewName).state,
    'complete',
  );
  assert.equal(plans.filter((item) => item.state === 'create').length, 5);
});

test('accepts Lark canonical read-back for one-condition OR with reordered option IDs', async () => {
  const fields = rawFields();
  const expected = buildLarkNativeAiSchemaViewFilter(missingContract, fields);
  const reversed = [...expected.mutation.conditions[0].value].reverse();
  const view = {
    viewId: 'vew_missing',
    viewName: missingContract.viewName,
    viewType: 'grid',
    property: {
      hiddenFields: [],
      filterInfo: {
        // Lark may normalize a one-condition OR to AND; conjunction is semantically irrelevant here.
        conjunction: 'and',
        conditions: [{
          fieldId: 'fld_readiness',
          fieldType: 3,
          operator: 'is',
          value: JSON.stringify(reversed),
        }],
      },
    },
  };
  const client = {
    getView: async ({ viewId }) => {
      assert.equal(viewId, 'vew_missing');
      return structuredClone(view);
    },
  };

  const plans = await buildLarkNativeAiSchemaViewPlans(client, {
    table: { tableId: 'tbl_ai' },
    fields,
    views: [view],
  });

  assert.equal(
    plans.find((item) => item.viewName === missingContract.viewName).state,
    'complete',
  );
  assert.equal(plans.filter((item) => item.state === 'create').length, 5);
});

test('normalizes only semantically irrelevant presentation differences', () => {
  const single = normalizeLarkNativeAiSchemaComparableViewFilter({
    conjunction: 'or',
    conditions: [{
      fieldId: 'fld_readiness',
      fieldType: 3,
      operator: 'is',
      values: ['opt_z', 'opt_a'],
    }],
  });
  assert.equal(single.conjunction, 'and');
  assert.deepEqual(single.conditions[0].values, ['opt_a', 'opt_z']);

  const multiple = normalizeLarkNativeAiSchemaComparableViewFilter({
    conjunction: 'or',
    conditions: [
      { fieldId: 'fld_b', fieldType: 7, operator: 'is', values: [false] },
      { fieldId: 'fld_a', fieldType: 7, operator: 'is', values: [true] },
    ],
  });
  assert.equal(multiple.conjunction, 'or');
});

test('keeps conjunction strict when multiple conditions are present', async () => {
  const fields = rawFields();
  const expected = buildLarkNativeAiSchemaViewFilter(notificationContract, fields);
  const view = {
    viewId: 'vew_notification',
    viewName: notificationContract.viewName,
    viewType: 'grid',
    property: {
      hiddenFields: [],
      filterInfo: {
        conjunction: 'or',
        conditions: expected.mutation.conditions.map((condition) => ({
          fieldId: condition.fieldId,
          fieldType: condition.fieldType,
          operator: condition.operator,
          value: JSON.stringify(condition.value),
        })),
      },
    },
  };
  const client = { getView: async () => structuredClone(view) };

  await assert.rejects(
    buildLarkNativeAiSchemaViewPlans(client, {
      table: { tableId: 'tbl_ai' },
      fields,
      views: [view],
    }),
    (error) => error?.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT'
      && error.details?.viewName === notificationContract.viewName,
  );
});

test('fails closed when a Select option name cannot resolve to one live option ID', () => {
  const fields = rawFields();
  fields.find(({ fieldName }) => fieldName === 'scope_type').property.options = [
    { id: 'opt_scope_channel', name: 'channel', color: 0 },
  ];

  assert.throws(
    () => buildLarkNativeAiSchemaViewFilter(executiveContract, fields),
    (error) => error?.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_OPTION_ID_INVALID'
      && error.details?.optionName === 'executive'
      && error.details?.matchCount === 0,
  );
});
