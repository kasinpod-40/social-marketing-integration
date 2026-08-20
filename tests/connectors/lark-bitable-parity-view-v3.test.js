import test from 'node:test';
import assert from 'node:assert/strict';
import { withLarkBaseParityCapabilities } from '../../packages/connectors/src/lark/lark-bitable-parity.client.js';

class FakeViewV3Transport {
  constructor() {
    this.appToken = 'app_target';
    this.calls = [];
    this.visibleFields = ['fld_primary', 'fld_status', 'fld_hidden'];
    this.filter = { logic: 'and', conditions: [] };
  }

  async listFields({ tableId }) {
    assert.equal(tableId, 'tbl_accounts');
    return [
      { fieldId: 'fld_primary', fieldName: 'account_key', type: 1 },
      { fieldId: 'fld_status', fieldName: 'status', type: 3 },
      { fieldId: 'fld_hidden', fieldName: 'internal_note', type: 1 },
    ];
  }

  async requestBitableJson(path, options = {}) {
    this.calls.push({ path, options: structuredClone(options) });
    if (path.endsWith('/visible_fields') && options.method === 'PUT') {
      this.visibleFields = [...options.body.visible_fields];
      return { code: 0, data: [...this.visibleFields] };
    }
    if (path.endsWith('/visible_fields') && options.method === 'GET') {
      return { code: 0, data: [...this.visibleFields] };
    }
    if (path.endsWith('/filter') && options.method === 'PUT') {
      this.filter = structuredClone(options.body);
      return { code: 0, data: structuredClone(this.filter) };
    }
    if (path.endsWith('/filter') && options.method === 'GET') {
      return { code: 0, data: structuredClone(this.filter) };
    }
    if (options.method === 'PATCH') return { code: 0, data: { view: { id: 'vew_all' } } };
    throw new Error(`unexpected View request ${options.method} ${path}`);
  }
}

test('parity decorator writes hidden fields and filters through documented Base v3 View endpoints', async () => {
  const transport = new FakeViewV3Transport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateView({
    tableId: 'tbl_accounts',
    viewId: 'vew_all',
    hiddenFields: ['fld_hidden'],
    filterInfo: {
      conjunction: 'and',
      conditions: [
        { fieldId: 'fld_status', fieldType: 3, operator: 'is', value: '["Active"]' },
      ],
    },
  });

  assert.deepEqual(result.visibleFields, ['fld_primary', 'fld_status']);
  assert.deepEqual(result.filter, {
    logic: 'and',
    conditions: [['fld_status', 'intersects', ['Active']]],
  });
  assert.deepEqual(transport.calls.map((call) => [call.options.method, call.path]), [
    ['PUT', '/open-apis/base/v3/bases/app_target/tables/tbl_accounts/views/vew_all/visible_fields'],
    ['GET', '/open-apis/base/v3/bases/app_target/tables/tbl_accounts/views/vew_all/visible_fields'],
    ['PUT', '/open-apis/base/v3/bases/app_target/tables/tbl_accounts/views/vew_all/filter'],
    ['GET', '/open-apis/base/v3/bases/app_target/tables/tbl_accounts/views/vew_all/filter'],
  ]);
});

test('parity decorator maps scalar, comparison, empty and boolean legacy filters to Base v3 tuples', async () => {
  const transport = new FakeViewV3Transport();
  const client = withLarkBaseParityCapabilities(transport);

  await client.updateView({
    tableId: 'tbl_accounts',
    viewId: 'vew_all',
    filterInfo: {
      conjunction: 'or',
      conditions: [
        { fieldId: 'fld_primary', fieldType: 1, operator: 'contains', value: '["chemistry"]' },
        { fieldId: 'fld_primary', fieldType: 1, operator: 'isNotEmpty', value: null },
        { fieldId: 'fld_status', fieldType: 2, operator: 'isGreaterEqual', value: '[10]' },
        { fieldId: 'fld_hidden', fieldType: 7, operator: 'is', value: '[true]' },
      ],
    },
  });

  assert.deepEqual(transport.filter, {
    logic: 'or',
    conditions: [
      ['fld_primary', 'intersects', 'chemistry'],
      ['fld_primary', 'non_empty'],
      ['fld_status', '>=', 10],
      ['fld_hidden', '==', true],
    ],
  });
});

test('parity decorator fails closed before View write for unmapped hidden field IDs', async () => {
  const transport = new FakeViewV3Transport();
  const client = withLarkBaseParityCapabilities(transport);

  await assert.rejects(
    () => client.updateView({
      tableId: 'tbl_accounts',
      viewId: 'vew_all',
      hiddenFields: ['fld_missing'],
    }),
    /hidden fields are not present in Target table/u,
  );
  assert.deepEqual(transport.calls, []);
});

test('parity decorator verifies Base v3 View readback instead of trusting PUT success', async () => {
  class BadReadbackTransport extends FakeViewV3Transport {
    async requestBitableJson(path, options = {}) {
      if (path.endsWith('/filter') && options.method === 'GET') {
        this.calls.push({ path, options: structuredClone(options) });
        return { code: 0, data: { logic: 'and', conditions: [] } };
      }
      return super.requestBitableJson(path, options);
    }
  }
  const transport = new BadReadbackTransport();
  const client = withLarkBaseParityCapabilities(transport);

  await assert.rejects(
    () => client.updateView({
      tableId: 'tbl_accounts',
      viewId: 'vew_all',
      filterInfo: {
        conjunction: 'and',
        conditions: [{ fieldId: 'fld_status', fieldType: 3, operator: 'is', value: '["Active"]' }],
      },
    }),
    (error) => error.code === 'LARK_BASE_V3_VIEW_FILTER_READBACK_MISMATCH',
  );
});
