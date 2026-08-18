import test from 'node:test';
import assert from 'node:assert/strict';
import { protectCustomerLarkBaseResources } from '../../packages/application/src/use-cases/protect-customer-lark-base-resources.js';

test('snapshots preexisting roles and blocks duplicate-name creation before underlying write', async () => {
  let writes = 0;
  const underlying = {
    async listAdvancedPermissionRoles() {
      return [{ roleId: 'rol_existing', roleName: 'Reader' }];
    },
    async createAdvancedPermissionRole(request) {
      writes += 1;
      return { roleId: 'rol_new', roleName: request.roleName };
    },
  };

  const protectedTarget = await protectCustomerLarkBaseResources({ client: underlying });
  assert.equal(protectedTarget.policy.contractVersion, 'customer_lark_base_resource_protection_v1');
  assert.deepEqual(protectedTarget.policy.existingAdvancedPermissionRolesProtected, [
    { roleId: 'rol_existing', roleName: 'Reader' },
  ]);

  await assert.rejects(
    protectedTarget.client.createAdvancedPermissionRole({ roleName: 'Reader', tableRoles: [] }),
    (error) => error?.code === 'CUSTOMER_BASE_PROTECTED_ROLE_WRITE_BLOCKED',
  );
  assert.equal(writes, 0);

  const created = await protectedTarget.client.createAdvancedPermissionRole({ roleName: 'Migration Role', tableRoles: [] });
  assert.equal(created.roleId, 'rol_new');
  assert.equal(writes, 1);
});

test('fails closed on duplicate preexisting role names', async () => {
  await assert.rejects(
    protectCustomerLarkBaseResources({
      client: {
        async listAdvancedPermissionRoles() {
          return [
            { roleId: 'rol_a', roleName: 'Reader' },
            { roleId: 'rol_b', roleName: 'Reader' },
          ];
        },
      },
    }),
    (error) => error?.code === 'CUSTOMER_BASE_PREEXISTING_ROLE_DUPLICATE',
  );
});
