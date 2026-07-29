import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_NATIVE_DASHBOARDS,
  LARK_NATIVE_DASHBOARD_INVARIANTS,
  validateLarkNativeDashboardContract,
} from '../../packages/config/src/lark-native-dashboard-contract.js';

test('defines exactly six Lark native dashboards and forbids external web dashboards', () => {
  assert.equal(validateLarkNativeDashboardContract(), true);
  assert.equal(LARK_NATIVE_DASHBOARDS.length, 6);
  assert.equal(LARK_NATIVE_DASHBOARD_INVARIANTS.surface, 'lark_base_native_dashboard');
  assert.equal(LARK_NATIVE_DASHBOARD_INVARIANTS.externalWebDashboardAllowed, false);
});

test('does not hardcode platform names into the Lark native dashboard contract', () => {
  const source = JSON.stringify(LARK_NATIVE_DASHBOARDS).toLowerCase();
  for (const platform of ['tiktok', 'facebook', 'instagram', 'youtube', 'google_ads', 'meta_ads']) {
    assert.equal(source.includes(platform), false, `must not hardcode ${platform}`);
  }
});

test('rejects duplicate dashboard names', () => {
  const duplicate = LARK_NATIVE_DASHBOARDS.map((item) => ({ ...item }));
  duplicate[1].name = duplicate[0].name;
  assert.throws(() => validateLarkNativeDashboardContract(duplicate), /unique/);
});
