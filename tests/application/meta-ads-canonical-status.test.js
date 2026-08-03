import assert from 'node:assert/strict';
import test from 'node:test';

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
