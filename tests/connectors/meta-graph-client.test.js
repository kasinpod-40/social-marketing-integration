import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaGraphClient } from '../../packages/connectors/src/meta/meta-graph.client.js';

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

test('Meta shared client rejects non-versioned config and classifies transient errors', async () => {
  assert.throws(
    () => new MetaGraphClient({ accessToken: 'x', apiVersion: 'latest', fetchImpl: async () => null }),
    /vNN.N/,
  );
  const client = new MetaGraphClient({
    accessToken: 'x',
    apiVersion: 'v99.0',
    fetchImpl: async () => Response.json({ error: { code: 4, is_transient: true } }, { status: 400 }),
  });
  await assert.rejects(
    client.get('me'),
    (error) => error?.code === 'META_TRANSIENT_API_ERROR' && error.retryable === true,
  );
});
