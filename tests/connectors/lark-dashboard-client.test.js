import test from 'node:test';
import assert from 'node:assert/strict';
import { LarkDashboardClient } from '../../packages/connectors/src/lark/lark-dashboard.client.js';

test('lists and normalizes Lark native dashboards', async () => {
  const calls = [];
  const client = new LarkDashboardClient({
    client: {
      appToken: 'app-token',
      async requestBitableJson(path, options) {
        calls.push({ path, options });
        return {
          data: {
            dashboards: [{ block_id: 'blk1', name: 'Dashboard One' }],
            has_more: false,
          },
        };
      },
    },
  });

  assert.deepEqual(await client.listDashboards(), [{ blockId: 'blk1', name: 'Dashboard One' }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /\/dashboards\?page_size=500/u);
  assert.equal(calls[0].options.method, 'GET');
});

test('paginates Lark dashboards while has_more is true', async () => {
  const paths = [];
  const client = new LarkDashboardClient({
    client: {
      appToken: 'app-token',
      async requestBitableJson(path) {
        paths.push(path);
        if (path.includes('page_token=next')) {
          return { data: { dashboards: [{ block_id: 'blk2', name: 'Two' }], has_more: false } };
        }
        return {
          data: {
            dashboards: [{ block_id: 'blk1', name: 'One' }],
            has_more: true,
            page_token: 'next',
          },
        };
      },
    },
  });

  const result = await client.listDashboards();
  assert.deepEqual(result.map((item) => item.blockId), ['blk1', 'blk2']);
  assert.equal(paths.length, 2);
});

test('rejects repeated dashboard pagination token', async () => {
  const client = new LarkDashboardClient({
    client: {
      appToken: 'app-token',
      async requestBitableJson() {
        return { data: { dashboards: [], has_more: true, page_token: 'same' } };
      },
    },
  });
  await assert.rejects(client.listDashboards(), /repeated page_token/u);
});
