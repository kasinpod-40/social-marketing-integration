import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTikTokAdsSourceProbeHttpHandler,
  TIKTOK_ADS_SOURCE_PROBE_PATH,
  TIKTOK_ADS_REPORT_PROBE_PATH,
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
    createClient: () => ({
      probeCampaigns: async (input) => {
        calls.push(['provider', input]);
        return { campaignReturned: true, pageSize: 1 };
      },
      probeCampaignDailyReport: async (input) => {
        calls.push(['report', input]);
        return { reportReturned: true, pageSize: 1, paginationAvailable: true,
          metricsPresent: { spend: true, impressions: true, clicks: true } };
      },
      listCampaignMetadata: async () => ({ totalCount: 1, pageCount: 1,
        rows: [{ campaignId: '456', name: 'private-campaign-name', status: 'ENABLE', objective: 'TRAFFIC' }] }),
    }),
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

test('full metadata proof reveals only counts/presence and stored identity matches without writes', async () => {
  const { handler } = setup();
  const fullUrl = new URL(`https://worker.example${TIKTOK_ADS_SOURCE_PROBE_PATH}?metadata=full`);
  const response = await handler({ request: new Request(fullUrl, { headers: { authorization: 'Bearer operator-private' } }),
    url: fullUrl, env: { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private', MKT_STATE_DB: {
      prepare(sql) { assert.match(sql, /^SELECT external_entity_id, source_account_id/u); return { bind(customer, account) {
        assert.equal(customer, 'chemistry_k'); assert.equal(account, customer);
        return { async all() { return { results: [{ external_entity_id: '456', source_account_id: '1234567890123456789' },
          { external_entity_id: '789', source_account_id: '1234567890123456789' }] }; } };
      } }; },
    } } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.probe, { campaigns: 1, pageCount: 1, allNamesPresent: true, allStatusesPresent: true,
    allObjectivesPresent: true, storedCampaigns: 2, matchedStoredCampaigns: 1 });
  assert.doesNotMatch(JSON.stringify(body), /private|1234567890123456789|456|789/);
});

test('unknown metadata query rejects before decrypt or source API', async () => {
  const { handler, calls } = setup();
  const fullUrl = new URL(`https://worker.example${TIKTOK_ADS_SOURCE_PROBE_PATH}?metadata=other`);
  assert.equal((await handler({ request: new Request(fullUrl, { headers: { authorization: 'Bearer operator-private' } }),
    url: fullUrl, env: { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' } })).status, 400);
  assert.deepEqual(calls, []);
});

test('report probe uses same credential boundary and returns no source row', async () => {
  const { handler, calls } = setup();
  const reportUrl = new URL(`https://worker.example${TIKTOK_ADS_REPORT_PROBE_PATH}?date=2026-10-01`);
  const response = await handler({ request: new Request(reportUrl, {
    headers: { authorization: 'Bearer operator-private' },
  }), env: { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' }, url: reportUrl });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, source: 'tiktok_ads', probe: {
    reportReturned: true, pageSize: 1, paginationAvailable: true,
    metricsPresent: { spend: true, impressions: true, clicks: true },
  } });
  assert.deepEqual(calls.map(([name]) => name), ['connection', 'credential', 'report']);
  assert.deepEqual(calls[2][1], {
    accessToken: 'access-private', advertiserId: '1234567890123456789', date: '2026-10-01',
  });
});

test('report probe rejects unauthorized and malformed dates before credential access', async () => {
  const { handler, calls } = setup();
  const reportUrl = new URL(`https://worker.example${TIKTOK_ADS_REPORT_PROBE_PATH}?date=bad`);
  const invalid = await handler({ request: new Request(reportUrl, {
    headers: { authorization: 'Bearer operator-private' },
  }), env: { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' }, url: reportUrl });
  assert.equal(invalid.status, 400);
  assert.deepEqual(calls, []);
  const unauthorized = await handler({ request: new Request(reportUrl, {
    headers: { authorization: 'Bearer wrong' },
  }), env: { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' }, url: reportUrl });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(calls, []);
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
