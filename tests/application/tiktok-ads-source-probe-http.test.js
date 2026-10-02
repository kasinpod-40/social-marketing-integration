import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTikTokAdsSourceProbeHttpHandler,
  TIKTOK_ADS_SOURCE_PROBE_PATH,
} from '../../apps/sync-worker/src/tiktok-ads-source-probe-http.js';

const url = new URL(`https://worker.example${TIKTOK_ADS_SOURCE_PROBE_PATH}`);
const request = (token = 'operator-private') => new Request(url, {
  headers: { authorization: `Bearer ${token}` },
});

function setup(overrides = {}) {
  const calls = [];
  const connection = {
    connectionId: 'connection-1', connectionStatus: 'connected', accessStatus: 'validated',
    credentialReference: 'credential-1', externalAccountId: '1234567890123456789',
    ...overrides.connection,
  };
  const handler = createTikTokAdsSourceProbeHttpHandler({
    createRuntime: () => ({
      config: {
        environment: 'production', customerProfile: 'chemistry_k', customerKey: 'chemistry_k',
        ...overrides.runtimeConfig,
      },
      store: { findConnectionByCustomerConnector: async (input) => {
        calls.push(['connection', input]);
        return connection;
      } },
      credentials: { read: async (input) => {
        calls.push(['credential', input]);
        return 'access-private';
      } },
    }),
    loadAdsConfig: () => ({ approvedAdvertiserId: overrides.approvedAdvertiserId ?? null }),
    createClient: () => ({ probeCampaigns: async (input) => {
      calls.push(['provider', input]);
      return { campaignReturned: true, pageSize: 1 };
    } }),
  });
  return { handler, calls };
}

test('source probe reads bound credential and returns sanitized GET-only result', async () => {
  const { handler, calls } = setup();
  const response = await handler({ request: request(), env: {
    MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private',
  }, url });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, source: 'tiktok_ads', probe: { campaignReturned: true, pageSize: 1 },
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls.map(([name]) => name), ['connection', 'credential', 'provider']);
  assert.deepEqual(calls[1][1], {
    credentialReference: 'credential-1', connectionId: 'connection-1',
    connectorKey: 'tiktok_ads', credentialKind: 'access_token',
  });
});

test('source probe blocks other runtime profiles before connection and provider access', async () => {
  const { handler, calls } = setup({ runtimeConfig: { customerProfile: 'integration_workspace' } });
  const response = await handler({ request: request(), env: {
    MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private',
  }, url });
  assert.equal(response.status, 502);
  assert.deepEqual(calls, []);
});

test('source probe rejects operator and mismatched advertiser before decrypt/provider', async () => {
  const { handler, calls } = setup({
    approvedAdvertiserId: '1234567890123456789',
    connection: { externalAccountId: '9876543210987654321' },
  });
  const env = { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' };
  const unauthorized = await handler({ request: request('wrong'), env, url });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(calls, []);
  const mismatched = await handler({ request: request(), env, url });
  assert.equal(mismatched.status, 409);
  assert.deepEqual(calls.map(([name]) => name), ['connection']);
});
