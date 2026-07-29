import test from 'node:test';
import assert from 'node:assert/strict';
import { LARK_NATIVE_DASHBOARDS } from '../../packages/config/src/lark-native-dashboard-contract.js';
import { auditLarkNativeDashboards } from '../../packages/application/src/use-cases/audit-lark-native-dashboards.js';

test('reports all six dashboards missing without mutating Lark', async () => {
  let calls = 0;
  const result = await auditLarkNativeDashboards({
    client: { async listDashboards() { calls += 1; return []; } },
  });
  assert.equal(calls, 1);
  assert.equal(result.complete, false);
  assert.equal(result.readyForManualBuild, true);
  assert.equal(result.summary.missingDashboards, 6);
  assert.equal(result.manualActions.length, 6);
  assert.equal(result.apiBoundary.chartLayoutMutationSupported, false);
});

test('passes identity audit when all expected dashboards exist', async () => {
  const live = LARK_NATIVE_DASHBOARDS.map((dashboard, index) => ({
    blockId: `blk${index + 1}`,
    name: dashboard.name,
  }));
  const result = await auditLarkNativeDashboards({
    client: { async listDashboards() { return live; } },
  });
  assert.equal(result.complete, true);
  assert.equal(result.summary.presentDashboards, 6);
  assert.equal(result.summary.missingDashboards, 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.manualActions.length, 6);
});

test('fails closed on duplicate managed dashboard names and preserves unmanaged dashboards', async () => {
  const expected = LARK_NATIVE_DASHBOARDS[0];
  const result = await auditLarkNativeDashboards({
    client: {
      async listDashboards() {
        return [
          { blockId: 'blk1', name: expected.name },
          { blockId: 'blk2', name: expected.name },
          { blockId: 'blk3', name: 'Historical Dashboard' },
        ];
      },
    },
  });
  assert.equal(result.readyForManualBuild, false);
  assert.equal(result.conflicts[0].code, 'LARK_NATIVE_DASHBOARD_DUPLICATE_NAME');
  assert.deepEqual(result.unmanaged, [{ blockId: 'blk3', name: 'Historical Dashboard' }]);
});
