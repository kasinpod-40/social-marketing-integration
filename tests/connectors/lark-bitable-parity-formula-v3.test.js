import test from 'node:test';
import assert from 'node:assert/strict';
import { withLarkBaseParityCapabilities } from '../../packages/connectors/src/lark/lark-bitable-parity.client.js';

const primary = {
  fieldId: 'fld_campaign_key',
  fieldName: 'campaign_key',
  type: 1,
  uiType: 'Text',
  description: '',
  isPrimary: true,
  property: null,
};
const budgetMicros = {
  fieldId: 'fld_budget_micros',
  fieldName: 'budget_micros',
  type: 2,
  uiType: 'Number',
  description: '',
  isPrimary: false,
  property: { formatter: '0' },
};
const accountName = {
  fieldId: 'fld_account_name',
  fieldName: 'account_name',
  type: 1,
  uiType: 'Text',
  description: '',
  isPrimary: false,
  property: null,
};

function requestedFormula(expression = 'IF(ISBLANK(bitable::$table[tbl_campaigns].$field[fld_budget_micros]), "", bitable::$table[tbl_campaigns].$field[fld_budget_micros]/1000000)') {
  return {
    fieldName: 'budget',
    type: 20,
    uiType: 'Formula',
    description: 'Budget in major units',
    property: {
      formula_expression: expression,
      type: {
        data_type: 2,
        ui_type: 'Currency',
        ui_property: { currency_code: 'THB', formatter: '0.00' },
      },
    },
  };
}

class FakeFormulaV3Transport {
  constructor() {
    this.appToken = 'app_target';
    this.calls = [];
    this.v3Fields = new Map();
    this.forceV3Expression = null;
    this.tables = [
      {
        tableId: 'tbl_campaigns',
        name: 'Campaigns',
        fields: [primary, budgetMicros],
      },
      {
        tableId: 'tbl_accounts',
        name: 'Accounts',
        fields: [{ ...primary, fieldId: 'fld_account_key', fieldName: 'account_key' }, accountName],
      },
    ];
  }

  async listTables() {
    return this.tables.map(({ tableId, name }) => ({ tableId, name }));
  }

  async listFields({ tableId }) {
    return structuredClone(this.tables.find((table) => table.tableId === tableId).fields);
  }

  async requestBitableJson(path, options = {}) {
    this.calls.push({ path, options: structuredClone(options) });
    const collection = '/open-apis/base/v3/bases/app_target/tables/tbl_campaigns/fields';
    const fieldPath = `${collection}/fld_budget`;

    if (options.method === 'POST' && path === collection) {
      const v3 = { id: 'fld_budget', ...options.body };
      this.v3Fields.set('fld_budget', v3);
      this.tables[0].fields.push({ fieldId: 'fld_budget', ...requestedFormula(), isPrimary: false });
      return { code: 0, data: { field: structuredClone(v3) } };
    }
    if (options.method === 'PUT' && path === fieldPath) {
      const v3 = { id: 'fld_budget', ...options.body };
      this.v3Fields.set('fld_budget', v3);
      const index = this.tables[0].fields.findIndex((field) => field.fieldId === 'fld_budget');
      this.tables[0].fields[index] = { fieldId: 'fld_budget', ...requestedFormula(), isPrimary: false };
      return { code: 0, data: { field: structuredClone(v3) } };
    }
    if (options.method === 'GET' && path === fieldPath) {
      const value = structuredClone(this.v3Fields.get('fld_budget'));
      if (!value) throw new Error('missing fake v3 Formula');
      if (this.forceV3Expression) value.expression = this.forceV3Expression;
      return { code: 0, data: { field: value } };
    }
    throw new Error(`unexpected Formula v3 request ${options.method} ${path}`);
  }
}

test('parity decorator creates Formula through Base v3, translates IDs, and verifies with Base v3 GET', async () => {
  const transport = new FakeFormulaV3Transport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.createFormulaFieldV3({ tableId: 'tbl_campaigns', field: requestedFormula() });

  assert.equal(result.fieldId, 'fld_budget');
  assert.deepEqual(transport.calls[0], {
    path: '/open-apis/base/v3/bases/app_target/tables/tbl_campaigns/fields',
    options: {
      method: 'POST',
      retryMode: 'rate_limit_only',
      body: {
        type: 'formula',
        name: 'budget',
        expression: 'IF(ISBLANK([budget_micros]), "", [budget_micros]/1000000)',
        description: 'Budget in major units',
      },
    },
  });
  assert.equal(transport.calls[1].options.method, 'GET');
  assert.equal(transport.calls[1].path, '/open-apis/base/v3/bases/app_target/tables/tbl_campaigns/fields/fld_budget');
  assert.equal('property' in transport.calls[0].options.body, false);
});

test('parity decorator translates cross-table legacy Formula references to Base v3 table/field names', async () => {
  const transport = new FakeFormulaV3Transport();
  const client = withLarkBaseParityCapabilities(transport);
  const field = requestedFormula('bitable::$table[tbl_accounts].$field[fld_account_name] & " / " & bitable::$table[tbl_campaigns].$field[fld_budget_micros]');

  await client.createFormulaFieldV3({ tableId: 'tbl_campaigns', field });

  assert.equal(transport.calls[0].options.body.expression, '[Accounts].[account_name] & " / " & [budget_micros]');
});

test('parity decorator updates Formula through Base v3 PUT and verifies the same v3 definition', async () => {
  const transport = new FakeFormulaV3Transport();
  transport.tables[0].fields.push({ fieldId: 'fld_budget', ...requestedFormula(), isPrimary: false });
  transport.v3Fields.set('fld_budget', {
    id: 'fld_budget', type: 'formula', name: 'budget',
    expression: 'IF(ISBLANK([budget_micros]), "", [budget_micros]/1000000)',
    description: 'Budget in major units',
  });
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateFormulaFieldV3({ tableId: 'tbl_campaigns', fieldId: 'fld_budget', field: requestedFormula() });

  assert.equal(result.fieldId, 'fld_budget');
  assert.equal(transport.calls[0].options.method, 'PUT');
  assert.equal(transport.calls[1].options.method, 'GET');
});

test('parity decorator accepts whitespace-only Base v3 expression normalization', async () => {
  const transport = new FakeFormulaV3Transport();
  transport.forceV3Expression = 'IF( ISBLANK([budget_micros]) , "" , [budget_micros] / 1000000 )';
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.createFormulaFieldV3({ tableId: 'tbl_campaigns', field: requestedFormula() });

  assert.equal(result.fieldId, 'fld_budget');
});

test('parity decorator fails closed when Base v3 GET changes Formula semantics', async () => {
  const transport = new FakeFormulaV3Transport();
  transport.forceV3Expression = '[budget_micros]/1000';
  const client = withLarkBaseParityCapabilities(transport);

  await assert.rejects(
    () => client.createFormulaFieldV3({ tableId: 'tbl_campaigns', field: requestedFormula() }),
    (error) => error?.code === 'LARK_BASE_V3_FORMULA_READBACK_MISMATCH'
      && error?.details?.differencePaths?.includes('$.expression'),
  );
});

test('parity decorator fails closed before Formula write when a legacy reference cannot be resolved', async () => {
  const transport = new FakeFormulaV3Transport();
  const client = withLarkBaseParityCapabilities(transport);

  await assert.rejects(
    () => client.createFormulaFieldV3({
      tableId: 'tbl_campaigns',
      field: requestedFormula('bitable::$table[tbl_campaigns].$field[fld_missing]'),
    }),
    /unknown field ID/u,
  );

  assert.deepEqual(transport.calls, []);
});
