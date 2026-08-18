import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLarkBaseCloneCanonicalParity } from '../../packages/application/src/use-cases/verify-lark-base-clone-canonical-parity.js';

const text = (fieldId, fieldName, primary = false) => ({
  fieldId, fieldName, type: 1, uiType: 'Text', description: '', isPrimary: primary, property: null,
});
const number = (fieldId, fieldName, formatter = '0') => ({
  fieldId, fieldName, type: 2, uiType: 'Number', description: '', isPrimary: false, property: { formatter },
});
const relation = (fieldId, fieldName, tableId) => ({
  fieldId, fieldName, type: 18, uiType: 'SingleLink', description: '', isPrimary: false,
  property: { table_id: tableId, table_name: 'derived-name', multiple: true },
});
const formula = (fieldId, fieldName, expression) => ({
  fieldId, fieldName, type: 20, uiType: 'Formula', description: '', isPrimary: false,
  property: { formula_expression: expression, formatter: '0.00' },
});
const view = (viewId, viewName, property = {}, publicLevel = 'Public') => ({
  viewId,
  viewName,
  viewType: 'grid',
  publicLevel,
  property: {
    hiddenFields: property.hiddenFields ?? [],
    filterInfo: property.filterInfo ?? null,
  },
});
const record = (recordId, fields) => ({ recordId, fields, createdTime: null, lastModifiedTime: null, lastModifiedBy: null });

class ReadClient {
  constructor(tables) {
    this.tables = structuredClone(tables);
    this.calls = [];
  }

  async listTables() {
    this.calls.push('listTables');
    return this.tables.map(({ tableId, name }) => ({ tableId, name }));
  }

  table(tableId) {
    const table = this.tables.find((item) => item.tableId === tableId);
    if (!table) throw new Error(`missing fake table ${tableId}`);
    return table;
  }

  async listFields({ tableId }) {
    this.calls.push(`listFields:${tableId}`);
    return structuredClone(this.table(tableId).fields);
  }

  async listRecords({ tableId }) {
    this.calls.push(`listRecords:${tableId}`);
    return structuredClone(this.table(tableId).records);
  }

  async listViews({ tableId }) {
    this.calls.push(`listViews:${tableId}`);
    return structuredClone(this.table(tableId).views);
  }

  async getView({ tableId, viewId }) {
    this.calls.push(`getView:${tableId}:${viewId}`);
    return structuredClone(this.table(tableId).views.find((item) => item.viewId === viewId));
  }
}

function sourceFixture() {
  return new ReadClient([
    {
      tableId: 'src_accounts',
      name: 'Accounts',
      fields: [
        text('src_account_key', 'account_key', true),
        text('src_name', 'name'),
      ],
      records: [record('src_account_rec', { account_key: 'a1', name: 'One' })],
      views: [view('src_accounts_view', 'All Accounts', { hiddenFields: ['src_name'] }, 0)],
    },
    {
      tableId: 'src_campaigns',
      name: 'Campaigns',
      fields: [
        text('src_campaign_key', 'campaign_key', true),
        number('src_budget_micros', 'budget_micros', '#,##0'),
        relation('src_account_link', 'account_link', 'src_accounts'),
        formula(
          'src_budget',
          'budget',
          'bitable::$table[src_campaigns].$field[src_budget_micros]/1000000',
        ),
      ],
      records: [record('src_campaign_rec', {
        campaign_key: 'c1',
        budget_micros: 1_000_000,
        account_link: ['src_account_rec'],
        budget: 1,
      })],
      views: [view('src_campaign_view', 'All Campaigns', {
        hiddenFields: ['src_budget_micros'],
        filterInfo: {
          conjunction: 'and',
          conditions: [{ fieldId: 'src_campaign_key', fieldType: 1, operator: 'isNotEmpty', value: null }],
        },
      })],
    },
  ]);
}

function targetFixture() {
  return new ReadClient([
    {
      tableId: 'target_accounts',
      name: 'Accounts',
      fields: [
        text('target_account_key', 'account_key', true),
        text('target_name', 'name'),
      ],
      records: [record('target_account_rec', { account_key: 'a1', name: 'One' })],
      views: [view('target_accounts_view', 'All Accounts', { hiddenFields: ['target_name'] }, 'Public')],
    },
    {
      tableId: 'target_campaigns',
      name: 'Campaigns',
      fields: [
        text('target_campaign_key', 'campaign_key', true),
        number('target_budget_micros', 'budget_micros', '1,000'),
        relation('target_account_link', 'account_link', 'target_accounts'),
        formula(
          'target_budget',
          'budget',
          'bitable::$table[target_campaigns].$field[target_budget_micros]/1000000',
        ),
      ],
      records: [record('target_campaign_rec', {
        campaign_key: 'c1',
        budget_micros: 1_000_000,
        account_link: [{ record_id: 'target_account_rec' }],
        budget: 1,
      })],
      views: [view('target_campaign_view', 'All Campaigns', {
        hiddenFields: ['target_budget_micros'],
        filterInfo: {
          conjunction: 'and',
          conditions: [{ fieldId: 'target_campaign_key', fieldType: 1, operator: 'isNotEmpty', value: null }],
        },
      })],
    },
    {
      tableId: 'customer_unrelated',
      name: 'Customer Notes',
      fields: [text('customer_key', 'key', true)],
      records: [record('customer_rec', { key: 'keep' })],
      views: [view('customer_view', 'Grid')],
    },
  ]);
}

test('canonical verifier accepts deterministic table field record relation formula and basic View remaps', async () => {
  const sourceClient = sourceFixture();
  const targetClient = targetFixture();

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.summary.sourceTables, 2);
  assert.equal(result.summary.targetTablesTotal, 3);
  assert.equal(result.summary.mappedTables, 2);
  assert.equal(result.summary.mappedFields, 6);
  assert.equal(result.summary.mappedRecords, 2);
  assert.equal(result.summary.mismatches, 0);
  assert.equal(result.coverage.unrelatedTargetTablesIgnored, true);
  assert.equal(sourceClient.calls.some((call) => call.startsWith('create')), false);
  assert.equal(targetClient.calls.some((call) => call.startsWith('create')), false);
});

test('canonical verifier fails closed on full field property drift after ID remap', async () => {
  const sourceClient = sourceFixture();
  const targetClient = targetFixture();
  targetClient.tables.find((table) => table.name === 'Campaigns')
    .fields.find((field) => field.fieldName === 'budget_micros').property.formatter = '0.00';

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => item.code === 'CANONICAL_VERIFY_FIELD_CONFIG_MISMATCH'));
  assert.equal(result.remoteMutationCount, 0);
});

test('canonical verifier fails closed on relation record payload drift', async () => {
  const sourceClient = sourceFixture();
  const targetClient = targetFixture();
  targetClient.tables.find((table) => table.name === 'Campaigns')
    .records[0].fields.account_link = [];

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => (
    item.code === 'CANONICAL_VERIFY_RECORD_VALUE_MISMATCH'
      && item.message.includes('Campaigns.account_link')
  )));
});

test('canonical verifier fails closed on remapped View hidden/filter drift', async () => {
  const sourceClient = sourceFixture();
  const targetClient = targetFixture();
  const targetView = targetClient.tables.find((table) => table.name === 'Campaigns').views[0];
  targetView.property.hiddenFields = [];

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => item.code === 'CANONICAL_VERIFY_VIEW_CONFIG_MISMATCH'));
});
