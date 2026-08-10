import test from 'node:test';
import assert from 'node:assert/strict';
import { assertYouTubeOwnerAuthorization } from '../../packages/application/src/connections/youtube-owner-authorization.js';

const CHANNEL_ID = 'UC_CUSTOMER_CHANNEL';

function connection(overrides = {}) {
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
    lastValidatedAt: 1785031200000,
    ...overrides,
  };
}

function store(value) {
  return { async findOwnerAuthorizedConnection() { return value; } };
}

test('validated encrypted Customer Connection authorizes exact YouTube Owner channel', async () => {
  const result = await assertYouTubeOwnerAuthorization({
    connectionStore: store(connection()),
    customerKey: 'chemistry_k',
    channelId: CHANNEL_ID,
  });
  assert.deepEqual(result, {
    connectionId: 'connection-1',
    credentialReference: 'credential-1',
    credentialKeyVersion: 'v1',
    customerKey: 'chemistry_k',
    channelId: CHANNEL_ID,
    lastValidatedAt: 1785031200000,
    authorizationSource: 'encrypted_customer_connection',
  });
  assert.equal(JSON.stringify(result).includes('refresh'), false);
});

test('missing, invalid, insufficient-scope and inactive YouTube connections fail closed', async () => {
  await assert.rejects(
    () => assertYouTubeOwnerAuthorization({
      connectionStore: store(null), customerKey: 'chemistry_k', channelId: CHANNEL_ID,
    }),
    (error) => error.code === 'YOUTUBE_CUSTOMER_CONNECTION_REQUIRED',
  );
  await assert.rejects(
    () => assertYouTubeOwnerAuthorization({
      connectionStore: store(connection({ accessStatus: 'not_validated' })),
      customerKey: 'chemistry_k', channelId: CHANNEL_ID,
    }),
    (error) => error.code === 'YOUTUBE_CUSTOMER_CONNECTION_STATE_INVALID',
  );
  await assert.rejects(
    () => assertYouTubeOwnerAuthorization({
      connectionStore: store(connection({ grantedScopes: [] })),
      customerKey: 'chemistry_k', channelId: CHANNEL_ID,
    }),
    (error) => error.code === 'YOUTUBE_CUSTOMER_CONNECTION_SCOPE_INSUFFICIENT',
  );
  await assert.rejects(
    () => assertYouTubeOwnerAuthorization({
      connectionStore: store(connection({ activeCredentialReference: null })),
      customerKey: 'chemistry_k', channelId: CHANNEL_ID,
    }),
    (error) => error.code === 'YOUTUBE_CUSTOMER_CREDENTIAL_UNAVAILABLE',
  );
});

test('stored customer channel must equal the configured runtime Channel before token use', async () => {
  await assert.rejects(
    () => assertYouTubeOwnerAuthorization({
      connectionStore: store(connection({ externalAccountId: 'UC_OTHER_CHANNEL' })),
      customerKey: 'chemistry_k', channelId: CHANNEL_ID,
    }),
    (error) => error.code === 'YOUTUBE_CUSTOMER_CONNECTION_CHANNEL_MISMATCH',
  );
});
