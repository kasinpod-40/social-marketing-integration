import test from 'node:test';
import assert from 'node:assert/strict';
import { LarkBitableClient } from '../../packages/connectors/src/lark/lark-bitable.client.js';

test('retries Lark 1254290 with backoff and then succeeds', async () => {
  let calls = 0;
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
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ code: 1254290, msg: 'TooManyRequest' }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 });
    },
  });

  const result = await client.requestJson('/test', { method: 'GET', token: 'token' });
  assert.equal(result.code, 0);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [10]);
});

test('caches and shares the tenant access token request', async () => {
  let calls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    minRequestIntervalMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 7200,
      }), { status: 200 });
    },
  });

  const [first, second] = await Promise.all([
    client.getTenantAccessToken(),
    client.getTenantAccessToken(),
  ]);
  const third = await client.getTenantAccessToken();

  assert.equal(first, 'tenant-token');
  assert.equal(second, 'tenant-token');
  assert.equal(third, 'tenant-token');
  assert.equal(calls, 1);
});

test('lists and normalizes Lark table field metadata', async () => {
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({
        code: 0,
        data: { items: [{ field_id: 'fld1', field_name: 'content_url', type: 15, property: {} }] },
      }), { status: 200 });
    },
  });
  assert.deepEqual(await client.listFields({ tableId: 'tbl' }), [{
    fieldId: 'fld1', fieldName: 'content_url', type: 15, property: {},
  }]);
});


test('aborts a stalled Lark request after the configured timeout', async () => {
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    maxAttempts: 1,
    minRequestIntervalMs: 0,
    requestTimeoutMs: 10,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });

  await assert.rejects(
    client.requestJson('/stalled', { method: 'GET', token: 'token' }),
    /Lark request timed out after 10ms: \/stalled/,
  );
});


test('request tracing masks app token and reports completion', async () => {
  const events = [];
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'sensitive-app-token',
    minRequestIntervalMs: 0,
    onRequest: (event) => events.push(event),
    fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 }),
  });
  await client.requestJson('/open-apis/bitable/v1/apps/sensitive-app-token/tables/tbl/records', { method: 'GET', token: 'tenant' });
  assert.equal(events.some((event) => String(event.path).includes('sensitive-app-token')), false);
  assert.equal(events.some((event) => event.stage === 'lark_request_success'), true);
});
