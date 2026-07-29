import test from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_REPORT_BLUEPRINT } from '../../packages/config/src/dashboard-report-blueprint.js';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';

test('Dashboard blueprint binds materialized Lark tables and uses dynamic platform discovery', () => {
  assert.deepEqual(DASHBOARD_REPORT_BLUEPRINT.rollingPresetDays, [3, 7, 9, 15, 30, 90]);
  assert.equal(DASHBOARD_REPORT_BLUEPRINT.sourceOfTruth, 'd1_report_materializations');
  assert.equal(DASHBOARD_REPORT_BLUEPRINT.platformAuthority, 'report_platform_adapter_registry');
  assert.equal(DASHBOARD_REPORT_BLUEPRINT.platformDiscovery, 'validated_materializations');
  assert.equal(DASHBOARD_REPORT_BLUEPRINT.universalRenderer.platformSpecificCodeAllowed, false);
  assert.equal(Object.hasOwn(DASHBOARD_REPORT_BLUEPRINT, 'platformScopes'), false);
  assert.equal(DASHBOARD_REPORT_BLUEPRINT.larkTables.topAds, 'mktReportTopAds');
  assert.equal(LARK_TABLE_ENV.mktReportTopAds, 'LARK_TABLE_MKT_REPORT_TOP_ADS');
  assert.equal(JSON.stringify(DASHBOARD_REPORT_BLUEPRINT).includes('ads_daily_facts'), false);
});
