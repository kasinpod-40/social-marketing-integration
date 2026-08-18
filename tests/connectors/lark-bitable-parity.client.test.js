import test from 'node:test';
import assert from 'node:assert/strict';
import { withLarkBaseParityCapabilities } from '../../packages/connectors/src/lark/lark-bitable-parity.client.js';

class FakeTransport {
  constructor() {
    this.appToken = 'app_target';
    this.calls = [];
    this.hierarchyFieldId = 'fld_parent';
  }

  async requestBitableJson(path, options = {}) {
    this.calls.push({ path, options: structuredClone(options) });
    if (options.method === 'GET') {
      return {
        code: 0,
        data: {
          view: {
            property: {
              hierarchy_config: { field_id: this.hierarchyFieldId },
            },
          },
        },
      };
    }
    if (options.method === 'PATCH') {
      this.hierarchyFieldId = options.body.property.hierarchy_config.field_id;
      return { code: 0, data: { view: { view_id: 'vew_1' } } };
    }
    throw new Error(`unexpected method ${options.method}`);
  }
}

test('parity decorator reads hierarchy_config through the shared transport', async () => {
  const transport = new FakeTransport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.getViewHierarchy({ tableId: 'tbl_1', viewId: 'vew_1' });

  assert.deepEqual(result, { fieldId: 'fld_parent' });
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].options.method, 'GET');
  assert.equal(
    transport.calls[0].path,
    '/open-apis/bitable/v1/apps/app_target/tables/tbl_1/views/vew_1',
  );
});

test('parity decorator writes only the documented hierarchy_config request shape', async () => {
  const transport = new FakeTransport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.updateViewHierarchy({
    tableId: 'tbl_1',
    viewId: 'vew_1',
    viewName: 'All Records',
    fieldId: 'fld_new_parent',
  });

  assert.deepEqual(result, {
    tableId: 'tbl_1',
    viewId: 'vew_1',
    fieldId: 'fld_new_parent',
    responseCode: 0,
  });
  assert.deepEqual(transport.calls[0], {
    path: '/open-apis/bitable/v1/apps/app_target/tables/tbl_1/views/vew_1',
    options: {
      method: 'PATCH',
      body: {
        view_name: 'All Records',
        property: {
          hierarchy_config: { field_id: 'fld_new_parent' },
        },
      },
    },
  });
});

test('parity decorator fails before transport when identifiers are missing', async () => {
  const transport = new FakeTransport();
  const client = withLarkBaseParityCapabilities(transport);

  await assert.rejects(
    () => client.updateViewHierarchy({ tableId: 'tbl_1', viewId: 'vew_1', fieldId: '' }),
    /fieldId is required/u,
  );
  assert.deepEqual(transport.calls, []);
});
