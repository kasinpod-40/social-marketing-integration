import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTikTokAdsCustomerConnectionHttpHandler,
} from '../../apps/sync-worker/src/tiktok-ads-customer-connection-http.js';

test('TikTok Ads GET is preview-only and POST starts provider authorization', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const url = new URL('https://worker.example/connect/tiktok-ads?invitation=signed');
  const preview = await handler({ request: new Request(url), env: {}, url });
  assert.equal(preview.status, 200);
  assert.deepEqual(calls, [{ type: 'preview', invitation: 'signed' }]);

  calls.length = 0;
  const start = await handler({
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'confirm=connect',
    }),
    env: {},
    url,
  });
  assert.equal(start.status, 303);
  assert.equal(start.headers.get('location'), 'https://business-api.tiktok.test/portal/auth');
  assert.deepEqual(calls, [{ type: 'begin', invitation: 'signed' }]);
});

test('TikTok Ads callback accepts TikTok auth_code and returns no Queue/Lark side effect', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const url = new URL(
    'https://worker.example/oauth/tiktok-ads/callback?state=signed-state&auth_code=auth-code',
  );
  const response = await handler({ request: new Request(url), env: {}, url });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], {
    state: 'signed-state',
    code: 'auth-code',
    oauthError: undefined,
  });
  const body = await response.json();
  assert.equal(body.connection.connector, 'tiktok_ads');
  assert.equal(body.connection.queued, false);
  assert.equal(body.connection.larkWrite, false);
});

function createHandler(calls) {
  return createTikTokAdsCustomerConnectionHttpHandler({
    createRuntime: () => ({}),
    createFlow: () => ({
      async preview(invitation) {
        calls.push({ type: 'preview', invitation });
        return {
          attemptsRemaining: 3,
          canStart: true,
          retryAvailableAt: null,
          expiresAt: '2026-09-26T00:00:00.000Z',
        };
      },
      async begin(invitation) {
        calls.push({ type: 'begin', invitation });
        return 'https://business-api.tiktok.test/portal/auth';
      },
      async complete(input) {
        calls.push(input);
        return {
          connector: 'tiktok_ads',
          connectionStatus: 'connected',
          accessStatus: 'validated',
          queued: false,
          larkWrite: false,
        };
      },
    }),
  });
}
