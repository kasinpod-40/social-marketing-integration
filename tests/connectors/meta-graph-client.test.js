import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaGraphClient } from '../../packages/connectors/src/meta/meta-graph.client.js';

test('Meta shared client uses bearer auth and cursor pagination without following response URL', async () => {
  const calls = [];
  const client = new MetaGraphClient({
    accessToken: 'test-token',
    apiVersion: 'v99.0',
    maxAttempts: 1,
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

test('Meta getPage returns one bounded page for durable staging', async () => {
  const calls = [];
  const client = new MetaGraphClient({
    accessToken: 'test-token',
    apiVersion: 'v99.0',
    maxAttempts: 1,
    fetchImpl: async (url) => {
      calls.push(new URL(url));
      return Response.json({
        data: [{ id: '1' }, { id: '2' }],
        paging: { cursors: { after: 'cursor-next' }, next: 'https://graph.facebook.com/next' },
      });
    },
  });

  const page = await client.getPage('page_1/posts', { fields: 'id' }, { pageSize: 2 });
  assert.deepEqual(page.rows.map((row) => row.id), ['1', '2']);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, 'cursor-next');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('limit'), '2');
});

test('Meta pagination rejects repeated current or previously visited cursors', async () => {
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    maxAttempts: 1,
    fetchImpl: async () => Response.json({
      data: [{ id: '1' }],
      paging: { cursors: { after: 'cursor-current' }, next: 'https://graph.facebook.com/next' },
    }),
  });

  await assert.rejects(
    client.getPage('page/posts', {}, { after: 'cursor-current' }),
    (error) => error?.code === 'META_INVALID_PAGINATION' && error.retryable === false,
  );

  const visitedClient = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    maxAttempts: 1,
    fetchImpl: async () => Response.json({
      data: [{ id: '1' }],
      paging: { cursors: { after: 'cursor-old' }, next: 'https://graph.facebook.com/next' },
    }),
  });
  await assert.rejects(
    visitedClient.getPage('page/posts', {}, { visitedCursors: ['cursor-old'] }),
    (error) => error?.code === 'META_INVALID_PAGINATION',
  );
});

test('Meta shared client rejects non-versioned config and classifies transient errors', async () => {
  assert.throws(
    () => new MetaGraphClient({ accessToken: 'x', apiVersion: 'latest', fetchImpl: async () => null }),
    /vNN.N/,
  );
  assert.throws(
    () => new MetaGraphClient({
      accessToken: 'x',
      apiVersion: 'v99.0',
      baseUrl: 'ftp://localhost',
      fetchImpl: async () => null,
    }),
    /HTTPS except local test hosts/,
  );

  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    maxAttempts: 1,
    fetchImpl: async () => Response.json({ error: { code: 4, is_transient: true } }, { status: 400 }),
  });
  await assert.rejects(
    client.get('me'),
    (error) => error?.code === 'META_TRANSIENT_API_ERROR' && error.retryable === true,
  );
});

test('Meta retries rate limits with Retry-After and bounded backoff', async () => {
  let requests = 0;
  const sleeps = [];
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    maxAttempts: 2,
    retryBaseDelayMs: 10,
    maxRetryDelayMs: 100,
    randomImpl: () => 0,
    sleepImpl: async (delayMs) => sleeps.push(delayMs),
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) {
        return Response.json(
          { error: { code: 4, message: 'rate limited' } },
          { status: 429, headers: { 'retry-after': '1' } },
        );
      }
      return Response.json({ id: 'ok' });
    },
  });

  assert.deepEqual(await client.get('me'), { id: 'ok' });
  assert.equal(requests, 2);
  assert.deepEqual(sleeps, [1_000]);
});

test('Meta timeout covers delayed response body reads', async () => {
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    maxAttempts: 1,
    timeoutMs: 5,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => new Promise((resolve) => setTimeout(() => resolve('{"id":"late"}'), 30)),
    }),
  });

  await assert.rejects(
    client.get('me'),
    (error) => error?.code === 'META_REQUEST_TIMEOUT' && error.retryable === true,
  );
});

test('Meta usage headers trigger bounded throttle without exposing raw account usage', async () => {
  const sleeps = [];
  const events = [];
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    maxAttempts: 1,
    usageThrottleThreshold: 90,
    usageThrottleDelayMs: 25,
    sleepImpl: async (delayMs) => sleeps.push(delayMs),
    onRequest: (event) => events.push(event),
    fetchImpl: async () => Response.json(
      { id: 'ok' },
      { headers: { 'x-app-usage': JSON.stringify({ call_count: 95, total_cputime: 20, total_time: 30 }) } },
    ),
  });

  assert.deepEqual(await client.get('me'), { id: 'ok' });
  assert.deepEqual(sleeps, [25]);
  const throttle = events.find((event) => event.stage === 'meta_usage_throttle');
  assert.deepEqual(throttle, {
    stage: 'meta_usage_throttle',
    path: 'me',
    maxPercent: 95,
    delayMs: 25,
  });
  assert.equal(JSON.stringify(events).includes('test-token'), false);
});
