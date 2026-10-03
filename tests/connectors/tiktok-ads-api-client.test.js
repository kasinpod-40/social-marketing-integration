import test from 'node:test';
import assert from 'node:assert/strict';
import { TikTokAdsApiClient } from '../../packages/connectors/src/tiktok-ads/tiktok-ads-api.client.js';

test('capability discovery uses bounded all-status ad report and discloses only field presence', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url: new URL(url), init });
    return Response.json({ code: 0, data: { page_info: { total_number: 22 }, list: [{
      dimensions: { ad_id: 'private-id', stat_time_day: '2026-10-02 00:00:00' },
      metrics: { spend: 'private-value', impressions: '500', clicks: '4' },
    }] } });
  });
  const result = await client.probeCapability({ advertiserId: '123', accessToken: 'private',
    kind: 'ad_base', date: '2026-10-02' });
  assert.equal(result.totalCount, 22);
  assert.equal(result.sampleOnly, true);
  assert.equal(result.dateMatched, true);
  assert.deepEqual(result.fieldsPresent, { spend: true, impressions: true, clicks: true });
  assert.equal(calls[0].url.searchParams.get('data_level'), 'AUCTION_AD');
  assert.equal(calls[0].url.searchParams.get('page_size'), '1');
  assert.match(calls[0].url.searchParams.get('filtering'), /STATUS_ALL/u);
  assert.equal(JSON.stringify(result).includes('private'), false);
  await assert.rejects(client.probeCapability({ kind: 'arbitrary_endpoint' }));
  assert.equal(calls.length, 1);
});

test('metadata capability rejects a returned foreign advertiser without exposing response', async () => {
  const client = createClient(async () => Response.json({ code: 0, data: {
    page_info: { total_number: 1 }, list: [{ advertiser_id: '999', ad_id: '456' }],
  } }));
  await assert.rejects(client.probeCapability({ advertiserId: '123', accessToken: 'private',
    kind: 'ad_metadata' }), { code: 'TIKTOK_ADS_CAPABILITY_OWNER_CONFLICT' });
});

test('TikTok Ads advertiser discovery uses official v1.3 auth boundary', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url: url.toString(), init });
    return Response.json({
      code: 0,
      data: { list: [{ advertiser_id: '1234567890123456789', advertiser_name: 'Chemistry K' }] },
    });
  });
  const rows = await client.listAuthorizedAdvertisers({ accessToken: 'access-private' });
  assert.deepEqual(rows, [{
    advertiserId: '1234567890123456789',
    advertiserName: 'Chemistry K',
  }]);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/open_api/v1.3/oauth2/advertiser/get/');
  assert.equal(url.searchParams.get('app_id'), '7670007933899390993');
  assert.equal(url.searchParams.get('secret'), 'app-secret');
  assert.equal(calls[0].init.headers['Access-Token'], 'access-private');
});

test('TikTok Ads advertiser info validates exact authorized identity', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url: url.toString(), init });
    return Response.json({
      code: 0,
      data: {
        list: [{
          advertiser_id: '1234567890123456789',
          name: 'Chemistry K',
          currency: 'THB',
          timezone: 'Asia/Bangkok',
        }],
      },
    });
  });
  const row = await client.getAdvertiser({
    accessToken: 'access-private',
    advertiserId: '1234567890123456789',
  });
  assert.deepEqual(row, {
    advertiserId: '1234567890123456789',
    advertiserName: 'Chemistry K',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
  });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/open_api/v1.3/advertiser/info/');
  assert.equal(url.searchParams.get('advertiser_ids'), '["1234567890123456789"]');
  assert.equal(calls[0].init.headers['Access-Token'], 'access-private');
});

test('TikTok Ads campaign probe uses a bounded GET and returns no campaign data', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url: url.toString(), init });
    return Response.json({ code: 0, data: { list: [{ campaign_id: 'private-id' }] } });
  });
  const result = await client.probeCampaigns({
    accessToken: 'access-private', advertiserId: '1234567890123456789',
  });
  assert.deepEqual(result, { campaignReturned: true, pageSize: 1 });
  assert.equal(JSON.stringify(result).includes('private-id'), false);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/open_api/v1.3/campaign/get/');
  assert.equal(url.searchParams.get('advertiser_id'), '1234567890123456789');
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('page_size'), '1');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers['Access-Token'], 'access-private');
});

test('TikTok Ads report probe requests one campaign-day row and reveals only metric presence', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    calls.push({ url: url.toString(), init });
    return Response.json({ code: 0, data: {
      list: [{ dimensions: { campaign_id: 'private-id' }, metrics: {
        spend: '12.34', impressions: '100', clicks: '4', private_metric: 'secret',
      } }],
      page_info: { total_number: 123 },
    } });
  });
  const result = await client.probeCampaignDailyReport({
    accessToken: 'access-private', advertiserId: '1234567890123456789', date: '2026-10-01',
  });
  assert.deepEqual(result, {
    reportReturned: true, pageSize: 1, paginationAvailable: true,
    metricsPresent: { spend: true, impressions: true, clicks: true },
  });
  assert.equal(JSON.stringify(result).includes('private-id'), false);
  assert.equal(JSON.stringify(result).includes('12.34'), false);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/open_api/v1.3/report/integrated/get/');
  assert.equal(url.searchParams.get('report_type'), 'BASIC');
  assert.equal(url.searchParams.get('data_level'), 'AUCTION_CAMPAIGN');
  assert.deepEqual(JSON.parse(url.searchParams.get('dimensions')), ['campaign_id', 'stat_time_day']);
  assert.deepEqual(JSON.parse(url.searchParams.get('metrics')), ['spend', 'impressions', 'clicks']);
  assert.equal(url.searchParams.get('start_date'), '2026-10-01');
  assert.equal(url.searchParams.get('end_date'), '2026-10-01');
  assert.equal(url.searchParams.get('page_size'), '1');
  assert.equal(url.toString().includes('access-private'), false);
  assert.equal(calls[0].init.headers['Access-Token'], 'access-private');
  await assert.rejects(client.probeCampaignDailyReport({
    accessToken: 'access-private', advertiserId: '1234567890123456789', date: '2026-02-30',
  }), /real YYYY-MM-DD date/u);
  assert.equal(calls.length, 1);
});

test('TikTok Ads daily report reads bounded pages and rejects incomplete pagination', async () => {
  const calls = [];
  const row = (id) => ({ dimensions: { campaign_id: id, stat_time_day: '2026-10-01' },
    metrics: { spend: '1.00', impressions: '2', clicks: '1' } });
  const client = createClient(async (url) => {
    const page = Number(url.searchParams.get('page'));
    calls.push(page);
    return Response.json({ code: 0, data: {
      list: page === 1 ? Array.from({ length: 100 }, (_, index) => row(String(index + 1))) : [row('101')],
      page_info: { page, total_page: 2, total_number: 101 },
    } });
  });
  const result = await client.listCampaignDailyReport({
    accessToken: 'access-private', advertiserId: '1234567890123456789', date: '2026-10-01',
  });
  assert.equal(result.rows.length, 101);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(calls, [1, 2]);

  const incomplete = createClient(async () => Response.json({ code: 0, data: {
    list: [row('1')], page_info: { page: 1, total_page: 1, total_number: 2 },
  } }));
  await assert.rejects(incomplete.listCampaignDailyReport({
    accessToken: 'access-private', advertiserId: '1234567890123456789', date: '2026-10-01',
  }), { code: 'TIKTOK_ADS_DAILY_REPORT_INCOMPLETE' });
});

test('Campaign metadata shares complete bounded pagination and strips unrelated provider fields', async () => {
  const calls = [];
  const client = createClient(async (url, init) => {
    const page = Number(url.searchParams.get('page'));
    calls.push(page);
    assert.equal(url.pathname, '/open_api/v1.3/campaign/get/');
    assert.equal(url.searchParams.get('page_size'), '100');
    assert.equal(init.headers['Access-Token'], 'access-private');
    return Response.json({ code: 0, data: { list: [{ campaign_id: String(page),
      advertiser_id: '1234567890123456789', campaign_name: `Campaign ${page}`, operation_status: 'ENABLE',
      objective_type: 'TRAFFIC', private_data: 'do-not-retain' }],
    page_info: { page, total_page: 2, total_number: 2 } } });
  });
  const result = await client.listCampaignMetadata({ accessToken: 'access-private', advertiserId: '1234567890123456789' });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.totalCount, 2);
  assert.deepEqual(result.rows[0], { campaignId: '1', name: 'Campaign 1', status: 'ENABLE', objective: 'TRAFFIC' });
  assert.doesNotMatch(JSON.stringify(result), /do-not-retain|private_data|access-private/);
});

test('Campaign metadata rejects duplicate, wrong advertiser, incomplete and excessive pagination', async () => {
  const row = { campaign_id: '123', advertiser_id: '1234567890123456789' };
  for (const [list, info, code] of [
    [[row, row], { page: 1, total_page: 1, total_number: 2 }, 'IDENTITY_CONFLICT'],
    [[{ ...row, advertiser_id: '999' }], { page: 1, total_page: 1, total_number: 1 }, 'IDENTITY_CONFLICT'],
    [[row], { page: 1, total_page: 1, total_number: 2 }, 'INCOMPLETE'],
    [[row], { page: 1, total_page: 6, total_number: 600 }, 'PAGINATION_UNSAFE'],
  ]) {
    const client = createClient(async () => Response.json({ code: 0, data: { list, page_info: info } }));
    await assert.rejects(client.listCampaignMetadata({ accessToken: 'access-private', advertiserId: '1234567890123456789' }),
      { code: `TIKTOK_ADS_CAMPAIGN_METADATA_${code}` });
  }
  const missing = createClient(async () => Response.json({ code: 0, data: {
    list: [row], page_info: { page: 1, total_page: 1, total_number: 1 },
  } }));
  const result = await missing.listCampaignMetadata({ accessToken: 'access-private', advertiserId: '1234567890123456789' });
  assert.deepEqual(result.rows[0], { campaignId: '123', name: null, status: null, objective: null });
});

function createClient(fetchImpl) {
  return new TikTokAdsApiClient({
    appId: '7670007933899390993',
    appSecret: 'app-secret',
    fetchImpl,
  });
}
