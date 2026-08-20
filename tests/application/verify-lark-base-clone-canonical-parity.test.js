import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLarkBaseCloneCanonicalParity } from '../../packages/application/src/use-cases/verify-lark-base-clone-canonical-parity.js';

const text = (fieldId, fieldName, primary = false) => ({
  fieldId, fieldName, type: 1, uiType: 'Text', description: '', isPrimary: primary, property: null,
});
const number = (fieldId, fieldName, formatter = '0') => ({
  fieldId, fieldName, type: 2, uiType: 'Number', description: '', isPrimary: false, property: { formatter },
});
const select = (fieldId, fieldName, options) => ({
  fieldId, fieldName, type: 3, uiType: 'SingleSelect', description: '', isPrimary: false,
  property: { options: options.map((name, index) => ({ id: `${fieldId}_opt_${index}`, name, color: index })) },
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
  constructor(tables, formulaType = 1) {
    this.tables = structuredClone(tables);
    this.formulaType = formulaType;
    this.calls = [];
  }

  async listTables() {
    this.calls.push('listTables');
    return this.tables.map(({ tableId, name }) => ({ tableId, name }));
  }

  async getBaseFormulaType() {
    this.calls.push('getBaseFormulaType');
    return this.formulaType;
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

function targetFixture(formulaType = 1) {
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
  ], formulaType);
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
  assert.equal(result.summary.manualFormulaPresentationMismatches, 0);
  assert.equal(result.manualParity.formulaPresentation.required, false);
  assert.equal(result.coverage.unrelatedTargetTablesIgnored, true);
  assert.equal(sourceClient.calls.some((call) => call.startsWith('create')), false);
  assert.equal(targetClient.calls.some((call) => call.startsWith('create')), false);
  assert.equal(targetClient.calls.filter((call) => call === 'getBaseFormulaType').length, 1);
});

test('canonical verifier accepts semantic SingleSelect any-of across source multi-value and target expanded OR conditions', async () => {
  const sourceClient = sourceFixture();
  const targetClient = targetFixture();
  const sourceAccounts = sourceClient.tables.find((table) => table.name === 'Accounts');
  const targetAccounts = targetClient.tables.find((table) => table.name === 'Accounts');
  sourceAccounts.fields.push(select('src_connection', 'connection_status', ['connected', 'warning']));
  targetAccounts.fields.push(select('target_connection', 'connection_status', ['connected', 'warning']));
  sourceAccounts.records[0].fields.connection_status = 'connected';
  targetAccounts.records[0].fields.connection_status = 'connected';
  sourceAccounts.views[0].property.filterInfo = {
    conjunction: 'or',
    conditions: [{
      fieldId: 'src_connection', fieldType: 3, operator: 'is', value: ['connected', 'warning'],
    }],
  };
  targetAccounts.views[0].property.filterInfo = {
    conjunction: 'or',
    conditions: [
      { fieldId: 'target_connection', fieldType: 3, operator: 'is', value: ['warning'] },
      { fieldId: 'target_connection', fieldType: 3, operator: 'is', value: ['connected'] },
    ],
  };

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.mismatches, 0);
});

test('canonical verifier rejects collapsed SingleSelect any-of when one required value is missing', async () => {
  const sourceClient = sourceFixture();
  const targetClient = targetFixture();
  const sourceAccounts = sourceClient.tables.find((table) => table.name === 'Accounts');
  const targetAccounts = targetClient.tables.find((table) => table.name === 'Accounts');
  sourceAccounts.fields.push(select('src_connection', 'connection_status', ['connected', 'warning']));
  targetAccounts.fields.push(select('target_connection', 'connection_status', ['connected', 'warning']));
  sourceAccounts.records[0].fields.connection_status = 'connected';
  targetAccounts.records[0].fields.connection_status = 'connected';
  sourceAccounts.views[0].property.filterInfo = {
    conjunction: 'or',
    conditions: [{
      fieldId: 'src_connection', fieldType: 3, operator: 'is', value: ['connected', 'warning'],
    }],
  };
  targetAccounts.views[0].property.filterInfo = {
    conjunction: 'and',
    conditions: [
      { fieldId: 'target_connection', fieldType: 3, operator: 'is', value: ['connected'] },
    ],
  };

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => item.code === 'CANONICAL_VERIFY_VIEW_CONFIG_MISMATCH'));
});

test('canonical verifier keeps conjunction strict for multiple unrelated View conditions', async () => {
  const sourceClient = sourceFixture();
  const targetClient = targetFixture();
  const sourceAccounts = sourceClient.tables.find((table) => table.name === 'Accounts');
  const targetAccounts = targetClient.tables.find((table) => table.name === 'Accounts');
  sourceAccounts.views[0].property.filterInfo = {
    conjunction: 'or',
    conditions: [
      { fieldId: 'src_account_key', fieldType: 1, operator: 'isNotEmpty', value: null },
      { fieldId: 'src_name', fieldType: 1, operator: 'contains', value: ['One'] },
    ],
  };
  targetAccounts.views[0].property.filterInfo = {
    conjunction: 'and',
    conditions: [
      { fieldId: 'target_name', fieldType: 1, operator: 'contains', value: ['One'] },
      { fieldId: 'target_account_key', fieldType: 1, operator: 'isNotEmpty', value: null },
    ],
  };

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => item.code === 'CANONICAL_VERIFY_VIEW_CONFIG_MISMATCH'));
});

test('canonical verifier keeps Formula presentation drift manual when Target formula_type is not 2', async () => {
  const sourceClient = sourceFixture();
  const targetClient = targetFixture(1);
  sourceClient.tables.find((table) => table.name === 'Campaigns')
    .fields.find((field) => field.fieldName === 'budget').property.type = { data_type: 2, ui_type: 'Currency' };

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.mismatches, 0);
  assert.equal(result.manualParity.formulaPresentation.required, true);
  assert.equal(result.manualParity.formulaPresentation.mismatches.length, 1);
  assert.equal(result.manualParity.formulaPresentation.mismatches[0].fieldName, 'budget');
});

test('canonical verifier keeps Formula property.type drift manual when Target formula_type is 2', async () => {
  const sourceClient = sourceFixture();
  const targetClient = targetFixture(2);
  sourceClient.tables.find((table) => table.name === 'Campaigns')
    .fields.find((field) => field.fieldName === 'budget').property.type = { data_type: 2, ui_type: 'Currency' };

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.mismatches, 0);
  assert.equal(result.summary.manualFormulaPresentationMismatches, 1);
  assert.equal(result.manualParity.formulaPresentation.required, true);
  assert.equal(result.manualParity.formulaPresentation.targetFormulaType, 2);
  assert.ok(result.manualParity.formulaPresentation.mismatches[0].differencePaths.length > 0);
});

test('canonical verifier still fails closed on Formula definition drift', async () => {
  const sourceClient = sourceFixture();
  const targetClient = targetFixture(2);
  targetClient.tables.find((table) => table.name === 'Campaigns')
    .fields.find((field) => field.fieldName === 'budget').property.formula_expression = 'bitable::$table[target_campaigns].$field[target_budget_micros]/1000';

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts', 'Campaigns'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => (
    item.code === 'CANONICAL_VERIFY_FIELD_CONFIG_MISMATCH'
      && item.message.includes('Campaigns.budget')
      && item.details.differencePaths.some((path) => path.includes('property.formula_expression'))
  )));
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
