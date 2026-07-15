import test from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeClientsFromEnv } from '../../packages/connectors/src/youtube/youtube-runtime-factory.js';

test('creates public API-key client without requiring owner OAuth', () => {
  const result = createYouTubeClientsFromEnv({ YOUTUBE_API_KEY: 'test-api-key' });
  assert.ok(result.publicClient);
  assert.equal(result.ownerClient, null);
  assert.equal(result.oauthConfigured, false);
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
