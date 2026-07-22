import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLarkReportViews,
  planLarkReportViews,
} from '../../packages/application/src/use-cases/install-lark-report-views.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

const CONTRACT = Object.freeze([Object.freeze({
  tableKey: 'metrics',
  envName: 'TABLE_METRICS',
  views: Object.freeze([Object.freeze({
    key: 'daily',
    name: 'Daily Client',
    type: 'grid',
    hiddenFields: Object.freeze(['technical_meta']),
    filterInfo: Object.freeze({
      conjunction: 'and',
      conditions: Object.freeze([
        Object.freeze({ fieldName: 'report_type', operator: 'is', value: 'daily_organic_report' }),
        Object.freeze({ fieldName: 'client_visible', operator: 'is', value: 'true' }),
      ]),
    }),
    manualSort: Object.freeze({ fieldName: 'rank', direction: 'ascending' }),
  })]),
})]);

const FIELDS = Object.freeze([
  { fieldId: 'fldKey', fieldName: 'technical_key', type: 1, isPrimary: true },
  { fieldId: 'fldMeta', fieldName: 'technical_meta', type: 1, isPrimary: false },
  {
    fieldId: 'fldType', fieldName: 'report_type', type: 3,
    property: {
      options: [
        { id: 'optDaily', name: 'daily_organic_report' },
        { id: 'optWeekly', name: 'weekly_organic_report' },
      ],
    },
  },
  { fieldId: 'fldVisible', fieldName: 'client_visible', type: 7 },
  { fieldId: 'fldRank', fieldName: 'rank', type: 2 },
]);

test('preview plans a missing client view without writing', async () => {
  let writes = 0;
  const client = {
    async listFields() { return FIELDS; },
    async listViews() { return []; },
    async createView() { writes += 1; },
    async updateView() { writes += 1; },
  };
  const result = await planLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract: CONTRACT });
  assert.equal(result.readyToApply, true);
  assert.equal(result.summary.createViews, 1);
  assert.equal(result.summary.updateViews, 0);
  assert.equal(result.actions[0].property.hiddenFields[0], 'fldMeta');
  assert.equal(result.manualActions.some((item) => item.code === 'VIEW_HIDDEN_FIELDS_REVIEW_REQUIRED'), false);
  assert.deepEqual(result.actions[0].property.filterInfo.conditions, [
    { fieldId: 'fldType', fieldType: 3, operator: 'is', value: '["optDaily"]' },
    { fieldId: 'fldVisible', fieldType: 7, operator: 'is', value: '[true]' },
  ]);
  assert.equal(writes, 0);
});

test('apply creates, patches, and verifies a missing view idempotently', async () => {
  const state = { views: [] };
  const client = statefulClient(state);
  const result = await applyLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract: CONTRACT });
  assert.equal(result.ok, true);
  assert.equal(result.summary.createdViews, 1);
  assert.equal(result.verification.actions.length, 0);

  const rerun = await planLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract: CONTRACT });
  assert.equal(rerun.actions.length, 0);
});

test('preview plans an update when managed filters drift', async () => {
  const client = statefulClient({
    views: [{
      viewId: 'vew1', viewName: 'Daily Client', viewType: 'grid',
      property: { hiddenFields: [], filterInfo: null },
    }],
  });
  const result = await planLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract: CONTRACT });
  assert.equal(result.summary.updateViews, 1);
  assert.equal(result.actions[0].kind, 'update_view');
});

test('fails closed when a field needed by a view is missing', async () => {
  const client = {
    async listFields() { return FIELDS.filter((field) => field.fieldName !== 'client_visible'); },
    async listViews() { return []; },
    async createView() {},
    async updateView() {},
  };
  const result = await planLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract: CONTRACT });
  assert.equal(result.readyToApply, false);
  assert.equal(result.conflicts.some((item) => item.code === 'VIEW_FIELD_MISSING'), true);
  await assert.rejects(
    applyLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract: CONTRACT }),
    (error) => error.code === 'LARK_REPORT_VIEW_CONFLICT',
  );
});

test('fails closed on duplicate client view names and view type drift', async () => {
  const client = statefulClient({
    views: [
      { viewId: 'vew1', viewName: 'Daily Client', viewType: 'kanban', property: { hiddenFields: [], filterInfo: null } },
      { viewId: 'vew2', viewName: ' daily client ', viewType: 'grid', property: { hiddenFields: [], filterInfo: null } },
    ],
  });
  const result = await planLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract: CONTRACT });
  assert.equal(result.readyToApply, false);
  assert.equal(result.conflicts.some((item) => item.code === 'DUPLICATE_VIEW_NAME'), true);
  assert.equal(result.conflicts.some((item) => item.code === 'VIEW_TYPE_MISMATCH'), true);
});


test('fails closed when a SingleSelect filter option is missing from live field metadata', async () => {
  const client = {
    async listFields() {
      return FIELDS.map((field) => field.fieldName === 'report_type'
        ? { ...field, property: { options: [{ id: 'optWeekly', name: 'weekly_organic_report' }] } }
        : field);
    },
    async listViews() { return []; },
    async createView() {},
    async updateView() {},
  };
  const result = await planLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract: CONTRACT });
  assert.equal(result.readyToApply, false);
  assert.equal(result.conflicts.some((item) => item.code === 'VIEW_FILTER_SELECT_OPTION_MISSING'), true);
});

test('normalizes live API filter values so a second preview is idempotent', async () => {
  const client = {
    async listFields() { return structuredClone(FIELDS); },
    async listViews() {
      return [{
        viewId: 'vew1', viewName: 'Daily Client', viewType: 'grid',
        property: {
          hiddenFields: ['fldMeta'],
          filterInfo: {
            conjunction: 'and',
            conditions: [
              { fieldId: 'fldType', fieldType: '3', operator: 'is', value: '["optDaily"]' },
              { fieldId: 'fldVisible', fieldType: 7, operator: 'is', value: '[true]' },
            ],
          },
        },
      }];
    },
    async createView() {},
    async updateView() {},
  };
  const result = await planLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract: CONTRACT });
  assert.equal(result.actions.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test('hydrates each existing view because List Views may omit managed property', async () => {
  let getCalls = 0;
  const client = {
    async listFields() { return structuredClone(FIELDS); },
    async listViews() {
      return [{
        viewId: 'vew1', viewName: 'Daily Client', viewType: 'grid',
        property: { hiddenFields: [], filterInfo: null },
      }];
    },
    async getView({ tableId, viewId }) {
      getCalls += 1;
      assert.equal(tableId, 'tblMetrics');
      assert.equal(viewId, 'vew1');
      return {
        viewId, viewName: 'Daily Client', viewType: 'grid',
        property: {
          hiddenFields: ['fldMeta'],
          filterInfo: {
            conjunction: 'and',
            conditions: [
              { fieldId: 'fldType', fieldType: 3, operator: 'is', value: '["optDaily"]' },
              { fieldId: 'fldVisible', fieldType: 7, operator: 'is', value: '[true]' },
            ],
          },
        },
      };
    },
    async createView() {},
    async updateView() {},
  };

  const result = await planLarkReportViews({
    client,
    env: { TABLE_METRICS: 'tblMetrics' },
    contract: CONTRACT,
  });

  assert.equal(getCalls, 1);
  assert.equal(result.actions.length, 0);
  assert.equal(result.conflicts.length, 0);
});


test('preserves safe PATCH diagnostics and failed action context when Lark rejects a view update', async () => {
  const client = {
    async listFields() { return structuredClone(FIELDS); },
    async listViews() {
      return [{
        viewId: 'vew1', viewName: 'Daily Client', viewType: 'grid',
        property: { hiddenFields: [], filterInfo: null },
      }];
    },
    async createView() { throw new Error('unexpected create'); },
    async updateView() {
      throw permanentError('Lark API error 1254001: WrongRequestBody', {
        code: 'LARK_PERMANENT_API_ERROR',
        details: {
          status: 200,
          larkCode: 1254001,
          viewMutationBody: {
            property: {
              filter_info: {
                conjunction: 'and',
                conditions: [{
                  field_id: 'fldVisible', operator: 'is', value: '[true]',
                }],
              },
            },
          },
        },
      });
    },
  };

  await assert.rejects(
    applyLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract: CONTRACT }),
    (error) => {
      assert.equal(error.code, 'LARK_PERMANENT_API_ERROR');
      assert.equal(error.details.appliedActionCount, 0);
      assert.equal(error.details.viewMutationStage, 'filter');
      assert.equal(error.details.viewAction.kind, 'update_view');
      assert.equal(error.details.viewAction.viewName, 'Daily Client');
      assert.equal(error.details.viewMutationBody.property.filter_info.conditions[0].field_id, 'fldVisible');
      return true;
    },
  );
});


test('apply patches filter and hidden fields in separate requests', async () => {
  const calls = [];
  const state = {
    views: [{
      viewId: 'vew1', viewName: 'Daily Client', viewType: 'grid',
      property: { hiddenFields: [], filterInfo: null },
    }],
  };
  const client = {
    async listFields() { return structuredClone(FIELDS); },
    async listViews() { return structuredClone(state.views); },
    async createView() { throw new Error('unexpected create'); },
    async updateView(input) {
      calls.push(structuredClone(input));
      const view = state.views[0];
      if (input.filterInfo !== undefined) view.property.filterInfo = structuredClone(input.filterInfo);
      if (input.hiddenFields !== undefined) view.property.hiddenFields = structuredClone(input.hiddenFields);
      return structuredClone(view);
    },
  };

  const result = await applyLarkReportViews({
    client,
    env: { TABLE_METRICS: 'tblMetrics' },
    contract: CONTRACT,
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].viewName, undefined);
  assert.equal(calls[0].hiddenFields, undefined);
  assert.deepEqual(calls[0].filterInfo.conditions[0], {
    fieldId: 'fldType', fieldType: 3, operator: 'is', value: '["optDaily"]',
  });
  assert.equal(calls[1].filterInfo, undefined);
  assert.deepEqual(calls[1].hiddenFields, ['fldMeta']);
  assert.equal(result.verification.actions.length, 0);
  assert.equal(result.verification.manualActions.some((item) => item.code === 'VIEW_HIDDEN_FIELDS_REVIEW_REQUIRED'), false);
});


test('reports a created view when filter patch fails after create', async () => {
  const client = {
    async listFields() { return structuredClone(FIELDS); },
    async listViews() { return []; },
    async createView() {
      return { viewId: 'vewCreated', viewName: 'Daily Client', viewType: 'grid' };
    },
    async updateView() {
      throw permanentError('Lark API error 1254001: WrongRequestBody', {
        code: 'LARK_PERMANENT_API_ERROR',
        details: { status: 200, larkCode: 1254001 },
      });
    },
  };

  await assert.rejects(
    applyLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract: CONTRACT }),
    (error) => {
      assert.equal(error.details.appliedActionCount, 0);
      assert.equal(error.details.viewCreatedBeforeFailure, true);
      assert.equal(error.details.createdViewId, 'vewCreated');
      assert.equal(error.details.viewMutationStage, 'filter');
      return true;
    },
  );
});

test('excludes a primary field from hidden_fields instead of sending an invalid Lark PATCH body', async () => {
  const primaryHiddenContract = structuredClone(CONTRACT);
  primaryHiddenContract[0].views[0].hiddenFields = ['technical_key', 'technical_meta'];
  const client = {
    async listFields() { return structuredClone(FIELDS); },
    async listViews() { return []; },
    async createView() { throw new Error('preview must not write'); },
    async updateView() { throw new Error('preview must not write'); },
  };

  const result = await planLarkReportViews({
    client,
    env: { TABLE_METRICS: 'tblMetrics' },
    contract: primaryHiddenContract,
  });

  assert.equal(result.readyToApply, true);
  assert.deepEqual(result.actions[0].property.hiddenFields, ['fldMeta']);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'VIEW_PRIMARY_FIELD_CANNOT_BE_HIDDEN');
  assert.equal(result.warnings[0].fieldName, 'technical_key');
  assert.equal(result.manualActions.some((item) => item.code === 'VIEW_HIDDEN_FIELDS_REVIEW_REQUIRED'), false);
});

test('accepts an additional UI-owned relative-date condition when the managed Filter remains correct', async () => {
  const contract = structuredClone(CONTRACT);
  contract[0].views[0].allowAdditionalLiveFilterConditions = true;
  const client = statefulClient({
    views: [{
      viewId: 'vew1', viewName: 'Daily Client', viewType: 'grid',
      property: {
        hiddenFields: ['fldMeta'],
        filterInfo: {
          conjunction: 'and',
          conditions: [
            { fieldId: 'fldType', fieldType: 3, operator: 'is', value: '["optDaily"]' },
            { fieldId: 'fldVisible', fieldType: 7, operator: 'is', value: '[true]' },
            { fieldId: 'fldRank', fieldType: 5, operator: 'is', value: '["TheLastMonth"]' },
          ],
        },
      },
    }],
  });

  const result = await planLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract });
  assert.equal(result.actions.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test('fails closed instead of replacing UI-owned conditions when a managed condition drifts', async () => {
  const contract = structuredClone(CONTRACT);
  contract[0].views[0].allowAdditionalLiveFilterConditions = true;
  const client = statefulClient({
    views: [{
      viewId: 'vew1', viewName: 'Daily Client', viewType: 'grid',
      property: {
        hiddenFields: ['fldMeta'],
        filterInfo: {
          conjunction: 'and',
          conditions: [
            { fieldId: 'fldType', fieldType: 3, operator: 'is', value: '["optWeekly"]' },
            { fieldId: 'fldRank', fieldType: 5, operator: 'is', value: '["TheLastMonth"]' },
          ],
        },
      },
    }],
  });

  const result = await planLarkReportViews({ client, env: { TABLE_METRICS: 'tblMetrics' }, contract });
  assert.equal(result.actions.length, 0);
  assert.equal(result.readyToApply, false);
  assert.equal(result.conflicts.some((item) => item.code === 'VIEW_MANAGED_FILTER_DRIFT_WITH_UI_CONDITIONS'), true);
});

function statefulClient(state) {
  return {
    async listFields() { return structuredClone(FIELDS); },
    async listViews() { return structuredClone(state.views); },
    async createView({ viewName, viewType }) {
      const view = { viewId: `vew${state.views.length + 1}`, viewName, viewType, property: { hiddenFields: [], filterInfo: null } };
      state.views.push(view);
      return structuredClone(view);
    },
    async updateView({ viewId, hiddenFields, filterInfo, viewName }) {
      const view = state.views.find((item) => item.viewId === viewId);
      if (viewName !== undefined) view.viewName = viewName;
      if (hiddenFields !== undefined) view.property.hiddenFields = [...hiddenFields];
      if (filterInfo !== undefined) view.property.filterInfo = structuredClone(filterInfo);
      return structuredClone(view);
    },
  };
}
