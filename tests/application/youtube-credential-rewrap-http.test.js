import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createYouTubeCredentialRewrapHttpHandler,
  YOUTUBE_CREDENTIAL_REWRAP_CONFIRMATION,
  YOUTUBE_CREDENTIAL_REWRAP_PATH,
} from '../../apps/sync-worker/src/youtube-credential-rewrap-http.js';

const OPERATOR_TOKEN = 'operator-token-never-returned';

test('disabled YouTube credential rewrap route is indistinguishable from a missing route', async () => {
  const handler = createYouTubeCredentialRewrapHttpHandler();
  const response = await handler(context({}, { method: 'POST' }));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: 'Route not found' });
});

test('YouTube credential rewrap requires exact Integration identity and returns metadata only', async () => {
  const calls = [];
  const handler = createYouTubeCredentialRewrapHttpHandler({
    loadConfig() {
      return {
        environment: 'development',
        customerProfile: 'integration_workspace',
        encryptionKeyVersion: 'v2',
        encryptionKeyVersions: ['v2', 'v1'],
        encryptionKeys: { v2: 'target', v1: 'source' },
      };
    },
    createStore() {
      return {
        async getConnection() {
          return {
            connectionId: 'connection-1',
            customerKey: 'chemistry_k',
            connectorKey: 'youtube',
            connectionStatus: 'connected',
            accessStatus: 'validated',
            credentialReference: 'credential-v1',
          };
        },
      };
    },
    createRepository() {
      return {
        async rewrap(input) {
          calls.push(input);
          return {
            previousReference: 'credential-v1',
            credentialReference: 'credential-v2',
            sourceKeyVersion: 'v1',
            keyVersion: 'v2',
          };
        },
      };
    },
  });
  const response = await handler(context(enabledEnv(), {
    method: 'POST',
    headers: { authorization: `Bearer ${OPERATOR_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      confirmation: YOUTUBE_CREDENTIAL_REWRAP_CONFIRMATION,
      connectionId: 'connection-1',
      credentialReference: 'credential-v1',
      sourceKeyVersion: 'v1',
      targetKeyVersion: 'v2',
    }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(JSON.stringify(body).includes(OPERATOR_TOKEN), false);
  assert.deepEqual(body, {
    ok: true,
    rewrap: {
      connectionId: 'connection-1',
      previousCredentialReference: 'credential-v1',
      credentialReference: 'credential-v2',
      sourceKeyVersion: 'v1',
      keyVersion: 'v2',
    },
  });
  assert.deepEqual(calls, [{
    connectionId: 'connection-1',
    connectorKey: 'youtube',
    credentialKind: 'refresh_token',
    credentialReference: 'credential-v1',
    sourceKeyVersion: 'v1',
  }]);
});

test('YouTube credential rewrap rejects wrong authorization before reading connection state', async () => {
  let loaded = false;
  const handler = createYouTubeCredentialRewrapHttpHandler({
    loadConfig() {
      loaded = true;
      throw new Error('must not load');
    },
  });
  await assert.rejects(
    () => handler(context(enabledEnv(), {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
      body: '{}',
    })),
    (error) => error.code === 'CONNECTION_OPERATOR_UNAUTHORIZED',
  );
  assert.equal(loaded, false);
});

function context(env, requestInit) {
  return {
    env,
    url: new URL(`https://worker.example${YOUTUBE_CREDENTIAL_REWRAP_PATH}`),
    request: new Request(`https://worker.example${YOUTUBE_CREDENTIAL_REWRAP_PATH}`, requestInit),
  };
}

function enabledEnv() {
  return {
    MKT_YOUTUBE_CREDENTIAL_REWRAP_ENABLED: 'true',
    MKT_YOUTUBE_CREDENTIAL_REWRAP_TOKEN: OPERATOR_TOKEN,
  };
}
