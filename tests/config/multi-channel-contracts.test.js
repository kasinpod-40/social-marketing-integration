import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YOUTUBE_LARK_BLUEPRINT,
  YOUTUBE_ORGANIC_SOURCE_CONTRACT,
} from '../../packages/config/src/youtube-organic-blueprint.js';
import { META_ORGANIC_CONTRACT } from '../../packages/config/src/meta-organic-contract.js';
import {
  CHATWOOT_SOURCE_CONTRACT,
  WOOCOMMERCE_SOURCE_CONTRACT,
} from '../../packages/config/src/commerce-conversation-contracts.js';
import {
  ADS_CANONICAL_CONTRACT,
  ADS_LARK_BLUEPRINT,
} from '../../packages/config/src/ads-data-model.js';

test('YouTube blueprint separates cumulative Data API snapshots from period Analytics rows', () => {
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.storageMode, 'separate_period_metrics');
  assert.deepEqual(YOUTUBE_LARK_BLUEPRINT.map((table) => table.key), [
    'rawYouTubeChannels', 'rawYouTubeVideos', 'rawYouTubeAnalyticsDaily',
  ]);
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.dataApi.videosListWithIds.maxResultsSupported, false);
  assert.equal(
    YOUTUBE_ORGANIC_SOURCE_CONTRACT.dataApi.quotaPolicy.quotaExceeded,
    'terminal_alert_wait_for_reset_or_quota_increase',
  );
  assert.equal(Object.isFrozen(YOUTUBE_LARK_BLUEPRINT[0].fields), true);
});

test('Meta, WooCommerce and Chatwoot contracts keep auth/pagination rules platform-specific', () => {
  assert.equal(META_ORGANIC_CONTRACT.transport.pagination.includes('cursor'), true);
  assert.equal(WOOCOMMERCE_SOURCE_CONTRACT.pagination.includes('x_wp_total_pages'), true);
  assert.equal(CHATWOOT_SOURCE_CONTRACT.auth, 'api_access_token_header');
});

test('Ads model covers shared hierarchy and prevents target ROAS from becoming actual ROAS', () => {
  assert.deepEqual(ADS_CANONICAL_CONTRACT.hierarchy, ['account', 'campaign', 'ad_group', 'ad']);
  assert.deepEqual(ADS_CANONICAL_CONTRACT.assetEntities, ['creative']);
  assert.equal(ADS_CANONICAL_CONTRACT.metricSemantics.money.sourceOfTruth, 'integer_micros');
  assert.equal(ADS_CANONICAL_CONTRACT.metricSemantics.targetRoasIsActualRoas, false);
  assert.deepEqual(ADS_LARK_BLUEPRINT.map((table) => table.primaryField), [
    'ads_account_key', 'ads_campaign_key', 'ads_ad_group_key', 'ads_ad_key',
    'ads_creative_key', 'ads_daily_key',
  ]);
});
