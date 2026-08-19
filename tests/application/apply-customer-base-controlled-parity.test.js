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

test('controlled Apply adopts existing Base v3 Formula and reconciles legacy presentation without duplicate create', async () => {
  const serverExpression = 'bitable::$table[tbl_accounts].$field[fld_budget_micros]/1000000';
  const requestedFormula = {
    fieldName: 'budget',
    type: 20,
    uiType: 'Formula',
    description: '',
    property: {
      formula_expression: 'bitable::$table[tbl_accounts].$field[fld_budget_micros]/1000000',
      formatter: '฿#,##0.00',
      currency_code: 'THB',
      type: {
        data_type: 2,
        ui_type: 'Currency',
        ui_property: {},
      },
    },
  };
  const budget = {
    fieldId: 'fldA1bzPlX',
    fieldName: 'budget',
    type: 20,
    uiType: 'Formula',
    description: '',
    isPrimary: false,
    property: {
      formula_expression: serverExpression,
      type: {
        data_type: 1,
        ui_type: 'Text',
        ui_property: {},
      },
    },
  };
  const calls = [];
  const resumedClient = {
    async listTables() {
      return [{ name: 'Accounts', tableId: 'tbl_accounts' }, { name: 'TikTok', tableId: 'tbl_tiktok' }];
    },
    async getBaseFormulaType() { return 2; },
    async listFields() { return [structuredClone(budget)]; },
    async verifyFormulaFieldV3Definition({ fieldId, field }) {
      calls.push({ kind: 'verify-v3', fieldId, expression: field.property.formula_expression });
      return { ok: true, fieldId };
    },
    async createFormulaFieldV3() {
      calls.push({ kind: 'create-v3' });
      throw new Error('must not create an existing Formula');
    },
    async updateFormulaFieldV3() {
      calls.push({ kind: 'update-v3' });
      throw new Error('definition is already correct');
    },
    async updateField({ fieldId, field }) {
      calls.push({
        kind: 'update-presentation',
        fieldId,
        formulaExpression: field.property.formula_expression,
        type: structuredClone(field.property.type),
      });
      assert.equal(field.property.formula_expression, serverExpression);
      budget.property = structuredClone(field.property);
      return structuredClone(budget);
    },
  };
  const permissionPlan = { ok: true, readyToWrite: true, roles: [] };
  let consolidationPass = 0;

  await applyCustomerBaseControlledParity({
    confirmation: CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION,
    sourceClient: {},
    targetClient: {},
    permissionSemantics: { roles: [] },
    checkpoint: checkpoint(),
    expectedTableNames: ['Accounts'],
    sourceAuthoritySha256: SHA,
    operations: {
      prepareLarkBaseResumableTarget: async () => ({ ok: true, client: resumedClient }),
      applyLarkBaseConsolidation: async ({ targetClient }) => {
        consolidationPass += 1;
        await targetClient.createField({ tableId: 'tbl_accounts', field: requestedFormula });
        await targetClient.createField({ tableId: 'tbl_accounts', field: requestedFormula });
        return { ok: true };
      },
      applyLarkBaseDocumentedViewParity: async () => ({ ok: true }),
      planLarkBaseAdvancedPermissionParity: () => permissionPlan,
      applyLarkBaseAdvancedPermissionParity: async () => ({ ok: true }),
      verifyLarkBaseAdvancedPermissionParity: async () => ({ ok: true }),
      verifyLarkBaseCloneCanonicalParity: async ({ targetClient }) => {
        const [field] = await targetClient.listFields({ tableId: 'tbl_accounts' });
        assert.equal(field.property.formula_expression, requestedFormula.property.formula_expression);
        return { ok: true };
      },
    },
  });

  assert.equal(consolidationPass, 1);
  assert.equal(calls.filter((call) => call.kind === 'create-v3').length, 0);
  assert.equal(calls.filter((call) => call.kind === 'update-v3').length, 0);
  assert.equal(calls.filter((call) => call.kind === 'update-presentation').length, 1);
  assert.equal(calls.filter((call) => call.kind === 'verify-v3').length, 3);
  assert.deepEqual(budget.property.type, {
    data_type: 2,
    ui_type: 'Currency',
    ui_property: { currency_code: 'THB', formatter: '0.00' },
  });
});
