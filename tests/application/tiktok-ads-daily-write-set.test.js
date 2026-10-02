import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTikTokAdsDailyWriteSet } from '../../packages/application/src/tiktok-ads/tiktok-ads-daily-write-set.js';

const base = Object.freeze({
  customerKey: 'chemistry_k', accountKey: 'chemistry_k', advertiserId: '1234567890123456789',
  currency: 'THB', timezone: 'Asia/Bangkok', date: '2026-10-01',
  syncRunId: 'run-1', now: 1790812800000,
});
const sourceRow = (id = '456', overrides = {}) => ({
  dimensions: { campaign_id: id, stat_time_day: '2026-10-01', ...overrides.dimensions },
  metrics: { spend: '12.34', impressions: '100', clicks: '4', ...overrides.metrics },
});

test('TikTok Ads maps only proved campaign-day metrics with stable keys and null conversions', async () => {
  const result = await buildTikTokAdsDailyWriteSet({ ...base, rows: [sourceRow()] });
  assert.equal(result.entities[0].entity_key, 'tiktok_ads:chemistry_k:campaign:456');
  assert.equal(result.dailyFacts[0].ads_fact_key, 'tiktok_ads:chemistry_k:campaign:456:2026-10-01:none:none');
  assert.equal(result.dailyFacts[0].spend_micros, 12340000);
  assert.equal(result.dailyFacts[0].impressions, 100);
  assert.equal(result.dailyFacts[0].clicks, 4);
  assert.equal(result.dailyFacts[0].conversions, null);
  assert.equal(result.dailyFacts[0].conversion_value_micros, null);
  assert.equal(result.dailyFacts[0].reach, null);
  assert.equal(result.dailyFacts[0].data_status, 'revisable');
  const replay = await buildTikTokAdsDailyWriteSet({ ...base, rows: [sourceRow()] });
  assert.equal(result.sourceWatermark, replay.sourceWatermark);
  assert.equal(result.dailyFacts[0].source_payload_hash, replay.dailyFacts[0].source_payload_hash);
});

test('TikTok Ads rejects duplicate campaign, wrong day and unknown money before any write set', async () => {
  await assert.rejects(buildTikTokAdsDailyWriteSet({
    ...base, rows: [sourceRow(), sourceRow()],
  }), { code: 'TIKTOK_ADS_DAILY_DUPLICATE_CAMPAIGN' });
  await assert.rejects(buildTikTokAdsDailyWriteSet({
    ...base, rows: [sourceRow('456', { dimensions: { stat_time_day: '2026-09-30' } })],
  }), { code: 'TIKTOK_ADS_DAILY_DATE_MISMATCH' });
  await assert.rejects(buildTikTokAdsDailyWriteSet({
    ...base, rows: [sourceRow('456', { metrics: { spend: undefined } })],
  }));
});
