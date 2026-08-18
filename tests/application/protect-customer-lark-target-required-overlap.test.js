import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProtectedTargetTablePlan } from '../../packages/application/src/use-cases/protect-customer-lark-target.js';

test('required protected Source overlap without a reuse_exact plan fails closed', () => {
  assert.throws(
    () => assertProtectedTargetTablePlan({
      preview: {
        tables: [
          { name: '🪪 MKT_Accounts', action: 'create' },
        ],
      },
      existingTablesProtected: [
        { name: '🎵 RAW_TikTok_Creator_Videos', tableId: 'tblTikTok' },
        { name: '(VDO) Content Creator', tableId: 'tblVdo' },
      ],
      requiredProtectedTableNames: ['🎵 RAW_TikTok_Creator_Videos'],
    }),
    (error) => {
      assert.equal(error.code, 'CUSTOMER_BASE_PROTECTED_TABLE_PLAN_BLOCKED');
      assert.deepEqual(error.details.violations, [{
        name: '🎵 RAW_TikTok_Creator_Videos',
        reason: 'required protected Source overlap has no reuse_exact plan entry; preview conflict or omission must block',
      }]);
      return true;
    },
  );
});
