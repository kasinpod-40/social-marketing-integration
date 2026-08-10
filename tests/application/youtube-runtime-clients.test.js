import test from 'node:test';
import assert from 'node:assert/strict';
import { createYouTubeRuntimeClients } from '../../apps/sync-worker/src/youtube-runtime-clients.js';

const CHANNEL_ID = 'UC_CUSTOMER_CHANNEL';

function validEnv() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_CONNECTION_ENCRYPTION_KEY_VERSION: 'v1',
    MKT_CONNECTION_ENCRYPTION_KEY_V1: 'encryption-key',
    GOOGLE_OAUTH_CLIENT_ID: 'customer-oauth-client',
    GOOGLE_OAUTH_CLIENT_SECRET: 'customer-oauth-secret',
    YOUTUBE_API_KEY: 'public-api-key',
    YOUTUBE_OAUTH_CLIENT_ID: 'legacy-client',
    YOUTUBE_OAUTH_CLIENT_SECRET: 'legacy-secret',
    YOUTUBE_OAUTH_REFRESH_TOKEN: 'legacy-refresh-token-must-not-be-used',
    MKT_STATE_DB: {
      prepare() { throw new Error('unexpected real D1 read'); },
      batch() { throw new Error('unexpected real D1 write'); },
    },
  };
}

function connectionStore() {
  return {
    async findOwnerAuthorizedConnection() {
      return {
        connectionId: 'connection-1',
        customerKey: 'chemistry_k',
        connectorKey: 'youtube',
        externalAccountId: CHANNEL_ID,
        connectionStatus: 'connected',
        accessStatus: 'validated',
        grantedScopes: [
          'https://www.googleapis.com/auth/youtube.readonly',
          'https://www.googleapis.com/auth/yt-analytics.readonly',
        ],
        credentialReference: 'credential-1',
        activeCredentialReference: 'credential-1',
        credentialKeyVersion: 'v1',
      };
    },
  };
}

test('Analytics runtime refreshes only the encrypted Customer Connection credential', async () => {
  const credentialReads = [];
  const refreshInputs = [];
  let ownerConfig;
  const clients = await createYouTubeRuntimeClients(validEnv(), {
    analyticsEnabled: true,
    customerKey: 'chemistry_k',
    channelId: CHANNEL_ID,
    connectionStore: connectionStore(),
    credentialRepository: {
      async read(input) {
        credentialReads.push(input);
        return 'customer-refresh-token';
      },
    },
    oauthClient: {
      async refreshAccessToken(input) {
        refreshInputs.push(input);
        return { accessToken: 'customer-access-token', expiresAt: 3_601_000 };
      },
    },
    clock: () => 1_000,
    ownerClientFactory(config) {
      ownerConfig = config;
      return {
        async getAccessTokenForTest() {
          return config.accessTokenProvider.getAccessToken();
        },
      };
    },
  });

  assert.equal(clients.credentialSource, 'encrypted_customer_connection');
  assert.equal(await clients.ownerClient.getAccessTokenForTest(), 'customer-access-token');
  assert.deepEqual(credentialReads, [{
    credentialReference: 'credential-1',
    connectionId: 'connection-1',
    connectorKey: 'youtube',
    credentialKind: 'refresh_token',
  }]);
  assert.deepEqual(refreshInputs, [{ refreshToken: 'customer-refresh-token' }]);
  assert.ok(ownerConfig.accessTokenProvider);
});

test('Analytics-disabled runtime never reads D1 or creates a legacy Owner client', async () => {
  const clients = await createYouTubeRuntimeClients(validEnv(), {
    analyticsEnabled: false,
    customerKey: 'chemistry_k',
    channelId: CHANNEL_ID,
    connectionStore: {
      async findOwnerAuthorizedConnection() {
        throw new Error('customer connection must not be read');
      },
    },
  });
  assert.equal(clients.ownerClient, null);
  assert.equal(clients.oauthConfigured, false);
});

test('Analytics-enabled runtime rejects the connection before decrypt or refresh on channel drift', async () => {
  let credentialRead = false;
  await assert.rejects(
    () => createYouTubeRuntimeClients(validEnv(), {
      analyticsEnabled: true,
      customerKey: 'chemistry_k',
      channelId: CHANNEL_ID,
      connectionStore: {
        async findOwnerAuthorizedConnection() {
          return {
            ...(await connectionStore().findOwnerAuthorizedConnection()),
            externalAccountId: 'UC_OTHER_CHANNEL',
          };
        },
      },
      credentialRepository: {
        async read() {
          credentialRead = true;
          return 'unexpected';
        },
      },
    }),
    (error) => error.code === 'YOUTUBE_CUSTOMER_CONNECTION_CHANNEL_MISMATCH',
  );
  assert.equal(credentialRead, false);
});
