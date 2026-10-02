import test from 'node:test';
import assert from 'node:assert/strict';
import { TikTokAdsApiClient } from '../../packages/connectors/src/tiktok-ads/tiktok-ads-api.client.js';

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

function createClient(fetchImpl) {
  return new TikTokAdsApiClient({
    appId: '7670007933899390993',
    appSecret: 'app-secret',
    fetchImpl,
  });
}
