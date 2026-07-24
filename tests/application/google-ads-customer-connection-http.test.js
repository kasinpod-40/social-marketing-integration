import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoogleAdsCustomerConnectionHttpHandler,
} from '../../apps/sync-worker/src/google-ads-customer-connection-http.js';

test('Google Ads connect redirects to provider with hardened browser headers', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const response = await handler({
    request: new Request('https://worker.example/connect/google-ads?invitation=signed'),
    env: {},
    url: new URL('https://worker.example/connect/google-ads?invitation=signed'),
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://accounts.google.test/consent');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(calls[0], 'signed');
});

test('Google Ads callback returns only safe connection status and has no queue/Lark output', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const url = new URL(
    'https://worker.example/oauth/google-ads/callback?state=signed-state&code=auth-code',
  );
  const response = await handler({ request: new Request(url), env: {}, url });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    connection: {
      connector: 'google_ads',
      status: 'connected',
      queued: false,
      larkWrite: false,
    },
  });
  assert.deepEqual(calls[0], { state: 'signed-state', code: 'auth-code', oauthError: undefined });
});

function createHandler(calls) {
  return createGoogleAdsCustomerConnectionHttpHandler({
    createRuntime: () => ({}),
    createFlow: () => ({
      async begin(invitation) {
        calls.push(invitation);
        return 'https://accounts.google.test/consent';
      },
      async complete(input) {
        calls.push(input);
        return {
          connector: 'google_ads',
          status: 'connected',
          queued: false,
          larkWrite: false,
        };
      },
    }),
  });
}
