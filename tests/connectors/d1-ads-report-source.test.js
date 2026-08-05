import test from 'node:test';
import assert from 'node:assert/strict';
import { D1AdsReportSource } from '../../packages/connectors/src/d1-ads-report-source.js';

test('Meta Ads aggregates reviewed publisher partitions once and builds Top Ads from D1', async () => {
  const calls = [];
  const db = createD1((sql, bindings) => {
    calls.push({ sql, bindings });
    if (sql.includes('data_coverage_runs')) {
      return {
        coverage_run_id: 'coverage-meta',
        dataset_key: 'meta_ads.performance.daily',
        status: 'complete',
        expected_rows: 2,
        observed_rows: 2,
        source_watermark: 'wm-meta',
        failed_rows: 0,
      };
    }
    if (sql.includes('ads_entity_state')) {
      return [{ external_entity_id: 'ad-1', entity_name: 'Ad One', currency: 'THB' }];
    }
    return [
      fact({
        key: 'ad-1-facebook', level: 'ad', adId: 'ad-1',
        breakdown: 'publisher_platform=facebook', segment: 'none',
        spend: 100, impressions: 100, clicks: 10, conversions: 1, value: 300,
      }),
      fact({
        key: 'ad-1-instagram', level: 'ad', adId: 'ad-1',
        breakdown: 'publisher_platform=instagram', segment: 'none',
        spend: 100, impressions: 0, clicks: 0, conversions: 0, value: 0,
      }),
      fact({
        key: 'ad-1-age', level: 'ad', adId: 'ad-1',
        breakdown: 'age=18-24', segment: 'none',
        spend: 999, impressions: 999, clicks: 999, conversions: 99, value: 999,
      }),
    ];
  });
  const result = await new D1AdsReportSource({ db, platform: 'meta_ads' }).load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-03',
    topAdsLimit: 5,
  });

  const factCalls = calls.filter((call) => call.sql.includes('FROM ads_daily_facts'));
  assert.equal(factCalls.length, 1);
  assert.deepEqual(factCalls[0].bindings.slice(3, 4), ['ad']);
  assert.doesNotMatch(factCalls[0].sql, /SELECT\s+\*/u);
  assert.doesNotMatch(factCalls[0].sql, /actions_json|breakdown_json|source_payload_hash/u);
  const coverageCall = calls.find((call) => call.sql.includes('FROM data_coverage_runs'));
  const entityCall = calls.find((call) => call.sql.includes('FROM ads_entity_state'));
  assert.doesNotMatch(coverageCall.sql, /SELECT\s+\*/u);
  assert.doesNotMatch(entityCall.sql, /SELECT\s+\*/u);
  assert.equal(result.metrics.spend_micros, 200);
  assert.equal(result.metrics.ctr, 0.1);
  assert.equal(result.metrics.cpc_micros, 20);
  assert.equal(result.metrics.cpm_micros, 2_000);
  assert.equal(result.metrics.cpa_micros, 200);
  assert.equal(result.metrics.roas, 1.5);
  assert.equal(result.topAds[0].external_ad_id, 'ad-1');
  assert.equal(result.topAds[0].ad_name, 'Ad One');
  assert.equal(result.readSummary.coverageDatasetKey, 'meta_ads.performance.daily');
  assert.equal(result.readSummary.summaryBreakdownFamily, 'publisher_platform');
  assert.equal(result.readSummary.discardedFactRows, 1);
  assert.equal(result.readSummary.sourceWatermark, 'wm-meta');
});

test('Meta Ads reviewed projections exclude large retained JSON columns from D1 result rows', async () => {
  const calls = [];
  const db = createD1((sql) => {
    calls.push(sql);
    if (/SELECT\s+\*/u.test(sql)) throw new Error('unbounded projection forbidden');
    if (sql.includes('data_coverage_runs')) {
      return {
        coverage_run_id: 'coverage-meta',
        dataset_key: 'meta_ads.performance.daily',
        status: 'complete',
        expected_rows: 1,
        observed_rows: 1,
        source_watermark: '2026-07-31',
        failed_rows: 0,
      };
    }
    if (sql.includes('ads_entity_state')) {
      return [{ external_entity_id: 'ad-1', entity_name: 'Ad One', currency: 'THB' }];
    }
    return [fact({
      key: 'ad-1', level: 'ad', adId: 'ad-1',
      breakdown: 'publisher_platform=facebook', segment: 'none',
      spend: 100, impressions: 100, clicks: 10, conversions: 1, value: 300,
    })];
  });

  const result = await new D1AdsReportSource({ db, platform: 'meta_ads' }).load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-29',
    periodEnd: '2026-07-31',
  });

  assert.equal(result.metrics.spend_micros, 100);
  assert.equal(calls.some((sql) => /actions_json|breakdown_json|source_payload_hash/u.test(sql)), false);
});

test('Meta Ads Top Ads order is deterministic for equal detailed totals', async () => {
  const db = createD1((sql) => {
    if (sql.includes('data_coverage_runs')) {
      return { dataset_key: 'meta_ads.performance.daily', status: 'complete', expected_rows: 2, observed_rows: 2 };
    }
    if (sql.includes('ads_entity_state')) return [];
    return [
      fact({
        key: 'b', level: 'ad', adId: 'b', breakdown: 'publisher_platform=facebook', segment: 'none',
        spend: 10, impressions: 10, clicks: 1, conversions: 0, value: 0,
      }),
      fact({
        key: 'a', level: 'ad', adId: 'a', breakdown: 'publisher_platform=facebook', segment: 'none',
        spend: 10, impressions: 10, clicks: 1, conversions: 0, value: 0,
      }),
    ];
  });
  const result = await new D1AdsReportSource({ db, platform: 'meta_ads' }).load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-03',
  });
  assert.deepEqual(result.topAds.map((row) => row.external_ad_id), ['a', 'b']);
  assert.deepEqual(result.topAds.map((row) => row.rank), [1, 2]);
});

test('Google Ads aggregates campaign all/all facts without fabricating Top Ads', async () => {
  const calls = [];
  const db = createD1((sql, bindings) => {
    calls.push({ sql, bindings });
    if (sql.includes('data_coverage_runs')) {
      return {
        coverage_run_id: 'coverage-google',
        dataset_key: 'campaignDailyMetrics',
        status: 'complete',
        expected_rows: 2,
        observed_rows: 2,
        source_watermark: 'wm-google',
        failed_rows: 0,
      };
    }
    if (sql.includes('ads_entity_state')) throw new Error('Google campaign facts must not query ad entities');
    return [
      fact({
        key: 'campaign-1-day-1', level: 'campaign', campaignId: 'campaign-1',
        breakdown: 'all', segment: 'all', metricDate: '2026-07-01',
        spend: 100, impressions: 100, clicks: 10, conversions: 1, value: 300,
      }),
      fact({
        key: 'campaign-1-day-2', level: 'campaign', campaignId: 'campaign-1',
        breakdown: 'all', segment: 'all', metricDate: '2026-07-02',
        spend: 50, impressions: 50, clicks: 5, conversions: 0, value: 0,
      }),
      fact({
        key: 'campaign-1-device', level: 'campaign', campaignId: 'campaign-1',
        breakdown: 'device=mobile', segment: 'all', metricDate: '2026-07-02',
        spend: 1_000, impressions: 1_000, clicks: 1_000, conversions: 10, value: 1_000,
      }),
    ];
  });
  const result = await new D1AdsReportSource({ db, platform: 'google_ads' }).load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-03',
  });
  const factCall = calls.find((call) => call.sql.includes('FROM ads_daily_facts'));
  assert.deepEqual(factCall.bindings.slice(3, 4), ['campaign']);
  assert.equal(result.metrics.spend_micros, 150);
  assert.equal(result.metrics.impressions, 150);
  assert.deepEqual(result.topAds, []);
  assert.equal(result.readSummary.rankingReportLevel, null);
  assert.equal(result.readSummary.topAdsAvailability, 'not_observed');
  assert.equal(result.readSummary.discardedFactRows, 1);
  assert.equal(result.readSummary.sourceWatermark, 'wm-google');
});

function fact(input) {
  return Object.freeze({
    ads_fact_key: input.key,
    report_level: input.level,
    external_entity_id: input.adId ?? input.campaignId ?? 'account',
    external_ad_id: input.adId ?? null,
    external_campaign_id: input.campaignId ?? null,
    external_ad_group_id: null,
    external_creative_id: null,
    metric_date: input.metricDate ?? '2026-07-01',
    breakdown_key: input.breakdown,
    segment_key: input.segment,
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
