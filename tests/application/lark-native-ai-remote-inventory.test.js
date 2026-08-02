import assert from 'node:assert/strict';
import test from 'node:test';

import { collectLarkNativeAiSchemaInventory } from '../../packages/application/src/reports/collect-lark-native-ai-schema-inventory.js';
import { LARK_NATIVE_AI_TARGET_TABLE } from '../../packages/config/src/lark-native-ai-schema-preview.js';

function baseFields(overrides = {}) {
  const fields = [
    field('report_id', 1, 'Text'),
    field('metric_summary_json', 1, 'Text'),
    field('platforms', 4, 'MultiSelect', overrides.platformOptions === undefined
      ? ['facebook', 'instagram', 'tiktok', 'youtube', 'meta_ads', 'tiktok_ads', 'google_ads']
      : overrides.platformOptions),
    field('period_start', 5, 'DateTime'),
    field('comparison_mode', 3, 'SingleSelect', ['none', 'previous_period']),
    field('insight_summary', 1, 'Text'),
    field('sent_to_group', 7, 'Checkbox'),
    field('compare_end', 5, 'DateTime'),
    field('recommendations', 1, 'Text'),
    field('sent_at', 5, 'DateTime'),
    field('report_type', 3, 'SingleSelect', overrides.reportTypeOptions === undefined
      ? ['daily_organic_report', 'weekly_organic_report', 'dashboard_performance_report']
      : overrides.reportTypeOptions),
    field('course_filter', 1, 'Text'),
    field('strengths', 1, 'Text'),
    field('compare_start', 5, 'DateTime'),
    field('period_end', 5, 'DateTime'),
    field('weaknesses', 1, 'Text'),
  ];
  return fields;
}

function field(fieldName, type, uiType, options = null) {
  return {
    fieldId: `fld_${fieldName}`,
    fieldName,
    type,
    uiType,
    property: options === null ? null : { options: options.map((name) => ({ name })) },
  };
}

function fakeClient(input = {}) {
  const calls = [];
  const targetTables = input.targetTables ?? [{
    tableId: 'tbl_ai',
    name: LARK_NATIVE_AI_TARGET_TABLE,
    revision: 42,
  }];
  return {
    calls,
    async listTables() {
      calls.push('listTables');
      return [
        { tableId: 'tbl_other', name: 'RAW_Other', revision: 3 },
        ...targetTables,
      ];
    },
    async listFields({ tableId }) {
      calls.push(`listFields:${tableId}`);
      if (input.failDetailReads) throw new Error('detail reads must not run');
      return input.fields ?? baseFields();
    },
    async listViews({ tableId }) {
      calls.push(`listViews:${tableId}`);
      if (input.failDetailReads) throw new Error('detail reads must not run');
      return input.views ?? [];
    },
  };
}

test('collects sanitized metadata and produces the exact 31-action Base 14 schema Preview', async () => {
  const client = fakeClient();
  const result = await collectLarkNativeAiSchemaInventory({
    client,
    baseName: 'Social MKT Data Hub',
  });

  assert.equal(result.ok, true);
  assert.equal(result.targetTableCount, 1);
  assert.equal(result.metadataReadOperations, 3);
  assert.deepEqual(client.calls, ['listTables', 'listFields:tbl_ai', 'listViews:tbl_ai']);
  assert.equal(result.inventory.baseName, 'Social MKT Data Hub');
  assert.equal(result.inventory.baseRevision, 42);
  assert.match(result.inventory.sourceSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(result.preview.counts, {
    addField: 23,
    extendSelectOptions: 2,
    createView: 6,
    blockers: 0,
    totalActions: 31,
  });
  assert.equal(result.preview.status, 'ready_to_apply');
  assert.equal(result.preview.applyAuthorized, false);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /tbl_ai|tbl_other|fld_report_id/u);
  assert.equal(result.safety.tableIdsPersisted, 0);
  assert.equal(result.safety.fieldIdsPersisted, 0);
  assert.equal(result.safety.viewIdsPersisted, 0);
  assert.equal(result.safety.recordReads, 0);
  assert.equal(result.safety.remoteLarkWrites, 0);
});

test('stops after table metadata when the target table identity is duplicate', async () => {
  const client = fakeClient({
    targetTables: [
      { tableId: 'tbl_ai_1', name: LARK_NATIVE_AI_TARGET_TABLE },
      { tableId: 'tbl_ai_2', name: LARK_NATIVE_AI_TARGET_TABLE },
    ],
    failDetailReads: true,
  });
  const result = await collectLarkNativeAiSchemaInventory({ client });

  assert.equal(result.ok, false);
  assert.equal(result.targetTableCount, 2);
  assert.equal(result.metadataReadOperations, 1);
  assert.deepEqual(client.calls, ['listTables']);
  assert.equal(result.preview.status, 'blocked');
  assert.equal(result.preview.blockers[0].code, 'TARGET_TABLE_DUPLICATE');
});

test('fails closed when the target table contains an unsupported Lark field type', async () => {
  const client = fakeClient({
    fields: [
      ...baseFields(),
      { fieldId: 'fld_formula', fieldName: 'unexpected_formula', type: 20, uiType: 'Formula' },
    ],
  });

  await assert.rejects(
    () => collectLarkNativeAiSchemaInventory({ client }),
    (error) => error?.code === 'LARK_NATIVE_AI_REMOTE_FIELD_TYPE_UNSUPPORTED',
  );
});

test('keeps unknown select options fail-closed instead of assuming an empty option set', async () => {
  const fields = baseFields().map((item) => (
    item.fieldName === 'platforms' ? { ...item, property: null } : item
  ));
  const result = await collectLarkNativeAiSchemaInventory({ client: fakeClient({ fields }) });

  assert.equal(result.ok, false);
  assert.equal(result.preview.status, 'blocked');
  assert.ok(result.preview.blockers.some(({ code, subject }) => (
    code === 'SELECT_OPTIONS_UNAVAILABLE' && subject === 'platforms'
  )));
});

test('preserves zero drift when the live inventory already contains every additive field, option and View', async () => {
  const first = await collectLarkNativeAiSchemaInventory({ client: fakeClient() });
  const simulated = JSON.parse(JSON.stringify(first.inventory));
  const table = simulated.tables.find(({ tableName }) => tableName === LARK_NATIVE_AI_TARGET_TABLE);
  for (const action of first.preview.actions) {
    if (action.action === 'add_field') {
      table.fields.push({
        fieldName: action.fieldName,
        fieldType: action.fieldType,
        ...(action.options ? { options: [...action.options] } : {}),
      });
    } else if (action.action === 'extend_select_options') {
      const target = table.fields.find(({ fieldName }) => fieldName === action.fieldName);
      target.options = [...new Set([...(target.options ?? []), ...action.optionsToAdd])];
    } else if (action.action === 'create_view') {
      table.views.push({ viewName: action.viewName });
    }
  }

  const replayClient = fakeClient({
    fields: table.fields.map((item) => ({
      fieldId: `fld_${item.fieldName}`,
      fieldName: item.fieldName,
      type: ({ Text: 1, Number: 2, SingleSelect: 3, MultiSelect: 4, DateTime: 5, Checkbox: 7 })[item.fieldType],
      uiType: item.fieldType,
      property: Object.prototype.hasOwnProperty.call(item, 'options')
        ? { options: item.options.map((name) => ({ name })) }
        : null,
    })),
    views: table.views.map(({ viewName }, index) => ({ viewId: `vew_${index}`, viewName })),
  });
  const replay = await collectLarkNativeAiSchemaInventory({ client: replayClient });
  assert.equal(replay.preview.status, 'zero_drift');
  assert.equal(replay.preview.actions.length, 0);
  assert.equal(replay.preview.blockers.length, 0);
});
