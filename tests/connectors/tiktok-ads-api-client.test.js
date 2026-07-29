import test from 'node:test';
import assert from 'node:assert/strict';
import { TikTokAdsApiClient } from '../../packages/connectors/src/tiktok-ads/tiktok-ads-api.client.js';

test('validates only the approved authorized TikTok advertiser', async () => {
  const client = new TikTokAdsApiClient({
    fetch: async (url, request) => {
      assert.equal(request.headers['access-token'], 'provider-token');
      assert.equal(new URL(url).searchParams.get('advertiser_ids'), '["9988"]');
      return new Response(JSON.stringify({
        code: 0,
        data: { list: [{ advertiser_id: '9988', name: 'Chemistry K', currency: 'THB', timezone: 'Asia/Bangkok' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const result = await client.validateAdvertiser({
    accessToken: 'provider-token',
    advertiserId: '9988',
    authorizedAdvertiserIds: ['9988'],
  });
  assert.deepEqual(result, {
    advertiserId: '9988',
    advertiserName: 'Chemistry K',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
  });
});

test('fails closed before provider call when advertiser was not authorized', async () => {
  const client = new TikTokAdsApiClient({ fetch: async () => { throw new Error('must not call'); } });
  await assert.rejects(
    client.validateAdvertiser({
      accessToken: 'provider-token',
      advertiserId: '9988',
      authorizedAdvertiserIds: ['1122'],
    }),
    { code: 'TIKTOK_ADS_ADVERTISER_IDENTITY_MISMATCH' },
  );
});
