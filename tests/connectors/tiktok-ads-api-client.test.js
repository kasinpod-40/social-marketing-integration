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

function createClient(fetchImpl) {
  return new TikTokAdsApiClient({
    appId: '7670007933899390993',
    appSecret: 'app-secret',
    fetchImpl,
  });
}
