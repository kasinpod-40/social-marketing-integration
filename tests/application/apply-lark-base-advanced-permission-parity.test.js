import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLarkBaseAdvancedPermissionParity } from '../../packages/application/src/use-cases/apply-lark-base-advanced-permission-parity.js';

class FakeRoleClient {
  constructor(roles = []) {
    this.roles = structuredClone(roles);
    this.calls = [];
    this.sequence = 0;
    this.failAfterCreate = null;
  }

  async listAdvancedPermissionRoles() {
    return structuredClone(this.roles);
  }

  async createAdvancedPermissionRole({ roleName, tableRoles }) {
    this.calls.push({ roleName, tableRoles: structuredClone(tableRoles) });
    const created = {
      roleId: `role_${++this.sequence}`,
      roleName,
      tableRoles: structuredClone(tableRoles),
    };
    this.roles.push(created);
    if (this.failAfterCreate === roleName) throw new Error(`simulated interruption after ${roleName}`);
    return structuredClone(created);
  }
}

function plan() {
  return {
    ok: true,
    readyToWrite: true,
    roles: [
      {
        roleName: 'Reader',
        tableRoles: [{ targetTableId: 'tbl_a', tablePerm: 1 }],
      },
      {
        roleName: 'Editor',
        tableRoles: [{ targetTableId: 'tbl_a', tablePerm: 4 }, { targetTableId: 'tbl_b', tablePerm: 2 }],
      },
    ],
  };
}

test('advanced permission apply is a zero-request no-op when no active Source roles are planned', async () => {
  const result = await applyLarkBaseAdvancedPermissionParity({
    plan: { ok: true, readyToWrite: true, roles: [] },
    targetClient: {},
    protectedRoleNames: ['Customer Admin'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'inactive-source-roles-zero-request-noop');
  assert.equal(result.createdRoles, 0);
  assert.equal(result.reusedExactRoles, 0);
  assert.equal(result.remoteRequestCount, 0);
  assert.equal(result.remoteMutationCount, 0);
});

test('advanced permission apply creates missing roles and verifies each readback', async () => {
  const client = new FakeRoleClient();
  const result = await applyLarkBaseAdvancedPermissionParity({
    plan: plan(),
    targetClient: client,
    protectedRoleNames: ['Customer Admin'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.createdRoles, 2);
  assert.equal(result.reusedExactRoles, 0);
  assert.deepEqual(client.roles.map((role) => role.roleName).sort(), ['Editor', 'Reader']);
});

test('advanced permission apply resumes after a partial role create without duplicating the completed role', async () => {
  const client = new FakeRoleClient();
  client.failAfterCreate = 'Reader';

  await assert.rejects(
    () => applyLarkBaseAdvancedPermissionParity({ plan: plan(), targetClient: client, protectedRoleNames: [] }),
    /simulated interruption/,
  );
  assert.equal(client.roles.filter((role) => role.roleName === 'Reader').length, 1);

  client.failAfterCreate = null;
  const resumed = await applyLarkBaseAdvancedPermissionParity({
    plan: plan(),
    targetClient: client,
    protectedRoleNames: [],
  });

  assert.equal(resumed.createdRoles, 1);
  assert.equal(resumed.reusedExactRoles, 1);
  assert.equal(client.roles.filter((role) => role.roleName === 'Reader').length, 1);
  assert.equal(client.roles.filter((role) => role.roleName === 'Editor').length, 1);
});

test('advanced permission apply never adopts a role name that existed in the checkpoint baseline', async () => {
  const client = new FakeRoleClient([{
    roleId: 'existing_reader',
    roleName: 'Reader',
    tableRoles: [{ tableId: 'tbl_a', tablePerm: 1 }],
  }]);

  await assert.rejects(
    () => applyLarkBaseAdvancedPermissionParity({
      plan: plan(),
      targetClient: client,
      protectedRoleNames: ['Reader'],
    }),
    (error) => error?.code === 'ADVANCED_PERMISSION_APPLY_PREFLIGHT_BLOCKED'
      && error?.details?.blockers?.some((entry) => entry.code === 'ADVANCED_PERMISSION_PROTECTED_ROLE_COLLISION'),
  );
  assert.equal(client.calls.length, 0);
});

test('advanced permission apply blocks a mismatched partial role before any new mutation', async () => {
  const client = new FakeRoleClient([{
    roleId: 'partial_reader',
    roleName: 'Reader',
    tableRoles: [{ tableId: 'tbl_a', tablePerm: 4 }],
  }]);

  await assert.rejects(
    () => applyLarkBaseAdvancedPermissionParity({ plan: plan(), targetClient: client, protectedRoleNames: [] }),
    (error) => error?.code === 'ADVANCED_PERMISSION_APPLY_PREFLIGHT_BLOCKED'
      && error?.details?.blockers?.some((entry) => entry.code === 'ADVANCED_PERMISSION_RESUME_ROLE_CONFLICT'),
  );
  assert.equal(client.calls.length, 0);
});
