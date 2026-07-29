import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifiedFieldMutationClient } from '../../scripts/lib/lark-verified-field-mutation-client.js';

test('update writes once and waits through stale metadata while preserving Select option IDs', async () => {
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
    staleReads: 0,
    writes: 0,
  };
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
  assert.ok(state.staleReads >= 2);
});

test('create writes once and never creates a duplicate while metadata is stale', async () => {
  const state = {
    current: [{
      fieldId: 'fldKey', fieldName: 'report_metric_key', type: 1,
      uiType: 'Text', isPrimary: true, property: null,
    }],
    staleReads: 0,
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
  assert.ok(state.staleReads >= 2);
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
    staleReads: 0,
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

function fakeClient(state) {
  let pending = null;
  let staleRemaining = 0;
  return {
    async listFields() {
      state.staleReads += 1;
      if (pending && staleRemaining > 0) {
        staleRemaining -= 1;
        return pending.before.map((field) => structuredClone(field));
      }
      return state.current.map((field) => structuredClone(field));
    },
    async updateField({ fieldId, field }) {
      state.writes += 1;
      const before = state.current.map((item) => structuredClone(item));
      const index = state.current.findIndex((item) => item.fieldId === fieldId);
      assert.notEqual(index, -1);
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
      pending = { before };
      staleRemaining = 1;
      return structuredClone(state.current[index]);
    },
    async createField({ field }) {
      state.writes += 1;
      const before = state.current.map((item) => structuredClone(item));
      const created = {
        fieldId: `fldCreated${state.writes}`,
        fieldName: field.fieldName,
        type: field.type,
        uiType: field.uiType,
        isPrimary: false,
        property: structuredClone(field.property ?? null),
      };
      state.current.push(created);
      pending = { before };
      staleRemaining = 1;
      return structuredClone(created);
    },
  };
}
