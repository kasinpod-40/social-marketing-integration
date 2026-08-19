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

const budgetField = (formulaExpression = 'bitable::$table[tbl_campaigns].$field[fld_budget_micros]/1000000', fieldId = null) => ({
  ...(fieldId ? { fieldId } : {}),
  fieldName: 'budget',
  type: 20,
  uiType: 'Formula',
  description: '',
  isPrimary: false,
  property: {
    formula_expression: formulaExpression,
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

class FormulaV3Target {
  constructor({ includeCampaigns = false, includeShell = false, rejectV3Create = false } = {}) {
    this.calls = [];
    this.rejectV3Create = rejectV3Create;
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
          {
            fieldId: 'fld_budget_micros',
            fieldName: 'budget_micros',
            type: 2,
            uiType: 'Number',
            description: '',
            isPrimary: false,
            property: { formatter: '0' },
          },
          ...(includeShell ? [{
            ...budgetField(null, 'fld_budget'),
            property: {
              type: {
                data_type: 2,
                ui_type: 'Currency',
                ui_property: { currency_code: 'THB', formatter: '0.00' },
              },
            },
          }] : []),
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
    this.calls.push({ kind: 'createTable', name });
    this.tables.push({
      tableId: 'tbl_campaigns',
      name,
      fields: [
        { ...structuredClone(fields[0]), fieldId: 'fld_primary', isPrimary: true },
        {
          fieldId: 'fld_budget_micros',
          fieldName: 'budget_micros',
          type: 2,
          uiType: 'Number',
          description: '',
          isPrimary: false,
          property: { formatter: '0' },
        },
      ],
      records: [],
      views: [],
    });
    return { tableId: 'tbl_campaigns', name };
  }

  async createField({ tableId, field }) {
    this.calls.push({ kind: 'createField', tableId, field: structuredClone(field) });
    if (Number(field?.type) === 20) throw new Error('legacy Formula create must not run when v3 capability exists');
    const created = { ...structuredClone(field), fieldId: `fld_${this.calls.length}`, isPrimary: false };
    this.table(tableId).fields.push(created);
    return structuredClone(created);
  }

  async updateField({ tableId, fieldId, field }) {
    this.calls.push({ kind: 'updateField', tableId, fieldId, field: structuredClone(field) });
    if (Number(field?.type) === 20) throw new Error('legacy Formula update must not run when v3 capability exists');
    return structuredClone(field);
  }

  async createFormulaFieldV3({ tableId, field }) {
    this.calls.push({ kind: 'createFormulaFieldV3', tableId, field: structuredClone(field) });
    if (this.rejectV3Create) {
      const error = new Error('Base v3 Formula create rejected');
      error.code = 'LARK_PERMANENT_API_ERROR';
      error.details = { status: 400, larkCode: 99992402, retryAfter: null };
      throw error;
    }
    const created = { ...structuredClone(field), fieldId: 'fld_budget', isPrimary: false };
    this.table(tableId).fields.push(created);
    return structuredClone(created);
  }

  async updateFormulaFieldV3({ tableId, fieldId, field }) {
    this.calls.push({ kind: 'updateFormulaFieldV3', tableId, fieldId, field: structuredClone(field) });
    const table = this.table(tableId);
    const index = table.fields.findIndex((item) => item.fieldId === fieldId);
    table.fields[index] = { ...structuredClone(field), fieldId, isPrimary: false };
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

test('resumable adapter uses Base v3 Formula create capability and never sends Formula to legacy create/update', async () => {
  const target = new FormulaV3Target();
  const { prepared, tableId } = await prepareFreshTarget(target);
  target.calls.length = 0;

  const result = await prepared.client.createField({ tableId, field: budgetField() });

  assert.equal(result.fieldId, 'fld_budget');
  assert.equal(target.calls.filter((call) => call.kind === 'createFormulaFieldV3').length, 1);
  assert.equal(target.calls.some((call) => call.kind === 'createField'), false);
  assert.equal(target.calls.some((call) => call.kind === 'updateField'), false);
  assert.equal(target.calls.some((call) => call.kind === 'updateFormulaFieldV3'), false);
});

test('resumable adapter finalizes a historical Formula shell through Base v3 update capability', async () => {
  const target = new FormulaV3Target({ includeCampaigns: true, includeShell: true });
  const { prepared, tableId } = await prepareResumedTarget(target);
  target.calls.length = 0;

  const result = await prepared.client.createField({ tableId, field: budgetField() });

  assert.equal(result.fieldId, 'fld_budget');
  assert.equal(target.calls.some((call) => call.kind === 'createFormulaFieldV3'), false);
  assert.equal(target.calls.filter((call) => call.kind === 'updateFormulaFieldV3').length, 1);
  assert.equal(target.calls.some((call) => call.kind === 'updateField'), false);
});

test('resumable adapter exposes safe Base v3 Formula rejection diagnostics without falling back to legacy create', async () => {
  const target = new FormulaV3Target({ rejectV3Create: true });
  const { prepared, tableId } = await prepareFreshTarget(target);
  target.calls.length = 0;

  await assert.rejects(
    () => prepared.client.createField({ tableId, field: budgetField() }),
    (error) => {
      assert.equal(error?.code, 'CUSTOMER_BASE_RESUME_FORMULA_V3_CREATE_REMOTE_REJECTED');
      assert.equal(error?.details?.operation, 'createFormulaFieldV3');
      assert.equal(error?.details?.tableId, tableId);
      assert.equal(error?.details?.fieldName, 'budget');
      assert.equal(error?.details?.larkCode, 99992402);
      assert.deepEqual(error?.details?.propertyKeys, ['formula_expression', 'type']);
      return true;
    },
  );

  assert.equal(target.calls.some((call) => call.kind === 'createField'), false);
  assert.equal(target.calls.some((call) => call.kind === 'updateField'), false);
});
