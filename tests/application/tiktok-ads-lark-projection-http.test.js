import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokAdsLarkProjectionHttpHandler } from '../../apps/sync-worker/src/tiktok-ads-lark-projection-http.js';

function setup() {
  const calls = [];
  const dependencies = {
    createRuntime: () => ({
      config: { environment: 'production', customerProfile: 'chemistry_k', customerKey: 'chemistry_k' },
      store: { findConnectionByCustomerConnector: async () => ({
        connectionId: 'connection-test', connectionStatus: 'connected', accessStatus: 'validated',
        credentialReference: 'credential-test', externalAccountId: '1234567890123456789',
        providerMetadata: { currency: 'THB', timezone: 'Asia/Bangkok' },
      }) }, credentials: { read: async () => 'access-private' },
    }),
    loadAdsConfig: () => ({ approvedAdvertiserId: '1234567890123456789' }),
    createClient: () => ({ listCampaignDailyReport() { throw new Error('Source call forbidden'); } }),
    hydrate: async env => ({ ...env, LARK_TABLE_MKT_ADS_CAMPAIGNS: 'tblCampaigns', LARK_TABLE_MKT_ADS_DAILY: 'tblDaily' }),
    createLarkClient: () => ({}), repository: {}, syncEngine: {}, lockStore: {},
    project: async input => { calls.push(input); return { mode: input.execute ? 'execute' : 'preview', facts: 1 }; },
  };
  return { calls, dependencies, handle: createTikTokAdsLarkProjectionHttpHandler(dependencies) };
}
const env = { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' };
function request(method = 'GET', query = 'date=2026-10-02', token = 'operator-private') {
  const req = new Request(`https://example.test/operator/tiktok-ads/lark-projection?${query}`,
    { method, headers: { authorization: `Bearer ${token}` } });
  return { request: req, url: new URL(req.url), env };
}

test('projection route validates operator/query/write gate before Lark or projection', async () => {
  const f = setup();
  assert.equal((await f.handle(request('GET', 'date=2026-10-02', 'wrong'))).status, 401);
  assert.equal((await f.handle(request('DELETE'))).status, 405);
  assert.equal((await f.handle(request('GET', 'date=bad'))).status, 400);
  assert.equal((await f.handle(request('GET', 'date=2026-10-02&account=other'))).status, 400);
  assert.equal((await f.handle(request('POST'))).status, 409);
  assert.equal(f.calls.length, 0);
});

test('projection route uses validated advertiser and mapped tables without Source calls or data disclosure', async () => {
  const f = setup();
  const response = await f.handle({ ...request('POST'), env: { ...env, MKT_TIKTOK_ADS_LARK_WRITE_ENABLED: 'true' } });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.doesNotMatch(body, /private|1234567890123456789|tblCampaigns|tblDaily/);
  assert.equal(f.calls[0].advertiserId, '1234567890123456789');
  assert.equal(f.calls[0].execute, true);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('projection API failure exposes code only and cannot claim completion', async () => {
  const f = setup();
  f.dependencies.project = async () => { const error = new Error('credential-private response'); error.code = 'LARK_FAILED'; throw error; };
  const response = await createTikTokAdsLarkProjectionHttpHandler(f.dependencies)(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, code: 'LARK_FAILED' });
});
