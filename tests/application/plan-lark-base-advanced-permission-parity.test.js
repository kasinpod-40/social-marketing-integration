import test from 'node:test';
import assert from 'node:assert/strict';
import { planLarkBaseAdvancedPermissionParity } from '../../packages/application/src/use-cases/plan-lark-base-advanced-permission-parity.js';

test('classifies unassigned Source role definitions as inactive and plans zero role writes', () => {
  const result = planLarkBaseAdvancedPermissionParity({
    targetTables: [
      { name: 'Orders', tableId: 'tbl_target_orders' },
      { name: 'Items', tableId: 'tbl_target_items' },
    ],
    permissionSemantics: {
      contractVersion: 'lark_base_export_permission_semantics_v2',
      roles: [{
        roleName: 'Reader',
        memberCount: 0,
        dashboardRoleCount: 0,
        baseRule: { 7: 1, 15: 1, 16: 1, 17: 1, 43: 1 },
        tableRoles: [
          { tableName: 'Orders', perm: 1, schemaVersion: 2, fieldPerm: 'none', fieldPermV2: 'none', recRule: 'none' },
          { tableName: 'Items', perm: 2, schemaVersion: 2, fieldPerm: 'none', fieldPermV2: 'none', recRule: 'none' },
        ],
        unresolvedTableRoles: [
          { referenceFingerprint: '0123456789abcdef', perm: 1, schemaVersion: 2, fieldPerm: 'none', fieldPermV2: 'none', recRule: 'none' },
        ],
      }],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.readyToWrite, true);
  assert.equal(result.remoteRequestCount, 0);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.summary.sourceRoleCount, 1);
  assert.equal(result.summary.roleCount, 0);
  assert.equal(result.summary.inactiveRoleCount, 1);
  assert.equal(result.summary.tableRoleCount, 0);
  assert.equal(result.summary.orphanedTableRoleCount, 0);
  assert.equal(result.summary.orphanedTableReferenceCount, 0);
  assert.deepEqual(result.roles, []);
  assert.deepEqual(result.inactiveRoles, [{
    roleName: 'Reader',
    memberCount: 0,
    dashboardRoleCount: 0,
    classification: 'inactive_unassigned_source_role_no_effective_access',
  }]);
});

test('fails closed when active roles contain unsupported members, dashboards, unmapped tables or non-all base rules', () => {
  const result = planLarkBaseAdvancedPermissionParity({
    targetTables: [{ name: 'Orders', tableId: 'tbl_target_orders' }],
    permissionSemantics: {
      roles: [{
        roleName: 'Blocked',
        memberCount: 1,
        dashboardRoleCount: 1,
        baseRule: { 7: 0 },
        tableRoles: [
          { tableName: 'Orders', perm: 8, fieldPerm: 'object', fieldPermV2: 'none', recRule: 'object' },
          { tableName: 'Missing', perm: 1, fieldPerm: 'none', fieldPermV2: 'none', recRule: 'none' },
        ],
        unresolvedTableRoles: [],
      }],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.readyToWrite, false);
  assert.equal(result.summary.sourceRoleCount, 1);
  assert.equal(result.summary.inactiveRoleCount, 0);
  const codes = new Set(result.blockers.map((item) => item.code));
  for (const expected of [
    'ADVANCED_PERMISSION_MEMBERS_UNSUPPORTED',
    'ADVANCED_PERMISSION_DASHBOARD_RULES_UNSUPPORTED',
    'ADVANCED_PERMISSION_BASE_RULE_NUMERIC_MAPPING_UNPROVEN',
    'ADVANCED_PERMISSION_TABLE_PERM_UNSUPPORTED',
    'ADVANCED_PERMISSION_TARGET_TABLE_MISSING',
  ]) assert.equal(codes.has(expected), true, expected);
});
