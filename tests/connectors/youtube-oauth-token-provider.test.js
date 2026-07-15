import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeOAuthTokenProvider } from '../../packages/connectors/src/youtube/youtube-oauth-token-provider.js';
import { YouTubeApiClient } from '../../packages/connectors/src/youtube/youtube-api.client.js';

test('refreshes and caches YouTube OAuth tokens without placing secrets in the request URL', async () => {
  const calls = [];
  let now = 1_000;
  const provider = new YouTubeOAuthTokenProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    clock: () => now,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: String(init.body) });
      return Response.json({ access_token: 'access-token', expires_in: 3600 });
    },
  });
  assert.equal(await provider.getAccessToken(), 'access-token');
  now += 1000;
  assert.equal(await provider.getAccessToken(), 'access-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.includes('client-secret'), false);
  assert.match(calls[0].body, /grant_type=refresh_token/u);
});

test('YouTube API client resolves OAuth token lazily for owner requests', async () => {
  const requests = [];
  const client = new YouTubeApiClient({
    accessTokenProvider: { async getAccessToken() { return 'lazy-token'; } },
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), authorization: init.headers.get('authorization') });
      return Response.json({ items: [{ id: 'channel_A' }] });
    },
  });
  await client.getChannel({ mine: true });
  assert.equal(requests[0].authorization, 'Bearer lazy-token');
  assert.equal(requests[0].url.searchParams.get('mine'), 'true');
});
