import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTikTokAdsDailyD1HttpHandler,
  TIKTOK_ADS_DAILY_D1_PATH,
} from '../../apps/sync-worker/src/tiktok-ads-daily-d1-http.js';

const date = '2026-10-01';
const address = `https://worker.example${TIKTOK_ADS_DAILY_D1_PATH}?date=${date}`;
const row = {
  dimensions: { campaign_id: '456', stat_time_day: date },
  metrics: { spend: '12.34', impressions: '100', clicks: '4' },
};

function setup() {
  const calls = [];
  const handler = createTikTokAdsDailyD1HttpHandler({
    createRuntime: () => ({
      config: { environment: 'production', customerProfile: 'chemistry_k', customerKey: 'chemistry_k' },
      store: { findConnectionByCustomerConnector: async () => ({
        connectionId: 'connection-1', connectionStatus: 'connected', accessStatus: 'validated',
        credentialReference: 'credential-1', externalAccountId: '1234567890123456789',
        providerMetadata: { currency: 'THB', timezone: 'Asia/Bangkok' },
      }) },
      credentials: { read: async () => 'access-private' },
    }),
    loadAdsConfig: () => ({ approvedAdvertiserId: '1234567890123456789' }),
    createClient: () => ({ listCampaignDailyReport: async (input) => {
      calls.push(['read', input]);
      return { rows: [row], totalCount: 1, pageCount: 1 };
    } }),
    runSync: async (input) => {
      calls.push(['write', input]);
      return { status: 'revisable', date, rows: 1, written: 1 };
    },
    historyStore: {}, lockStore: {},
  });
  return { handler, calls };
}

function request(method = 'GET', token = 'operator-private') {
  return new Request(address, { method, headers: { authorization: `Bearer ${token}` } });
}

test('daily D1 preview validates every source row and returns counts without writes', async () => {
  const { handler, calls } = setup();
  const response = await handler({ request: request(), url: new URL(address), env: {
    MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private',
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, source: 'tiktok_ads', mode: 'preview', rows: 1, pageCount: 1,
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls.map(([name]) => name), ['read']);
});

test('daily D1 execute requires operator authorization and explicit write gate', async () => {
  const { handler, calls } = setup();
  const url = new URL(address);
  const env = { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' };
  assert.equal((await handler({ request: request('POST', 'wrong'), url, env })).status, 401);
  assert.equal((await handler({ request: request('POST'), url, env })).status, 409);
  assert.deepEqual(calls, []);
  const response = await handler({ request: request('POST'), url, env: {
    ...env, MKT_TIKTOK_ADS_D1_WRITE_ENABLED: 'true', MKT_STATE_DB: { prepare() {} },
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, source: 'tiktok_ads', mode: 'execute',
    result: { status: 'revisable', date, rows: 1, written: 1 },
  });
  assert.deepEqual(calls.map(([name]) => name), ['write']);
  assert.equal(calls[0][1].businessWriteEnabled, true);
});
