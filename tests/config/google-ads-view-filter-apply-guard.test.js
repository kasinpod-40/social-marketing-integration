import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGoogleAdsViewFilterUpdateOnly } from '../../packages/config/src/google-ads-view-filter-apply-guard.js';

test('accepts zero-drift and update-only Google View plans', () => {
  const zero = { summary: { createViews: 0 }, actions: [] };
  assert.equal(assertGoogleAdsViewFilterUpdateOnly(zero), zero);

  const updates = {
    summary: { createViews: 0 },
    actions: [{ kind: 'update_view', tableKey: 'daily', viewKey: 'googleDaily', viewName: 'Google Ads Daily' }],
  };
  assert.equal(assertGoogleAdsViewFilterUpdateOnly(updates), updates);
});

test('fails closed when a managed Google View is missing and planner proposes create_view', () => {
  assert.throws(
    () => assertGoogleAdsViewFilterUpdateOnly({
      summary: { createViews: 1 },
      actions: [{ kind: 'create_view', tableKey: 'daily', viewKey: 'googleDaily', viewName: 'Google Ads Daily' }],
    }),
    (error) => {
      assert.equal(error.code, 'GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN');
      assert.equal(error.retryable, false);
      assert.equal(error.details.createViews, 1);
      assert.deepEqual(error.details.unexpectedActions, [{
        kind: 'create_view',
        tableKey: 'daily',
        viewKey: 'googleDaily',
        viewName: 'Google Ads Daily',
      }]);
      return true;
    },
  );
});

test('fails closed on any non-update action even when summary is inconsistent', () => {
  assert.throws(
    () => assertGoogleAdsViewFilterUpdateOnly({
      summary: { createViews: 0 },
      actions: [{ kind: 'delete_view', tableKey: 'daily', viewName: 'unexpected' }],
    }),
    (error) => error.code === 'GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN',
  );
});
