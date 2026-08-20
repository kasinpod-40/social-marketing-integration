import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLarkBaseCloneCanonicalParity } from '../../packages/application/src/use-cases/verify-lark-base-clone-canonical-parity.js';

function sourceClient() {
  const fields = [
    {
      fieldId: 'src_key', fieldName: 'key', type: 1, uiType: 'Text', description: '', isPrimary: true, property: null,
    },
    {
      fieldId: 'src_amount', fieldName: 'amount', type: 2, uiType: 'Number', description: '', isPrimary: false,
      property: { formatter: '0' },
    },
    {
      fieldId: 'src_double', fieldName: 'double_amount', type: 20, uiType: 'Formula', description: '', isPrimary: false,
      property: {
        formula_expression: 'bitable::$table[src_table].$field[src_amount]*2',
        formatter: '0',
      },
    },
  ];
  return {
    async listTables() { return [{ tableId: 'src_table', name: 'Metrics' }]; },
    async listFields() { return structuredClone(fields); },
    async listRecords() {
      return [{ recordId: 'src_record', fields: { key: 'r1', amount: 5, double_amount: 10 } }];
    },
    async listViews() {
      return [{ viewId: 'src_view', viewName: 'All', viewType: 'grid', publicLevel: 'Public', property: { hiddenFields: [], filterInfo: null } }];
    },
    async getView() {
      return { viewId: 'src_view', viewName: 'All', viewType: 'grid', publicLevel: 'Public', property: { hiddenFields: [], filterInfo: null } };
    },
  };
}

function targetClient({ rejectFormula = false } = {}) {
  const calls = [];
  const fields = [
    {
      fieldId: 'target_key', fieldName: 'key', type: 1, uiType: 'Text', description: '', isPrimary: true, property: null,
    },
    {
      fieldId: 'target_amount', fieldName: 'amount', type: 2, uiType: 'Number', description: '', isPrimary: false,
      property: { formatter: '0' },
    },
    {
      fieldId: 'target_double', fieldName: 'double_amount', type: 20, uiType: 'Formula', description: '', isPrimary: false,
      property: { formatter: '0' },
    },
  ];
  return {
    calls,
    async listTables() { return [{ tableId: 'target_table', name: 'Metrics' }]; },
    async listFields() { return structuredClone(fields); },
    async listRecords() {
      return [{ recordId: 'target_record', fields: { key: 'r1', amount: 5, double_amount: 10 } }];
    },
    async listViews() {
      return [{ viewId: 'target_view', viewName: 'All', viewType: 'grid', publicLevel: 'Public', property: { hiddenFields: [], filterInfo: null } }];
    },
    async getView() {
      return { viewId: 'target_view', viewName: 'All', viewType: 'grid', publicLevel: 'Public', property: { hiddenFields: [], filterInfo: null } };
    },
    async getBaseFormulaType() { return 1; },
    async verifyFormulaFieldV3Definition(input) {
      calls.push(structuredClone(input));
      assert.equal(input.tableId, 'target_table');
      assert.equal(input.fieldId, 'target_double');
      assert.equal(
        input.field.property.formula_expression,
        'bitable::$table[target_table].$field[target_amount]*2',
      );
      if (rejectFormula) {
        const error = new Error('Formula definition differs');
        error.code = 'LARK_BASE_V3_FORMULA_READBACK_MISMATCH';
        throw error;
      }
      return { ok: true };
    },
  };
}

test('standalone canonical verifier uses Base v3 GET when legacy Formula expression is omitted', async () => {
  const target = targetClient();
  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient: sourceClient(),
    targetClient: target,
    expectedTableNames: ['Metrics'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.mismatches, 0);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(target.calls.length, 1);
});

test('standalone canonical verifier fails when Base v3 Formula GET definition differs', async () => {
  const target = targetClient({ rejectFormula: true });
  await assert.rejects(
    () => verifyLarkBaseCloneCanonicalParity({
      sourceClient: sourceClient(),
      targetClient: target,
      expectedTableNames: ['Metrics'],
    }),
    (error) => error?.code === 'LARK_BASE_V3_FORMULA_READBACK_MISMATCH',
  );
});
