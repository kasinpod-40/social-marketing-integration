import test from 'node:test';
import assert from 'node:assert/strict';
import { LarkBitableClient } from '../../packages/connectors/src/lark/lark-bitable.client.js';
import { transientError } from '../../packages/shared/src/errors/runtime-error.js';

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

test('preserves the Cloudflare global fetch context instead of binding it to the client instance', async () => {
  const originalFetch = globalThis.fetch;
  let observedThis = null;

  try {
    globalThis.fetch = async function runtimeFetch() {
      observedThis = this;
      return new Response(JSON.stringify({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 7200,
      }), { status: 200 });
    };

    const client = new LarkBitableClient({
      appId: 'app-id',
      appSecret: 'app-secret',
      appToken: 'app-token',
      minRequestIntervalMs: 0,
    });

    assert.equal(await client.getTenantAccessToken(), 'tenant-token');
    assert.equal(observedThis, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
        data: {
          items: [{
            field_id: 'fld1', field_name: 'content_url', type: 15,
            description: { text: 'ลิงก์เนื้อหา' }, property: {},
          }],
        },
      }), { status: 200 });
    },
  });
  assert.deepEqual(await client.listFields({ tableId: 'tbl' }), [{
    fieldId: 'fld1', fieldName: 'content_url', type: 15, uiType: null,
    description: 'ลิงก์เนื้อหา', isPrimary: false, property: null,
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

  assert.deepEqual(await client.listRecords({ tableId: 'tbl' }), [{
    recordId: 'rec1',
    fields: { key: 'value' },
    createdTime: null,
    lastModifiedTime: null,
    lastModifiedBy: null,
  }]);
  assert.equal(collectionCalls, 1);
});

test('requests and normalizes record modification metadata for incremental checkpoints', async () => {
  let recordsUrl = null;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      recordsUrl = String(url);
      return new Response(JSON.stringify({
        code: 0,
        data: {
          items: [{
            record_id: 'rec1', fields: {}, created_time: '1783530467',
            last_modified_time: '1783786062', last_modified_by: { id: 'user-1' },
          }],
          has_more: false,
        },
      }), { status: 200 });
    },
  });

  const [record] = await client.listRecords({ tableId: 'tbl' });
  assert.match(recordsUrl, /last_modified_time=true/);
  assert.equal(record.createdTime, 1_783_530_467_000);
  assert.equal(record.lastModifiedTime, 1_783_786_062_000);
  assert.deepEqual(record.lastModifiedBy, { id: 'user-1' });
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

test('searches existing records by stable-key values instead of scanning the full table', async () => {
  const requests = [];
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        code: 0,
        data: { items: [{ record_id: 'rec1', fields: { content_key: 'key-1' } }], has_more: false },
      }), { status: 200 });
    },
  });

  const records = await client.searchRecordsByFieldValues({
    tableId: 'tbl',
    fieldName: 'content_key',
    values: ['key-1', 'key-2'],
  });

  assert.equal(records.length, 1);
  assert.match(requests[0].url, /records\/search/);
  assert.deepEqual(requests[0].body.filter, {
    conjunction: 'or',
    conditions: [
      { field_name: 'content_key', operator: 'is', value: ['key-1'] },
      { field_name: 'content_key', operator: 'is', value: ['key-2'] },
    ],
  });
});

test('does not retry ambiguous batch-create network failures inside the same request', async () => {
  let createCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    maxAttempts: 3,
    minRequestIntervalMs: 0,
    sleepImpl: async () => undefined,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      createCalls += 1;
      throw new TypeError('socket disconnected after request body was sent');
    },
  });

  await assert.rejects(
    client.batchCreateRecords({ tableId: 'tbl', records: [{ content_key: 'key-1' }] }),
    /Lark network request failed/,
  );
  assert.equal(createCalls, 1);
});

test('still retries explicit Lark rate limits for batch create', async () => {
  let createCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    maxAttempts: 3,
    minRequestIntervalMs: 0,
    retryBaseDelayMs: 1,
    randomImpl: () => 0,
    sleepImpl: async () => undefined,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      createCalls += 1;
      if (createCalls === 1) {
        return new Response(JSON.stringify({ code: 1254290, msg: 'TooManyRequest' }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0, data: { records: [{ record_id: 'rec1' }] } }), { status: 200 });
    },
  });

  assert.deepEqual(
    await client.batchCreateRecords({ tableId: 'tbl', records: [{ content_key: 'key-1' }] }),
    { created: 1 },
  );
  assert.equal(createCalls, 2);
});

test('does not retry invalid JSON from a permanent 400 response', async () => {
  let calls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token',
    maxAttempts: 3, minRequestIntervalMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response('<html>bad request</html>', { status: 400 });
    },
  });

  await assert.rejects(client.requestJson('/bad-json', { method: 'GET' }), /invalid JSON/);
  assert.equal(calls, 1);
});

test('timeout also aborts a stalled response body after headers were received', async () => {
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    maxAttempts: 1,
    minRequestIntervalMs: 0,
    requestTimeoutMs: 10,
    fetchImpl: async (_url, options) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('body aborted')), { once: true });
      }),
    }),
  });

  await assert.rejects(
    client.requestJson('/stalled-body', { method: 'GET', token: 'token' }),
    /Lark request timed out after 10ms: \/stalled-body/,
  );
});

test('never exposes the Lark app token in timeout or network error messages', async () => {
  const secretAppToken = 'bascn_secret_token_value';
  const timeoutClient = new LarkBitableClient({
    appId: 'app_id',
    appSecret: 'app_secret',
    appToken: secretAppToken,
    requestTimeoutMs: 5,
    maxAttempts: 1,
    minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('/tenant_access_token/internal')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }));
      }
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    },
  });

  await assert.rejects(
    () => timeoutClient.listFields({ tableId: 'tbl_fields' }),
    (error) => !error.message.includes(secretAppToken) && error.message.includes('/apps/***/tables/'),
  );

  const networkClient = new LarkBitableClient({
    appId: 'app_id',
    appSecret: 'app_secret',
    appToken: secretAppToken,
    maxAttempts: 1,
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('/tenant_access_token/internal')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }));
      }
      throw new TypeError(`network failed for ${url}`);
    },
  });

  await assert.rejects(
    () => networkClient.listFields({ tableId: 'tbl_fields' }),
    (error) => !error.message.includes(secretAppToken) && error.message.includes('/apps/***/tables/'),
  );
});

test('caps oversized remote API error messages before they reach logs', async () => {
  const client = new LarkBitableClient({
    appId: 'app_id',
    appSecret: 'app_secret',
    appToken: 'app_token',
    maxAttempts: 1,
    minRequestIntervalMs: 0,
    fetchImpl: async () => new Response(JSON.stringify({ code: 123, msg: 'x'.repeat(5000) }), { status: 400 }),
  });

  await assert.rejects(
    () => client.getTenantAccessToken(),
    (error) => error.message.length < 600,
  );
});

test('rejects page sizes and filter chunks above the documented client safety limits', async () => {
  assert.throws(
    () => new LarkBitableClient({
      appId: 'app_id', appSecret: 'app_secret', appToken: 'app_token', maxFilterConditions: 51,
    }),
    /maxFilterConditions <= 50/,
  );

  const client = new LarkBitableClient({
    appId: 'app_id',
    appSecret: 'app_secret',
    appToken: 'app_token',
    minRequestIntervalMs: 0,
    fetchImpl: async () => new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 })),
  });

  await assert.rejects(
    () => client.listRecords({ tableId: 'tbl_records', pageSize: 501 }),
    /pageSize <= 500/,
  );
});

test('refreshes an invalid cached tenant token once and retries the Bitable request', async () => {
  let tokenCalls = 0;
  let bitableCalls = 0;
  const authorizationHeaders = [];
  const events = [];
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    maxAttempts: 1,
    minRequestIntervalMs: 0,
    onRequest: (event) => events.push(event),
    fetchImpl: async (url, options) => {
      if (String(url).includes('/tenant_access_token/internal')) {
        tokenCalls += 1;
        return new Response(JSON.stringify({
          code: 0,
          tenant_access_token: `tenant-token-${tokenCalls}`,
          expire: 7200,
        }), { status: 200 });
      }

      bitableCalls += 1;
      authorizationHeaders.push(options.headers.get('Authorization'));
      if (authorizationHeaders.at(-1) === 'Bearer tenant-token-1') {
        return new Response(JSON.stringify({ code: 99991663, msg: 'tenant access token invalid' }), { status: 200 });
      }

      return new Response(JSON.stringify({
        code: 0,
        data: { items: [{ field_id: 'fld1', field_name: 'name', type: 1 }], has_more: false },
      }), { status: 200 });
    },
  });

  const fields = await client.listFields({ tableId: 'tbl_fields' });

  assert.equal(fields.length, 1);
  assert.equal(tokenCalls, 2);
  assert.equal(bitableCalls, 2);
  assert.deepEqual(authorizationHeaders, ['Bearer tenant-token-1', 'Bearer tenant-token-2']);
  assert.equal(events.filter((event) => event.stage === 'lark_token_invalidated').length, 1);
});

test('does not loop forever when the refreshed tenant token is also rejected', async () => {
  let tokenCalls = 0;
  let bitableCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    maxAttempts: 1,
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('/tenant_access_token/internal')) {
        tokenCalls += 1;
        return new Response(JSON.stringify({
          code: 0,
          tenant_access_token: `tenant-token-${tokenCalls}`,
          expire: 7200,
        }), { status: 200 });
      }

      bitableCalls += 1;
      return new Response(JSON.stringify({ code: 99991663, msg: 'tenant access token invalid' }), { status: 200 });
    },
  });

  await assert.rejects(
    () => client.listFields({ tableId: 'tbl_fields' }),
    (error) => error.details?.larkCode === 99991663,
  );
  assert.equal(tokenCalls, 2);
  assert.equal(bitableCalls, 2);
});

test('shares one refreshed tenant token across concurrent Bitable requests', async () => {
  let tokenCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    maxAttempts: 1,
    minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('/tenant_access_token/internal')) {
        tokenCalls += 1;
        return new Response(JSON.stringify({
          code: 0,
          tenant_access_token: `tenant-token-${tokenCalls}`,
          expire: 7200,
        }), { status: 200 });
      }

      if (options.headers.get('Authorization') === 'Bearer tenant-token-1') {
        return new Response(JSON.stringify({ code: 99991663, msg: 'tenant access token invalid' }), { status: 200 });
      }

      if (String(url).includes('/fields?')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { items: [{ field_id: 'fld1', field_name: 'name', type: 1 }], has_more: false },
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        code: 0,
        data: { items: [{ record_id: 'rec1', fields: { key: 'value' } }], has_more: false },
      }), { status: 200 });
    },
  });

  await client.getTenantAccessToken();
  const [fields, records] = await Promise.all([
    client.listFields({ tableId: 'tbl_fields' }),
    client.listRecords({ tableId: 'tbl_records' }),
  ]);

  assert.equal(fields.length, 1);
  assert.equal(records.length, 1);
  assert.equal(tokenCalls, 2);
});

test('reports confirmed progress when a later create chunk fails', async () => {
  let batchCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    maxAttempts: 1,
    minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      batchCalls += 1;
      if (batchCalls === 1) {
        return new Response(JSON.stringify({
          code: 0,
          data: { records: Array.from({ length: 100 }, (_, index) => ({ record_id: `rec-${index}` })) },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 999999, msg: 'server failed after first chunk' }), { status: 500 });
    },
  });

  await assert.rejects(
    () => client.batchCreateRecords({
      tableId: 'tbl_items',
      records: Array.from({ length: 101 }, (_, index) => ({ key: `key-${index}` })),
    }),
    (error) => {
      assert.equal(error.code, 'LARK_BATCH_PARTIAL_WRITE');
      assert.equal(error.writeProgress.writeOutcome, 'partial');
      assert.equal(error.writeProgress.confirmedRows, 100);
      assert.equal(error.writeProgress.completedChunks, 1);
      assert.equal(error.writeProgress.failedChunk, 2);
      assert.equal(error.writeProgress.totalChunks, 2);
      assert.equal(error.writeProgress.remainingRows, 1);
      return true;
    },
  );
});


test('exhausted Lark 1254290 remains an explicit rate-limit error instead of unknown write', async () => {
  let createCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token',
    maxAttempts: 2, minRequestIntervalMs: 0, retryBaseDelayMs: 1,
    randomImpl: () => 0, sleepImpl: async () => undefined,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      createCalls += 1;
      return new Response(JSON.stringify({ code: 1254290, msg: 'TooManyRequest' }), { status: 200 });
    },
  });

  await assert.rejects(
    () => client.batchCreateRecords({ tableId: 'tbl', records: [{ content_key: 'key-1' }] }),
    (error) => error.code === 'LARK_TRANSIENT_API_ERROR'
      && error.details.larkCode === 1254290
      && error.code !== 'LARK_BATCH_WRITE_UNKNOWN',
  );
  assert.equal(createCalls, 2);
});

test('beforeChunk failure after a confirmed create chunk preserves partial progress', async () => {
  let createCalls = 0;
  let guardCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token',
    maxAttempts: 1, minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      createCalls += 1;
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({
        code: 0,
        data: { records: body.records.map((_, index) => ({ record_id: `rec-${index}` })) },
      }), { status: 200 });
    },
  });
  const records = Array.from({ length: 101 }, (_, index) => ({ content_key: `key-${index}` }));

  await assert.rejects(
    () => client.batchCreateRecords({
      tableId: 'tbl',
      records,
      beforeChunk: async () => {
        guardCalls += 1;
        if (guardCalls === 2) {
          throw transientError('lease expired before second chunk', {
            code: 'SYNC_LOCK_LEASE_EXPIRED',
          });
        }
      },
    }),
    (error) => error.code === 'LARK_BATCH_PARTIAL_WRITE'
      && error.writeProgress.confirmedRows === 100
      && error.writeProgress.completedChunks === 1
      && error.details.currentChunkMayHaveWritten === false
      && error.details.causeCode === 'SYNC_LOCK_LEASE_EXPIRED',
  );
  assert.equal(createCalls, 1);
  assert.equal(guardCalls, 2);
});

test('beforeChunk failure after a confirmed update chunk preserves partial progress', async () => {
  let updateCalls = 0;
  let guardCalls = 0;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token',
    maxAttempts: 1, minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      updateCalls += 1;
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({
        code: 0,
        data: { records: body.records.map((row) => ({ record_id: row.record_id })) },
      }), { status: 200 });
    },
  });
  const records = Array.from({ length: 101 }, (_, index) => ({
    recordId: `rec-${index}`,
    fields: { content_key: `key-${index}` },
  }));

  await assert.rejects(
    () => client.batchUpdateRecords({
      tableId: 'tbl',
      records,
      beforeChunk: async () => {
        guardCalls += 1;
        if (guardCalls === 2) {
          throw transientError('lease expired before second chunk', {
            code: 'SYNC_LOCK_LEASE_EXPIRED',
          });
        }
      },
    }),
    (error) => error.code === 'LARK_BATCH_PARTIAL_WRITE'
      && error.writeProgress.confirmedRows === 100
      && error.details.currentChunkMayHaveWritten === false,
  );
  assert.equal(updateCalls, 1);
  assert.equal(guardCalls, 2);
});

test('batch delete sends exact record IDs in bounded chunks and confirms the count', async () => {
  const requests = [];
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      const body = JSON.parse(options.body);
      requests.push(body.records);
      return new Response(JSON.stringify({
        code: 0,
        data: { records: body.records.map((recordId) => ({ record_id: recordId })) },
      }), { status: 200 });
    },
  });
  const result = await client.batchDeleteRecords({
    tableId: 'tbl',
    recordIds: Array.from({ length: 101 }, (_, index) => `rec-${index}`),
  });
  assert.equal(result.deleted, 101);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].length, 100);
  assert.deepEqual(requests[1], ['rec-100']);
});

test('lists and normalizes tables in the configured Base', async () => {
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({
        code: 0,
        data: { items: [{ table_id: 'tbl1', name: 'MKT_Table', revision: 7 }], has_more: false },
      }), { status: 200 });
    },
  });
  assert.deepEqual(await client.listTables(), [{ tableId: 'tbl1', name: 'MKT_Table', revision: 7 }]);
});

test('renames a table through the official Base v3 PATCH contract while preserving table ID', async () => {
  let request = null;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      request = { url: String(url), options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        code: 0,
        data: { table: { id: 'tblReuse', name: 'RAW_Ads_Entities', rev: 8 } },
      }), { status: 200 });
    },
  });

  const result = await client.renameTable({ tableId: 'tblReuse', name: 'RAW_Ads_Entities' });
  assert.deepEqual(result, { tableId: 'tblReuse', name: 'RAW_Ads_Entities', revision: 8 });
  assert.match(request.url, /\/open-apis\/base\/v3\/bases\/app-token\/tables\/tblReuse$/u);
  assert.equal(request.options.method, 'PATCH');
  assert.deepEqual(request.body, { name: 'RAW_Ads_Entities' });
});

test('creates a table with the primary field first and returns its table ID', async () => {
  let request = null;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      request = { url: String(url), options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ code: 0, data: { table_id: 'tblNew', default_view_id: 'vew1', field_id_list: ['fld1', 'fld2'] } }), { status: 200 });
    },
  });
  const result = await client.createTable({
    name: 'New Table',
    defaultViewName: 'All',
    fields: [
      { fieldName: 'key', type: 1, uiType: 'Text' },
      { fieldName: 'enabled', type: 7, uiType: 'Checkbox', property: { styleId: '0' } },
    ],
  });
  assert.equal(result.tableId, 'tblNew');
  assert.match(request.url, /\/apps\/app-token\/tables$/);
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(request.body, {
    table: {
      name: 'New Table',
      default_view_name: 'All',
      fields: [
        { field_name: 'key', type: 1, ui_type: 'Text' },
        { field_name: 'enabled', type: 7, ui_type: 'Checkbox' },
      ],
    },
  });
});

test('omits property for Checkbox fields even when UI metadata contains styleId', async () => {
  const requests = [];
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      requests.push({ method: options.method, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        code: 0,
        data: { field: { field_id: 'fldCheck', field_name: 'enabled', type: 7, property: null } },
      }), { status: 200 });
    },
  });
  const checkbox = {
    fieldName: 'enabled', type: 7, uiType: 'Checkbox', property: { styleId: '0' },
  };
  await client.createField({ tableId: 'tbl1', field: checkbox });
  await client.updateField({ tableId: 'tbl1', fieldId: 'fldCheck', field: checkbox });
  assert.deepEqual(requests.map((request) => request.body), [
    { field_name: 'enabled', type: 7, ui_type: 'Checkbox' },
    { field_name: 'enabled', type: 7, ui_type: 'Checkbox' },
  ]);
});

test('creates and updates fields with the official field mutation shape', async () => {
  const requests = [];
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      requests.push({ url: String(url), method: options.method, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        code: 0,
        data: { field: { field_id: 'fld1', field_name: 'status', type: 3, is_primary: false, property: { options: [] } } },
      }), { status: 200 });
    },
  });
  const field = {
    fieldName: 'status', type: 3, uiType: 'SingleSelect',
    property: { optionsType: 0, options: [{ name: 'active', color: 0 }] },
  };
  await client.createField({ tableId: 'tbl1', field });
  await client.updateField({ tableId: 'tbl1', fieldId: 'fld1', field });
  assert.equal(requests[0].method, 'POST');
  assert.match(requests[0].url, /\/tables\/tbl1\/fields$/);
  assert.equal(requests[1].method, 'PUT');
  assert.match(requests[1].url, /\/tables\/tbl1\/fields\/fld1$/);
  assert.deepEqual(requests[0].body, {
    field_name: 'status', type: 3, ui_type: 'SingleSelect',
    property: { options: [{ name: 'active', color: 0 }] },
  });
  assert.deepEqual(requests[1].body, requests[0].body);
});

test('serializes DateTime aliases into official snake_case property keys', async () => {
  const requests = [];
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({
        code: 0,
        data: { field: { field_id: 'fldDate', field_name: 'period_end', type: 5 } },
      }), { status: 200 });
    },
  });
  await client.createField({
    tableId: 'tbl1',
    field: {
      fieldName: 'period_end',
      type: 5,
      uiType: 'DateTime',
      description: 'วันสิ้นสุดรายงาน',
      property: {
        dateFormat: 'yyyy/MM/dd',
        timeFormat: 'HH:mm',
        autoFill: false,
      },
    },
  });
  assert.deepEqual(requests[0], {
    field_name: 'period_end',
    type: 5,
    ui_type: 'DateTime',
    description: { text: 'วันสิ้นสุดรายงาน' },
    property: {
      date_formatter: 'yyyy/MM/dd',
      auto_fill: false,
    },
  });
});


test('serializes Number formatter aliases into Lark OpenAPI enum values', async () => {
  const requests = [];
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({
        code: 0,
        data: { field: { field_id: 'fldNumber', field_name: 'decimal_places', type: 2 } },
      }), { status: 200 });
    },
  });

  await client.createField({
    tableId: 'tbl1',
    field: {
      fieldName: 'decimal_places',
      type: 2,
      uiType: 'Number',
      property: { formatter: '#,##0' },
    },
  });
  await client.updateField({
    tableId: 'tbl1',
    fieldId: 'fldNumber',
    field: {
      fieldName: 'ratio_value',
      type: 2,
      uiType: 'Number',
      property: { formatter: '#,##0.0000' },
    },
  });

  assert.deepEqual(requests, [
    {
      field_name: 'decimal_places',
      type: 2,
      ui_type: 'Number',
      property: { formatter: '1,000' },
    },
    {
      field_name: 'ratio_value',
      type: 2,
      ui_type: 'Number',
      property: { formatter: '0.0000' },
    },
  ]);
});

test('omits unsupported UI-only URL property metadata', async () => {
  const requests = [];
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({
        code: 0,
        data: { field: { field_id: 'fldUrl', field_name: 'content_url', type: 15 } },
      }), { status: 200 });
    },
  });
  await client.createField({
    tableId: 'tbl1',
    field: {
      fieldName: 'content_url',
      type: 15,
      uiType: 'Url',
      property: { extractExternalUrl: true },
    },
  });
  assert.deepEqual(requests[0], {
    field_name: 'content_url',
    type: 15,
    ui_type: 'Url',
  });
});

test('lists and normalizes Lark views with shared pagination guards', async () => {
  const urls = [];
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      urls.push(String(url));
      const secondPage = String(url).includes('page_token=next-view');
      return new Response(JSON.stringify(secondPage
        ? {
            code: 0,
            data: {
              items: [{
                view_id: 'vew2', view_name: 'Weekly', view_type: 'grid',
                property: { hidden_fields: ['fld2'], filter_info: null },
              }],
              has_more: false,
            },
          }
        : {
            code: 0,
            data: {
              items: [{
                view_id: 'vew1', view_name: 'Daily', view_type: 'grid',
                property: {
                  hidden_fields: ['fld1', 'fld1'],
                  filter_info: {
                    conjunction: 'and',
                    conditions: [{ field_id: 'fldType', field_type: 3, operator: 'is', value: '["optDaily"]' }],
                  },
                },
                view_public_level: 'Public',
              }],
              has_more: true,
              page_token: 'next-view',
            },
          }), { status: 200 });
    },
  });

  const views = await client.listViews({ tableId: 'tblViews' });
  assert.equal(urls.length, 2);
  assert.deepEqual(views, [
    {
      viewId: 'vew1', viewName: 'Daily', viewType: 'grid', publicLevel: 'Public',
      property: {
        hiddenFields: ['fld1'],
        filterInfo: {
          conjunction: 'and',
          conditions: [{ fieldId: 'fldType', fieldType: 3, operator: 'is', value: '["optDaily"]' }],
        },
      },
    },
    {
      viewId: 'vew2', viewName: 'Weekly', viewType: 'grid', publicLevel: null,
      property: { hiddenFields: ['fld2'], filterInfo: null },
    },
  ]);
});

test('gets one Lark view with the full filter property', async () => {
  let request = null;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      request = { url: String(url), method: options.method };
      return new Response(JSON.stringify({
        code: 0,
        data: {
          view: {
            view_id: 'vew1', view_name: 'Daily', view_type: 'grid',
            property: {
              hidden_fields: [],
              filter_info: {
                conjunction: 'and',
                conditions: [{ field_id: 'fldVisible', field_type: 7, operator: 'is', value: '[true]' }],
              },
            },
          },
        },
      }), { status: 200 });
    },
  });

  const view = await client.getView({ tableId: 'tblViews', viewId: 'vew1' });
  assert.match(request.url, /tables\/tblViews\/views\/vew1$/u);
  assert.equal(request.method, 'GET');
  assert.deepEqual(view.property.filterInfo.conditions, [
    { fieldId: 'fldVisible', fieldType: 7, operator: 'is', value: '[true]' },
  ]);
});

test('creates a grid view with the official create payload', async () => {
  let request = null;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      request = { url: String(url), method: options.method, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        code: 0,
        data: { view: { view_id: 'vewCreated', view_name: 'Daily', view_type: 'grid', property: {} } },
      }), { status: 200 });
    },
  });

  const view = await client.createView({ tableId: 'tblViews', viewName: 'Daily', viewType: 'grid' });
  assert.match(request.url, /tables\/tblViews\/views$/u);
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.body, { view_name: 'Daily', view_type: 'grid' });
  assert.equal(view.viewId, 'vewCreated');
});

test('patches Lark view with request-only condition fields and JSON-array values', async () => {
  let request = null;
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      request = { url: String(url), method: options.method, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        code: 0,
        data: { view: { view_id: 'vew1', view_name: 'Daily', view_type: 'grid', property: request?.body?.property } },
      }), { status: 200 });
    },
  });

  await client.updateView({
    tableId: 'tblViews',
    viewId: 'vew1',
    hiddenFields: ['fldHidden', 'fldHidden'],
    filterInfo: {
      conjunction: 'and',
      conditions: [
        { fieldId: 'fldType', fieldType: 3, operator: 'is', value: '["optDaily"]' },
        { fieldId: 'fldStatus', fieldType: 3, operator: 'isNot', value: ['optNoData'] },
        { fieldId: 'fldVisible', fieldType: 7, operator: 'is', value: '[true]' },
      ],
    },
  });

  assert.match(request.url, /tables\/tblViews\/views\/vew1$/u);
  assert.equal(request.method, 'PATCH');
  assert.deepEqual(request.body, {
    property: {
      hidden_fields: ['fldHidden'],
      filter_info: {
        conjunction: 'and',
        conditions: [
          { field_id: 'fldType', operator: 'is', value: '["optDaily"]' },
          { field_id: 'fldStatus', operator: 'isNot', value: '["optNoData"]' },
          { field_id: 'fldVisible', operator: 'is', value: '[true]' },
        ],
      },
    },
  });
});

test('view PATCH error includes the exact request-only safe body', async () => {
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 1254001, msg: 'WrongRequestBody' }), { status: 200 });
    },
  });

  await assert.rejects(
    client.updateView({
      tableId: 'tblViews',
      viewId: 'vew1',
      hiddenFields: ['fldHidden'],
      filterInfo: {
        conjunction: 'and',
        conditions: [
          { fieldId: 'fldVisible', fieldType: 7, operator: 'is', value: '[true]' },
        ],
      },
    }),
    (error) => {
      assert.equal(error.code, 'LARK_PERMANENT_API_ERROR');
      assert.deepEqual(error.details.viewMutationBody, {
        property: {
          hidden_fields: ['fldHidden'],
          filter_info: {
            conjunction: 'and',
            conditions: [
              { field_id: 'fldVisible', operator: 'is', value: '[true]' },
            ],
          },
        },
      });
      assert.equal('field_type' in error.details.viewMutationBody.property.filter_info.conditions[0], false);
      assert.equal('condition_omitted' in error.details.viewMutationBody.property.filter_info, false);
      return true;
    },
  );
});

test('reads exactly one records page so the caller can persist and resume the cursor', async () => {
  const collectionUrls = [];
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      collectionUrls.push(String(url));
      const second = String(url).includes('page_token=page-2');
      return new Response(JSON.stringify(second
        ? { code: 0, data: { items: [{ record_id: 'rec2', fields: { key: 'two' } }], has_more: false } }
        : { code: 0, data: { items: [{ record_id: 'rec1', fields: { key: 'one' } }], has_more: true, page_token: 'page-2' } }), { status: 200 });
    },
  });

  const first = await client.listRecordsPage({ tableId: 'tbl', pageSize: 500 });
  assert.deepEqual(first.records.map((record) => record.recordId), ['rec1']);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextPageToken, 'page-2');
  assert.equal(collectionUrls.length, 1);

  const second = await client.listRecordsPage({ tableId: 'tbl', pageToken: first.nextPageToken, pageSize: 500 });
  assert.deepEqual(second.records.map((record) => record.recordId), ['rec2']);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextPageToken, null);
  assert.equal(collectionUrls.length, 2);
  assert.match(collectionUrls[1], /page_token=page-2/u);
});

test('searches bounded report records with request-only filter/sort fields and early stop', async () => {
  const requests = [];
  let page = 0;
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    minRequestIntervalMs: 0,
    maxPages: 5,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      page += 1;
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        code: 0,
        data: {
          items: [
            { record_id: `rec-${page}-1`, fields: { metric_date: 200 } },
            { record_id: `rec-${page}-2`, fields: { metric_date: 100 } },
          ],
          has_more: true,
          page_token: `page-${page + 1}`,
        },
      }), { status: 200 });
    },
  });

  const records = await client.searchRecords({
    tableId: 'tbl_daily',
    pageSize: 50,
    maxPages: 3,
    maxItems: 10,
    fieldNames: ['external_content_id', 'metric_date'],
    filter: {
      conjunction: 'and',
      conditions: [
        { fieldName: 'account_id', operator: 'is', value: ['ft_pumkin'] },
        { fieldName: 'metric_date', operator: 'isLessEqual', value: [200] },
      ],
    },
    sort: [{ fieldName: 'metric_date', desc: true }],
    stopWhen: ({ item }) => Number(item.fields.metric_date) < 150,
  });

  assert.equal(page, 1);
  assert.equal(records.length, 2);
  assert.deepEqual(requests[0].body, {
    field_names: ['external_content_id', 'metric_date'],
    sort: [{ field_name: 'metric_date', desc: true }],
    filter: {
      conjunction: 'and',
      conditions: [
        { field_name: 'account_id', operator: 'is', value: ['ft_pumkin'] },
        { field_name: 'metric_date', operator: 'isLessEqual', value: ['200'] },
      ],
    },
  });
  assert.match(requests[0].url, /page_size=50/);
});

test('serializes valueless record search operators with the required empty value array', async () => {
  const requests = [];
  const client = new LarkBitableClient({
    appId: 'app-id',
    appSecret: 'app-secret',
    appToken: 'app-token',
    minRequestIntervalMs: 0,
    fetchImpl: async (url, options) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      requests.push(JSON.parse(options.body));
      return new Response(JSON.stringify({
        code: 0,
        data: { items: [], has_more: false },
      }), { status: 200 });
    },
  });

  const records = await client.searchRecords({
    tableId: 'tbl_empty_metric',
    fieldNames: ['empty_metric'],
    filter: {
      conjunction: 'and',
      conditions: [{ fieldName: 'empty_metric', operator: 'isNotEmpty' }],
    },
  });

  assert.deepEqual(records, []);
  assert.deepEqual(requests, [{
    field_names: ['empty_metric'],
    filter: {
      conjunction: 'and',
      conditions: [{ field_name: 'empty_metric', operator: 'isNotEmpty', value: [] }],
    },
  }]);
});

test('fails closed when bounded record search exceeds its item cap', async () => {
  const client = new LarkBitableClient({
    appId: 'app-id', appSecret: 'app-secret', appToken: 'app-token', minRequestIntervalMs: 0,
    fetchImpl: async (url) => {
      if (String(url).includes('tenant_access_token')) {
        return new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({
        code: 0,
        data: {
          items: [
            { record_id: 'rec-1', fields: {} },
            { record_id: 'rec-2', fields: {} },
          ],
          has_more: false,
        },
      }), { status: 200 });
    },
  });

  await assert.rejects(
    client.searchRecords({ tableId: 'tbl', maxItems: 1 }),
    (error) => error.code === 'LARK_BOUNDED_READ_LIMIT_EXCEEDED',
  );
});
