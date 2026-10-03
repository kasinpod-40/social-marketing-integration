import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokAdsCampaignMetadataHttpHandler } from '../../apps/sync-worker/src/tiktok-ads-campaign-metadata-http.js';

function fixture() {
  const calls = [];
  const env = { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-test', MKT_STATE_DB: {} };
  const handler = createTikTokAdsCampaignMetadataHttpHandler({ hydrate: async raw => { calls.push('hydrate'); return raw; },
    createRuntime: () => ({ config: { environment: 'production', customerProfile: 'chemistry_k', customerKey: 'chemistry_k' },
      store: { async findConnectionByCustomerConnector() { return { connectionStatus: 'connected', accessStatus: 'validated',
        credentialReference: 'test', connectionId: 'test', externalAccountId: '123' }; } },
      credentials: { async read() { return 'private-access'; } } }),
    loadAdsConfig: () => ({}), createClient: () => ({}), historyStore: {}, lockStore: {},
    async reconcile(input) { calls.push(input.execute ? 'execute' : 'preview');
      assert.equal(input.advertiserId, '123'); return { changed: 1, matchedCampaigns: 1 }; },
  });
  const call = (method = 'GET', query = '', token = 'operator-test') => {
    const url = new URL(`https://worker.example/operator/tiktok-ads/campaign-metadata${query}`);
    return handler({ env, url, request: new Request(url, { method, headers: { authorization: `Bearer ${token}` } }) });
  };
  return { env, calls, call };
}

test('metadata HTTP authenticates and validates query before hydration; default POST gate is closed', async () => {
  const f = fixture();
  assert.equal((await f.call('GET', '', 'wrong')).status, 401);
  assert.equal((await f.call('GET', '?advertiser=999')).status, 400);
  assert.deepEqual(f.calls, []);
  assert.equal((await f.call('POST')).status, 409);
  assert.equal(f.calls.includes('execute'), false);
});

test('metadata HTTP preview/write expose counts and never source credentials or metadata', async () => {
  const f = fixture();
  assert.equal((await f.call()).status, 200);
  f.env.MKT_TIKTOK_ADS_METADATA_WRITE_ENABLED = 'true';
  const result = await f.call('POST');
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), { ok: true, result: { changed: 1, matchedCampaigns: 1 } });
  assert.deepEqual(f.calls, ['hydrate', 'preview', 'hydrate', 'execute']);
});
