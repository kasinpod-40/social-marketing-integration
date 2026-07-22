import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertGoogleAdsViewFilterPlanSafe,
  createNoCreateLarkViewClient,
} from '../../packages/application/src/use-cases/guard-google-ads-view-filter-plan.js';

function safePlan(actions = []) {
  return {
    readyToApply: true,
    summary: {
      createViews: 0,
      updateViews: actions.filter((action) => action.kind === 'update_view').length,
    },
    actions,
    conflicts: [],
    warnings: [],
  };
}

test('accepts update-only Google Ads View filter plans', () => {
  const plan = safePlan([
    { kind: 'update_view', viewName: '🏦 Google Ads Accounts' },
    { kind: 'update_view', viewName: '📈 Google Ads Daily 30D' },
  ]);
  assert.equal(assertGoogleAdsViewFilterPlanSafe(plan), plan);
});

test('fails closed when a managed Google Ads View is missing', () => {
  const plan = {
    ...safePlan(),
    summary: { createViews: 1, updateViews: 0 },
    actions: [{ kind: 'create_view', viewName: '🎬 YouTube Video Assets' }],
  };

  assert.throws(
    () => assertGoogleAdsViewFilterPlanSafe(plan),
    (error) => {
      assert.equal(error.code, 'GOOGLE_ADS_VIEW_FILTER_VIEW_MISSING_NO_CREATE');
      assert.deepEqual(error.details.viewNames, ['🎬 YouTube Video Assets']);
      return true;
    },
  );
});

test('fails closed when Preview contains conflicts', () => {
  const plan = {
    ...safePlan(),
    readyToApply: false,
    conflicts: [{ code: 'VIEW_TYPE_MISMATCH' }],
  };

  assert.throws(
    () => assertGoogleAdsViewFilterPlanSafe(plan),
    (error) => error.code === 'GOOGLE_ADS_VIEW_FILTER_PREVIEW_BLOCKED',
  );
});

test('no-create client preserves reads and permanently blocks createView', async () => {
  const calls = [];
  const source = {
    label: 'live-client',
    async listTables() {
      calls.push(this.label);
      return [{ tableId: 'tbl1', name: 'MKT_Ads_Accounts' }];
    },
    async createView() {
      throw new Error('must never reach source createView');
    },
  };
  const client = createNoCreateLarkViewClient(source);

  assert.deepEqual(await client.listTables(), [{ tableId: 'tbl1', name: 'MKT_Ads_Accounts' }]);
  assert.deepEqual(calls, ['live-client']);
  await assert.rejects(
    client.createView({ tableId: 'tbl1', viewName: 'missing' }),
    (error) => error.code === 'GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN',
  );
});
