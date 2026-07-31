import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_DASHBOARD_RECOVERY_SCOPE_CONFIRMATION,
  REQUIRED_LARK_DASHBOARD_RECOVERY_SCOPES,
  assertDashboardRecoveryScopeConfirmation,
  buildFullDashboardBlockUpdateBody,
  classifyDashboardBlockMutation,
} from '../../scripts/lib/lark-dashboard-canonical-rebind-recovery-v2.js';

test('sends the complete rewritten data_config rather than only changed top-level keys', () => {
  const complete = {
    table_name: '📊 MKT_Report_Metric_Values',
    series: [{ field_name: 'current_value', rollup: 'SUM' }],
    group_by: [{ field_name: 'window_days', mode: 'integrated' }],
    filter: {
      conjunction: 'and',
      conditions: [{
        field_name: 'metric_key',
        operator: 'is',
        value: 'tiktok:latest_total_views',
      }],
    },
  };

  const body = buildFullDashboardBlockUpdateBody(complete);
  assert.deepEqual(body, { data_config: complete });
  assert.notEqual(body.data_config, complete);
  assert.equal(body.data_config.table_name, complete.table_name);
  assert.deepEqual(body.data_config.series, complete.series);
  assert.deepEqual(body.data_config.group_by, complete.group_by);
  assert.deepEqual(body.data_config.filter, complete.filter);
});

test('classifies post-PATCH readback for safe resume', () => {
  const before = { series: [{ field_name: 'current_value' }], filter: { conditions: [] } };
  const target = {
    series: [{ field_name: 'current_value' }],
    filter: { conditions: [{ field_name: 'metric_key', value: 'tiktok:period_views' }] },
  };

  assert.equal(classifyDashboardBlockMutation({ before, target, after: target }), 'target_converged');
  assert.equal(classifyDashboardBlockMutation({ before, target, after: before }), 'rejected_unchanged');
  assert.equal(
    classifyDashboardBlockMutation({
      before,
      target,
      after: { series: [], filter: target.filter },
    }),
    'state_drift',
  );
});

test('requires block update in addition to dashboard and field scopes', () => {
  assert.deepEqual(REQUIRED_LARK_DASHBOARD_RECOVERY_SCOPES, [
    'base:dashboard:read',
    'base:dashboard:update',
    'base:block:update',
    'base:field:delete',
  ]);
  assert.equal(
    assertDashboardRecoveryScopeConfirmation(LARK_DASHBOARD_RECOVERY_SCOPE_CONFIRMATION),
    true,
  );
  assert.throws(
    () => assertDashboardRecoveryScopeConfirmation('I_ENABLED_ONLY_DASHBOARD_UPDATE'),
    { code: 'LARK_DASHBOARD_RECOVERY_SCOPE_CONFIRMATION_REQUIRED' },
  );
});
