import test from 'node:test';
import assert from 'node:assert/strict';
import {
  META_PAID_LARK_CLOSEOUT_EXCLUDED_TABLE_KEYS,
  META_PAID_LARK_CLOSEOUT_TABLE_KEYS,
  buildMetaPaidLarkEnvironment,
  createMetaPaidLarkCloseoutPlan,
  validateMetaPaidLarkCloseoutPlan,
  validateMetaPaidLarkReconciliation,
} from '../../scripts/lib/meta-paid-lark-closeout.js';

const HEAD = '21179971b7a5f3631303260614bd768ebfe47d54';
const CREATED_AT = Date.parse('2026-08-22T15:45:00.000Z');

test('paid Meta closeout plan uses fresh current-contract July operations for K2 and K3 only', () => {
  const plan = createMetaPaidLarkCloseoutPlan(HEAD, CREATED_AT);
  assert.deepEqual(plan.operations.map((item) => item.target), ['chemistry_k2', 'chemistry_k3']);
  assert.deepEqual(plan.operations.map((item) => item.operationId), [
    'meta-chemistry_k2-history-20260701-20260731-c71d63044b82',
    'meta-chemistry_k3-history-20260701-20260731-5bbf75b9af2c',
  ]);
  assert.deepEqual(plan.operations.map((item) => item.originalRequestedAt), [
    '2026-08-22T15:45:00.000Z',
    '2026-08-22T15:45:00.001Z',
  ]);
  assert.equal(plan.operations.every((item) => item.periodStart === '2026-07-01'), true);
  assert.equal(plan.operations.every((item) => item.periodEnd === '2026-07-31'), true);
  assert.equal(plan.operations.every((item) => (
    JSON.stringify(item.larkTableKeys) === JSON.stringify(META_PAID_LARK_CLOSEOUT_TABLE_KEYS)
  )), true);
  assert.equal(plan.facebookMode, 'excluded_no_sync_no_queue_send');
  assert.equal(plan.instagramMode, 'verify_only_no_queue_send');
  assert.equal(plan.schedules, false);
  assert.equal(plan.production, false);
  assert.deepEqual(validateMetaPaidLarkCloseoutPlan(plan, HEAD), plan);
});

test('paid Meta Lark environment pins the exact two-table allowlist', () => {
  const operation = createMetaPaidLarkCloseoutPlan(HEAD, CREATED_AT).operations[0];
  const env = buildMetaPaidLarkEnvironment({ KEEP: 'yes' }, operation);
  assert.equal(env.KEEP, 'yes');
  assert.equal(env.MKT_META_LARK_TARGET, 'chemistry_k2');
  assert.equal(env.MKT_META_LARK_OPERATION_ID, operation.operationId);
  assert.equal(env.MKT_META_LARK_TABLE_KEYS, 'mktAdsCreatives,mktAdsDaily');
  assert.equal(env.MKT_META_LARK_PERIOD_START, '2026-07-01');
  assert.equal(env.MKT_META_LARK_PERIOD_END, '2026-07-31');
});

test('paid Meta reconciliation accepts exactly Creatives and Daily and rejects expanded paid scope', () => {
  const operation = createMetaPaidLarkCloseoutPlan(HEAD, CREATED_AT).operations[0];
  const verification = {
    data: {
      comparison: {
        larkResults: [
          { tableKey: 'mktAdsCreatives', expected: 3, created: 2, updated: 0, skipped: 1 },
          { tableKey: 'mktAdsDaily', expected: 7, created: 4, updated: 1, skipped: 2 },
        ],
      },
    },
  };
  const result = validateMetaPaidLarkReconciliation(verification, operation);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.larkTableKeys, META_PAID_LARK_CLOSEOUT_TABLE_KEYS);
  assert.deepEqual(result.excludedLarkTableKeys, META_PAID_LARK_CLOSEOUT_EXCLUDED_TABLE_KEYS);

  const expanded = structuredClone(verification);
  expanded.data.comparison.larkResults.unshift({
    tableKey: 'mktAdsAdGroups',
    expected: 1,
    created: 1,
    updated: 0,
    skipped: 0,
  });
  assert.throws(
    () => validateMetaPaidLarkReconciliation(expanded, operation),
    (error) => error.code === 'META_PAID_LARK_CLOSEOUT_RECONCILIATION_INVALID',
  );
});

test('paid Meta plan rejects scope, generation and repository-head drift', () => {
  const plan = structuredClone(createMetaPaidLarkCloseoutPlan(HEAD, CREATED_AT));
  plan.operations[0].larkTableKeys = ['mktAdsCreatives', 'mktAdsDaily', 'mktAdsAdGroups'];
  assert.throws(
    () => validateMetaPaidLarkCloseoutPlan(plan, HEAD),
    (error) => error.code === 'META_PAID_LARK_CLOSEOUT_SCOPE_INVALID',
  );

  const generationDrift = structuredClone(createMetaPaidLarkCloseoutPlan(HEAD, CREATED_AT));
  generationDrift.operations[0].originalRequestedAt = '2026-08-22T15:45:01.000Z';
  assert.throws(
    () => validateMetaPaidLarkCloseoutPlan(generationDrift, HEAD),
    (error) => error.code === 'META_PAID_LARK_CLOSEOUT_PLAN_INVALID',
  );

  const clean = createMetaPaidLarkCloseoutPlan(HEAD, CREATED_AT);
  assert.throws(
    () => validateMetaPaidLarkCloseoutPlan(clean, 'a'.repeat(40)),
    (error) => error.code === 'META_PAID_LARK_CLOSEOUT_PLAN_INVALID',
  );
});