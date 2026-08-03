import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkNativeAiSchemaViewFilter,
  buildLarkNativeAiSchemaViewFilterConflictDetails,
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

function rawView(viewId, viewName, conjunction, conditions) {
  return {
    viewId,
    viewName,
    viewType: 'grid',
    property: {
      hiddenFields: [],
      filterInfo: {
        conjunction,
        conditions: conditions.map((condition) => ({
          fieldId: condition.fieldId,
          fieldType: condition.fieldType,
          operator: condition.operator,
          value: JSON.stringify(condition.value),
        })),
      },
    },
  };
}

function planClient(view) {
  return {
    getView: async ({ viewId }) => {
      assert.equal(viewId, view.viewId);
      return structuredClone(view);
    },
  };
}

test('resolves Select names and expands SingleSelect any-of into one OR condition per option ID', () => {
  const executive = buildLarkNativeAiSchemaViewFilter(executiveContract, rawFields());
  assert.deepEqual(executive.mutation.conditions, [{
    fieldId: 'fld_scope',
    fieldType: 3,
    operator: 'is',
    value: ['opt_scope_executive'],
  }]);

  const missing = buildLarkNativeAiSchemaViewFilter(missingContract, rawFields());
  assert.equal(missing.mutation.conjunction, 'or');
  assert.equal(missing.mutation.conditions.length, 6);
  assert.ok(missing.mutation.conditions.every(({ value }) => value.length === 1));
  assert.deepEqual(
    missing.mutation.conditions.map(({ value }) => value[0]).sort(),
    [
      'opt_partial',
      'opt_missing',
      'opt_config',
      'opt_source',
      'opt_not_observed',
      'opt_invalid',
    ].sort(),
  );
  assert.equal(JSON.stringify(missing.mutation).includes('report_partial'), false);
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
  const view = rawView('vew_executive', executiveContract.viewName, 'and', [{
    fieldId: 'fld_scope',
    fieldType: 3,
    operator: 'is',
    value: ['opt_scope_executive'],
  }]);
  const plans = await buildLarkNativeAiSchemaViewPlans(planClient(view), {
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

test('accepts exact six-condition SingleSelect OR read-back as complete', async () => {
  const fields = rawFields();
  const expected = buildLarkNativeAiSchemaViewFilter(missingContract, fields);
  const reversed = [...expected.mutation.conditions].reverse();
  const view = rawView('vew_missing', missingContract.viewName, 'or', reversed);

  const plans = await buildLarkNativeAiSchemaViewPlans(planClient(view), {
    table: { tableId: 'tbl_ai' },
    fields,
    views: [view],
  });

  assert.equal(
    plans.find((item) => item.viewName === missingContract.viewName).state,
    'complete',
  );
});

test('repairs only the exact collapsed one-value SingleSelect predecessor', async () => {
  const fields = rawFields();
  const expected = buildLarkNativeAiSchemaViewFilter(missingContract, fields);
  const predecessor = expected.mutation.conditions[0];
  const view = rawView('vew_missing', missingContract.viewName, 'and', [predecessor]);

  const plans = await buildLarkNativeAiSchemaViewPlans(planClient(view), {
    table: { tableId: 'tbl_ai' },
    fields,
    views: [view],
  });

  assert.equal(
    plans.find((item) => item.viewName === missingContract.viewName).state,
    'configure',
  );
  assert.equal(plans.filter((item) => item.state === 'configure').length, 1);
});

test('fails closed when the collapsed predecessor value is outside the accepted set', async () => {
  const fields = rawFields();
  const view = rawView('vew_missing', missingContract.viewName, 'and', [{
    fieldId: 'fld_readiness',
    fieldType: 3,
    operator: 'is',
    value: ['opt_available'],
  }]);

  await assert.rejects(
    buildLarkNativeAiSchemaViewPlans(planClient(view), {
      table: { tableId: 'tbl_ai' },
      fields,
      views: [view],
    }),
    (error) => error?.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT'
      && error.details?.viewName === missingContract.viewName
      && error.details?.readback?.actual?.totalValueCount === 1
      && error.details?.readback?.expected?.totalValueCount === 6,
  );
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

test('emits structural diagnostics matching the proven one-of-six Live collapse', () => {
  const fields = rawFields();
  const expected = buildLarkNativeAiSchemaViewFilter(missingContract, fields).comparable;
  const actual = normalizeLarkNativeAiSchemaComparableViewFilter({
    conjunction: 'and',
    conditions: [{
      fieldId: 'fld_readiness',
      fieldType: 3,
      operator: 'is',
      values: [expected.conditions[0].values[0]],
    }],
  });

  const details = buildLarkNativeAiSchemaViewFilterConflictDetails(actual, expected, fields);

  assert.equal(details.actual.conditionCount, 1);
  assert.equal(details.actual.totalValueCount, 1);
  assert.equal(details.expected.conditionCount, 6);
  assert.equal(details.expected.totalValueCount, 6);
  assert.equal(details.actual.conditions[0].fieldName, 'readiness_status');
  assert.equal(details.comparison.fieldSetMatches, true);
  assert.equal(details.comparison.conditionCountMatches, false);
  assert.equal(details.comparison.conditionFieldMultiplicityMatches, false);
  assert.equal(details.comparison.totalValueCountMatches, false);
  assert.equal(details.comparison.flattenedValueMembershipMatches, false);
  assert.equal(details.comparison.conditionGroupingMatches, false);

  const serialized = JSON.stringify(details);
  assert.equal(serialized.includes('fld_readiness'), false);
  assert.equal(serialized.includes('opt_partial'), false);
  assert.equal(serialized.includes('opt_missing'), false);
});

test('keeps conjunction strict when multiple conditions are present', async () => {
  const fields = rawFields();
  const expected = buildLarkNativeAiSchemaViewFilter(notificationContract, fields);
  const view = rawView(
    'vew_notification',
    notificationContract.viewName,
    'or',
    expected.mutation.conditions,
  );

  await assert.rejects(
    buildLarkNativeAiSchemaViewPlans(planClient(view), {
      table: { tableId: 'tbl_ai' },
      fields,
      views: [view],
    }),
    (error) => error?.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_VIEW_FILTER_CONFLICT'
      && error.details?.viewName === notificationContract.viewName
      && error.details?.readback?.comparison?.conjunctionMatches === false,
  );
});

test('fails closed for unsupported SingleSelect multi-value all-of contracts', () => {
  const unsupported = {
    viewName: 'Unsupported',
    logicalFilter: {
      mode: 'all_of',
      conditions: [{
        fieldName: 'readiness_status',
        operator: 'in',
        values: ['report_partial', 'report_missing'],
      }],
    },
  };

  assert.throws(
    () => buildLarkNativeAiSchemaViewFilter(unsupported, rawFields()),
    (error) => error?.code === 'LARK_NATIVE_AI_SCHEMA_APPLY_SINGLE_SELECT_MULTI_VALUE_UNSUPPORTED',
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
