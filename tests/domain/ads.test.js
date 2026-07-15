import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAdsDerivedMetrics,
  createAdsDailyKey,
  createAdsDailyRow,
  createAdsEntityKey,
} from '../../packages/domain/src/entities/ads.js';

test('ads canonical model creates deterministic platform-scoped keys', () => {
  const input = {
    platform: 'google_ads',
    accountId: 'customer-123',
    entityType: 'creative',
    externalEntityId: 'ad-99',
  };
  assert.equal(
    createAdsEntityKey(input),
    'google_ads:customer-123:creative:ad-99',
  );
  assert.equal(
    createAdsDailyKey({ ...input, metricDate: '2026-07-15' }),
    'google_ads:customer-123:creative:ad-99:2026-07-15',
  );
});

test('ads derived metrics use raw components and preserve null for zero denominator', () => {
  assert.deepEqual(calculateAdsDerivedMetrics({
    spend: 100,
    impressions: 10_000,
    clicks: 200,
    conversion_value: 500,
  }), { ctr: 0.02, cpc: 0.5, cpm: 10, actual_roas: 5 });
  assert.deepEqual(calculateAdsDerivedMetrics({ spend: 0, impressions: 0, clicks: 0, conversion_value: 0 }), {
    ctr: null, cpc: null, cpm: null, actual_roas: null,
  });
});

test('ads daily row keeps platform and client-facing channel separate', () => {
  const row = createAdsDailyRow({
    platform: 'meta_ads',
    adChannel: 'instagram_ads',
    accountId: 'account_1',
    entityType: 'campaign',
    externalEntityId: 'campaign_1',
    externalCampaignId: 'campaign_1',
    metricDate: '2026-07-15',
    currency: 'thb',
    spend: 100,
    impressions: 1_000,
    clicks: 10,
    conversions: 2,
    conversionValue: 250,
  });
  assert.equal(row.platform, 'meta_ads');
  assert.equal(row.ad_channel, 'instagram_ads');
  assert.equal(row.actual_roas, 2.5);
});
