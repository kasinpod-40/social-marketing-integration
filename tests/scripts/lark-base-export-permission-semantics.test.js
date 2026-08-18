import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLarkBaseExportPermissionSemantics } from '../../scripts/lib/lark-base-export-permission-semantics.js';

test('permission semantic audit exposes only safe role/table semantics', () => {
  const result = inspectLarkBaseExportPermissionSemantics({
    sourceTables: [
      { tableId: 'tbl_secret_a', name: 'Orders' },
      { tableId: 'tbl_secret_b', name: 'Items' },
    ],
    roles: [{
      baseId: 12345,
      roleId: 'rol_secret',
      name: 'Operators',
      createdTime: 'secret-created',
      updatedTime: 'secret-updated',
      members: [{ id: 'usr_secret' }],
      baseRule: { 7: 1, 15: 0 },
      blockRoleMap: {},
      tableRoleMap: {
        tbl_secret_a: {
          tableId: 'tbl_secret_a',
          perm: 2,
          schemaVersion: 3,
          fieldPerm: null,
          fieldPermV2: null,
          recRule: null,
        },
        tbl_secret_b: {
          tableId: 'tbl_secret_b',
          perm: 1,
          schemaVersion: 3,
          fieldPerm: {},
          fieldPermV2: [],
          recRule: { conjunction: 'and' },
        },
      },
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.remoteRequestCount, 0);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.roles[0].roleName, 'Operators');
  assert.equal(result.roles[0].memberCount, 1);
  assert.deepEqual(result.roles[0].baseRule, { 7: 1, 15: 0 });
  assert.deepEqual(result.roles[0].tableRoles, [
    {
      tableName: 'Items',
      perm: 1,
      schemaVersion: 3,
      fieldPerm: 'empty_object',
      fieldPermV2: 'empty_array',
      recRule: 'object',
    },
    {
      tableName: 'Orders',
      perm: 2,
      schemaVersion: 3,
      fieldPerm: 'none',
      fieldPermV2: 'none',
      recRule: 'none',
    },
  ]);
  assert.deepEqual(result.summary.tablePermValues, [1, 2]);
  assert.deepEqual(result.summary.baseRuleKeys, ['7', '15']);

  const serialized = JSON.stringify(result);
  for (const forbidden of ['tbl_secret_a', 'tbl_secret_b', 'rol_secret', 'usr_secret', 'secret-created', 'secret-updated']) {
    assert.equal(serialized.includes(forbidden), false, `must redact ${forbidden}`);
  }
});

test('permission semantic audit fails closed on unknown role properties and unmapped tables', () => {
  assert.throws(() => inspectLarkBaseExportPermissionSemantics({
    sourceTables: [{ tableId: 'tbl_a', name: 'A' }],
    roles: [{
      name: 'Role',
      members: [],
      baseRule: {},
      blockRoleMap: {},
      tableRoleMap: {},
      unexpected: true,
    }],
  }), /unsupported exported role property/u);

  assert.throws(() => inspectLarkBaseExportPermissionSemantics({
    sourceTables: [{ tableId: 'tbl_a', name: 'A' }],
    roles: [{
      name: 'Role',
      members: [],
      baseRule: {},
      blockRoleMap: {},
      tableRoleMap: {
        tbl_missing: {
          tableId: 'tbl_missing',
          perm: 2,
          schemaVersion: 1,
          fieldPerm: null,
          fieldPermV2: null,
          recRule: null,
        },
      },
    }],
  }), /references unknown source table/u);
});
