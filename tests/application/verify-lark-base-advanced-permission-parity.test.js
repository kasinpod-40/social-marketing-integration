import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLarkBaseAdvancedPermissionParity } from '../../packages/application/src/use-cases/verify-lark-base-advanced-permission-parity.js';

test('inactive Source role verification is a zero-request no-op', async () => {
  const result = await verifyLarkBaseAdvancedPermissionParity({
    plan: { roles: [] },
    targetClient: {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'inactive-source-roles-zero-request-noop');
  assert.equal(result.expectedRoleCount, 0);
  assert.equal(result.targetRoleCount, null);
  assert.equal(result.remoteRequestCount, 0);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.baseRuleVerification, 'not_applicable_no_active_source_roles');
});

test('verifies expected migration roles while ignoring unrelated customer roles', async () => {
  const result = await verifyLarkBaseAdvancedPermissionParity({
    plan: {
      roles: [{
        roleName: 'Reader',
        tableRoles: [
          { targetTableId: 'tbl_orders', tablePerm: 1 },
          { targetTableId: 'tbl_items', tablePerm: 2 },
        ],
      }],
    },
    targetClient: {
      async listAdvancedPermissionRoles() {
        return [
          {
            roleId: 'rol_reader',
            roleName: 'Reader',
            tableRoles: [
              { tableId: 'tbl_items', tablePerm: 2 },
              { tableId: 'tbl_orders', tablePerm: 1 },
            ],
          },
          { roleId: 'rol_customer', roleName: 'Customer Existing', tableRoles: [] },
        ];
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.expectedRoleCount, 1);
  assert.equal(result.targetRoleCount, 2);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.baseRuleVerification, 'documented_v2_all_permissions_default_by_omission');
});

test('reports missing and mismatched expected roles without mutation', async () => {
  const result = await verifyLarkBaseAdvancedPermissionParity({
    plan: {
      roles: [
        { roleName: 'Reader', tableRoles: [{ targetTableId: 'tbl_orders', tablePerm: 1 }] },
        { roleName: 'Editor', tableRoles: [{ targetTableId: 'tbl_orders', tablePerm: 4 }] },
      ],
    },
    targetClient: {
      async listAdvancedPermissionRoles() {
        return [{
          roleId: 'rol_reader',
          roleName: 'Reader',
          tableRoles: [{ tableId: 'tbl_orders', tablePerm: 2 }],
        }];
      },
    },
  });

  assert.equal(result.ok, false);
  const codes = new Set(result.mismatches.map((item) => item.code));
  assert.equal(codes.has('ADVANCED_PERMISSION_VERIFY_TABLE_ROLE_MISMATCH'), true);
  assert.equal(codes.has('ADVANCED_PERMISSION_VERIFY_ROLE_MISSING'), true);
  assert.equal(result.remoteMutationCount, 0);
});
