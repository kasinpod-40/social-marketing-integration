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
