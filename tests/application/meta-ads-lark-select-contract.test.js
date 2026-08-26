import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMetaAdsWriteSet } from '../../packages/application/src/use-cases/build-meta-ads-write-set.js';

const SELECT_OPTIONS = Object.freeze({
  platform: new Set(['meta_ads', 'tiktok_ads', 'google_ads']),
  accountStatus: new Set(['active', 'paused', 'removed', 'unknown']),
  accountLinkStatus: new Set(['selectable', 'not_selectable', 'unknown']),
  campaignStatus: new Set(['active', 'paused', 'removed', 'deleted', 'ended', 'unknown']),
  adGroupStatus: new Set(['active', 'paused', 'removed', 'deleted', 'unknown']),
  adStatus: new Set(['active', 'paused', 'removed', 'unknown']),
  creativeType: new Set(['image', 'video', 'carousel', 'other']),
  adChannel: new Set(['facebook_ads', 'instagram_ads']),
});

const fetchedAt = Date.parse('2026-07-31T12:00:00Z');

test('Meta curated Lark projection uses only applied SingleSelect options', async () => {
  const writeSet = await buildMetaAdsWriteSet({
    accountId: '987650001',
    accountKey: 'chemistry_k2_meta_ads',
    customerKey: 'chemistry_k2',
    syncRunId: 'meta:meta_ads:chemistry_k2:fixture',
    operationId: 'meta-chemistry_k2-fixture',
    fetchedAt,
    accountTimezone: 'Asia/Bangkok',
    currency: 'THB',
    entityScopeMode: 'report_range',
    larkProjectionMode: 'curated_reports',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    accountResource: {
      id: 'act_987650001',
      name: 'Chemistry K2',
      account_status: 1,
      currency: 'THB',
      timezone_name: 'Asia/Bangkok',
    },
    campaigns: [{
      id: 'campaign_1',
      name: 'Campaign',
      effective_status: 'CAMPAIGN_PAUSED',
    }],
    adSets: [{
      id: 'adset_1',
      campaign_id: 'campaign_1',
      name: 'Ad Set',
      effective_status: 'ADSET_PAUSED',
    }],
    ads: [{
      id: 'ad_1',
      campaign_id: 'campaign_1',
      adset_id: 'adset_1',
      name: 'Ad',
      effective_status: 'ACTIVE',
    }],
    creatives: [
      { id: 'creative_photo', name: 'Photo', object_type: 'PHOTO' },
      { id: 'creative_video', name: 'Video', object_type: 'VIDEO' },
      { id: 'creative_carousel', name: 'Carousel', object_type: 'CAROUSEL' },
      { id: 'creative_share', name: 'Share', object_type: 'SHARE' },
      { id: 'creative_deleted', name: 'Deleted', object_type: 'POST_DELETED' },
      { id: 'creative_unknown', name: 'Unknown' },
    ],
    dailyInsights: [
      {
        account_id: '987650001',
        account_currency: 'THB',
        campaign_id: 'campaign_1',
        adset_id: 'adset_1',
        ad_id: 'ad_1',
        date_start: '2026-07-31',
        date_stop: '2026-07-31',
        publisher_platform: 'audience_network',
        spend: '1.000000',
        impressions: '10',
        reach: '8',
        clicks: '2',
      },
    ],
  });

  const account = writeSet.canonical.adsAccounts[0];
  const campaign = writeSet.canonical.adsCampaigns[0];
  const adGroup = writeSet.canonical.adsAdGroups[0];
  const ad = writeSet.canonical.adsAds[0];

  for (const row of [account, campaign, adGroup, ad]) {
    assert.equal(SELECT_OPTIONS.platform.has(row.platform), true);
  }
  assert.equal(SELECT_OPTIONS.accountStatus.has(account.status), true);
  assert.equal(SELECT_OPTIONS.accountLinkStatus.has(account.account_link_status), true);
  assert.equal(account.account_link_status, 'selectable');
  assert.equal(Object.hasOwn(account, 'last_sync_at'), false);
  assert.equal(SELECT_OPTIONS.campaignStatus.has(campaign.status), true);
  assert.equal(SELECT_OPTIONS.adGroupStatus.has(adGroup.status), true);
  assert.equal(SELECT_OPTIONS.adStatus.has(ad.status), true);
  assert.equal(ad.last_sync_at, fetchedAt);
  assert.deepEqual(
    writeSet.canonical.adsCreatives.map((row) => row.creative_type),
    ['image', 'video', 'carousel', 'other', 'other', 'other'],
  );
  assert.equal(
    writeSet.canonical.adsCreatives.every((row) => SELECT_OPTIONS.creativeType.has(row.creative_type)),
    true,
  );
  assert.equal(writeSet.d1.adsDailyFacts[0].ad_channel, 'audience_network_ads');
  assert.equal(Object.hasOwn(writeSet.canonical.adsDaily[0], 'ad_channel'), false);
  assert.equal(
    writeSet.canonical.adsDaily.every((row) => (
      !Object.hasOwn(row, 'ad_channel') || SELECT_OPTIONS.adChannel.has(row.ad_channel)
    )),
    true,
  );
});
