import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createYouTubeCustomerConnectionHttpHandler,
} from '../../apps/sync-worker/src/youtube-customer-connection-http.js';

test('YouTube connect redirects with no-store browser policy', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const url = new URL('https://worker.example/connect/youtube?invitation=signed');
  const response = await handler({ request: new Request(url), env: {}, url });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://accounts.google.test/youtube-consent');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls[0], 'signed');
});

test('YouTube callback can return explicit selection candidates without auto-selecting', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const url = new URL(
    'https://worker.example/oauth/youtube/callback?state=signed-state&code=auth-code',
  );
  const response = await handler({ request: new Request(url), env: {}, url });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.connection.status, 'identity_selection_required');
  assert.deepEqual(body.connection.candidates, [
    { channelId: 'channel_A', title: 'A' },
    { channelId: 'channel_B', title: 'B' },
  ]);
});

test('YouTube channel selection POST passes signed token and selected channel only', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const url = new URL('https://worker.example/oauth/youtube/select-channel');
  const response = await handler({
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selectionToken: 'selection-signed', channelId: 'channel_B' }),
    }),
    env: {},
    url,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], {
    selectionToken: 'selection-signed',
    channelId: 'channel_B',
  });
  assert.equal((await response.json()).connection.status, 'connected');
});

function createHandler(calls) {
  return createYouTubeCustomerConnectionHttpHandler({
    createRuntime: () => ({}),
    createFlow: () => ({
      async begin(invitation) {
        calls.push(invitation);
        return 'https://accounts.google.test/youtube-consent';
      },
      async complete() {
        return {
          connector: 'youtube',
          status: 'identity_selection_required',
          queued: false,
          larkWrite: false,
          selectionRequired: true,
          selectionToken: 'selection-signed',
          expiresAt: '2026-07-25T00:00:00.000Z',
          candidates: [
            { channelId: 'channel_A', title: 'A' },
            { channelId: 'channel_B', title: 'B' },
          ],
        };
      },
      async select(input) {
        calls.push(input);
        return { connector: 'youtube', status: 'connected', queued: false, larkWrite: false };
      },
    }),
  });
}
