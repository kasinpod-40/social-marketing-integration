import test from 'node:test';
import assert from 'node:assert/strict';
import { withLarkBaseParityCapabilities } from '../../packages/connectors/src/lark/lark-bitable-parity.client.js';

class FakeViewV3Transport {
  constructor() {
    this.appToken = 'app_target';
    this.calls = [];
    this.visibleFields = ['fld_primary', 'fld_status', 'fld_number', 'fld_checkbox', 'fld_hidden'];
    this.filter = { logic: 'and', conditions: [] };
  }

  async listFields({ tableId }) {
    assert.equal(tableId, 'tbl_accounts');
    return [
      { fieldId: 'fld_primary', fieldName: 'account_key', type: 1, property: null },
      {
        fieldId: 'fld_status', fieldName: 'status', type: 3,
        property: { options: [{ id: 'opt_active_target', name: 'Active' }, { id: 'opt_paused_target', name: 'Paused' }] },
      },
      { fieldId: 'fld_number', fieldName: 'score', type: 2, property: { formatter: '0' } },
      { fieldId: 'fld_checkbox', fieldName: 'checked', type: 7, property: null },
      { fieldId: 'fld_hidden', fieldName: 'internal_note', type: 1, property: null },
    ];
  }

  async getView({ tableId, viewId }) {
    assert.equal(tableId, 'tbl_accounts');
    assert.equal(viewId, 'vew_all');
    return {
      viewId,
      viewName: 'All Accounts',
      viewType: 'grid',
      publicLevel: 'Public',
      property: {
        hiddenFields: [],
        filterInfo: {
          conjunction: 'and',
          conditions: [{ fieldId: 'fld_status', fieldType: 3, operator: 'is', value: '["opt_active_target"]' }],
        },
      },
    };
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

test('parity decorator writes hidden fields and Select filters through documented Base v3 View endpoints using option names', async () => {
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

  assert.deepEqual(result.visibleFields, ['fld_primary', 'fld_status', 'fld_number', 'fld_checkbox']);
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

test('parity decorator accepts Base v3 Select readback as Target option IDs after writing documented option names', async () => {
  class IdReadbackTransport extends FakeViewV3Transport {
    async requestBitableJson(path, options = {}) {
      if (path.endsWith('/filter') && options.method === 'GET') {
        this.calls.push({ path, options: structuredClone(options) });
        return {
          code: 0,
          data: {
            logic: this.filter.logic,
            conditions: this.filter.conditions.map(([fieldId, operator, value]) => [
              fieldId,
              operator,
              Array.isArray(value)
                ? value.map((item) => item === 'Active' ? 'opt_active_target' : item === 'Paused' ? 'opt_paused_target' : item)
                : value,
            ]),
          },
        };
      }
      return super.requestBitableJson(path, options);
    }
  }
  const transport = new IdReadbackTransport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateView({
    tableId: 'tbl_accounts',
    viewId: 'vew_all',
    filterInfo: {
      conjunction: 'and',
      conditions: [{ fieldId: 'fld_status', fieldType: 3, operator: 'is', value: ['Active'] }],
    },
  });

  assert.deepEqual(result.filter.conditions, [['fld_status', 'intersects', ['Active']]]);
});

test('parity decorator accepts Lark one-condition OR to AND readback canonicalization', async () => {
  class CanonicalizingTransport extends FakeViewV3Transport {
    async requestBitableJson(path, options = {}) {
      if (path.endsWith('/filter') && options.method === 'GET') {
        this.calls.push({ path, options: structuredClone(options) });
        return { code: 0, data: { ...structuredClone(this.filter), logic: 'and' } };
      }
      return super.requestBitableJson(path, options);
    }
  }
  const transport = new CanonicalizingTransport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateView({
    tableId: 'tbl_accounts',
    viewId: 'vew_all',
    filterInfo: {
      conjunction: 'or',
      conditions: [{ fieldId: 'fld_status', fieldType: 3, operator: 'is', value: ['Active'] }],
    },
  });

  assert.equal(result.filter.logic, 'or');
  assert.equal(result.filter.conditions.length, 1);
});

test('parity decorator keeps documented Select multi-value any-of as one intersects name-array condition', async () => {
  class ReorderingTransport extends FakeViewV3Transport {
    async requestBitableJson(path, options = {}) {
      if (path.endsWith('/filter') && options.method === 'GET') {
        this.calls.push({ path, options: structuredClone(options) });
        return {
          code: 0,
          data: {
            logic: this.filter.logic,
            conditions: this.filter.conditions.map(([fieldId, operator, value]) => [
              fieldId,
              operator,
              Array.isArray(value) ? [...value].reverse() : value,
            ]),
          },
        };
      }
      return super.requestBitableJson(path, options);
    }
  }
  const transport = new ReorderingTransport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateView({
    tableId: 'tbl_accounts',
    viewId: 'vew_all',
    filterInfo: {
      conjunction: 'or',
      conditions: [{ fieldId: 'fld_status', fieldType: 3, operator: 'is', value: ['Active', 'Paused'] }],
    },
  });

  assert.deepEqual(result.filter, {
    logic: 'or',
    conditions: [
      ['fld_status', 'intersects', ['Active', 'Paused']],
    ],
  });
});

test('parity decorator rejects a collapsed Select when both Base v3 and persisted semantic readback lose a required value', async () => {
  class CollapsingTransport extends FakeViewV3Transport {
    async requestBitableJson(path, options = {}) {
      if (path.endsWith('/filter') && options.method === 'GET') {
        this.calls.push({ path, options: structuredClone(options) });
        const [fieldId, operator, value] = this.filter.conditions[0];
        return {
          code: 0,
          data: {
            logic: this.filter.logic,
            conditions: [[fieldId, operator, Array.isArray(value) ? value.slice(0, 1) : value]],
          },
        };
      }
      return super.requestBitableJson(path, options);
    }
  }
  const transport = new CollapsingTransport();
  const client = withLarkBaseParityCapabilities(transport);

  await assert.rejects(
    () => client.updateView({
      tableId: 'tbl_accounts',
      viewId: 'vew_all',
      filterInfo: {
        conjunction: 'or',
        conditions: [{ fieldId: 'fld_status', fieldType: 3, operator: 'is', value: ['Active', 'Paused'] }],
      },
    }),
    (error) => error.code === 'LARK_VIEW_FILTER_SEMANTIC_READBACK_MISMATCH',
  );
});

test('parity decorator keeps conjunction strict when multiple persisted semantic conditions are required', async () => {
  class WrongLogicTransport extends FakeViewV3Transport {
    async requestBitableJson(path, options = {}) {
      if (path.endsWith('/filter') && options.method === 'GET') {
        this.calls.push({ path, options: structuredClone(options) });
        return { code: 0, data: { ...structuredClone(this.filter), logic: 'and' } };
      }
      return super.requestBitableJson(path, options);
    }
  }
  const transport = new WrongLogicTransport();
  const client = withLarkBaseParityCapabilities(transport);

  await assert.rejects(
    () => client.updateView({
      tableId: 'tbl_accounts',
      viewId: 'vew_all',
      filterInfo: {
        conjunction: 'or',
        conditions: [
          { fieldId: 'fld_status', fieldType: 3, operator: 'is', value: ['Active'] },
          { fieldId: 'fld_primary', fieldType: 1, operator: 'contains', value: ['chemistry'] },
        ],
      },
    }),
    (error) => error.code === 'LARK_VIEW_FILTER_SEMANTIC_READBACK_MISMATCH',
  );
});

test('parity decorator exposes Target Select View filters by semantic option name for canonical verification', async () => {
  const transport = new FakeViewV3Transport();
  const client = withLarkBaseParityCapabilities(transport);

  const view = await client.getView({ tableId: 'tbl_accounts', viewId: 'vew_all' });
  assert.deepEqual(view.property.filterInfo, {
    conjunction: 'and',
    conditions: [{ fieldId: 'fld_status', fieldType: 3, operator: 'is', value: ['Active'] }],
  });
});

test('parity decorator fails closed when a semantic Select option cannot resolve to exactly one Target option', async () => {
  const transport = new FakeViewV3Transport();
  const client = withLarkBaseParityCapabilities(transport);

  await assert.rejects(
    () => client.updateView({
      tableId: 'tbl_accounts',
      viewId: 'vew_all',
      filterInfo: {
        conjunction: 'and',
        conditions: [{ fieldId: 'fld_status', fieldType: 3, operator: 'is', value: ['Missing'] }],
      },
    }),
    /must resolve to exactly one Target option/u,
  );
  assert.deepEqual(transport.calls, []);
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
        { fieldId: 'fld_number', fieldType: 2, operator: 'isGreaterEqual', value: '[10]' },
        { fieldId: 'fld_checkbox', fieldType: 7, operator: 'is', value: '[true]' },
      ],
    },
  });

  assert.deepEqual(transport.filter, {
    logic: 'or',
    conditions: [
      ['fld_primary', 'intersects', 'chemistry'],
      ['fld_primary', 'non_empty'],
      ['fld_number', '>=', 10],
      ['fld_checkbox', '==', true],
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

test('parity decorator accepts Base v3 presentation mismatch when persisted View semantics match', async () => {
  class PresentationMismatchTransport extends FakeViewV3Transport {
    async requestBitableJson(path, options = {}) {
      if (path.endsWith('/filter') && options.method === 'GET') {
        this.calls.push({ path, options: structuredClone(options) });
        return { code: 0, data: { logic: 'and', conditions: [] } };
      }
      return super.requestBitableJson(path, options);
    }
  }
  const transport = new PresentationMismatchTransport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateView({
    tableId: 'tbl_accounts',
    viewId: 'vew_all',
    filterInfo: {
      conjunction: 'and',
      conditions: [{ fieldId: 'fld_status', fieldType: 3, operator: 'is', value: '["Active"]' }],
    },
  });

  assert.deepEqual(result.filter.conditions, [['fld_status', 'intersects', ['Active']]]);
});

test('parity decorator accepts split SingleSelect OR readback when persisted View semantics preserve the same any-of set', async () => {
  class SplitSemanticTransport extends FakeViewV3Transport {
    async requestBitableJson(path, options = {}) {
      if (path.endsWith('/filter') && options.method === 'GET') {
        this.calls.push({ path, options: structuredClone(options) });
        return { code: 0, data: { logic: 'and', conditions: [] } };
      }
      return super.requestBitableJson(path, options);
    }

    async getView({ tableId, viewId }) {
      assert.equal(tableId, 'tbl_accounts');
      assert.equal(viewId, 'vew_all');
      return {
        viewId,
        viewName: 'All Accounts',
        viewType: 'grid',
        publicLevel: 'Public',
        property: {
          hiddenFields: [],
          filterInfo: {
            conjunction: 'or',
            conditions: [
              { fieldId: 'fld_status', fieldType: 3, operator: 'is', value: '["opt_paused_target"]' },
              { fieldId: 'fld_status', fieldType: 3, operator: 'is', value: '["opt_active_target"]' },
            ],
          },
        },
      };
    }
  }
  const transport = new SplitSemanticTransport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateView({
    tableId: 'tbl_accounts',
    viewId: 'vew_all',
    filterInfo: {
      conjunction: 'or',
      conditions: [{ fieldId: 'fld_status', fieldType: 3, operator: 'is', value: ['Active', 'Paused'] }],
    },
  });

  assert.deepEqual(result.filter.conditions, [['fld_status', 'intersects', ['Active', 'Paused']]]);
});

test('parity decorator still fails closed when Base v3 and persisted semantic readback both differ', async () => {
  class BadSemanticReadbackTransport extends FakeViewV3Transport {
    async requestBitableJson(path, options = {}) {
      if (path.endsWith('/filter') && options.method === 'GET') {
        this.calls.push({ path, options: structuredClone(options) });
        return { code: 0, data: { logic: 'and', conditions: [] } };
      }
      return super.requestBitableJson(path, options);
    }

    async getView({ tableId, viewId }) {
      assert.equal(tableId, 'tbl_accounts');
      assert.equal(viewId, 'vew_all');
      return {
        viewId,
        viewName: 'All Accounts',
        viewType: 'grid',
        publicLevel: 'Public',
        property: { hiddenFields: [], filterInfo: { conjunction: 'and', conditions: [] } },
      };
    }
  }
  const transport = new BadSemanticReadbackTransport();
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
    (error) => error.code === 'LARK_VIEW_FILTER_SEMANTIC_READBACK_MISMATCH'
      && error.details?.expectedConditionCount === 1
      && error.details?.actualConditionCount === 0,
  );
});
