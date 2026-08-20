import test from 'node:test';
import assert from 'node:assert/strict';
import { withLarkBaseParityCapabilities } from '../../packages/connectors/src/lark/lark-bitable-parity.client.js';

class CollapsingThenRecoveringTransport {
  constructor() {
    this.appToken = 'app_target';
    this.filterWrites = [];
    this.filter = { logic: 'and', conditions: [] };
  }

  async listFields({ tableId }) {
    assert.equal(tableId, 'tbl_accounts');
    return [
      { fieldId: 'fld_primary', fieldName: 'account_key', type: 1, property: null },
      {
        fieldId: 'fld_status',
        fieldName: 'connection_status',
        type: 3,
        property: {
          options: [
            { id: 'opt_connected_target', name: 'connected' },
            { id: 'opt_warning_target', name: 'warning' },
          ],
        },
      },
    ];
  }

  async getView({ tableId, viewId }) {
    assert.equal(tableId, 'tbl_accounts');
    assert.equal(viewId, 'vew_connection_issues');
    const recovered = this.filterWrites.length >= 2;
    return {
      viewId,
      viewName: '⚠️ Connection Issues',
      viewType: 'grid',
      publicLevel: 'Public',
      property: {
        hiddenFields: [],
        filterInfo: recovered
          ? {
              conjunction: 'or',
              conditions: [
                { fieldId: 'fld_status', fieldType: 3, operator: 'is', value: '["opt_warning_target"]' },
                { fieldId: 'fld_status', fieldType: 3, operator: 'is', value: '["opt_connected_target"]' },
              ],
            }
          : {
              conjunction: 'or',
              conditions: [
                { fieldId: 'fld_status', fieldType: 3, operator: 'is', value: '["opt_connected_target"]' },
              ],
            },
      },
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
      if (this.filterWrites.length === 1) {
        const [fieldId, operator, value] = this.filter.conditions[0];
        return {
          code: 0,
          data: {
            logic: this.filter.logic,
            conditions: [[fieldId, operator, Array.isArray(value) ? value.slice(0, 1) : value]],
          },
        };
      }
      return {
        code: 0,
        data: {
          logic: this.filter.logic,
          conditions: [...this.filter.conditions].reverse(),
        },
      };
    }
    throw new Error(`unexpected request ${options.method} ${path}`);
  }
}

test('repairs only a proven collapsed SingleSelect multi-value any-of using one OR option-name condition per value', async () => {
  const transport = new CollapsingThenRecoveringTransport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateView({
    tableId: 'tbl_accounts',
    viewId: 'vew_connection_issues',
    filterInfo: {
      conjunction: 'or',
      conditions: [
        {
          fieldId: 'fld_status',
          fieldType: 3,
          operator: 'is',
          value: ['connected', 'warning'],
        },
      ],
    },
  });

  assert.equal(transport.filterWrites.length, 2);
  assert.deepEqual(transport.filterWrites[0], {
    logic: 'or',
    conditions: [
      ['fld_status', 'intersects', ['connected', 'warning']],
    ],
  });
  assert.deepEqual(transport.filterWrites[1], {
    logic: 'or',
    conditions: [
      ['fld_status', 'intersects', ['connected']],
      ['fld_status', 'intersects', ['warning']],
    ],
  });
  assert.deepEqual(result.filter, transport.filterWrites[1]);
});
