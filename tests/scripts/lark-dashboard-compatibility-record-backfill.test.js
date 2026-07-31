import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_CONFIRMATION,
  assertLarkDashboardCompatibilityRecordBackfillConfirmation,
} from '../../scripts/lib/lark-dashboard-compatibility-freeze-v1.js';
import { planPreservedWindowSelectBackfill } from '../../scripts/lib/lark-dashboard-field-identity-recovery-v3.js';

test('Record-only backfill requires the exact bounded confirmation', () => {
  assert.equal(
    assertLarkDashboardCompatibilityRecordBackfillConfirmation(
      LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_CONFIRMATION,
    ),
    true,
  );
  assert.throws(
    () => assertLarkDashboardCompatibilityRecordBackfillConfirmation('wrong'),
    (error) => {
      assert.equal(
        error.code,
        'LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_CONFIRMATION_REQUIRED',
      );
      assert.equal(error.details.remoteMutationCount, 0);
      assert.equal(error.details.dashboardPatchAllowed, false);
      assert.equal(error.details.fieldMutationAllowed, false);
      assert.equal(error.details.recordDeleteAllowed, false);
      return true;
    },
  );
});

test('Record-only planner writes only missing preserved Select cells', () => {
  const plan = planPreservedWindowSelectBackfill({
    records: [
      row('rec-1', 1, null, null),
      row('rec-2', 3, '3', null),
      row('rec-3', 7, null, '7'),
      row('rec-null', null, null, null),
    ],
    numberFieldName: 'window_days',
    preservedFieldName: '__mkt_legacy_window_days_single_select_v1',
    v2FieldName: '__mkt_legacy_window_days_single_select_v2',
  });

  assert.equal(plan.pendingUpdateCount, 2);
  assert.equal(plan.conflictCount, 0);
  assert.deepEqual(plan.updates, [
    {
      recordId: 'rec-1',
      fields: { __mkt_legacy_window_days_single_select_v1: '1' },
    },
    {
      recordId: 'rec-3',
      fields: { __mkt_legacy_window_days_single_select_v1: '7' },
    },
  ]);
  assert.equal(plan.updates.some((update) => update.recordId === 'rec-null'), false);
});

test('Record-only operator exposes no Dashboard, Field mutation or Record delete path', async () => {
  const source = await readFile(
    new URL('../../scripts/lark-dashboard-compatibility-record-backfill.mjs', import.meta.url),
    'utf8',
  );

  assert.match(source, /batchUpdateRecords\(/u);
  assert.match(source, /planPreservedWindowSelectBackfill/u);
  assert.match(source, /EXPECTED_RECORD_COUNT = 86/u);
  assert.match(source, /EXPECTED_BASELINE_INCOMPLETE_NULL_COUNT = 24/u);
  assert.match(source, /MAXIMUM_REVIEWED_RECORD_UPDATES = 28/u);
  assert.match(source, /dashboardPatchCount:\s*0/u);
  assert.match(source, /fieldMutationCount:\s*0/u);
  assert.match(source, /recordDeleteCount:\s*0/u);

  assert.doesNotMatch(source, /\/dashboards/u);
  assert.doesNotMatch(source, /updateField\(/u);
  assert.doesNotMatch(source, /deleteField\(/u);
  assert.doesNotMatch(source, /deleteRecords?\(/u);
  assert.doesNotMatch(source, /batchCreateRecords\(/u);
});

function row(recordId, numberValue, preservedValue, v2Value) {
  return {
    recordId,
    fields: {
      window_days: numberValue,
      __mkt_legacy_window_days_single_select_v1: preservedValue,
      __mkt_legacy_window_days_single_select_v2: v2Value,
    },
  };
}
