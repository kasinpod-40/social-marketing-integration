import test from 'node:test';
import assert from 'node:assert/strict';
import { D1AdsReportSource } from '../../packages/connectors/src/d1-ads-report-source.js';

test('Ads adapter queries one report level and no-breakdown segment before deriving ratios', async () => {
  const calls = [];
  const db = createD1((sql, bindings, method) => {
    calls.push({ sql, bindings, method });
    if (sql.includes('data_coverage_runs')) {
      return {
        coverage_run_id: 'coverage-1', status: 'complete', expected_rows: 2, observed_rows: 2,
        source_watermark: 'wm-1', failed_rows: 0,
      };
    }
    if (sql.includes('ads_entity_state')) return [{ external_entity_id: 'ad-1', entity_name: 'Ad One' }];
    const reportLevel = bindings[3];
    if (reportLevel === 'account') return [
      fact({ key: 'account-1', level: 'account', spend: 100, impressions: 100, clicks: 10, conversions: 1, value: 300 }),
      fact({ key: 'account-2', level: 'account', spend: 100, impressions: 0, clicks: 0, conversions: 0, value: 0 }),
    ];
    return [fact({ key: 'ad-1-day', level: 'ad', adId: 'ad-1', spend: 200, impressions: 100, clicks: 10, conversions: 1, value: 400 })];
  });
  const source = new D1AdsReportSource({ db, platform: 'meta_ads' });
  const result = await source.load({
    customerKey: 'chemistry_k', accountKey: 'chemistry_k',
    periodStart: '2026-07-01', periodEnd: '2026-07-03', topAdsLimit: 5,
  });

  const factCalls = calls.filter((call) => call.sql.includes('FROM ads_daily_facts'));
  assert.equal(factCalls.length, 2);
  assert.deepEqual(factCalls.map((call) => call.bindings.slice(3, 6)), [
    ['account', 'none', 'none'],
    ['ad', 'none', 'none'],
  ]);
  assert.equal(result.metrics.spend_micros, 200);
  assert.equal(result.metrics.ctr, 0.1);
  assert.equal(result.metrics.cpc_micros, 20);
  assert.equal(result.metrics.cpm_micros, 2_000);
  assert.equal(result.metrics.cpa_micros, 200);
  assert.equal(result.metrics.roas, 1.5);
  assert.equal(result.topAds[0].external_ad_id, 'ad-1');
  assert.equal(result.topAds[0].ad_name, 'Ad One');
  assert.equal(result.readSummary.sourceWatermark, 'wm-1');
});

test('Top Ads order is deterministic for equal spend and impressions', async () => {
  const db = createD1((sql, bindings) => {
    if (sql.includes('data_coverage_runs')) return { status: 'complete', expected_rows: 2, observed_rows: 2 };
    if (sql.includes('ads_entity_state')) return [];
    if (bindings[3] === 'account') return [fact({ key: 'account', level: 'account', spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0 })];
    return [
      fact({ key: 'b', level: 'ad', adId: 'b', spend: 10, impressions: 10, clicks: 1, conversions: 0, value: 0 }),
      fact({ key: 'a', level: 'ad', adId: 'a', spend: 10, impressions: 10, clicks: 1, conversions: 0, value: 0 }),
    ];
  });
  const result = await new D1AdsReportSource({ db, platform: 'google_ads' }).load({
    customerKey: 'chemistry_k', accountKey: 'chemistry_k',
    periodStart: '2026-07-01', periodEnd: '2026-07-03',
  });
  assert.deepEqual(result.topAds.map((row) => row.external_ad_id), ['a', 'b']);
  assert.deepEqual(result.topAds.map((row) => row.rank), [1, 2]);
});

function fact(input) {
  return Object.freeze({
    ads_fact_key: input.key,
    report_level: input.level,
    external_entity_id: input.adId ?? 'account',
    external_ad_id: input.adId ?? null,
    external_campaign_id: null,
    external_ad_group_id: null,
    external_creative_id: null,
    currency: 'THB',
    spend_micros: input.spend,
    impressions: input.impressions,
    reach: null,
    clicks: input.clicks,
    conversions: input.conversions,
    conversion_value_micros: input.value,
    video_views: null,
    data_status: 'complete',
    source_revision: 'revision-1',
  });
}

function createD1(resolver) {
  return {
    prepare(sql) {
      return {
        bindings: [],
        bind(...bindings) { this.bindings = bindings; return this; },
        async all() { return { results: resolver(sql, this.bindings, 'all') ?? [] }; },
        async first() { return resolver(sql, this.bindings, 'first') ?? null; },
      };
    },
  };
}
