import test from 'node:test';
import assert from 'node:assert/strict';
import { withLarkBaseParityCapabilities } from '../../packages/connectors/src/lark/lark-bitable-parity.client.js';

const SOURCE_VALUES = Object.freeze([
  'not_connected',
  'expired',
  'permission_error',
  'disabled',
]);

const TARGET_OPTIONS = Object.freeze([
  { id: 'opt_not_connected_target', name: 'not_connected' },
  { id: 'opt_connected_target', name: 'connected' },
  { id: 'opt_expired_target', name: 'expired' },
  { id: 'opt_permission_error_target', name: 'permission_error' },
  { id: 'opt_disabled_target', name: 'disabled' },
]);

class MktAccountsOperatorAliasTransport {
  constructor(readbackMode = 'split-contains') {
    this.appToken = 'app_target';
    this.readbackMode = readbackMode;
    this.filter = { logic: 'and', conditions: [] };
    this.filterWrites = [];
  }

  async listFields({ tableId }) {
    assert.equal(tableId, 'tbl_accounts');
    return [{
      fieldId: 'fld_connection_status',
      fieldName: 'connection_status',
      type: 3,
      property: { options: TARGET_OPTIONS.map((option) => ({ ...option })) },
    }];
  }

  async getView({ tableId, viewId }) {
    assert.equal(tableId, 'tbl_accounts');
    assert.equal(viewId, 'vew_connection_issues');
    const optionIdByName = new Map(TARGET_OPTIONS.map((option) => [option.name, option.id]));
    const filterInfo = this.readbackMode === 'collapsed-intersects'
      ? {
          conjunction: 'and',
          conditions: [{
            fieldId: 'fld_connection_status',
            fieldType: 3,
            operator: 'intersects',
            value: JSON.stringify(SOURCE_VALUES.map((value) => optionIdByName.get(value))),
          }],
        }
      : {
          conjunction: 'or',
          conditions: SOURCE_VALUES.map((value) => ({
            fieldId: 'fld_connection_status',
            fieldType: 3,
            operator: 'contains',
            value: JSON.stringify([optionIdByName.get(value)]),
          })),
        };
    return {
      viewId,
      viewName: '⚠️ Connection Issues',
      viewType: 'grid',
      publicLevel: 'Public',
      property: { hiddenFields: [], filterInfo },
    };
  }

  async requestBitableJson(path, options = {}) {
    if (!path.endsWith('/filter')) throw new Error(`unexpected request ${options.method} ${path}`);
    if (options.method === 'PUT') {
      this.filter = structuredClone(options.body);
      this.filterWrites.push(structuredClone(options.body));
      return { code: 0, data: structuredClone(this.filter) };
    }
    if (options.method === 'GET') {
      // Force the persisted semantic readback path. The Base v3 tuple presentation is
      // deliberately unusable here because the live blocker occurs after this fallback.
      return { code: 0, data: { logic: 'and', conditions: [] } };
    }
    throw new Error(`unexpected request ${options.method} ${path}`);
  }
}

function sourceConnectionIssuesFilter() {
  return {
    conjunction: 'or',
    conditions: SOURCE_VALUES.map((value) => ({
      fieldId: 'fld_connection_status',
      fieldType: 3,
      operator: 'is',
      value: [value],
    })),
  };
}

for (const readbackMode of ['split-contains', 'collapsed-intersects']) {
  test(`accepts exact MKT_Accounts four-condition Source semantics across Target ${readbackMode} operator presentation`, async () => {
    const transport = new MktAccountsOperatorAliasTransport(readbackMode);
    const client = withLarkBaseParityCapabilities(transport);

    const result = await client.updateView({
      tableId: 'tbl_accounts',
      viewId: 'vew_connection_issues',
      filterInfo: sourceConnectionIssuesFilter(),
    });

    assert.equal(transport.filterWrites.length, 1);
    assert.deepEqual(transport.filterWrites[0], {
      logic: 'or',
      conditions: SOURCE_VALUES.map((value) => [
        'fld_connection_status',
        'intersects',
        [value],
      ]),
    });
    assert.deepEqual(result.filter, transport.filterWrites[0]);
  });
}

test('normalizes Target SingleSelect negative operator aliases back to Source isNot semantics', async () => {
  class NegativeAliasTransport extends MktAccountsOperatorAliasTransport {
    async getView({ tableId, viewId }) {
      assert.equal(tableId, 'tbl_accounts');
      assert.equal(viewId, 'vew_connection_issues');
      return {
        viewId,
        viewName: 'Negative alias',
        viewType: 'grid',
        publicLevel: 'Public',
        property: {
          hiddenFields: [],
          filterInfo: {
            conjunction: 'and',
            conditions: [{
              fieldId: 'fld_connection_status',
              fieldType: 3,
              operator: 'disjoint',
              value: '["opt_connected_target"]',
            }],
          },
        },
      };
    }
  }

  const client = withLarkBaseParityCapabilities(new NegativeAliasTransport());
  const view = await client.getView({
    tableId: 'tbl_accounts',
    viewId: 'vew_connection_issues',
  });

  assert.deepEqual(view.property.filterInfo, {
    conjunction: 'and',
    conditions: [{
      fieldId: 'fld_connection_status',
      fieldType: 3,
      operator: 'isNot',
      value: ['connected'],
    }],
  });
});
