import test from 'node:test';
import assert from 'node:assert/strict';
import { withLarkBaseParityCapabilities } from '../../packages/connectors/src/lark/lark-bitable-parity.client.js';

class VisibleFieldsTransport {
  constructor({
    readbackTransform = (value) => value,
    semanticHiddenFields = ['fld_internal'],
  } = {}) {
    this.appToken = 'app_target';
    this.readbackTransform = readbackTransform;
    this.semanticHiddenFields = semanticHiddenFields;
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

  async getView({ tableId, viewId }) {
    assert.equal(tableId, 'tbl_report');
    assert.equal(viewId, 'vew_all');
    return {
      viewId,
      viewName: 'All Reports',
      viewType: 'grid',
      property: {
        hiddenFields: [...this.semanticHiddenFields],
        filterInfo: null,
      },
    };
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
  const transport = new VisibleFieldsTransport({
    readbackTransform: (value) => [...value].reverse(),
  });
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateView({
    tableId: 'tbl_report',
    viewId: 'vew_all',
    hiddenFields: ['fld_internal'],
  });

  assert.deepEqual(result.visibleFields, ['fld_primary', 'fld_period', 'fld_status']);
});

test('visible_fields transport mismatch is accepted when persisted hidden-field semantics match', async () => {
  const transport = new VisibleFieldsTransport({
    readbackTransform: (value) => value.slice(0, -1),
    semanticHiddenFields: ['fld_internal'],
  });
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateView({
    tableId: 'tbl_report',
    viewId: 'vew_all',
    hiddenFields: ['fld_internal'],
  });

  assert.deepEqual(result.visibleFields, ['fld_primary', 'fld_period', 'fld_status']);
});

test('visible_fields transport mismatch still fails closed when persisted hidden-field semantics differ', async () => {
  const transport = new VisibleFieldsTransport({
    readbackTransform: (value) => value.slice(0, -1),
    semanticHiddenFields: [],
  });
  const client = withLarkBaseParityCapabilities(transport);

  await assert.rejects(
    () => client.updateView({
      tableId: 'tbl_report',
      viewId: 'vew_all',
      hiddenFields: ['fld_internal'],
    }),
    (error) => error?.code === 'LARK_VIEW_HIDDEN_FIELDS_SEMANTIC_READBACK_MISMATCH'
      && error?.details?.expectedVisibleFieldCount === 3
      && error?.details?.baseV3ActualVisibleFieldCount === 2
      && error?.details?.expectedHiddenFieldCount === 1
      && error?.details?.actualHiddenFieldCount === 0,
  );
});
