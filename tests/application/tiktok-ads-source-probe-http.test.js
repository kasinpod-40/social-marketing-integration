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
      listEntityMetadata: async input => {
        calls.push(['inventory', input]);
        if (overrides.inventoryError) throw overrides.inventoryError;
        if (overrides.inventories) return overrides.inventories[input.kind];
        return { totalCount: 1, pageCount: 1, rows: [{ id: 'private-id', name: 'private-name',
          status: 'ENABLE', campaignId: 'private-parent', adGroupId: 'private-group',
          videoId: 'private-video', imageIds: ['private-image'], optimizationGoal: null }] };
      },
      probeCapability: async input => {
        calls.push(['capability', input]);
        return { kind: input.kind, sampleOnly: true, rowReturned: true, totalCount: 1,
          fieldsPresent: { ad_id: true } };
      },
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

test('capability query is allowlisted and rejects caller identity override before decrypt', async () => {
  const f = setup();
  const env = { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' };
  for (const query of ['?capability=unknown&date=2026-10-02',
    '?capability=ad_metadata&date=2026-10-02&advertiser=999']) {
    const selected = new URL(url.href + query);
    assert.equal((await f.handler({ request: request(), env, url: selected })).status, 400);
  }
  assert.deepEqual(f.calls, []);
  const selected = new URL(url.href + '?capability=ad_metadata&date=2026-10-02');
  const result = await f.handler({ request: request(), env, url: selected });
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(await result.json()).includes('private'), false);
  assert.equal(f.calls.at(-1)[1].advertiserId, '1234567890123456789');
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


test('full inventory exposes aggregate proof only and rejects identity overrides before decrypt', async () => {
  const { handler, calls } = setup();
  const env = { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' };
  for (const query of ['?inventory=unknown', '?inventory=ad&advertiser=999', '?inventory=ad&inventory=ad']) {
    assert.equal((await handler({ request: request(), env, url: new URL(url.href + query) })).status, 400);
  }
  assert.deepEqual(calls, []);
  const response = await handler({ request: request(), env, url: new URL(url.href + '?inventory=ad') });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.probe.sampleOnly, false);
  assert.equal(body.probe.rows, 1);
  assert.equal(body.probe.videos, 1);
  assert.equal(body.probe.images, 1);
  assert.equal(body.probe.adsWithoutAssets, 0);
  assert.doesNotMatch(JSON.stringify(body), /private/);
});


test('pagination diagnostics allow only fixed integer counters, never provider payload', async () => {
  const { handler } = setup({ inventoryError: Object.assign(new Error('private payload'), {
    code: 'TIKTOK_ADS_INVENTORY_PAGINATION_UNSAFE', details: {
      requestedPage: 2, reportedPage: 2, totalPages: 14, totalRows: 1303,
      expectedPages: 14, expectedTotal: 1302, maxPages: 50,
      accessToken: 'private-token', campaignId: 'private-id', providerMessage: 'private-message',
    },
  }) });
  const response = await handler({ request: request(), env: { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' },
    url: new URL(url.href + '?inventory=ad') });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.deepEqual(body.diagnostics, { requestedPage: 2, reportedPage: 2, totalPages: 14,
    totalRows: 1303, expectedPages: 14, expectedTotal: 1302, maxPages: 50 });
  assert.doesNotMatch(JSON.stringify(body), /private/);
});


test('complete hierarchy proof checks actual parents and asset ambiguity without disclosure', async () => {
  const inventories = {
    campaign: { totalCount: 1, rows: [{ id: 'private-campaign' }] },
    ad_group: { totalCount: 1, rows: [{ id: 'private-group', campaignId: 'private-campaign' }] },
    ad: { totalCount: 1, rows: [{ id: 'private-ad', campaignId: 'private-campaign',
      adGroupId: 'private-group', videoId: 'private-video', imageIds: ['private-image'] }] },
  };
  for (const conflict of [false, true]) {
    inventories.ad.rows[0].campaignId = conflict ? 'missing' : 'private-campaign';
    const { handler } = setup({ inventories });
    const response = await handler({ request: request(), env: { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' },
      url: new URL(url.href + '?inventory=hierarchy') });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.probe.hierarchyReconciled, !conflict);
    assert.equal(body.probe.conflictingAdParents, conflict ? 1 : 0);
    assert.equal(body.probe.multiAssetAds, 1);
    assert.equal(body.probe.assetTypeCollisions, 0);
    assert.doesNotMatch(JSON.stringify(body), /private|missing"/);
  }
});


test('automation classification counts only fixed enums and hides unknown source values', async () => {
  const { handler } = setup({ inventories: { campaign: { totalCount: 4, pageCount: 1,
    rows: ['MANUAL', 'SMART_PLUS', 'UPGRADED_SMART_PLUS', 'private-unknown'].map(automationType => ({
      name: 'private-name', status: 'ENABLE', campaignId: 'private-parent', adGroupId: null,
      videoId: null, imageIds: [], automationType,
    })) } } });
  const response = await handler({ request: request(), env: { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' },
    url: new URL(url.href + '?inventory=campaign') });
  const body = await response.json();
  assert.deepEqual(body.probe.automationCounts, { MANUAL: 1, SMART_PLUS: 1, UPGRADED_SMART_PLUS: 1, unknown: 1 });
  assert.doesNotMatch(JSON.stringify(body), /private/);
});


test('Smart+ hierarchy separates creative endpoint rows from true Ad identities', async () => {
  const inventories = {
    campaign: { totalCount: 1, rows: [{ id: 'private-campaign', automationType: 'UPGRADED_SMART_PLUS' }] },
    ad_group: { totalCount: 1, rows: [{ id: 'private-group', campaignId: 'private-campaign' }] },
    ad: { totalCount: 1, rows: [{ id: 'private-creative', campaignId: 'private-campaign',
      adGroupId: 'private-group', videoId: null, imageIds: [] }] },
    smart_ad: { totalCount: 1, rows: [{ id: 'private-smart-ad', campaignId: 'private-campaign',
      adGroupId: 'private-group', creativeItems: 1, creativeIds: ['private-creative'] }] },
  };
  const { handler } = setup({ inventories });
  const response = await handler({ request: request(), env: { MKT_CONNECTION_OPERATOR_TOKEN: 'operator-private' },
    url: new URL(url.href + '?inventory=smart_hierarchy') });
  const body = await response.json();
  assert.equal(body.probe.smartAds, 1);
  assert.equal(body.probe.upgradedCreativeRows, 1);
  assert.equal(body.probe.manualOrLegacyAdRows, 0);
  assert.equal(body.probe.missingCreativeReferences, 0);
  assert.equal(body.probe.conflictingCreativeParents, 0);
  assert.doesNotMatch(JSON.stringify(body), /private/);
});
