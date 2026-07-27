import test from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeClientsFromEnv } from '../../packages/connectors/src/youtube/youtube-runtime-factory.js';

test('creates public API-key client without requiring owner OAuth', () => {
  const result = createYouTubeClientsFromEnv({ YOUTUBE_API_KEY: 'test-api-key' });
  assert.ok(result.publicClient);
  assert.equal(result.ownerClient, null);
  assert.equal(result.oauthConfigured, false);
});

test('operator public-only mode ignores configured OAuth and counts only public requests', async () => {
  let fetchCalls = 0;
  const result = createYouTubeClientsFromEnv({
    YOUTUBE_API_KEY: 'test-api-key',
    YOUTUBE_OAUTH_CLIENT_ID: 'client-id',
    YOUTUBE_OAUTH_CLIENT_SECRET: 'client-secret',
    YOUTUBE_OAUTH_REFRESH_TOKEN: 'refresh-token',
  }, {
    publicApiKeyOnly: true,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.ok(result.publicClient);
  assert.equal(result.ownerClient, null);
  assert.equal(result.oauthConfigured, false);
  assert.equal(fetchCalls, 0);
  await assert.rejects(
    () => result.publicClient.getChannel({ channelId: 'UC_TEST' }),
    (error) => error?.code === 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH',
  );
  assert.equal(fetchCalls, 1);
  assert.equal(result.requestMetrics.publicRequests, 1);
});

test('operator public-only mode fails before Provider access when API key is absent', () => {
  assert.throws(
    () => createYouTubeClientsFromEnv({
      YOUTUBE_OAUTH_CLIENT_ID: 'client-id',
      YOUTUBE_OAUTH_CLIENT_SECRET: 'client-secret',
      YOUTUBE_OAUTH_REFRESH_TOKEN: 'refresh-token',
    }, { publicApiKeyOnly: true }),
    (error) => error?.code === 'YOUTUBE_DRY_RUN_API_KEY_REQUIRED',
  );
});

test('rejects example credential placeholders before any YouTube request', () => {
  assert.throws(
    () => createYouTubeClientsFromEnv({ YOUTUBE_API_KEY: 'replace-with-youtube-api-key' }),
    (error) => error?.code === 'YOUTUBE_CREDENTIAL_PLACEHOLDER'
      && error.details?.fieldName === 'YOUTUBE_API_KEY',
  );
  assert.throws(
    () => createYouTubeClientsFromEnv({
      YOUTUBE_OAUTH_CLIENT_ID: 'replace-with-oauth-client-id',
      YOUTUBE_OAUTH_CLIENT_SECRET: 'replace-with-oauth-client-secret',
      YOUTUBE_OAUTH_REFRESH_TOKEN: 'replace-with-oauth-refresh-token',
    }),
    (error) => error?.code === 'YOUTUBE_CREDENTIAL_PLACEHOLDER',
  );
});
