import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifiedFieldMutationClient } from '../../scripts/lib/lark-verified-field-mutation-client.js';

test('update writes once and waits through stale metadata/records while preserving values and Select option IDs', async () => {
  const state = {
    current: [{
      fieldId: 'fldLegacy',
      fieldName: 'display_name',
      type: 3,
      uiType: 'SingleSelect',
      isPrimary: false,
      property: {
        options: [
          { id: 'opt1', name: 'Views', color: 0 },
          { id: 'opt2', name: 'Reach', color: 1 },
        ],
      },
    }],
    records: [
      { recordId: 'rec1', fields: { display_name: 'Views' } },
      { recordId: 'rec2', fields: { display_name: { name: 'Reach' } } },
      { recordId: 'rec3', fields: {} },
    ],
    staleFieldReads: 0,
    staleRecordReads: 0,
    writes: 0,
  };
  const beforeValues = structuredClone(state.records.map((record) => record.fields.display_name ?? null));
  const client = createVerifiedFieldMutationClient(fakeClient(state), {
    delaysMs: [0, 1, 2],
    sleepImpl: async () => undefined,
  });

  await client.updateField({
    tableId: 'tblMetric',
    fieldId: 'fldLegacy',
    field: {
      fieldName: '__mkt_legacy_display_name_single_select_v1',
      type: 3,
      uiType: 'SingleSelect',
      property: structuredClone(state.current[0].property),
    },
  });

  assert.equal(state.writes, 1);
  assert.equal(state.current[0].fieldId, 'fldLegacy');
  assert.equal(state.current[0].fieldName, '__mkt_legacy_display_name_single_select_v1');
  assert.deepEqual(state.current[0].property.options.map((option) => option.id), ['opt1', 'opt2']);
  assert.deepEqual(
    state.records.map((record) => record.fields.__mkt_legacy_display_name_single_select_v1 ?? null),
    beforeValues,
  );
  assert.ok(state.staleFieldReads >= 2);
  assert.ok(state.staleRecordReads >= 2);
});

test('create writes once and never creates a duplicate while metadata is stale', async () => {
  const state = {
    current: [{
      fieldId: 'fldKey', fieldName: 'report_metric_key', type: 1,
      uiType: 'Text', isPrimary: true, property: null,
    }],
    records: [{ recordId: 'rec1', fields: { report_metric_key: 'one' } }],
    staleFieldReads: 0,
    staleRecordReads: 0,
    writes: 0,
  };
  const client = createVerifiedFieldMutationClient(fakeClient(state), {
    delaysMs: [0, 1, 2],
    sleepImpl: async () => undefined,
  });

  const result = await client.createField({
    tableId: 'tblMetric',
    field: { fieldName: 'window_days', type: 2, uiType: 'Number', property: { formatter: '0' } },
  });

  assert.equal(result.fieldId, 'fldCreated1');
  assert.equal(state.writes, 1);
  assert.equal(state.current.filter((field) => field.fieldName === 'window_days').length, 1);
  assert.ok(state.staleFieldReads >= 2);
});

test('field update fails closed when the original Select property changes', async () => {
  const state = {
    current: [{
      fieldId: 'fldLegacy',
      fieldName: 'display_name',
      type: 3,
      uiType: 'SingleSelect',
      isPrimary: false,
      property: { options: [{ id: 'opt1', name: 'Views', color: 0 }] },
    }],
    records: [{ recordId: 'rec1', fields: { display_name: 'Views' } }],
    staleFieldReads: 0,
    staleRecordReads: 0,
    writes: 0,
    mutatePropertyAfterWrite: true,
  };
  const client = createVerifiedFieldMutationClient(fakeClient(state), {
    delaysMs: [0, 1],
    sleepImpl: async () => undefined,
  });

  await assert.rejects(
    client.updateField({
      tableId: 'tblMetric',
      fieldId: 'fldLegacy',
      field: {
        fieldName: '__mkt_legacy_display_name_single_select_v1',
        type: 3,
        uiType: 'SingleSelect',
        property: structuredClone(state.current[0].property),
      },
    }),
    (error) => error.code === 'LARK_FIELD_MUTATION_UPDATE_VERIFY_FAILED',
  );
  assert.equal(state.writes, 1);
});

test('field rename fails closed when record values do not preserve parity', async () => {
  const state = {
    current: [{
      fieldId: 'fldLegacy',
      fieldName: 'display_name',
      type: 3,
      uiType: 'SingleSelect',
      isPrimary: false,
      property: { options: [{ id: 'opt1', name: 'Views', color: 0 }] },
    }],
    records: [{ recordId: 'rec1', fields: { display_name: 'Views' } }],
    staleFieldReads: 0,
    staleRecordReads: 0,
    writes: 0,
    mutateRecordAfterRename: true,
  };
  const client = createVerifiedFieldMutationClient(fakeClient(state), {
    delaysMs: [0, 1],
    sleepImpl: async () => undefined,
  });

  await assert.rejects(
    client.updateField({
      tableId: 'tblMetric',
      fieldId: 'fldLegacy',
      field: {
        fieldName: '__mkt_legacy_display_name_single_select_v1',
        type: 3,
        uiType: 'SingleSelect',
        property: structuredClone(state.current[0].property),
      },
    }),
    (error) => error.code === 'LARK_FIELD_MUTATION_RECORD_VERIFY_FAILED',
  );
  assert.equal(state.writes, 1);
});

function fakeClient(state) {
  let staleFields = null;
  let staleRecords = null;
  let staleFieldRemaining = 0;
  let staleRecordRemaining = 0;
  return {
    async listFields() {
      state.staleFieldReads += 1;
      if (staleFields && staleFieldRemaining > 0) {
        staleFieldRemaining -= 1;
        return staleFields.map((field) => structuredClone(field));
      }
      return state.current.map((field) => structuredClone(field));
    },
    async listRecords() {
      state.staleRecordReads += 1;
      if (staleRecords && staleRecordRemaining > 0) {
        staleRecordRemaining -= 1;
        return staleRecords.map((record) => structuredClone(record));
      }
      return state.records.map((record) => structuredClone(record));
    },
    async updateField({ fieldId, field }) {
      state.writes += 1;
      staleFields = state.current.map((item) => structuredClone(item));
      staleRecords = state.records.map((record) => structuredClone(record));
      const index = state.current.findIndex((item) => item.fieldId === fieldId);
      assert.notEqual(index, -1);
      const previousName = state.current[index].fieldName;
      state.current[index] = {
        ...state.current[index],
        fieldName: field.fieldName,
        type: field.type,
        uiType: field.uiType,
        property: structuredClone(field.property ?? null),
      };
      if (state.mutatePropertyAfterWrite) {
        state.current[index].property.options[0].name = 'Changed';
      }
      for (const record of state.records) {
        if (Object.hasOwn(record.fields, previousName)) {
          record.fields[field.fieldName] = record.fields[previousName];
          delete record.fields[previousName];
        }
      }
      if (state.mutateRecordAfterRename) {
        state.records[0].fields[field.fieldName] = 'Changed';
      }
      staleFieldRemaining = 1;
      staleRecordRemaining = 1;
      return structuredClone(state.current[index]);
    },
    async createField({ field }) {
      state.writes += 1;
      staleFields = state.current.map((item) => structuredClone(item));
      const created = {
        fieldId: `fldCreated${state.writes}`,
        fieldName: field.fieldName,
        type: field.type,
        uiType: field.uiType,
        isPrimary: false,
        property: structuredClone(field.property ?? null),
      };
      state.current.push(created);
      staleFieldRemaining = 1;
      return structuredClone(created);
    },
  };
}
