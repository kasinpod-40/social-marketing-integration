import test from 'node:test';
import assert from 'node:assert/strict';
import { TikTokAdsOAuthClient } from '../../packages/connectors/src/tiktok-ads/tiktok-ads-oauth.client.js';

test('builds TikTok Ads authorization URL without exposing app secret', () => {
  const client = new TikTokAdsOAuthClient({
    appId: '123456',
    appSecret: 'top-secret',
    fetch: async () => { throw new Error('not called'); },
  });
  const value = client.buildAuthorizationUrl({
    state: 'signed-state',
    redirectUri: 'https://example.com/oauth/tiktok-ads/callback',
  });
  const url = new URL(value);
  assert.equal(url.searchParams.get('app_id'), '123456');
  assert.equal(url.searchParams.get('state'), 'signed-state');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/oauth/tiktok-ads/callback');
  assert.equal(value.includes('top-secret'), false);
});

test('exchanges auth code and returns bounded advertiser identities', async () => {
  const client = new TikTokAdsOAuthClient({
    appId: '123456',
    appSecret: 'top-secret',
    fetch: async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.auth_code, 'auth-code');
      return new Response(JSON.stringify({
        code: 0,
        data: { access_token: 'provider-token', advertiser_ids: ['9988', '9988'] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await client.exchangeAuthorizationCode({ code: 'auth-code' });
  assert.equal(result.accessToken, 'provider-token');
  assert.deepEqual(result.advertiserIds, ['9988']);
});
