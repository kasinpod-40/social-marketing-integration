import test from 'node:test';
import assert from 'node:assert/strict';
import { planLarkBaseAdvancedPermissionParity } from '../../packages/application/src/use-cases/plan-lark-base-advanced-permission-parity.js';

test('plans current table roles, omits all-enabled base_rule and retains orphan evidence', () => {
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
  assert.equal(result.summary.roleCount, 1);
  assert.equal(result.summary.tableRoleCount, 2);
  assert.equal(result.summary.orphanedTableRoleCount, 1);
  assert.equal(result.summary.orphanedTableReferenceCount, 1);
  assert.deepEqual(result.roles[0].request, {
    role_name: 'Reader',
    table_roles: [
      { table_id: 'tbl_target_items', table_perm: 2 },
      { table_id: 'tbl_target_orders', table_perm: 1 },
    ],
  });
  assert.equal('base_rule' in result.roles[0].request, false);
  assert.equal(result.roles[0].baseRuleMode, 'omit_documented_all_permissions_default');
  assert.equal(result.roles[0].orphanedTableRoles[0].classification, 'orphaned_export_reference_not_materializable');
});

test('fails closed when fine-grained rules, members, dashboards, unmapped tables or non-all base rules are represented', () => {
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
  const codes = new Set(result.blockers.map((item) => item.code));
  for (const expected of [
    'ADVANCED_PERMISSION_MEMBERS_UNSUPPORTED',
    'ADVANCED_PERMISSION_DASHBOARD_RULES_UNSUPPORTED',
    'ADVANCED_PERMISSION_BASE_RULE_NUMERIC_MAPPING_UNPROVEN',
    'ADVANCED_PERMISSION_TABLE_PERM_UNSUPPORTED',
    'ADVANCED_PERMISSION_TARGET_TABLE_MISSING',
  ]) assert.equal(codes.has(expected), true, expected);
});
