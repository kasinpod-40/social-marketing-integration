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
  assert.deepEqual(await response.json(), { ok: false, stage: 'projection', code: 'LARK_FAILED' });
});

test('standalone projection hydrates non-secret config after auth/query guard and before source runtime', async () => {
  const f = setup();
  const calls = [];
  const originalRuntime = f.dependencies.createRuntime;
  f.dependencies.hydrate = async raw => {
    calls.push('hydrate');
    return { ...raw, migrated: true, LARK_TABLE_MKT_ADS_CAMPAIGNS: 'tblCampaigns', LARK_TABLE_MKT_ADS_DAILY: 'tblDaily' };
  };
  f.dependencies.createRuntime = runtime => {
    calls.push('source_runtime');
    assert.equal(runtime.migrated, true);
    return originalRuntime();
  };
  const handle = createTikTokAdsLarkProjectionHttpHandler(f.dependencies);
  assert.equal((await handle(request('GET', 'date=2026-10-02', 'wrong'))).status, 401);
  assert.equal((await handle(request('GET', 'date=bad'))).status, 400);
  assert.deepEqual(calls, []);
  assert.equal((await handle(request())).status, 200);
  assert.deepEqual(calls, ['hydrate', 'source_runtime']);
});


test('Ad projection requires its separate write gate and rejects unapproved grain before hydration', async () => {
  const f = setup(); const query = 'date=2026-10-02&grain=ad';
  const enabled = { ...env, MKT_TIKTOK_ADS_LARK_WRITE_ENABLED: 'true' };
  assert.equal((await f.handle({ ...request('POST', query), env: enabled })).status, 409);
  assert.equal((await f.handle(request('GET', 'date=2026-10-02&grain=creative'))).status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.handle({ ...request('POST', query), env: { ...enabled,
    MKT_TIKTOK_ADS_AD_LARK_WRITE_ENABLED: 'true' } })).status, 200);
  assert.equal(f.calls[0].grain, 'ad'); assert.equal(f.calls[0].adWriteEnabled, true);
});

test('monthly Summary route has separate admission and exact mapped Summary table', async () => {
  const f = setup();
  f.dependencies.hydrate = async env => ({ ...env, LARK_TABLE_MKT_ADS_CAMPAIGN_SUMMARY: 'tblSummary' });
  f.dependencies.projectSummary = async input => { f.calls.push(input); return { campaigns: 1 }; };
  const handle = createTikTokAdsLarkProjectionHttpHandler(f.dependencies);
  const make = (method, query, enabled = false) => {
    const req = new Request(`https://example.test/operator/tiktok-ads/campaign-summary?${query}`,
      { method, headers: { authorization: 'Bearer operator-private' } });
    return { request: req, url: new URL(req.url), env: { ...env, MKT_TIKTOK_ADS_SUMMARY_WRITE_ENABLED: String(enabled) } };
  };
  assert.equal((await handle(make('GET', 'month=2026-13'))).status, 400);
  assert.equal((await handle(make('POST', 'month=2026-09'))).status, 409);
  assert.equal((await handle(make('GET', 'month=2026-09&account=other'))).status, 400);
  const response = await handle(make('POST', 'month=2026-09', true));
  assert.equal(response.status, 200); assert.equal(f.calls[0].month, '2026-09');
  assert.deepEqual(f.calls[0].tables, { mktAdsCampaignSummary: 'tblSummary' });
  assert.equal(f.calls[0].writeEnabled, true);
  assert.doesNotMatch(await response.text(), /private|tblSummary|1234567890123456789/u);
});
