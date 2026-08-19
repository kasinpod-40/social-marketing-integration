import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLarkBaseResumableTarget } from '../../packages/application/src/use-cases/prepare-lark-base-resumable-target.js';

const primaryField = (fieldId = 'fld_primary') => ({
  fieldId,
  fieldName: 'campaign_key',
  type: 1,
  uiType: 'Text',
  description: '',
  isPrimary: true,
  property: null,
});

const budgetField = (formulaExpression = '{budget_micros}/1000000', fieldId = null) => ({
  ...(fieldId ? { fieldId } : {}),
  fieldName: 'budget',
  type: 20,
  uiType: 'Formula',
  description: '',
  isPrimary: false,
  property: {
    currency_code: 'THB',
    formatter: '0.00',
    ...(formulaExpression ? { formula_expression: formulaExpression } : {}),
    type: {
      data_type: 2,
      ui_type: 'Currency',
      ui_property: {
        currency_code: 'THB',
        formatter: '0.00',
      },
    },
  },
});

class FormulaTarget {
  constructor({ includeCampaigns = false, formulaExpression = null } = {}) {
    this.sequence = 0;
    this.calls = [];
    this.tables = [{
      tableId: 'tbl_protected',
      name: 'TikTok',
      fields: [primaryField('fld_protected')],
      records: [],
      views: [],
    }];
    if (includeCampaigns) {
      this.tables.push({
        tableId: 'tbl_campaigns',
        name: 'Campaigns',
        fields: [
          primaryField(),
          budgetField(formulaExpression, 'fld_budget'),
        ],
        records: [],
        views: [],
      });
    }
  }

  table(tableId) {
    const table = this.tables.find((item) => item.tableId === tableId);
    if (!table) throw new Error(`Unknown table ${tableId}`);
    return table;
  }

  async getBaseFormulaType() {
    this.calls.push({ kind: 'getBaseFormulaType' });
    return 2;
  }

  async listTables() {
    return this.tables.map(({ tableId, name }) => ({ tableId, name }));
  }

  async listFields({ tableId }) {
    return structuredClone(this.table(tableId).fields);
  }

  async listRecords({ tableId }) {
    return structuredClone(this.table(tableId).records);
  }

  async listViews({ tableId }) {
    return structuredClone(this.table(tableId).views);
  }

  async createTable({ name, fields }) {
    const tableId = 'tbl_campaigns';
    this.calls.push({ kind: 'createTable', name });
    this.tables.push({
      tableId,
      name,
      fields: [{ ...structuredClone(fields[0]), fieldId: 'fld_primary', isPrimary: true }],
      records: [],
      views: [],
    });
    return { tableId, name };
  }

  async createField({ tableId, field }) {
    this.calls.push({ kind: 'createField', tableId, field: structuredClone(field) });
    if (Number(field?.type) === 20 && field?.property?.formula_expression) {
      const error = new Error('Formula create must not include formula_expression');
      error.code = 'LARK_PERMANENT_API_ERROR';
      error.details = { status: 400, larkCode: 99992402, retryAfter: null };
      throw error;
    }
    const created = {
      ...structuredClone(field),
      fieldId: `fld_created_${++this.sequence}`,
      isPrimary: false,
    };
    this.table(tableId).fields.push(created);
    return structuredClone(created);
  }

  async updateField({ tableId, fieldId, field }) {
    this.calls.push({ kind: 'updateField', tableId, fieldId, field: structuredClone(field) });
    const table = this.table(tableId);
    const index = table.fields.findIndex((item) => item.fieldId === fieldId);
    if (index < 0) throw new Error(`Unknown field ${fieldId}`);
    table.fields[index] = {
      ...structuredClone(field),
      fieldId,
      isPrimary: table.fields[index].isPrimary === true,
    };
    return structuredClone(table.fields[index]);
  }

  async batchCreateRecords() {
    return { created: 0 };
  }
}

async function prepareFreshTarget(target) {
  const prepared = await prepareLarkBaseResumableTarget({
    targetClient: target,
    expectedTableNames: ['Campaigns'],
    protectedTables: [{ name: 'TikTok', tableId: 'tbl_protected' }],
  });
  const created = await prepared.client.createTable({
    name: 'Campaigns',
    fields: [{ fieldName: 'campaign_key', type: 1, description: '', property: null }],
  });
  return { prepared, tableId: created.tableId };
}

async function prepareResumedTarget(target) {
  const prepared = await prepareLarkBaseResumableTarget({
    targetClient: target,
    expectedTableNames: ['Campaigns'],
    protectedTables: [{ name: 'TikTok', tableId: 'tbl_protected' }],
  });
  const claimed = await prepared.client.createTable({
    name: 'Campaigns',
    fields: [{ fieldName: 'campaign_key', type: 1, description: '', property: null }],
  });
  return { prepared, tableId: claimed.tableId };
}

test('Formula create stages a shell without expression, finalizes by PUT, then exact-readbacks', async () => {
  const target = new FormulaTarget();
  const { prepared, tableId } = await prepareFreshTarget(target);

  const result = await prepared.client.createField({ tableId, field: budgetField() });

  const createCall = target.calls.find((call) => call.kind === 'createField');
  const updateCall = target.calls.find((call) => call.kind === 'updateField');
  assert.ok(createCall);
  assert.ok(updateCall);
  assert.equal('formula_expression' in createCall.field.property, false);
  assert.equal(updateCall.field.property.formula_expression, '{budget_micros}/1000000');
  assert.equal(result.property.formula_expression, '{budget_micros}/1000000');
});

test('Formula recovery finalizes an existing shell without creating a duplicate field', async () => {
  const target = new FormulaTarget({ includeCampaigns: true, formulaExpression: null });
  const { prepared, tableId } = await prepareResumedTarget(target);
  target.calls.length = 0;

  const result = await prepared.client.createField({ tableId, field: budgetField() });

  assert.equal(target.calls.some((call) => call.kind === 'createField'), false);
  assert.equal(target.calls.filter((call) => call.kind === 'updateField').length, 1);
  assert.equal(result.fieldId, 'fld_budget');
  assert.equal(result.property.formula_expression, '{budget_micros}/1000000');
});

test('Formula recovery refuses to overwrite a different non-empty expression', async () => {
  const target = new FormulaTarget({ includeCampaigns: true, formulaExpression: '{budget_micros}/1000' });
  const { prepared, tableId } = await prepareResumedTarget(target);
  target.calls.length = 0;

  await assert.rejects(
    () => prepared.client.createField({ tableId, field: budgetField() }),
    (error) => (
      error?.code === 'CUSTOMER_BASE_RESUME_FIELD_CONFLICT'
      && error?.details?.differencePaths?.includes('$.property.formula_expression')
    ),
  );

  assert.equal(target.calls.some((call) => call.kind === 'createField'), false);
  assert.equal(target.calls.some((call) => call.kind === 'updateField'), false);
});
