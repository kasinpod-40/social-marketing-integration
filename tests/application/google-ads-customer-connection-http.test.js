import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoogleAdsCustomerConnectionHttpHandler,
} from '../../apps/sync-worker/src/google-ads-customer-connection-http.js';

test('Google Ads GET renders a repeatable side-effect-free confirmation page', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const context = {
    request: new Request('https://worker.example/connect/google-ads?invitation=signed'),
    env: {},
    url: new URL('https://worker.example/connect/google-ads?invitation=signed'),
  };
  const response = await handler(context);
  const repeated = await handler(context);
  assert.equal(response.status, 200);
  assert.equal(repeated.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/u);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /form-action 'self'/u);
  const html = await response.text();
  assert.match(html, /ยืนยันการเชื่อมต่อ Google Ads/u);
  assert.equal(html.includes('signed'), false);
  assert.equal(html.includes('invitation='), false);
  assert.deepEqual(calls, [
    { type: 'preview', invitation: 'signed' },
    { type: 'preview', invitation: 'signed' },
  ]);
});

test('Google Ads POST with explicit confirmation starts OAuth once and uses 303', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const url = new URL('https://worker.example/connect/google-ads?invitation=signed');
  const response = await handler({
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'confirm=connect',
    }),
    env: {},
    url,
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://accounts.google.test/consent');
  assert.deepEqual(calls, [{ type: 'begin', invitation: 'signed' }]);
});

test('Google Ads POST without the exact confirmation marker has zero OAuth side effects', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const url = new URL('https://worker.example/connect/google-ads?invitation=signed');
  await assert.rejects(
    () => handler({
      request: new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'confirm=preview',
      }),
      env: {},
      url,
    }),
    (error) => error.code === 'CONNECTION_CONFIRMATION_INVALID',
  );
  assert.deepEqual(calls, []);
});

test('Google Ads confirmation rejects an oversized streamed body before OAuth begin', async () => {
  const calls = [];
  const handler = createHandler(calls);
  const url = new URL('https://worker.example/connect/google-ads?invitation=signed');
  await assert.rejects(
    () => handler({
      request: new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `confirm=connect&padding=${'x'.repeat(1_024)}`,
      }),
      env: {},
      url,
    }),
    (error) => error.code === 'CONNECTION_CONFIRMATION_TOO_LARGE',
  );
  assert.deepEqual(calls, []);
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
      async preview(invitation) {
        calls.push({ type: 'preview', invitation });
        return {
          attemptsRemaining: 3,
          canStart: true,
          retryAvailableAt: null,
          expiresAt: '2026-07-25T00:00:00.000Z',
        };
      },
      async begin(invitation) {
        calls.push({ type: 'begin', invitation });
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
