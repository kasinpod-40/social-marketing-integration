import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProtectedTargetTablePlan,
  protectCustomerLarkTarget,
} from '../../packages/application/src/use-cases/protect-customer-lark-target.js';

const TIKTOK = '🎵 RAW_TikTok_Creator_Videos';

class TargetClient {
  constructor() {
    this.calls = [];
  }

  async listTables() {
    return [
      { name: TIKTOK, tableId: 'tblTikTok' },
      { name: '(VDO) Content Creator', tableId: 'tblVdo' },
    ];
  }

  async updateField(input) {
    this.calls.push({ method: 'updateField', input });
    return {};
  }
}

test('protected external table may be absent from clone plan and is reported as protected_external_reuse', async () => {
  const client = new TargetClient();
  const protection = await protectCustomerLarkTarget({
    client,
    requiredProtectedTableNames: [TIKTOK],
    protectedExternalTableNames: [TIKTOK],
  });

  const result = assertProtectedTargetTablePlan({
    preview: {
      tables: [
        { name: '🪪 MKT_Accounts', action: 'create' },
      ],
    },
    existingTablesProtected: protection.policy.existingTablesProtected,
    requiredProtectedTableNames: protection.policy.requiredProtectedTableNames,
    protectedExternalTableNames: protection.policy.protectedExternalTableNames,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.protectedExternalTableNames, [TIKTOK]);
  assert.deepEqual(result.sourceOverlaps, [{ name: TIKTOK, action: 'protected_external_reuse' }]);
  assert.equal(protection.policy.contractVersion, 'customer_lark_target_protection_v3');

  await assert.rejects(
    () => protection.client.updateField({ tableId: 'tblTikTok', fieldId: 'fldDate', field: {} }),
    (error) => {
      assert.equal(error.code, 'CUSTOMER_BASE_PROTECTED_TABLE_WRITE_BLOCKED');
      return true;
    },
  );
  assert.deepEqual(client.calls, []);
});

test('protected external table must not appear in clone plan', () => {
  assert.throws(
    () => assertProtectedTargetTablePlan({
      preview: {
        tables: [
          { name: TIKTOK, action: 'reuse_exact' },
        ],
      },
      existingTablesProtected: [{ name: TIKTOK, tableId: 'tblTikTok' }],
      requiredProtectedTableNames: [TIKTOK],
      protectedExternalTableNames: [TIKTOK],
    }),
    (error) => {
      assert.equal(error.code, 'CUSTOMER_BASE_PROTECTED_TABLE_PLAN_BLOCKED');
      assert.deepEqual(error.details.violations, [{
        name: TIKTOK,
        reason: 'protected external table must be excluded from clone plan, found reuse_exact',
      }]);
      return true;
    },
  );
});
