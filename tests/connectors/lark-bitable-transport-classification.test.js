import test from 'node:test';
import assert from 'node:assert/strict';
import { LarkBitableClient } from '../../packages/connectors/src/lark/lark-bitable.client.js';

const SEARCH_PATH = '/open-apis/bitable/v1/apps/sensitive-app-token/tables/tbl_daily/records/search?page_size=500';

test('retries a plain Error thrown by the Lark fetch transport as LARK_NETWORK_ERROR', async () => {
  let calls = 0;
  const delays = [];
  const events = [];
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'sensitive-app-token',
    maxAttempts: 2,
    minRequestIntervalMs: 0,
    retryBaseDelayMs: 5,
    randomImpl: () => 0,
    sleepImpl: async (delay) => delays.push(delay),
    onRequest: (event) => events.push(event),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error('Cloudflare transport disconnected');
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), { status: 200 });
    },
  });

  const result = await client.requestJson(SEARCH_PATH, {
    method: 'POST',
    token: 'tenant-token',
    body: { filter: { conjunction: 'or', conditions: [] } },
  });

  assert.equal(result.code, 0);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [5]);
  const retry = events.find((event) => event.stage === 'lark_request_retry');
  assert.ok(retry);
  assert.match(retry.error, /Lark network request failed/);
  assert.match(retry.error, /\/apps\/\*\*\*\/tables\/tbl_daily/);
  assert.equal(retry.error.includes('sensitive-app-token'), false);
});

test('classifies a plain Error while reading the response body as retryable network failure', async () => {
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'sensitive-app-token',
    maxAttempts: 1,
    minRequestIntervalMs: 0,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      async text() {
        throw new Error('response body stream disconnected');
      },
    }),
  });

  await assert.rejects(
    client.requestJson(SEARCH_PATH, {
      method: 'POST',
      token: 'tenant-token',
      body: { filter: { conjunction: 'or', conditions: [] } },
    }),
    (error) => error.code === 'LARK_NETWORK_ERROR'
      && error.retryable === true
      && !error.message.includes('sensitive-app-token'),
  );
});

test('keeps request body serialization failures permanent and never starts fetch', async () => {
  let fetchCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'sensitive-app-token',
    maxAttempts: 3,
    minRequestIntervalMs: 0,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    },
  });

  await assert.rejects(
    client.requestJson(SEARCH_PATH, {
      method: 'POST',
      token: 'tenant-token',
      body: { unsupported: 1n },
    }),
    (error) => error.code === 'LARK_REQUEST_SERIALIZATION_ERROR'
      && error.retryable === false
      && !error.message.includes('sensitive-app-token'),
  );

  assert.equal(fetchCalls, 0);
});
