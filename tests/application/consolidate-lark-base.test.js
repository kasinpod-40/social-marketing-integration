import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLarkBaseConsolidation,
  previewLarkBaseConsolidation,
  verifyLarkBaseConsolidation,
} from '../../packages/application/src/use-cases/consolidate-lark-base.js';

const text = (fieldId, fieldName, primary = false) => ({
  fieldId, fieldName, type: 1, uiType: 'Text', description: '', isPrimary: primary, property: null,
});
const number = (fieldId, fieldName) => ({
  fieldId, fieldName, type: 2, uiType: 'Number', description: '', isPrimary: false, property: { formatter: '0' },
});
const relation = (fieldId, fieldName, tableId, multiple = false) => ({
  fieldId, fieldName, type: 18, uiType: 'SingleLink', description: '', isPrimary: false,
  property: { table_id: tableId, multiple },
});
const formula = (fieldId, fieldName, expression) => ({
  fieldId, fieldName, type: 20, uiType: 'Formula', description: '', isPrimary: false,
  property: { formula_expression: expression, formatter: '0.00' },
});
const grid = (viewId, viewName, property = {}) => ({
  viewId, viewName, viewType: 'grid', publicLevel: null,
  property: { hiddenFields: property.hiddenFields ?? [], filterInfo: property.filterInfo ?? null },
});
const record = (recordId, fields) => ({ recordId, fields, createdTime: null, lastModifiedTime: null, lastModifiedBy: null });

class FakeLarkClient {
  constructor(tables = []) {
    this.tables = structuredClone(tables);
    this.sequence = 0;
    this.calls = [];
  }

  async listTables() {
    return this.tables.map(({ tableId, name }) => ({ tableId, name, revision: 1 }));
  }

  table(tableId) {
    const table = this.tables.find((item) => item.tableId === tableId);
    if (!table) throw new Error(`Unknown fake table ${tableId}`);
    return table;
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

  async getView({ tableId, viewId }) {
    return structuredClone(this.table(tableId).views.find((view) => view.viewId === viewId));
  }

  async createTable({ name, defaultViewName, fields }) {
    this.calls.push({ kind: 'createTable', name });
    const tableId = `target_tbl_${++this.sequence}`;
    const table = {
      tableId,
      name,
      fields: fields.map((field, index) => ({
        fieldId: `target_fld_${this.sequence}_${index + 1}`,
        fieldName: field.fieldName,
        type: field.type,
        uiType: field.uiType ?? null,
        description: field.description ?? '',
        isPrimary: index === 0,
        property: structuredClone(field.property ?? null),
      })),
      records: [],
      views: [grid(`target_view_${this.sequence}_1`, defaultViewName ?? 'Grid')],
    };
    this.tables.push(table);
    return { tableId, name, revision: 1 };
  }

  async createField({ tableId, field }) {
    this.calls.push({ kind: 'createField', tableId, fieldName: field.fieldName });
    const table = this.table(tableId);
    const created = {
      fieldId: `target_fld_${++this.sequence}`,
      fieldName: field.fieldName,
      type: field.type,
      uiType: field.uiType ?? null,
      description: field.description ?? '',
      isPrimary: false,
      property: structuredClone(field.property ?? null),
    };
    table.fields.push(created);
    return structuredClone(created);
  }

  async batchCreateRecords({ tableId, records }) {
    this.calls.push({ kind: 'batchCreateRecords', tableId, rows: records.length });
    const table = this.table(tableId);
    for (const fields of records) {
      table.records.push(record(`target_rec_${++this.sequence}`, structuredClone(fields)));
    }
    return { created: records.length };
  }

  async batchUpdateRecords({ tableId, records }) {
    this.calls.push({ kind: 'batchUpdateRecords', tableId, rows: records.length });
    const table = this.table(tableId);
    for (const update of records) {
      const target = table.records.find((item) => item.recordId === update.recordId);
      Object.assign(target.fields, structuredClone(update.fields));
    }
    return { updated: records.length };
  }

  async createView({ tableId, viewName, viewType }) {
    this.calls.push({ kind: 'createView', tableId, viewName });
    const table = this.table(tableId);
    const created = grid(`target_view_${++this.sequence}`, viewName);
    created.viewType = viewType;
    table.views.push(created);
    return structuredClone(created);
  }

  async updateView({ tableId, viewId, hiddenFields, filterInfo }) {
    this.calls.push({ kind: 'updateView', tableId, viewId });
    const view = this.table(tableId).views.find((item) => item.viewId === viewId);
    if (hiddenFields !== undefined) view.property.hiddenFields = structuredClone(hiddenFields);
    if (filterInfo !== undefined) view.property.filterInfo = structuredClone(filterInfo);
    return structuredClone(view);
  }
}

function simpleSource() {
  return new FakeLarkClient([{
    tableId: 'src_accounts',
    name: 'Accounts',
    fields: [text('src_account_key', 'account_key', true), text('src_name', 'name')],
    records: [record('src_rec_1', { account_key: 'a1', name: 'One' })],
    views: [grid('src_view_1', 'All Records')],
  }]);
}

function linkedSource() {
  return new FakeLarkClient([
    {
      tableId: 'src_accounts',
      name: 'Accounts',
      fields: [text('src_account_key', 'account_key', true), text('src_name', 'name')],
      records: [record('src_account_rec', { account_key: 'a1', name: 'One' })],
      views: [grid('src_account_view', 'All Records')],
    },
    {
      tableId: 'src_campaigns',
      name: 'Campaigns',
      fields: [
        text('src_campaign_key', 'campaign_key', true),
        number('src_budget_micros', 'budget_micros'),
        relation('src_account_link', 'account_link', 'src_accounts'),
        formula(
          'src_budget',
          'budget',
          'IF(ISBLANK(bitable::$table[src_campaigns].$field[src_budget_micros]), "", bitable::$table[src_campaigns].$field[src_budget_micros]/1000000)',
        ),
      ],
      records: [record('src_campaign_rec', {
        campaign_key: 'c1',
        budget_micros: 1_000_000,
        account_link: ['src_account_rec'],
        budget: 1,
      })],
      views: [
        grid('src_campaign_view', 'All Records', {
          hiddenFields: ['src_budget_micros'],
          filterInfo: {
            conjunction: 'and',
            conditions: [{
              fieldId: 'src_campaign_key', fieldType: 1, operator: 'isNotEmpty', value: null,
            }],
          },
        }),
        grid('src_campaign_view_2', 'Campaign Active'),
      ],
    },
  ]);
}

test('preview plans missing source tables without remote mutation', async () => {
  const sourceClient = simpleSource();
  const targetClient = new FakeLarkClient();

  const result = await previewLarkBaseConsolidation({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.readyToApply, true);
  assert.equal(result.summary.sourceTables, 1);
  assert.equal(result.summary.createTables, 1);
  assert.equal(result.summary.sourceRecords, 1);
  assert.equal(targetClient.calls.length, 0);
});

test('apply clones ordinary fields, records, relation IDs, formula IDs and view properties', async () => {
  const sourceClient = linkedSource();
  const targetClient = new FakeLarkClient();

  const result = await applyLarkBaseConsolidation({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.verification.ok, true);
  assert.equal(result.applied.createdTables, 2);
  assert.equal(result.applied.createdRecords, 2);
  assert.equal(result.applied.updatedRelationRecords, 1);

  const accounts = targetClient.tables.find((table) => table.name === 'Accounts');
  const campaigns = targetClient.tables.find((table) => table.name === 'Campaigns');
  const targetAccountRecord = accounts.records[0];
  const targetCampaignRecord = campaigns.records[0];
  const relationField = campaigns.fields.find((field) => field.fieldName === 'account_link');
  const formulaField = campaigns.fields.find((field) => field.fieldName === 'budget');
  const budgetMicros = campaigns.fields.find((field) => field.fieldName === 'budget_micros');

  assert.equal(relationField.property.table_id, accounts.tableId);
  assert.deepEqual(targetCampaignRecord.fields.account_link, [targetAccountRecord.recordId]);
  assert.match(formulaField.property.formula_expression, new RegExp(`\\$table\\[${campaigns.tableId}\\]`));
  assert.match(formulaField.property.formula_expression, new RegExp(`\\$field\\[${budgetMicros.fieldId}\\]`));
  assert.equal(formulaField.property.formula_expression.includes('src_campaigns'), false);
  assert.equal(formulaField.property.formula_expression.includes('src_budget_micros'), false);

  const allRecords = campaigns.views.find((view) => view.viewName === 'All Records');
  const targetPrimary = campaigns.fields.find((field) => field.fieldName === 'campaign_key');
  assert.deepEqual(allRecords.property.hiddenFields, [budgetMicros.fieldId]);
  assert.equal(allRecords.property.filterInfo.conditions[0].fieldId, targetPrimary.fieldId);
});

test('preview fails closed when a target table with the same name is not an exact simple copy', async () => {
  const sourceClient = simpleSource();
  const targetClient = new FakeLarkClient([{
    tableId: 'target_accounts',
    name: 'Accounts',
    fields: [text('target_account_key', 'account_key', true), text('target_name', 'name')],
    records: [record('target_rec', { account_key: 'a1', name: 'DIFFERENT' })],
    views: [grid('target_view', 'All Records')],
  }]);

  const result = await previewLarkBaseConsolidation({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.readyToApply, false);
  assert.equal(result.conflicts.some((entry) => entry.code === 'TARGET_TABLE_CONFLICT'), true);
});

test('preview reuses an exact existing simple table and verify remains read-only', async () => {
  const sourceClient = simpleSource();
  const targetClient = new FakeLarkClient([{
    tableId: 'target_accounts',
    name: 'Accounts',
    fields: [text('target_account_key', 'account_key', true), text('target_name', 'name')],
    records: [record('target_rec', { account_key: 'a1', name: 'One' })],
    views: [grid('target_view', 'All Records')],
  }]);

  const preview = await previewLarkBaseConsolidation({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts'],
  });
  const verification = await verifyLarkBaseConsolidation({ sourceClient, targetClient });

  assert.equal(preview.ok, true);
  assert.equal(preview.summary.createTables, 0);
  assert.equal(preview.summary.reuseExactTables, 1);
  assert.equal(verification.ok, true);
  assert.equal(targetClient.calls.length, 0);
});
