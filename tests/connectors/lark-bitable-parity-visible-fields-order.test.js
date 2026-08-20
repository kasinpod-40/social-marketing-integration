import test from 'node:test';
import assert from 'node:assert/strict';
import { withLarkBaseParityCapabilities } from '../../packages/connectors/src/lark/lark-bitable-parity.client.js';

class VisibleFieldsTransport {
  constructor(readbackTransform = (value) => value) {
    this.appToken = 'app_target';
    this.readbackTransform = readbackTransform;
    this.visibleFields = [];
  }

  async listFields({ tableId }) {
    assert.equal(tableId, 'tbl_report');
    return [
      { fieldId: 'fld_primary', fieldName: 'report_key', type: 1, property: null },
      { fieldId: 'fld_period', fieldName: 'period', type: 1, property: null },
      { fieldId: 'fld_status', fieldName: 'status', type: 1, property: null },
      { fieldId: 'fld_internal', fieldName: 'internal', type: 1, property: null },
    ];
  }

  async requestBitableJson(path, options = {}) {
    assert.match(path, /\/visible_fields$/u);
    if (options.method === 'PUT') {
      this.visibleFields = [...options.body.visible_fields];
      return { code: 0, data: { visible_fields: [...this.visibleFields] } };
    }
    if (options.method === 'GET') {
      return {
        code: 0,
        data: {
          visible_fields: this.readbackTransform([...this.visibleFields]),
        },
      };
    }
    throw new Error(`unexpected request ${options.method} ${path}`);
  }
}

test('visible_fields readback accepts the same membership in a different View order', async () => {
  const transport = new VisibleFieldsTransport((value) => [...value].reverse());
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateView({
    tableId: 'tbl_report',
    viewId: 'vew_all',
    hiddenFields: ['fld_internal'],
  });

  assert.deepEqual(result.visibleFields, ['fld_primary', 'fld_period', 'fld_status']);
});

test('visible_fields readback still fails closed when membership differs', async () => {
  const transport = new VisibleFieldsTransport((value) => value.slice(0, -1));
  const client = withLarkBaseParityCapabilities(transport);

  await assert.rejects(
    () => client.updateView({
      tableId: 'tbl_report',
      viewId: 'vew_all',
      hiddenFields: ['fld_internal'],
    }),
    (error) => error?.code === 'LARK_BASE_V3_VIEW_VISIBLE_FIELDS_READBACK_MISMATCH'
      && Array.isArray(error?.details?.expected)
      && Array.isArray(error?.details?.actual)
      && error.details.expected.length === 3
      && error.details.actual.length === 2,
  );
});
