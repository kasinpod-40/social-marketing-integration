import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleOAuthClient } from '../../packages/connectors/src/google/google-oauth.client.js';
import {
  EncryptedCustomerRefreshTokenCredentialAdapter,
  EnvironmentRefreshTokenCredentialAdapter,
  GoogleRefreshTokenAccessProvider,
} from '../../packages/connectors/src/google/google-refresh-token-provider.js';

test('Google authorization URL locks offline code flow, exact scopes, state and PKCE', () => {
  const client = new GoogleOAuthClient({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchImpl: async () => new Response('{}'),
  });
  const url = new URL(client.buildAuthorizationUrl({
    redirectUri: 'https://worker.example/oauth/youtube/callback',
    scopes: [
      'https://www.googleapis.com/auth/yt-analytics.readonly',
      'https://www.googleapis.com/auth/youtube.readonly',
    ],
    state: 'signed-state',
    promptConsent: true,
    codeChallenge: 'pkce-challenge',
  }));

  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'signed-state');
  assert.equal(url.searchParams.get('code_challenge'), 'pkce-challenge');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.deepEqual(url.searchParams.get('scope').split(' '), [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ]);
});

test('authorization-code exchange returns lifecycle metadata and never includes credentials in errors', async () => {
  let request;
  const client = new GoogleOAuthClient({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    clock: () => 1_000,
    fetchImpl: async (url, init) => {
      request = { url, init };
      return Response.json({
        access_token: 'access-value',
        refresh_token: 'refresh-value',
        token_type: 'Bearer',
        expires_in: 3_600,
        scope: 'scope-b scope-a',
      });
    },
  });
  const result = await client.exchangeAuthorizationCode({
    code: 'authorization-code',
    redirectUri: 'https://worker.example/oauth/google-ads/callback',
    codeVerifier: 'pkce-verifier',
  });

  assert.equal(result.accessToken, 'access-value');
  assert.equal(result.refreshToken, 'refresh-value');
  assert.equal(result.expiresAt, 3_601_000);
  assert.deepEqual(result.grantedScopes, ['scope-a', 'scope-b']);
  const body = new URLSearchParams(request.init.body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code_verifier'), 'pkce-verifier');
  assert.equal(body.get('client_secret'), 'client-secret');
});

test('missing Refresh Token is a permanent reconnect decision instead of silent success', async () => {
  const client = new GoogleOAuthClient({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchImpl: async () => Response.json({
      access_token: 'access-value',
      expires_in: 3_600,
      scope: 'scope-a',
    }),
  });
  await assert.rejects(
    () => client.exchangeAuthorizationCode({
      code: 'authorization-code',
      redirectUri: 'https://worker.example/oauth/youtube/callback',
    }),
    (error) => error.code === 'GOOGLE_OAUTH_REFRESH_TOKEN_MISSING',
  );
});

test('environment and encrypted adapters share one refresh-provider interface with bounded cache', async () => {
  const environment = new EnvironmentRefreshTokenCredentialAdapter({
    refreshToken: 'legacy-refresh',
  });
  assert.equal(await environment.getRefreshToken(), 'legacy-refresh');

  const reads = [];
  const encrypted = new EncryptedCustomerRefreshTokenCredentialAdapter({
    repository: {
      async read(input) {
        reads.push(input);
        return 'customer-refresh';
      },
    },
    connectionId: 'connection-1',
    connectorKey: 'youtube',
    credentialReference: 'credential-1',
  });
  let refreshes = 0;
  const provider = new GoogleRefreshTokenAccessProvider({
    credentialAdapter: encrypted,
    oauthClient: {
      async refreshAccessToken(input) {
        refreshes += 1;
        assert.equal(input.refreshToken, 'customer-refresh');
        return { accessToken: 'access-value', expiresAt: 3_601_000 };
      },
    },
    clock: () => 1_000,
  });
  assert.equal(await provider.getAccessToken(), 'access-value');
  assert.equal(await provider.getAccessToken(), 'access-value');
  assert.equal(refreshes, 1);
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0], {
    credentialReference: 'credential-1',
    connectionId: 'connection-1',
    connectorKey: 'youtube',
    credentialKind: 'refresh_token',
  });
});
