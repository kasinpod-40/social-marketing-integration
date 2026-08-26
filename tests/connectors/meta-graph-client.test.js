import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMetaAdsBusinessUseCaseRateLimit,
  MetaGraphClient,
} from '../../packages/connectors/src/meta/meta-graph.client.js';

test('Meta shared client uses bearer auth and cursor pagination without following response URL', async () => {
  const calls = [];
  const client = new MetaGraphClient({
    accessToken: 'test-token',
    apiVersion: 'v99.0',
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      calls.push({ parsed, authorization: init.headers.get('authorization') });
      return Response.json(parsed.searchParams.get('after')
        ? { data: [{ id: '2' }] }
        : {
          data: [{ id: '1' }],
          paging: {
            cursors: { after: 'cursor-2' },
            next: 'https://attacker.example/never-follow-this?access_token=leak',
          },
        });
    },
  });
  const rows = await client.listEdge('page_1/posts', { fields: 'id,message' });
  assert.deepEqual(rows.map((row) => row.id), ['1', '2']);
  assert.equal(calls[0].authorization, 'Bearer test-token');
  assert.equal(calls[1].parsed.hostname, 'graph.facebook.com');
  assert.equal(calls[1].parsed.searchParams.get('after'), 'cursor-2');
  assert.equal(calls[0].parsed.searchParams.has('access_token'), false);
});

test('Meta getPage exposes one bounded page for durable staging', async () => {
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    fetchImpl: async () => Response.json({
      data: [{ id: '1' }],
      paging: { cursors: { after: 'next-1' }, next: 'https://graph.facebook.com/ignored' },
    }),
  });
  const page = await client.getPage('page/posts');
  assert.deepEqual(page.rows.map((row) => row.id), ['1']);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, 'next-1');
});

test('Meta pagination rejects missing and repeated cursors', async () => {
  const missing = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    fetchImpl: async () => Response.json({ data: [], paging: { next: 'https://graph.facebook.com/ignored' } }),
  });
  await assert.rejects(
    missing.getPage('page/posts'),
    (error) => error?.code === 'META_CURSOR_MISSING' && error.retryable === false,
  );

  const repeated = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    fetchImpl: async () => Response.json({
      data: [],
      paging: { cursors: { after: 'cursor-1' }, next: 'https://graph.facebook.com/ignored' },
    }),
  });
  await assert.rejects(
    repeated.getPage('page/posts', {}, { after: 'cursor-1' }),
    (error) => error?.code === 'META_CURSOR_REPEATED' && error.retryable === false,
  );
});

test('Meta shared client retries transient responses with bounded backoff', async () => {
  let calls = 0;
  const delays = [];
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    maxAttempts: 3,
    retryBaseDelayMs: 10,
    randomImpl: () => 0,
    sleepImpl: async (ms) => { delays.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) return Response.json({ error: { code: 4, is_transient: true } }, { status: 500 });
      return Response.json({ id: 'ok' });
    },
  });
  const result = await client.get('me');
  assert.equal(result.id, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

test('Meta Ads BUC throttle retries even when provider returns HTTP 400 without is_transient', async () => {
  let calls = 0;
  const delays = [];
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    maxAttempts: 2,
    retryBaseDelayMs: 10,
    randomImpl: () => 0,
    sleepImpl: async (ms) => { delays.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json({
          error: { code: 80004, error_subcode: 2446079, is_transient: false },
        }, { status: 400 });
      }
      return Response.json({ id: 'ok' });
    },
  });

  const result = await client.get('act_fixture/creatives', {}, {
    operationName: 'meta_ads.creatives.inventory',
  });
  assert.equal(result.id, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(delays, [10]);
  assert.equal(isMetaAdsBusinessUseCaseRateLimit({
    details: { graphCode: 80004, graphSubcode: 2446079 },
  }), true);
  assert.equal(isMetaAdsBusinessUseCaseRateLimit({
    details: { graphCode: 80004, graphSubcode: 2446078 },
  }), false);
  assert.equal(isMetaAdsBusinessUseCaseRateLimit({
    details: { graphCode: 4, graphSubcode: 2446079 },
  }), false);
});

test('Meta 429 honors retry-after and exposes usage metadata to request events', async () => {
  let calls = 0;
  const delays = [];
  const events = [];
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    maxAttempts: 2,
    retryBaseDelayMs: 10,
    sleepImpl: async (ms) => { delays.push(ms); },
    onRequest: (event) => events.push(event),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json({ error: { code: 4 } }, {
          status: 429,
          headers: { 'retry-after': '2' },
        });
      }
      return Response.json({ id: 'ok' }, {
        headers: { 'x-app-usage': '{"call_count":75}' },
      });
    },
  });
  await client.get('me');
  assert.deepEqual(delays, [2_000]);
  const success = events.find((event) => event.stage === 'meta_request_success');
  assert.equal(success.usage.appUsage.call_count, 75);
});

test('Meta observability exposes only a static operation name, never the dynamic Graph path', async () => {
  const events = [];
  const dynamicId = 'page_fixture_sensitive_001';
  const client = new MetaGraphClient({
    accessToken: 'synthetic-token',
    apiVersion: 'v99.0',
    maxAttempts: 1,
    onRequest: (event) => events.push(event),
    fetchImpl: async () => Response.json({
      error: { code: 200, message: 'Synthetic permission failure' },
    }, { status: 403 }),
  });

  await assert.rejects(
    client.get(`${dynamicId}/insights`, {}, {
      operationName: 'facebook.content.insights',
    }),
    (error) => {
      assert.equal(error.details.operation, 'facebook.content.insights');
      assert.doesNotMatch(error.message, new RegExp(dynamicId, 'u'));
      assert.doesNotMatch(JSON.stringify(error.details), new RegExp(dynamicId, 'u'));
      return error?.code === 'META_PERMANENT_API_ERROR';
    },
  );

  assert.ok(events.length > 0);
  assert.ok(events.every((event) => event.operation === 'facebook.content.insights'));
  assert.doesNotMatch(JSON.stringify(events), new RegExp(dynamicId, 'u'));
  assert.ok(events.every((event) => !Object.hasOwn(event, 'path')));
  await assert.rejects(
    client.get('me', {}, { operationName: 'unsafe/operation' }),
    /operationName/u,
  );
});

test('Meta timeout covers response body consumption', async () => {
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    timeoutMs: 5,
    maxAttempts: 1,
    fetchImpl: async (_url, init) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      async text() {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 50);
          init.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        });
        return '{}';
      },
    }),
  });
  await assert.rejects(
    client.get('me'),
    (error) => error?.code === 'META_REQUEST_TIMEOUT' && error.retryable === true,
  );
});

test('Meta shared client rejects an oversized response body before JSON parsing', async () => {
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    maxResponseBytes: 16,
    maxAttempts: 1,
    fetchImpl: async () => Response.json({ data: [{ value: 'larger-than-limit' }] }),
  });
  await assert.rejects(
    client.get('me'),
    (error) => error?.code === 'META_RESPONSE_TOO_LARGE' && error.retryable === false,
  );
});

test('Meta shared client rejects non-versioned config and classifies permanent errors', async () => {
  assert.throws(
    () => new MetaGraphClient({ accessToken: 'x', apiVersion: 'latest', fetchImpl: async () => null }),
    /vNN.N/,
  );
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    fetchImpl: async () => Response.json({
      error: {
        code: 200,
        is_transient: false,
        message: 'API access blocked.',
      },
    }, { status: 400 }),
  });
  await assert.rejects(
    client.get('me'),
    (error) => error?.code === 'META_PERMANENT_API_ERROR'
      && error.retryable === false
      && error?.details?.providerReason === 'api_access_blocked'
      && !JSON.stringify(error.details).includes('API access blocked.'),
  );
});
