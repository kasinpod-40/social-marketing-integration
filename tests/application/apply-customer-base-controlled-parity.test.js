import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION,
  prepareCustomerBaseControlledApplyCheckpoint,
  applyCustomerBaseControlledParity,
} from '../../packages/application/src/use-cases/apply-customer-base-controlled-parity.js';

const SHA = 'c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643';

function checkpoint() {
  return {
    contractVersion: 'customer_base_controlled_apply_checkpoint_v1',
    sourceAuthoritySha256: SHA,
    expectedTableNames: ['Accounts'],
    requiredProtectedTableNames: ['TikTok'],
    protectedExternalTableNames: ['TikTok'],
    protectedTables: [{ name: 'TikTok', tableId: 'tbl_tiktok' }],
    protectedRoles: [{ roleName: 'Customer Admin', roleId: 'role_admin' }],
    manualOwnershipFrozen: true,
  };
}

test('checkpoint preparation freezes existing tables and roles without mutation', async () => {
  const result = await prepareCustomerBaseControlledApplyCheckpoint({
    targetClient: {},
    expectedTableNames: ['Accounts'],
    requiredProtectedTableNames: ['TikTok'],
    protectedExternalTableNames: ['TikTok'],
    sourceAuthoritySha256: SHA,
    operations: {
      protectCustomerLarkTarget: async () => ({
        policy: { existingTablesProtected: [{ name: 'TikTok', tableId: 'tbl_tiktok' }] },
      }),
      protectCustomerLarkBaseResources: async () => ({
        policy: { existingAdvancedPermissionRolesProtected: [{ roleName: 'Customer Admin', roleId: 'role_admin' }] },
      }),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'read-only-baseline-checkpoint');
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.manualOwnershipFrozen, true);
  assert.deepEqual(result.protectedTables, [{ name: 'TikTok', tableId: 'tbl_tiktok' }]);
  assert.deepEqual(result.protectedRoles, [{ roleName: 'Customer Admin', roleId: 'role_admin' }]);
});

test('checkpoint preparation blocks clone-scope names that existed before Apply', async () => {
  await assert.rejects(
    () => prepareCustomerBaseControlledApplyCheckpoint({
      targetClient: {},
      expectedTableNames: ['Accounts'],
      requiredProtectedTableNames: ['TikTok'],
      protectedExternalTableNames: ['TikTok'],
      sourceAuthoritySha256: SHA,
      operations: {
        protectCustomerLarkTarget: async () => ({
          policy: { existingTablesProtected: [
            { name: 'TikTok', tableId: 'tbl_tiktok' },
            { name: 'Accounts', tableId: 'tbl_customer_accounts' },
          ] },
        }),
        protectCustomerLarkBaseResources: async () => ({ policy: { existingAdvancedPermissionRolesProtected: [] } }),
      },
    }),
    (error) => error?.code === 'CUSTOMER_BASE_CONTROLLED_APPLY_BASELINE_COLLISION',
  );
});

test('controlled Apply requires the exact explicit confirmation before any phase', async () => {
  let called = false;
  await assert.rejects(
    () => applyCustomerBaseControlledParity({
      sourceClient: {},
      targetClient: {},
      permissionSemantics: {},
      checkpoint: checkpoint(),
      expectedTableNames: ['Accounts'],
      sourceAuthoritySha256: SHA,
      operations: {
        prepareLarkBaseResumableTarget: async () => { called = true; return { client: {} }; },
      },
    }),
    (error) => error?.code === 'CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION_REQUIRED',
  );
  assert.equal(called, false);
});

test('controlled Apply executes the locked automatic sequence and stops at manual parity boundary', async () => {
  const sequence = [];
  const resumedClient = { listTables: async () => [{ name: 'Accounts', tableId: 'tbl_accounts' }, { name: 'TikTok', tableId: 'tbl_tiktok' }] };
  const permissionPlan = { ok: true, readyToWrite: true, roles: [] };
  const ok = (name) => ({ ok: true, phase: name });

  const result = await applyCustomerBaseControlledParity({
    confirmation: CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION,
    sourceClient: {},
    targetClient: {},
    permissionSemantics: { roles: [] },
    checkpoint: checkpoint(),
    expectedTableNames: ['Accounts'],
    sourceAuthoritySha256: SHA,
    operations: {
      prepareLarkBaseResumableTarget: async () => {
        sequence.push('prepare-resume');
        return { ok: true, client: resumedClient };
      },
      applyLarkBaseConsolidation: async () => { sequence.push('consolidation'); return ok('consolidation'); },
      applyLarkBaseDocumentedViewParity: async () => { sequence.push('hierarchy'); return ok('hierarchy'); },
      planLarkBaseAdvancedPermissionParity: () => { sequence.push('permission-plan'); return permissionPlan; },
      applyLarkBaseAdvancedPermissionParity: async (input) => {
        sequence.push('permission-apply');
        assert.deepEqual(input.protectedRoleNames, ['Customer Admin']);
        return ok('permission-apply');
      },
      verifyLarkBaseAdvancedPermissionParity: async () => { sequence.push('permission-verify'); return ok('permission-verify'); },
      verifyLarkBaseCloneCanonicalParity: async () => { sequence.push('canonical-verify'); return ok('canonical-verify'); },
    },
  });

  assert.deepEqual(sequence, [
    'prepare-resume',
    'consolidation',
    'hierarchy',
    'permission-plan',
    'permission-apply',
    'permission-verify',
    'canonical-verify',
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.automaticApplyComplete, true);
  assert.equal(result.finalFullParityComplete, false);
  assert.deepEqual(result.manualParityRequired, [
    'view-field-order-sort-group-width-row-height-frozen-columns',
    'dashboard-ui-source-reference',
    'workflow-ui-source-reference',
    'target-folder-placement',
  ]);
});
