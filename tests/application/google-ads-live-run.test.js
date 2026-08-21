import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleGoogleAdsLiveRun,
  buildGoogleAdsD1WriteSet,
  buildGoogleAdsLarkWriteSet,
} from '../../packages/application/src/google-ads/google-ads-live-run.js';
import {
  createGoogleAdsDeliveryEnvelope,
  createGoogleAdsDeliveryManifest,
  googleAdsDatasetRows,
} from '../helpers/google-ads-manager-delivery-fixture.js';

const NOW = Date.parse('2026-07-25T04:05:00.000Z');
const BANGKOK_METRIC_DATE_EPOCH = Date.parse('2026-07-23T17:00:00.000Z');
const BANGKOK_CAMPAIGN_START_EPOCH = Date.parse('2026-06-30T17:00:00.000Z');
const BANGKOK_CAMPAIGN_END_EPOCH = Date.parse('2026-07-30T17:00:00.000Z');

const CANONICAL_FIELD_ALLOWLISTS = Object.freeze({
  accounts: Object.freeze([
    'account_id',
    'account_link_status',
    'account_name',
    'ads_account_key',
    'currency',
    'is_test_account',
    'manager_account_id',
    'platform',
    'status',
    'timezone',
  ]),
  campaigns: Object.freeze([
    'account_id',
    'ad_channel',
    'ads_campaign_key',
    'bidding_strategy_type',
    'campaign_name',
    'channel_subtype',
    'end_date',
    'external_campaign_id',
    'objective',
    'platform',
    'start_date',
    'status',
  ]),
  adGroups: Object.freeze([
    'account_id',
    'ad_group_name',
    'ad_group_type',
    'ads_ad_group_key',
    'external_ad_group_id',
    'external_campaign_id',
    'platform',
    'status',
  ]),
  ads: Object.freeze([
    'account_id',
    'ad_name',
    'ad_type',
    'ads_ad_key',
    'external_ad_group_id',
    'external_ad_id',
    'external_campaign_id',
    'external_creative_id',
    'final_url',
    'platform',
    'status',
  ]),
  creatives: Object.freeze([
    'account_id',
    'ads_creative_key',
    'creative_name',
    'creative_type',
    'external_creative_id',
    'platform',
    'source_content_id',
    'status',
  ]),
  daily: Object.freeze([
    'account_id',
    'actual_roas',
    'ad_channel',
    'ads_daily_key',
    'average_cpv',
    'clicks',
    'conversion_value',
    'conversion_value_micros',
    'conversions',
    'cpa',
    'cpc',
    'cpm',
    'ctr',
    'currency',
    'entity_type',
    'external_ad_group_id',
    'external_ad_id',
    'external_campaign_id',
    'external_creative_id',
    'external_entity_id',
    'impressions',
    'metric_date',
    'platform',
    'reach',
    'spend',
    'spend_micros',
    'video_view_rate',
    'video_views',
  ]),
});

const FORBIDDEN_CANONICAL_ALIASES = Object.freeze([
  'ads_account_id',
  'ads_account_name',
  'connection_status',
  'campaign_key',
  'campaign_id',
  'campaign_status',
  'ad_group_key',
  'ad_group_id',
  'ad_group_status',
  'creative_key',
  'ad_status',
  'last_sync_at',
]);

function liveEnvelopes(overrides = {}) {
  const rowsByDataset = {
    account: overrides.account ?? googleAdsDatasetRows('account'),
    campaigns: overrides.campaigns ?? googleAdsDatasetRows('campaigns'),
    adGroups: overrides.adGroups ?? googleAdsDatasetRows('adGroups'),
    ads: overrides.ads ?? googleAdsDatasetRows('ads'),
    youtubeAssets: overrides.youtubeAssets ?? googleAdsDatasetRows('youtubeAssets'),
    campaignDailyMetrics: overrides.campaignDailyMetrics ?? googleAdsDatasetRows('campaignDailyMetrics'),
  };
  const manifest = createGoogleAdsDeliveryManifest(Object.fromEntries(
    Object.entries(rowsByDataset)
      .filter(([datasetKey]) => datasetKey !== 'account')
      .map(([datasetKey, rows]) => [datasetKey, { totalRows: rows.length, chunkCount: 1 }]),
  ));
  return Object.entries(rowsByDataset).map(([datasetKey, rows]) => createGoogleAdsDeliveryEnvelope({
    mode: 'LIVE',
    datasetKey,
    rows,
    totalRows: rows.length,
    manifest,
  }));
}

function assertExactCanonicalFields(writeSet) {
  for (const [tableKey, rows] of Object.entries(writeSet.canonical)) {
    const allowed = CANONICAL_FIELD_ALLOWLISTS[tableKey];
    assert.ok(allowed, `missing test allowlist for canonical table ${tableKey}`);
    for (const row of rows) {
      assert.deepEqual(Object.keys(row).sort(), [...allowed].sort(), `${tableKey} emitted unexpected fields`);
      for (const forbidden of FORBIDDEN_CANONICAL_ALIASES) {
        assert.equal(Object.hasOwn(row, forbidden), false, `${tableKey} emitted stale alias ${forbidden}`);
      }
    }
  }
}

test('LIVE assembler preserves six exact datasets and rejects PREVIEW', () => {
  const run = assembleGoogleAdsLiveRun(liveEnvelopes().toReversed());
  assert.equal(run.mode, 'LIVE');
  assert.equal(run.summary.expectedChunkCount, 6);
  assert.equal(run.summary.expectedRowCount, 6);
  assert.equal(run.datasets.campaigns[0].campaignId, '10');

  const preview = liveEnvelopes().map((envelope) => ({ ...envelope, mode: 'PREVIEW' }));
  assert.throws(
    () => assembleGoogleAdsLiveRun(preview),
    (error) => error.code === 'GOOGLE_ADS_PREVIEW_QUEUE_FORBIDDEN',
  );
});

test('D1 write set uses Storage keys, date-only facts, null semantics and complete Coverage', async () => {
  const run = assembleGoogleAdsLiveRun(liveEnvelopes());
  const writeSet = await buildGoogleAdsD1WriteSet({
    run,
    syncRunId: 'sync-google-ads-1',
    now: NOW,
  });
  assert.equal(writeSet.entities.length, 5);
  assert.equal(writeSet.dailyFacts.length, 1);
  assert.equal(writeSet.conversionFacts.length, 0);
  assert.equal(writeSet.coverageRuns.length, 6);
  assert.equal(writeSet.coverageEntities.length, 6);
  assert.equal(writeSet.entities[0].entity_key, 'google_ads:fixture_account:account:2222222222');
  assert.equal(writeSet.dailyFacts[0].ads_fact_key, 'google_ads:fixture_account:campaign:10:2026-07-24:all:all');
  assert.equal(writeSet.dailyFacts[0].metric_date, '2026-07-24');
  assert.equal(writeSet.dailyFacts[0].reach, null);
  assert.equal(writeSet.dailyFacts[0].video_views, 0);
  assert.equal(writeSet.dailyFacts[0].data_status, 'revisable');
  assert.equal(writeSet.coverageRuns.every((row) => row.status === 'complete'), true);
});

test('Lark write set matches Canonical Ads v2 fields and preserves source identities', () => {
  const run = assembleGoogleAdsLiveRun(liveEnvelopes());
  const writeSet = buildGoogleAdsLarkWriteSet({ run, syncRunId: 'sync-google-ads-1' });
  assert.equal('raw' in writeSet, false);
  assert.equal(writeSet.canonical.accounts.length, 1);
  assertExactCanonicalFields(writeSet);

  assert.deepEqual(writeSet.canonical.accounts[0], {
    ads_account_key: 'google_ads:2222222222:account:2222222222',
    platform: 'google_ads',
    account_id: '2222222222',
    account_name: 'Fixture account',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
    status: 'active',
    manager_account_id: '1111111111',
    is_test_account: false,
    account_link_status: 'selectable',
  });
  assert.equal(writeSet.canonical.campaigns[0].ads_campaign_key, 'google_ads:2222222222:campaign:10');
  assert.equal(writeSet.canonical.campaigns[0].external_campaign_id, '10');
  assert.equal(writeSet.canonical.campaigns[0].objective, null);
  assert.equal(writeSet.canonical.campaigns[0].status, 'active');
  assert.equal(writeSet.canonical.adGroups[0].ads_ad_group_key, 'google_ads:2222222222:ad_group:20');
  assert.equal(writeSet.canonical.adGroups[0].external_ad_group_id, '20');
  assert.equal(writeSet.canonical.adGroups[0].status, 'active');
  assert.equal(writeSet.canonical.ads[0].ads_ad_key, 'google_ads:2222222222:ad:30');
  assert.equal(writeSet.canonical.ads[0].final_url, 'https://example.test/landing');
  assert.equal(writeSet.canonical.ads[0].status, 'active');
  assert.equal(writeSet.canonical.creatives[0].ads_creative_key, 'google_ads:2222222222:creative:40');
  assert.equal(writeSet.canonical.creatives[0].external_creative_id, '40');
  assert.equal(writeSet.canonical.creatives[0].source_content_id, 'video_fixture_40');
  assert.equal(writeSet.canonical.creatives[0].status, 'active');
  assert.equal(writeSet.canonical.daily[0].ads_daily_key, 'google_ads:2222222222:campaign:10:2026-07-24');
  assert.equal(writeSet.canonical.daily[0].account_id, '2222222222');
  assert.equal(writeSet.canonical.daily[0].entity_type, 'campaign');
  assert.equal(writeSet.canonical.daily[0].external_entity_id, '10');
  assert.equal(writeSet.canonical.daily[0].currency, 'THB');
  assert.equal(writeSet.canonical.daily[0].spend, 1);
  assert.equal(writeSet.canonical.daily[0].conversion_value, 3);
  assert.equal(writeSet.canonical.daily[0].ctr, 0.1);
  assert.equal(writeSet.canonical.daily[0].cpc, 0.1);
  assert.equal(writeSet.canonical.daily[0].cpm, 10);
  assert.equal(writeSet.canonical.daily[0].cpa, 0.4);
  assert.equal(writeSet.canonical.daily[0].actual_roas, 3);
  assert.equal(writeSet.canonical.daily[0].average_cpv, 0);

  assert.equal(writeSet.canonical.daily[0].metric_date, BANGKOK_METRIC_DATE_EPOCH);
  assert.equal(JSON.stringify(writeSet).includes('RAW_Google'), false);
  assert.equal(JSON.stringify(writeSet).includes('refresh_token'), false);
});

test('campaign date-only fields use source-timezone midnight without changing stable keys', () => {
  const campaign = {
    ...googleAdsDatasetRows('campaigns')[0],
    startDate: '2026-07-01',
    endDate: '2026-07-31',
  };
  const run = assembleGoogleAdsLiveRun(liveEnvelopes({ campaigns: [campaign] }));
  const row = buildGoogleAdsLarkWriteSet({ run, syncRunId: 'sync-google-ads-1' }).canonical.campaigns[0];
  assert.equal(row.ads_campaign_key, 'google_ads:2222222222:campaign:10');
  assert.equal(row.start_date, BANGKOK_CAMPAIGN_START_EPOCH);
  assert.equal(row.end_date, BANGKOK_CAMPAIGN_END_EPOCH);
});

test('Google campaign channels map to approved Canonical Ads options', () => {
  const channelCases = [
    ['SEARCH', null, 'google_search_ads'],
    ['DISPLAY', null, 'google_display_ads'],
    ['VIDEO', null, 'youtube_ads'],
    ['DEMAND_GEN', null, 'google_demand_gen_ads'],
    ['DISPLAY', 'DISCOVERY', 'google_demand_gen_ads'],
    ['PERFORMANCE_MAX', null, 'google_performance_max_ads'],
    ['SHOPPING', null, 'google_shopping_ads'],
    ['MULTI_CHANNEL', 'APP_CAMPAIGN', 'google_app_ads'],
    ['UNKNOWN', null, 'google_other_ads'],
  ];
  const campaigns = [
    googleAdsDatasetRows('campaigns')[0],
    ...channelCases.map(([channel, subtype], index) => ({
      ...googleAdsDatasetRows('campaigns')[0],
      campaignId: String(index + 100),
      advertisingChannelType: channel,
      advertisingChannelSubType: subtype,
    })),
  ];
  const run = assembleGoogleAdsLiveRun(liveEnvelopes({ campaigns }));
  const rows = buildGoogleAdsLarkWriteSet({ run, syncRunId: 'sync-google-ads-1' }).canonical.campaigns;
  assert.deepEqual(rows.slice(1).map((row) => row.ad_channel), channelCases.map((entry) => entry[2]));
});

test('Canonical Daily derives modern channel from Campaign when signed row uses legacy fallback', () => {
  const campaign = {
    ...googleAdsDatasetRows('campaigns')[0],
    advertisingChannelType: 'PERFORMANCE_MAX',
    advertisingChannelSubType: null,
  };
  const daily = {
    ...googleAdsDatasetRows('campaignDailyMetrics')[0],
    advertisingChannelType: 'PERFORMANCE_MAX',
    advertisingChannelSubType: null,
    adChannel: 'google_other',
  };
  const run = assembleGoogleAdsLiveRun(liveEnvelopes({
    campaigns: [campaign],
    campaignDailyMetrics: [daily],
  }));
  const row = buildGoogleAdsLarkWriteSet({ run, syncRunId: 'sync-google-ads-1' }).canonical.daily[0];
  assert.equal(row.ad_channel, 'google_performance_max_ads');
});