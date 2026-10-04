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
  const midnight = await buildTikTokAdsDailyWriteSet({
    ...base, rows: [sourceRow('456', { dimensions: { stat_time_day: '2026-10-01 00:00:00' } })],
  });
  assert.equal(result.dailyFacts[0].ads_fact_key, midnight.dailyFacts[0].ads_fact_key);
  assert.equal(result.dailyFacts[0].source_payload_hash, midnight.dailyFacts[0].source_payload_hash);
});

test('TikTok Ads rejects duplicate campaign, wrong day and unknown money before any write set', async () => {
  await assert.rejects(buildTikTokAdsDailyWriteSet({
    ...base, rows: [sourceRow(), sourceRow()],
  }), { code: 'TIKTOK_ADS_DAILY_DUPLICATE_CAMPAIGN' });
  await assert.rejects(buildTikTokAdsDailyWriteSet({
    ...base, rows: [sourceRow('456', { dimensions: { stat_time_day: '2026-09-30' } })],
  }), { code: 'TIKTOK_ADS_DAILY_DATE_MISMATCH' });
  await assert.rejects(buildTikTokAdsDailyWriteSet({
    ...base, rows: [sourceRow('456', { dimensions: { stat_time_day: '2026-10-01 01:00:00' } })],
  }), { code: 'TIKTOK_ADS_DAILY_DATE_MISMATCH' });
  await assert.rejects(buildTikTokAdsDailyWriteSet({
    ...base, rows: [sourceRow('456', { metrics: { spend: undefined } })],
  }));
});


test('true Ad daily uses source ad_id_v2 plus verified parents with distinct key/coverage and no master rewrite', async () => {
  const parents = new Map([
    ['campaign:456', { source_account_id: base.advertiserId }],
    ['ad_group:567', { source_account_id: base.advertiserId, parent_campaign_id: '456' }],
    ['ad:678', { source_account_id: base.advertiserId, parent_campaign_id: '456', parent_ad_group_id: '567', external_creative_id: '999' }],
  ]);
  const input = { ...base, now: Date.parse('2026-10-04T00:00:00Z'), grain: 'ad', allStatuses: true, parents,
    rows: [sourceRow('456', { dimensions: { ad_id_v2: '678' } })] };
  const result = await buildTikTokAdsDailyWriteSet(input);
  assert.equal(result.entities.length, 0);
  assert.equal(result.coverageRunId, 'tiktok_ads:chemistry_k:ad_daily:2026-10-01');
  assert.equal(result.dailyFacts[0].ads_fact_key, 'tiktok_ads:chemistry_k:ad:678:2026-10-01:none:none');
  assert.equal(result.dailyFacts[0].external_campaign_id, '456');
  assert.equal(result.dailyFacts[0].external_ad_group_id, '567');
  assert.equal(result.dailyFacts[0].external_ad_id, '678');
  assert.equal(result.dailyFacts[0].external_creative_id, null);
  assert.equal(result.dailyFacts[0].conversions, null);
  parents.delete('ad_group:567');
  await assert.rejects(buildTikTokAdsDailyWriteSet(input), { code: 'TIKTOK_ADS_DAILY_PARENT_CONFLICT' });
  parents.delete('ad:678');
  await assert.rejects(buildTikTokAdsDailyWriteSet(input), { code: 'TIKTOK_ADS_DAILY_MASTER_MISSING' });
});
test('new all-status daily contract refuses current day or dates outside approved history', async () => {
  for (const date of ['2025-08-31', '2026-10-04', '2026-10-05']) {
    await assert.rejects(buildTikTokAdsDailyWriteSet({ ...base, now: Date.parse('2026-10-04T00:00:00Z'),
      allStatuses: true, date, rows: [] }), { code: 'TIKTOK_ADS_DAILY_DATE_OUTSIDE_SCOPE' });
  }
});
