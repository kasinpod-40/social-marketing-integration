import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaAdsWriteSet } from '../../packages/application/src/use-cases/build-meta-ads-write-set.js';

const FETCHED_AT = Date.parse('2026-07-24T08:05:00Z');

function baseInput() {
  return {
    accountId: '987650001',
    accountKey: 'chemistry_k_meta_ads',
    customerKey: 'chemistry_k',
    syncRunId: 'sync_ads_1',
    operationId: 'operation_ads_1',
    fetchedAt: FETCHED_AT,
    accountTimezone: 'Asia/Bangkok',
    currency: 'THB',
    accountResource: {
      id: 'act_987650001',
      name: 'Fixture Ad Account',
      account_status: 1,
      currency: 'THB',
      timezone_name: 'Asia/Bangkok',
    },
  };
}

test('builds Meta Ads D1 breakdown facts and one bounded Canonical daily aggregate', async () => {
  const writeSet = await buildMetaAdsWriteSet({
    ...baseInput(),
    campaigns: [{
      id: 'campaign_fixture_001',
      name: 'Fixture Campaign',
      objective: 'OUTCOME_AWARENESS',
      effective_status: 'ACTIVE',
      updated_time: '2026-07-24T08:00:00+0000',
    }],
    adSets: [{
      id: 'adset_fixture_001',
      campaign_id: 'campaign_fixture_001',
      name: 'Fixture Ad Set',
      effective_status: 'ACTIVE',
    }],
    ads: [{
      id: 'ad_fixture_001',
      campaign_id: 'campaign_fixture_001',
      adset_id: 'adset_fixture_001',
      name: 'Fixture Ad',
      effective_status: 'ACTIVE',
      creative: { id: 'creative_fixture_001' },
    }],
    creatives: [{ id: 'creative_fixture_001', name: 'Fixture Creative' }],
    dailyInsights: [
      {
        account_id: '987650001',
        account_currency: 'THB',
        campaign_id: 'campaign_fixture_001',
        adset_id: 'adset_fixture_001',
        ad_id: 'ad_fixture_001',
        date_start: '2026-07-23',
        date_stop: '2026-07-23',
        publisher_platform: 'facebook',
        spend: '10.000000',
        impressions: '100',
        reach: '80',
        clicks: '5',
      },
      {
        account_id: '987650001',
        account_currency: 'THB',
        campaign_id: 'campaign_fixture_001',
        adset_id: 'adset_fixture_001',
        ad_id: 'ad_fixture_001',
        date_start: '2026-07-23',
        date_stop: '2026-07-23',
        publisher_platform: 'instagram',
        spend: '20.250001',
        impressions: '200',
        reach: '150',
        clicks: '10',
      },
    ],
  });

  assert.equal(writeSet.d1.adsDailyFacts.length, 2);
  assert.notEqual(writeSet.d1.adsDailyFacts[0].ads_fact_key, writeSet.d1.adsDailyFacts[1].ads_fact_key);
  assert.equal(writeSet.canonical.adsDaily.length, 1);
  assert.equal(writeSet.canonical.adsDaily[0].spend_micros, 30_250_001);
  assert.equal(writeSet.canonical.adsDaily[0].impressions, 300);
  assert.equal(Object.hasOwn(writeSet.canonical.adsDaily[0], 'ad_channel'), false);
  assert.equal(Object.hasOwn(writeSet.canonical.adsDaily[0], 'reach'), false);
  assert.equal(writeSet.reconciliation.campaignsStatus, 'complete');
  assert.equal(writeSet.reconciliation.spendStatus, 'revisable');
});


test('Coverage identifiers remain separate for two Meta Ad Accounts sharing one operation ID', async () => {
  const build = (accountId) => buildMetaAdsWriteSet({
    ...baseInput(),
    accountId,
    accountResource: {
      ...baseInput().accountResource,
      id: `act_${accountId}`,
      account_id: accountId,
    },
    campaigns: [],
    adSets: [],
    ads: [],
    creatives: [],
    dailyInsights: [],
  });
  const account2 = await build('505898710119851');
  const account3 = await build('851206695716861');
  const ids2 = new Set(account2.d1.coverageRuns.map((row) => row.coverage_run_id));
  const ids3 = new Set(account3.d1.coverageRuns.map((row) => row.coverage_run_id));
  assert.equal([...ids2].some((id) => ids3.has(id)), false);
});

test('empty Meta Ads inventory and spend are no_data_confirmed, not failure', async () => {
  const writeSet = await buildMetaAdsWriteSet({
    ...baseInput(),
    campaigns: [],
    adSets: [],
    ads: [],
    creatives: [],
    dailyInsights: [],
  });

  assert.equal(writeSet.canonical.adsAccounts.length, 1);
  assert.equal(writeSet.canonical.adsCampaigns.length, 0);
  assert.equal(writeSet.canonical.adsDaily.length, 0);
  assert.equal(writeSet.reconciliation.campaignsStatus, 'no_data_confirmed');
  assert.equal(writeSet.reconciliation.spendStatus, 'no_data_confirmed');
  assert.ok(writeSet.d1.coverageRuns.some((row) => (
    row.dataset_key === 'meta_ads.performance.daily' && row.status === 'no_data_confirmed'
  )));
});

test('July activity scope keeps detailed daily facts in D1 and emits one bounded Canonical Lark daily row', async () => {
  const writeSet = await buildMetaAdsWriteSet({
    ...baseInput(),
    entityScopeMode: 'report_range',
    larkProjectionMode: 'curated_reports',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    campaigns: [{ id: 'campaign_1', name: 'July Campaign' }],
    adSets: [{ id: 'adset_1', campaign_id: 'campaign_1', name: 'July Ad Set' }],
    ads: [{ id: 'ad_1', campaign_id: 'campaign_1', adset_id: 'adset_1', name: 'July Ad' }],
    creatives: [],
    dailyInsights: [{
      account_id: '987650001',
      account_currency: 'THB',
      campaign_id: 'campaign_1',
      campaign_name: 'July Campaign',
      adset_id: 'adset_1',
      adset_name: 'July Ad Set',
      ad_id: 'ad_1',
      ad_name: 'July Ad',
      date_start: '2026-07-31',
      date_stop: '2026-07-31',
      publisher_platform: 'facebook',
      spend: '1.000000',
      impressions: '10',
      reach: '8',
      clicks: '2',
    }],
  });

  assert.equal(writeSet.d1.adsEntities.length, 4);
  assert.equal(writeSet.d1.adsDailyFacts.length, 1);
  assert.equal(writeSet.raw.adsEntities.length, 4);
  assert.equal(writeSet.raw.adsDaily.length, 0);
  assert.equal(writeSet.canonical.adsDaily.length, 1);
  assert.equal(writeSet.canonical.adsDaily[0].spend_micros, 1_000_000);
  assert.equal(writeSet.canonical.adsDaily[0].impressions, 10);
  assert.equal(writeSet.reconciliation.canonicalDailyRows, 1);
  assert.equal(writeSet.reconciliation.entityScopeMode, 'report_range');
  assert.equal(writeSet.reconciliation.larkProjectionMode, 'curated_reports');
  assert.equal(writeSet.reconciliation.detailedDailyRows, 1);
  assert.equal(writeSet.d1.coverageRuns.length, 6);
  assert.equal(writeSet.d1.coverageRuns.some((row) => row.dataset_key.includes('creatives')), false);
  assert.equal(writeSet.d1.coverageRuns
    .filter((row) => row.dataset_key.endsWith('.activity'))
    .every((row) => (
      row.scope_mode === 'report_range'
      && row.period_start === '2026-07-01'
      && row.period_end === '2026-07-31'
    )), true);
});
