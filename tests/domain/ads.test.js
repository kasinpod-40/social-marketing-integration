import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADS_MONEY_SCALE,
  calculateAdsDerivedMetrics,
  createAdsDailyKey,
  createAdsDailyRow,
  createAdsEntityKey,
  currencyAmountToMicros,
} from '../../packages/domain/src/entities/ads.js';

test('ads canonical model creates deterministic platform-scoped keys', () => {
  const input = {
    platform: 'google_ads',
    accountId: 'customer-123',
    entityType: 'ad',
    externalEntityId: 'ad-99',
  };
  assert.equal(
    createAdsEntityKey(input),
    'google_ads:customer-123:ad:ad-99',
  );
  assert.equal(
    createAdsDailyKey({ ...input, metricDate: '2026-07-15' }),
    'google_ads:customer-123:ad:ad-99:2026-07-15',
  );
});

test('ads derived metrics use raw components and preserve null for zero denominator', () => {
  assert.deepEqual(calculateAdsDerivedMetrics({
    spend_micros: 100 * ADS_MONEY_SCALE,
    impressions: 10_000,
    clicks: 200,
    conversions: 4,
    conversion_value_micros: 500 * ADS_MONEY_SCALE,
  }), { ctr: 0.02, cpc: 0.5, cpm: 10, cpa: 25, actual_roas: 5 });
  assert.deepEqual(calculateAdsDerivedMetrics({
    spend_micros: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversion_value_micros: 0,
  }), {
    ctr: null, cpc: null, cpm: null, cpa: null, actual_roas: null,
  });
});

test('ads money parser preserves six-decimal precision without floating-point input', () => {
  assert.equal(currencyAmountToMicros('100.000001', 'spend'), 100_000_001);
  assert.equal(currencyAmountToMicros('0.25', 'spend'), 250_000);
  assert.throws(() => currencyAmountToMicros('1.0000001', 'spend'), /at most 6 places/u);
  assert.throws(() => currencyAmountToMicros(1.25, 'spend'), /decimal string/u);
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
    sourceTimezone: 'Asia/Bangkok',
    currency: 'thb',
    spendMicros: 100 * ADS_MONEY_SCALE,
    impressions: 1_000,
    clicks: 10,
    conversions: 2,
    conversionValueMicros: 250 * ADS_MONEY_SCALE,
  });
  assert.equal(row.platform, 'meta_ads');
  assert.equal(row.ad_channel, 'instagram_ads');
  assert.equal(row.metric_date, Date.parse('2026-07-15T00:00:00+07:00'));
  assert.equal(row.spend, 100);
  assert.equal(row.conversion_value, 250);
  assert.equal(row.actual_roas, 2.5);
});

test('ads daily row uses the ad account timezone including DST', () => {
  const winter = createAdsDailyRow({
    platform: 'meta_ads',
    adChannel: 'facebook_ads',
    accountId: 'account_1',
    entityType: 'account',
    externalEntityId: 'account_1',
    metricDate: '2026-01-15',
    sourceTimezone: 'America/New_York',
    currency: 'USD',
  });
  const summer = createAdsDailyRow({
    platform: 'meta_ads',
    adChannel: 'facebook_ads',
    accountId: 'account_1',
    entityType: 'account',
    externalEntityId: 'account_1',
    metricDate: '2026-07-15',
    sourceTimezone: 'America/New_York',
    currency: 'USD',
  });

  assert.equal(winter.metric_date, Date.parse('2026-01-15T05:00:00Z'));
  assert.equal(summer.metric_date, Date.parse('2026-07-15T04:00:00Z'));
});

test('ads daily row requires timezone and ISO currency even when money metrics are absent', () => {
  assert.throws(() => createAdsDailyRow({
    platform: 'meta_ads',
    adChannel: 'facebook_ads',
    accountId: 'account_1',
    entityType: 'account',
    externalEntityId: 'account_1',
    metricDate: '2026-07-15',
    sourceTimezone: 'Asia/Bangkok',
  }), /currency/u);
  assert.throws(() => createAdsDailyRow({
    platform: 'meta_ads',
    adChannel: 'facebook_ads',
    accountId: 'account_1',
    entityType: 'account',
    externalEntityId: 'account_1',
    metricDate: '2026-07-15',
    currency: 'THB',
  }), /sourceTimezone/u);
});
