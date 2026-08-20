import test from 'node:test';
import assert from 'node:assert/strict';
import { LarkBitableClient } from '../../packages/connectors/src/lark/lark-bitable.client.js';

function tenantTokenResponse() {
  return new Response(JSON.stringify({
    code: 0,
    tenant_access_token: 'tenant-token',
    expire: 7200,
  }), { status: 200 });
}

test('retries HTTP 200 Lark 800004135 for idempotent View updates', async () => {
  let updateCalls = 0;
  const delays = [];
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    maxAttempts: 3,
    minRequestIntervalMs: 0,
    retryBaseDelayMs: 10,
    randomImpl: () => 0,
    sleepImpl: async (delay) => delays.push(delay),
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) return tenantTokenResponse();
      updateCalls += 1;
      if (updateCalls === 1) {
        return new Response(JSON.stringify({ code: 800004135, msg: 'Base operation throttled' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        code: 0,
        data: {
          view: {
            view_id: 'vew1',
            view_name: 'Metrics',
            view_type: 'grid',
            property: {},
          },
        },
      }), { status: 200 });
    },
  });

  const view = await client.updateView({
    tableId: 'tbl1',
    viewId: 'vew1',
    viewName: 'Metrics',
  });

  assert.equal(view.viewId, 'vew1');
  assert.equal(updateCalls, 2);
  assert.deepEqual(delays, [10]);
});

test('treats Lark 800004135 as an explicit rate-limit rejection for create retry mode', async () => {
  let createCalls = 0;
  const delays = [];
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    maxAttempts: 3,
    minRequestIntervalMs: 0,
    retryBaseDelayMs: 10,
    randomImpl: () => 0,
    sleepImpl: async (delay) => delays.push(delay),
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) return tenantTokenResponse();
      createCalls += 1;
      if (createCalls === 1) {
        return new Response(JSON.stringify({ code: 800004135, msg: 'Base operation throttled' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        code: 0,
        data: {
          view: {
            view_id: 'vew2',
            view_name: 'New view',
            view_type: 'grid',
            property: {},
          },
        },
      }), { status: 200 });
    },
  });

  const view = await client.createView({
    tableId: 'tbl1',
    viewName: 'New view',
    viewType: 'grid',
  });

  assert.equal(view.viewId, 'vew2');
  assert.equal(createCalls, 2);
  assert.deepEqual(delays, [10]);
});
