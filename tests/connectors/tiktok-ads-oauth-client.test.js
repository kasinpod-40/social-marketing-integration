import test from 'node:test';
import assert from 'node:assert/strict';
import { TikTokAdsOAuthClient } from '../../packages/connectors/src/tiktok-ads/tiktok-ads-oauth.client.js';

test('TikTok Ads authorization URL binds app, state and exact redirect URI', () => {
  const client = new TikTokAdsOAuthClient({
    appId: '7670007933899390993',
    appSecret: 'private-secret',
    fetchImpl: async () => { throw new Error('not used'); },
  });
  const url = new URL(client.buildAuthorizationUrl({
    state: 'signed-state',
    redirectUri: 'https://worker.example/oauth/tiktok-ads/callback',
  }));
  assert.equal(url.origin + url.pathname, 'https://business-api.tiktok.com/portal/auth');
  assert.equal(url.searchParams.get('app_id'), '7670007933899390993');
  assert.equal(url.searchParams.get('state'), 'signed-state');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://worker.example/oauth/tiktok-ads/callback',
  );
});

test('TikTok Ads code exchange returns access and refresh token lifecycle without leaking secret', async () => {
  const calls = [];
  const client = new TikTokAdsOAuthClient({
    appId: '7670007933899390993',
    appSecret: 'private-secret',
    now: () => 1_000,
    fetchImpl: async (url, init) => {
      calls.push({ url: url.toString(), init });
      return Response.json({
        code: 0,
        data: {
          access_token: 'access-private',
          refresh_token: 'refresh-private',
          expires_in: 86_400,
          refresh_expires_in: 31_536_000,
        },
      });
    },
  });
  const token = await client.exchangeAuthorizationCode({ code: 'auth-code' });
  assert.equal(token.accessToken, 'access-private');
  assert.equal(token.refreshToken, 'refresh-private');
  assert.equal(token.expiresAt, 86_401_000);
  assert.equal(token.refreshExpiresAt, 31_536_001_000);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    app_id: '7670007933899390993',
    auth_code: 'auth-code',
    secret: 'private-secret',
  });
});

test('TikTok Ads rejected exchange exposes only safe provider status', async () => {
  const client = new TikTokAdsOAuthClient({
    appId: '7670007933899390993',
    appSecret: 'private-secret',
    fetchImpl: async () => Response.json({ code: 40001, message: 'private-secret' }, { status: 400 }),
  });
  await assert.rejects(
    () => client.exchangeAuthorizationCode({ code: 'bad-code' }),
    (error) => (
      error.code === 'TIKTOK_ADS_OAUTH_REJECTED'
      && JSON.stringify(error).includes('private-secret') === false
    ),
  );
});
