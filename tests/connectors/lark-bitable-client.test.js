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

test('stops pagination when has_more is false even if Lark returns a page_token', async () => {
  let collectionCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      collectionCalls += 1;
      return new Response(JSON.stringify({
        code: 0,
        data: {
          items: [{ field_id: 'fld1', field_name: 'name', type: 1 }],
          has_more: false,
          page_token: 'stale-token-that-must-be-ignored',
        },
      }), { status: 200 });
    },
  });

  const fields = await client.listFields({ tableId: 'tbl' });
  assert.equal(fields.length, 1);
  assert.equal(collectionCalls, 1);
});

test('paginates fields only while has_more is true and uses the next token once', async () => {
  const collectionUrls = [];
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      collectionUrls.push(String(url));
      const secondPage = String(url).includes('page_token=next-1');
      return new Response(JSON.stringify(secondPage
        ? { code: 0, data: { items: [{ field_id: 'fld2', field_name: 'two', type: 1 }], has_more: false, page_token: 'ignored' } }
        : { code: 0, data: { items: [{ field_id: 'fld1', field_name: 'one', type: 1 }], has_more: true, page_token: 'next-1' } }), { status: 200 });
    },
  });

  const fields = await client.listFields({ tableId: 'tbl' });
  assert.deepEqual(fields.map((field) => field.fieldId), ['fld1', 'fld2']);
  assert.equal(collectionUrls.length, 2);
  assert.equal(collectionUrls[0].includes('page_token='), false);
  assert.equal(collectionUrls[1].includes('page_token=next-1'), true);
});

test('rejects repeated Lark page tokens before issuing an infinite request loop', async () => {
  let collectionCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      collectionCalls += 1;
      return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: true, page_token: 'same-token' } }), { status: 200 });
    },
  });

  await assert.rejects(client.listFields({ tableId: 'tbl' }), /repeated page_token.*same-token/);
  assert.equal(collectionCalls, 2);
});

test('rejects has_more=true without a usable next page token', async () => {
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: true, page_token: '   ' } }), { status: 200 });
    },
  });

  await assert.rejects(client.listFields({ tableId: 'tbl' }), /has_more=true without page_token/);
});

test('applies the shared pagination contract to records', async () => {
  let collectionCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      collectionCalls += 1;
      return new Response(JSON.stringify({
        code: 0,
        data: { items: [{ record_id: 'rec1', fields: { key: 'value' } }], has_more: false, page_token: 'stale' },
      }), { status: 200 });
    },
  });

  assert.deepEqual(await client.listRecords({ tableId: 'tbl' }), [{ recordId: 'rec1', fields: { key: 'value' } }]);
  assert.equal(collectionCalls, 1);
});

test('allows an empty intermediate page when has_more is true and the token advances', async () => {
  let page = 0;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      page += 1;
      if (page === 1) return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: true, page_token: 'next' } }), { status: 200 });
      return new Response(JSON.stringify({ code: 0, data: { items: [{ record_id: 'rec2', fields: {} }], has_more: false } }), { status: 200 });
    },
  });

  const records = await client.listRecords({ tableId: 'tbl' });
  assert.equal(records.length, 1);
  assert.equal(page, 2);
});

test('fails safely when pagination exceeds the configured maximum pages', async () => {
  let collectionCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0, maxPages: 2,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      collectionCalls += 1;
      return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: true, page_token: `next-${collectionCalls}` } }), { status: 200 });
    },
  });

  await assert.rejects(client.listRecords({ tableId: 'tbl' }), /exceeded 2 pages/);
  assert.equal(collectionCalls, 2);
});
