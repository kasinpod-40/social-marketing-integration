import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMetaAdsWriteSet,
} from '../../packages/application/src/use-cases/build-meta-ads-write-set.js';
import {
  normalizeMetaAdsEntityFixture,
} from '../../packages/application/src/use-cases/normalize-meta-ads-source.js';

const COMMON = Object.freeze({
  accountId: '987650001',
  fetchedAt: '2026-07-24T12:00:00Z',
  syncRunId: 'sync_meta_status_fixture',
});

function normalize(entityType, resource) {
  return normalizeMetaAdsEntityFixture({
    ...COMMON,
    entityType,
    resource,
  });
}

test('Meta Ads account source status remains raw while canonical status matches Lark options', () => {
  const account = normalize('account', {
    id: 'act_987650001',
    name: 'Fixture Account',
    account_status: 1,
  });

  assert.equal(account.rawRow.status, '1');
  assert.equal(account.entityCandidate.status, 'active');
});

test('Meta effective statuses normalize only at the canonical boundary', () => {
  const campaignPaused = normalize('campaign', {
    id: 'campaign_1',
    effective_status: 'CAMPAIGN_PAUSED',
  });
  const adSetDeleted = normalize('ad_group', {
    id: 'adset_1',
    campaign_id: 'campaign_1',
    effective_status: 'DELETED',
  });
  const adDeleted = normalize('ad', {
    id: 'ad_1',
    campaign_id: 'campaign_1',
    adset_id: 'adset_1',
    effective_status: 'DELETED',
  });
  const campaignEnded = normalize('campaign', {
    id: 'campaign_2',
    effective_status: 'COMPLETED',
  });
  const unresolved = normalize('ad', {
    id: 'ad_2',
    campaign_id: 'campaign_1',
    adset_id: 'adset_1',
    effective_status: 'WITH_ISSUES',
  });

  assert.equal(campaignPaused.rawRow.status, 'CAMPAIGN_PAUSED');
  assert.equal(campaignPaused.entityCandidate.status, 'paused');
  assert.equal(adSetDeleted.entityCandidate.status, 'deleted');
  assert.equal(adDeleted.entityCandidate.status, 'removed');
  assert.equal(campaignEnded.entityCandidate.status, 'ended');
  assert.equal(unresolved.rawRow.status, 'WITH_ISSUES');
  assert.equal(unresolved.entityCandidate.status, 'unknown');
});

test('Meta Ads write set projects only configured canonical Lark status values', async () => {
  const writeSet = await buildMetaAdsWriteSet({
    accountId: '987650001',
    accountKey: 'chemistry_k2',
    customerKey: 'chemistry_k',
    syncRunId: COMMON.syncRunId,
    operationId: 'operation_meta_status_fixture',
    fetchedAt: Date.parse(COMMON.fetchedAt),
    accountTimezone: 'Asia/Bangkok',
    currency: 'THB',
    entityScopeMode: 'report_range',
    larkProjectionMode: 'curated_reports',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    accountResource: {
      id: 'act_987650001',
      name: 'Fixture Account',
      account_status: 1,
      currency: 'THB',
      timezone_name: 'Asia/Bangkok',
    },
    campaigns: [{
      id: 'campaign_1',
      name: 'Fixture Campaign',
      effective_status: 'CAMPAIGN_PAUSED',
    }],
    adSets: [{
      id: 'adset_1',
      campaign_id: 'campaign_1',
      name: 'Fixture Ad Set',
      effective_status: 'DELETED',
    }],
    ads: [{
      id: 'ad_1',
      campaign_id: 'campaign_1',
      adset_id: 'adset_1',
      name: 'Fixture Ad',
      effective_status: 'WITH_ISSUES',
    }],
    creatives: [],
    dailyInsights: [],
  });

  assert.equal(writeSet.raw.adsEntities[0].status, '1');
  assert.equal(writeSet.canonical.adsAccounts[0].status, 'active');
  assert.equal(writeSet.canonical.adsCampaigns[0].status, 'paused');
  assert.equal(writeSet.canonical.adsAdGroups[0].status, 'deleted');
  assert.equal(writeSet.canonical.adsAds[0].status, 'unknown');
  assert.equal(writeSet.d1.adsEntities[0].status, 'active');
});
