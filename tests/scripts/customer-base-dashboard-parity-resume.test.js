import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_CONFIRMATION,
  applyCustomerBaseDashboardParity,
} from '../../scripts/lib/customer-base-dashboard-parity.js';

const DASHBOARD_NAME = '💬 Customer Service & Leads';
const FOLDER_NAME = 'Setup Phase | Social MKT Data Hub';

function makePlan() {
  return {
    contractVersion: 'customer_base_dashboard_documented_api_parity_v1',
    themeStyle: 'summerBreeze',
    dashboards: [{
      name: DASHBOARD_NAME,
      blocks: [{
        name: '💬 New Conversations',
        supportedByDocumentedApi: true,
        sourceKind: 'statistics',
        type: 'statistics',
        dataConfig: {
          table_name: '📊 MKT_Report_Metric_Values',
          series: [{ field_name: 'current_value', rollup: 'SUM' }],
        },
        position: { x: 0, y: 3, w: 4, h: 2 },
      }],
    }],
    summary: {
      documentedApiBlockCount: 1,
      unsupportedByKind: {},
    },
  };
}

function makeTarget({ failCreateBlock = false } = {}) {
  const calls = [];
  const blocks = [];
  const targetClient = {
    appToken: 'target_app_token',
    async listTables() {
      return [];
    },
    async requestBitableJson(path, options = {}) {
      const method = options.method ?? 'GET';
      calls.push({ method, path, body: options.body ?? null });

      if (method === 'PATCH') {
        throw new Error('Deep Dashboard PATCH must not run during resumable materialization');
      }
      if (method === 'GET' && /\/dashboards\/dash1$/u.test(path)) {
        throw new Error('Deep Dashboard GET must not run during resumable materialization');
      }
      if (method === 'GET' && /\/dashboards\/dash1\/blocks\/[^?]+$/u.test(path)) {
        throw new Error('Deep Dashboard block GET must not run during resumable materialization');
      }

      if (method === 'POST' && path.endsWith('/blocks/list')) {
        return {
          data: {
            blocks: [
              { id: 'folder1', name: FOLDER_NAME, type: 'folder', parent_id: '' },
              { id: 'dash1', name: DASHBOARD_NAME, type: 'dashboard', parent_id: 'folder1' },
            ],
          },
        };
      }

      if (method === 'GET' && /\/dashboards\?page_size=100$/u.test(path)) {
        return {
          data: {
            items: [{ dashboard_id: 'dash1', name: DASHBOARD_NAME }],
            has_more: false,
          },
        };
      }

      if (method === 'GET' && /\/dashboards\/dash1\/blocks\?page_size=100$/u.test(path)) {
        return { data: { items: structuredClone(blocks), has_more: false } };
      }

      if (method === 'POST' && /\/dashboards\/dash1\/blocks$/u.test(path)) {
        if (failCreateBlock) {
          const error = new Error('Lark API error 1');
          error.code = 'LARK_PERMANENT_API_ERROR';
          error.details = { status: 200, larkCode: 1, retryAfter: null };
          throw error;
        }
        blocks.push({
          block_id: 'block1',
          name: options.body.name,
          type: options.body.type,
          data_config: structuredClone(options.body.data_config),
          position: structuredClone(options.body.position),
        });
        return { data: { block_id: 'block1' } };
      }

      if (method === 'POST' && /\/bases\/target_app_token\/blocks$/u.test(path)) {
        throw new Error('Existing recovery Dashboard must not be created again');
      }

      throw new Error(`Unexpected request ${method} ${path}`);
    },
  };
  return { targetClient, calls, blocks };
}

test('resumes an already-created Dashboard and materializes only missing blocks through list/create/list', async () => {
  const { targetClient, calls, blocks } = makeTarget();
  const result = await applyCustomerBaseDashboardParity({
    plan: makePlan(),
    targetClient,
    mode: 'apply',
    confirmation: CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_CONFIRMATION,
    folderName: FOLDER_NAME,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'DASHBOARD_DOCUMENTED_API_BLOCKS_PASS');
  assert.equal(result.dashboardMutationCount, 0);
  assert.equal(result.dashboardBlockMutationCount, 1);
  assert.equal(result.summary.documentedApiMismatchCount, 0);
  assert.equal(result.summary.themeDeferredCount, 1);
  assert.equal(result.dashboards[0].resumedExistingDashboard, true);
  assert.equal(result.dashboards[0].existingBlockCountAtStart, 0);
  assert.equal(blocks.length, 1);

  assert.equal(
    calls.some(({ method, path }) => method === 'POST' && /\/bases\/target_app_token\/blocks$/u.test(path)),
    false,
  );
  assert.equal(calls.some(({ method }) => method === 'PATCH'), false);
  assert.equal(calls.some(({ method, path }) => method === 'GET' && /\/dashboards\/dash1$/u.test(path)), false);
  assert.equal(calls.some(({ method, path }) => method === 'GET' && /\/dashboards\/dash1\/blocks\/[^?]+$/u.test(path)), false);
});

test('preview recognizes partial recovery state without mutation and reports missing blocks as remaining work', async () => {
  const { targetClient, calls } = makeTarget();
  const result = await applyCustomerBaseDashboardParity({
    plan: makePlan(),
    targetClient,
    mode: 'preview',
    folderName: FOLDER_NAME,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'DASHBOARD_DOCUMENTED_API_PREVIEW_READY');
  assert.equal(result.summary.documentedApiMismatchCount, 1);
  assert.equal(result.dashboardMutationCount, 0);
  assert.equal(result.dashboardBlockMutationCount, 0);
  assert.equal(result.dashboards[0].resumedExistingDashboard, true);
  assert.equal(calls.some(({ method }) => method === 'PATCH'), false);
});

test('annotates exact failing Dashboard API stage instead of returning an opaque Lark code', async () => {
  const { targetClient } = makeTarget({ failCreateBlock: true });
  await assert.rejects(
    () => applyCustomerBaseDashboardParity({
      plan: makePlan(),
      targetClient,
      mode: 'apply',
      confirmation: CUSTOMER_BASE_DASHBOARD_DOCUMENTED_API_CONFIRMATION,
      folderName: FOLDER_NAME,
    }),
    (error) => {
      assert.equal(error.code, 'CUSTOMER_BASE_DASHBOARD_API_STAGE_FAILED');
      assert.equal(error.details.stage, `create_dashboard_block:${DASHBOARD_NAME}:💬 New Conversations`);
      assert.equal(error.details.causeCode, 'LARK_PERMANENT_API_ERROR');
      assert.equal(error.details.status, 200);
      assert.equal(error.details.larkCode, 1);
      return true;
    },
  );
});
