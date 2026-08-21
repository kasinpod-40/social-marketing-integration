import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_BASE_DASHBOARD_THEME_CONFIRMATION,
  applyCustomerBaseDashboardThemeParity,
} from '../../scripts/lib/customer-base-dashboard-theme-parity.js';

const DASHBOARDS = [
  ['💬 Customer Service & Leads', 'dsh_1', 10],
  ['🛡️ Data Quality & Operations', 'dsh_2', 6],
  ['📊 Executive Marketing Overview', 'dsh_3', 10],
  ['🌱 Organic Performance', 'dsh_4', 20],
  ['💰 Paid Ads Performance', 'dsh_5', 11],
  ['🛒 Commerce & Conversion', 'dsh_6', 9],
];

function makeClient({ failThemeAt = null } = {}) {
  const calls = [];
  const folderId = 'folder_target';
  const client = {
    appToken: 'target_app_token',
    calls,
    async requestBitableJson(path, options = {}) {
      calls.push({ path, method: options.method ?? 'GET', body: options.body ?? null });
      if (path.endsWith('/blocks/list')) {
        return { data: { blocks: [
          { block_id: folderId, name: 'Setup Phase | Social MKT Data Hub' },
          ...DASHBOARDS.map(([name, id]) => ({ block_id: id, name, parent_id: folderId })),
        ] } };
      }
      if (path.includes('/dashboards?')) {
        return { data: { has_more: false, items: DASHBOARDS.map(([name, id]) => ({ dashboard_id: id, name })) } };
      }
      const blockMatch = path.match(/\/dashboards\/(dsh_\d+)\/blocks\?/u);
      if (blockMatch) {
        const authority = DASHBOARDS.find(([, id]) => id === blockMatch[1]);
        return { data: { has_more: false, items: Array.from({ length: authority[2] }, (_, index) => ({ block_id: `${authority[1]}_blk_${index}`, name: `Block ${index}` })) } };
      }
      const patchMatch = path.match(/\/dashboards\/(dsh_\d+)$/u);
      if (patchMatch && options.method === 'PATCH') {
        const authority = DASHBOARDS.find(([, id]) => id === patchMatch[1]);
        if (failThemeAt === authority[0]) {
          const error = new Error('simulated Lark theme failure');
          error.code = 'LARK_PERMANENT_API_ERROR';
          throw error;
        }
        return { data: { dashboard_id: authority[1], name: authority[0], theme: { theme_style: 'summerBreeze' } } };
      }
      throw new Error(`unexpected request ${options.method ?? 'GET'} ${path}`);
    },
  };
  return client;
}

test('theme preview validates six materialized dashboards and 66 blocks without mutation', async () => {
  const targetClient = makeClient();
  const result = await applyCustomerBaseDashboardThemeParity({ targetClient, mode: 'preview' });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'DASHBOARD_THEME_PREVIEW_READY');
  assert.equal(result.dashboards.length, 6);
  assert.equal(result.dashboards.reduce((sum, item) => sum + item.documentedBlockCount, 0), 66);
  assert.equal(result.dashboardThemeMutationCount, 0);
  assert.equal(targetClient.calls.some((call) => call.method === 'PATCH'), false);
});

test('theme apply patches six dashboards only and verifies response echo', async () => {
  const targetClient = makeClient();
  const result = await applyCustomerBaseDashboardThemeParity({
    targetClient,
    mode: 'apply',
    confirmation: CUSTOMER_BASE_DASHBOARD_THEME_CONFIRMATION,
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'DASHBOARD_THEME_PASS');
  assert.equal(result.dashboardThemeMutationCount, 6);
  assert.equal(result.dashboardBlockMutationCount, 0);
  assert.equal(result.tableMutationCount, 0);
  assert.equal(result.fieldMutationCount, 0);
  assert.equal(result.recordMutationCount, 0);
  assert.equal(targetClient.calls.filter((call) => call.method === 'PATCH').length, 6);

  // POST /blocks/list is the proven read-only topology lookup endpoint. The
  // theme phase must never write to /dashboards/{id}/blocks.
  assert.equal(
    targetClient.calls.some((call) =>
      /\/dashboards\/[^/]+\/blocks(?:\?|$)/u.test(call.path)
      && call.method !== 'GET'),
    false,
  );
});

test('theme apply fails with exact stage and completed ledger while remaining resumable', async () => {
  const targetClient = makeClient({ failThemeAt: '🌱 Organic Performance' });
  await assert.rejects(
    () => applyCustomerBaseDashboardThemeParity({
      targetClient,
      mode: 'apply',
      confirmation: CUSTOMER_BASE_DASHBOARD_THEME_CONFIRMATION,
    }),
    (error) => {
      assert.equal(error.code, 'CUSTOMER_BASE_DASHBOARD_THEME_REQUEST_FAILED');
      assert.equal(error.details.stage, 'patch_dashboard_theme:🌱 Organic Performance');
      assert.deepEqual(error.details.completedDashboards, [
        '💬 Customer Service & Leads',
        '🛡️ Data Quality & Operations',
        '📊 Executive Marketing Overview',
      ]);
      return true;
    },
  );
});
