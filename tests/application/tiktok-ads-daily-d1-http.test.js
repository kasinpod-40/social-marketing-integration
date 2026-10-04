import { buildTikTokAdsDailyWriteSet } from '../../packages/application/src/tiktok-ads/tiktok-ads-daily-write-set.js';
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
    createClient: () => ({ listAllStatusDailyReport: async input => {
      calls.push(['full-read', input]); return { rows: [{ ...row, dimensions: { ad_id_v2: '678', stat_time_day: date } }], totalCount: 1, pageCount: 1 };
    }, listCampaignDailyReport: async (input) => {
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


test('multi-grain POST requires its separate gate and unknown query/grain rejects before source', async () => {
  const f = setup(); const env = { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private', MKT_TIKTOK_ADS_D1_WRITE_ENABLED: 'true' };
  for (const query of ['&grain=creative', '&grain=ad&advertiser=999', '&anything=1']) {
    assert.equal((await f.handler({ request: request('POST'), url: new URL(address + query), env })).status, 400);
  }
  assert.equal((await f.handler({ request: request('POST'), url: new URL(address + '&grain=ad'), env })).status, 409);
  assert.deepEqual(f.calls, []);
  const response = await f.handler({ request: request('POST'), url: new URL(address + '&grain=ad'),
    env: { ...env, MKT_TIKTOK_ADS_MULTI_GRAIN_WRITE_ENABLED: 'true' } });
  assert.equal(response.status, 200); assert.equal(f.calls[0][1].grain, 'ad');
  assert.equal(f.calls[0][1].allStatuses, true); assert.equal(f.calls[0][1].multiGrainWriteEnabled, true);
});


test('full Ad GET validates exact master parents then independently reads back all D1 fields without writes', async () => {
  const f = setup(); const advertiserId = '1234567890123456789';
  const masters = [
    { entity_type: 'campaign', external_entity_id: '456', source_account_id: advertiserId },
    { entity_type: 'ad_group', external_entity_id: '567', source_account_id: advertiserId, parent_campaign_id: '456' },
    { entity_type: 'ad', external_entity_id: '678', source_account_id: advertiserId, parent_campaign_id: '456', parent_ad_group_id: '567' },
  ];
  const writeSet = await buildTikTokAdsDailyWriteSet({ customerKey: 'chemistry_k', accountKey: 'chemistry_k',
    advertiserId, currency: 'THB', timezone: 'Asia/Bangkok', date, syncRunId: 'test', now: Date.now(),
    grain: 'ad', allStatuses: true, parents: new Map(masters.map(row => [`${row.entity_type}:${row.external_entity_id}`, row])),
    rows: [{ ...row, dimensions: { ad_id_v2: '678', stat_time_day: date } }] });
  const db = { prepare(sql) { assert.match(sql, /^SELECT/u); return { bind() { return { async all() {
    return { results: sql.includes('FROM ads_entity_state') ? masters : writeSet.dailyFacts }; } }; } }; } };
  const response = await f.handler({ request: request(), url: new URL(address + '&grain=ad'),
    env: { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private', MKT_STATE_DB: db } });
  assert.equal(response.status, 200); const body = await response.json();
  assert.deepEqual(body.readback, { rows: 1, reconciled: true });
  assert.deepEqual(f.calls.map(row => row[0]), ['full-read']);
  assert.doesNotMatch(JSON.stringify(body), /private|678|1234567890123456789|12.34/);
});
