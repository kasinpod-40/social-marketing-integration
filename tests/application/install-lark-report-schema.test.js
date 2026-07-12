import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLarkReportSchema,
  isPlaceholderTableId,
  planLarkReportSchema,
} from '../../packages/application/src/use-cases/install-lark-report-schema.js';

const SIMPLE_SCHEMA = Object.freeze([
  Object.freeze({
    key: 'example',
    logicalName: 'MKT_Example',
    createName: '🧪 MKT_Example',
    aliases: Object.freeze(['MKT_Example', '🧪 MKT_Example']),
    envName: 'LARK_TABLE_MKT_EXAMPLE',
    defaultViewName: 'All',
    fields: Object.freeze([
      Object.freeze({ fieldName: 'example_key', type: 1, uiType: 'Text', primary: true, description: '' }),
      Object.freeze({
        fieldName: 'status', type: 3, uiType: 'SingleSelect', primary: false, description: '',
        property: Object.freeze({
          options: Object.freeze([
            Object.freeze({ name: 'active', color: 0 }),
            Object.freeze({ name: 'disabled', color: 1 }),
          ]),
        }),
      }),
    ]),
  }),
]);

test('preview is read-only and plans a missing table with all fields', async () => {
  let writes = 0;
  const client = fakeClient({
    tables: [],
    onWrite: () => { writes += 1; },
  });
  const result = await planLarkReportSchema({ client, env: {}, schema: SIMPLE_SCHEMA });
  assert.equal(result.readyToApply, true);
  assert.equal(result.summary.createTables, 1);
  assert.equal(result.actions[0].kind, 'create_table');
  assert.equal(result.actions[0].fields.length, 2);
  assert.equal(writes, 0);
});

test('uses a configured non-placeholder table ID before matching aliases', async () => {
  const client = fakeClient({
    tables: [
      { tableId: 'tblConfigured', name: 'Different Display Name' },
      { tableId: 'tblAlias', name: '🧪 MKT_Example' },
    ],
    fieldsByTable: {
      tblConfigured: completeFields(),
      tblAlias: completeFields(),
    },
  });
  const result = await planLarkReportSchema({
    client,
    env: { LARK_TABLE_MKT_EXAMPLE: 'tblConfigured' },
    schema: SIMPLE_SCHEMA,
  });
  assert.equal(result.resolvedTables[0].tableId, 'tblConfigured');
  assert.equal(result.resolvedTables[0].source, 'environment_id');
});

test('fails closed when a configured table ID and all aliases are missing', async () => {
  const client = fakeClient({ tables: [] });
  const result = await planLarkReportSchema({
    client,
    env: { LARK_TABLE_MKT_EXAMPLE: 'tblMissingConfigured' },
    schema: SIMPLE_SCHEMA,
  });
  assert.equal(result.readyToApply, false);
  assert.equal(result.conflicts[0].code, 'CONFIGURED_TABLE_ID_NOT_FOUND');
  assert.equal(result.actions.length, 0);
});

test('ignores placeholder IDs and resolves an existing emoji table by canonical name', async () => {
  const client = fakeClient({
    tables: [{ tableId: 'tblExisting', name: '🧪 MKT_Example' }],
    fieldsByTable: { tblExisting: completeFields() },
  });
  const result = await planLarkReportSchema({
    client,
    env: { LARK_TABLE_MKT_EXAMPLE: 'replace-after-creating-table' },
    schema: SIMPLE_SCHEMA,
  });
  assert.equal(result.resolvedTables[0].tableId, 'tblExisting');
  assert.equal(result.actions.length, 0);
  assert.equal(result.environmentUpdates.LARK_TABLE_MKT_EXAMPLE, 'tblExisting');
});

test('plans missing fields and appends select options without deleting existing option IDs', async () => {
  const client = fakeClient({
    tables: [{ tableId: 'tblExisting', name: 'MKT_Example' }],
    fieldsByTable: {
      tblExisting: [
        { fieldId: 'fldKey', fieldName: 'example_key', type: 1, isPrimary: true, property: null },
        {
          fieldId: 'fldStatus', fieldName: 'status', type: 3, isPrimary: false,
          property: { optionsType: 0, options: [{ id: 'opt1', name: 'active', color: 9 }] },
        },
      ],
    },
  });
  const result = await planLarkReportSchema({ client, env: {}, schema: SIMPLE_SCHEMA });
  assert.equal(result.summary.updateFields, 1);
  const [action] = result.actions;
  assert.equal(action.kind, 'update_field');
  assert.deepEqual(action.field.property.options, [
    { id: 'opt1', name: 'active', color: 9 },
    { name: 'disabled', color: 1 },
  ]);
});

test('fails closed on field type conflicts instead of converting existing data', async () => {
  const client = fakeClient({
    tables: [{ tableId: 'tblExisting', name: 'MKT_Example' }],
    fieldsByTable: {
      tblExisting: [
        { fieldId: 'fldKey', fieldName: 'example_key', type: 2, isPrimary: true, property: null },
      ],
    },
  });
  const result = await planLarkReportSchema({ client, env: {}, schema: SIMPLE_SCHEMA });
  assert.equal(result.readyToApply, false);
  assert.equal(result.conflicts[0].code, 'FIELD_TYPE_MISMATCH');
  await assert.rejects(
    applyLarkReportSchema({ client, env: {}, schema: SIMPLE_SCHEMA }),
    (error) => error.code === 'LARK_REPORT_SCHEMA_CONFLICT',
  );
});

test('apply creates a table once and verification returns no remaining write actions', async () => {
  const state = { tables: [], fieldsByTable: {} };
  const client = statefulClient(state);
  const first = await applyLarkReportSchema({ client, env: {}, schema: SIMPLE_SCHEMA });
  assert.equal(first.ok, true);
  assert.equal(first.summary.createdTables, 1);
  assert.equal(first.verification.actions.length, 0);
  assert.equal(first.environmentUpdates.LARK_TABLE_MKT_EXAMPLE, 'tbl1');

  const secondPreview = await planLarkReportSchema({ client, env: {}, schema: SIMPLE_SCHEMA });
  assert.equal(secondPreview.actions.length, 0);
});


test('does not plan Checkbox property updates from UI-only style metadata', async () => {
  const schema = Object.freeze([
    Object.freeze({
      key: 'checkboxExample',
      logicalName: 'MKT_Checkbox_Example',
      createName: 'MKT_Checkbox_Example',
      aliases: Object.freeze(['MKT_Checkbox_Example']),
      envName: 'LARK_TABLE_MKT_CHECKBOX_EXAMPLE',
      defaultViewName: 'All',
      fields: Object.freeze([
        Object.freeze({ fieldName: 'key', type: 1, uiType: 'Text', primary: true, description: '' }),
        Object.freeze({ fieldName: 'enabled', type: 7, uiType: 'Checkbox', primary: false, description: '' }),
      ]),
    }),
  ]);
  const client = fakeClient({
    tables: [{ tableId: 'tblCheck', name: 'MKT_Checkbox_Example' }],
    fieldsByTable: {
      tblCheck: [
        { fieldId: 'fldKey', fieldName: 'key', type: 1, isPrimary: true, property: null },
        { fieldId: 'fldEnabled', fieldName: 'enabled', type: 7, isPrimary: false, property: { styleId: '0' } },
      ],
    },
  });
  const result = await planLarkReportSchema({ client, env: {}, schema });
  assert.equal(result.readyToApply, true);
  assert.equal(result.actions.length, 0);
});

test('adds failed schema action context while preserving the Lark error code', async () => {
  const client = fakeClient({
    tables: [{ tableId: 'tblExisting', name: 'MKT_Example' }],
    fieldsByTable: {
      tblExisting: [
        { fieldId: 'fldKey', fieldName: 'example_key', type: 1, isPrimary: true, property: null },
        {
          fieldId: 'fldStatus', fieldName: 'status', type: 3, isPrimary: false,
          property: { optionsType: 0, options: [{ id: 'opt1', name: 'active', color: 9 }] },
        },
      ],
    },
    updateError: Object.assign(new Error('Lark HTTP 400: SelectFieldPropertyError'), {
      code: 'LARK_PERMANENT_API_ERROR',
      retryable: false,
      details: { status: 400, larkCode: 1254083 },
    }),
  });
  await assert.rejects(
    applyLarkReportSchema({ client, env: {}, schema: SIMPLE_SCHEMA }),
    (error) => error.code === 'LARK_PERMANENT_API_ERROR'
      && error.details.schemaAction.kind === 'update_field'
      && error.details.schemaAction.fieldName === 'status'
      && error.details.appliedActionCount === 0,
  );
});

test('recognizes local config placeholders', () => {
  assert.equal(isPlaceholderTableId('replace-after-creating-table'), true);
  assert.equal(isPlaceholderTableId('your-table-id'), true);
  assert.equal(isPlaceholderTableId('tblReal123'), false);
});

function completeFields() {
  return [
    { fieldId: 'fldKey', fieldName: 'example_key', type: 1, isPrimary: true, property: null },
    {
      fieldId: 'fldStatus', fieldName: 'status', type: 3, isPrimary: false,
      property: {
        optionsType: 0,
        options: [
          { id: 'opt1', name: 'active', color: 0 },
          { id: 'opt2', name: 'disabled', color: 1 },
        ],
      },
    },
  ];
}

function fakeClient(input) {
  return {
    async listTables() { return input.tables ?? []; },
    async listFields({ tableId }) { return input.fieldsByTable?.[tableId] ?? []; },
    async createTable() { input.onWrite?.(); return { tableId: 'tblNew', name: 'new' }; },
    async createField() { input.onWrite?.(); return { fieldId: 'fldNew' }; },
    async updateField() { input.onWrite?.(); if (input.updateError) throw input.updateError; return { fieldId: 'fldUpdated' }; },
  };
}

function statefulClient(state) {
  return {
    async listTables() { return state.tables.map((table) => ({ ...table })); },
    async listFields({ tableId }) { return (state.fieldsByTable[tableId] ?? []).map((field) => structuredClone(field)); },
    async createTable({ name, fields }) {
      const tableId = `tbl${state.tables.length + 1}`;
      state.tables.push({ tableId, name });
      state.fieldsByTable[tableId] = fields.map((field, index) => ({
        fieldId: `fld${index + 1}`,
        fieldName: field.fieldName,
        type: field.type,
        uiType: field.uiType,
        isPrimary: index === 0,
        property: structuredClone(field.property ?? null),
      }));
      return { tableId, name };
    },
    async createField({ tableId, field }) {
      const fields = state.fieldsByTable[tableId];
      const created = {
        fieldId: `fld${fields.length + 1}`,
        fieldName: field.fieldName,
        type: field.type,
        isPrimary: false,
        property: structuredClone(field.property ?? null),
      };
      fields.push(created);
      return created;
    },
    async updateField({ tableId, fieldId, field }) {
      const fields = state.fieldsByTable[tableId];
      const index = fields.findIndex((candidate) => candidate.fieldId === fieldId);
      fields[index] = { ...fields[index], fieldName: field.fieldName, type: field.type, property: structuredClone(field.property ?? null) };
      return fields[index];
    },
  };
}
