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

class FakeRoleTransport {
  constructor() {
    this.appToken = 'app_target';
    this.calls = [];
  }

  async requestBitableJson(path, options = {}) {
    this.calls.push({ path, options: structuredClone(options) });
    if (options.method === 'GET' && path.startsWith('/open-apis/bitable/v1/apps/app_target/roles?')) {
      return {
        code: 0,
        data: {
          items: [{
            role_id: 'rol_reader',
            role_name: 'Reader',
            table_roles: [{ table_id: 'tbl_orders', table_name: 'Orders', table_perm: 1 }],
          }],
          has_more: false,
        },
      };
    }
    if (options.method === 'POST' && path === '/open-apis/base/v2/apps/app_target/roles') {
      return { code: 0, data: { role: { role_id: 'rol_created', role_name: options.body.role_name } } };
    }
    throw new Error(`unexpected role request ${options.method} ${path}`);
  }
}

class FakeFormulaTypeTransport {
  constructor(formulaType) {
    this.appToken = 'app_target';
    this.formulaType = formulaType;
    this.calls = [];
  }

  async requestBitableJson(path, options = {}) {
    this.calls.push({ path, options: structuredClone(options) });
    if (options.method === 'GET' && path === '/open-apis/bitable/v1/apps/app_target') {
      return { code: 0, data: { app: { formula_type: this.formulaType } } };
    }
    throw new Error(`unexpected formula metadata request ${options.method} ${path}`);
  }
}

test('parity decorator reads and caches Base formula_type through the shared transport', async () => {
  const transport = new FakeFormulaTypeTransport(1);
  const client = withLarkBaseParityCapabilities(transport);

  assert.equal(await client.getBaseFormulaType(), 1);
  assert.equal(await client.getBaseFormulaType(), 1);
  assert.deepEqual(transport.calls, [{
    path: '/open-apis/bitable/v1/apps/app_target',
    options: { method: 'GET' },
  }]);
});

test('parity decorator fails closed when Base formula_type metadata is missing or empty', async () => {
  for (const formulaType of [undefined, null, '']) {
    const transport = new FakeFormulaTypeTransport(formulaType);
    const client = withLarkBaseParityCapabilities(transport);
    await assert.rejects(
      () => client.getBaseFormulaType(),
      /formula_type must be an integer/u,
    );
  }
});

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

test('parity decorator lists existing roles through documented v1 read endpoint', async () => {
  const transport = new FakeRoleTransport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.listAdvancedPermissionRoles();

  assert.deepEqual(result, [{
    roleId: 'rol_reader',
    roleName: 'Reader',
    tableRoles: [{ tableId: 'tbl_orders', tableName: 'Orders', tablePerm: 1 }],
  }]);
  assert.equal(transport.calls.length, 1);
  assert.match(transport.calls[0].path, /^\/open-apis\/bitable\/v1\/apps\/app_target\/roles\?page_size=30$/u);
  assert.deepEqual(transport.calls[0].options, { method: 'GET' });
});

test('parity decorator creates roles only through documented v2 request fields', async () => {
  const transport = new FakeRoleTransport();
  const client = withLarkBaseParityCapabilities(transport);

  const result = await client.createAdvancedPermissionRole({
    roleName: 'Reader',
    tableRoles: [
      { tableId: 'tbl_orders', tablePerm: 1 },
      { tableId: 'tbl_items', tablePerm: 2 },
    ],
  });

  assert.deepEqual(result, { roleId: 'rol_created', roleName: 'Reader', responseCode: 0 });
  assert.deepEqual(transport.calls[0], {
    path: '/open-apis/base/v2/apps/app_target/roles',
    options: {
      method: 'POST',
      body: {
        role_name: 'Reader',
        table_roles: [
          { table_id: 'tbl_orders', table_perm: 1 },
          { table_id: 'tbl_items', table_perm: 2 },
        ],
      },
    },
  });
  assert.equal('base_rule' in transport.calls[0].options.body, false);
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
